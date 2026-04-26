alter table if exists public.pois
    add column if not exists is_cleanup_supporter boolean not null default false,
    add column if not exists is_pub boolean not null default false;