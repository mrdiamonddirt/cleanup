create or replace function public.get_social_leaderboard_counts()
returns table (
    entity_type text,
    entity_id text,
    like_count bigint,
    share_count bigint,
    total_count bigint
)
language sql
security definer
set search_path = public
as $$
    with target_totals as (
        select
            si.target_entity_type as entity_type,
            si.target_entity_id as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count,
            count(*)::bigint as total_count
        from public.social_interactions as si
        where si.target_entity_type in ('item', 'poi', 'contributor')
        group by si.target_entity_type, si.target_entity_id
    ),
    user_totals as (
        select
            'user'::text as entity_type,
            si.profile_id::text as entity_id,
            count(*) filter (where si.interaction_type = 'like')::bigint as like_count,
            count(*) filter (where si.interaction_type = 'share')::bigint as share_count,
            count(*)::bigint as total_count
        from public.social_interactions as si
        group by si.profile_id
    )
    select * from target_totals
    union all
    select * from user_totals;
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;
