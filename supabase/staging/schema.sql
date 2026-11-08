-- Cresari staging schema: 19 migration(s) from 0001_init.sql to 0019_accounts_and_speed.sql, production-only jobs removed

-- ===== 0001_init.sql =====
-- PocketLedger — initial schema (v0.1)
-- Personal budgeting, savings and financial planning. One "household" per family/user; every row is scoped to a household.
-- Conventions: uuid ids, numeric money (2dp), dates as date, 'YYYY-MM' period keys where a month is meant.
-- Security: RLS on every table through is_member / can_edit / is_owner (security definer helpers that never recurse).

create extension if not exists pgcrypto;

-- ===================== households & membership =====================
create type public.member_role as enum ('owner','editor','viewer');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My household',
  currency text not null default 'USD',
  settings jsonb not null default '{}'::jsonb,     -- app settings: pay cadence default, runway thresholds, email capture config & remembered payees, ui prefs
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.member_role not null default 'owner',
  read_only boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_version text,
  primary key (household_id, user_id)
);
create index on public.household_members(user_id);
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'viewer',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (household_id, email)
);

create or replace function public.member_role(hh uuid) returns public.member_role language sql stable security definer set search_path = public as $$
  select role from public.household_members where household_id = hh and user_id = auth.uid(); $$;
create or replace function public.is_member(hh uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid()); $$;
create or replace function public.can_edit(hh uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and role in ('owner','editor') and not read_only); $$;
create or replace function public.is_owner(hh uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and role = 'owner'); $$;

-- ===================== audit + updated_at =====================
create table public.activity_log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id), user_email text,
  action text not null, table_name text not null, record_id text, summary text,
  created_at timestamptz not null default now()
);
create index on public.activity_log(household_id, created_at desc);

create or replace function public.touch_and_log() returns trigger language plpgsql security definer set search_path = public as $$
declare hh uuid; rid text; summ text; em text; j jsonb;
begin
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
    when 'accounts' then j->>'name' when 'recurring' then j->>'name' when 'goals' then j->>'name' when 'categories' then j->>'name' when 'pay_schedules' then j->>'name'
    when 'budget_periods' then coalesce(j->>'label', j->>'start_date') when 'planned_items' then j->>'label' when 'hardship_outreach' then j->>'entity' when 'email_items' then coalesce(j->>'payee','') || ' ' || coalesce(j->>'amount','')
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

-- human-friendly reference numbers (A-001, T-0042 …) assigned server-side, never reused
create table public.ref_counters (household_id uuid not null references public.households(id) on delete cascade, prefix text not null, n int not null default 0, primary key (household_id, prefix));
create or replace function public.assign_ref() returns trigger language plpgsql security definer set search_path = public as $$
declare p text; k int;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  p := case tg_table_name when 'transactions' then 'T' when 'accounts' then 'A' when 'recurring' then 'R' when 'goals' then 'G' when 'planned_items' then 'X'
       when 'hardship_outreach' then 'H' when 'email_items' then 'E' when 'statements' then 'S' when 'pay_schedules' then 'P' when 'categories' then 'C' when 'budget_periods' then 'B' else 'Z' end;
  insert into public.ref_counters(household_id, prefix, n) values (new.household_id, p, 1)
    on conflict (household_id, prefix) do update set n = public.ref_counters.n + 1 returning n into k;
  new.ref := p || '-' || lpad(k::text, 3, '0');
  return new;
end $$;

-- ===================== accounts (cash, investments, credit cards, loans) =====================
create table public.accounts (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'New account',
  kind text not null default 'checking' check (kind in ('checking','savings','cash','investment','retirement','credit_card','store_card','loan','auto_loan','student_loan','mortgage','bnpl','line_of_credit','medical','collection','other_asset','other_liability')),
  institution text, last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  balance numeric not null default 0,                 -- assets: cash available; liabilities: amount owed (positive)
  balance_as_of date,
  credit_limit numeric, apr numeric not null default 0,
  statement_date date, statement_balance numeric, minimum_payment numeric not null default 0, due_date date, planned_payment numeric,
  autopay boolean not null default false, autopay_account_id uuid references public.accounts(id) on delete set null,
  last_paid_due date,
  include_in_cash boolean not null default true,       -- counts toward "cash on hand" / runway (false for retirement, locked money)
  include_in_net_worth boolean not null default true,
  status text not null default 'Active' check (status in ('Active','Paid off','Closed','Hidden')),
  color text, icon text, sort_order int not null default 0, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.accounts(household_id);

-- statement history for liabilities (what each bill said)
create table public.statements (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  account_id uuid not null references public.accounts(id) on delete cascade,
  statement_date date not null default current_date, statement_balance numeric not null default 0, minimum_payment numeric not null default 0, due_date date,
  paid_on date, paid_amount numeric, source text not null default 'manual', notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.statements(account_id, statement_date desc);

-- ===================== categories =====================
create table public.categories (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null, "group" text,                     -- e.g. group 'Housing', name 'Rent'
  kind text not null default 'expense' check (kind in ('expense','income','transfer')),
  priority text not null default 'Essential' check (priority in ('Essential','Important','Discretionary')),
  cost_type text not null default 'Variable' check (cost_type in ('Fixed','Variable','Irregular')),
  default_budget numeric not null default 0,            -- the planned amount copied into each new period
  budget_cadence text not null default 'period' check (budget_cadence in ('period','monthly','yearly')),  -- yearly: sinking fund spread per period
  rollover boolean not null default false,               -- unspent carries into the next period (Copilot-style)
  color text, icon text, sort_order int not null default 0, archived boolean not null default false, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.categories(household_id);

-- ===================== income: pay schedules =====================
create table public.pay_schedules (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'Paycheck', payer text, kind text not null default 'salary' check (kind in ('salary','hourly','benefit','severance','side','rental','investment','support','other')),
  frequency text not null default 'biweekly' check (frequency in ('weekly','biweekly','semimonthly','monthly','quarterly','yearly','irregular')),
  anchor_date date not null default current_date,       -- a known pay date; every other pay date is computed from it
  semimonthly_days int[] default '{15,31}',             -- for semimonthly: the two days (31 = last day)
  gross_amount numeric, net_amount numeric not null default 0, hours_per_period numeric, hourly_rate numeric,
  deposit_account_id uuid references public.accounts(id) on delete set null, category_id uuid references public.categories(id) on delete set null,
  starts_on date, ends_on date, status text not null default 'Active' check (status in ('Active','Paused','Ended')), notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.pay_schedules(household_id);

-- ===================== budget periods (month, pay period, or custom) =====================
create table public.budget_periods (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  period_type text not null default 'month' check (period_type in ('month','week','biweekly','semimonthly','pay','custom')),
  start_date date not null, end_date date not null,
  label text, status text not null default 'open' check (status in ('planned','open','closed')),
  expected_income numeric not null default 0, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date >= start_date), unique (household_id, start_date, end_date)
);
create index on public.budget_periods(household_id, start_date desc);
create table public.budget_lines (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  period_id uuid not null references public.budget_periods(id) on delete cascade, category_id uuid not null references public.categories(id) on delete cascade,
  planned numeric not null default 0, rollover_in numeric not null default 0, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (period_id, category_id)
);
create index on public.budget_lines(household_id);

-- ===================== transactions (the ledger — actuals are always derived from here) =====================
create table public.transactions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  "date" date not null default current_date,
  kind text not null default 'expense' check (kind in ('expense','income','transfer')),
  amount numeric not null default 0 check (amount >= 0),  -- always positive; kind + accounts give direction
  account_id uuid references public.accounts(id) on delete set null,            -- expense: paid from; income: deposited to; transfer: from
  to_account_id uuid references public.accounts(id) on delete set null,         -- transfer: to (a liability account here = a debt payment)
  category_id uuid references public.categories(id) on delete set null,
  payee text, memo text, tags text[] not null default '{}',
  status text not null default 'cleared' check (status in ('pending','cleared','void')),
  source text not null default 'manual' check (source in ('manual','email','import','recurring','statement','adjustment')),
  recurring_id uuid, pay_schedule_id uuid references public.pay_schedules(id) on delete set null, goal_id uuid,
  email_item_id uuid, external_id text,
  exclude_from_budget boolean not null default false,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.transactions(household_id, "date" desc);
create index on public.transactions(category_id);
create index on public.transactions(account_id);
create unique index transactions_external_idx on public.transactions(household_id, external_id) where external_id is not null;

-- ===================== recurring bills, subscriptions and income =====================
create table public.recurring (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'New bill', payee text,
  kind text not null default 'bill' check (kind in ('bill','subscription','debt_payment','income','transfer','savings')),
  amount numeric not null default 0, amount_varies boolean not null default false,
  frequency text not null default 'monthly' check (frequency in ('weekly','biweekly','semimonthly','monthly','every_2_months','quarterly','every_6_months','yearly','irregular')),
  day_of_month int check (day_of_month is null or day_of_month between 1 and 31), next_due date,
  account_id uuid references public.accounts(id) on delete set null,          -- paid from / deposited to
  liability_account_id uuid references public.accounts(id) on delete set null,-- for debt_payment: the card or loan being paid
  category_id uuid references public.categories(id) on delete set null,
  autopay boolean not null default false, reminder_days int not null default 3,
  starts_on date, ends_on date, status text not null default 'Active' check (status in ('Active','Paused','Cancelled')),
  last_paid_on date, last_paid_amount numeric, notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.recurring(household_id);
alter table public.transactions add constraint transactions_recurring_fk foreign key (recurring_id) references public.recurring(id) on delete set null;

-- each expected occurrence of a bill once it is due/paid/skipped (upcoming ones are computed, not stored, until touched)
create table public.bill_occurrences (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  recurring_id uuid not null references public.recurring(id) on delete cascade,
  due_date date not null, amount numeric not null default 0,
  status text not null default 'due' check (status in ('due','scheduled','paid','skipped','overdue')),
  paid_on date, transaction_id uuid references public.transactions(id) on delete set null, email_item_id uuid, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (recurring_id, due_date)
);
create index on public.bill_occurrences(household_id, due_date);

-- ===================== savings goals =====================
create table public.goals (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'New goal', kind text not null default 'savings' check (kind in ('savings','emergency_fund','debt_payoff','sinking_fund','purchase','other')),
  target_amount numeric not null default 0, target_date date, account_id uuid references public.accounts(id) on delete set null,
  starting_amount numeric not null default 0, monthly_contribution numeric not null default 0, priority int not null default 2,
  status text not null default 'Active' check (status in ('Active','Paused','Reached','Cancelled')), color text, icon text, notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.goals(household_id);
alter table public.transactions add constraint transactions_goal_fk foreign key (goal_id) references public.goals(id) on delete set null;
create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade, "date" date not null default current_date, amount numeric not null default 0,
  transaction_id uuid references public.transactions(id) on delete set null, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.goal_contributions(goal_id);

-- ===================== planning: one-off items, snapshots, hardship =====================
create table public.planned_items (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  "date" date not null default current_date, label text not null default 'Planned item', category text not null default 'Other',
  amount numeric not null default 0,                     -- + money in, − money out
  status text not null default 'Planned' check (status in ('Planned','Done','Cancelled')), transaction_id uuid references public.transactions(id) on delete set null, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.planned_items(household_id, "date");
create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  "date" date not null default current_date, cash numeric not null default 0, assets numeric not null default 0, liabilities numeric not null default 0,
  by_account jsonb not null default '{}'::jsonb, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (household_id, "date")
);
create table public.hardship_outreach (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  entity text not null default 'New creditor', "type" text not null default 'Credit card',
  account_id uuid references public.accounts(id) on delete set null, recurring_id uuid references public.recurring(id) on delete set null,
  monthly_obligation numeric, phone text, contact_name text, status text not null default 'To call', program text,
  relief_monthly numeric, relief_start date, relief_end date, last_contact date, next_followup date, reference text, outcome text, notes text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.hardship_outreach(household_id);

-- ===================== email money capture (Gmail / Outlook) =====================
-- A record of every bill, statement, payment, deposit and alert approved from email, with the evidence (message ids + masked subjects only — bodies are never stored).
create table public.email_items (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  kind text not null check (kind in ('paid','income','bill','scheduled','pastdue','declined','alert','balance')),
  payee text, last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  amount numeric, min_due numeric, balance numeric, fee numeric, due_date date, txn_date date, status text, autopay boolean not null default false,
  account_id uuid references public.accounts(id) on delete set null, category_id uuid references public.categories(id) on delete set null,
  recurring_id uuid references public.recurring(id) on delete set null, transaction_id uuid references public.transactions(id) on delete set null,
  statement_id uuid references public.statements(id) on delete set null, bill_item_id uuid references public.email_items(id) on delete set null,
  src text, evidence jsonb not null default '[]'::jsonb, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.email_items(household_id, txn_date);
alter table public.transactions add constraint transactions_email_fk foreign key (email_item_id) references public.email_items(id) on delete set null;
alter table public.bill_occurrences add constraint bill_occ_email_fk foreign key (email_item_id) references public.email_items(id) on delete set null;
-- which messages were already reviewed (applied or ignored), so the same email is never proposed twice
create table public.email_ledger (
  household_id uuid not null references public.households(id) on delete cascade,
  message_id text not null, src text not null default 'gmail', decision text not null check (decision in ('applied','ignored')),
  subject text, message_at timestamptz, decided_at timestamptz not null default now(),
  primary key (household_id, message_id)
);

-- ===================== app meta (version banner) =====================
create table public.app_meta (key text primary key, value text not null, updated_at timestamptz not null default now());
insert into public.app_meta(key, value) values ('latest_version', '0.1.0') on conflict (key) do nothing;

-- ===================== RLS =====================
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.activity_log enable row level security;
alter table public.ref_counters enable row level security;
alter table public.app_meta enable row level security;

create policy households_select on public.households for select to authenticated using (is_member(id));
create policy households_update on public.households for update to authenticated using (is_owner(id)) with check (is_owner(id));
create policy members_select on public.household_members for select to authenticated using (is_member(household_id));
create policy members_insert on public.household_members for insert to authenticated with check (is_owner(household_id));
create policy members_update on public.household_members for update to authenticated using (is_owner(household_id) or user_id = auth.uid()) with check (is_owner(household_id) or user_id = auth.uid());
create policy members_delete on public.household_members for delete to authenticated using (is_owner(household_id) and user_id <> auth.uid());
create policy invites_all on public.household_invites for all to authenticated using (is_owner(household_id)) with check (is_owner(household_id));
create policy invites_mine on public.household_invites for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy activity_select on public.activity_log for select to authenticated using (is_member(household_id));
create policy refs_none on public.ref_counters for select to authenticated using (is_owner(household_id));
create policy app_meta_read on public.app_meta for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['accounts','statements','categories','pay_schedules','budget_periods','budget_lines','transactions','recurring','bill_occurrences','goals','goal_contributions','planned_items','net_worth_snapshots','hardship_outreach','email_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated using (is_member(household_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (can_edit(household_id))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (can_edit(household_id))', t, t);
    execute format('create trigger trg_%I_audit before insert or update or delete on public.%I for each row execute function public.touch_and_log()', t, t);
  end loop;
  foreach t in array array['accounts','statements','categories','pay_schedules','budget_periods','transactions','recurring','goals','planned_items','hardship_outreach','email_items'] loop
    execute format('create trigger trg_%I_ref before insert on public.%I for each row execute function public.assign_ref()', t, t);
  end loop;
end $$;
alter table public.email_ledger enable row level security;
create policy email_ledger_all on public.email_ledger for all to authenticated using (can_edit(household_id)) with check (can_edit(household_id));

-- ===================== bootstrap: create a household with the caller as owner and a starter category set =====================
create or replace function public.create_household(p_name text default 'My household') returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid; em text;
begin
  select email into em from auth.users where id = auth.uid();
  insert into public.households(name, created_by) values (coalesce(nullif(p_name,''),'My household'), auth.uid()) returning id into hh;
  insert into public.household_members(household_id, user_id, email, role) values (hh, auth.uid(), coalesce(em,''), 'owner');
  insert into public.categories(household_id, "group", name, kind, priority, cost_type, sort_order) values
    (hh,'Income','Paycheck','income','Essential','Fixed',1),(hh,'Income','Benefits','income','Essential','Fixed',2),(hh,'Income','Side income','income','Important','Variable',3),(hh,'Income','Other income','income','Important','Irregular',4),
    (hh,'Housing','Rent / mortgage','expense','Essential','Fixed',10),(hh,'Housing','Electric','expense','Essential','Variable',11),(hh,'Housing','Gas','expense','Essential','Variable',12),(hh,'Housing','Water / sewer / trash','expense','Essential','Variable',13),(hh,'Housing','Internet','expense','Essential','Fixed',14),(hh,'Housing','Home maintenance','expense','Important','Irregular',15),
    (hh,'Transport','Car payment','expense','Essential','Fixed',20),(hh,'Transport','Fuel','expense','Essential','Variable',21),(hh,'Transport','Car insurance','expense','Essential','Fixed',22),(hh,'Transport','Maintenance & repairs','expense','Important','Irregular',23),(hh,'Transport','Parking / tolls / transit','expense','Important','Variable',24),
    (hh,'Food','Groceries','expense','Essential','Variable',30),(hh,'Food','Dining out','expense','Discretionary','Variable',31),(hh,'Food','Coffee & snacks','expense','Discretionary','Variable',32),
    (hh,'Health','Health insurance','expense','Essential','Fixed',40),(hh,'Health','Medical & dental','expense','Essential','Irregular',41),(hh,'Health','Pharmacy','expense','Essential','Variable',42),(hh,'Health','Gym & fitness','expense','Discretionary','Fixed',43),
    (hh,'Bills','Phone','expense','Essential','Fixed',50),(hh,'Bills','Subscriptions & streaming','expense','Discretionary','Fixed',51),(hh,'Bills','Insurance (other)','expense','Important','Fixed',52),(hh,'Bills','Education / childcare','expense','Essential','Fixed',53),
    (hh,'Debt','Credit card payments','expense','Essential','Fixed',60),(hh,'Debt','Loan payments','expense','Essential','Fixed',61),(hh,'Debt','Interest & fees','expense','Important','Variable',62),
    (hh,'Personal','Shopping','expense','Discretionary','Variable',70),(hh,'Personal','Personal care','expense','Important','Variable',71),(hh,'Personal','Entertainment','expense','Discretionary','Variable',72),(hh,'Personal','Gifts & giving','expense','Discretionary','Irregular',73),(hh,'Personal','Travel','expense','Discretionary','Irregular',74),(hh,'Personal','Kids & family','expense','Essential','Variable',75),(hh,'Personal','Pets','expense','Important','Variable',76),
    (hh,'Savings','Emergency fund','expense','Essential','Fixed',80),(hh,'Savings','Savings goals','expense','Important','Fixed',81),(hh,'Savings','Investing','expense','Important','Fixed',82),
    (hh,'Other','Taxes & fees','expense','Essential','Irregular',90),(hh,'Other','Miscellaneous','expense','Important','Variable',91),(hh,'Other','Transfer','transfer','Essential','Variable',99);
  return hh;
end $$;
grant execute on function public.create_household(text) to authenticated;

-- accept an invite for the signed-in user (by their email)
create or replace function public.accept_invites() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; em text;
begin
  select email into em from auth.users where id = auth.uid();
  for r in select * from public.household_invites where lower(email) = lower(coalesce(em,'')) and accepted_at is null loop
    insert into public.household_members(household_id, user_id, email, role) values (r.household_id, auth.uid(), em, r.role) on conflict do nothing;
    update public.household_invites set accepted_at = now() where id = r.id; n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.accept_invites() to authenticated;

-- start a new budget period from the previous one's planned amounts (idempotent)
create or replace function public.start_period(p_household uuid, p_type text, p_start date, p_end date, p_label text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; prev uuid;
begin
  if not public.can_edit(p_household) then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext(p_household::text || ':period'));
  select id into pid from public.budget_periods where household_id = p_household and start_date = p_start and end_date = p_end;
  if pid is not null then return pid; end if;
  insert into public.budget_periods(household_id, period_type, start_date, end_date, label, status) values (p_household, p_type, p_start, p_end, p_label, case when p_start > current_date then 'planned' else 'open' end) returning id into pid;
  select id into prev from public.budget_periods where household_id = p_household and id <> pid and start_date < p_start order by start_date desc limit 1;
  if prev is not null then
    insert into public.budget_lines(household_id, period_id, category_id, planned, rollover_in)
      select p_household, pid, bl.category_id, bl.planned,
        case when c.rollover then greatest(0, bl.planned + bl.rollover_in - coalesce((select sum(t.amount) from public.transactions t where t.household_id = p_household and t.category_id = bl.category_id and t.kind = 'expense' and t.status <> 'void' and not t.exclude_from_budget and t."date" between pp.start_date and pp.end_date),0)) else 0 end
      from public.budget_lines bl join public.categories c on c.id = bl.category_id join public.budget_periods pp on pp.id = bl.period_id where bl.period_id = prev and not c.archived;
  else
    insert into public.budget_lines(household_id, period_id, category_id, planned)
      select p_household, pid, c.id, c.default_budget from public.categories c where c.household_id = p_household and not c.archived and c.kind in ('expense','income');
  end if;
  return pid;
end $$;
grant execute on function public.start_period(uuid, text, date, date, text) to authenticated;

-- realtime: every data table
do $$
declare t text;
begin
  foreach t in array array['accounts','statements','categories','pay_schedules','budget_periods','budget_lines','transactions','recurring','bill_occurrences','goals','goal_contributions','planned_items','net_worth_snapshots','hardship_outreach','email_items','households','household_members'] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- ===================== function grants (applied as migration pocketledger_function_grants + helper_grants) =====================
revoke execute on function public.member_role(uuid) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.can_edit(uuid) from public, anon;
revoke execute on function public.is_owner(uuid) from public, anon;
revoke execute on function public.touch_and_log() from public, anon, authenticated;
revoke execute on function public.assign_ref() from public, anon, authenticated;
revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.accept_invites() from public, anon;
revoke execute on function public.start_period(uuid, text, date, date, text) from public, anon;
grant execute on function public.member_role(uuid), public.is_member(uuid), public.can_edit(uuid), public.is_owner(uuid) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;


-- ===== 0002_holdings.sql =====
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


-- ===== 0003_member_access.sql =====
-- WealthPilot 0.10 — member access by module, invitations with a temporary password.
-- A member's `modules` (null = everything) limits which sections they can see; the same map lives in src/lib/access.ts (MODULES).
-- Row-level security enforces it here, so a limited member's API calls cannot read other modules' tables at all.

alter table public.household_members add column if not exists modules text[];            -- null = all modules
alter table public.household_invites
  add column if not exists modules text[],
  add column if not exists read_only boolean not null default false,
  add column if not exists display_name text,
  add column if not exists invited_user_id uuid references auth.users(id) on delete set null,
  add column if not exists temp_password_issued_at timestamptz,                               -- when a temporary password was created (never the password itself)
  add column if not exists sent_at timestamptz;                                               -- when the invitation email was sent automatically

-- Is the signed-in user allowed to see module m of household hh? (owners always; null modules = all)
create or replace function public.module_allowed(hh uuid, m text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and (role = 'owner' or modules is null or m = any(modules))); $$;
revoke execute on function public.module_allowed(uuid, text) from public, anon;
grant execute on function public.module_allowed(uuid, text) to authenticated;

-- Re-create the four policies on every module-gated table with the module check added. Tables not listed (categories, households, members, activity) stay member-wide.
do $$
declare r record;
begin
  for r in select * from (values
      ('transactions','transactions'), ('budget_periods','budget'), ('budget_lines','budget'), ('planned_items','budget'),
      ('recurring','bills'), ('bill_occurrences','bills'), ('pay_schedules','income'),
      ('accounts','accounts'), ('statements','accounts'), ('net_worth_snapshots','accounts'),
      ('email_items','connections'), ('holdings','investments'), ('goals','goals'), ('goal_contributions','goals'), ('hardship_outreach','hardship')
    ) as t(tbl, mod) loop
    execute format('drop policy if exists %I_select on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_insert on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_update on public.%I', r.tbl, r.tbl);
    execute format('drop policy if exists %I_delete on public.%I', r.tbl, r.tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (is_member(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
    execute format('create policy %I_update on public.%I for update to authenticated using (can_edit(household_id) and module_allowed(household_id, %L)) with check (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod, r.mod);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (can_edit(household_id) and module_allowed(household_id, %L))', r.tbl, r.tbl, r.mod);
  end loop;
end $$;
drop policy if exists email_ledger_all on public.email_ledger;
create policy email_ledger_all on public.email_ledger for all to authenticated using (can_edit(household_id) and module_allowed(household_id, 'connections')) with check (can_edit(household_id) and module_allowed(household_id, 'connections'));

-- Invites accepted at sign-in carry the module list and read-only flag.
create or replace function public.accept_invites() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; em text;
begin
  select email into em from auth.users where id = auth.uid();
  for r in select * from public.household_invites where lower(email) = lower(coalesce(em,'')) and accepted_at is null loop
    insert into public.household_members(household_id, user_id, email, display_name, role, read_only, modules) values (r.household_id, auth.uid(), em, r.display_name, r.role, r.read_only, r.modules) on conflict do nothing;
    update public.household_invites set accepted_at = now(), invited_user_id = auth.uid() where id = r.id; n := n + 1;
  end loop;
  return n;
end $$;

-- An owner may not remove their own owner role through the members policy if they are the last owner (the UI blocks self-edits; this is the backstop).
create or replace function public.guard_last_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner' and not exists (select 1 from public.household_members where household_id = old.household_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'a household must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_members_last_owner on public.household_members;
create trigger trg_members_last_owner before update or delete on public.household_members for each row execute function public.guard_last_owner();
revoke execute on function public.guard_last_owner() from public, anon, authenticated;   -- trigger-only

-- Service-role helper for the invite-member edge function: find an existing account by email. Not callable by app users.
create or replace function public.user_id_by_email(p_email text) returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1; $$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;


-- ===== 0004_bank_sync.sql =====
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


-- ===== 0005_daily_bank_sync.sql =====
-- 0005 — daily automatic bank sync (SimpleFIN) without anyone handling a secret.
-- A random caller secret is generated inside the database and kept in Vault. The pg_cron job reads it at run time
-- and sends it to the sync-simplefin edge function, which checks it with cron_secret_ok() (service role only).
-- The Authorization header carries the project's public anon key, which the edge gateway (verify_jwt) needs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wealthpilot_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'wealthpilot_cron_secret', 'Daily bank sync: proves a sync_all call came from pg_cron');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(length(p) >= 32, false) and exists (select 1 from vault.decrypted_secrets where name = 'wealthpilot_cron_secret' and decrypted_secret = p) $$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- 10:17 UTC = 5:17 am Eastern (6:17 am in summer): banks have posted the previous day by then.
-- (scheduled job left out of staging)


-- ===== 0006_advisor_fixes.sql =====
-- 0006 — advisor follow-ups after 0005.
-- 1) pg_net belongs in the extensions schema, not public (its functions stay in the net schema, so the cron job is unchanged).
drop extension if exists pg_net;
create extension pg_net schema extensions;

-- 2) evaluate auth.uid() / auth.jwt() once per query, not once per row.
drop policy if exists members_update on public.household_members;
create policy members_update on public.household_members for update to authenticated
  using (is_owner(household_id) or user_id = (select auth.uid()))
  with check (is_owner(household_id) or user_id = (select auth.uid()));
drop policy if exists members_delete on public.household_members;
create policy members_delete on public.household_members for delete to authenticated
  using (is_owner(household_id) and user_id <> (select auth.uid()));

-- 3) household_invites: one SELECT policy (owner, or the invite addressed to me) instead of two overlapping ones.
drop policy if exists invites_all on public.household_invites;
drop policy if exists invites_mine on public.household_invites;
create policy invites_select on public.household_invites for select to authenticated
  using (is_owner(household_id) or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
create policy invites_insert on public.household_invites for insert to authenticated with check (is_owner(household_id));
create policy invites_update on public.household_invites for update to authenticated using (is_owner(household_id)) with check (is_owner(household_id));
create policy invites_delete on public.household_invites for delete to authenticated using (is_owner(household_id));


-- ===== 0007_unique_transactions.sql =====
-- 0007 — every real transaction counted once.
-- A duplicate is never deleted: it points at the copy that is kept (duplicate_of) and the app leaves it out of every total.
-- dedupe_ok = the owner said "these are two different transactions" — the automatic merge never touches that row again.
-- The rules live in src/lib/dedupe.ts (app) and supabase/functions/sync-simplefin/dedupe.ts (bank sync; identical copy).
alter table public.transactions add column if not exists duplicate_of uuid references public.transactions(id) on delete set null;
alter table public.transactions add column if not exists dedupe_ok boolean not null default false;
alter table public.transactions drop constraint if exists transactions_not_self_duplicate;
alter table public.transactions add constraint transactions_not_self_duplicate check (duplicate_of is null or duplicate_of <> id);
create index if not exists transactions_duplicate_of_idx on public.transactions (duplicate_of) where duplicate_of is not null;

-- bank sync can now be asked to re-read history ("Load year-to-date history")
alter table public.sync_log drop constraint if exists sync_log_trigger_check;
alter table public.sync_log add constraint sync_log_trigger_check check (trigger in ('manual', 'daily', 'connect', 'backfill'));


-- ===== 0008_checkbook_reconciliation.sql =====
-- 0008 — Cash & Account Operations: checkbook reconciliation, verified balances, immutable audit trail.
-- Rules live in src/lib/reconcile.ts (identical copy in the bank-sync function). See docs/RECONCILIATION.md.

-- verified balance = what the institution last reported + outstanding register entries (computed in the app and in the sync function)
alter table public.accounts add column if not exists bank_balance numeric;
alter table public.accounts add column if not exists bank_balance_as_of date;
alter table public.accounts add column if not exists last_reconciled_on date;
alter table public.accounts add column if not exists last_reconciled_balance numeric;

-- check register fields on transactions
alter table public.transactions add column if not exists check_number text;
alter table public.transactions add column if not exists cleared_on date;
alter table public.transactions add column if not exists reconciliation_id uuid;
create index if not exists transactions_check_number_idx on public.transactions (household_id, account_id, check_number) where check_number is not null;
create index if not exists transactions_reconciliation_idx on public.transactions (reconciliation_id) where reconciliation_id is not null;

-- one completed statement reconciliation per account and statement
create table if not exists public.reconciliations (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  account_id uuid not null references public.accounts(id) on delete cascade,
  statement_date date not null, statement_balance numeric not null, opening_balance numeric not null default 0,
  cleared_deposits numeric not null default 0, cleared_payments numeric not null default 0, item_count int not null default 0,
  book_balance numeric not null default 0, outstanding_checks numeric not null default 0, deposits_in_transit numeric not null default 0,
  reconciled_balance numeric not null default 0, variance numeric not null default 0,
  adjustment numeric not null default 0, adjustment_reason text, status text not null default 'completed' check (status in ('completed','completed_with_adjustment')), notes text,
  completed_at timestamptz not null default now(), completed_by uuid references auth.users(id), completed_by_email text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists reconciliations_account_idx on public.reconciliations (household_id, account_id, statement_date desc);
alter table public.transactions drop constraint if exists transactions_reconciliation_fk;
alter table public.transactions add constraint transactions_reconciliation_fk foreign key (reconciliation_id) references public.reconciliations(id) on delete set null;
alter table public.reconciliations enable row level security;
create policy reconciliations_select on public.reconciliations for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'accounts'));
create policy reconciliations_insert on public.reconciliations for insert to authenticated with check (can_edit(household_id) and module_allowed(household_id, 'accounts'));
-- completed reconciliations are history: no update or delete policy (the audit trail must stay true)
create trigger trg_reconciliations_audit before insert or update or delete on public.reconciliations for each row execute function public.touch_and_log();
create trigger trg_reconciliations_ref before insert on public.reconciliations for each row execute function public.assign_ref();

-- immutable audit trail for cash operations (imports, syncs, matches, overrides, reconciliations, balance changes)
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  kind text not null check (kind in ('import','sync','sync_failure','adjustment','override','reconciliation','correction','balance_change','match','unmatch','register')),
  summary text not null, detail jsonb, user_id uuid references auth.users(id), user_email text, created_at timestamptz not null default now()
);
create index if not exists audit_events_hh_idx on public.audit_events (household_id, created_at desc);
alter table public.audit_events enable row level security;
create policy audit_events_select on public.audit_events for select to authenticated using (is_member(household_id));
create policy audit_events_insert on public.audit_events for insert to authenticated with check (can_edit(household_id));
create or replace function public.audit_immutable() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'audit_events are immutable'; end $$;
create trigger trg_audit_events_immutable before update or delete on public.audit_events for each row execute function public.audit_immutable();

-- every balance change on an account is recorded, whoever or whatever made it
create or replace function public.account_balance_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare em text;
begin
  if new.balance is distinct from old.balance or new.bank_balance is distinct from old.bank_balance then
    select email into em from public.household_members where household_id = new.household_id and user_id = auth.uid() limit 1;
    insert into public.audit_events(household_id, account_id, kind, summary, detail, user_id, user_email)
    values (new.household_id, new.id, 'balance_change', left(new.name || ': ' || coalesce(old.balance::text,'—') || ' → ' || coalesce(new.balance::text,'—') || case when new.bank_balance is distinct from old.bank_balance then ' · bank ' || coalesce(old.bank_balance::text,'—') || ' → ' || coalesce(new.bank_balance::text,'—') else '' end, 300),
            jsonb_build_object('balance', jsonb_build_array(old.balance, new.balance), 'bank_balance', jsonb_build_array(old.bank_balance, new.bank_balance), 'as_of', new.bank_balance_as_of), auth.uid(), em);
  end if;
  return new;
end $$;
drop trigger if exists trg_accounts_balance_audit on public.accounts;
create trigger trg_accounts_balance_audit after update on public.accounts for each row execute function public.account_balance_audit();

-- complete a reconciliation atomically: record it, tick the items, set the account's verified balance, write the audit events
create or replace function public.complete_reconciliation(p jsonb) returns public.reconciliations
language plpgsql security definer set search_path = public as $$
declare hh uuid := (p->>'household_id')::uuid; acct public.accounts; rec public.reconciliations; em text; ids uuid[]; adj numeric := coalesce((p->>'adjustment')::numeric, 0); outstanding_eff numeric;
begin
  if not (can_edit(hh) and module_allowed(hh, 'accounts')) then raise exception 'not allowed'; end if;
  select * into acct from public.accounts where id = (p->>'account_id')::uuid and household_id = hh for update;
  if acct.id is null then raise exception 'account not found'; end if;
  if adj <> 0 and coalesce(p->>'adjustment_reason', '') = '' then raise exception 'an adjustment needs a reason'; end if;
  select email into em from public.household_members where household_id = hh and user_id = auth.uid() limit 1;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(coalesce(p->'cleared_ids', '[]'::jsonb)) x;
  insert into public.reconciliations(household_id, account_id, statement_date, statement_balance, opening_balance, cleared_deposits, cleared_payments, item_count, book_balance, outstanding_checks, deposits_in_transit, reconciled_balance, variance, adjustment, adjustment_reason, status, notes, completed_by, completed_by_email)
  values (hh, acct.id, (p->>'statement_date')::date, (p->>'statement_balance')::numeric, coalesce((p->>'opening_balance')::numeric, 0), coalesce((p->>'cleared_deposits')::numeric, 0), coalesce((p->>'cleared_payments')::numeric, 0), coalesce(array_length(ids, 1), 0),
          coalesce((p->>'book_balance')::numeric, 0), coalesce((p->>'outstanding_checks')::numeric, 0), coalesce((p->>'deposits_in_transit')::numeric, 0), coalesce((p->>'reconciled_balance')::numeric, 0), coalesce((p->>'variance')::numeric, 0),
          adj, nullif(p->>'adjustment_reason', ''), case when adj <> 0 then 'completed_with_adjustment' else 'completed' end, nullif(p->>'notes', ''), auth.uid(), em)
  returning * into rec;
  if ids is not null then
    update public.transactions set reconciliation_id = rec.id, cleared_on = coalesce(cleared_on, rec.statement_date), status = case when status = 'pending' then 'cleared' else status end
    where household_id = hh and id = any(ids);
  end if;
  -- verified balance = statement balance + what is still outstanding (register entries the bank has not shown)
  select coalesce(sum(case when t.kind = 'income' or (t.kind = 'transfer' and t.to_account_id = acct.id) then t.amount else -t.amount end * case when acct.kind in ('credit_card','store_card','loan','auto_loan','student_loan','mortgage','bnpl','line_of_credit','medical','collection','other_liability') then -1 else 1 end), 0)
    into outstanding_eff from public.transactions t
    where t.household_id = hh and (t.account_id = acct.id or t.to_account_id = acct.id) and t.duplicate_of is null and t.status = 'pending' and t.external_id is null;
  update public.accounts set bank_balance = rec.statement_balance, bank_balance_as_of = rec.statement_date, last_reconciled_on = rec.statement_date, last_reconciled_balance = rec.reconciled_balance,
    balance = rec.statement_balance + outstanding_eff, balance_as_of = rec.statement_date where id = acct.id;
  insert into public.audit_events(household_id, account_id, kind, summary, detail, user_id, user_email)
  values (hh, acct.id, 'reconciliation', left(format('Reconciled %s to %s: statement %s, %s items, variance %s', acct.name, rec.statement_date, rec.statement_balance, rec.item_count, rec.variance), 300), jsonb_build_object('reconciliation_id', rec.id, 'variance', rec.variance, 'reconciled_balance', rec.reconciled_balance), auth.uid(), em);
  if adj <> 0 then
    insert into public.audit_events(household_id, account_id, kind, summary, detail, user_id, user_email)
    values (hh, acct.id, 'override', left(format('Adjustment of %s accepted: %s', adj, p->>'adjustment_reason'), 300), jsonb_build_object('reconciliation_id', rec.id, 'adjustment', adj, 'reason', p->>'adjustment_reason'), auth.uid(), em);
  end if;
  return rec;
end $$;
revoke all on function public.complete_reconciliation(jsonb) from public, anon;
grant execute on function public.complete_reconciliation(jsonb) to authenticated;
revoke all on function public.audit_immutable() from public, anon, authenticated;
revoke all on function public.account_balance_audit() from public, anon, authenticated;

-- the edge function (service role) writes audit rows too; the app reads them (select policy above)


-- ===== 0009_errors_backups.sql =====
-- 0009 (0.19.0): error monitoring and nightly backups.
-- 1) app_errors — every uncaught error in the browser (window.onerror, unhandled promise rejections, React error boundaries) and every
--    failure inside an edge function lands here with the app version, so a stack trace maps to a build. Members read their household's rows;
--    a signed-in user may insert rows for a household they belong to (or with no household, before one is open). Service role writes the rest.
-- 2) backups — a private storage bucket; the backup-household edge function (pg_cron, nightly) writes <household_id>/<YYYY-MM-DD>.json
--    (the same shape as Settings → Backup → Export) and keeps 30 days. Members can list and download their household's files; nobody can
--    write to the bucket from the browser.

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid,
  at timestamptz not null default now(),
  source text not null check (source in ('browser', 'sync', 'notify', 'backup')),
  version text,
  message text not null,
  stack text,
  url text,
  user_agent text,
  context jsonb not null default '{}'::jsonb
);
create index if not exists app_errors_household_at on public.app_errors (household_id, at desc);
create index if not exists app_errors_at on public.app_errors (at desc);
alter table public.app_errors enable row level security;
drop policy if exists app_errors_select on public.app_errors;
create policy app_errors_select on public.app_errors for select to authenticated using (household_id is not null and is_member(household_id));
drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or is_member(household_id)) and length(message) <= 2000 and length(coalesce(stack, '')) <= 20000);
-- nobody edits or deletes an error from the browser; a weekly cron trims rows older than 90 days
grant select, insert on public.app_errors to authenticated;

create or replace function public.trim_app_errors() returns void language sql security definer set search_path = '' as $$
  delete from public.app_errors where at < now() - interval '90 days';
$$;
revoke all on function public.trim_app_errors() from public, anon, authenticated;
-- (scheduled job left out of staging)
-- storage bucket for backups
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('backups', 'backups', false, 52428800, array['application/json'])
  on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/json'];
drop policy if exists backups_read on storage.objects;
create policy backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and is_member(((storage.foldername(name))[1])::uuid));
-- no insert/update/delete policies for authenticated: only the service role (the backup function) writes

-- nightly backup, 03:25 UTC, through the backup-household edge function with the same Vault secret as the bank sync
-- (scheduled job left out of staging)


-- ===== 0010_transaction_splits.sql =====
-- 0010 (0.19.0): split transactions — one bank line, several categories. A transaction with rows here is budgeted by its splits
-- (each split's amount against its category); its own category_id is then only a display default. Splits must sum to the parent amount
-- (checked in the app's engine before every write and by the trigger below), are deleted with the parent, and are audited like every table.
create table if not exists public.transaction_splits (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric not null check (amount >= 0),
  memo text, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists transaction_splits_household on public.transaction_splits(household_id);
create index if not exists transaction_splits_txn on public.transaction_splits(transaction_id);
alter table public.transaction_splits enable row level security;
drop policy if exists transaction_splits_select on public.transaction_splits;
create policy transaction_splits_select on public.transaction_splits for select to authenticated using (is_member(household_id));
drop policy if exists transaction_splits_insert on public.transaction_splits;
create policy transaction_splits_insert on public.transaction_splits for insert to authenticated with check (can_edit(household_id));
drop policy if exists transaction_splits_update on public.transaction_splits;
create policy transaction_splits_update on public.transaction_splits for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
drop policy if exists transaction_splits_delete on public.transaction_splits;
create policy transaction_splits_delete on public.transaction_splits for delete to authenticated using (can_edit(household_id));
drop trigger if exists trg_transaction_splits_audit on public.transaction_splits;
create trigger trg_transaction_splits_audit before insert or update or delete on public.transaction_splits for each row execute function public.touch_and_log();
drop trigger if exists trg_transaction_splits_ref on public.transaction_splits;
create trigger trg_transaction_splits_ref before insert on public.transaction_splits for each row execute function public.assign_ref();
-- a split must belong to a transaction of the same household
create or replace function public.split_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.transactions t where t.id = new.transaction_id and t.household_id = new.household_id) then
    raise exception 'split must belong to a transaction of the same household';
  end if;
  return new;
end $$;
revoke all on function public.split_same_household() from public, anon, authenticated;
drop trigger if exists trg_transaction_splits_household on public.transaction_splits;
create trigger trg_transaction_splits_household before insert or update on public.transaction_splits for each row execute function public.split_same_household();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transaction_splits') then
    alter publication supabase_realtime add table public.transaction_splits;
  end if;
end $$;


-- ===== 0011_notifications_attachments.sql =====
-- 0011 (0.19.0): proactive alerts and receipts.
-- push_subscriptions  one row per browser/phone that opted in to Web Push (each user manages their own rows)
-- notifications       what was sent (or skipped, or failed), with a dedupe key so a rule never fires twice for the same thing
-- attachments         receipts and documents on transactions; the files live in the private `attachments` bucket under <household_id>/…
-- app_meta.vapid_public  the Web Push public key the browser subscribes with (the private key is an edge-function secret)
-- cron: notify daily at 12:30 UTC (07:30 Eastern), the Monday digest at 12:40 UTC

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null, auth text not null,
  user_agent text, created_at timestamptz not null default now(), last_used_at timestamptz, failures int not null default 0
);
create index if not exists push_subscriptions_household on public.push_subscriptions(household_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and is_member(household_id));
drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.push_subscriptions to authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null, dedupe_key text not null,
  title text not null, body text, url text,
  channel text not null check (channel in ('push', 'email', 'inapp')),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text
);
create unique index if not exists notifications_dedupe on public.notifications(household_id, dedupe_key, channel) where status = 'sent';
create index if not exists notifications_household_at on public.notifications(household_id, at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (is_member(household_id));
grant select on public.notifications to authenticated;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  name text not null, path text not null unique, mime text, size int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists attachments_household on public.attachments(household_id);
create index if not exists attachments_txn on public.attachments(transaction_id);
alter table public.attachments enable row level security;
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (is_member(household_id));
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated with check (can_edit(household_id) and path like household_id::text || '/%');
drop policy if exists attachments_update on public.attachments;
create policy attachments_update on public.attachments for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated using (can_edit(household_id));
drop trigger if exists trg_attachments_audit on public.attachments;
create trigger trg_attachments_audit before insert or update or delete on public.attachments for each row execute function public.touch_and_log();
drop trigger if exists trg_attachments_ref on public.attachments;
create trigger trg_attachments_ref before insert on public.attachments for each row execute function public.assign_ref();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'attachments') then
    alter publication supabase_realtime add table public.attachments;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attachments', 'attachments', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
drop policy if exists attachments_bucket_read on storage.objects;
create policy attachments_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists attachments_bucket_write on storage.objects;
create policy attachments_bucket_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists attachments_bucket_delete on storage.objects;
create policy attachments_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid));

-- daily alerts 12:30 UTC, Monday digest 12:40 UTC
-- (scheduled job left out of staging)
-- (scheduled job left out of staging)


-- ===== 0012_vapid_keys.sql =====
-- 0012 (0.19.0): Web Push VAPID keys. Generated once with web-push's generateVAPIDKeys. The PUBLIC key is in app_meta.vapid_public (the browser
-- subscribes with it); the PRIVATE key is the edge-function secret VAPID_PRIVATE_KEY (set in the Supabase dashboard, never in this repo), with
-- VAPID_PUBLIC_KEY and VAPID_SUBJECT (mailto:…) beside it. vapid_keys() is a fallback that reads Vault secrets named wealthpilot_vapid_public /
-- wealthpilot_vapid_private if someone prefers to keep them there (service role only). To rotate: new pair → update the secret(s) and app_meta,
-- then every device re-subscribes from Settings → Notifications.
create or replace function public.vapid_keys() returns table(public_key text, private_key text) language sql security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_vapid_public'), (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_vapid_private')
$$;
revoke all on function public.vapid_keys() from public, anon, authenticated;
grant execute on function public.vapid_keys() to service_role;
insert into public.app_meta(key, value) values ('vapid_public', 'BMjFhcjavazeK8iJldaBfPzluUUBeGk6SbGpsAUiwudW4ztb8vNZPVbkDs36TetivpekLhA_MCmmikT_Xo2RW5I') on conflict (key) do update set value = excluded.value, updated_at = now();


-- ===== 0013_phase4_plan_security.sql =====
-- 0013 (0.20.0, Phase 4): saved scenarios, promotional APRs, market prices for holdings, session list for the device panel.
-- Idempotent: safe to re-run.

-- 1. Saved scenarios — a named set of what-if assumptions for the Forecast, Debts, Goals, Retirement or the unified Plan view.
--    `assumptions` is the page's slider state as JSON (see src/lib/scenarios.ts for the shapes). Nothing here changes real data.
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'Scenario',
  kind text not null check (kind in ('forecast','debt','goal','retirement','plan')),
  assumptions jsonb not null default '{}'::jsonb,
  notes text, pinned boolean not null default false, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists scenarios_household on public.scenarios(household_id);
alter table public.scenarios enable row level security;
drop policy if exists scenarios_select on public.scenarios;
create policy scenarios_select on public.scenarios for select to authenticated using (is_member(household_id));
drop policy if exists scenarios_insert on public.scenarios;
create policy scenarios_insert on public.scenarios for insert to authenticated with check (can_edit(household_id));
drop policy if exists scenarios_update on public.scenarios;
create policy scenarios_update on public.scenarios for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
drop policy if exists scenarios_delete on public.scenarios;
create policy scenarios_delete on public.scenarios for delete to authenticated using (can_edit(household_id));
drop trigger if exists trg_scenarios_audit on public.scenarios;
create trigger trg_scenarios_audit before insert or update or delete on public.scenarios for each row execute function public.touch_and_log();
drop trigger if exists trg_scenarios_ref on public.scenarios;
create trigger trg_scenarios_ref before insert on public.scenarios for each row execute function public.assign_ref();
-- refs: scenarios are N-001, N-002 …
create or replace function public.assign_ref() returns trigger language plpgsql security definer set search_path = public as $$
declare p text; k int;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  p := case tg_table_name when 'transactions' then 'T' when 'accounts' then 'A' when 'recurring' then 'R' when 'goals' then 'G' when 'planned_items' then 'X'
       when 'hardship_outreach' then 'H' when 'email_items' then 'E' when 'statements' then 'S' when 'pay_schedules' then 'P' when 'categories' then 'C' when 'budget_periods' then 'B'
       when 'holdings' then 'I' when 'reconciliations' then 'K' when 'scenarios' then 'N' else 'Z' end;
  insert into public.ref_counters(household_id, prefix, n) values (new.household_id, p, 1)
    on conflict (household_id, prefix) do update set n = public.ref_counters.n + 1 returning n into k;
  new.ref := p || '-' || lpad(k::text, 3, '0');
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'scenarios') then
    alter publication supabase_realtime add table public.scenarios;
  end if;
end $$;

-- 2. Promotional APR on a card or loan: `promo_apr` applies until `promo_until` (inclusive), then `apr` takes over.
alter table public.accounts add column if not exists promo_apr numeric check (promo_apr is null or promo_apr >= 0);
alter table public.accounts add column if not exists promo_until date;

-- 3. Market prices. Public market data, so one table for everyone: readable by any signed-in user, written only by the price-feed
--    function (service role). Holdings opt in with price_source = 'auto' (the default when a symbol is set); 'manual' keeps the typed price.
create table if not exists public.prices (
  symbol text not null, date date not null, price numeric not null check (price >= 0), currency text not null default 'USD',
  source text not null default 'stooq', fetched_at timestamptz not null default now(),
  primary key (symbol, date)
);
create index if not exists prices_symbol_date on public.prices(symbol, date desc);
alter table public.prices enable row level security;
drop policy if exists prices_select on public.prices;
create policy prices_select on public.prices for select to authenticated using (true);
alter table public.holdings add column if not exists price_source text not null default 'auto' check (price_source in ('auto','manual'));
-- a holding without a symbol can only be manual
update public.holdings set price_source = 'manual' where symbol is null or btrim(symbol) = '';

-- 4. Device list: the signed-in user's own sessions (Supabase keeps one per device). Security definer because auth.sessions is not
--    exposed to clients; only the caller's rows are returned, and only the caller's rows can be revoked.
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, is_current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, s.ip::text,
         s.id::text = coalesce(auth.jwt() ->> 'session_id', '') as is_current
  from auth.sessions s where s.user_id = auth.uid() order by s.updated_at desc
$$;
revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;
create or replace function public.revoke_session(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_id::text = coalesce(auth.jwt() ->> 'session_id', '') then raise exception 'use sign out for the current session'; end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  get diagnostics n = row_count; return n > 0;
end $$;
revoke all on function public.revoke_session(uuid) from public, anon;
grant execute on function public.revoke_session(uuid) to authenticated;

-- 5. Daily price pull after the US close (22:30 UTC, Mon–Fri). The function reads every auto-priced symbol, so no per-household secret.
-- (scheduled job left out of staging)
-- 6. Quiet price updates. The audit trigger logs every row change; a daily price pull would add one activity row per holding per day.
--    apply_price_updates() (service role only) sets a transaction-local flag that touch_and_log honours for UPDATEs, then writes one
--    summary row per household instead. Clients cannot set the flag: PostgREST runs no arbitrary SQL and no client-callable function sets it.
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
    when 'scenarios' then j->>'name'
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;

create or replace function public.apply_price_updates(p jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  with x as (select (e->>'id')::uuid as id, (e->>'price')::numeric as price, (e->>'price_as_of')::date as d from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e),
       u as (update public.holdings h set price = x.price, price_as_of = x.d from x
             where h.id = x.id and h.price_source = 'auto' and (h.price_as_of is null or h.price_as_of <= x.d) returning h.household_id)
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary)
    select household_id, null, 'price feed', 'update', 'holdings', null, 'Market prices updated for ' || count(*) || ' holding' || case when count(*) = 1 then '' else 's' end
    from u group by household_id;
  get diagnostics n = row_count;
  perform set_config('wealthpilot.quiet_audit', 'off', true);
  return n;
end $$;
revoke all on function public.apply_price_updates(jsonb) from public, anon, authenticated;
grant execute on function public.apply_price_updates(jsonb) to service_role;


-- ===== 0014_app_errors_price_feed.sql =====
-- 0014 (0.20.0): the price-feed edge function reports to app_errors too (unknown tickers, Yahoo outages). The source check from 0009
-- listed only browser / sync / notify / backup, so its inserts were rejected silently.
alter table public.app_errors drop constraint if exists app_errors_source_check;
alter table public.app_errors add constraint app_errors_source_check check (source in ('browser', 'sync', 'notify', 'backup', 'price-feed'));


-- ===== 0015_comments_statement_pdfs.sql =====
-- 0015 (0.21.0): household comment threads on transactions; statement PDFs filed by email capture.
-- Idempotent: safe to re-run.

-- 1. Comments on a transaction ("is this the dentist or the vet?"). Any member can read and post; you edit or delete your own,
--    the owner can delete any. Deleted with the transaction. Audited like every table (the summary is the first words of the comment).
create table if not exists public.transaction_comments (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  author_email text,
  created_by uuid references auth.users(id) default auth.uid(), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists transaction_comments_txn on public.transaction_comments(transaction_id, created_at);
create index if not exists transaction_comments_household on public.transaction_comments(household_id);
alter table public.transaction_comments enable row level security;
drop policy if exists transaction_comments_select on public.transaction_comments;
create policy transaction_comments_select on public.transaction_comments for select to authenticated using (is_member(household_id));
drop policy if exists transaction_comments_insert on public.transaction_comments;
create policy transaction_comments_insert on public.transaction_comments for insert to authenticated with check (is_member(household_id) and created_by = auth.uid());
drop policy if exists transaction_comments_update on public.transaction_comments;
create policy transaction_comments_update on public.transaction_comments for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid() and is_member(household_id));
drop policy if exists transaction_comments_delete on public.transaction_comments;
create policy transaction_comments_delete on public.transaction_comments for delete to authenticated using (created_by = auth.uid() or is_owner(household_id));
create or replace function public.comment_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.transactions t where t.id = new.transaction_id and t.household_id = new.household_id) then
    raise exception 'comment must belong to a transaction of the same household';
  end if;
  return new;
end $$;
revoke all on function public.comment_same_household() from public, anon, authenticated;
drop trigger if exists trg_transaction_comments_household on public.transaction_comments;
create trigger trg_transaction_comments_household before insert or update on public.transaction_comments for each row execute function public.comment_same_household();
drop trigger if exists trg_transaction_comments_audit on public.transaction_comments;
create trigger trg_transaction_comments_audit before insert or update or delete on public.transaction_comments for each row execute function public.touch_and_log();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transaction_comments') then
    alter publication supabase_realtime add table public.transaction_comments;
  end if;
end $$;

-- the audit summary for a comment is its first words (same function as 0013 plus one case)
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
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;

-- 2. Attachments can belong to a statement as well as a transaction (email capture files the statement PDF it read).
alter table public.attachments alter column transaction_id drop not null;
alter table public.attachments add column if not exists statement_id uuid references public.statements(id) on delete cascade;
alter table public.attachments add column if not exists source text not null default 'upload';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attachments_source_check') then
    alter table public.attachments add constraint attachments_source_check check (source in ('upload', 'email'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attachments_target_check') then
    alter table public.attachments add constraint attachments_target_check check (transaction_id is not null or statement_id is not null);
  end if;
end $$;
create index if not exists attachments_statement on public.attachments(statement_id) where statement_id is not null;
-- a file can only hang off a transaction or statement of its own household
create or replace function public.attachment_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transaction_id is not null and not exists (select 1 from public.transactions t where t.id = new.transaction_id and t.household_id = new.household_id) then
    raise exception 'attachment must belong to a transaction of the same household';
  end if;
  if new.statement_id is not null and not exists (select 1 from public.statements s where s.id = new.statement_id and s.household_id = new.household_id) then
    raise exception 'attachment must belong to a statement of the same household';
  end if;
  return new;
end $$;
revoke all on function public.attachment_same_household() from public, anon, authenticated;
drop trigger if exists trg_attachments_household on public.attachments;
create trigger trg_attachments_household before insert or update on public.attachments for each row execute function public.attachment_same_household();


-- ===== 0016_planning_depth.sql =====
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


-- ===== 0017_data_history.sql =====
-- 0017 (0.24.0): data — property and vehicle values, balance history for every account, a credit-score trend.
-- Idempotent: safe to re-run.

-- 1. Property and vehicles are asset accounts with a type, an optional linked loan (for equity) and a yearly depreciation guide.
alter table public.accounts add column if not exists asset_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_asset_type_check') then
    alter table public.accounts add constraint accounts_asset_type_check check (asset_type is null or asset_type in ('home','rental','land','vehicle','boat','collectible','business','other'));
  end if;
end $$;
alter table public.accounts add column if not exists linked_account_id uuid references public.accounts(id) on delete set null;
alter table public.accounts add column if not exists depreciation_pct numeric check (depreciation_pct is null or (depreciation_pct >= -50 and depreciation_pct <= 80));
alter table public.accounts add column if not exists value_source text;
-- the linked loan must be another account of the same household
create or replace function public.account_link_same_household() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.linked_account_id is not null and (new.linked_account_id = new.id or not exists (select 1 from public.accounts a where a.id = new.linked_account_id and a.household_id = new.household_id)) then
    raise exception 'linked account must be another account of the same household';
  end if;
  return new;
end $$;
revoke all on function public.account_link_same_household() from public, anon, authenticated;
drop trigger if exists trg_accounts_link_household on public.accounts;
create trigger trg_accounts_link_household before insert or update of linked_account_id, household_id on public.accounts for each row execute function public.account_link_same_household();

-- 2. Balance history: one row per account per day with the book balance and, when there is one, the bank's figure.
--    Written only by the trigger below — every path that changes a balance (bank sync, statements, reconciliation, a typed value,
--    every posted transaction) lands here, so the balance on any past date can be read back.
create table if not exists public.balance_history (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  as_of date not null, balance numeric, bank_balance numeric,
  source text not null default 'book' check (source in ('book','bank','value')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, as_of)
);
create index if not exists balance_history_household on public.balance_history(household_id, as_of);
alter table public.balance_history enable row level security;
drop policy if exists balance_history_select on public.balance_history;
create policy balance_history_select on public.balance_history for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'accounts'));
drop policy if exists balance_history_delete on public.balance_history;
create policy balance_history_delete on public.balance_history for delete to authenticated using (can_edit(household_id) and module_allowed(household_id, 'accounts'));

create or replace function public.record_balance_history() returns trigger language plpgsql security definer set search_path = '' as $$
declare d date; src text; bank_changed boolean; book_changed boolean;
begin
  bank_changed := tg_op = 'INSERT' or new.bank_balance is distinct from old.bank_balance or new.bank_balance_as_of is distinct from old.bank_balance_as_of;
  book_changed := tg_op = 'INSERT' or new.balance is distinct from old.balance or new.balance_as_of is distinct from old.balance_as_of;
  if not bank_changed and not book_changed then return new; end if;
  if bank_changed and new.bank_balance is not null then d := coalesce(new.bank_balance_as_of, (now() at time zone 'America/New_York')::date); src := 'bank';
  elsif new.kind = 'other_asset' and new.balance_as_of is not null then d := new.balance_as_of; src := 'value';
  else d := (now() at time zone 'America/New_York')::date; src := 'book'; end if;
  insert into public.balance_history(household_id, account_id, as_of, balance, bank_balance, source)
    values (new.household_id, new.id, d, new.balance, new.bank_balance, src)
    on conflict (account_id, as_of) do update set balance = excluded.balance, bank_balance = coalesce(excluded.bank_balance, public.balance_history.bank_balance),
      source = case when excluded.source = 'book' then public.balance_history.source else excluded.source end, updated_at = now();
  return new;
end $$;
revoke all on function public.record_balance_history() from public, anon, authenticated;
drop trigger if exists trg_accounts_balance_history on public.accounts;
create trigger trg_accounts_balance_history after insert or update of balance, bank_balance, balance_as_of, bank_balance_as_of on public.accounts for each row execute function public.record_balance_history();
-- start the history with today's figures
insert into public.balance_history(household_id, account_id, as_of, balance, bank_balance, source)
  select household_id, id, coalesce(bank_balance_as_of, balance_as_of, (now() at time zone 'America/New_York')::date), balance, bank_balance, case when bank_balance is not null then 'bank' when kind = 'other_asset' then 'value' else 'book' end
  from public.accounts on conflict (account_id, as_of) do nothing;

-- 3. Credit scores typed from a bureau, a card issuer or a monitoring app — a trend, never a credit pull.
create table if not exists public.credit_scores (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  person text not null default 'Me', date date not null, score int not null check (score between 250 and 900),
  bureau text check (bureau is null or bureau in ('Equifax','Experian','TransUnion','Combined','Other')), model text, source text, notes text,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists credit_scores_household on public.credit_scores(household_id, person, date);
alter table public.credit_scores enable row level security;
do $$
declare r record; t text;
begin
  for r in select * from (values ('credit_scores','accounts')) as t(tbl, mod) loop
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
  end loop;
  foreach t in array array['credit_scores', 'balance_history'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- audit summaries (same function as 0016 plus credit scores)
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
    when 'credit_scores' then coalesce(j->>'person','') || ' ' || coalesce(j->>'score','') || ' on ' || coalesce(j->>'date','')
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;


-- ===== 0018_engineering.sql =====
-- 0018 (0.25.0): engineering — delete a household with a 7-day grace period, a per-household limit on bank syncs, rotating the
-- scheduled jobs' secret with a self-test, and a health view of the scheduled jobs. Idempotent: safe to re-run.
-- Sections marked [prod-only] call this project's edge functions from pg_cron; scripts/staging-schema.mjs leaves them out of staging.

-- 1. Deleting a household: an owner schedules it (typing the name), every member sees the date, the household is read-only for 7
--    days, any owner can cancel; then the nightly purge (backup-household, action purge_due) removes its files and the row — every
--    table cascades from households.
alter table public.households add column if not exists deletion_requested_at timestamptz;
alter table public.households add column if not exists deletion_requested_by uuid references auth.users(id) on delete set null;
alter table public.households add column if not exists deletion_scheduled_for timestamptz;

-- the deletion columns change only through the two functions below, and nothing else changes while a deletion is pending
create or replace function public.households_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('wealthpilot.deletion_rpc', true), '') = 'on' then return new; end if;
  if new.deletion_requested_at is distinct from old.deletion_requested_at or new.deletion_requested_by is distinct from old.deletion_requested_by
     or new.deletion_scheduled_for is distinct from old.deletion_scheduled_for then
    raise exception 'schedule or cancel a deletion from Settings → Household';
  end if;
  if old.deletion_scheduled_for is not null then raise exception 'this household is scheduled for deletion and is read-only — cancel the deletion first'; end if;
  -- editors may change the shared settings (below); renaming the household stays with owners
  if auth.uid() is not null and (new.name is distinct from old.name or new.currency is distinct from old.currency) and not public.is_owner(new.id) then
    raise exception 'only an owner can rename the household';
  end if;
  return new;
end $$;
revoke all on function public.households_guard() from public, anon, authenticated;
drop trigger if exists trg_households_guard on public.households;
create trigger trg_households_guard before update on public.households for each row execute function public.households_guard();

-- household settings (thresholds, the tax profile, retirement inputs, payee rules, alert choices…) are shared planning data: anyone
-- who can edit the household can save them. Before 0.25.0 only owners could, and an editor's change was silently dropped.
drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated using (public.can_edit(id)) with check (public.can_edit(id));

-- while a deletion is pending nobody can change the household's data (every write policy goes through can_edit)
create or replace function public.can_edit(hh uuid) returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and role in ('owner','editor') and not read_only)
     and not exists (select 1 from public.households where id = hh and deletion_scheduled_for is not null); $function$;

create or replace function public.request_household_deletion(p_household uuid, p_confirm text) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare n text; s timestamptz; em text;
begin
  if not public.is_owner(p_household) then raise exception 'only an owner can delete the household'; end if;
  select name, deletion_scheduled_for into n, s from public.households where id = p_household;
  if n is null then raise exception 'household not found'; end if;
  if s is not null then return s; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(n)) then raise exception 'type the household''s name exactly to confirm'; end if;
  s := now() + interval '7 days';
  perform set_config('wealthpilot.deletion_rpc', 'on', true);
  update public.households set deletion_requested_at = now(), deletion_requested_by = auth.uid(), deletion_scheduled_for = s where id = p_household;
  perform set_config('wealthpilot.deletion_rpc', '', true);
  select email into em from public.household_members where household_id = p_household and user_id = auth.uid();
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary)
    values (p_household, auth.uid(), em, 'delete_requested', 'households', p_household::text, 'Scheduled for permanent deletion on ' || to_char(s at time zone 'America/New_York', 'FMMonth FMDD, YYYY'));
  return s;
end $$;
create or replace function public.cancel_household_deletion(p_household uuid) returns void language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  if not public.is_owner(p_household) then raise exception 'only an owner can cancel the deletion'; end if;
  perform set_config('wealthpilot.deletion_rpc', 'on', true);
  update public.households set deletion_requested_at = null, deletion_requested_by = null, deletion_scheduled_for = null where id = p_household and deletion_scheduled_for is not null;
  perform set_config('wealthpilot.deletion_rpc', '', true);
  if found then
    select email into em from public.household_members where household_id = p_household and user_id = auth.uid();
    insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (p_household, auth.uid(), em, 'delete_cancelled', 'households', p_household::text, 'Deletion cancelled');
  end if;
end $$;
revoke all on function public.request_household_deletion(uuid, text) from public, anon;
revoke all on function public.cancel_household_deletion(uuid) from public, anon;
grant execute on function public.request_household_deletion(uuid, text) to authenticated;
grant execute on function public.cancel_household_deletion(uuid) to authenticated;

-- When the household row itself is deleted (the nightly purge, service role only — users have no delete policy on households),
-- its rows go with it through ON DELETE CASCADE. Three older triggers would stop that: the last-owner guard, the immutable audit
-- trail and the activity log (which would try to log every cascaded row against a household that no longer exists). Each now
-- steps aside once the parent household is gone; for a household that still exists nothing changes. Found by the staging tests.
create or replace function public.guard_last_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.households where id = old.household_id) then return coalesce(new, old); end if;
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner' and not exists (select 1 from public.household_members where household_id = old.household_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'a household must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.guard_last_owner() from public, anon, authenticated;

create or replace function public.audit_immutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.households where id = old.household_id) then return coalesce(new, old); end if;
  raise exception 'audit_events are immutable';
end $$;
revoke all on function public.audit_immutable() from public, anon, authenticated;

-- audit summaries (same function as 0017) — plus: nothing is logged for rows that are going because their household was deleted
create or replace function public.touch_and_log() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare hh uuid; rid text; summ text; em text; j jsonb;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('wealthpilot.quiet_audit', true), '') = 'on' then new.updated_at := now(); return new; end if;
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  hh := (j->>'household_id')::uuid; rid := j->>'id';
  if tg_op <> 'INSERT' and not exists (select 1 from public.households where id = hh) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
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
    when 'credit_scores' then coalesce(j->>'person','') || ' ' || coalesce(j->>'score','') || ' on ' || coalesce(j->>'date','')
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;

-- a record that a household existed and was deleted (no data, no access for users)
create table if not exists public.deleted_households (
  id uuid primary key, name text, requested_by uuid, requested_at timestamptz, deleted_at timestamptz not null default now(), files_removed int not null default 0
);
alter table public.deleted_households enable row level security;

-- 2. A limit on bank syncs: "Sync now" and "Load history" at most once every 15 minutes and 12 times in 24 hours per household.
--    The nightly sync is not counted. Checked and recorded in one locked step so two clicks cannot both get through.
create table if not exists public.sync_requests (
  id bigint generated always as identity primary key, household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, trigger text not null check (trigger in ('manual', 'backfill')), at timestamptz not null default now()
);
create index if not exists sync_requests_household on public.sync_requests(household_id, at desc);
alter table public.sync_requests enable row level security;
drop policy if exists sync_requests_select on public.sync_requests;
create policy sync_requests_select on public.sync_requests for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'connections'));

create or replace function public.claim_sync_slot(p_household uuid, p_user uuid, p_trigger text, p_gap_minutes int default 15, p_daily int default 12) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare last_at timestamptz; n int; retry timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('sync:' || p_household::text, 0));
  delete from public.sync_requests where household_id = p_household and at < now() - interval '7 days';
  select max(at), count(*) into last_at, n from public.sync_requests where household_id = p_household and at > now() - interval '24 hours';
  if last_at is not null and last_at > now() - make_interval(mins => p_gap_minutes) then
    return jsonb_build_object('ok', false, 'reason', 'gap', 'retry_at', last_at + make_interval(mins => p_gap_minutes), 'used', n, 'limit', p_daily);
  end if;
  if n >= p_daily then
    select at + interval '24 hours' into retry from public.sync_requests where household_id = p_household and at > now() - interval '24 hours' order by at asc offset (n - p_daily) limit 1;
    return jsonb_build_object('ok', false, 'reason', 'daily', 'retry_at', retry, 'used', n, 'limit', p_daily);
  end if;
  insert into public.sync_requests(household_id, user_id, trigger) values (p_household, p_user, p_trigger);
  return jsonb_build_object('ok', true, 'used', n + 1, 'limit', p_daily);
end $$;
revoke all on function public.claim_sync_slot(uuid, uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_sync_slot(uuid, uuid, text, int, int) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sync_requests') then
    alter publication supabase_realtime add table public.sync_requests;
  end if;
end $$;

-- 3. The scheduled jobs' secret: rotate it (a new random value in Vault — the jobs read it at run time and the functions check it
--    against Vault, so nothing else changes), then prove a job still gets through. Service role / SQL editor only. See HANDOFF.
create or replace function public.rotate_cron_secret() returns timestamptz language plpgsql security definer set search_path = '' as $$
declare sid uuid; v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select id into sid from vault.secrets where name = 'wealthpilot_cron_secret';
  if sid is null then perform vault.create_secret(v, 'wealthpilot_cron_secret', 'Scheduled jobs: proves a call came from pg_cron');
  else perform vault.update_secret(sid, v); end if;
  return now();
end $$;
revoke all on function public.rotate_cron_secret() from public, anon, authenticated;

-- last run of every scheduled job, for a quick health check
create or replace function public.cron_status() returns table(job text, schedule text, active boolean, last_start timestamptz, last_status text, last_message text)
language sql stable security definer set search_path = '' as $$
  select j.jobname::text, j.schedule::text, j.active, d.start_time, d.status::text, left(d.return_message, 200)
  from cron.job j left join lateral (select * from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
  order by j.jobname $$;
revoke all on function public.cron_status() from public, anon, authenticated;

-- (production-only section left out of staging)


-- ===== 0019_accounts_and_speed.sql =====
-- 0019 (0.25.1): delete your own account (the App Store and Google Play both require it), faster access rules, two missing indexes.
-- Idempotent: safe to re-run.

-- 1. A person's account can be deleted while the households they shared live on. Every reference to them — who created or last
--    changed a row, who did something in the activity log or audit trail — becomes empty instead of blocking the deletion.
do $$
declare r record;
begin
  for r in select c.conrelid::regclass as tbl, c.conname, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace
      and c.confdeltype in ('a', 'r') and array_length(c.conkey, 1) = 1 and not a.attnotnull
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete set null', r.tbl, r.conname, r.col);
  end loop;
end $$;

-- (the audit trail lets forget_user blank a deleted person's id and name — see audit_immutable in section 5f)

-- Removes a person from every household record before their sign-in is deleted (called by the delete-account function, service role
-- only): their email becomes "a former member" in logs, comments and reconciliations, every reference to their id is emptied, the
-- invitations sent to their address go (and the log lines that named it), their alert choices and any alert address that was theirs
-- go, files they added to households they share stay with those households, and their error reports lose the link to them.
-- Households they are the only member of are deleted by the function first.
create or replace function public.forget_user(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; n int; total int := 0; files int := 0; em text;
begin
  select lower(email) into em from auth.users where id = p_user;
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  perform set_config('wealthpilot.deletion_rpc', 'on', true);
  perform set_config('wealthpilot.forget_user', p_user::text, true);
  -- names first: the id columns they are matched by are emptied below
  update public.activity_log set user_email = 'a former member' where user_id = p_user or (em is not null and lower(user_email) = em);
  -- one statement for both columns: the immutable audit trail accepts exactly this change (5f), and no half-way version of it
  update public.audit_events set user_email = 'a former member', user_id = null where user_id = p_user;
  update public.transaction_comments set author_email = 'a former member' where created_by = p_user or (em is not null and lower(author_email) = em);
  update public.reconciliations set completed_by_email = 'a former member' where completed_by = p_user or (em is not null and lower(completed_by_email) = em);
  if em is not null then
    -- invitations to their address, and the log lines that named it ("<address> · editor · emailed"; before 0.25.1 the line kept
    -- their id instead, with "(temporary password issued)")
    delete from public.household_invites where lower(email) = em;
    update public.activity_log set record_id = null,
      summary = case when lower(left(summary, length(em))) = em then 'a former member' || substr(summary, length(em) + 1) else 'a former member' end
      where action = 'invite' and (lower(record_id) = em or record_id = p_user::text);
    update public.notifications set detail = null where strpos(lower(detail), em) > 0;
  end if;
  -- their own alert choices, and any alert address that was theirs (an owner may have typed it for them)
  update public.households h set settings = jsonb_set(h.settings, '{notify,members}', coalesce((
      select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' and em is not null and lower(v ->> 'email_to') = em then v - 'email_to' else v end)
      from jsonb_each(h.settings -> 'notify' -> 'members') e(k, v) where k <> p_user::text), '{}'::jsonb))
    where jsonb_typeof(h.settings -> 'notify' -> 'members') = 'object'
      and (h.settings -> 'notify' -> 'members' ? p_user::text
           or exists (select 1 from jsonb_each(h.settings -> 'notify' -> 'members') e(k, v) where jsonb_typeof(v) = 'object' and em is not null and lower(v ->> 'email_to') = em));
  if em is not null then
    update public.households set settings = jsonb_set(settings, '{notify}', (settings -> 'notify') - 'email_to')
      where jsonb_typeof(settings -> 'notify') = 'object' and lower(settings -> 'notify' ->> 'email_to') = em;
  end if;
  -- files they added to households they share stay with those households. The sign-in service refuses to delete anyone who still
  -- owns a file, and no access rule here looks at a file's owner (households' folders decide), so the owner is simply emptied.
  update storage.objects set owner = null, owner_id = null where owner = p_user or owner_id = p_user::text;
  get diagnostics files = row_count;
  update public.deleted_households set requested_by = null where requested_by = p_user;
  for r in select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1 and not a.attnotnull
  loop
    execute format('update %s set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
    get diagnostics n = row_count; total := total + n;
  end loop;
  update public.app_errors set user_id = null where user_id = p_user;
  perform set_config('wealthpilot.forget_user', '', true);
  perform set_config('wealthpilot.deletion_rpc', '', true);
  perform set_config('wealthpilot.quiet_audit', 'off', true);
  return jsonb_build_object('references_cleared', total, 'files_kept', files);
end $$;
revoke all on function public.forget_user(uuid) from public, anon, authenticated;
grant execute on function public.forget_user(uuid) to service_role;

-- 2. Access rules that called auth.uid() once per row now call it once per query (the database advisor's auth_rls_initplan warnings)
drop policy if exists transaction_comments_insert on public.transaction_comments;
create policy transaction_comments_insert on public.transaction_comments for insert to authenticated with check (is_member(household_id) and created_by = (select auth.uid()));
drop policy if exists transaction_comments_update on public.transaction_comments;
create policy transaction_comments_update on public.transaction_comments for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()) and is_member(household_id));
drop policy if exists transaction_comments_delete on public.transaction_comments;
create policy transaction_comments_delete on public.transaction_comments for delete to authenticated using (created_by = (select auth.uid()) or is_owner(household_id));
drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors for insert to authenticated
  with check (user_id = (select auth.uid()) and (household_id is null or is_member(household_id)) and length(message) <= 2000 and length(coalesce(stack, '')) <= 20000);
drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and is_member(household_id));
drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- 3. Two tables every household page reads had no index on household_id
create index if not exists goal_contributions_household on public.goal_contributions(household_id);
create index if not exists statements_household on public.statements(household_id);

-- 4. Problems in the delete-account function are logged like the other server jobs (Settings → Security → Errors)
alter table public.app_errors drop constraint if exists app_errors_source_check;
alter table public.app_errors add constraint app_errors_source_check check (source in ('browser', 'sync', 'notify', 'backup', 'price-feed', 'account'));

-- 5. Security review (0.25.1) — found by the audit and reproduced on staging before fixing.

-- 5a. A member could rewrite their own membership row: make themselves an owner (then remove the real owner and delete the household),
--     or try to move the row into another household. Now only last_seen_at / last_version (and the display name) are theirs to change;
--     access is an owner's call, and a membership never changes household, person or address.
create or replace function public.members_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;   -- the service role (invitations, account deletion) and the SQL editor
  if new.household_id is distinct from old.household_id or new.user_id is distinct from old.user_id or new.email is distinct from old.email or new.joined_at is distinct from old.joined_at then
    raise exception 'a membership cannot be moved to another household or person';
  end if;
  if (new.role is distinct from old.role or new.read_only is distinct from old.read_only or new.modules is distinct from old.modules) and not public.is_owner(old.household_id) then
    raise exception 'only an owner can change what a member can see and do';
  end if;
  return new;
end $$;
revoke all on function public.members_guard() from public, anon, authenticated;
drop trigger if exists trg_members_guard on public.household_members;
create trigger trg_members_guard before update on public.household_members for each row execute function public.members_guard();

-- 5b. "Full view": an owner, or a member whose access is not limited to some sections. Whole-household things need it.
create or replace function public.full_view(hh uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and (role = 'owner' or modules is null)); $$;
revoke all on function public.full_view(uuid) from public, anon;
grant execute on function public.full_view(uuid) to authenticated;

-- the nightly backups hold every table, so a member limited to some sections cannot download them
drop policy if exists backups_read on storage.objects;
create policy backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.full_view(((storage.foldername(name))[1])::uuid));
-- the activity log summarizes changes to every table (payee and amount of each transaction), and the sent-alert log covers the whole household
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated using (public.full_view(household_id));
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (public.full_view(household_id));

-- 5c. Rows that belong to a section now follow that section's access, like every other table already did
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'accounts'));
do $$
declare t text;
begin
  foreach t in array array['transaction_splits'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t); execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t); execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (is_member(household_id) and module_allowed(household_id, ''transactions''))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (can_edit(household_id) and module_allowed(household_id, ''transactions''))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (can_edit(household_id) and module_allowed(household_id, ''transactions'')) with check (can_edit(household_id) and module_allowed(household_id, ''transactions''))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (can_edit(household_id) and module_allowed(household_id, ''transactions''))', t, t);
  end loop;
end $$;
drop policy if exists transaction_comments_select on public.transaction_comments;
create policy transaction_comments_select on public.transaction_comments for select to authenticated using (is_member(household_id) and module_allowed(household_id, 'transactions'));
drop policy if exists transaction_comments_insert on public.transaction_comments;
create policy transaction_comments_insert on public.transaction_comments for insert to authenticated with check (is_member(household_id) and module_allowed(household_id, 'transactions') and created_by = (select auth.uid()));
-- a receipt belongs to Transactions, a statement PDF to Accounts
create or replace function public.attachment_allowed(hh uuid, txn uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.module_allowed(hh, case when txn is not null then 'transactions' else 'accounts' end) $$;
revoke all on function public.attachment_allowed(uuid, uuid) from public, anon;
grant execute on function public.attachment_allowed(uuid, uuid) to authenticated;
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (is_member(household_id) and attachment_allowed(household_id, transaction_id));
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated with check (can_edit(household_id) and attachment_allowed(household_id, transaction_id) and path like household_id::text || '/%');
drop policy if exists attachments_update on public.attachments;
create policy attachments_update on public.attachments for update to authenticated using (can_edit(household_id) and attachment_allowed(household_id, transaction_id)) with check (can_edit(household_id) and attachment_allowed(household_id, transaction_id));
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated using (can_edit(household_id) and attachment_allowed(household_id, transaction_id));
drop policy if exists attachments_bucket_read on storage.objects;
create policy attachments_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and is_member(((storage.foldername(name))[1])::uuid) and (module_allowed(((storage.foldername(name))[1])::uuid, 'transactions') or module_allowed(((storage.foldername(name))[1])::uuid, 'accounts')));
drop policy if exists attachments_bucket_write on storage.objects;
create policy attachments_bucket_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid) and (module_allowed(((storage.foldername(name))[1])::uuid, 'transactions') or module_allowed(((storage.foldername(name))[1])::uuid, 'accounts')));
drop policy if exists attachments_bucket_delete on storage.objects;
create policy attachments_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid) and (module_allowed(((storage.foldername(name))[1])::uuid, 'transactions') or module_allowed(((storage.foldername(name))[1])::uuid, 'accounts')));
-- saved scenarios follow the page they were saved on (the forecast is always visible)
create or replace function public.scenario_allowed(hh uuid, k text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case k when 'debt' then public.module_allowed(hh, 'accounts') when 'goal' then public.module_allowed(hh, 'goals') when 'plan' then public.module_allowed(hh, 'goals')
    when 'retirement' then public.module_allowed(hh, 'investments') else true end $$;
revoke all on function public.scenario_allowed(uuid, text) from public, anon;
grant execute on function public.scenario_allowed(uuid, text) to authenticated;
drop policy if exists scenarios_select on public.scenarios;
create policy scenarios_select on public.scenarios for select to authenticated using (is_member(household_id) and scenario_allowed(household_id, kind));
drop policy if exists scenarios_insert on public.scenarios;
create policy scenarios_insert on public.scenarios for insert to authenticated with check (can_edit(household_id) and scenario_allowed(household_id, kind));
drop policy if exists scenarios_update on public.scenarios;
create policy scenarios_update on public.scenarios for update to authenticated using (can_edit(household_id) and scenario_allowed(household_id, kind)) with check (can_edit(household_id) and scenario_allowed(household_id, kind));
drop policy if exists scenarios_delete on public.scenarios;
create policy scenarios_delete on public.scenarios for delete to authenticated using (can_edit(household_id) and scenario_allowed(household_id, kind));

-- 5d. Where alerts go is the owners' decision: anyone else may change only their own alert choices, and can point their own alerts only
--     at their own address (before, any editor — even one limited to a single section — could send the household's daily alerts and
--     digest anywhere). An address an owner typed for them stays as it is when they change something else. The rest of households_guard
--     is unchanged from 0018.
create or replace function public.households_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare me text; o jsonb; n jsonb; mine text; was text;
begin
  if coalesce(current_setting('wealthpilot.deletion_rpc', true), '') = 'on' then return new; end if;
  if new.deletion_requested_at is distinct from old.deletion_requested_at or new.deletion_requested_by is distinct from old.deletion_requested_by
     or new.deletion_scheduled_for is distinct from old.deletion_scheduled_for then
    raise exception 'schedule or cancel a deletion from Settings → Household';
  end if;
  if old.deletion_scheduled_for is not null then raise exception 'this household is scheduled for deletion and is read-only — cancel the deletion first'; end if;
  if auth.uid() is not null and (new.name is distinct from old.name or new.currency is distinct from old.currency) and not public.is_owner(new.id) then
    raise exception 'only an owner can rename the household';
  end if;
  if auth.uid() is not null and new.settings is distinct from old.settings and not public.is_owner(new.id) then
    me := auth.uid()::text; o := coalesce(old.settings -> 'notify', '{}'::jsonb); n := coalesce(new.settings -> 'notify', '{}'::jsonb);
    if (n - 'members') is distinct from (o - 'members') then raise exception 'only an owner can change the household''s alert settings'; end if;
    if (coalesce(n -> 'members', '{}'::jsonb) - me) is distinct from (coalesce(o -> 'members', '{}'::jsonb) - me) then raise exception 'you can change only your own alert settings'; end if;
    mine := nullif(btrim(coalesce(n -> 'members' -> me ->> 'email_to', '')), ''); was := nullif(btrim(coalesce(o -> 'members' -> me ->> 'email_to', '')), '');
    if mine is not null and mine is distinct from was and lower(mine) <> lower(coalesce((select email from auth.users where id = auth.uid()), '')) then
      raise exception 'alerts can only be sent to your own email address';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.households_guard() from public, anon, authenticated;

-- 5e. The audit trail records who really did something: the database fills in the person, never the app
create or replace function public.audit_who() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.user_email := (select email from public.household_members where household_id = new.household_id and user_id = auth.uid() limit 1);
  end if;
  return new;
end $$;
revoke all on function public.audit_who() from public, anon, authenticated;
drop trigger if exists trg_audit_events_who on public.audit_events;
create trigger trg_audit_events_who before insert on public.audit_events for each row execute function public.audit_who();

-- 5f. Deleting an account (and Replace-everything restores) failed for any account with a balance change: its audit rows' account_id is
--     set to empty by the foreign key, and the immutable trail refused even that. Emptying account_id is now allowed — nothing else.
create or replace function public.audit_immutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.households where id = old.household_id) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.account_id is not null and new.account_id is null and (to_jsonb(new) - 'account_id') = (to_jsonb(old) - 'account_id') then return new; end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('wealthpilot.forget_user', true), '') <> ''
     and (to_jsonb(new) - 'user_id' - 'user_email') = (to_jsonb(old) - 'user_id' - 'user_email')
     and old.user_id::text = current_setting('wealthpilot.forget_user', true) and new.user_id is null then return new; end if;
  raise exception 'audit_events are immutable';
end $$;
revoke all on function public.audit_immutable() from public, anon, authenticated;

-- 5g. Starting a budget period needs access to Budget, like the budget tables themselves
create or replace function public.start_period(p_household uuid, p_type text, p_start date, p_end date, p_label text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; prev uuid;
begin
  if not (public.can_edit(p_household) and public.module_allowed(p_household, 'budget')) then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext(p_household::text || ':period'));
  select id into pid from public.budget_periods where household_id = p_household and start_date = p_start and end_date = p_end;
  if pid is not null then return pid; end if;
  insert into public.budget_periods(household_id, period_type, start_date, end_date, label, status) values (p_household, p_type, p_start, p_end, p_label, case when p_start > current_date then 'planned' else 'open' end) returning id into pid;
  select id into prev from public.budget_periods where household_id = p_household and id <> pid and start_date < p_start order by start_date desc limit 1;
  if prev is not null then
    insert into public.budget_lines(household_id, period_id, category_id, planned, rollover_in)
    select p_household, pid, bl.category_id, bl.planned,
      case when c.rollover then greatest(0, bl.planned + bl.rollover_in - coalesce((select sum(t.amount) from public.transactions t where t.household_id = p_household and t.category_id = bl.category_id and t.kind = 'expense' and t.status <> 'void' and not t.exclude_from_budget and t."date" between pp.start_date and pp.end_date),0)) else 0 end
    from public.budget_lines bl join public.categories c on c.id = bl.category_id join public.budget_periods pp on pp.id = bl.period_id where bl.period_id = prev and not c.archived;
  else
    insert into public.budget_lines(household_id, period_id, category_id, planned)
    select p_household, pid, c.id, c.default_budget from public.categories c where c.household_id = p_household and not c.archived and c.kind in ('expense','income');
  end if;
  return pid;
end $$;
revoke execute on function public.start_period(uuid, text, date, date, text) from public, anon;
grant execute on function public.start_period(uuid, text, date, date, text) to authenticated;

-- 6. Account numbers stored before 0.25.1: bank-feed descriptions (and the account names the feed reported) kept the whole number. The
--    same rule the app now applies to everything the bank feed and email capture bring in (lib/simplefin.ts maskDigits): a run of 5 or
--    more digits, spaces or dashes allowed inside, keeps only its last four ("ACH ACCT 4400123456" → "ACH ACCT ••3456"). Only what came
--    from the bank feed or email is changed — nothing a person typed or imported from their own file. Quiet: no activity-log row per change.
create or replace function public.mask_digits(s text) returns text language plpgsql immutable set search_path = '' as $$
declare pat constant text := '[0-9](?:[ -]*[0-9]){4,}'; m text; outp text := s; i int := 0;
begin
  if s is null then return null; end if;
  -- one run at a time, left to right: a masked run keeps 4 digits, so it never matches again (and a second pass changes nothing)
  loop
    m := substring(outp from pat);
    exit when m is null or i >= 200;
    outp := regexp_replace(outp, pat, '••' || right(regexp_replace(m, '[^0-9]', '', 'g'), 4));   -- no 'g': the first run only
    i := i + 1;
  end loop;
  return outp;
end $$;
revoke all on function public.mask_digits(text) from public, anon, authenticated;
-- the scrub itself, kept as a function so the local database tests (supabase/tests) can run it on test rows; the API roles cannot call it
create or replace function public.mask_stored_account_numbers() returns jsonb language plpgsql set search_path = '' as $$
declare pat constant text := '[0-9](?:[ -]*[0-9]){4,}'; n_txn int; n_items int; n_log int; n_acct int; n_lists int;
begin
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  -- the activity log's lines for those rows read "<payee> <amount>": only the payee part is masked (an amount is not an account number)
  update public.activity_log a set summary = public.mask_digits(regexp_replace(a.summary, ' [^ ]*$', '')) || coalesce(substring(a.summary from '( [^ ]*)$'), '')
    from public.transactions t
    where a.table_name = 'transactions' and a.record_id = t.id::text and (coalesce(t.external_id, '') like 'sfin:%' or t.source = 'email')
      and regexp_replace(a.summary, ' [^ ]*$', '') ~ pat;
  update public.activity_log set summary = public.mask_digits(regexp_replace(summary, ' [^ ]*$', '')) || coalesce(substring(summary from '( [^ ]*)$'), '')
    where table_name = 'email_items' and regexp_replace(summary, ' [^ ]*$', '') ~ pat;
  update public.transactions set payee = public.mask_digits(payee) where (coalesce(external_id, '') like 'sfin:%' or source = 'email') and payee ~ pat;
  get diagnostics n_txn = row_count;
  update public.email_items set payee = public.mask_digits(payee) where payee ~ pat;
  get diagnostics n_items = row_count;
  -- accounts linked to the bank feed, or made by an import from the account list another app exported
  update public.activity_log l set summary = public.mask_digits(l.summary) from public.accounts a
    where l.table_name = 'accounts' and l.record_id = a.id::text and l.summary ~ pat
      and (a.id::text in (select e.v from public.sync_connections c, jsonb_each_text(c.account_map) e(k, v)) or a.notes like 'Created by the % import%');
  get diagnostics n_log = row_count;
  update public.accounts a set name = public.mask_digits(a.name)
    where a.name ~ pat and (a.id::text in (select e.v from public.sync_connections c, jsonb_each_text(c.account_map) e(k, v)) or a.notes like 'Created by the % import%');
  get diagnostics n_acct = row_count;
  -- the account list last seen at the bank (rewritten by every sync too)
  update public.sync_connections c set discovered = (
      select coalesce(jsonb_agg(case when jsonb_typeof(x.e) = 'object' and x.e ? 'name' then jsonb_set(x.e, '{name}', to_jsonb(public.mask_digits(x.e ->> 'name'))) else x.e end order by x.n), '[]'::jsonb)
      from jsonb_array_elements(c.discovered) with ordinality as x(e, n))
    where jsonb_typeof(c.discovered) = 'array' and exists (select 1 from jsonb_array_elements(c.discovered) d where d ->> 'name' ~ pat);
  get diagnostics n_lists = row_count;
  perform set_config('wealthpilot.quiet_audit', 'off', true);
  return jsonb_build_object('transactions', n_txn, 'email_items', n_items, 'accounts', n_acct, 'account_log_lines', n_log, 'bank_account_lists', n_lists);
end $$;
revoke all on function public.mask_stored_account_numbers() from public, anon, authenticated, service_role;
select public.mask_stored_account_numbers();

