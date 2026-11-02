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
