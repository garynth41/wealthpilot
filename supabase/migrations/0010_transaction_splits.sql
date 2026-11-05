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
