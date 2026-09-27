-- One private, replaceable relationship index per owner. Service-role code builds it;
-- the owner may read it, but client code cannot write model-derived evidence.
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
