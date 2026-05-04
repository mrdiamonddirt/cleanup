-- Ensure leaderboard RPC includes users who only have support points.
--
-- Without this, users with `profiles.supporter_points` but no likes/shares/comments
-- are absent from RPC output and can appear as zero in the UI.

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
        select
            si.target_entity_type as entity_type,
            si.target_entity_id   as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint  as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count
        from public.social_interactions as si
        where si.target_entity_type in ('item', 'poi', 'contributor')
        group by si.target_entity_type, si.target_entity_id

        union all

        select
            'user'::text          as entity_type,
            si.profile_id::text   as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint  as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count
        from public.social_interactions as si
        group by si.profile_id
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
            'user'::text        as entity_type,
            c.profile_id::text  as entity_id,
            count(*)::bigint    as comment_count
        from public.comments as c
        where c.status = 'approved'
        group by c.profile_id
    ),
    supporter_points_totals as (
        select
            p.id::text as entity_id,
            coalesce(p.supporter_points, 0)::bigint as bmc_points
        from public.profiles as p
        where coalesce(p.supporter_points, 0) > 0
    ),
    all_entities as (
        select entity_type, entity_id from interaction_totals
        union
        select entity_type, entity_id from comment_counts
        union
        select 'user'::text as entity_type, sp.entity_id
        from supporter_points_totals as sp
    )
    select
        ae.entity_type,
        ae.entity_id,
        coalesce(it.like_count, 0)::bigint as like_count,
        coalesce(it.share_count, 0)::bigint as share_count,
        coalesce(cc.comment_count, 0)::bigint as comment_count,
        case
            when ae.entity_type = 'user' then coalesce(sp.bmc_points, 0)::bigint
            else 0::bigint
        end as bmc_points,
        (
            coalesce(it.like_count, 0) +
            coalesce(it.share_count, 0) +
            coalesce(cc.comment_count, 0) +
            case
                when ae.entity_type = 'user' then coalesce(sp.bmc_points, 0)
                else 0
            end
        )::bigint as total_count
    from all_entities as ae
    left join interaction_totals as it
        on it.entity_type = ae.entity_type
       and it.entity_id = ae.entity_id
    left join comment_counts as cc
        on cc.entity_type = ae.entity_type
       and cc.entity_id = ae.entity_id
    left join supporter_points_totals as sp
        on ae.entity_type = 'user'
       and sp.entity_id = ae.entity_id;
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
