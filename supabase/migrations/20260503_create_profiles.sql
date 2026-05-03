create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default '',
    avatar_url text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
    on public.profiles
    for select
    using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
    on public.profiles
    for insert
    with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles
    for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

create or replace function public.profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'profiles_set_updated_at_trigger'
          and tgrelid = 'public.profiles'::regclass
    ) then
        create trigger profiles_set_updated_at_trigger
            before update on public.profiles
            for each row
            execute procedure public.profiles_set_updated_at();
    end if;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'login'), ''),
            ''
        ),
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
            ''
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'on_auth_user_created_profile'
          and tgrelid = 'auth.users'::regclass
    ) then
        create trigger on_auth_user_created_profile
            after insert on auth.users
            for each row
            execute procedure public.handle_new_user_profile();
    end if;
end;
$$;

insert into public.profiles (id, display_name, avatar_url)
select
    u.id,
    coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'user_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'login'), ''),
        ''
    ),
    coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'avatar_url'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'picture'), ''),
        ''
    )
from auth.users as u
on conflict (id) do nothing;
