-- Guard like toggles so only previously awarded likes can be deducted.
-- This prevents orphan interaction rows from causing negative supporter point drift.

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
          and coalesce(pel.metadata->>'interaction_id', '') = v_existing.id::text
        order by pel.created_at desc, pel.id desc
        limit 1;

        if not found then
            -- Orphan interaction row with no original like award. Remove it without deducting points.
                        delete from public.social_interactions as si
                        where si.profile_id = v_user_id
                            and si.target_entity_type = v_target_entity_type
                            and si.target_entity_id = v_target_entity_id
                            and (
                                        lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
                                        or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                            );

            select coalesce(p.supporter_points, 0)
            into v_balance_after
            from public.profiles as p
            where p.id = v_user_id;

            select *
            into v_summary
            from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

            return query
            select
                v_existing.id,
                false,
                0,
                coalesce(v_balance_after, 0),
                coalesce(v_summary.like_count, 0),
                coalesce(v_summary.share_count, 0),
                coalesce(v_summary.viewer_has_liked, false),
                coalesce(v_summary.viewer_has_shared, false);
            return;
        end if;

        v_points := abs(coalesce(v_existing.points_awarded, v_like_award.points_delta, 0));

        if v_points <= 0 then
                        delete from public.social_interactions as si
                        where si.profile_id = v_user_id
                            and si.target_entity_type = v_target_entity_type
                            and si.target_entity_id = v_target_entity_id
                            and (
                                        lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
                                        or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                            );

            select coalesce(p.supporter_points, 0)
            into v_balance_after
            from public.profiles as p
            where p.id = v_user_id;

            select *
            into v_summary
            from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

            return query
            select
                v_existing.id,
                false,
                0,
                coalesce(v_balance_after, 0),
                coalesce(v_summary.like_count, 0),
                coalesce(v_summary.share_count, 0),
                coalesce(v_summary.viewer_has_liked, false),
                coalesce(v_summary.viewer_has_shared, false);
            return;
        end if;

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
            coalesce(v_ledger.balance_after, 0),
            coalesce(v_summary.like_count, 0),
            coalesce(v_summary.share_count, 0),
            coalesce(v_summary.viewer_has_liked, false),
            coalesce(v_summary.viewer_has_shared, false);
        return;
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
