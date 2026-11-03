# One row per real transaction — how WealthPilot prevents duplicates (since 0.13.0)

Transactions arrive four ways: the **bank feed** (SimpleFIN), **statement files** (CSV / OFX / QFX), **email capture** and **typed by hand**.
The same payment can arrive more than once — an email "payment received" plus the bank line two days later, a statement file that overlaps
the bank feed, or two emails about one payment. The rules below make sure each real transaction is counted once.

## Layers
1. **Bank ids** — every bank-feed and statement-file row carries an `external_id`; the database has a unique index on
   `(household_id, external_id)`, and both the sync and the importer skip ids already on file (including rows merged as duplicates).
2. **Duplicate engine** — `src/lib/dedupe.ts` (the bank-sync function carries a byte-identical copy, enforced by a unit test).
   It runs in the app after every load and every new transaction (manual, email, statement import), and in the bank-sync function
   after every sync, the daily 5:17 am run and a history load.
3. **Review** — Transactions → **Duplicates** lists look-alikes that need a decision, and every merged row with **Undo**.

## Matching rules
Two rows are compared only with the same direction and the **same amount to the cent**, at most **4 days** apart.

| Confidence | When | Action |
|---|---|---|
| certain | same day, same (or blank) payee, same or missing account, not two separate bank-feed rows | merged automatically |
| likely | ≤ 4 days apart, payee words ≥ 50 % alike after removing bank boilerplate (DES:, ID:, INDN:, card numbers…), same or missing account | merged automatically when unambiguous |
| possible | two bank-feed (or two statement-file) rows with different ids on one day; a match in a different account; an email matching two identical bank charges | **review only** — these are often real |

**Which copy is kept:** bank feed → statement file → email → manual; then the categorised one; then the oldest.
The kept copy inherits what it lacks from the duplicates (category, bill, goal, pay schedule, email link, account).

## Nothing is deleted
A duplicate gets `transactions.duplicate_of = <kept id>` and is left out of every total, report and forecast (the store keeps it in
`data.duplicates`). **Undo** clears it and sets `dedupe_ok = true`, so it is never merged automatically again. Deleting the kept copy
brings the duplicate back (`on delete set null`).

## Year-to-date history
SimpleFIN keeps about **90 days** of history per account. **Bank Connections → Load year-to-date history** re-reads everything it still
has back to January 1 (44-day requests). **Year-to-date coverage** shows, per account and month, what is on file and which statement
range to import for the rest. Reports → **Annual / year to date** warns when the period starts before the first transaction on file.
