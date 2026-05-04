alter table if exists public.profiles
    add column if not exists auth_provider text not null default 'unknown';

update public.profiles
set auth_provider = 'unknown'
where coalesce(trim(auth_provider), '') = '';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'profiles_auth_provider_not_blank_check'
          and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles
            add constraint profiles_auth_provider_not_blank_check
                check (length(trim(auth_provider)) > 0);
    end if;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_auth_provider text := coalesce(
        nullif(lower(trim(new.raw_app_meta_data ->> 'provider')), ''),
        'unknown'
    );
begin
    insert into public.profiles (id, display_name, avatar_url, auth_provider)
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
        ),
        v_auth_provider
    )
    on conflict (id) do update
    set auth_provider = excluded.auth_provider;

    perform public.sync_profile_private_email(new.id, new.email);

    return new;
end;
$$;

update public.profiles as p
set auth_provider = coalesce(
    nullif(lower(trim(u.raw_app_meta_data ->> 'provider')), ''),
    'unknown'
)
from auth.users as u
where u.id = p.id
  and (
      coalesce(trim(p.auth_provider), '') = ''
      or lower(trim(p.auth_provider)) = 'unknown'
  );
