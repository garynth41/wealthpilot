-- WealthPilot 0.11 — automatic bank sync through SimpleFIN Bridge (see docs/BANK_SYNC.md).
-- The access URL (which contains the SimpleFIN credentials) lives in sync_secrets: row-level security is on and there are NO policies, so no browser
-- session can ever read it — only the sync-simplefin edge function (service role) can.

create table if not exists public.sync_connections (
  household_id uuid primary key references public.households(id) on delete cascade,
  provider text not null default 'simplefin',
  status text not null default 'connected' check (status in ('connected','error')),
  last_sync_at timestamptz, last_error text,
  account_map jsonb not null default '{}'::jsonb,       -- { "<SimpleFIN account id>": "<accounts.id>" } — owners edit this
  discovered jsonb not null default '[]'::jsonb,        -- [{id,name,org,last4,balance}] last seen at the bank (no transactions)
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.sync_secrets (
  household_id uuid primary key references public.households(id) on delete cascade,
  access_url text not null, created_at timestamptz not null default now()
);
create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  started_at timestamptz not null default now(), finished_at timestamptz,
  trigger text not null default 'manual' check (trigger in ('manual','daily','connect')),
  ok boolean not null default false, accounts int not null default 0, added int not null default 0, skipped int not null default 0, message text
);
create index if not exists sync_log_hh on public.sync_log(household_id, started_at desc);

alter table public.sync_connections enable row level security;
alter table public.sync_secrets enable row level security;
alter table public.sync_log enable row level security;
drop policy if exists sync_connections_select on public.sync_connections;
create policy sync_connections_select on public.sync_connections for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'connections'));
drop policy if exists sync_connections_update on public.sync_connections;
create policy sync_connections_update on public.sync_connections for update to authenticated using (is_owner(household_id)) with check (is_owner(household_id));
drop policy if exists sync_log_select on public.sync_log;
create policy sync_log_select on public.sync_log for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'connections'));
-- sync_secrets: deliberately no policy.
revoke all on public.sync_secrets from anon, authenticated;
revoke all on public.sync_connections from anon; revoke insert, delete, update on public.sync_connections from authenticated; grant update (account_map) on public.sync_connections to authenticated;
revoke all on public.sync_log from anon; revoke insert, update, delete on public.sync_log from authenticated;
