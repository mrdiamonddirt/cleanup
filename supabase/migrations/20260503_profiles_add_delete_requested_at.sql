-- Add soft-delete / 30-day grace period support to public.profiles.
--
-- When a user requests account deletion the app sets delete_requested_at to
-- the current timestamp.  A pg_cron job (scheduled below) permanently deletes
-- the auth.users row (which cascades to profiles via ON DELETE CASCADE) for
-- any account whose delete_requested_at is older than 30 days.
--
-- Users can cancel a pending deletion at any time before those 30 days elapse
-- by setting delete_requested_at back to NULL.

alter table public.profiles
    add column if not exists delete_requested_at timestamptz default null;

-- Allow the row-owner to update delete_requested_at via the existing
-- profiles_update_own policy (covers all columns).  No new policy needed.

-- ---------------------------------------------------------------------------
-- pg_cron job: permanently delete accounts after 30-day grace period.
--
-- Requires the pg_cron extension to be enabled on your Supabase project
-- (Database → Extensions → pg_cron).  If pg_cron is not available, accounts
-- can be cleaned up manually or via a Supabase Edge Function cron trigger.
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1
        from pg_extension
        where extname = 'pg_cron'
    ) then
        -- Remove any previous version of this job before re-creating it so
        -- the migration is safe to re-run.
        perform cron.unschedule('delete-requested-accounts')
            where exists (
                select 1 from cron.job where jobname = 'delete-requested-accounts'
            );

        -- Runs at 02:00 UTC every day.
        perform cron.schedule(
            'delete-requested-accounts',
            '0 2 * * *',
            $$
                delete from auth.users
                where id in (
                    select id
                    from public.profiles
                    where delete_requested_at is not null
                      and delete_requested_at < now() - interval '30 days'
                );
            $$
        );
    end if;
end;
$$;
