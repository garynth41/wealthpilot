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

-- [prod-only]
-- self-test after a rotation: ask the backup function to check the secret; read the answer with
--   select status_code, content from net._http_response where id = <the number this returns>;   -- 200 {"ok":true,...}
create or replace function public.cron_ping() returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/backup-household',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"cron_ping"}'::jsonb, timeout_milliseconds := 30000) $$;
revoke all on function public.cron_ping() from public, anon, authenticated;

-- 05:07 UTC: permanently delete households whose 7 days are up (after the 03:25 nightly backup)
select cron.unschedule(jobid) from cron.job where jobname = 'wealthpilot-purge-deleted';
select cron.schedule('wealthpilot-purge-deleted', '7 5 * * *', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/backup-household',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"purge_due"}'::jsonb, timeout_milliseconds := 120000)
$job$);
-- [/prod-only]
