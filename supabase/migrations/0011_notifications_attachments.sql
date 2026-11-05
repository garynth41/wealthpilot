-- 0011 (0.19.0): proactive alerts and receipts.
-- push_subscriptions  one row per browser/phone that opted in to Web Push (each user manages their own rows)
-- notifications       what was sent (or skipped, or failed), with a dedupe key so a rule never fires twice for the same thing
-- attachments         receipts and documents on transactions; the files live in the private `attachments` bucket under <household_id>/…
-- app_meta.vapid_public  the Web Push public key the browser subscribes with (the private key is an edge-function secret)
-- cron: notify daily at 12:30 UTC (07:30 Eastern), the Monday digest at 12:40 UTC

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null, auth text not null,
  user_agent text, created_at timestamptz not null default now(), last_used_at timestamptz, failures int not null default 0
);
create index if not exists push_subscriptions_household on public.push_subscriptions(household_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and is_member(household_id));
drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.push_subscriptions to authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null, dedupe_key text not null,
  title text not null, body text, url text,
  channel text not null check (channel in ('push', 'email', 'inapp')),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text
);
create unique index if not exists notifications_dedupe on public.notifications(household_id, dedupe_key, channel) where status = 'sent';
create index if not exists notifications_household_at on public.notifications(household_id, at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (is_member(household_id));
grant select on public.notifications to authenticated;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  name text not null, path text not null unique, mime text, size int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists attachments_household on public.attachments(household_id);
create index if not exists attachments_txn on public.attachments(transaction_id);
alter table public.attachments enable row level security;
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (is_member(household_id));
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated with check (can_edit(household_id) and path like household_id::text || '/%');
drop policy if exists attachments_update on public.attachments;
create policy attachments_update on public.attachments for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated using (can_edit(household_id));
drop trigger if exists trg_attachments_audit on public.attachments;
create trigger trg_attachments_audit before insert or update or delete on public.attachments for each row execute function public.touch_and_log();
drop trigger if exists trg_attachments_ref on public.attachments;
create trigger trg_attachments_ref before insert on public.attachments for each row execute function public.assign_ref();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'attachments') then
    alter publication supabase_realtime add table public.attachments;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attachments', 'attachments', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
drop policy if exists attachments_bucket_read on storage.objects;
create policy attachments_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists attachments_bucket_write on storage.objects;
create policy attachments_bucket_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists attachments_bucket_delete on storage.objects;
create policy attachments_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and can_edit(((storage.foldername(name))[1])::uuid));

-- daily alerts 12:30 UTC, Monday digest 12:40 UTC
select cron.unschedule(jobid) from cron.job where jobname in ('wealthpilot-notify-daily', 'wealthpilot-digest-weekly');
select cron.schedule('wealthpilot-notify-daily', '30 12 * * *', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"run_daily"}'::jsonb, timeout_milliseconds := 120000)
$job$);
select cron.schedule('wealthpilot-digest-weekly', '40 12 * * 1', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"digest"}'::jsonb, timeout_milliseconds := 120000)
$job$);
