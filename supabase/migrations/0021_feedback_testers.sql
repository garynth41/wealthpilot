-- 0021 (0.29.0): testers and feedback.
--   app_admins     who runs the app (reads every piece of feedback, sees the tester numbers). Rows are added by hand on the server, never
--                  from the app or a migration — this repository is public, so no address or id is written here:
--                    insert into public.app_admins (user_id) select id from auth.users where lower(email) = lower('<operator email>');
--   feedback       what testers send from the Feedback button: what kind, a 1–5 rating, the message, and — if they leave it ticked — the
--                  page, app version and device it came from. Never any money data. Anyone can send (the offline demo has no account);
--                  submit_feedback() is the only way in and limits how much one person or one network can send.
--   tester_stats() for the operator: sign-ups, recent sign-ins, households and feedback per invite code (?t=… on the invite link, kept in
--                  the account's sign-up details as `tester`).
-- Production also tells the operator about each new piece of feedback at once (push and email, by the notify function): the
-- production-only trigger at the end. Staging and the database tests leave it out.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_app_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.app_admins where user_id = auth.uid()) $$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('bug', 'confusing', 'idea', 'praise', 'other')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 1 and 4000),
  page text check (char_length(page) <= 200),
  app_version text check (char_length(app_version) <= 40),
  platform text check (char_length(platform) <= 20),
  device text check (char_length(device) <= 200),
  screen text check (char_length(screen) <= 40),
  look text check (char_length(look) <= 40),
  demo boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  tester text check (tester is null or tester ~ '^[A-Za-z0-9_-]{1,40}$'),
  status text not null default 'new' check (status in ('new', 'seen', 'planned', 'fixed', 'wontfix', 'duplicate')),
  admin_note text check (char_length(admin_note) <= 4000),
  issue_url text check (issue_url is null or (char_length(issue_url) <= 300 and issue_url ~ '^https://')),
  -- a one-way hash of the sender's network address, only for the sending limits; cleared after a week (submit_feedback)
  client_hash text,
  notified_at timestamptz
);
create index if not exists feedback_created on public.feedback (created_at desc);
create index if not exists feedback_user on public.feedback (user_id) where user_id is not null;
create index if not exists feedback_client on public.feedback (client_hash, created_at) where client_hash is not null;
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
-- a signed-in tester reads their own (to see what became of it); the operator reads, triages and removes everything
grant select, delete on public.feedback to authenticated;
grant update (status, admin_note, issue_url) on public.feedback to authenticated;
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated using (user_id = (select auth.uid()) or (select public.is_app_admin()));
drop policy if exists feedback_triage on public.feedback;
create policy feedback_triage on public.feedback for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists feedback_remove on public.feedback;
create policy feedback_remove on public.feedback for delete to authenticated using ((select public.is_app_admin()));

-- keep updated_at, and when the account behind a piece of feedback is deleted (user_id set to null) its reply address goes with it
create or replace function public.feedback_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if old.user_id is not null and new.user_id is null then new.email := null; end if;
  return new;
end $$;
drop trigger if exists trg_feedback_touch on public.feedback;
create trigger trg_feedback_touch before update on public.feedback for each row execute function public.feedback_touch();

-- The one way to send feedback. Checks every field, fills in who sent it from the session (never from the app), and limits sending:
-- 5 in 10 minutes and 30 a day from one account or one network, 500 a day in all.
create or replace function public.submit_feedback(p_kind text, p_message text, p_rating int default null, p_page text default null,
  p_app_version text default null, p_platform text default null, p_device text default null, p_screen text default null, p_look text default null,
  p_demo boolean default false, p_email text default null, p_tester text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); msg text := btrim(coalesce(p_message, '')); em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  t text := nullif(btrim(coalesce(p_tester, '')), ''); ip text := ''; ch text; n int; new_id uuid;
begin
  if p_kind is null or p_kind not in ('bug', 'confusing', 'idea', 'praise', 'other') then raise exception 'Pick what kind of feedback this is' using errcode = '22023'; end if;
  if char_length(msg) < 3 then raise exception 'Write a few words first' using errcode = '22023'; end if;
  if char_length(msg) > 4000 then raise exception 'Keep it under 4,000 characters — send the rest as a second note' using errcode = '22023'; end if;
  if p_rating is not null and p_rating not between 1 and 5 then raise exception 'A rating is 1 to 5 stars' using errcode = '22023'; end if;
  if em is not null and (char_length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'That email address does not look right' using errcode = '22023'; end if;
  if t is not null and t !~ '^[A-Za-z0-9_-]{1,40}$' then t := null; end if;
  begin ip := btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)); exception when others then ip := ''; end;
  ch := case when ip <> '' then encode(sha256(convert_to('cresari-feedback:' || ip, 'UTF8')), 'hex') end;
  if uid is not null or ch is not null then
    select count(*) into n from public.feedback where created_at > now() - interval '10 minutes' and ((uid is not null and user_id = uid) or (ch is not null and client_hash = ch));
    if n >= 5 then raise exception 'That is a lot of feedback at once — thank you! Please try again in a few minutes.' using errcode = 'P0001'; end if;
    select count(*) into n from public.feedback where created_at > now() - interval '1 day' and ((uid is not null and user_id = uid) or (ch is not null and client_hash = ch));
    if n >= 30 then raise exception 'You have sent 30 notes today — thank you! Please send the rest tomorrow.' using errcode = 'P0001'; end if;
  end if;
  select count(*) into n from public.feedback where created_at > now() - interval '1 day';
  if n >= 500 then raise exception 'Feedback is paused for today — please try again tomorrow.' using errcode = 'P0001'; end if;
  update public.feedback set client_hash = null where client_hash is not null and created_at < now() - interval '7 days';
  insert into public.feedback (kind, rating, message, page, app_version, platform, device, screen, look, demo, user_id, email, tester, client_hash)
  values (p_kind, p_rating, msg, left(p_page, 200), left(p_app_version, 40), left(p_platform, 20), left(p_device, 200), left(p_screen, 40), left(p_look, 40),
          coalesce(p_demo, false), uid, em, t, ch)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.submit_feedback(text, text, int, text, text, text, text, text, text, boolean, text, text) from public;
grant execute on function public.submit_feedback(text, text, int, text, text, text, text, text, text, boolean, text, text) to anon, authenticated;

-- For the operator: how each invite code is doing. Counts only — no names or addresses.
create or replace function public.tester_stats() returns table (tester text, signed_up bigint, active_7d bigint, households bigint, feedback bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'Only the app''s operator can see the tester numbers' using errcode = '42501'; end if;
  return query
  with u as (select x.id, coalesce(nullif(x.raw_user_meta_data ->> 'tester', ''), '') as code, x.last_sign_in_at from auth.users x),
       codes as (select u.code from u union select coalesce(f.tester, '') from public.feedback f)
  select c.code,
    (select count(*) from u where u.code = c.code),
    (select count(*) from u where u.code = c.code and u.last_sign_in_at > now() - interval '7 days'),
    (select count(distinct m.household_id) from public.household_members m join u on u.id = m.user_id where u.code = c.code and m.role::text = 'owner'),
    (select count(*) from public.feedback f where coalesce(f.tester, '') = c.code)
  from codes c order by 2 desc, 1;
end $$;
revoke all on function public.tester_stats() from public;
grant execute on function public.tester_stats() to authenticated;

-- [prod-only] tell the operator at once: the notify function sends a push to their devices and an email (action "feedback")
create or replace function public.feedback_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := jsonb_build_object('action', 'feedback', 'id', new.id), timeout_milliseconds := 30000);
  return new;
exception when others then return new;   -- a notification that cannot be sent never loses the feedback
end $$;
drop trigger if exists trg_feedback_notify on public.feedback;
create trigger trg_feedback_notify after insert on public.feedback for each row execute function public.feedback_notify();
-- [/prod-only]

-- down: (the reverse — run only to roll back. Every piece of feedback is lost; export it from the inbox first.)
--   drop trigger if exists trg_feedback_notify on public.feedback; drop function if exists public.feedback_notify();
--   drop function if exists public.tester_stats(); drop function if exists public.submit_feedback(text, text, int, text, text, text, text, text, text, boolean, text, text);
--   drop table if exists public.feedback; drop function if exists public.feedback_touch(); drop function if exists public.is_app_admin(); drop table if exists public.app_admins;
