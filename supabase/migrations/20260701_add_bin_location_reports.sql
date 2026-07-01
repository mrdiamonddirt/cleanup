alter table if exists public.items
    add column if not exists bin_subtype text;

create table if not exists public.bin_location_reports (
    id uuid primary key default gen_random_uuid(),
    reporter_profile_id uuid references public.profiles (id) on delete set null,
    reporter_label text not null default '',
    latitude double precision not null,
    longitude double precision not null,
    google_maps_url text not null,
    street_view_url text,
    locate_note text not null default '',
    report_note text not null default '',
    is_glasdon_jubilee boolean not null default false,
    status text not null default 'pending',
    moderation_reason text not null default '',
    created_bin_item_id text,
    reviewed_by uuid references public.profiles (id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint bin_location_reports_status_check check (
        status in ('pending', 'verification_requested', 'verified', 'rejected', 'duplicate')
    ),
    constraint bin_location_reports_google_maps_url_not_blank check (length(trim(google_maps_url)) > 0)
);

create index if not exists bin_location_reports_status_created_idx
    on public.bin_location_reports (status, created_at desc);

create index if not exists bin_location_reports_reporter_created_idx
    on public.bin_location_reports (reporter_profile_id, created_at desc);

create or replace function public.bin_location_reports_set_updated_at()
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
        where tgname = 'bin_location_reports_set_updated_at_trigger'
          and tgrelid = 'public.bin_location_reports'::regclass
    ) then
        create trigger bin_location_reports_set_updated_at_trigger
            before update on public.bin_location_reports
            for each row
            execute procedure public.bin_location_reports_set_updated_at();
    end if;
end;
$$;

create or replace function public.submit_bin_location_report(
    p_latitude double precision,
    p_longitude double precision,
    p_google_maps_url text,
    p_street_view_url text default null,
    p_locate_note text default '',
    p_report_note text default '',
    p_is_glasdon_jubilee boolean default false,
    p_reporter_label text default ''
)
returns public.bin_location_reports
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_google_maps_url text := coalesce(trim(p_google_maps_url), '');
    v_street_view_url text := nullif(trim(coalesce(p_street_view_url, '')), '');
    v_report public.bin_location_reports;
begin
    if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
        raise exception 'Latitude out of range';
    end if;

    if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
        raise exception 'Longitude out of range';
    end if;

    if v_google_maps_url = '' then
        raise exception 'Google Maps URL is required';
    end if;

    if not (v_google_maps_url ~* '^https?://') then
        raise exception 'Google Maps URL must start with http:// or https://';
    end if;

    if v_street_view_url is not null and not (v_street_view_url ~* '^https?://') then
        raise exception 'Street View URL must start with http:// or https://';
    end if;

    if v_user_id is not null and public.is_profile_banned(v_user_id) then
        raise exception 'Account is banned from reporting';
    end if;

    insert into public.bin_location_reports (
        reporter_profile_id,
        reporter_label,
        latitude,
        longitude,
        google_maps_url,
        street_view_url,
        locate_note,
        report_note,
        is_glasdon_jubilee,
        status
    )
    values (
        v_user_id,
        coalesce(trim(p_reporter_label), ''),
        p_latitude,
        p_longitude,
        v_google_maps_url,
        v_street_view_url,
        coalesce(trim(p_locate_note), ''),
        coalesce(trim(p_report_note), ''),
        coalesce(p_is_glasdon_jubilee, false),
        'pending'
    )
    returning * into v_report;

    return v_report;
end;
$$;

grant execute on function public.submit_bin_location_report(double precision, double precision, text, text, text, text, boolean, text) to anon;
grant execute on function public.submit_bin_location_report(double precision, double precision, text, text, text, text, boolean, text) to authenticated;

create or replace function public.list_bin_location_reports(
    p_status text default null
)
returns table (
    id uuid,
    reporter_profile_id uuid,
    reporter_label text,
    reporter_display_name text,
    latitude double precision,
    longitude double precision,
    google_maps_url text,
    street_view_url text,
    locate_note text,
    report_note text,
    is_glasdon_jubilee boolean,
    status text,
    moderation_reason text,
    created_bin_item_id text,
    reviewed_by uuid,
    reviewed_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can list bin reports';
    end if;

    return query
    select
        reports.id,
        reports.reporter_profile_id,
        reports.reporter_label,
        coalesce(profiles.display_name, '') as reporter_display_name,
        reports.latitude,
        reports.longitude,
        reports.google_maps_url,
        reports.street_view_url,
        reports.locate_note,
        reports.report_note,
        reports.is_glasdon_jubilee,
        reports.status,
        reports.moderation_reason,
        reports.created_bin_item_id,
        reports.reviewed_by,
        reports.reviewed_at,
        reports.created_at,
        reports.updated_at
    from public.bin_location_reports as reports
    left join public.profiles as profiles
      on profiles.id = reports.reporter_profile_id
    where p_status is null
       or trim(p_status) = ''
       or reports.status = trim(lower(p_status))
    order by reports.created_at asc;
end;
$$;

grant execute on function public.list_bin_location_reports(text) to authenticated;

create or replace function public.set_bin_location_report_status(
    p_report_id uuid,
    p_status text,
    p_reason text default ''
)
returns public.bin_location_reports
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_status text := trim(lower(coalesce(p_status, '')));
    v_report public.bin_location_reports;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can update bin reports';
    end if;

    if v_status not in ('pending', 'verification_requested', 'verified', 'rejected', 'duplicate') then
        raise exception 'Unsupported status';
    end if;

    update public.bin_location_reports
    set status = v_status,
        moderation_reason = coalesce(p_reason, ''),
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = p_report_id
    returning * into v_report;

    if v_report.id is null then
        raise exception 'Bin report not found';
    end if;

    perform public.log_admin_audit(
        'set_bin_location_report_status',
        'bin_location_reports',
        v_report.id::text,
        coalesce(p_reason, ''),
        '{}'::jsonb,
        jsonb_build_object('status', v_status),
        '{}'::jsonb
    );

    return v_report;
end;
$$;

grant execute on function public.set_bin_location_report_status(uuid, text, text) to authenticated;

create or replace function public.create_verified_bin_item(
    p_report_id uuid default null,
    p_latitude double precision default null,
    p_longitude double precision default null,
    p_google_maps_url text default null,
    p_street_view_url text default null,
    p_locate_note text default '',
    p_report_note text default '',
    p_is_glasdon_jubilee boolean default false
)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_report public.bin_location_reports;
    v_item public.items;
    v_latitude double precision;
    v_longitude double precision;
    v_google_maps_url text;
    v_street_view_url text;
    v_locate_note text;
    v_report_note text;
    v_is_glasdon_jubilee boolean;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can create verified bins';
    end if;

    if p_report_id is not null then
        select *
        into v_report
        from public.bin_location_reports
        where id = p_report_id;

        if v_report.id is null then
            raise exception 'Bin report not found';
        end if;

        v_latitude := v_report.latitude;
        v_longitude := v_report.longitude;
        v_google_maps_url := v_report.google_maps_url;
        v_street_view_url := v_report.street_view_url;
        v_locate_note := v_report.locate_note;
        v_report_note := v_report.report_note;
        v_is_glasdon_jubilee := v_report.is_glasdon_jubilee;
    else
        v_latitude := p_latitude;
        v_longitude := p_longitude;
        v_google_maps_url := trim(coalesce(p_google_maps_url, ''));
        v_street_view_url := nullif(trim(coalesce(p_street_view_url, '')), '');
        v_locate_note := coalesce(trim(p_locate_note), '');
        v_report_note := coalesce(trim(p_report_note), '');
        v_is_glasdon_jubilee := coalesce(p_is_glasdon_jubilee, false);
    end if;

    if v_latitude is null or v_latitude < -90 or v_latitude > 90 then
        raise exception 'Latitude out of range';
    end if;

    if v_longitude is null or v_longitude < -180 or v_longitude > 180 then
        raise exception 'Longitude out of range';
    end if;

    insert into public.items (
        y,
        x,
        type,
        image_url,
        is_recovered,
        bin_subtype,
        reference_image_url,
        reference_image_caption,
        estimated_weight_kg
    )
    values (
        v_latitude,
        v_longitude,
        'bin',
        '/river-photo.jpg',
        false,
        case when v_is_glasdon_jubilee then 'glasdon_jubilee' else null end,
        nullif(v_google_maps_url, ''),
        case
            when v_street_view_url is not null and v_street_view_url <> '' then v_street_view_url
            when v_locate_note <> '' then v_locate_note
            else null
        end,
        30
    )
    returning * into v_item;

    if p_report_id is not null then
        update public.bin_location_reports
        set status = 'verified',
            moderation_reason = '',
            created_bin_item_id = v_item.id::text,
            reviewed_by = v_actor_id,
            reviewed_at = now()
        where id = p_report_id;
    end if;

    perform public.log_admin_audit(
        'create_verified_bin_item',
        'items',
        v_item.id::text,
        '',
        '{}'::jsonb,
        jsonb_build_object(
            'type', 'bin',
            'latitude', v_latitude,
            'longitude', v_longitude,
            'is_glasdon_jubilee', v_is_glasdon_jubilee,
            'report_id', p_report_id
        ),
        '{}'::jsonb
    );

    return v_item;
end;
$$;

grant execute on function public.create_verified_bin_item(uuid, double precision, double precision, text, text, text, text, boolean) to authenticated;

alter table public.bin_location_reports enable row level security;

grant select, insert on public.bin_location_reports to authenticated;

drop policy if exists "bin_location_reports_select_own_or_admin" on public.bin_location_reports;
create policy "bin_location_reports_select_own_or_admin"
    on public.bin_location_reports
    for select
    using (reporter_profile_id = auth.uid() or public.is_app_owner(auth.uid()));

drop policy if exists "bin_location_reports_insert_anyone" on public.bin_location_reports;
create policy "bin_location_reports_insert_anyone"
    on public.bin_location_reports
    for insert
    with check (true);

drop policy if exists "bin_location_reports_update_admin_only" on public.bin_location_reports;
create policy "bin_location_reports_update_admin_only"
    on public.bin_location_reports
    for update
    using (public.is_app_owner(auth.uid()))
    with check (public.is_app_owner(auth.uid()));