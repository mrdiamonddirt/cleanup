create table if not exists public.app_owner_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    github_login text,
    email text,
    created_at timestamptz not null default now()
);

alter table public.app_owner_accounts enable row level security;

grant select on public.app_owner_accounts to authenticated;

drop policy if exists "app_owner_accounts_select_self" on public.app_owner_accounts;
create policy "app_owner_accounts_select_self"
    on public.app_owner_accounts
    for select
    using (auth.uid() = user_id);

create or replace function public.is_app_owner(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.app_owner_accounts
        where user_id = check_user_id
    );
$$;

grant execute on function public.is_app_owner(uuid) to anon;
grant execute on function public.is_app_owner(uuid) to authenticated;

drop policy if exists "profiles_update_owner_admin" on public.profiles;
create policy "profiles_update_owner_admin"
    on public.profiles
    for update
    using (public.is_app_owner(auth.uid()))
    with check (public.is_app_owner(auth.uid()));
