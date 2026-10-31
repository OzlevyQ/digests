-- PAPit community schema v2 (2026-10-31, project kuehljnnpwgzyodjaund).
-- No user accounts (Oz, 31.10: "בלי משתמשים. מקימים חדר, מקבלים api key לשם").
-- Creating a room returns a one-time API key; only its sha256 hash is stored.
-- The raw key is never logged, never in the repo, never in RSS/frontend data.
-- RLS enabled with NO policies: all access flows through the papit-api edge
-- function (service role). Keviata tables are untouched and unrelated.
create table papit_rooms(
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  api_key_hash text not null,
  key_hint text not null default '',
  created_at timestamptz not null default now()
);
create table papit_posts(
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references papit_rooms(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 5000),
  link text not null default '' check (char_length(link) <= 500),
  author_name text not null default '' check (char_length(author_name) <= 60),
  created_at timestamptz not null default now()
);
create index papit_posts_room_created on papit_posts(room_id, created_at desc);
create index papit_posts_created on papit_posts(created_at desc);
alter table papit_rooms enable row level security;
alter table papit_posts enable row level security;
