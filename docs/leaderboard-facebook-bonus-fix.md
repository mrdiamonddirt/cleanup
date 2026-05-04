# Leaderboard Facebook Bonus Double-Count Fix

## What this fixes

- Prevents future double-counting of Facebook group bonus points.
- Reconciles legacy balances where Facebook bonus was already persisted into `profiles.supporter_points`.
- Keeps ledger history consistent by using compensating point events.

## Migration

Apply:

- `supabase/migrations/20260504_fix_facebook_bonus_double_count.sql`

The migration does two things:

1. Replaces `set_facebook_group_membership_with_bonus(...)` so membership updates no longer call `apply_points_event(...)` for `facebook_group_join_bonus`.
2. Reconciles existing data by inserting compensating ledger events with action code `facebook_group_bonus_reconciliation`.

## Staging checklist

1. Capture pre-migration snapshot.
2. Apply migration.
3. Validate totals and ranking deltas.
4. Validate Sandra expected total.
5. Smoke test admin flow for membership toggles.

## Production checklist

1. Repeat pre-migration snapshot queries.
2. Apply migration.
3. Re-run validation queries.
4. Check leaderboard UI rows for top Facebook members.

## Validation queries

### 1) Profiles that have historical FB bonus ledger entries

```sql
select
  profile_id,
  sum(points_delta) as facebook_bonus_points
from public.point_events_ledger
where action_code = 'facebook_group_join_bonus'
group by profile_id
having sum(points_delta) <> 0
order by facebook_bonus_points desc;
```

### 2) Reconciliation events created by migration

```sql
select
  count(*) as reconciliation_events,
  coalesce(sum(-points_delta), 0) as total_points_removed
from public.point_events_ledger
where action_code = 'facebook_group_bonus_reconciliation';
```

### 3) Sanity check: every affected profile got matching compensation

```sql
with fb as (
  select profile_id, coalesce(sum(points_delta), 0) as fb_points
  from public.point_events_ledger
  where action_code = 'facebook_group_join_bonus'
  group by profile_id
),
recon as (
  select profile_id, coalesce(sum(-points_delta), 0) as reconciled_points
  from public.point_events_ledger
  where action_code = 'facebook_group_bonus_reconciliation'
  group by profile_id
)
select
  fb.profile_id,
  fb.fb_points,
  coalesce(recon.reconciled_points, 0) as reconciled_points,
  fb.fb_points - coalesce(recon.reconciled_points, 0) as mismatch
from fb
left join recon on recon.profile_id = fb.profile_id
where fb.fb_points <> coalesce(recon.reconciled_points, 0)
order by mismatch desc;
```

Expected result: zero rows.

### 4) Sandra verification (replace filter if needed)

```sql
with sandy as (
  select id, display_name, is_facebook_group_member
  from public.profiles
  where lower(display_name) like '%sandra%'
),
counts as (
  select
    s.id,
    coalesce(sum(case when si.interaction_type = 'like' then 1 else 0 end), 0) as likes,
    coalesce(sum(case when si.interaction_type = 'share' then 1 else 0 end), 0) as shares,
    (
      select count(*)
      from public.comments c
      where c.profile_id = s.id
        and c.status = 'approved'
    ) as comments,
    (
      select coalesce(p.supporter_points, 0)
      from public.profiles p
      where p.id = s.id
    ) as supporter_points,
    s.is_facebook_group_member
  from sandy s
  left join public.social_interactions si on si.profile_id = s.id
  group by s.id, s.is_facebook_group_member
)
select
  id,
  likes,
  shares,
  comments,
  supporter_points,
  case when is_facebook_group_member then 100 else 0 end as fb_bonus,
  (likes * 1) + (shares * 5) + (comments * 5) + supporter_points +
    (case when is_facebook_group_member then 100 else 0 end) as expected_total
from counts;
```

Expected for Sandra: `expected_total = 2100`.

## UI validation

In leaderboard modal:

- Top Facebook users previously showing extra +100 should drop by 100.
- Support and FB bonus columns should sum cleanly into total.
- No changes expected for users without Facebook bonus history.
