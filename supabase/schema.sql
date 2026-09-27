-- Run in a private Supabase project. Create demo users in Supabase Auth first.
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  speaker_id text not null,
  thread_id text not null,
  participant_ids text[] not null default '{}',
  original_text text not null,
  source_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  result jsonb,
  trace jsonb not null default '[]'::jsonb,
  corpus_revision text not null,
  capture_source text not null default 'phone_upload' check (capture_source in ('phone_upload','phone_camera','quest','glasses')),
  created_at timestamptz not null default now()
);
alter table public.scans add column if not exists capture_source text not null default 'phone_upload';
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id),
  recipient_id uuid not null references auth.users(id),
  scan_id uuid references public.scans(id),
  reply_to uuid references public.messages(id),
  image_path text,
  quoted_source_id uuid,
  quoted_text text,
  body text not null check (char_length(body) between 1 and 2000),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(sender_id, client_request_id)
);
create table if not exists public.contacts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  person_id text not null,
  recipient_id uuid not null references auth.users(id),
  primary key (owner_id, person_id)
);
-- Ephemeral, opt-in presence. Raw coordinates are never client-readable and expire after ten minutes.
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
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quest','glasses','pi')),
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_scan_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.scans add column if not exists device_id uuid references public.device_tokens(id);
alter table public.device_tokens add column if not exists last_scan_at timestamptz;
alter table public.device_tokens drop constraint if exists device_tokens_kind_check;
alter table public.device_tokens add constraint device_tokens_kind_check check (kind in ('quest','glasses','pi'));
create table if not exists public.device_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.device_tokens(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  kind text not null check (kind in ('connection','reply')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create or replace function public.enqueue_glasses_connection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.capture_source = 'glasses' and new.result->>'status' = 'matched' then
    insert into public.device_events (owner_id, device_id, scan_id, kind, payload)
    values (new.owner_id, new.device_id, new.id, 'connection', jsonb_build_object(
      'person', new.result->>'person',
      'item', new.result->>'observedEntity',
      'relation', new.result->>'relation'
    ));
  end if;
  return new;
end $$;
drop trigger if exists scans_enqueue_glasses_connection on public.scans;
create trigger scans_enqueue_glasses_connection after insert on public.scans
for each row execute function public.enqueue_glasses_connection();
revoke all on function public.enqueue_glasses_connection() from public, anon, authenticated;
create or replace function public.claim_device_scan(p_device_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  update public.device_tokens set last_scan_at = now()
  where id = p_device_id and revoked_at is null and expires_at > now()
    and (last_scan_at is null or last_scan_at <= now() - interval '20 seconds')
  returning id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_device_scan(uuid) from public, anon, authenticated;
grant execute on function public.claim_device_scan(uuid) to service_role;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scans_capture_source_check' and conrelid = 'public.scans'::regclass) then
    alter table public.scans add constraint scans_capture_source_check check (capture_source in ('phone_upload','phone_camera','quest','glasses'));
  end if;
end $$;
alter table public.messages add column if not exists image_path text;
alter table public.messages add column if not exists quoted_source_id uuid;
alter table public.messages add column if not exists quoted_text text;
alter table public.messages add column if not exists reply_to uuid references public.messages(id);
alter table public.messages add column if not exists sender_name text;
alter table public.messages add column if not exists quoted_at timestamptz;
alter table public.messages add column if not exists purpose text not null default 'connection';
alter table public.messages add column if not exists about_person_id text;
alter table public.messages add column if not exists delivery_channel text not null default 'in_app';
alter table public.messages add column if not exists delivery_status text;
alter table public.messages add column if not exists provider_message_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_delivery_channel_check' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_delivery_channel_check check (delivery_channel in ('in_app','sms'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_delivery_status_check' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_delivery_status_check check (delivery_status is null or delivery_status in ('pending','sent','failed'));
  end if;
end $$;
alter table public.device_events add column if not exists device_id uuid references public.device_tokens(id) on delete cascade;
alter table public.device_events drop constraint if exists device_events_scan_id_key;
alter table public.device_events drop constraint if exists device_events_kind_check;
alter table public.device_events add constraint device_events_kind_check check (kind in ('connection','reply'));
update public.device_events e set device_id = s.device_id from public.scans s where e.scan_id = s.id and e.device_id is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_purpose_check' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_purpose_check check (purpose in ('connection','advice','reply'));
  end if;
end $$;
-- Demo-session updates are tagged so a reset can remove exactly those rows and nothing imported.
alter table public.sources add column if not exists origin text not null default 'import';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sources_origin_check' and conrelid = 'public.sources'::regclass) then
    alter table public.sources add constraint sources_origin_check check (origin in ('import','demo_update'));
  end if;
end $$;
update public.sources set origin = 'demo_update' where origin = 'import' and is_synthetic and thread_id like 'demo-update-%';
alter table public.sources enable row level security;
alter table public.scans enable row level security;
alter table public.messages enable row level security;
alter table public.contacts enable row level security;
alter table public.location_presence enable row level security;
alter table public.device_tokens enable row level security;
alter table public.device_events enable row level security;
drop policy if exists "owners write sources" on public.sources;
drop policy if exists "owners write scans" on public.scans;
drop policy if exists "send own messages" on public.messages;
drop policy if exists "owners write contacts" on public.contacts;
drop policy if exists "owners read sources" on public.sources;
drop policy if exists "owners read scans" on public.scans;
drop policy if exists "participants read messages" on public.messages;
drop policy if exists "owners read contacts" on public.contacts;
drop policy if exists "users read own presence status" on public.location_presence;
create policy "owners read sources" on public.sources for select to authenticated using (owner_id = auth.uid());
create policy "owners read scans" on public.scans for select to authenticated using (owner_id = auth.uid());
create policy "participants read messages" on public.messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy "owners read contacts" on public.contacts for select to authenticated using (owner_id = auth.uid());
-- The client can see only its own row. Cross-user proximity is calculated by the trusted scan service,
-- which returns a coarse band and never another person's coordinates.
create policy "users read own presence status" on public.location_presence for select to authenticated using (user_id = auth.uid());

-- Prepared relation evidence is private and replaceable; clients can read only
-- their own index. Only service-role server code can build or replace it.
create table if not exists public.context_indexes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  cache_key text not null,
  corpus_revision text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  source_count integer not null check (source_count between 0 and 1000),
  relations jsonb not null default '[]'::jsonb check (jsonb_typeof(relations) = 'array'),
  created_at timestamptz not null default now()
);
alter table public.context_indexes enable row level security;
drop policy if exists "owners read context indexes" on public.context_indexes;
create policy "owners read context indexes" on public.context_indexes for select to authenticated
using (owner_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "owners upload scan photos" on storage.objects;
drop policy if exists "owners and message recipients view scan photos" on storage.objects;
create policy "owners upload scan photos" on storage.objects for insert to authenticated
with check (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners and message recipients view scan photos" on storage.objects for select to authenticated
using (bucket_id = 'scan-images' and (
  (storage.foldername(name))[1] = auth.uid()::text or
  exists (select 1 from public.messages m where m.image_path = name and m.recipient_id = auth.uid())
));

-- Realtime inbox: row-level policies above still decide who receives each insert.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Shopping continuation (demo merchant, Stripe test mode). Written only by the server; owners read their own orders.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  client_request_id text not null,
  product_id text not null,
  title text not null,
  variant text not null,
  merchant text not null,
  currency text not null check (currency = 'usd'),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  tax_cents integer not null check (tax_cents >= 0),
  total_cents integer not null,
  budget_cents integer not null check (budget_cents > 0),
  purpose jsonb not null,
  status text not null check (status in ('draft','quoted','approved','checkout_pending','paid_test','failed','expired')),
  quote_expires_at timestamptz not null,
  catalog_revision text not null,
  provider text,
  checkout_session_id text unique,
  checkout_url text,
  paid_at timestamptz,
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, client_request_id),
  constraint orders_total_is_sum check (total_cents = subtotal_cents + shipping_cents + tax_cents)
);
alter table public.orders add column if not exists preference text
  check (preference in ('base','standalone','expansion','accessory','camera','coffee'));
-- Existing installs keep the old CHECK when ADD COLUMN IF NOT EXISTS is skipped.
alter table public.orders drop constraint if exists orders_preference_check;
alter table public.orders add constraint orders_preference_check
  check (preference in ('base','standalone','expansion','accessory','camera','coffee'));
create table if not exists public.payment_events (
  event_id text primary key,
  order_id uuid references public.orders(id) on delete set null,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.orders enable row level security;
alter table public.payment_events enable row level security;
drop policy if exists "owners read orders" on public.orders;
create policy "owners read orders" on public.orders for select to authenticated using (owner_id = auth.uid());
