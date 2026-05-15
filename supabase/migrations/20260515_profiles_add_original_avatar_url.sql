alter table if exists public.profiles
    add column if not exists original_avatar_url text not null default '';

update public.profiles
set original_avatar_url = coalesce(avatar_url, '')
where coalesce(trim(original_avatar_url), '') = '';

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    insert into public.profiles (id, display_name, avatar_url, original_avatar_url)
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

create or replace function public.profiles_preserve_original_avatar_url()
returns trigger
language plpgsql
as $$
begin
    if coalesce(trim(new.original_avatar_url), '') = '' then
        new.original_avatar_url = coalesce(new.avatar_url, '');
    end if;

    return new;
end;
$$;

drop trigger if exists profiles_preserve_original_avatar_url_trigger on public.profiles;
create trigger profiles_preserve_original_avatar_url_trigger
    before insert or update on public.profiles
    for each row
    execute procedure public.profiles_preserve_original_avatar_url();
