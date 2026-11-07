-- 0.25.1: deleting an account (forget_user, migration 0019), the membership guard and the alert-settings guard, as the app and the
-- delete-account function use them. Run by scripts/db-test.mjs on a fresh database; each check prints PASS or stops the run with FAIL.
\set ON_ERROR_STOP 1
\set QUIET 1
\set O '00000000-0000-4000-8000-00000000000a'
\set E '00000000-0000-4000-8000-00000000000b'
\set V '00000000-0000-4000-8000-00000000000c'
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
insert into auth.users (id, email, aud, role) values (:'O', 'owner@x.test', 'authenticated', 'authenticated'), (:'E', 'editor@x.test', 'authenticated', 'authenticated'), (:'V', 'viewer@x.test', 'authenticated', 'authenticated');
-- the owner: a household, an account, a transaction, invitations
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select public.create_household('Test home') as hh \gset
insert into public.accounts (household_id, name, kind, balance, include_in_cash, include_in_net_worth, status, sort_order) values (:'hh', 'Checking', 'checking', 100, true, true, 'Active', 1) returning id as acct \gset
insert into public.transactions (household_id, date, kind, amount, account_id, status, source, payee) values (:'hh', '2026-11-01', 'expense', 5, :'acct', 'cleared', 'manual', 'Coffee') returning id as txn \gset
insert into public.household_invites (household_id, email, role, read_only) values (:'hh', 'editor@x.test', 'editor', false), (:'hh', 'viewer@x.test', 'viewer', true);
-- the editor and viewer join
select set_config('request.jwt.claims', json_build_object('sub', :'E')::text, false) \gset
select public.accept_invites() as n \gset
select pg_temp.ok(:n = 1, 'the editor joins');
update public.accounts set balance = 150 where id = :'acct';
insert into public.transaction_comments (household_id, transaction_id, body, author_email) values (:'hh', :'txn', 'mine', 'editor@x.test');
insert into public.audit_events (household_id, account_id, kind, summary) values (:'hh', :'acct', 'correction', 'a correction by the editor');
select pg_temp.ok((select user_id from public.audit_events where summary = 'a correction by the editor') = :'E', 'the audit trail fills in who did it (not the app)');
select set_config('request.jwt.claims', json_build_object('sub', :'V')::text, false) \gset
select public.accept_invites() as n \gset
-- 5a: a viewer cannot make themselves an owner
do $$ begin update public.household_members set role = 'owner', read_only = false where user_id = '00000000-0000-4000-8000-00000000000c'; exception when others then raise notice 'refused: %', sqlerrm; end $$;
reset role;
select pg_temp.ok((select role::text from public.household_members where user_id = :'V') = 'viewer', 'a viewer cannot make themselves an owner');
-- alert settings (5d + the app's one-row write)
create function pg_temp.save_row(hh uuid, uid text, r jsonb) returns text language plpgsql as $$
declare s jsonb; begin
  select settings into s from public.households where id = hh;
  s := jsonb_set(coalesce(s, '{}'), '{notify}', coalesce(s -> 'notify', '{}') || jsonb_build_object('members', coalesce(s -> 'notify' -> 'members', '{}') || jsonb_build_object(uid, r)));
  update public.households set settings = s where id = hh; return 'saved';
exception when others then return 'refused: ' || sqlerrm; end $$;
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', :'E')::text, false) \gset
select pg_temp.ok(pg_temp.save_row(:'hh', :'E', '{"email": true}') = 'saved', 'an editor saves their own alert row');
select set_config('request.jwt.claims', json_build_object('sub', :'O')::text, false) \gset
select pg_temp.ok(pg_temp.save_row(:'hh', :'E', '{"email": true, "email_to": "elsewhere@x.test"}') = 'saved', 'an owner types an address for them');
update public.households set settings = jsonb_set(settings, '{notify,email_to}', '"editor@x.test"') where id = :'hh';
select set_config('request.jwt.claims', json_build_object('sub', :'E')::text, false) \gset
select pg_temp.ok(pg_temp.save_row(:'hh', :'E', '{"email": true, "email_to": "elsewhere@x.test", "digest": false}') = 'saved', 'the editor changes something else and keeps that address');
select pg_temp.ok(pg_temp.save_row(:'hh', :'E', '{"email": true, "email_to": "someone@else.test"}') like 'refused: alerts can only be sent to your own%', 'but cannot point their alerts at another address');
select pg_temp.ok(pg_temp.save_row(:'hh', :'E', '{"email": true, "email_to": "EDITOR@x.test"}') = 'saved', '…their own address is fine (any case)');
select pg_temp.ok(pg_temp.save_row(:'hh', :'O', '{"push": false}') like 'refused: you can change only your own%', 'nor change another member''s row');
do $$ begin update public.households set settings = jsonb_set(settings, '{notify,large}', '1') where id = (select household_id from public.household_members limit 1); raise exception 'FAIL: an editor changed a household alert switch'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS an editor cannot change the household alert switches (%)', sqlerrm; end $$;
reset role;
-- what account deletion must clean up
insert into public.reconciliations (household_id, account_id, statement_date, statement_balance, completed_by, completed_by_email) values (:'hh', :'acct', '2026-10-31', 150, :'E', 'editor@x.test');
insert into storage.objects (bucket_id, name, owner, owner_id) values ('attachments', :'hh' || '/receipt.png', :'E', :'E');
insert into public.activity_log (household_id, user_id, user_email, action, table_name, record_id, summary) values
  (:'hh', :'O', 'owner@x.test', 'invite', 'household_invites', 'editor@x.test', 'editor@x.test · editor · emailed'),
  (:'hh', :'O', 'owner@x.test', 'invite', 'household_members', :'E', 'editor@x.test · editor (temporary password issued)'),
  (:'hh', :'O', 'owner@x.test', 'invite', 'household_invites', 'viewer@x.test', 'viewer@x.test · viewer read-only');
insert into public.notifications (household_id, kind, dedupe_key, title, channel, status, detail) values (:'hh', 'bill_due', 'k1', 'Rent', 'email', 'failed', 'Resend 422: bad address editor@x.test');
insert into public.deleted_households (id, name, requested_by) values (gen_random_uuid(), 'Old', :'E');
insert into public.app_errors (user_id, source, message) values (:'E', 'browser', 'x');
insert into public.household_invites (household_id, email, role) values (:'hh', 'EDITOR@x.test', 'viewer') on conflict do nothing;
-- the delete-account function: forget_user as the service role, then the sign-in goes
set role service_role; select set_config('request.jwt.claims', '', false) \gset
select public.forget_user(:'E') as res \gset
\echo forget_user: :res
reset role;
delete from auth.users where id = :'E';
select pg_temp.ok(not exists (select 1 from auth.users where id = :'E'), 'the sign-in can be deleted afterwards');
select pg_temp.ok((select count(*) from public.audit_events where user_email = 'a former member' and user_id is null) >= 2, 'the audit trail keeps the rows, as "a former member"');
select pg_temp.ok((select author_email from public.transaction_comments where transaction_id = :'txn') = 'a former member' and (select created_by from public.transaction_comments where transaction_id = :'txn') is null, 'their comment stays, unsigned');
select pg_temp.ok((select completed_by_email from public.reconciliations where account_id = :'acct') = 'a former member', 'the reconciliation they did names "a former member"');
select pg_temp.ok((select owner is null and owner_id is null from storage.objects where name = :'hh' || '/receipt.png'), 'the receipt they attached stays, with no owner');
select pg_temp.ok(not exists (select 1 from public.activity_log where summary ilike '%editor@x.test%' or record_id ilike '%editor@x.test%' or record_id = :'E' or user_email ilike 'editor@x.test'), 'no log line names them or their address');
select pg_temp.ok((select count(*) from public.activity_log where action = 'invite' and summary like 'a former member · editor%') = 2, '…the invitation lines read "a former member · editor…"');
select pg_temp.ok(exists (select 1 from public.activity_log where summary = 'viewer@x.test · viewer read-only'), '…and other people''s lines are untouched');
select pg_temp.ok((select detail from public.notifications where dedupe_key = 'k1') is null, 'a sent-alert note that named their address is cleared');
select pg_temp.ok(not ((select settings from public.households where id = :'hh') -> 'notify' -> 'members') ? :'E', 'their alert row is gone');
select pg_temp.ok(((select settings from public.households where id = :'hh') -> 'notify' ->> 'email_to') is null, 'the household alert address that was theirs is cleared');
select pg_temp.ok(not exists (select 1 from public.household_invites where lower(email) = 'editor@x.test'), 'invitations to their address are gone');
select pg_temp.ok(not exists (select 1 from public.deleted_households where requested_by = :'E'), 'no deleted-household record points at them');
select pg_temp.ok(not exists (select 1 from public.app_errors where user_id = :'E'), 'error reports lose the link to them');
select pg_temp.ok(not exists (select 1 from public.household_members where user_id = :'E'), 'they are no longer a member');
select pg_temp.ok((select user_id from public.household_members where user_id = :'V') = :'V', 'the viewer is still there');
-- an account with history can be deleted (5f)
delete from public.accounts where id = :'acct';
select pg_temp.ok(not exists (select 1 from public.accounts where id = :'acct'), 'an account with balance history and audit rows can be deleted');
