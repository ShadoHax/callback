-- Ephemeral foreground presence for coarse nearby callbacks.
-- Raw coordinates are readable only by the owning user and the service role.
create table if not exists public.location_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision not null check (accuracy > 0 and accuracy <= 150),
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint location_presence_short_lived check (expires_at <= captured_at + interval '15 minutes')
);

alter table public.location_presence enable row level security;
drop policy if exists "users read own presence status" on public.location_presence;
create policy "users read own presence status" on public.location_presence
  for select to authenticated using (user_id = auth.uid());
