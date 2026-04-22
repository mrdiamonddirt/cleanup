alter table if exists public.items
    add column if not exists w3w_address text;

alter table if exists public.items
    add column if not exists w3w_updated_at timestamptz;

alter table if exists public.pois
    add column if not exists w3w_address text;

alter table if exists public.pois
    add column if not exists w3w_updated_at timestamptz;
