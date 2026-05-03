create table if not exists public.points_rules (
    rule_code text primary key,
    display_name text not null,
    points_value integer not null,
    is_active boolean not null default true,
    admin_note text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint points_rules_points_value_check check (points_value >= 0)
);

create table if not exists public.profile_point_milestones (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    milestone_code text not null,
    created_at timestamptz not null default now(),
    unique (profile_id, milestone_code)
);

create table if not exists public.point_events_ledger (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    action_code text not null,
    points_delta integer not null,
    balance_after integer not null,
    source_type text,
    source_id text,
    reason text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint point_events_ledger_balance_after_check check (balance_after >= 0)
);

create table if not exists public.social_interactions (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    interaction_type text not null,
    target_entity_type text not null,
    target_entity_id text not null,
    metadata jsonb not null default '{}'::jsonb,
    points_awarded integer not null default 0,
    points_awarded_at timestamptz,
    created_at timestamptz not null default now(),
    constraint social_interactions_interaction_type_check check (interaction_type in ('like', 'share')),
    constraint social_interactions_target_entity_type_check check (target_entity_type in ('poi', 'item', 'contributor')),
    unique (profile_id, interaction_type, target_entity_type, target_entity_id)
);

create table if not exists public.comments (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    target_entity_type text not null,
    target_entity_id text not null,
    parent_comment_id uuid references public.comments (id) on delete cascade,
    body text not null,
    status text not null default 'pending',
    moderation_reason text not null default '',
    approved_by uuid references public.profiles (id) on delete set null,
    approved_at timestamptz,
    rejected_by uuid references public.profiles (id) on delete set null,
    rejected_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint comments_target_entity_type_check check (target_entity_type in ('poi', 'item', 'contributor')),
    constraint comments_status_check check (status in ('pending', 'approved', 'rejected')),
    constraint comments_body_not_blank check (length(trim(body)) > 0)
);

create table if not exists public.comment_moderation_actions (
    id uuid primary key default gen_random_uuid(),
    comment_id uuid not null references public.comments (id) on delete cascade,
    action text not null,
    reason text not null default '',
    actor_id uuid references public.profiles (id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint comment_moderation_actions_action_check check (action in ('approve', 'reject'))
);

create table if not exists public.user_bans (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    reason text not null,
    is_active boolean not null default true,
    created_by uuid references public.profiles (id) on delete set null,
    lifted_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    lifted_at timestamptz,
    metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists user_bans_one_active_per_profile_idx
    on public.user_bans (profile_id)
    where is_active = true;

create table if not exists public.admin_audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles (id) on delete set null,
    action_type text not null,
    target_table text not null,
    target_id text not null,
    reason text not null default '',
    old_values jsonb not null default '{}'::jsonb,
    new_values jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.bmac_contributions (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles (id) on delete cascade,
    amount_pence integer not null,
    points_awarded integer not null,
    note text not null default '',
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint bmac_contributions_amount_pence_check check (amount_pence > 0),
    constraint bmac_contributions_points_awarded_check check (points_awarded > 0)
);

create index if not exists point_events_ledger_profile_created_idx
    on public.point_events_ledger (profile_id, created_at desc);

create index if not exists comments_target_status_created_idx
    on public.comments (target_entity_type, target_entity_id, status, created_at desc);

create index if not exists social_interactions_target_created_idx
    on public.social_interactions (target_entity_type, target_entity_id, created_at desc);

create or replace function public.points_rules_set_updated_at()
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
        where tgname = 'points_rules_set_updated_at_trigger'
          and tgrelid = 'public.points_rules'::regclass
    ) then
        create trigger points_rules_set_updated_at_trigger
            before update on public.points_rules
            for each row
            execute procedure public.points_rules_set_updated_at();
    end if;
end;
$$;

create or replace function public.comments_set_updated_at()
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
        where tgname = 'comments_set_updated_at_trigger'
          and tgrelid = 'public.comments'::regclass
    ) then
        create trigger comments_set_updated_at_trigger
            before update on public.comments
            for each row
            execute procedure public.comments_set_updated_at();
    end if;
end;
$$;

create or replace function public.is_profile_banned(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.user_bans
        where profile_id = check_user_id
          and is_active = true
    );
$$;

grant execute on function public.is_profile_banned(uuid) to anon;
grant execute on function public.is_profile_banned(uuid) to authenticated;

create or replace function public.log_admin_audit(
    p_action_type text,
    p_target_table text,
    p_target_id text,
    p_reason text default '',
    p_old_values jsonb default '{}'::jsonb,
    p_new_values jsonb default '{}'::jsonb,
    p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_log_id uuid;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can write audit logs';
    end if;

    insert into public.admin_audit_logs (
        actor_id,
        action_type,
        target_table,
        target_id,
        reason,
        old_values,
        new_values,
        metadata
    )
    values (
        v_actor_id,
        coalesce(trim(p_action_type), ''),
        coalesce(trim(p_target_table), ''),
        coalesce(trim(p_target_id), ''),
        coalesce(p_reason, ''),
        coalesce(p_old_values, '{}'::jsonb),
        coalesce(p_new_values, '{}'::jsonb),
        coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_log_id;

    return v_log_id;
end;
$$;

grant execute on function public.log_admin_audit(text, text, text, text, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.apply_points_event(
    p_profile_id uuid,
    p_action_code text,
    p_points_delta integer,
    p_source_type text default null,
    p_source_id text default null,
    p_reason text default '',
    p_metadata jsonb default '{}'::jsonb,
    p_created_by uuid default auth.uid()
)
returns public.point_events_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile public.profiles%rowtype;
    v_next_balance integer;
    v_row public.point_events_ledger;
begin
    if p_profile_id is null then
        raise exception 'Missing profile id';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = p_profile_id
    for update;

    if not found then
        raise exception 'Profile not found';
    end if;

    v_next_balance := greatest(coalesce(v_profile.supporter_points, 0) + coalesce(p_points_delta, 0), 0);

    update public.profiles
    set supporter_points = v_next_balance,
        supporter_verified_at = now()
    where id = p_profile_id;

    insert into public.point_events_ledger (
        profile_id,
        action_code,
        points_delta,
        balance_after,
        source_type,
        source_id,
        reason,
        metadata,
        created_by
    )
    values (
        p_profile_id,
        coalesce(trim(p_action_code), ''),
        coalesce(p_points_delta, 0),
        v_next_balance,
        nullif(trim(coalesce(p_source_type, '')), ''),
        nullif(trim(coalesce(p_source_id, '')), ''),
        coalesce(p_reason, ''),
        coalesce(p_metadata, '{}'::jsonb),
        p_created_by
    )
    returning * into v_row;

    return v_row;
end;
$$;

grant execute on function public.apply_points_event(uuid, text, integer, text, text, text, jsonb, uuid) to authenticated;

create or replace function public.get_rule_points_value(p_rule_code text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_points integer;
begin
    select points_value
    into v_points
    from public.points_rules
    where rule_code = p_rule_code
      and is_active = true;

    if v_points is null then
        raise exception 'Missing points rule: %', p_rule_code;
    end if;

    return v_points;
end;
$$;

grant execute on function public.get_rule_points_value(text) to authenticated;

create or replace function public.submit_social_interaction(
    p_interaction_type text,
    p_target_entity_type text,
    p_target_entity_id text,
    p_metadata jsonb default '{}'::jsonb
)
returns table (
    interaction_id uuid,
    created boolean,
    points_awarded integer,
    points_balance_after integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_rule_code text;
    v_points integer;
    v_inserted public.social_interactions%rowtype;
    v_ledger public.point_events_ledger;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if public.is_profile_banned(v_user_id) then
        raise exception 'Account is banned from interactions';
    end if;

    if p_interaction_type not in ('like', 'share') then
        raise exception 'Unsupported interaction type';
    end if;

    if p_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if coalesce(trim(p_target_entity_id), '') = '' then
        raise exception 'Missing target id';
    end if;

    insert into public.social_interactions (
        profile_id,
        interaction_type,
        target_entity_type,
        target_entity_id,
        metadata
    )
    values (
        v_user_id,
        p_interaction_type,
        p_target_entity_type,
        trim(p_target_entity_id),
        coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (profile_id, interaction_type, target_entity_type, target_entity_id) do nothing
    returning * into v_inserted;

    if v_inserted.id is null then
        return query
        select
            existing.id,
            false,
            coalesce(existing.points_awarded, 0),
            coalesce(p.supporter_points, 0)
        from public.social_interactions as existing
        join public.profiles as p
          on p.id = existing.profile_id
        where existing.profile_id = v_user_id
          and existing.interaction_type = p_interaction_type
          and existing.target_entity_type = p_target_entity_type
          and existing.target_entity_id = trim(p_target_entity_id)
        limit 1;
        return;
    end if;

    v_rule_code := case
        when p_interaction_type = 'like' then 'like'
        else 'share'
    end;

    v_points := public.get_rule_points_value(v_rule_code);

    v_ledger := public.apply_points_event(
        v_user_id,
        'interaction_' || p_interaction_type,
        v_points,
        p_target_entity_type,
        trim(p_target_entity_id),
        '',
        jsonb_build_object(
            'interaction_id', v_inserted.id,
            'interaction_type', p_interaction_type
        ),
        v_user_id
    );

    update public.social_interactions
    set points_awarded = v_points,
        points_awarded_at = now()
    where id = v_inserted.id;

    return query
    select
        v_inserted.id,
        true,
        v_points,
        v_ledger.balance_after;
end;
$$;

grant execute on function public.submit_social_interaction(text, text, text, jsonb) to authenticated;

create or replace function public.submit_comment_for_review(
    p_target_entity_type text,
    p_target_entity_id text,
    p_body text,
    p_parent_comment_id uuid default null
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_comment public.comments;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if public.is_profile_banned(v_user_id) then
        raise exception 'Account is banned from commenting';
    end if;

    if p_target_entity_type not in ('poi', 'item', 'contributor') then
        raise exception 'Unsupported target type';
    end if;

    if coalesce(trim(p_target_entity_id), '') = '' then
        raise exception 'Missing target id';
    end if;

    if coalesce(trim(p_body), '') = '' then
        raise exception 'Comment cannot be empty';
    end if;

    insert into public.comments (
        profile_id,
        target_entity_type,
        target_entity_id,
        parent_comment_id,
        body,
        status
    )
    values (
        v_user_id,
        p_target_entity_type,
        trim(p_target_entity_id),
        p_parent_comment_id,
        trim(p_body),
        'pending'
    )
    returning * into v_comment;

    return v_comment;
end;
$$;

grant execute on function public.submit_comment_for_review(text, text, text, uuid) to authenticated;

create or replace function public.approve_comment(
    p_comment_id uuid,
    p_reason text default ''
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_comment public.comments;
    v_points integer;
    v_ledger public.point_events_ledger;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can approve comments';
    end if;

    update public.comments
    set status = 'approved',
        moderation_reason = coalesce(p_reason, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        rejected_by = null,
        rejected_at = null
    where id = p_comment_id
      and status = 'pending'
    returning * into v_comment;

    if v_comment.id is null then
        raise exception 'Pending comment not found';
    end if;

    v_points := public.get_rule_points_value('comment_approved');

    v_ledger := public.apply_points_event(
        v_comment.profile_id,
        'comment_approved',
        v_points,
        'comment',
        v_comment.id::text,
        coalesce(p_reason, ''),
        jsonb_build_object(
            'target_entity_type', v_comment.target_entity_type,
            'target_entity_id', v_comment.target_entity_id
        ),
        v_actor_id
    );

    insert into public.comment_moderation_actions (
        comment_id,
        action,
        reason,
        actor_id,
        metadata
    )
    values (
        v_comment.id,
        'approve',
        coalesce(p_reason, ''),
        v_actor_id,
        jsonb_build_object('points_awarded', v_points, 'balance_after', v_ledger.balance_after)
    );

    perform public.log_admin_audit(
        'approve_comment',
        'comments',
        v_comment.id::text,
        coalesce(p_reason, ''),
        '{}'::jsonb,
        jsonb_build_object('status', 'approved', 'profile_id', v_comment.profile_id),
        jsonb_build_object('target_entity_type', v_comment.target_entity_type, 'target_entity_id', v_comment.target_entity_id)
    );

    return v_comment;
end;
$$;

grant execute on function public.approve_comment(uuid, text) to authenticated;

create or replace function public.reject_comment(
    p_comment_id uuid,
    p_reason text default ''
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_comment public.comments;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can reject comments';
    end if;

    update public.comments
    set status = 'rejected',
        moderation_reason = coalesce(p_reason, ''),
        rejected_by = v_actor_id,
        rejected_at = now()
    where id = p_comment_id
      and status = 'pending'
    returning * into v_comment;

    if v_comment.id is null then
        raise exception 'Pending comment not found';
    end if;

    insert into public.comment_moderation_actions (
        comment_id,
        action,
        reason,
        actor_id,
        metadata
    )
    values (
        v_comment.id,
        'reject',
        coalesce(p_reason, ''),
        v_actor_id,
        '{}'::jsonb
    );

    perform public.log_admin_audit(
        'reject_comment',
        'comments',
        v_comment.id::text,
        coalesce(p_reason, ''),
        '{}'::jsonb,
        jsonb_build_object('status', 'rejected', 'profile_id', v_comment.profile_id),
        jsonb_build_object('target_entity_type', v_comment.target_entity_type, 'target_entity_id', v_comment.target_entity_id)
    );

    return v_comment;
end;
$$;

grant execute on function public.reject_comment(uuid, text) to authenticated;

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
    v_points integer;
    v_awarded boolean := false;
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
        v_awarded := v_rows > 0;

        if v_awarded then
            v_points := public.get_rule_points_value('facebook_group_join_bonus');
            perform public.apply_points_event(
                p_profile_id,
                'facebook_group_join_bonus',
                v_points,
                'profile',
                p_profile_id::text,
                coalesce(p_reason, ''),
                '{}'::jsonb,
                v_actor_id
            );
        end if;
    end if;

    perform public.log_admin_audit(
        'set_facebook_group_membership',
        'profiles',
        p_profile_id::text,
        coalesce(p_reason, ''),
        '{}'::jsonb,
        jsonb_build_object(
            'is_facebook_group_member', coalesce(p_is_member, false),
            'join_bonus_awarded', v_awarded
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
    v_points_per_penny integer;
    v_points integer;
    v_contribution public.bmac_contributions;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can record bmac contribution amounts';
    end if;

    if coalesce(p_amount_pence, 0) <= 0 then
        raise exception 'Contribution amount must be positive';
    end if;

    v_points_per_penny := public.get_rule_points_value('bmac_points_per_penny');
    v_points := p_amount_pence * v_points_per_penny;

    insert into public.bmac_contributions (
        profile_id,
        amount_pence,
        points_awarded,
        note,
        created_by
    )
    values (
        p_profile_id,
        p_amount_pence,
        v_points,
        coalesce(p_note, ''),
        v_actor_id
    )
    returning * into v_contribution;

    perform public.apply_points_event(
        p_profile_id,
        'bmac_contribution',
        v_points,
        'bmac_contribution',
        v_contribution.id::text,
        coalesce(p_note, ''),
        jsonb_build_object('amount_pence', p_amount_pence),
        v_actor_id
    );

    update public.profiles
    set is_bmc_supporter = true,
        supporter_verified_at = now()
    where id = p_profile_id;

    perform public.log_admin_audit(
        'record_bmac_contribution',
        'profiles',
        p_profile_id::text,
        coalesce(p_note, ''),
        '{}'::jsonb,
        jsonb_build_object('amount_pence', p_amount_pence, 'points_awarded', v_points),
        jsonb_build_object('contribution_id', v_contribution.id)
    );

    return v_contribution;
end;
$$;

grant execute on function public.record_bmac_contribution_amount(uuid, integer, text) to authenticated;

create or replace function public.ban_profile(
    p_profile_id uuid,
    p_reason text
)
returns public.user_bans
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_ban public.user_bans;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can ban users';
    end if;

    if coalesce(trim(p_reason), '') = '' then
        raise exception 'Ban reason is required';
    end if;

    update public.user_bans
    set is_active = false,
        lifted_at = now(),
        lifted_by = v_actor_id
    where profile_id = p_profile_id
      and is_active = true;

    insert into public.user_bans (
        profile_id,
        reason,
        is_active,
        created_by
    )
    values (
        p_profile_id,
        trim(p_reason),
        true,
        v_actor_id
    )
    returning * into v_ban;

    perform public.log_admin_audit(
        'ban_profile',
        'profiles',
        p_profile_id::text,
        trim(p_reason),
        '{}'::jsonb,
        jsonb_build_object('ban_id', v_ban.id, 'is_active', true),
        '{}'::jsonb
    );

    return v_ban;
end;
$$;

grant execute on function public.ban_profile(uuid, text) to authenticated;

create or replace function public.unban_profile(
    p_profile_id uuid,
    p_reason text default ''
)
returns public.user_bans
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_id uuid := auth.uid();
    v_ban public.user_bans;
begin
    if not public.is_app_owner(v_actor_id) then
        raise exception 'Only app owners can unban users';
    end if;

    update public.user_bans
    set is_active = false,
        lifted_at = now(),
        lifted_by = v_actor_id
    where profile_id = p_profile_id
      and is_active = true
    returning * into v_ban;

    if v_ban.id is null then
        raise exception 'No active ban found';
    end if;

    perform public.log_admin_audit(
        'unban_profile',
        'profiles',
        p_profile_id::text,
        coalesce(p_reason, ''),
        jsonb_build_object('ban_id', v_ban.id, 'was_active', true),
        jsonb_build_object('is_active', false),
        '{}'::jsonb
    );

    return v_ban;
end;
$$;

grant execute on function public.unban_profile(uuid, text) to authenticated;

alter table public.points_rules enable row level security;
alter table public.profile_point_milestones enable row level security;
alter table public.point_events_ledger enable row level security;
alter table public.social_interactions enable row level security;
alter table public.comments enable row level security;
alter table public.comment_moderation_actions enable row level security;
alter table public.user_bans enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.bmac_contributions enable row level security;

grant select on public.points_rules to anon;
grant select on public.points_rules to authenticated;
grant select on public.point_events_ledger to authenticated;
grant select, insert on public.social_interactions to authenticated;
grant select, insert on public.comments to authenticated;
grant select on public.comment_moderation_actions to authenticated;
grant select on public.user_bans to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant select on public.bmac_contributions to authenticated;
drop policy if exists "points_rules_select_all" on public.points_rules;
create policy "points_rules_select_all"
    on public.points_rules
    for select
    using (true);

drop policy if exists "points_rules_update_owner_admin" on public.points_rules;
create policy "points_rules_update_owner_admin"
    on public.points_rules
    for update
    using (public.is_app_owner(auth.uid()))
    with check (public.is_app_owner(auth.uid()));

drop policy if exists "profile_point_milestones_select_own_or_admin" on public.profile_point_milestones;
create policy "profile_point_milestones_select_own_or_admin"
    on public.profile_point_milestones
    for select
    using (profile_id = auth.uid() or public.is_app_owner(auth.uid()));

drop policy if exists "point_events_ledger_select_own_or_admin" on public.point_events_ledger;
create policy "point_events_ledger_select_own_or_admin"
    on public.point_events_ledger
    for select
    using (profile_id = auth.uid() or public.is_app_owner(auth.uid()));

drop policy if exists "social_interactions_select_own_or_admin" on public.social_interactions;
create policy "social_interactions_select_own_or_admin"
    on public.social_interactions
    for select
    using (profile_id = auth.uid() or public.is_app_owner(auth.uid()));

drop policy if exists "social_interactions_insert_own" on public.social_interactions;
create policy "social_interactions_insert_own"
    on public.social_interactions
    for insert
    with check (profile_id = auth.uid() and not public.is_profile_banned(auth.uid()));

drop policy if exists "comments_select_published_own_or_admin" on public.comments;
create policy "comments_select_published_own_or_admin"
    on public.comments
    for select
    using (
        status = 'approved'
        or profile_id = auth.uid()
        or public.is_app_owner(auth.uid())
    );

drop policy if exists "comments_insert_own_pending" on public.comments;
create policy "comments_insert_own_pending"
    on public.comments
    for insert
    with check (
        profile_id = auth.uid()
        and status = 'pending'
        and not public.is_profile_banned(auth.uid())
    );

drop policy if exists "comments_update_owner_admin" on public.comments;
create policy "comments_update_owner_admin"
    on public.comments
    for update
    using (public.is_app_owner(auth.uid()))
    with check (public.is_app_owner(auth.uid()));

drop policy if exists "comment_moderation_actions_select_owner_admin" on public.comment_moderation_actions;
create policy "comment_moderation_actions_select_owner_admin"
    on public.comment_moderation_actions
    for select
    using (public.is_app_owner(auth.uid()));

drop policy if exists "user_bans_select_own_or_admin" on public.user_bans;
create policy "user_bans_select_own_or_admin"
    on public.user_bans
    for select
    using (profile_id = auth.uid() or public.is_app_owner(auth.uid()));

drop policy if exists "admin_audit_logs_select_owner_admin" on public.admin_audit_logs;
create policy "admin_audit_logs_select_owner_admin"
    on public.admin_audit_logs
    for select
    using (public.is_app_owner(auth.uid()));

drop policy if exists "bmac_contributions_select_own_or_admin" on public.bmac_contributions;
create policy "bmac_contributions_select_own_or_admin"
    on public.bmac_contributions
    for select
    using (profile_id = auth.uid() or public.is_app_owner(auth.uid()));

insert into public.points_rules (rule_code, display_name, points_value, is_active, admin_note)
values
    ('like', 'Like interaction', 1, true, 'Awards once per user per target.'),
    ('share', 'Share interaction', 5, true, 'Awards once per user per target.'),
    ('comment_approved', 'Approved comment or reply', 5, true, 'Only awarded after owner approval.'),
    ('facebook_group_join_bonus', 'Facebook group join bonus', 100, true, 'One-time bonus when membership first set to true.'),
    ('bmac_points_per_penny', 'BMAC points per penny', 1, true, 'Points per penny contribution amount.')
on conflict (rule_code) do update
set display_name = excluded.display_name,
    points_value = excluded.points_value,
    is_active = excluded.is_active,
    admin_note = excluded.admin_note,
    updated_at = now();