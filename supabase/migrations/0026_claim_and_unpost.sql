-- 0026 — one payment per due date from any device, and a merged copy that gives its money back (0.39.2; Gary, Nov 24).
--
-- bill_occurrences.claimed_at is set while a payment for that due date is being recorded. public.claim_bill_occurrence takes the claim in
-- one statement, on the database's clock: it succeeds only when the row is not paid and nobody holds a claim newer than two minutes. Two
-- devices saving in the same second therefore cannot both go on to write a transaction — which the one-row-per-bill-and-due-date rule
-- already ensured for a due date with no row, and nothing ensured for a due date that had one. A claim left behind by a save that was cut
-- short lapses by itself after two minutes. The function runs with the caller's own rights, so row-level security and the member guards
-- decide who may claim, exactly as for any other change to the row.
--
-- transactions.unposted is true on a hidden duplicate whose posting was taken back off the stored balance when it was merged, so that
-- restoring it puts the posting back. A copy merged before this (false) changes no balance when restored, as before.
--
-- Safe to run more than once.
alter table public.bill_occurrences add column if not exists claimed_at timestamptz;
alter table public.transactions add column if not exists unposted boolean not null default false;

create or replace function public.claim_bill_occurrence(p_id uuid) returns setof public.bill_occurrences
language sql security invoker set search_path = public as $$
  update public.bill_occurrences set claimed_at = now()
   where id = p_id and status <> 'paid' and (claimed_at is null or claimed_at < now() - interval '2 minutes')
  returning *;
$$;
revoke all on function public.claim_bill_occurrence(uuid) from public, anon;
grant execute on function public.claim_bill_occurrence(uuid) to authenticated;
