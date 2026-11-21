-- 0.35.0 (migration 0024): saved forecasts. One per household per month; editors add them, nobody changes one afterwards; reading follows
-- the Accounts section; another household sees nothing. Run by scripts/db-test.mjs on a fresh database.
\set ON_ERROR_STOP 1
\set QUIET 1
\set O '00000000-0000-4000-8000-0000000000b1'
\set V '00000000-0000-4000-8000-0000000000b2'
\set L '00000000-0000-4000-8000-0000000000b3'
\set X '00000000-0000-4000-8000-0000000000b4'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
create function pg_temp.refused(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.rows(q text) returns bigint language plpgsql as $$ declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
insert into auth.users (id, email, aud, role) values (:'O', 'o@x.test', 'authenticated', 'authenticated'), (:'V', 'v@x.test', 'authenticated', 'authenticated'),
  (:'L', 'l@x.test', 'authenticated', 'authenticated'), (:'X', 'x@x.test', 'authenticated', 'authenticated');

set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select public.create_household('Forecast test') as h \gset
reset role;
insert into public.household_members (household_id, user_id, email, role) values (:'h', :'V', 'v@x.test', 'viewer');
insert into public.household_members (household_id, user_id, email, role, modules) values (:'h', :'L', 'l@x.test', 'editor', array['budget']);
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'X')::text, false) \gset
select public.create_household('Someone else') as h2 \gset
reset role;

-- the owner saves this month's forecast
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
insert into public.forecast_snapshots (household_id, taken_on, through, start_cash, expected_in, expected_out, expected_end, expected_low, low_date, by_source)
  values (:'h', '2026-11-03', '2026-11-30', 5000, 4600, 3900, 5700, 4100, '2026-11-12', '{"in_pay": 4600, "out_bills": 2100, "out_everyday": 1800}');
select pg_temp.ok((select count(*) = 1 and bool_and(created_by = :'O') from public.forecast_snapshots where household_id = :'h'), 'an owner saves a forecast, and it is stamped with who saved it');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through) values (%L, '2026-11-20', '2026-11-30')$q$, :'h')), 'a second forecast for the same month is refused');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through) values (%L, '2026-12-10', '2026-12-01')$q$, :'h')), 'one that ends before it starts is refused');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through, expected_out) values (%L, '2026-12-01', '2026-12-31', -5)$q$, :'h')), 'money out cannot be negative');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through, by_source) values (%L, '2026-12-01', '2026-12-31', '[1]')$q$, :'h')), 'the breakdown has to be a set of named totals');
-- nobody changes a saved forecast, the owner included
select pg_temp.ok(pg_temp.refused(format($q$update public.forecast_snapshots set expected_end = 1 where household_id = %L$q$, :'h')), 'a saved forecast cannot be changed, even by the owner');
reset role;
select pg_temp.ok((select expected_end = 5700 from public.forecast_snapshots where household_id = :'h'), 'and it still holds what was saved');

-- a viewer reads it and cannot add or remove one
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'V')::text, false) \gset
select pg_temp.ok((select count(*) = 1 from public.forecast_snapshots), 'a viewer of the household can read it');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through) values (%L, '2026-12-01', '2026-12-31')$q$, :'h')), 'a viewer cannot save one');
select pg_temp.ok(pg_temp.rows($q$delete from public.forecast_snapshots$q$) = 0, 'a viewer cannot delete one');
-- a member without the Accounts section does not see cash totals here either
select set_config('request.jwt.claims', json_build_object('sub', :'L')::text, false) \gset
select pg_temp.ok((select count(*) = 0 from public.forecast_snapshots), 'a member without the Accounts section sees none');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through) values (%L, '2026-12-01', '2026-12-31')$q$, :'h')), 'and cannot save one');
-- someone in another household sees nothing and cannot write into this one
select set_config('request.jwt.claims', json_build_object('sub', :'X')::text, false) \gset
select pg_temp.ok((select count(*) = 0 from public.forecast_snapshots), 'another household sees nothing');
select pg_temp.ok(pg_temp.refused(format($q$insert into public.forecast_snapshots (household_id, taken_on, through) values (%L, '2026-12-01', '2026-12-31')$q$, :'h')), 'and cannot save into this one');
insert into public.forecast_snapshots (household_id, taken_on, through) values (:'h2', '2026-11-03', '2026-11-30');
select pg_temp.ok((select count(*) = 1 from public.forecast_snapshots), 'the same month in their own household is theirs to save');
-- signed out: nothing
reset role; set role anon; select set_config('request.jwt.claims', '', false) \gset
select pg_temp.ok(pg_temp.refused($q$select count(*) from public.forecast_snapshots$q$), 'a signed-out visitor cannot read the table at all');
reset role;

-- the owner can delete (a restore that replaces everything), and the rows go with the household
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select pg_temp.ok(pg_temp.rows(format($q$delete from public.forecast_snapshots where household_id = %L$q$, :'h')) = 1, 'the owner can delete one');
reset role;
delete from public.households where id = :'h2';
select pg_temp.ok((select count(*) = 0 from public.forecast_snapshots), 'deleting a household takes its saved forecasts with it');
