create table if not exists public.app_storage (
  collection_name text not null,
  document_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection_name, document_id)
);

create index if not exists app_storage_updated_at_idx on public.app_storage (updated_at desc);

alter table public.app_storage enable row level security;

revoke all on table public.app_storage from anon, authenticated;
grant all on table public.app_storage to service_role;
