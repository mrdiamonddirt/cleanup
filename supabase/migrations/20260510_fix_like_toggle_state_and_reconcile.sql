-- Harden like toggle state handling and reconcile historical like-state drift.
-- Keeps one active like row per profile/target and aligns like-related points
-- with the surviving active likes.

create or replace function public.get_target_interaction_summary(
    p_target_entity_type text,
    p_target_entity_id text
)
returns table (
    like_count bigint,
    share_count bigint,
    viewer_has_liked boolean,
    viewer_has_shared boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_target_entity_type text := lower(trim(coalesce(p_target_entity_type, '')));
    v_target_entity_id text := trim(coalesce(p_target_entity_id, ''));
begin
    if v_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if v_target_entity_id = '' then
        raise exception 'Missing target id';
    end if;

    return query
    with scoped_interactions as (
        select
            case
                when lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) in ('like', 'share')
                    then lower(trim(coalesce(to_jsonb(si)->>'interaction_type', '')))
                when lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                    then 'like'
                when lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('share', 'interaction_share')
                    then 'share'
                else null
            end as interaction_kind,
            si.profile_id
        from public.social_interactions as si
        where si.target_entity_type = v_target_entity_type
          and si.target_entity_id = v_target_entity_id
    )
    select
        count(*) filter (where interaction_kind = 'like') as like_count,
        count(*) filter (where interaction_kind = 'share') as share_count,
        exists(
            select 1
            from scoped_interactions
            where interaction_kind = 'like'
              and profile_id = v_user_id
        ) as viewer_has_liked,
        exists(
            select 1
            from scoped_interactions
            where interaction_kind = 'share'
              and profile_id = v_user_id
        ) as viewer_has_shared
    from scoped_interactions;
end;
$$;

grant execute on function public.get_target_interaction_summary(text, text) to anon;
grant execute on function public.get_target_interaction_summary(text, text) to authenticated;

create or replace function public.toggle_like_interaction(
    p_target_entity_type text,
    p_target_entity_id text,
    p_metadata jsonb default '{}'::jsonb
)
returns table (
    interaction_id uuid,
    liked boolean,
    points_delta integer,
    points_balance_after integer,
    like_count bigint,
    share_count bigint,
    viewer_has_liked boolean,
    viewer_has_shared boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_target_entity_type text := lower(trim(coalesce(p_target_entity_type, '')));
    v_target_entity_id text := trim(coalesce(p_target_entity_id, ''));
    v_interaction_column text;
    v_existing public.social_interactions%rowtype;
    v_like_award public.point_events_ledger%rowtype;
    v_points integer;
    v_balance_after integer := 0;
    v_ledger public.point_events_ledger;
    v_summary record;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if public.is_profile_banned(v_user_id) then
        raise exception 'Account is banned from interactions';
    end if;

    if v_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if v_target_entity_id = '' then
        raise exception 'Missing target id';
    end if;

    select case
        when exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'social_interactions'
              and column_name = 'interaction_type'
        ) then 'interaction_type'
        when exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'social_interactions'
              and column_name = 'action_type'
        ) then 'action_type'
        else null
    end
    into v_interaction_column;

    if v_interaction_column is null then
        raise exception 'social_interactions is missing interaction_type/action_type column';
    end if;

    execute format(
        'select *
         from public.social_interactions as si
         where si.profile_id = $1
           and si.target_entity_type = $2
           and si.target_entity_id = $3
           and (
                lower(trim(coalesce(to_jsonb(si)->>''interaction_type'', ''''))) = ''like''
                or lower(trim(coalesce(to_jsonb(si)->>''action_type'', ''''))) in (''like'', ''interaction_like'')
           )
         order by si.created_at desc, si.id desc
         limit 1
         for update'
    )
    into v_existing
    using v_user_id, v_target_entity_type, v_target_entity_id;

    if found then
        select pel.*
        into v_like_award
        from public.point_events_ledger as pel
        where pel.profile_id = v_user_id
          and pel.action_code = 'interaction_like'
          and pel.source_type = v_target_entity_type
          and pel.source_id = v_target_entity_id
          and (
                coalesce(pel.metadata->>'interaction_id', '') = v_existing.id::text
                or coalesce(pel.metadata->>'interaction_id', '') = ''
          )
        order by
            case
                when coalesce(pel.metadata->>'interaction_id', '') = v_existing.id::text then 0
                else 1
            end,
            pel.created_at desc,
            pel.id desc
        limit 1;

        if found then
            v_points := abs(coalesce(v_existing.points_awarded, v_like_award.points_delta, public.get_rule_points_value('like')));
        else
            v_points := 0;
        end if;

        if v_points > 0 then
            v_ledger := public.apply_points_event(
                v_user_id,
                'interaction_like_removed',
                -abs(v_points),
                v_target_entity_type,
                v_target_entity_id,
                'Removed like interaction',
                jsonb_build_object(
                    'interaction_id', v_existing.id,
                    'interaction_type', 'like',
                    'target_entity_type', v_target_entity_type,
                    'target_entity_id', v_target_entity_id,
                    'removed', true,
                    'original_points_awarded', coalesce(v_existing.points_awarded, 0)
                ) || coalesce(p_metadata, '{}'::jsonb),
                v_user_id
            );

            v_balance_after := coalesce(v_ledger.balance_after, 0);
                        delete from public.social_interactions as si
                        where si.profile_id = v_user_id
                            and si.target_entity_type = v_target_entity_type
                            and si.target_entity_id = v_target_entity_id
                            and (
                                        lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
                                        or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                            );

                        select *
                        into v_summary
                        from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

                        return query
                        select
                                v_existing.id,
                                false,
                                -abs(v_points),
                                coalesce(v_balance_after, 0),
                                coalesce(v_summary.like_count, 0),
                                coalesce(v_summary.share_count, 0),
                                coalesce(v_summary.viewer_has_liked, false),
                                coalesce(v_summary.viewer_has_shared, false);
                        return;
                end if;

                -- Stale/orphan like row: remove it and continue through the create-like path
                -- so the current click still ends in a liked state.
                delete from public.social_interactions as si
                where si.profile_id = v_user_id
                    and si.target_entity_type = v_target_entity_type
                    and si.target_entity_id = v_target_entity_id
                    and (
                                lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
                                or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                    );
    end if;

    v_points := public.get_rule_points_value('like');

    execute format(
        'insert into public.social_interactions (
            profile_id,
            %I,
            target_entity_type,
            target_entity_id,
            metadata,
            points_awarded,
            points_awarded_at
         )
         values ($1, $2, $3, $4, $5, $6, now())
         returning *',
        v_interaction_column
    )
    into v_existing
    using v_user_id,
          'like',
          v_target_entity_type,
          v_target_entity_id,
          coalesce(p_metadata, '{}'::jsonb),
          v_points;

    v_ledger := public.apply_points_event(
        v_user_id,
        'interaction_like',
        v_points,
        v_target_entity_type,
        v_target_entity_id,
        '',
        jsonb_build_object(
            'interaction_id', v_existing.id,
            'interaction_type', 'like',
            'target_entity_type', v_target_entity_type,
            'target_entity_id', v_target_entity_id,
            'created', true
        ) || coalesce(p_metadata, '{}'::jsonb),
        v_user_id
    );

    select *
    into v_summary
    from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

    return query
    select
        v_existing.id,
        true,
        v_points,
        coalesce(v_ledger.balance_after, 0),
        coalesce(v_summary.like_count, 0),
        coalesce(v_summary.share_count, 0),
        coalesce(v_summary.viewer_has_liked, false),
        coalesce(v_summary.viewer_has_shared, false);
end;
$$;

grant execute on function public.toggle_like_interaction(text, text, jsonb) to authenticated;

-- Keep only the newest active like row per profile/target. Reruns are safe.
with ranked_like_rows as (
    select
        si.id,
        row_number() over (
            partition by si.profile_id, si.target_entity_type, si.target_entity_id
            order by si.created_at desc, si.id desc
        ) as row_number
    from public.social_interactions as si
    where si.target_entity_type in ('poi', 'item', 'contributor')
      and (
            lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
            or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
      )
)
delete from public.social_interactions as si
using ranked_like_rows as ranked
where si.id = ranked.id
  and ranked.row_number > 1;

-- Align each user's net like points with their surviving active likes.
do $$
declare
    row_record record;
    points_delta integer;
    v_like_points integer := public.get_rule_points_value('like');
begin
    for row_record in
        with active_likes as (
            select
                si.profile_id,
                count(*)::integer as active_like_count
            from public.social_interactions as si
            where si.target_entity_type in ('poi', 'item', 'contributor')
              and (
                    lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
                    or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
              )
            group by si.profile_id
        ),
        like_ledger as (
            select
                pel.profile_id,
                coalesce(sum(pel.points_delta), 0)::integer as net_like_points
            from public.point_events_ledger as pel
            where pel.action_code in (
                'interaction_like',
                'interaction_like_removed',
                'interaction_like_state_reconciliation'
            )
            group by pel.profile_id
        ),
        profiles_with_like_history as (
            select profile_id from active_likes
            union
            select pel.profile_id
            from public.point_events_ledger as pel
            where pel.action_code in (
                'interaction_like',
                'interaction_like_removed',
                'interaction_like_state_reconciliation'
            )
        )
        select
            p.profile_id,
            coalesce(al.active_like_count, 0) as active_like_count,
            coalesce(ll.net_like_points, 0) as net_like_points,
            coalesce(al.active_like_count, 0) * v_like_points as expected_like_points
        from profiles_with_like_history as p
        left join active_likes as al
            on al.profile_id = p.profile_id
        left join like_ledger as ll
            on ll.profile_id = p.profile_id
        where coalesce(al.active_like_count, 0) * v_like_points <> coalesce(ll.net_like_points, 0)
    loop
        points_delta := coalesce(row_record.expected_like_points, 0) - coalesce(row_record.net_like_points, 0);

        if points_delta <> 0 then
            perform public.apply_points_event(
                row_record.profile_id,
                'interaction_like_state_reconciliation',
                points_delta,
                'reconciliation',
                row_record.profile_id::text,
                'Align net like points with surviving active likes.',
                jsonb_build_object(
                    'reconciliation_type', 'active_like_state_alignment',
                    'active_like_count', row_record.active_like_count,
                    'expected_like_points', row_record.expected_like_points,
                    'previous_net_like_points', row_record.net_like_points,
                    'points_per_like', v_like_points
                ),
                null
            );
        end if;
    end loop;
end;
$$;