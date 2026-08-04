-- SplitParty core schema. All money stored as integer cents.
-- Access model: server-only API routes hold the key; RLS is enabled with
-- permissive policies for the anon role because the key never ships to browsers.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  code text not null unique,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  device_id text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  is_host boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','active','left','removed','denied')),
  created_at timestamptz not null default now(),
  unique (event_id, device_id)
);
create index members_device_idx on public.members (device_id);
create index members_event_idx on public.members (event_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  paid_by uuid not null references public.members(id),
  created_by uuid not null references public.members(id),
  label text not null check (char_length(label) between 1 and 80),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  created_at timestamptz not null default now()
);
create index expenses_event_idx on public.expenses (event_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_member uuid not null references public.members(id),
  to_member uuid not null references public.members(id),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  status text not null default 'pending'
    check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_member <> to_member)
);
create index settlements_event_idx on public.settlements (event_id);

alter table public.events enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;

-- Server-side key is the only client; open policies keep PostgREST usable for it.
create policy server_all_events on public.events for all to anon using (true) with check (true);
create policy server_all_members on public.members for all to anon using (true) with check (true);
create policy server_all_expenses on public.expenses for all to anon using (true) with check (true);
create policy server_all_settlements on public.settlements for all to anon using (true) with check (true);
