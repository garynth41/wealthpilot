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
