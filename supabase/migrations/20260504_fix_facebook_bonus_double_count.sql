-- Stop persisting facebook join bonus into supporter_points and reconcile legacy balances.
--
-- Leaderboard shows facebook bonus as a separate component based on
-- profiles.is_facebook_group_member. Persisting the same bonus into
-- profiles.supporter_points causes totals to double-count the bonus.

create or replace function public.set_facebook_group_membership_with_bonus(
    p_profile_id uuid,
    p_is_member boolean,
    p_reason text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_profile public.profiles;
    v_membership_milestone_recorded boolean := false;
    v_rows integer := 0;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can update facebook group status';
    end if;

    update public.profiles
    set is_facebook_group_member = coalesce(p_is_member, false),
        supporter_verified_at = now()
    where id = p_profile_id
    returning * into v_profile;

    if v_profile.id is null then
        raise exception 'Profile not found';
    end if;

    if coalesce(p_is_member, false) then
        insert into public.profile_point_milestones (
            profile_id,
            milestone_code
        )
        values (
            p_profile_id,
            'facebook_group_join_bonus'
        )
        on conflict (profile_id, milestone_code) do nothing;

        get diagnostics v_rows = row_count;
        v_membership_milestone_recorded := v_rows > 0;
    end if;

    perform public.log_admin_audit(
        'set_facebook_group_membership',
        'profiles',
        p_profile_id::text,
        coalesce(p_reason, ''),
        '{}'::jsonb,
        jsonb_build_object(
            'is_facebook_group_member', coalesce(p_is_member, false),
            'membership_milestone_recorded', v_membership_milestone_recorded
        ),
        '{}'::jsonb
    );

    select *
    into v_profile
    from public.profiles
    where id = p_profile_id;

    return v_profile;
end;
$$;

grant execute on function public.set_facebook_group_membership_with_bonus(uuid, boolean, text) to authenticated;

do $$
declare
    v_bonus record;
    v_reconciled_profiles bigint := 0;
    v_total_bonus_removed bigint := 0;
begin
    for v_bonus in
        select
            profile_id,
            coalesce(sum(points_delta), 0)::integer as bonus_points
        from public.point_events_ledger
        where action_code = 'facebook_group_join_bonus'
        group by profile_id
        having coalesce(sum(points_delta), 0) <> 0
    loop
        perform public.apply_points_event(
            v_bonus.profile_id,
            'facebook_group_bonus_reconciliation',
            -v_bonus.bonus_points,
            'migration',
            '20260504_fix_facebook_bonus_double_count',
            'Remove legacy facebook bonus from supporter_points to prevent leaderboard double-counting.',
            jsonb_build_object('reconciled_action_code', 'facebook_group_join_bonus'),
            null
        );

        v_reconciled_profiles := v_reconciled_profiles + 1;
        v_total_bonus_removed := v_total_bonus_removed + v_bonus.bonus_points;
    end loop;

    raise notice 'Facebook bonus reconciliation complete. profiles=% total_points_removed=%',
        v_reconciled_profiles,
        v_total_bonus_removed;
end;
$$;
