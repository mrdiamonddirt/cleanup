alter table if exists public.profiles
    add column if not exists is_facebook_group_member boolean not null default false,
    add column if not exists is_bmc_supporter boolean not null default false,
    add column if not exists supporter_points integer not null default 0,
    add column if not exists supporter_note text not null default '',
    add column if not exists supporter_verified_at timestamptz;
