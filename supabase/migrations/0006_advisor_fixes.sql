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
