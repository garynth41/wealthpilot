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
