-- 0024 — saved forecasts (0.35.0, "How accurate was last month's forecast?").
-- Once a month the app saves what the cash calendar expects for the rest of that month: cash at the start, money expected in and out,
-- the balance expected at month end and the lowest point, with the totals by kind of item. When the month is over the app compares the
-- row with the transactions recorded for the same days. One row per household per month.
-- A saved forecast is never edited: there is no update policy, so nobody (the app included) can change one after the fact. Editors can
-- add this month's and delete rows (a restore that replaces everything, or clearing a household's data). Reading follows the Accounts
-- section, like recorded net-worth snapshots — the row holds cash totals.
-- Safe to run more than once.

create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  taken_on date not null,
  through date not null,
  start_cash numeric(14,2) not null default 0,
  expected_in numeric(14,2) not null default 0 check (expected_in >= 0),
  expected_out numeric(14,2) not null default 0 check (expected_out >= 0),
  expected_end numeric(14,2) not null default 0,
  expected_low numeric(14,2) not null default 0,
  low_date date,
  by_source jsonb not null default '{}'::jsonb check (jsonb_typeof(by_source) = 'object'),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forecast_snapshots_window check (through >= taken_on and through - taken_on <= 62),
  constraint forecast_snapshots_one_per_month unique (household_id, through)
);
create index if not exists forecast_snapshots_household on public.forecast_snapshots(household_id, through desc);
alter table public.forecast_snapshots enable row level security;

drop policy if exists forecast_snapshots_select on public.forecast_snapshots;
drop policy if exists forecast_snapshots_insert on public.forecast_snapshots;
drop policy if exists forecast_snapshots_delete on public.forecast_snapshots;
drop policy if exists forecast_snapshots_update on public.forecast_snapshots;
create policy forecast_snapshots_select on public.forecast_snapshots for select to authenticated
  using (is_member(household_id) and module_allowed(household_id, 'accounts'));
create policy forecast_snapshots_insert on public.forecast_snapshots for insert to authenticated
  with check (can_edit(household_id) and module_allowed(household_id, 'accounts'));
create policy forecast_snapshots_delete on public.forecast_snapshots for delete to authenticated
  using (can_edit(household_id) and module_allowed(household_id, 'accounts'));
-- (no update policy on purpose: a saved forecast cannot be changed)

revoke all on public.forecast_snapshots from anon;
grant select, insert, delete on public.forecast_snapshots to authenticated;
revoke update on public.forecast_snapshots from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'forecast_snapshots') then
    alter publication supabase_realtime add table public.forecast_snapshots;
  end if;
end $$;
