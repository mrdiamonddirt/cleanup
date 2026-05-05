create or replace function public.get_target_interaction_summary(
    p_target_entity_type text,
    p_target_entity_id text
)
returns table (
    like_count bigint,
    share_count bigint,
    viewer_has_liked boolean,
    viewer_has_shared boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_target_entity_type text := lower(trim(coalesce(p_target_entity_type, '')));
    v_target_entity_id text := trim(coalesce(p_target_entity_id, ''));
begin
    if v_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if v_target_entity_id = '' then
        raise exception 'Missing target id';
    end if;

    return query
    with scoped_interactions as (
        select interaction_type, profile_id
        from public.social_interactions
        where target_entity_type = v_target_entity_type
          and target_entity_id = v_target_entity_id
    )
    select
        count(*) filter (where interaction_type = 'like') as like_count,
        count(*) filter (where interaction_type = 'share') as share_count,
        exists(
            select 1
            from scoped_interactions
            where interaction_type = 'like'
              and profile_id = v_user_id
        ) as viewer_has_liked,
        exists(
            select 1
            from scoped_interactions
            where interaction_type = 'share'
              and profile_id = v_user_id
        ) as viewer_has_shared;
end;
$$;

grant execute on function public.get_target_interaction_summary(text, text) to anon;
grant execute on function public.get_target_interaction_summary(text, text) to authenticated;

create or replace function public.toggle_like_interaction(
    p_target_entity_type text,
    p_target_entity_id text,
    p_metadata jsonb default '{}'::jsonb
)
returns table (
    interaction_id uuid,
    liked boolean,
    points_delta integer,
    points_balance_after integer,
    like_count bigint,
    share_count bigint,
    viewer_has_liked boolean,
    viewer_has_shared boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_target_entity_type text := lower(trim(coalesce(p_target_entity_type, '')));
    v_target_entity_id text := trim(coalesce(p_target_entity_id, ''));
    v_existing public.social_interactions%rowtype;
    v_points integer;
    v_ledger public.point_events_ledger;
    v_summary record;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if public.is_profile_banned(v_user_id) then
        raise exception 'Account is banned from interactions';
    end if;

    if v_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if v_target_entity_id = '' then
        raise exception 'Missing target id';
    end if;

    select *
    into v_existing
    from public.social_interactions
    where profile_id = v_user_id
      and interaction_type = 'like'
      and target_entity_type = v_target_entity_type
      and target_entity_id = v_target_entity_id
    limit 1
    for update;

    if found then
        v_points := coalesce(v_existing.points_awarded, public.get_rule_points_value('like'));

        v_ledger := public.apply_points_event(
            v_user_id,
            'interaction_like_removed',
            -abs(v_points),
            v_target_entity_type,
            v_target_entity_id,
            'Removed like interaction',
            jsonb_build_object(
                'interaction_id', v_existing.id,
                'interaction_type', 'like',
                'target_entity_type', v_target_entity_type,
                'target_entity_id', v_target_entity_id,
                'removed', true,
                'original_points_awarded', coalesce(v_existing.points_awarded, 0)
            ) || coalesce(p_metadata, '{}'::jsonb),
            v_user_id
        );

        delete from public.social_interactions
        where id = v_existing.id;

        select *
        into v_summary
        from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

        return query
        select
            v_existing.id,
            false,
            -abs(v_points),
            coalesce(v_ledger.balance_after, 0),
            coalesce(v_summary.like_count, 0),
            coalesce(v_summary.share_count, 0),
            coalesce(v_summary.viewer_has_liked, false),
            coalesce(v_summary.viewer_has_shared, false);
        return;
    end if;

    v_points := public.get_rule_points_value('like');

    insert into public.social_interactions (
        profile_id,
        interaction_type,
        target_entity_type,
        target_entity_id,
        metadata,
        points_awarded,
        points_awarded_at
    )
    values (
        v_user_id,
        'like',
        v_target_entity_type,
        v_target_entity_id,
        coalesce(p_metadata, '{}'::jsonb),
        v_points,
        now()
    )
    returning * into v_existing;

    v_ledger := public.apply_points_event(
        v_user_id,
        'interaction_like',
        v_points,
        v_target_entity_type,
        v_target_entity_id,
        '',
        jsonb_build_object(
            'interaction_id', v_existing.id,
            'interaction_type', 'like',
            'target_entity_type', v_target_entity_type,
            'target_entity_id', v_target_entity_id,
            'created', true
        ) || coalesce(p_metadata, '{}'::jsonb),
        v_user_id
    );

    select *
    into v_summary
    from public.get_target_interaction_summary(v_target_entity_type, v_target_entity_id);

    return query
    select
        v_existing.id,
        true,
        v_points,
        coalesce(v_ledger.balance_after, 0),
        coalesce(v_summary.like_count, 0),
        coalesce(v_summary.share_count, 0),
        coalesce(v_summary.viewer_has_liked, false),
        coalesce(v_summary.viewer_has_shared, false);
end;
$$;

grant execute on function public.toggle_like_interaction(text, text, jsonb) to authenticated;