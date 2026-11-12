-- 0020 (0.28.0): leave an account out of the household's figures.
-- Idempotent: safe to re-run.
--
-- An account a household can see at the bank but does not want counted — a child's checking account linked to a parent's sign-in, an
-- account held for someone else — is switched off on the Accounts page. The account, its balance history and every transaction on it stay
-- in the database, and the bank sync keeps it current, so switching it back on restores everything. While it is off the app shows and
-- counts none of it: not in cash, net worth, the budget, spending, the forecast or the reports. Money moved between it and an account that
-- is counted reads as money out or money in on the counted account (see src/lib/leftOut.ts).

alter table public.accounts add column if not exists excluded boolean not null default false;
comment on column public.accounts.excluded is 'Left out of the household''s figures: kept and still synced, but counted and listed nowhere until switched back on (0.28.0).';

-- down: (the reverse — run only to roll back. Accounts that were left out are counted again; no transaction, balance or account is lost.
--        Paired transfers that were taken apart when an account was left out are paired again by the duplicate engine on its next run.)
--   alter table public.accounts drop column if exists excluded;
