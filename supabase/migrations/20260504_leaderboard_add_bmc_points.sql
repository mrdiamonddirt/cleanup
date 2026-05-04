-- Drop and recreate the leaderboard RPC to include BMC (Buy Me a Coffee) support points.
-- For user entities, bmc_points is the sum of points_awarded from bmac_contributions.
-- The total_count now sums likes + shares + approved comments + bmc points.

drop function if exists public.get_social_leaderboard_counts();

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
    with interaction_totals as (
        -- Likes and shares per target entity (item, poi, contributor)
        select
            si.target_entity_type as entity_type,
            si.target_entity_id   as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint  as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count
        from public.social_interactions as si
        where si.target_entity_type in ('item', 'poi', 'contributor')
        group by si.target_entity_type, si.target_entity_id

        union all

        -- Likes and shares attributed to the user who performed them
        select
            'user'::text          as entity_type,
            si.profile_id::text   as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint  as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count
        from public.social_interactions as si
        group by si.profile_id
    ),
    comment_counts as (
        -- Approved comments per target entity
        select
            c.target_entity_type as entity_type,
            c.target_entity_id   as entity_id,
            count(*)::bigint     as comment_count
        from public.comments as c
        where c.status = 'approved'
          and c.target_entity_type in ('item', 'poi', 'contributor')
        group by c.target_entity_type, c.target_entity_id

        union all

        -- Approved comments attributed to the user who wrote them
        select
            'user'::text        as entity_type,
            c.profile_id::text  as entity_id,
            count(*)::bigint    as comment_count
        from public.comments as c
        where c.status = 'approved'
        group by c.profile_id
    ),
    bmc_totals as (
        -- BMC (Buy Me a Coffee) support points per user
        select
            bc.profile_id::text  as entity_id,
            sum(bc.points_awarded)::bigint as bmc_points
        from public.bmac_contributions as bc
        group by bc.profile_id
    )
    -- Full outer join so entities with only comments (or only interactions) are included.
    -- Left join bmc_totals on user rows only.
    select
        coalesce(it.entity_type, cc.entity_type)                        as entity_type,
        coalesce(it.entity_id,   cc.entity_id)                          as entity_id,
        coalesce(it.like_count,    0)::bigint                           as like_count,
        coalesce(it.share_count,   0)::bigint                           as share_count,
        coalesce(cc.comment_count, 0)::bigint                           as comment_count,
        case
            when coalesce(it.entity_type, cc.entity_type) = 'user'
            then coalesce(bt.bmc_points, 0)::bigint
            else 0::bigint
        end                                                              as bmc_points,
        (
            coalesce(it.like_count,    0) +
            coalesce(it.share_count,   0) +
            coalesce(cc.comment_count, 0) +
            case
                when coalesce(it.entity_type, cc.entity_type) = 'user'
                then coalesce(bt.bmc_points, 0)
                else 0
            end
        )::bigint                                                        as total_count
    from interaction_totals it
    full outer join comment_counts cc
        on  cc.entity_type = it.entity_type
        and cc.entity_id   = it.entity_id
    left join bmc_totals bt
        on  coalesce(it.entity_type, cc.entity_type) = 'user'
        and bt.entity_id = coalesce(it.entity_id, cc.entity_id);
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
