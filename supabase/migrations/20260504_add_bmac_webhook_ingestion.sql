create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
    select nullif(lower(trim(coalesce(p_email, ''))), '');
$$;

create table if not exists public.profile_private_emails (
    profile_id uuid primary key references public.profiles (id) on delete cascade,
    email text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profile_private_emails_email_normalized_check check (email = public.normalize_email(email))
);

create unique index if not exists profile_private_emails_email_key
    on public.profile_private_emails (email);

alter table public.profile_private_emails enable row level security;

create or replace function public.sync_profile_private_email(
    p_profile_id uuid,
    p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text := public.normalize_email(p_email);
begin
    if p_profile_id is null then
        raise exception 'Missing profile id';
    end if;

    if v_email is null then
        delete from public.profile_private_emails
        where profile_id = p_profile_id;
        return;
    end if;

    insert into public.profile_private_emails (
        profile_id,
        email
    )
    values (
        p_profile_id,
        v_email
    )
    on conflict (profile_id) do update
    set email = excluded.email,
        updated_at = now();
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

    perform public.sync_profile_private_email(new.id, new.email);

    return new;
end;
$$;

create or replace function public.handle_auth_user_email_changed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    perform public.sync_profile_private_email(new.id, new.email);
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'profile_private_emails_set_updated_at_trigger'
          and tgrelid = 'public.profile_private_emails'::regclass
    ) then
        create trigger profile_private_emails_set_updated_at_trigger
            before update on public.profile_private_emails
            for each row
            execute procedure public.profiles_set_updated_at();
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'on_auth_user_email_changed_profile_private_email'
          and tgrelid = 'auth.users'::regclass
    ) then
        create trigger on_auth_user_email_changed_profile_private_email
            after update of email on auth.users
            for each row
            when (old.email is distinct from new.email)
            execute procedure public.handle_auth_user_email_changed();
    end if;
end;
$$;

insert into public.profile_private_emails (
    profile_id,
    email
)
select
    u.id,
    public.normalize_email(u.email)
from auth.users as u
where public.normalize_email(u.email) is not null
on conflict (profile_id) do update
set email = excluded.email,
    updated_at = now();

alter table public.bmac_contributions
    add column if not exists source_type text not null default 'manual_admin',
    add column if not exists source_key text,
    add column if not exists supporter_email text,
    add column if not exists supporter_name text not null default '',
    add column if not exists raw_payload jsonb not null default '{}'::jsonb,
    add column if not exists processed_at timestamptz not null default now();

update public.bmac_contributions
set source_type = 'manual_admin'
where coalesce(trim(source_type), '') = '';

alter table public.bmac_contributions
    add constraint bmac_contributions_source_type_not_blank_check
        check (length(trim(source_type)) > 0);

alter table public.bmac_contributions
    add constraint bmac_contributions_supporter_email_normalized_check
        check (supporter_email is null or supporter_email = public.normalize_email(supporter_email));

create unique index if not exists bmac_contributions_source_type_source_key_key
    on public.bmac_contributions (source_type, source_key)
    where source_key is not null;

create table if not exists public.bmac_unmatched_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null,
    source_type text not null default 'bmac_webhook',
    source_key text not null,
    supporter_email text,
    supporter_name text not null default '',
    amount_pence integer not null,
    note text not null default '',
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    matched_profile_id uuid references public.profiles (id) on delete set null,
    resolved_contribution_id uuid references public.bmac_contributions (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    constraint bmac_unmatched_events_source_type_not_blank_check check (length(trim(source_type)) > 0),
    constraint bmac_unmatched_events_source_key_not_blank_check check (length(trim(source_key)) > 0),
    constraint bmac_unmatched_events_supporter_email_normalized_check check (supporter_email is null or supporter_email = public.normalize_email(supporter_email)),
    constraint bmac_unmatched_events_amount_pence_check check (amount_pence > 0),
    constraint bmac_unmatched_events_status_check check (status in ('pending', 'resolved', 'ignored'))
);

create unique index if not exists bmac_unmatched_events_source_type_source_key_key
    on public.bmac_unmatched_events (source_type, source_key);

alter table public.bmac_unmatched_events enable row level security;

grant select, update on public.bmac_unmatched_events to authenticated;

drop policy if exists "bmac_unmatched_events_select_owner_admin" on public.bmac_unmatched_events;
create policy "bmac_unmatched_events_select_owner_admin"
    on public.bmac_unmatched_events
    for select
    using (public.is_app_owner(auth.uid()));

drop policy if exists "bmac_unmatched_events_update_owner_admin" on public.bmac_unmatched_events;
create policy "bmac_unmatched_events_update_owner_admin"
    on public.bmac_unmatched_events
    for update
    using (public.is_app_owner(auth.uid()))
    with check (public.is_app_owner(auth.uid()));

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgname = 'bmac_unmatched_events_set_updated_at_trigger'
          and tgrelid = 'public.bmac_unmatched_events'::regclass
    ) then
        create trigger bmac_unmatched_events_set_updated_at_trigger
            before update on public.bmac_unmatched_events
            for each row
            execute procedure public.profiles_set_updated_at();
    end if;
end;
$$;

create or replace function public.create_bmac_contribution(
    p_profile_id uuid,
    p_amount_pence integer,
    p_note text default '',
    p_source_type text default 'manual_admin',
    p_source_key text default null,
    p_supporter_email text default null,
    p_supporter_name text default '',
    p_raw_payload jsonb default '{}'::jsonb,
    p_created_by uuid default auth.uid()
)
returns public.bmac_contributions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_source_type text := trim(coalesce(p_source_type, ''));
    v_source_key text := nullif(trim(coalesce(p_source_key, '')), '');
    v_supporter_email text := public.normalize_email(p_supporter_email);
    v_points_per_penny integer;
    v_points integer;
    v_contribution public.bmac_contributions;
begin
    if p_profile_id is null then
        raise exception 'Missing profile id';
    end if;

    if coalesce(p_amount_pence, 0) <= 0 then
        raise exception 'Contribution amount must be positive';
    end if;

    if v_source_type = '' then
        raise exception 'Missing source type';
    end if;

    perform 1
    from public.profiles
    where id = p_profile_id;

    if not found then
        raise exception 'Profile not found';
    end if;

    if v_source_key is not null then
        select *
        into v_contribution
        from public.bmac_contributions
        where source_type = v_source_type
          and source_key = v_source_key
        limit 1;

        if v_contribution.id is not null then
            return v_contribution;
        end if;
    end if;

    v_points_per_penny := public.get_rule_points_value('bmac_points_per_penny');
    v_points := p_amount_pence * v_points_per_penny;

    insert into public.bmac_contributions (
        profile_id,
        amount_pence,
        points_awarded,
        note,
        created_by,
        source_type,
        source_key,
        supporter_email,
        supporter_name,
        raw_payload,
        processed_at
    )
    values (
        p_profile_id,
        p_amount_pence,
        v_points,
        coalesce(p_note, ''),
        p_created_by,
        v_source_type,
        v_source_key,
        v_supporter_email,
        coalesce(trim(p_supporter_name), ''),
        coalesce(p_raw_payload, '{}'::jsonb),
        now()
    )
    returning * into v_contribution;

    perform public.apply_points_event(
        p_profile_id,
        'bmac_contribution',
        v_points,
        'bmac_contribution',
        v_contribution.id::text,
        coalesce(p_note, ''),
        jsonb_build_object(
            'amount_pence', p_amount_pence,
            'source_type', v_source_type,
            'source_key', v_source_key,
            'supporter_email', v_supporter_email
        ),
        p_created_by
    );

    update public.profiles
    set is_bmc_supporter = true,
        supporter_verified_at = now()
    where id = p_profile_id;

    return v_contribution;
end;
$$;

revoke all on function public.create_bmac_contribution(uuid, integer, text, text, text, text, text, jsonb, uuid) from public;

create or replace function public.record_bmac_contribution_amount(
    p_profile_id uuid,
    p_amount_pence integer,
    p_note text default ''
)
returns public.bmac_contributions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_contribution public.bmac_contributions;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can record bmac contribution amounts';
    end if;

    v_contribution := public.create_bmac_contribution(
        p_profile_id,
        p_amount_pence,
        p_note,
        'manual_admin',
        null,
        null,
        '',
        '{}'::jsonb,
        v_actor_id
    );

    perform public.log_admin_audit(
        'record_bmac_contribution',
        'profiles',
        p_profile_id::text,
        coalesce(p_note, ''),
        '{}'::jsonb,
        jsonb_build_object('amount_pence', p_amount_pence, 'points_awarded', v_contribution.points_awarded),
        jsonb_build_object('contribution_id', v_contribution.id)
    );

    return v_contribution;
end;
$$;

grant execute on function public.record_bmac_contribution_amount(uuid, integer, text) to authenticated;

create or replace function public.ingest_bmac_webhook_event(
    p_event_type text,
    p_source_key text,
    p_supporter_email text,
    p_amount_pence integer,
    p_supporter_name text default '',
    p_note text default '',
    p_payload jsonb default '{}'::jsonb
)
returns table (
    status text,
    contribution_id uuid,
    unmatched_event_id uuid,
    profile_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_source_type text := 'bmac_webhook';
    v_event_type text := trim(coalesce(p_event_type, ''));
    v_source_key text := nullif(trim(coalesce(p_source_key, '')), '');
    v_supporter_email text := public.normalize_email(p_supporter_email);
    v_existing_contribution public.bmac_contributions;
    v_contribution public.bmac_contributions;
    v_unmatched public.bmac_unmatched_events;
    v_profile_id uuid;
begin
    if v_event_type = '' then
        raise exception 'Missing event type';
    end if;

    if v_source_key is null then
        raise exception 'Missing source key';
    end if;

    if coalesce(p_amount_pence, 0) <= 0 then
        raise exception 'Contribution amount must be positive';
    end if;

    select *
    into v_existing_contribution
    from public.bmac_contributions
    where source_type = v_source_type
      and source_key = v_source_key
    limit 1;

    if v_existing_contribution.id is not null then
        return query
        select
            'duplicate',
            v_existing_contribution.id,
            null::uuid,
            v_existing_contribution.profile_id;
        return;
    end if;

    if v_supporter_email is not null then
        select profile_id
        into v_profile_id
        from public.profile_private_emails
        where email = v_supporter_email
        limit 1;
    end if;

    if v_profile_id is null then
        insert into public.bmac_unmatched_events (
            event_type,
            source_type,
            source_key,
            supporter_email,
            supporter_name,
            amount_pence,
            note,
            payload,
            status
        )
        values (
            v_event_type,
            v_source_type,
            v_source_key,
            v_supporter_email,
            coalesce(trim(p_supporter_name), ''),
            p_amount_pence,
            coalesce(p_note, ''),
            coalesce(p_payload, '{}'::jsonb),
            'pending'
        )
        on conflict (source_type, source_key) do update
        set event_type = excluded.event_type,
            supporter_email = excluded.supporter_email,
            supporter_name = excluded.supporter_name,
            amount_pence = excluded.amount_pence,
            note = excluded.note,
            payload = excluded.payload,
            updated_at = now()
        returning * into v_unmatched;

        return query
        select
            'unmatched',
            null::uuid,
            v_unmatched.id,
            null::uuid;
        return;
    end if;

    v_contribution := public.create_bmac_contribution(
        v_profile_id,
        p_amount_pence,
        p_note,
        v_source_type,
        v_source_key,
        v_supporter_email,
        p_supporter_name,
        p_payload,
        null
    );

    update public.bmac_unmatched_events
    set status = 'resolved',
        matched_profile_id = v_profile_id,
        resolved_contribution_id = v_contribution.id,
        resolved_at = now(),
        updated_at = now()
    where source_type = v_source_type
      and source_key = v_source_key;

    return query
    select
        'matched',
        v_contribution.id,
        null::uuid,
        v_profile_id;
end;
$$;

revoke all on function public.ingest_bmac_webhook_event(text, text, text, integer, text, text, jsonb) from public;
grant execute on function public.ingest_bmac_webhook_event(text, text, text, integer, text, text, jsonb) to service_role;

create or replace function public.resolve_bmac_unmatched_event(
    p_unmatched_event_id uuid,
    p_profile_id uuid,
    p_resolution_note text default ''
)
returns public.bmac_contributions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_event public.bmac_unmatched_events;
    v_note text;
    v_contribution public.bmac_contributions;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can resolve bmac unmatched events';
    end if;

    select *
    into v_event
    from public.bmac_unmatched_events
    where id = p_unmatched_event_id
    for update;

    if v_event.id is null then
        raise exception 'Unmatched event not found';
    end if;

    if v_event.status = 'ignored' then
        raise exception 'Ignored events cannot be resolved';
    end if;

    if v_event.status = 'resolved' and v_event.resolved_contribution_id is not null then
        select *
        into v_contribution
        from public.bmac_contributions
        where id = v_event.resolved_contribution_id;

        return v_contribution;
    end if;

    v_note := concat_ws(
        ' | ',
        nullif(trim(v_event.note), ''),
        nullif(trim(p_resolution_note), '')
    );

    v_contribution := public.create_bmac_contribution(
        p_profile_id,
        v_event.amount_pence,
        coalesce(v_note, ''),
        v_event.source_type,
        v_event.source_key,
        v_event.supporter_email,
        v_event.supporter_name,
        v_event.payload,
        v_actor_id
    );

    update public.bmac_unmatched_events
    set status = 'resolved',
        matched_profile_id = p_profile_id,
        resolved_contribution_id = v_contribution.id,
        resolved_at = now(),
        updated_at = now()
    where id = p_unmatched_event_id;

    perform public.log_admin_audit(
        'resolve_bmac_unmatched_event',
        'bmac_unmatched_events',
        p_unmatched_event_id::text,
        coalesce(p_resolution_note, ''),
        jsonb_build_object('status', 'pending'),
        jsonb_build_object(
            'status', 'resolved',
            'matched_profile_id', p_profile_id,
            'resolved_contribution_id', v_contribution.id
        ),
        jsonb_build_object('source_key', v_event.source_key)
    );

    return v_contribution;
end;
$$;

grant execute on function public.resolve_bmac_unmatched_event(uuid, uuid, text) to authenticated;