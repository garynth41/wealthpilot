-- 0.39.2 (migration 0026): one payment per due date. A due date is claimed before a payment is recorded; the claim is taken once, lapses
-- after two minutes, is refused for a due date already paid, and follows the same access rules as the row. Run by scripts/db-test.mjs.
\set ON_ERROR_STOP 1
\set QUIET 1
\set O '00000000-0000-4000-8000-0000000000c1'
\set V '00000000-0000-4000-8000-0000000000c2'
\set X '00000000-0000-4000-8000-0000000000c3'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
insert into auth.users (id, email, aud, role) values (:'O', 'o@c.test', 'authenticated', 'authenticated'), (:'V', 'v@c.test', 'authenticated', 'authenticated'), (:'X', 'x@c.test', 'authenticated', 'authenticated');

set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select public.create_household('Claim test') as h \gset
reset role;
insert into public.household_members (household_id, user_id, email, role) values (:'h', :'V', 'v@c.test', 'viewer');
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'X')::text, false) \gset
select public.create_household('Someone else') as h2 \gset

-- the owner has a bill with one due date on file
select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
insert into public.recurring (household_id, name, amount) values (:'h', 'Car loan', 250) returning id as r \gset
insert into public.bill_occurrences (household_id, recurring_id, due_date, amount, status) values (:'h', :'r', '2026-12-01', 250, 'scheduled') returning id as o \gset
select pg_temp.ok((select claimed_at is null from public.bill_occurrences where id = :'o'), 'a due date starts unclaimed');

select pg_temp.ok((select count(*) = 1 from public.claim_bill_occurrence(:'o')), 'the first save claims the due date');
select pg_temp.ok((select claimed_at is not null and status = 'scheduled' from public.bill_occurrences where id = :'o'), 'the claim is stamped, and the due date is not yet paid');
select pg_temp.ok((select count(*) = 0 from public.claim_bill_occurrence(:'o')), 'a second save a moment later is refused');

-- a save that was cut short: its claim lapses after two minutes
reset role; update public.bill_occurrences set claimed_at = now() - interval '3 minutes' where id = :'o';
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select pg_temp.ok((select count(*) = 1 from public.claim_bill_occurrence(:'o')), 'a claim older than two minutes can be taken again');

-- once paid, it cannot be claimed
update public.bill_occurrences set status = 'paid', paid_on = '2026-12-01', claimed_at = null where id = :'o';
select pg_temp.ok((select count(*) = 0 from public.claim_bill_occurrence(:'o')), 'a due date already paid is refused');

-- access follows the row: a viewer and another household get nothing, and change nothing
update public.bill_occurrences set status = 'due' where id = :'o';
select set_config('request.jwt.claims', json_build_object('sub', :'V')::text, false) \gset
select pg_temp.ok((select count(*) = 0 from public.claim_bill_occurrence(:'o')), 'a viewer cannot claim a due date');
select set_config('request.jwt.claims', json_build_object('sub', :'X')::text, false) \gset
select pg_temp.ok((select count(*) = 0 from public.claim_bill_occurrence(:'o')), 'another household cannot claim it');
reset role;
select pg_temp.ok((select claimed_at is null from public.bill_occurrences where id = :'o'), 'and neither attempt left a claim behind');
set role anon;
select pg_temp.ok((select not has_function_privilege('anon', 'public.claim_bill_occurrence(uuid)', 'execute')), 'someone not signed in may not call it at all');
reset role;

-- a hidden duplicate remembers whether its posting was taken off the balance; older rows say no
select pg_temp.ok((select column_default = 'false' and is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'unposted'), 'transactions.unposted is false unless a merge sets it');
