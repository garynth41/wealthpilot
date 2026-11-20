-- 0.32.0: Ask Cresari (migration 0023) — only invited testers and the operator may ask, a question is counted before it is sent, the
-- per-person and whole-app limits hold, a failed question is not counted, nobody reads the tables directly, and only the operator
-- manages access and the settings. Run by scripts/db-test.mjs on a fresh database.
\set ON_ERROR_STOP 1
\set QUIET 1
\set A '00000000-0000-4000-8000-0000000000a1'
\set B '00000000-0000-4000-8000-0000000000a2'
\set OP '00000000-0000-4000-8000-0000000000a3'
\set H '00000000-0000-4000-8000-0000000000b1'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
create function pg_temp.refused(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
insert into auth.users (id, email, aud, role) values (:'A', 'a@x.test', 'authenticated', 'authenticated'), (:'B', 'b@x.test', 'authenticated', 'authenticated'), (:'OP', 'op@x.test', 'authenticated', 'authenticated');
insert into public.app_admins (user_id) values (:'OP');
insert into public.households (id, name) values (:'H', 'Test');
insert into public.household_members (household_id, user_id, email, role) values (:'H', :'A', 'a@x.test', 'owner'), (:'H', :'OP', 'op@x.test', 'editor');

select pg_temp.ok((select value = 'testers' from public.app_meta where key = 'ai_access') and public.ai_meta_int('ai_daily_limit', 0) = 20, 'the advisor starts open to testers only, 20 questions a day');
select pg_temp.ok(public.ai_limit_for(:'A') = 0 and public.ai_limit_for(:'OP') = 20 and public.ai_limit_for(null) = 0, 'someone not invited has no access; the operator has');
select pg_temp.ok((public.ai_reserve(:'A', :'H', false) ->> 'reason') = 'access', 'a question from someone not invited is refused before anything is sent');
select pg_temp.ok((select count(*) = 0 from public.ai_usage), 'and it is not counted');

-- the operator invites A
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'OP')::text, false) \gset
select pg_temp.ok(public.ai_admin_set(' A@X.Test ', true, 3), 'the operator gives access by address, with a limit of 3');
select pg_temp.ok(pg_temp.refused($q$select public.ai_admin_set('nobody@x.test', true)$q$), 'an address with no account is refused');
select pg_temp.ok(pg_temp.refused($q$select public.ai_admin_set('a@x.test', true, 5000)$q$), 'a limit over 1,000 is refused');
select pg_temp.ok((public.ai_admin_overview() -> 'people' -> 0 ->> 'email') = 'a@x.test' and (public.ai_admin_overview() ->> 'access') = 'testers', 'the operator sees who has access');
select pg_temp.ok(pg_temp.refused($q$select * from public.ai_access$q$) and pg_temp.refused($q$select * from public.ai_usage$q$), 'not even the operator reads the tables directly');
select pg_temp.ok(pg_temp.refused($q$select public.ai_reserve('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', false)$q$)
  and pg_temp.refused($q$select public.ai_finish(gen_random_uuid(), true)$q$), 'the app cannot record or take back a question itself');

-- A, signed in
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) \gset
select pg_temp.ok(public.ai_status() = '{"allowed": true, "limit": 3, "used": 0}'::jsonb, 'a tester sees they have access and their limit');
select pg_temp.ok(pg_temp.refused($q$select public.ai_admin_overview()$q$) and pg_temp.refused($q$select public.ai_admin_set('b@x.test', true)$q$) and pg_temp.refused($q$select public.ai_admin_config('all')$q$), 'a tester cannot manage access or the settings');
select pg_temp.ok(pg_temp.refused($q$update public.app_meta set value = 'all' where key = 'ai_access'$q$) or (select value = 'testers' from public.app_meta where key = 'ai_access'), 'a tester cannot change the settings directly');
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false) \gset
select pg_temp.ok(public.ai_status() = '{"allowed": false, "limit": 0, "used": 0}'::jsonb, 'someone not invited sees it is not open to them');
set role anon; select set_config('request.jwt.claims', '{}', false) \gset
select pg_temp.ok(pg_temp.refused($q$select public.ai_status()$q$), 'the public cannot ask at all');
reset role;

-- the limits (the function's side)
select public.ai_reserve(:'A', :'H', true) as r1 \gset
select pg_temp.ok((:'r1'::jsonb ->> 'ok')::boolean and (:'r1'::jsonb ->> 'used') = '1' and (:'r1'::jsonb ->> 'model') = 'claude-sonnet-5-5', 'an invited tester''s question is counted before it is sent');
select public.ai_finish((:'r1'::jsonb ->> 'id')::uuid, true, 1200, 300);
select pg_temp.ok((select done and detail and input_tokens = 1200 and output_tokens = 300 from public.ai_usage where id = (:'r1'::jsonb ->> 'id')::uuid), 'the answer''s size is kept, never the question');
select public.ai_reserve(:'A', :'H', false) as r2 \gset
select public.ai_finish((:'r2'::jsonb ->> 'id')::uuid, false);
select pg_temp.ok((select count(*) = 1 from public.ai_usage where user_id = :'A'), 'a question the AI service failed on is not counted');
select public.ai_reserve(:'A', :'H', false); select public.ai_reserve(:'A', :'H', false);
select pg_temp.ok((public.ai_reserve(:'A', :'H', false) ->> 'reason') = 'limit' and (select count(*) = 3 from public.ai_usage where user_id = :'A'), 'the fourth question in a day is refused at a limit of 3');
update public.ai_usage set created_at = now() - interval '25 hours' where id = (:'r1'::jsonb ->> 'id')::uuid;
select pg_temp.ok((public.ai_reserve(:'A', :'H', false) ->> 'ok')::boolean, 'and allowed again once a day has passed since the first');
update public.ai_usage set created_at = now() - interval '11 minutes', done = false where user_id = :'A' and created_at > now() - interval '1 hour' and id = (select id from public.ai_usage where user_id = :'A' and created_at > now() - interval '1 hour' limit 1);
select pg_temp.ok((public.ai_reserve(:'A', :'H', false) ->> 'ok')::boolean, 'a question that never came back stops counting after ten minutes');
select pg_temp.ok((public.ai_reserve(:'A', gen_random_uuid(), false) ->> 'reason') = 'member' and (public.ai_reserve(:'B', :'H', false) ->> 'reason') = 'member', 'a question about a household you are not in is refused');

-- the settings
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'OP')::text, false) \gset
select pg_temp.ok(public.ai_admin_config(null, null, 3, 'claude-haiku-5-5'), 'the operator changes the ceiling and the model without a release');
select pg_temp.ok(pg_temp.refused($q$select public.ai_admin_config('everyone')$q$) and pg_temp.refused($q$select public.ai_admin_config(null, null, null, 'bad model!')$q$), 'a setting that makes no sense is refused');
reset role;
select pg_temp.ok((public.ai_reserve(:'OP', :'H', false) ->> 'reason') = 'busy', 'the ceiling for everyone holds, also for the operator');
set role authenticated;
select public.ai_admin_config('all', 5, 500, null);
reset role;
insert into public.household_members (household_id, user_id, email, role) values (:'H', :'B', 'b@x.test', 'viewer');
select pg_temp.ok(public.ai_limit_for(:'B') = 5 and public.ai_limit_for(:'A') = 3 and (public.ai_reserve(:'B', :'H', false) ->> 'model') = 'claude-haiku-5-5', 'opened to everyone: the default limit applies, a personal limit still wins, the new model is used');
set role authenticated; select public.ai_admin_config('off'); select public.ai_admin_set('a@x.test', false); reset role;
select pg_temp.ok(public.ai_limit_for(:'A') = 0 and public.ai_limit_for(:'OP') = 0, 'switched off: nobody can ask');
delete from auth.users where id = :'B';
select pg_temp.ok((select count(*) = 0 from public.ai_usage where user_id = :'B'), 'deleting an account takes its usage rows with it');
