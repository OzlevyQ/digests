-- PAPit community schema (applied 2026-10-31 to project kuehljnnpwgzyodjaund).
-- Isolation: RLS enabled with NO policies, so PostgREST denies all direct
-- access; only the papit-api edge function (service role) touches these tables.
-- Account deletion via the API removes only papit_* rows; Keviata tables and
-- the Descope identity are untouched.
create table if not exists papit_profiles(
  id text primary key,
  display_name text not null default 'חבר/ת קהילה',
  email text default '',
  picture_url text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists papit_rooms(
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  owner_id text not null references papit_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists papit_posts(
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references papit_rooms(id) on delete cascade,
  author_id text not null references papit_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 5000),
  link text not null default '' check (char_length(link) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists papit_posts_room_created on papit_posts(room_id, created_at desc);
create index if not exists papit_posts_created on papit_posts(created_at desc);
alter table papit_profiles enable row level security;
alter table papit_rooms enable row level security;
alter table papit_posts enable row level security;
