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
    v_points integer;
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
         from public.social_interactions
         where profile_id = $1
           and %I = $2
           and target_entity_type = $3
           and target_entity_id = $4
         limit 1
         for update',
        v_interaction_column
    )
    into v_existing
    using v_user_id, 'like', v_target_entity_type, v_target_entity_id;

    if found then
        v_points := coalesce(v_existing.points_awarded, public.get_rule_points_value('like'));

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

        delete from public.social_interactions
        where id = v_existing.id;

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

create or replace function public.get_social_leaderboard_counts()
returns table (
    entity_type   text,
    entity_id     text,
    like_count    bigint,
    share_count   bigint,
    comment_count bigint,
    bmc_points    bigint,
    total_count   bigint
)
language sql
security definer
set search_path = public
as $$
    with normalized_interactions as (
        select
            si.target_entity_type,
            si.target_entity_id,
            si.profile_id,
            case
                when lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) in ('like', 'share')
                    then lower(trim(coalesce(to_jsonb(si)->>'interaction_type', '')))
                when lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
                    then 'like'
                when lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('share', 'interaction_share')
                    then 'share'
                else null
            end as interaction_kind
        from public.social_interactions as si
    ),
    interaction_totals as (
        select
            ni.target_entity_type as entity_type,
            ni.target_entity_id   as entity_id,
            count(*) filter (where ni.interaction_kind = 'like')::bigint  as like_count,
            count(*) filter (where ni.interaction_kind = 'share')::bigint as share_count
        from normalized_interactions as ni
        where ni.target_entity_type in ('item', 'poi', 'contributor')
        group by ni.target_entity_type, ni.target_entity_id

        union all

        select
            'user'::text        as entity_type,
            ni.profile_id::text as entity_id,
            count(*) filter (where ni.interaction_kind = 'like')::bigint  as like_count,
            count(*) filter (where ni.interaction_kind = 'share')::bigint as share_count
        from normalized_interactions as ni
        group by ni.profile_id
    ),
    comment_counts as (
        select
            c.target_entity_type as entity_type,
            c.target_entity_id   as entity_id,
            count(*)::bigint     as comment_count
        from public.comments as c
        where c.status = 'approved'
          and c.target_entity_type in ('item', 'poi', 'contributor')
        group by c.target_entity_type, c.target_entity_id

        union all

        select
            'user'::text       as entity_type,
            c.profile_id::text as entity_id,
            count(*)::bigint   as comment_count
        from public.comments as c
        where c.status = 'approved'
        group by c.profile_id
    ),
    bmc_totals as (
        select
            bc.profile_id::text as entity_id,
            sum(bc.points_awarded)::bigint as bmc_points
        from public.bmac_contributions as bc
        group by bc.profile_id
    )
    select
        coalesce(it.entity_type, cc.entity_type) as entity_type,
        coalesce(it.entity_id, cc.entity_id) as entity_id,
        coalesce(it.like_count, 0)::bigint as like_count,
        coalesce(it.share_count, 0)::bigint as share_count,
        coalesce(cc.comment_count, 0)::bigint as comment_count,
        case
            when coalesce(it.entity_type, cc.entity_type) = 'user'
            then coalesce(bt.bmc_points, 0)::bigint
            else 0::bigint
        end as bmc_points,
        (
            coalesce(it.like_count, 0) +
            coalesce(it.share_count, 0) +
            coalesce(cc.comment_count, 0) +
            case
                when coalesce(it.entity_type, cc.entity_type) = 'user'
                then coalesce(bt.bmc_points, 0)
                else 0
            end
        )::bigint as total_count
    from interaction_totals as it
    full outer join comment_counts as cc
        on cc.entity_type = it.entity_type
       and cc.entity_id = it.entity_id
    left join bmc_totals as bt
        on coalesce(it.entity_type, cc.entity_type) = 'user'
       and bt.entity_id = coalesce(it.entity_id, cc.entity_id);
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
