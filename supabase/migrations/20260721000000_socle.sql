-- Cap — socle produit.
-- Trois tables, volontairement simples : le modèle produit bouge encore,
-- l'état reste un blob CapState (jsonb) ; on normalisera quand il se figera.

-- L'état courant : un CapState par utilisateur.
create table states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Backup quotidien automatique : un snapshot à la première écriture du jour.
create table state_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

-- Sessions Au clair : celle du jour est reprise après refresh ; les
-- atterries (landed) sont l'archive — futur track record.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  messages jsonb not null default '[]'::jsonb,
  landed boolean not null default false
);
create index sessions_user_started on sessions (user_id, started_at desc);

alter table states enable row level security;
alter table state_snapshots enable row level security;
alter table sessions enable row level security;

create policy "own state" on states
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own snapshots" on state_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sessions" on sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
