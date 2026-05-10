# Like + Leaderboard Reconciliation Runbook

## Purpose

This runbook validates and deploys the fix for:

- Like-toggle state/summary parsing hardening in the client.
- Like-toggle RPC hardening so item, POI, and contributor toggles return a deterministic final liked state.
- Historical like-row deduplication and like-point reconciliation.
- Leaderboard BMAC source correction (BMAC from `bmac_contributions` only).
- Historical balance reconciliation where `profiles.supporter_points` drifted from ledger snapshots.

## Migration

Apply:

- `supabase/migrations/20260510_fix_like_toggle_state_and_reconcile.sql`

## Pre-Deployment Checks

```sql
-- 1) Profiles whose supporter_points currently differ from latest ledger balance_after.
with latest_ledger as (
  select distinct on (profile_id)
    profile_id,
    balance_after
  from public.point_events_ledger
  order by profile_id, created_at desc, id desc
)
select
  p.id as profile_id,
  coalesce(p.supporter_points, 0) as profile_balance,
  coalesce(ll.balance_after, 0) as ledger_balance,
  coalesce(ll.balance_after, 0) - coalesce(p.supporter_points, 0) as delta
from public.profiles p
join latest_ledger ll on ll.profile_id = p.id
where coalesce(p.supporter_points, 0) <> coalesce(ll.balance_after, 0)
order by abs(coalesce(ll.balance_after, 0) - coalesce(p.supporter_points, 0)) desc;
```

```sql
-- 2) Duplicate active like rows that should be cleaned up by the migration.
with ranked_like_rows as (
  select
    si.profile_id,
    si.target_entity_type,
    si.target_entity_id,
    row_number() over (
      partition by si.profile_id, si.target_entity_type, si.target_entity_id
      order by si.created_at desc, si.id desc
    ) as row_number
  from public.social_interactions si
  where si.target_entity_type in ('poi', 'item', 'contributor')
    and (
      lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
      or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
    )
)
select *
from ranked_like_rows
where row_number > 1;
```

```sql
-- 3) Profiles whose net like points disagree with surviving active likes.
with active_likes as (
  select
    si.profile_id,
    count(*)::integer as active_like_count
  from public.social_interactions si
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
  from public.point_events_ledger pel
  where pel.action_code in (
    'interaction_like',
    'interaction_like_removed',
    'interaction_like_state_reconciliation'
  )
  group by pel.profile_id
)
select
  coalesce(al.profile_id, ll.profile_id) as profile_id,
  coalesce(al.active_like_count, 0) as active_like_count,
  coalesce(ll.net_like_points, 0) as net_like_points
from active_likes al
full outer join like_ledger ll on ll.profile_id = al.profile_id
where coalesce(al.active_like_count, 0) <> coalesce(ll.net_like_points, 0);
```

```sql
-- 4) Current BMAC points by contribution table (source of truth).
select
  profile_id,
  coalesce(sum(points_awarded), 0) as bmc_points
from public.bmac_contributions
group by profile_id
order by bmc_points desc;
```

## Post-Deployment Checks

```sql
-- 1) Balance drift should be zero rows after reconciliation.
with latest_ledger as (
  select distinct on (profile_id)
    profile_id,
    balance_after
  from public.point_events_ledger
  order by profile_id, created_at desc, id desc
)
select
  p.id as profile_id,
  p.supporter_points as profile_balance,
  ll.balance_after as ledger_balance
from public.profiles p
join latest_ledger ll on ll.profile_id = p.id
where coalesce(p.supporter_points, 0) <> coalesce(ll.balance_after, 0);
```

```sql
-- 2) Like-state reconciliation events inserted by this migration.
select
  count(*) as reconciliation_events,
  coalesce(sum(points_delta), 0) as net_delta
from public.point_events_ledger
where action_code = 'interaction_like_state_reconciliation';
```

```sql
-- 3) Duplicate active like rows should now be zero.
with ranked_like_rows as (
  select
    si.profile_id,
    si.target_entity_type,
    si.target_entity_id,
    row_number() over (
      partition by si.profile_id, si.target_entity_type, si.target_entity_id
      order by si.created_at desc, si.id desc
    ) as row_number
  from public.social_interactions si
  where si.target_entity_type in ('poi', 'item', 'contributor')
    and (
      lower(trim(coalesce(to_jsonb(si)->>'interaction_type', ''))) = 'like'
      or lower(trim(coalesce(to_jsonb(si)->>'action_type', ''))) in ('like', 'interaction_like')
    )
)
select *
from ranked_like_rows
where row_number > 1;
```

```sql
-- 4) Reconciliation events inserted by the earlier balance-alignment migration, if applied.
select
  count(*) as reconciliation_events,
  coalesce(sum(points_delta), 0) as net_delta
from public.point_events_ledger
where action_code = 'supporter_points_reconciliation';
```

```sql
-- 5) Validate leaderboard BMAC values now match bmac_contributions sums.
with rpc_rows as (
  select entity_id as profile_id, bmc_points
  from public.get_social_leaderboard_counts()
  where entity_type = 'user'
),
bmc_sums as (
  select profile_id::text as profile_id, coalesce(sum(points_awarded), 0)::bigint as expected_bmc
  from public.bmac_contributions
  group by profile_id
)
select
  r.profile_id,
  coalesce(r.bmc_points, 0) as rpc_bmc,
  coalesce(b.expected_bmc, 0) as expected_bmc,
  coalesce(r.bmc_points, 0) - coalesce(b.expected_bmc, 0) as mismatch
from rpc_rows r
left join bmc_sums b on b.profile_id = r.profile_id
where coalesce(r.bmc_points, 0) <> coalesce(b.expected_bmc, 0)
order by abs(coalesce(r.bmc_points, 0) - coalesce(b.expected_bmc, 0)) desc;
```

Expected: zero rows.

## Functional Smoke Test

1. Sign in and open one POI, one contributor, and one item.
2. Toggle like on each target:
   - First click should add like and show `Liked. +N points.`
   - Second click should remove like and show `Like removed. -N points.`
  - The button state and count should flip immediately on every click.
3. Reopen leaderboard modal and confirm:
   - Like/share/comment totals update.
   - BMAC column does not fluctuate from like toggles.
4. Refresh page and confirm interaction state persists.
