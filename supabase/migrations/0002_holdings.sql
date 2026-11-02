-- Applied to the project as migration `wealthpilot_holdings` (2026-11-02).
-- WealthPilot 0.6.0 — investment holdings (positions inside investment / retirement accounts) + retirement plan settings live in households.settings.
create table public.holdings (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  account_id uuid references public.accounts(id) on delete set null,          -- the brokerage / retirement account that holds it
  symbol text, name text not null default 'New holding',
  asset_class text not null default 'stock' check (asset_class in ('stock','etf','mutual_fund','bond','real_estate','cash','crypto','alternative','other')),
  sector text,                                                                  -- e.g. Technology, Healthcare, Broad market, Government
  risk text not null default 'medium' check (risk in ('low','medium','high')),
  quantity numeric not null default 0, price numeric not null default 0, price_as_of date,
  cost_basis numeric not null default 0,                                        -- total cost of the position (for gain / loss)
  value numeric,                                                                -- optional cached market value (quantity × price when both are known)
  expense_ratio numeric, yield_pct numeric,
  notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.holdings(household_id);
create index on public.holdings(account_id);
alter table public.holdings enable row level security;
create policy holdings_select on public.holdings for select to authenticated using (is_member(household_id));
create policy holdings_insert on public.holdings for insert to authenticated with check (can_edit(household_id));
create policy holdings_update on public.holdings for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
create policy holdings_delete on public.holdings for delete to authenticated using (can_edit(household_id));
create trigger trg_holdings_audit before insert or update or delete on public.holdings for each row execute function public.touch_and_log();
create trigger trg_holdings_ref before insert on public.holdings for each row execute function public.assign_ref();
alter publication supabase_realtime add table public.holdings;
