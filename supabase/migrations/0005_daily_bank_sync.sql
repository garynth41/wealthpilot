-- 0005 — daily automatic bank sync (SimpleFIN) without anyone handling a secret.
-- A random caller secret is generated inside the database and kept in Vault. The pg_cron job reads it at run time
-- and sends it to the sync-simplefin edge function, which checks it with cron_secret_ok() (service role only).
-- The Authorization header carries the project's public anon key, which the edge gateway (verify_jwt) needs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wealthpilot_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'wealthpilot_cron_secret', 'Daily bank sync: proves a sync_all call came from pg_cron');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(length(p) >= 32, false) and exists (select 1 from vault.decrypted_secrets where name = 'wealthpilot_cron_secret' and decrypted_secret = p) $$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- 10:17 UTC = 5:17 am Eastern (6:17 am in summer): banks have posted the previous day by then.
select cron.unschedule(jobid) from cron.job where jobname = 'wealthpilot-daily-sync';
select cron.schedule('wealthpilot-daily-sync', '17 10 * * *', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/sync-simplefin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"sync_all"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);
