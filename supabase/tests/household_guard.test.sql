-- 0.29.1 backstop (migration 0022): a second, unnamed household cannot be made by someone who already has one — the request a stray
-- click on the old sign-in screen sent on Nov 14 — whatever version of the app sends it. A first household, and a named extra one, still
-- work; the service role is not checked. Run by scripts/db-test.mjs on a fresh database.
\set ON_ERROR_STOP 1
\set QUIET 1
\set G '00000000-0000-4000-8000-0000000000a1'
\set N '00000000-0000-4000-8000-0000000000a2'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
create function pg_temp.refused(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
insert into auth.users (id, email, aud, role) values (:'G', 'g@x.test', 'authenticated', 'authenticated'), (:'N', 'n@x.test', 'authenticated', 'authenticated');

-- someone new: their first household may keep the default name
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'G')::text, false) \gset
select public.create_household('') as h1 \gset
reset role;
select pg_temp.ok((select name = 'My household' from public.households where id = :'h1'), 'a first household with no name typed is made, as "My household"');

-- the Nov 14 request: the same person, already in a household, sends create_household with no name (or the default one)
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'G')::text, false) \gset
select pg_temp.ok(pg_temp.refused($q$select public.create_household()$q$), 'a second household with no name is refused');
select pg_temp.ok(pg_temp.refused($q$select public.create_household('')$q$) and pg_temp.refused($q$select public.create_household('   ')$q$), 'so is a blank name');
select pg_temp.ok(pg_temp.refused($q$select public.create_household('My household')$q$) and pg_temp.refused($q$select public.create_household(' my HOUSEHOLD ')$q$), 'and the default name, however it is written');
reset role;
select pg_temp.ok((select count(*) = 1 from public.household_members where user_id = :'G'), 'nothing was made by the refused requests — still one household');
do $$ declare m text; h text; begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000a1')::text, true);
  begin perform public.create_household(); exception when others then get stacked diagnostics m = message_text, h = pg_exception_hint; end;
  perform pg_temp.ok(m like 'You already have a household%give it a name of its own.' and h = 'household_needs_name', 'the refusal says what to do instead');
end $$;

-- a deliberate extra household has a name of its own, and is made
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'G')::text, false) \gset
select public.create_household('Rental property') as h2 \gset
reset role;
select pg_temp.ok((select count(*) = 2 from public.household_members where user_id = :'G') and (select count(*) > 40 from public.categories where household_id = :'h2'), 'a named second household is made, with its starter categories');

-- someone invited into another household (a member, not an owner) still needs a name for one of their own
insert into public.household_members (household_id, user_id, email, role) values (:'h1', :'N', 'n@x.test', 'viewer');
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'N')::text, false) \gset
select pg_temp.ok(pg_temp.refused($q$select public.create_household()$q$), 'a member of someone else''s household is asked for a name too');
reset role;

-- the service role (account deletion, restores) is not checked
select set_config('request.jwt.claims', '', false) \gset
insert into public.households (name, created_by) values ('My household', :'G') returning id as h3 \gset
select pg_temp.ok((select count(*) = 1 from public.households where id = :'h3'), 'the service role can still write a household with the default name');
