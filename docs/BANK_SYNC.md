# Bank sync evaluation (roadmap 7h) — November 2026

Goal: pull balances and transactions automatically instead of statement files / email, for one household, without running our own server.

| Option | Cost (as published) | What you get | Fit for WealthPilot |
|---|---|---|---|
| **SimpleFIN Bridge** | **$1.50/mo or $15/yr**, paid by the account holder | balances + transactions for the banks you link; refreshed **once a day**; first sync up to **90 days** of history | **Best fit.** One setup token → one access URL; a single Supabase edge function can fetch `/accounts` daily and upsert transactions with `external_id = sfin:<id>` — the existing import de-duplication and payee rules apply unchanged. Used by Actual Budget the same way. |
| **Plaid** | Trial plan (US/Canada teams created on/after Apr 15 2026): **free, 10 production Items**; then pay-as-you-go (no minimum, prices shown only after applying for Production). Transactions is a monthly subscription per Item; Balance is per request | broadest bank coverage, near-real-time transactions, investments and liabilities products | Works, but needs Plaid Link in the page plus an edge function for token exchange and webhooks, and production approval. Good fallback for a bank SimpleFIN cannot reach. |
| **Teller** | not verified — check teller.io before choosing | direct bank connections, mTLS client certificate | Certificate handling needs a server-side function; viable but more setup than SimpleFIN. |
| **MX** | enterprise contracts | aggregation platform | Not practical for a personal app. |

## Recommendation
Start with **SimpleFIN Bridge**. Build once you have subscribed and linked your banks:
1. Migration: `sync_connections` (provider, status, last_sync, last_error) + store the access URL as a Supabase secret (never in the browser or the database).
2. Edge function `sync-simplefin`: fetch accounts → match by institution + last 4 → set balance / as-of → insert new transactions through the same de-duplication as statement import → write a sync log row.
3. `pg_cron` schedule once a day; **Sync now** button on Bank Connections calls the function; sync history and failures shown on the page and in Security → Observability.
4. Add Plaid later only if a needed bank is missing.

Sources: SimpleFIN pricing and limits via Actual Budget's SimpleFIN docs (actualbudget.org/docs/advanced/bank-sync/simplefin); Plaid billing and Trial plan (plaid.com/docs/account/billing).


## Status (v0.12.0) — live: connected, 5 accounts matched, daily sync on
Implemented: `supabase/migrations/0004_bank_sync.sql` (tables `sync_connections`, `sync_secrets` — no browser access —, `sync_log`), edge function `sync-simplefin` (actions `connect`, `sync`, `disconnect`, `sync_all`), pure engine `src/lib/simplefin.ts` (the function carries an identical copy, enforced by a test), and the card on **Bank Connections**.

To start: subscribe at bridge.simplefin.org, link your banks, create a *New Connection* setup token, paste it into Bank Connections → Connect, match the accounts, Save matching, Sync now.

### Daily automatic sync — ON since 0.12.0 (migration `0005_daily_bank_sync.sql`)
- `pg_cron` job **wealthpilot-daily-sync** runs at **10:17 UTC** (5:17 am Eastern in winter) and POSTs `{"action":"sync_all"}` to `sync-simplefin` with `pg_net`.
- The caller secret is generated inside the database and kept in Vault as `wealthpilot_cron_secret`; the job reads it at run time and the function checks it with `public.cron_secret_ok()` (service role only). Nobody types or sees it. A `CRON_SECRET` function secret is still accepted if you ever set one up by hand.
- Each run is in **Bank Connections → Sync history** (trigger `daily`). To stop it: `select cron.unschedule('wealthpilot-daily-sync');` To change the time: run `cron.schedule` again with the same name.
- Verified on 2026-11-03: wrong secret → 401; job call → 5 accounts synced, 0 new, 12 already present.

### Date range per request
SimpleFIN recommends at most **45 days** per request ("Requested date range exceeds recommended range of 45 days. In the future, this may be capped."). Since 0.12.0 every request covers at most 44 days: the first sync reads 88 days in two requests; later syncs re-read from 5 days before the last sync (one request). See `syncWindows` / `mergeResponses` in `src/lib/simplefin.ts`.
SimpleFIN refreshes banks about once a day and allows roughly 24 requests a day, so one daily run plus the odd **Sync now** is well inside the limit.

### Limits worth knowing
SimpleFIN reports a card balance as a negative number; WealthPilot stores the positive amount owed (a positive card balance is treated as 0 owed). Pending items are skipped until they post. Categories are not assigned during sync — use **Auto-categorize** on Transactions.
