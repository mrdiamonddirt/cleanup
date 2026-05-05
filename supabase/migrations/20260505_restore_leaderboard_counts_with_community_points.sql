drop function if exists public.get_social_leaderboard_counts();

create function public.get_social_leaderboard_counts()
returns table (
    entity_type      text,
    entity_id        text,
    like_count       bigint,
    share_count      bigint,
    comment_count    bigint,
    bmc_points       bigint,
    community_points bigint,
    total_count      bigint
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
            ni.target_entity_id as entity_id,
            count(*) filter (where ni.interaction_kind = 'like')::bigint as like_count,
            count(*) filter (where ni.interaction_kind = 'share')::bigint as share_count
        from normalized_interactions as ni
        where ni.target_entity_type in ('item', 'poi', 'contributor')
        group by ni.target_entity_type, ni.target_entity_id

        union all

        select
            'user'::text as entity_type,
            ni.profile_id::text as entity_id,
            count(*) filter (where ni.interaction_kind = 'like')::bigint as like_count,
            count(*) filter (where ni.interaction_kind = 'share')::bigint as share_count
        from normalized_interactions as ni
        group by ni.profile_id
    ),
    comment_counts as (
        select
            c.target_entity_type as entity_type,
            c.target_entity_id as entity_id,
            count(*)::bigint as comment_count
        from public.comments as c
        where c.status = 'approved'
          and c.target_entity_type in ('item', 'poi', 'contributor')
        group by c.target_entity_type, c.target_entity_id

        union all

        select
            'user'::text as entity_type,
            c.profile_id::text as entity_id,
            count(*)::bigint as comment_count
        from public.comments as c
        where c.status = 'approved'
        group by c.profile_id
    ),
    supporter_points_totals as (
        select
            p.id::text as entity_id,
            coalesce(p.supporter_points, 0)::bigint as supporter_points
        from public.profiles as p
    ),
    community_points_totals as (
        select
            pel.profile_id::text as entity_id,
            coalesce(sum(pel.points_delta), 0)::bigint as community_points
        from public.point_events_ledger as pel
        where pel.action_code = 'community_award'
        group by pel.profile_id
    ),
    entity_keys as (
        select it.entity_type, it.entity_id
        from interaction_totals as it

        union

        select cc.entity_type, cc.entity_id
        from comment_counts as cc

        union

        select 'user'::text as entity_type, sp.entity_id
        from supporter_points_totals as sp

        union

        select 'user'::text as entity_type, cp.entity_id
        from community_points_totals as cp
    )
    select
        ek.entity_type as entity_type,
        ek.entity_id as entity_id,
        coalesce(it.like_count, 0)::bigint as like_count,
        coalesce(it.share_count, 0)::bigint as share_count,
        coalesce(cc.comment_count, 0)::bigint as comment_count,
        case
            when ek.entity_type = 'user'
                then greatest(
                    coalesce(sp.supporter_points, 0) - coalesce(cp.community_points, 0),
                    0
                )::bigint
            else 0::bigint
        end as bmc_points,
        case
            when ek.entity_type = 'user'
                then coalesce(cp.community_points, 0)::bigint
            else 0::bigint
        end as community_points,
        (
            coalesce(it.like_count, 0) +
            coalesce(it.share_count, 0) +
            coalesce(cc.comment_count, 0) +
            case
                when ek.entity_type = 'user'
                    then coalesce(sp.supporter_points, 0)
                else 0
            end
        )::bigint as total_count
    from entity_keys as ek
    left join interaction_totals as it
        on it.entity_type = ek.entity_type
       and it.entity_id = ek.entity_id
    left join comment_counts as cc
        on cc.entity_type = ek.entity_type
       and cc.entity_id = ek.entity_id
    left join supporter_points_totals as sp
        on ek.entity_type = 'user'
       and sp.entity_id = ek.entity_id
    left join community_points_totals as cp
        on ek.entity_type = 'user'
       and cp.entity_id = ek.entity_id;
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
