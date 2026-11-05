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
select cron.unschedule(jobid) from cron.job where jobname = 'wealthpilot-trim-errors';
select cron.schedule('wealthpilot-trim-errors', '41 4 * * 1', $$ select public.trim_app_errors() $$);

-- storage bucket for backups
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('backups', 'backups', false, 52428800, array['application/json'])
  on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/json'];
drop policy if exists backups_read on storage.objects;
create policy backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and is_member(((storage.foldername(name))[1])::uuid));
-- no insert/update/delete policies for authenticated: only the service role (the backup function) writes

-- nightly backup, 03:25 UTC, through the backup-household edge function with the same Vault secret as the bank sync
select cron.unschedule(jobid) from cron.job where jobname = 'wealthpilot-nightly-backup';
select cron.schedule('wealthpilot-nightly-backup', '25 3 * * *', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/backup-household',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"backup_all"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);
