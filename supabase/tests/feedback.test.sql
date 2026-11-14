-- 0.29.0: feedback from testers (migration 0021) — anyone can send through submit_feedback, every field is checked, sending is limited,
-- testers read only their own, only the operator (app_admins) reads and triages everything and sees the tester numbers, and deleting an
-- account takes its reply address with it. Run by scripts/db-test.mjs on a fresh database.
\set ON_ERROR_STOP 1
\set QUIET 1
\set A '00000000-0000-4000-8000-0000000000f1'
\set B '00000000-0000-4000-8000-0000000000f2'
\set OP '00000000-0000-4000-8000-0000000000f3'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
create function pg_temp.refused(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
insert into auth.users (id, email, aud, role, raw_user_meta_data, last_sign_in_at) values
  (:'A', 'a@x.test', 'authenticated', 'authenticated', '{"tester":"church"}', now()), (:'B', 'b@x.test', 'authenticated', 'authenticated', '{"tester":"church"}', now() - interval '30 days'),
  (:'OP', 'op@x.test', 'authenticated', 'authenticated', '{}', now());
insert into public.app_admins (user_id) values (:'OP');

-- the offline demo has no account: anyone can send
set role anon; select set_config('request.jwt.claims', '{}', false) \gset
select public.submit_feedback('bug', '  The budget total looks wrong  ', 4, '/budget', '0.29.0', 'web', 'iPhone · Safari', '390×844', 'terminal dark', true, null, 'church') as f1 \gset
reset role;
select pg_temp.ok((select user_id is null and demo and message = 'The budget total looks wrong' and tester = 'church' and status = 'new' from public.feedback where id = :'f1'), 'anyone can send feedback; the message is trimmed and starts as new');
set role anon;
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('rant', 'hello there')$q$), 'an unknown kind is refused');
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('idea', '  a ')$q$), 'a message of a word or two letters is refused');
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('idea', repeat('x', 4001))$q$), 'a message over 4,000 characters is refused');
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('idea', 'nice', 6)$q$), 'a rating outside 1–5 is refused');
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('idea', 'nice', null, null, null, null, null, null, null, false, 'not an address')$q$), 'a reply address that is not an address is refused');
select pg_temp.ok(pg_temp.refused($q$select count(*) from public.feedback$q$), 'the public cannot read any feedback');
select pg_temp.ok(pg_temp.refused($q$insert into public.feedback (kind, message) values ('idea', 'straight in')$q$), 'the public cannot write to the table directly');

-- a signed-in tester: who sent it comes from the session; they read their own and nobody else's
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) \gset
select public.submit_feedback('idea', 'A weekly email summary would help', 5, '/', '0.29.0', 'pwa', null, null, null, false, ' A@X.Test ', 'bad code!') as f2 \gset
select pg_temp.ok((select user_id = :'A' and email = 'a@x.test' and tester is null from public.feedback where id = :'f2'), 'a signed-in tester''s feedback carries their account; the address is tidied and a bad invite code dropped');
select pg_temp.ok((select count(*) = 1 from public.feedback), 'a tester reads only their own feedback');
update public.feedback set status = 'fixed' where id = :'f2';
select pg_temp.ok((select status = 'new' from public.feedback where id = :'f2'), 'a tester cannot change the status of their own feedback');
select pg_temp.ok(pg_temp.refused($q$update public.feedback set message = 'changed' where true$q$), 'a tester cannot change the message');
select pg_temp.ok(pg_temp.refused($q$select * from public.tester_stats()$q$), 'a tester cannot see the tester numbers');
select pg_temp.ok(pg_temp.refused($q$select * from public.feedback_inbox()$q$), 'a tester cannot open the operator''s inbox');
select pg_temp.ok(pg_temp.refused($q$select admin_note from public.feedback$q$) and pg_temp.refused($q$select client_hash from public.feedback$q$) and pg_temp.refused($q$select * from public.feedback$q$), 'a tester cannot read the operator''s note or the network hash, even on their own note');
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false) \gset
select pg_temp.ok((select count(*) = 0 from public.feedback), 'another tester sees none of it');
-- limits: 5 in 10 minutes from one account
select public.submit_feedback('other', 'note ' || g) from generate_series(1, 5) g;
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('other', 'one too many')$q$), 'a sixth note within 10 minutes is refused');

-- the same network, without an account: limited by a hash of the address, never the address itself
set role anon; select set_config('request.jwt.claims', '{}', false) \gset
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false) \gset
select public.submit_feedback('praise', 'love it ' || g) from generate_series(1, 5) g;
select pg_temp.ok(pg_temp.refused($q$select public.submit_feedback('praise', 'still love it')$q$), 'a sixth note from one network within 10 minutes is refused');
select set_config('request.headers', '{"x-forwarded-for": "198.51.100.4"}', false) \gset
select public.submit_feedback('praise', 'from somewhere else') as f3 \gset
reset role;
select pg_temp.ok((select client_hash is not null and client_hash !~ '203|198' from public.feedback where id = :'f3'), 'another network can still send; only a hash of its address is kept');

-- the operator reads and triages everything, and sees the numbers per invite code
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'OP')::text, false) \gset
select pg_temp.ok((select public.is_app_admin()), 'the operator is recognised');
select pg_temp.ok((select count(*) = 13 from public.feedback) and (select count(*) = 13 from public.feedback_inbox()), 'the operator reads every piece of feedback');
update public.feedback set status = 'planned', admin_note = 'next release', issue_url = 'https://github.com/x/y/issues/1' where id = :'f2';
select pg_temp.ok((select status = 'planned' and admin_note = 'next release' from public.feedback_inbox() where id = :'f2'), 'the operator can triage, and reads the private note through the inbox');
select pg_temp.ok(pg_temp.refused($q$select client_hash from public.feedback$q$), 'nobody signed in reads the network hash, not even the operator');
select pg_temp.ok(pg_temp.refused($q$update public.feedback set message = 'edited' where true$q$), 'even the operator cannot rewrite what a tester said');
select pg_temp.ok((select signed_up = 2 and active_7d = 1 and feedback = 1 from public.tester_stats() where tester = 'church'), 'tester numbers per invite code: sign-ups, recent sign-ins, feedback');
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) \gset
select pg_temp.ok((select status = 'planned' from public.feedback where id = :'f2'), 'the tester sees what became of their feedback');
select pg_temp.ok(not public.is_app_admin(), 'a tester is not the operator');
reset role;

-- deleting the account keeps the feedback but drops who sent it and the reply address
delete from auth.users where id = :'A';
select pg_temp.ok((select user_id is null and email is null and message = 'A weekly email summary would help' from public.feedback where id = :'f2'), 'a deleted account''s feedback stays, without the account or the reply address');
