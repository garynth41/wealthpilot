-- 0013 (0.20.0, Phase 4): saved scenarios, promotional APRs, market prices for holdings, session list for the device panel.
-- Idempotent: safe to re-run.

-- 1. Saved scenarios — a named set of what-if assumptions for the Forecast, Debts, Goals, Retirement or the unified Plan view.
--    `assumptions` is the page's slider state as JSON (see src/lib/scenarios.ts for the shapes). Nothing here changes real data.
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, ref text,
  name text not null default 'Scenario',
  kind text not null check (kind in ('forecast','debt','goal','retirement','plan')),
  assumptions jsonb not null default '{}'::jsonb,
  notes text, pinned boolean not null default false, sort_order int not null default 0,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists scenarios_household on public.scenarios(household_id);
alter table public.scenarios enable row level security;
drop policy if exists scenarios_select on public.scenarios;
create policy scenarios_select on public.scenarios for select to authenticated using (is_member(household_id));
drop policy if exists scenarios_insert on public.scenarios;
create policy scenarios_insert on public.scenarios for insert to authenticated with check (can_edit(household_id));
drop policy if exists scenarios_update on public.scenarios;
create policy scenarios_update on public.scenarios for update to authenticated using (can_edit(household_id)) with check (can_edit(household_id));
drop policy if exists scenarios_delete on public.scenarios;
create policy scenarios_delete on public.scenarios for delete to authenticated using (can_edit(household_id));
drop trigger if exists trg_scenarios_audit on public.scenarios;
create trigger trg_scenarios_audit before insert or update or delete on public.scenarios for each row execute function public.touch_and_log();
drop trigger if exists trg_scenarios_ref on public.scenarios;
create trigger trg_scenarios_ref before insert on public.scenarios for each row execute function public.assign_ref();
-- refs: scenarios are N-001, N-002 …
create or replace function public.assign_ref() returns trigger language plpgsql security definer set search_path = public as $$
declare p text; k int;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  p := case tg_table_name when 'transactions' then 'T' when 'accounts' then 'A' when 'recurring' then 'R' when 'goals' then 'G' when 'planned_items' then 'X'
       when 'hardship_outreach' then 'H' when 'email_items' then 'E' when 'statements' then 'S' when 'pay_schedules' then 'P' when 'categories' then 'C' when 'budget_periods' then 'B'
       when 'holdings' then 'I' when 'reconciliations' then 'K' when 'scenarios' then 'N' else 'Z' end;
  insert into public.ref_counters(household_id, prefix, n) values (new.household_id, p, 1)
    on conflict (household_id, prefix) do update set n = public.ref_counters.n + 1 returning n into k;
  new.ref := p || '-' || lpad(k::text, 3, '0');
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'scenarios') then
    alter publication supabase_realtime add table public.scenarios;
  end if;
end $$;

-- 2. Promotional APR on a card or loan: `promo_apr` applies until `promo_until` (inclusive), then `apr` takes over.
alter table public.accounts add column if not exists promo_apr numeric check (promo_apr is null or promo_apr >= 0);
alter table public.accounts add column if not exists promo_until date;

-- 3. Market prices. Public market data, so one table for everyone: readable by any signed-in user, written only by the price-feed
--    function (service role). Holdings opt in with price_source = 'auto' (the default when a symbol is set); 'manual' keeps the typed price.
create table if not exists public.prices (
  symbol text not null, date date not null, price numeric not null check (price >= 0), currency text not null default 'USD',
  source text not null default 'stooq', fetched_at timestamptz not null default now(),
  primary key (symbol, date)
);
create index if not exists prices_symbol_date on public.prices(symbol, date desc);
alter table public.prices enable row level security;
drop policy if exists prices_select on public.prices;
create policy prices_select on public.prices for select to authenticated using (true);
alter table public.holdings add column if not exists price_source text not null default 'auto' check (price_source in ('auto','manual'));
-- a holding without a symbol can only be manual
update public.holdings set price_source = 'manual' where symbol is null or btrim(symbol) = '';

-- 4. Device list: the signed-in user's own sessions (Supabase keeps one per device). Security definer because auth.sessions is not
--    exposed to clients; only the caller's rows are returned, and only the caller's rows can be revoked.
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, is_current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, s.ip::text,
         s.id::text = coalesce(auth.jwt() ->> 'session_id', '') as is_current
  from auth.sessions s where s.user_id = auth.uid() order by s.updated_at desc
$$;
revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;
create or replace function public.revoke_session(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_id::text = coalesce(auth.jwt() ->> 'session_id', '') then raise exception 'use sign out for the current session'; end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  get diagnostics n = row_count; return n > 0;
end $$;
revoke all on function public.revoke_session(uuid) from public, anon;
grant execute on function public.revoke_session(uuid) to authenticated;

-- 5. Daily price pull after the US close (22:30 UTC, Mon–Fri). The function reads every auto-priced symbol, so no per-household secret.
select cron.unschedule(jobid) from cron.job where jobname = 'wealthpilot-price-feed';
select cron.schedule('wealthpilot-price-feed', '30 22 * * 1-5', $job$
  select net.http_post(
    url := 'https://dshswfcpovdpxcidolqb.supabase.co/functions/v1/price-feed',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaHN3ZmNwb3ZkcHhjaWRvbHFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MDE4NDksImV4cCI6MjEwOTA3Nzg0OX0.UEJDSrzub-Nfb-DPYpYcxOu0Cm6WTpzN2-rNRK15kdU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_cron_secret')),
    body := '{"action":"run"}'::jsonb, timeout_milliseconds := 120000)
$job$);

-- 6. Quiet price updates. The audit trigger logs every row change; a daily price pull would add one activity row per holding per day.
--    apply_price_updates() (service role only) sets a transaction-local flag that touch_and_log honours for UPDATEs, then writes one
--    summary row per household instead. Clients cannot set the flag: PostgREST runs no arbitrary SQL and no client-callable function sets it.
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
    when 'scenarios' then j->>'name'
    else null end;
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary) values (hh, auth.uid(), em, lower(tg_op), tg_table_name, rid, left(summ, 200));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $function$;

create or replace function public.apply_price_updates(p jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  perform set_config('wealthpilot.quiet_audit', 'on', true);
  with x as (select (e->>'id')::uuid as id, (e->>'price')::numeric as price, (e->>'price_as_of')::date as d from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e),
       u as (update public.holdings h set price = x.price, price_as_of = x.d from x
             where h.id = x.id and h.price_source = 'auto' and (h.price_as_of is null or h.price_as_of <= x.d) returning h.household_id)
  insert into public.activity_log(household_id, user_id, user_email, action, table_name, record_id, summary)
    select household_id, null, 'price feed', 'update', 'holdings', null, 'Market prices updated for ' || count(*) || ' holding' || case when count(*) = 1 then '' else 's' end
    from u group by household_id;
  get diagnostics n = row_count;
  perform set_config('wealthpilot.quiet_audit', 'off', true);
  return n;
end $$;
revoke all on function public.apply_price_updates(jsonb) from public, anon, authenticated;
grant execute on function public.apply_price_updates(jsonb) to service_role;
