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
