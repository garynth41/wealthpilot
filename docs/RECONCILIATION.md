# Cash & Account Operations — checkbook reconciliation and verified balances (0.14.0)

Spec: "Cash & Account Operations Enhancement" (Nov 2026). Rules: `src/lib/reconcile.ts` (identical copy in the bank-sync function),
built on the duplicate engine `src/lib/dedupe.ts`. Schema: `supabase/migrations/0008_checkbook_reconciliation.sql`.

## Model (how the spec's three records map onto WealthPilot)
| Spec | WealthPilot |
|---|---|
| Check (`checkNumber`, `status`, `clearedDate`…) | a `transactions` row recorded by the household: `check_number`, `status` (`pending` = outstanding, `cleared`, `void`), `cleared_on`, `reconciliation_id` |
| Bank Transaction (`referenceNumber`, `source`…) | a `transactions` row from the bank feed or a statement file: `external_id` (`sfin:…`, `ofx:…`, `csv:…`), `source = import` |
| Reconciliation Record | `reconciliations` (statement date & balance, opening, cleared deposits/payments, outstanding checks, deposits in transit, reconciled balance, variance, adjustment + reason, status, who/when) — insert-only |
| Audit trail | `audit_events` — insert-only, a trigger rejects update/delete; `balance_change` rows are written by a trigger on `accounts` |

**Verified balance** = `accounts.bank_balance` (last figure from the feed, a statement file or a completed reconciliation)
+ deposits in transit − outstanding checks/payments. `balanceOf(a, d)` in `src/lib/accounts.ts` returns it, and cash on hand, net worth,
forecast, planning, goals allocation, retirement/portfolio and reports all go through it, so **verified balances take precedence over the
book balance** wherever one exists (spec Test 5). `accounts.balance` stays the book figure; its difference from the verified balance is
the **variance** shown on the dashboard.

## Matching (register entry ↔ bank row)
`matchScore`: amount must agree (50) · check number clinches it (30) or rules the pair out · date closeness (≤ 15) · payee words (≤ 5);
a pair the duplicate engine calls *certain* scores 95, *likely* 85. **Automatic** = score ≥ 85 and no other plausible candidate
(≥ 60) for the same entry. A match merges the entry into its bank row (`duplicate_of`), carrying over the check number, category and memo,
and is undoable in Transactions → Duplicates. Matching by hand below 85, "Not a match", voiding and marking cleared are all audit events.

## Statement reconciliation
opening (previous statement balance, or derived on the first run) + cleared deposits − cleared payments = cleared balance; it must equal the
statement's ending balance. Outstanding checks and deposits in transit explain the difference between the statement and the book.
`complete_reconciliation(jsonb)` does everything in one transaction: writes the record, ticks the items (`reconciliation_id`, `cleared_on`,
pending → cleared), sets the account's bank and book balances, and writes `reconciliation` (+ `override` when an adjustment with a reason
was accepted) audit rows. Completed reconciliations cannot be edited (no update policy).

## Sync, failures, timing
Bank sync (`sync-simplefin`) retries SimpleFIN up to three times on network errors / 5xx, logs every run (`sync_log` + `sync` /
`sync_failure` audit events), and on failure leaves every balance untouched; the Dashboard's *Needs attention* shows the failure.
After a successful sync each mapped account gets `bank_balance` and `balance = bank + outstanding`. Pending card/ACH items are not
imported until they post (SimpleFIN marks them pending), so they never double up with the register.

## Acceptance tests (src/lib/reconcile.test.ts)
1 auto-match → reconciled · 2 outstanding check stays out and lowers the reconciled balance · 3 duplicates flagged and excluded ·
4 disconnected institution: error logged, balances preserved, alert · 5 verified balances used by cash/net-worth/forecast ·
6 override stored with timestamp, user, reason and audit record.
