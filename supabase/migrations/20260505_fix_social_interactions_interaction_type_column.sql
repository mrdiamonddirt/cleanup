do $$
declare
    has_social_interactions boolean;
    has_interaction_type boolean;
    has_action_type boolean;
    has_target_entity_type boolean;
    has_target_entity_id boolean;
    has_profile_id boolean;
begin
    select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'social_interactions'
    ) into has_social_interactions;

    if not has_social_interactions then
        raise notice 'Skipping social_interactions compatibility fix: table public.social_interactions does not exist';
        return;
    end if;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'social_interactions'
          and column_name = 'interaction_type'
    ) into has_interaction_type;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'social_interactions'
          and column_name = 'action_type'
    ) into has_action_type;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'social_interactions'
          and column_name = 'target_entity_type'
    ) into has_target_entity_type;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'social_interactions'
          and column_name = 'target_entity_id'
    ) into has_target_entity_id;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'social_interactions'
          and column_name = 'profile_id'
    ) into has_profile_id;

    if not has_interaction_type then
        alter table public.social_interactions
            add column interaction_type text;
    end if;

    if has_action_type then
        execute $sql$
            update public.social_interactions
            set interaction_type = case
                when lower(trim(coalesce(action_type, ''))) in ('like', 'interaction_like') then 'like'
                when lower(trim(coalesce(action_type, ''))) in ('share', 'interaction_share') then 'share'
                else interaction_type
            end
            where coalesce(trim(interaction_type), '') = ''
        $sql$;
    end if;

    update public.social_interactions
    set interaction_type = lower(trim(coalesce(interaction_type, '')))
    where interaction_type is distinct from lower(trim(coalesce(interaction_type, '')));

    if exists (
        select 1
        from public.social_interactions
        where coalesce(interaction_type, '') not in ('like', 'share')
    ) then
        raise exception 'social_interactions has rows with invalid interaction_type values; expected like/share';
    end if;

    alter table public.social_interactions
        alter column interaction_type set not null;

    if has_profile_id and has_target_entity_type and has_target_entity_id then
        create unique index if not exists social_interactions_profile_interaction_target_uidx
            on public.social_interactions (profile_id, interaction_type, target_entity_type, target_entity_id);
    end if;
end;
$$;
