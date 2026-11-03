-- 0007 — every real transaction counted once.
-- A duplicate is never deleted: it points at the copy that is kept (duplicate_of) and the app leaves it out of every total.
-- dedupe_ok = the owner said "these are two different transactions" — the automatic merge never touches that row again.
-- The rules live in src/lib/dedupe.ts (app) and supabase/functions/sync-simplefin/dedupe.ts (bank sync; identical copy).
alter table public.transactions add column if not exists duplicate_of uuid references public.transactions(id) on delete set null;
alter table public.transactions add column if not exists dedupe_ok boolean not null default false;
alter table public.transactions drop constraint if exists transactions_not_self_duplicate;
alter table public.transactions add constraint transactions_not_self_duplicate check (duplicate_of is null or duplicate_of <> id);
create index if not exists transactions_duplicate_of_idx on public.transactions (duplicate_of) where duplicate_of is not null;

-- bank sync can now be asked to re-read history ("Load year-to-date history")
alter table public.sync_log drop constraint if exists sync_log_trigger_check;
alter table public.sync_log add constraint sync_log_trigger_check check (trigger in ('manual', 'daily', 'connect', 'backfill'));
