-- 0023 (0.32.0): Ask Cresari — the advisor.
--   ai_access   who may use the advisor while it is in testing. Rows are added by the operator from Feedback & testers (ai_admin_set), never
--               from a migration — this repository is public, so no address or id is written here. `daily_limit` overrides the default for
--               one person; null = the default.
--   ai_usage    one row per question: who, which household, when, whether transaction detail was sent, the model and the token counts.
--               Never the question, the answer or any money data. It is what the daily limits count.
--   app_meta    the settings the operator changes without a release:
--                 ai_access        'testers' (default: only people in ai_access and the operator) | 'all' | 'off'
--                 ai_daily_limit   questions per person in any 24 hours (default 20)
--                 ai_global_daily  questions from everyone in any 24 hours (default 500) — a ceiling on cost
--                 ai_model         the model the ask-cresari function calls
-- The ask-cresari edge function is the only caller of ai_reserve / ai_finish (service role). The key for the AI service is an edge-function
-- secret (ANTHROPIC_API_KEY); it is never in the database or the app.

create table if not exists public.ai_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_limit int check (daily_limit is null or daily_limit between 0 and 1000),
  added_at timestamptz not null default now()
);
alter table public.ai_access enable row level security;
revoke all on public.ai_access from anon, authenticated;

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  detail boolean not null default false,
  model text check (char_length(model) <= 80),
  input_tokens int, output_tokens int,
  done boolean not null default false
);
create index if not exists ai_usage_user on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_recent on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

insert into public.app_meta(key, value) values ('ai_access', 'testers'), ('ai_daily_limit', '20'), ('ai_global_daily', '500'), ('ai_model', 'claude-sonnet-5-5')
  on conflict (key) do nothing;

-- a whole number from app_meta, or the fallback when it is missing or not a number
create or replace function public.ai_meta_int(p_key text, p_default int) returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select case when value ~ '^\d{1,6}$' then value::int end from public.app_meta where key = p_key), p_default) $$;
revoke all on function public.ai_meta_int(text, int) from public, anon, authenticated;

-- may this person use the advisor, and how many questions in 24 hours? (limit 0 = not allowed)
create or replace function public.ai_limit_for(p_user uuid) returns int language plpgsql stable security definer set search_path = '' as $$
declare v_mode text := coalesce((select value from public.app_meta where key = 'ai_access'), 'testers');
        v_row public.ai_access%rowtype; v_admin boolean; v_default int := public.ai_meta_int('ai_daily_limit', 20);
begin
  if p_user is null or v_mode = 'off' then return 0; end if;
  select * into v_row from public.ai_access where user_id = p_user;
  v_admin := exists (select 1 from public.app_admins where user_id = p_user);
  if v_mode <> 'all' and not found and not v_admin then return 0; end if;
  return coalesce(v_row.daily_limit, v_default);
end $$;
revoke all on function public.ai_limit_for(uuid) from public, anon, authenticated;

-- what the app shows: whether the advisor is open to this account, the limit and how much of it is used
create or replace function public.ai_status() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_limit int;
begin
  if v_uid is null then return jsonb_build_object('allowed', false, 'limit', 0, 'used', 0); end if;
  v_limit := public.ai_limit_for(v_uid);
  return jsonb_build_object('allowed', v_limit > 0, 'limit', v_limit,
    'used', (select count(*) from public.ai_usage where user_id = v_uid and created_at > now() - interval '24 hours'));
end $$;
revoke all on function public.ai_status() from public, anon;
grant execute on function public.ai_status() to authenticated;

-- Before a question goes to the AI service: check access, membership and the limits, and record the question. One at a time per person,
-- and one at a time for the whole-app ceiling (advisory locks), so questions sent together cannot slip under either limit. Service role only.
create or replace function public.ai_reserve(p_user uuid, p_household uuid, p_detail boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_limit int; v_used int; v_all int; v_cap int := public.ai_meta_int('ai_global_daily', 500); v_id uuid;
        v_model text := coalesce((select value from public.app_meta where key = 'ai_model' and value ~ '^[A-Za-z0-9._-]{3,80}$'), 'claude-sonnet-5-5');
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'signin'); end if;
  if not exists (select 1 from public.household_members where household_id = p_household and user_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  v_limit := public.ai_limit_for(p_user);
  if v_limit <= 0 then return jsonb_build_object('ok', false, 'reason', 'access', 'limit', 0, 'used', 0); end if;
  -- a question that never came back (the function was cut off) stops counting after ten minutes
  delete from public.ai_usage where not done and created_at < now() - interval '10 minutes';
  select count(*) into v_used from public.ai_usage where user_id = p_user and created_at > now() - interval '24 hours';
  if v_used >= v_limit then return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', v_limit, 'used', v_used); end if;
  -- the ceiling for everyone is checked one question at a time too (always after the person's own lock, so the two never deadlock)
  perform pg_advisory_xact_lock(hashtextextended('ai:everyone', 0));
  select count(*) into v_all from public.ai_usage where created_at > now() - interval '24 hours';
  if v_all >= v_cap then return jsonb_build_object('ok', false, 'reason', 'busy', 'limit', v_limit, 'used', v_used); end if;
  insert into public.ai_usage (user_id, household_id, detail, model) values (p_user, p_household, coalesce(p_detail, false), v_model) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'model', v_model, 'limit', v_limit, 'used', v_used + 1);
end $$;
revoke all on function public.ai_reserve(uuid, uuid, boolean) from public, anon, authenticated;

-- After the AI service answers: keep the token counts. If it failed, the question is taken back so it does not count.
create or replace function public.ai_finish(p_id uuid, p_ok boolean, p_in int default null, p_out int default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then update public.ai_usage set done = true, input_tokens = p_in, output_tokens = p_out where id = p_id;
  else delete from public.ai_usage where id = p_id and not done; end if;
end $$;
revoke all on function public.ai_finish(uuid, boolean, int, int) from public, anon, authenticated;

-- ---- the operator (Feedback & testers) ----
create or replace function public.ai_admin_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'Only the app''s operator can manage the advisor' using errcode = '42501'; end if;
  return jsonb_build_object(
    'access', coalesce((select value from public.app_meta where key = 'ai_access'), 'testers'),
    'daily_limit', public.ai_meta_int('ai_daily_limit', 20), 'global_daily', public.ai_meta_int('ai_global_daily', 500),
    'model', coalesce((select value from public.app_meta where key = 'ai_model'), 'claude-sonnet-5-5'),
    'used_24h', (select count(*) from public.ai_usage where created_at > now() - interval '24 hours'),
    'used_30d', (select count(*) from public.ai_usage where created_at > now() - interval '30 days'),
    'tokens_30d', (select coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) from public.ai_usage where created_at > now() - interval '30 days'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'daily_limit', a.daily_limit, 'added_at', a.added_at,
        'used_24h', (select count(*) from public.ai_usage x where x.user_id = a.user_id and x.created_at > now() - interval '24 hours'),
        'used_30d', (select count(*) from public.ai_usage x where x.user_id = a.user_id and x.created_at > now() - interval '30 days')) order by a.added_at desc)
      from public.ai_access a join auth.users u on u.id = a.user_id), '[]'::jsonb));
end $$;
revoke all on function public.ai_admin_overview() from public, anon;
grant execute on function public.ai_admin_overview() to authenticated;

-- give or take away one person's access, by the address they sign in with; p_daily_limit null = the default
create or replace function public.ai_admin_set(p_email text, p_allowed boolean, p_daily_limit int default null) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if not public.is_app_admin() then raise exception 'Only the app''s operator can manage the advisor' using errcode = '42501'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'No account uses that address yet — they need to sign up first' using errcode = 'P0002'; end if;
  if p_daily_limit is not null and p_daily_limit not between 0 and 1000 then raise exception 'The daily limit must be between 0 and 1000' using errcode = '22023'; end if;
  if p_allowed then
    insert into public.ai_access (user_id, daily_limit) values (v_uid, p_daily_limit) on conflict (user_id) do update set daily_limit = excluded.daily_limit;
  else delete from public.ai_access where user_id = v_uid; end if;
  return true;
end $$;
revoke all on function public.ai_admin_set(text, boolean, int) from public, anon;
grant execute on function public.ai_admin_set(text, boolean, int) to authenticated;

-- the settings: who gets it, the default daily limit, the ceiling for everyone, the model. A null leaves that setting as it is.
create or replace function public.ai_admin_config(p_access text default null, p_daily_limit int default null, p_global_daily int default null, p_model text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'Only the app''s operator can manage the advisor' using errcode = '42501'; end if;
  if p_access is not null and p_access not in ('testers', 'all', 'off') then raise exception 'Access is testers, all or off' using errcode = '22023'; end if;
  if p_daily_limit is not null and p_daily_limit not between 1 and 1000 then raise exception 'The daily limit must be between 1 and 1000' using errcode = '22023'; end if;
  if p_global_daily is not null and p_global_daily not between 1 and 100000 then raise exception 'The ceiling must be between 1 and 100000' using errcode = '22023'; end if;
  if p_model is not null and p_model !~ '^[A-Za-z0-9._-]{3,80}$' then raise exception 'That does not look like a model name' using errcode = '22023'; end if;
  insert into public.app_meta (key, value, updated_at)
    select k, v, now() from (values ('ai_access', p_access), ('ai_daily_limit', p_daily_limit::text), ('ai_global_daily', p_global_daily::text), ('ai_model', p_model)) as s(k, v) where v is not null
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;
revoke all on function public.ai_admin_config(text, int, int, text) from public, anon;
grant execute on function public.ai_admin_config(text, int, int, text) to authenticated;
