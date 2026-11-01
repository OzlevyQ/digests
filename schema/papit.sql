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

-- Server-side rate limiting for open (accountless) writes. Service-role only:
-- RLS enabled, zero policies, so only the edge function's service key touches it.
create table if not exists public.papit_rate_events (
  id bigint generated always as identity primary key,
  action text not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index if not exists papit_rate_events_lookup
  on public.papit_rate_events (action, actor, created_at desc);
alter table public.papit_rate_events enable row level security;

-- Push subscriptions (2026-11-01): one row per browser endpoint per room.
-- Endpoints only: pushes are payload-free tickles, the client SW fetches the post.
create table if not exists public.papit_push_subs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.papit_rooms(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (room_id, endpoint)
);
alter table public.papit_push_subs enable row level security;

-- 2026-11-01: room owner contact (private, never returned by the API reads)
alter table papit_rooms add column if not exists owner_email text;

-- room cover images, publicly readable, written only by the edge function (service role)
insert into storage.buckets (id, name, public)
values ('papit-covers', 'papit-covers', true)
on conflict (id) do nothing;
