-- Fix leaderboard BMAC source and reconcile historical profile balance drift.
--
-- Why:
-- 1) `bmc_points` should reflect Buy Me A Coffee support only.
--    Deriving BMAC from `profiles.supporter_points` causes social interactions
--    (likes/shares/comments) to appear as support-point changes.
-- 2) Repair historical profile balances when `profiles.supporter_points`
--    diverges from the latest ledger `balance_after`.

create or replace function public.get_social_leaderboard_counts()
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
    bmc_points_totals as (
        select
            bc.profile_id::text as entity_id,
            coalesce(sum(bc.points_awarded), 0)::bigint as bmc_points
        from public.bmac_contributions as bc
        group by bc.profile_id
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

        select 'user'::text as entity_type, bp.entity_id
        from bmc_points_totals as bp

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
                then coalesce(bp.bmc_points, 0)::bigint
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
                    then coalesce(bp.bmc_points, 0) + coalesce(cp.community_points, 0)
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
    left join bmc_points_totals as bp
        on ek.entity_type = 'user'
       and bp.entity_id = ek.entity_id
    left join community_points_totals as cp
        on ek.entity_type = 'user'
       and cp.entity_id = ek.entity_id;
$$;

revoke all on function public.get_social_leaderboard_counts() from public;
grant execute on function public.get_social_leaderboard_counts() to anon;
grant execute on function public.get_social_leaderboard_counts() to authenticated;

-- Reconcile profile supporter balances when they diverge from ledger history.
-- This is idempotent: once aligned, reruns do nothing.
do $$
declare
    row_record record;
    points_delta integer;
begin
    for row_record in
        with latest_ledger as (
            select distinct on (pel.profile_id)
                pel.profile_id,
                pel.balance_after
            from public.point_events_ledger as pel
            order by pel.profile_id, pel.created_at desc, pel.id desc
        )
        select
            p.id as profile_id,
            coalesce(p.supporter_points, 0) as current_balance,
            ll.balance_after as expected_balance
        from public.profiles as p
        join latest_ledger as ll
            on ll.profile_id = p.id
        where coalesce(p.supporter_points, 0) <> coalesce(ll.balance_after, 0)
    loop
        points_delta := coalesce(row_record.expected_balance, 0) - coalesce(row_record.current_balance, 0);

        if points_delta <> 0 then
            perform public.apply_points_event(
                row_record.profile_id,
                'supporter_points_reconciliation',
                points_delta,
                'reconciliation',
                row_record.profile_id::text,
                'Align profile supporter_points with latest ledger balance_after value.',
                jsonb_build_object(
                    'reconciliation_type', 'ledger_balance_alignment',
                    'expected_balance', row_record.expected_balance,
                    'previous_balance', row_record.current_balance
                ),
                null
            );
        end if;
    end loop;
end;
$$;
