-- 0.25.1: account numbers kept before 0.25.1 (migration 0019, section 6) — mask_digits follows the app's rule (lib/simplefin.ts maskDigits), and
-- the scrub changes only what the bank feed and email capture brought in. Run by scripts/db-test.mjs on a fresh database.
\set ON_ERROR_STOP 1
\set QUIET 1
create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FAIL: %', m; end if; raise notice 'PASS %', m; end $$;
select pg_temp.ok(public.mask_digits(x) = y, format('mask_digits(%L) = %L', x, y)) from (values
  ('ACH ACCT 4400123456', 'ACH ACCT ••3456'), ('12345 and 123456', '••2345 and ••3456'), ('123456 and 12345', '••3456 and ••2345'), ('1234', '1234'),
  ('1 2 3 4 5', '••2345'), ('555-123-4567 call', '••4567 call'), ('9999 9999 9999 9999', '••9999'), ('••3456', '••3456'), ('', ''),
  ('A 12345 B 12345 C 12345', 'A ••2345 B ••2345 C ••2345'), ('1234 5678 9012 3456 exp 12/27', '••3456 exp 12/27')) as t(x, y);
select pg_temp.ok(public.mask_digits(null) is null, 'mask_digits(null) is null');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000aa', 'o@x.test');
insert into public.households (id, name, created_by) values ('10000000-0000-4000-8000-000000000001', 'H', '00000000-0000-4000-8000-0000000000aa');
insert into public.accounts (id, household_id, name, kind, balance, include_in_cash, include_in_net_worth, status, sort_order, notes) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'CHECKING 4400123456', 'checking', 1, true, true, 'Active', 1, null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Savings 2026-2027 plan', 'savings', 1, true, true, 'Active', 2, null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'VISA 4111 1111 1111 1111', 'credit_card', 1, false, true, 'Active', 3, 'Created by the Mint import — type today''s balance');
insert into public.sync_connections (household_id, account_map, discovered) values ('10000000-0000-4000-8000-000000000001',
  '{"ACT-1": "20000000-0000-4000-8000-000000000001"}', '[{"id": "ACT-1", "name": "CHECKING 4400123456", "balance": 12345.67}, {"id": "ACT-2", "name": "Card", "balance": 5}]');
insert into public.transactions (id, household_id, date, kind, amount, account_id, status, source, external_id, payee) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-11-01', 'expense', 52.10, '20000000-0000-4000-8000-000000000001', 'cleared', 'import', 'sfin:ACT-1:t1', 'ACH ACCT 4400123456 12345 and 123456'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-11-01', 'expense', 12345.00, '20000000-0000-4000-8000-000000000001', 'cleared', 'import', 'sfin:ACT-1:t2', 'STORE 1234'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '2026-11-01', 'expense', 7, '20000000-0000-4000-8000-000000000001', 'cleared', 'manual', null, 'Check 10045'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '2026-11-01', 'expense', 7, '20000000-0000-4000-8000-000000000001', 'cleared', 'import', 'csv:h1', 'My file 99999');
insert into public.email_items (household_id, kind, payee) values ('10000000-0000-4000-8000-000000000001', 'bill', 'Card ending 4111111111111111');
-- the log lines this test checks (the rows above wrote their own, which are dropped so each check reads one line)
truncate public.activity_log;
insert into public.activity_log (household_id, action, table_name, record_id, summary) values
  ('10000000-0000-4000-8000-000000000001', 'insert', 'transactions', '30000000-0000-4000-8000-000000000001', 'ACH ACCT 4400123456 12345 and 123456 52.10'),
  ('10000000-0000-4000-8000-000000000001', 'insert', 'transactions', '30000000-0000-4000-8000-000000000002', 'STORE 1234 12345.00'),
  ('10000000-0000-4000-8000-000000000001', 'insert', 'transactions', '30000000-0000-4000-8000-000000000003', 'Check 10045 7'),
  ('10000000-0000-4000-8000-000000000001', 'insert', 'accounts', '20000000-0000-4000-8000-000000000001', 'CHECKING 4400123456'),
  ('10000000-0000-4000-8000-000000000001', 'insert', 'accounts', '20000000-0000-4000-8000-000000000002', 'Savings 2026-2027 plan');
select public.mask_stored_account_numbers() as masked \gset
select pg_temp.ok(:'masked'::jsonb = '{"transactions": 1, "email_items": 1, "accounts": 2, "account_log_lines": 1, "bank_account_lists": 1}', 'the scrub reports what it changed: ' || :'masked');
select pg_temp.ok((select payee from public.transactions where id = '30000000-0000-4000-8000-000000000001') = 'ACH ACCT ••2345 and ••3456', 'bank-feed payees keep only the last four of each number');
select pg_temp.ok((select payee from public.transactions where id = '30000000-0000-4000-8000-000000000002') = 'STORE 1234', '…a short number stays');
select pg_temp.ok((select payee from public.transactions where id = '30000000-0000-4000-8000-000000000003') = 'Check 10045', 'what a person typed is not touched');
select pg_temp.ok((select payee from public.transactions where id = '30000000-0000-4000-8000-000000000004') = 'My file 99999', '…nor what they imported from their own file');
select pg_temp.ok((select summary from public.activity_log where record_id = '30000000-0000-4000-8000-000000000001') = 'ACH ACCT ••2345 and ••3456 52.10', 'the log line is masked, its amount kept');
select pg_temp.ok((select summary from public.activity_log where record_id = '30000000-0000-4000-8000-000000000002') = 'STORE 1234 12345.00', '…an amount of 12345.00 is not taken for an account number');
select pg_temp.ok((select summary from public.activity_log where record_id = '30000000-0000-4000-8000-000000000003') = 'Check 10045 7', '…and a typed row''s log line stays');
select pg_temp.ok((select name from public.accounts where id = '20000000-0000-4000-8000-000000000001') = 'CHECKING ••3456', 'an account linked to the bank feed is masked');
select pg_temp.ok((select name from public.accounts where id = '20000000-0000-4000-8000-000000000003') = 'VISA ••1111', '…and one another app''s import made');
select pg_temp.ok((select name from public.accounts where id = '20000000-0000-4000-8000-000000000002') = 'Savings 2026-2027 plan', '…but not one a person named');
select pg_temp.ok((select summary from public.activity_log where record_id = '20000000-0000-4000-8000-000000000001') = 'CHECKING ••3456', 'the linked account''s log line is masked');
select pg_temp.ok((select summary from public.activity_log where record_id = '20000000-0000-4000-8000-000000000002') = 'Savings 2026-2027 plan', '…the named one''s is not');
select pg_temp.ok((select payee from public.email_items limit 1) = 'Card ending ••1111', 'email items are masked');
select pg_temp.ok((select discovered from public.sync_connections) = '[{"id": "ACT-1", "name": "CHECKING ••3456", "balance": 12345.67}, {"id": "ACT-2", "name": "Card", "balance": 5}]'::jsonb, 'the bank''s account list is masked, in order, balances kept');
-- running it again changes nothing
create temp table snap as select (select jsonb_agg(t order by id) from public.transactions t) a, (select jsonb_agg(l order by id) from public.activity_log l) b, (select jsonb_agg(x order by id) from public.accounts x) c;
select public.mask_stored_account_numbers() as masked2 \gset
select pg_temp.ok((select (select jsonb_agg(t order by id) from public.transactions t) = a and (select jsonb_agg(l order by id) from public.activity_log l) = b and (select jsonb_agg(x order by id) from public.accounts x) = c from snap), 'a second run changes nothing');
select pg_temp.ok(:'masked2'::jsonb = '{"transactions": 0, "email_items": 0, "accounts": 0, "account_log_lines": 0, "bank_account_lists": 0}', '…and says so');
