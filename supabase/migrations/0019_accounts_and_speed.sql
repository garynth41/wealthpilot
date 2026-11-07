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
-- only): their email becomes "a former member" in logs and comments, every reference to their id is emptied, invitations to their
-- address go, and their error reports lose the link to them. Households they are the only member of are deleted by the function first.
create or replace function public.forget_user(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; n int; total int := 0; em text;
begin
  select lower(email) into em from auth.users where id = p_user;
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  perform set_config('wealthpilot.deletion_rpc', 'on', true);
  perform set_config('wealthpilot.forget_user', p_user::text, true);
  update public.activity_log set user_email = 'a former member' where user_id = p_user;
  -- one statement for both columns: the immutable audit trail accepts exactly this change (5f), and no half-way version of it
  update public.audit_events set user_email = 'a former member', user_id = null where user_id = p_user;
  update public.transaction_comments set author_email = 'a former member' where created_by = p_user;
  for r in select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1 and not a.attnotnull
  loop
    execute format('update %s set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
    get diagnostics n = row_count; total := total + n;
  end loop;
  if em is not null then delete from public.household_invites where lower(email) = em; end if;
  update public.app_errors set user_id = null where user_id = p_user;
  perform set_config('wealthpilot.forget_user', '', true);
  perform set_config('wealthpilot.deletion_rpc', '', true);
  perform set_config('wealthpilot.quiet_audit', 'off', true);
  return jsonb_build_object('references_cleared', total);
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

-- 5d. Where alerts go is the owners' decision: anyone else may change only their own alert choices, and only to their own address
--     (before, any editor — even one limited to a single section — could send the household's daily alerts and digest anywhere).
--     The rest of households_guard is unchanged from 0018.
create or replace function public.households_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare me text; o jsonb; n jsonb; mine text;
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
    mine := nullif(btrim(coalesce(n -> 'members' -> me ->> 'email_to', '')), '');
    if mine is not null and lower(mine) <> lower(coalesce((select email from auth.users where id = auth.uid()), '')) then raise exception 'alerts can only be sent to your own email address'; end if;
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
--    same rule the app now applies everywhere (lib/simplefin.ts maskDigits): a run of 5 or more digits, spaces or dashes allowed inside,
--    keeps only its last four ("ACH ACCT 4400123456" → "ACH ACCT ••3456"). Quiet: no activity-log row per transaction.
create or replace function public.mask_digits(s text) returns text language plpgsql immutable set search_path = '' as $$
declare m text; outp text := s;
begin
  if s is null then return null; end if;
  for m in select (regexp_matches(s, '[0-9](?:[ -]*[0-9]){4,}', 'g'))[1] loop
    outp := replace(outp, m, '••' || right(regexp_replace(m, '[^0-9]', '', 'g'), 4));
  end loop;
  return outp;
end $$;
revoke all on function public.mask_digits(text) from public, anon, authenticated;
do $$
begin
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  update public.transactions set payee = public.mask_digits(payee) where payee ~ '[0-9](?:[ -]*[0-9]){4,}';
  update public.accounts set name = public.mask_digits(name) where name ~ '[0-9](?:[ -]*[0-9]){4,}';
  update public.email_items set payee = public.mask_digits(payee) where payee ~ '[0-9](?:[ -]*[0-9]){4,}';
  perform set_config('wealthpilot.quiet_audit', 'off', true);
end $$;
