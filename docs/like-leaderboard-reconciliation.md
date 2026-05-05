# Like + Leaderboard Reconciliation Runbook

## Purpose

This runbook validates and deploys the fix for:

- Like-toggle state/summary parsing hardening in the client.
- Leaderboard BMAC source correction (BMAC from `bmac_contributions` only).
- Historical balance reconciliation where `profiles.supporter_points` drifted from ledger snapshots.

## Migration

Apply:

- `supabase/migrations/20260505_fix_bmc_leaderboard_source_and_reconcile_balances.sql`

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
-- 2) Current BMAC points by contribution table (source of truth).
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
-- 2) Reconciliation events inserted by this migration.
select
  count(*) as reconciliation_events,
  coalesce(sum(points_delta), 0) as net_delta
from public.point_events_ledger
where action_code = 'supporter_points_reconciliation';
```

```sql
-- 3) Validate leaderboard BMAC values now match bmac_contributions sums.
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
3. Reopen leaderboard modal and confirm:
   - Like/share/comment totals update.
   - BMAC column does not fluctuate from like toggles.
4. Refresh page and confirm interaction state persists.
