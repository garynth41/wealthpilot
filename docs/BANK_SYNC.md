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
