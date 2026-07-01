alter table if exists public.items
    add column if not exists bin_google_maps_url text,
    add column if not exists bin_street_view_url text,
    add column if not exists bin_locate_note text not null default '',
    add column if not exists bin_report_note text not null default '';

update public.items
set
    bin_google_maps_url = coalesce(
        nullif(trim(bin_google_maps_url), ''),
        nullif(trim(reference_image_url), '')
    ),
    bin_street_view_url = case
        when coalesce(nullif(trim(bin_street_view_url), ''), '') = ''
             and coalesce(trim(reference_image_caption), '') ~* '^https?://' then trim(reference_image_caption)
        else nullif(trim(bin_street_view_url), '')
    end,
    bin_locate_note = case
        when coalesce(trim(bin_locate_note), '') = ''
             and not (coalesce(trim(reference_image_caption), '') ~* '^https?://') then coalesce(trim(reference_image_caption), '')
        else coalesce(trim(bin_locate_note), '')
    end
where lower(coalesce(type, '')) like '%bin%';

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
        bin_google_maps_url,
        bin_street_view_url,
        bin_locate_note,
        bin_report_note,
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
        v_street_view_url,
        coalesce(v_locate_note, ''),
        coalesce(v_report_note, ''),
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
