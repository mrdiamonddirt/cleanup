-- Fix leaderboard bmc_points to use bmac_contributions table only.
--
-- The previous migrations sourced bmc_points from profiles.supporter_points, but
-- supporter_points accumulates ALL point events including social interactions
-- (interaction_like, interaction_share, comment_approved). This caused activity
-- points to be counted twice in the leaderboard total: once from raw like/share/comment
-- counts × rule weights, and again via bmc_points.
--
-- The bmac_contributions table is the authoritative source for actual BMAC donations.
-- All other point sources (interactions, comments, FB bonus) are handled separately.
--
-- Preserves the "support-only users" behaviour from leaderboard_include_support_only_users:
-- users with BMAC donations but no social interactions still appear in the result set.

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
        -- BMAC support points sourced exclusively from bmac_contributions.
        -- This avoids including social interaction points (interaction_like,
        -- interaction_share, comment_approved) that are also written to
        -- profiles.supporter_points via apply_points_event.
        select
            bc.profile_id::text            as entity_id,
            sum(bc.points_awarded)::bigint as bmc_points
        from public.bmac_contributions as bc
        group by bc.profile_id
    ),
    all_entities as (
        -- Union all sources so BMAC-only users (no interactions/comments) are included.
        select entity_type, entity_id from interaction_totals
        union
        select entity_type, entity_id from comment_counts
        union
        select 'user'::text as entity_type, bt.entity_id
        from bmc_totals as bt
    )
    select
        ae.entity_type,
        ae.entity_id,
        coalesce(it.like_count,    0)::bigint                           as like_count,
        coalesce(it.share_count,   0)::bigint                           as share_count,
        coalesce(cc.comment_count, 0)::bigint                           as comment_count,
        case
            when ae.entity_type = 'user'
            then coalesce(bt.bmc_points, 0)::bigint
            else 0::bigint
        end                                                              as bmc_points,
        (
            coalesce(it.like_count,    0) +
            coalesce(it.share_count,   0) +
            coalesce(cc.comment_count, 0) +
            case
                when ae.entity_type = 'user' then coalesce(bt.bmc_points, 0)
                else 0
            end
        )::bigint                                                        as total_count
    from all_entities as ae
    left join interaction_totals as it
        on  it.entity_type = ae.entity_type
        and it.entity_id   = ae.entity_id
    left join comment_counts as cc
        on  cc.entity_type = ae.entity_type
        and cc.entity_id   = ae.entity_id
    left join bmc_totals as bt
        on  ae.entity_type = 'user'
        and bt.entity_id   = ae.entity_id;
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
