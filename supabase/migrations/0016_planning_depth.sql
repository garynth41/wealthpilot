-- 0016 (0.22.0): planning depth — tax lots for holdings, an insurance register, an estate checklist, account beneficiaries,
-- inflation-grown goal targets. A new access module 'protection' (insurance + estate) is gated like the others.
-- Idempotent: safe to re-run.

-- 1. Tax lots: each purchase of a holding with its date and total cost, so gains split into short- and long-term and losses can be harvested.
create table if not exists public.holding_lots (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  holding_id uuid not null references public.holdings(id) on delete cascade,
  acquired_on date not null, quantity numeric not null check (quantity > 0), cost numeric not null default 0 check (cost >= 0),
  notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists holding_lots_holding on public.holding_lots(holding_id, acquired_on);
create index if not exists holding_lots_household on public.holding_lots(household_id);

-- 2. Insurance register: one row per policy. Only the last four characters of a policy number are kept.
create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  kind text not null default 'other' check (kind in ('life','term_life','health','dental','vision','disability','long_term_care','auto','home','renters','umbrella','pet','travel','other')),
  name text not null default 'Policy', carrier text, insured text,
  policy_last4 text check (policy_last4 is null or policy_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  coverage numeric, deductible numeric, premium numeric not null default 0, premium_frequency text not null default 'monthly' check (premium_frequency in ('monthly','quarterly','semiannual','yearly')),
  renews_on date, beneficiary text, through_employer boolean not null default false,
  recurring_id uuid references public.recurring(id) on delete set null,
  status text not null default 'Active' check (status in ('Active','Lapsed','Cancelled')), notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists insurance_policies_household on public.insurance_policies(household_id);

-- 3. Estate checklist: will, powers of attorney, beneficiaries, where the documents are. Rows are seeded from the app's template.
create table if not exists public.estate_items (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  key text, label text not null, area text not null default 'documents',
  status text not null default 'todo' check (status in ('todo','in_progress','done','na')),
  done_on date, review_on date, location text, notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists estate_items_key on public.estate_items(household_id, key) where key is not null;

-- 4. Beneficiaries on accounts (retirement, brokerage, POD/TOD on bank accounts) and inflation on goal targets.
alter table public.accounts add column if not exists beneficiary text;
alter table public.accounts add column if not exists beneficiary_reviewed_on date;
alter table public.goals add column if not exists inflation_pct numeric check (inflation_pct is null or (inflation_pct >= 0 and inflation_pct <= 20));
alter table public.goals add column if not exists target_base_date date;

-- 5. Row-level security: lots follow Investments; insurance and the estate checklist are the new 'protection' module.
alter table public.holding_lots enable row level security;
alter table public.insurance_policies enable row level security;
alter table public.estate_items enable row level security;
do $$
declare r record;
begin
  for r in select * from (values ('holding_lots','investments'), ('insurance_policies','protection'), ('estate_items','protection')) as t(tbl, mod) loop
    execute format('drop policy if exists %I_select on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_insert on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_update on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_delete on public.%I', r.tbl, r.tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (is_member(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
    execute format('create policy %I_update on public.%I for update to authenticated using (can_edit(household_id) and module_allowed(household_id, %L)) with check (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod, r.mod);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
    execute format('drop trigger if exists trg_%s_audit on public.%I', r.tbl, r.tbl);
    execute format('create trigger trg_%s_audit before insert or update or delete on public.%I for each row execute function public.touch_and_log()', r.tbl, r.tbl);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = r.tbl) then
      execute format('alter publication supabase_realtime add table public.%I', r.tbl);
    end if;
  end loop;
end $$;

-- a lot belongs to a holding of its own household; a policy's linked bill too
create or replace function public.lot_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.holdings h where h.id = new.holding_id and h.household_id = new.household_id) then
    raise exception 'lot must belong to a holding of the same household';
  end if;
  return new;
end $$;
revoke all on function public.lot_same_household() from public, anon, authenticated;
drop trigger if exists trg_holding_lots_household on public.holding_lots;
create trigger trg_holding_lots_household before insert or update on public.holding_lots for each row execute function public.lot_same_household();
create or replace function public.policy_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recurring_id is not null and not exists (select 1 from public.recurring r where r.id = new.recurring_id and r.household_id = new.household_id) then
    raise exception 'linked bill must belong to the same household';
  end if;
  return new;
end $$;
revoke all on function public.policy_same_household() from public, anon, authenticated;
drop trigger if exists trg_insurance_policies_household on public.insurance_policies;
create trigger trg_insurance_policies_household before insert or update on public.insurance_policies for each row execute function public.policy_same_household();

-- refs: insurance policies are Y-001, Y-002 …
drop trigger if exists trg_insurance_policies_ref on public.insurance_policies;
create trigger trg_insurance_policies_ref before insert on public.insurance_policies for each row execute function public.assign_ref();
create or replace function public.assign_ref() returns trigger language plpgsql security definer set search_path = public as $$
declare p text; k int;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  p := case tg_table_name when 'transactions' then 'T' when 'accounts' then 'A' when 'recurring' then 'R' when 'goals' then 'G' when 'planned_items' then 'X'
       when 'hardship_outreach' then 'H' when 'email_items' then 'E' when 'statements' then 'S' when 'pay_schedules' then 'P' when 'categories' then 'C' when 'budget_periods' then 'B'
       when 'holdings' then 'I' when 'reconciliations' then 'K' when 'scenarios' then 'N' when 'insurance_policies' then 'Y' else 'Z' end;
  insert into public.ref_counters(household_id, prefix, n) values (new.household_id, p, 1)
    on conflict (household_id, prefix) do update set n = public.ref_counters.n + 1 returning n into k;
  new.ref := p || '-' || lpad(k::text, 3, '0');
  return new;
end $$;

-- audit summaries for the new tables (same function as 0015 plus three cases)
create or replace function public.touch_and_log() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare hh uuid; rid text; summ text; em text; j jsonb;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('wealthpilot.quiet_audit', true), '') = 'on' then new.updated_at := now(); return new; end if;
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  hh := (j->>'household_id')::uuid; rid := j->>'id';
  select email into em from public.household_members where household_id = hh and user_id = auth.uid() limit 1;
  if tg_op <> 'DELETE' then
    new.updated_at := now();
    if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
    new.updated_by := auth.uid();
  end if;
  summ := case tg_table_name
    when 'transactions' then coalesce(j->>'payee','') || ' ' || coalesce(j->>'amount','')
    when 'accounts' then j->>'name' when 'recurring' then j->>'name' when 'goals' then j->>'name' when 'categories' then j->>'name' when 'pay_schedules' then j->>'name' when 'holdings' then coalesce(j->>'symbol', j->>'name')
    when 'budget_periods' then coalesce(j->>'label', j->>'start_date') when 'planned_items' then j->>'label' when 'hardship_outreach' then j->>'entity' when 'email_items' then coalesce(j->>'payee','') || ' ' || coalesce(j->>'amount','')
    when 'scenarios' then j->>'name' when 'transaction_comments' then left(j->>'body', 80)
    when 'holding_lots' then coalesce(j->>'quantity','') || ' bought ' || coalesce(j->>'acquired_on','')
    when 'insurance_policies' then coalesce(j->>'name','') || ' · ' || coalesce(j->>'kind','')
    when 'estate_items' then coalesce(j->>'label','') || ' · ' || coalesce(j->>'status','')
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;
