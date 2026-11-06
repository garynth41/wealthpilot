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
