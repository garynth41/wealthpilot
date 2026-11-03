# Handoff — WealthPilot (formerly PocketLedger; start here in the new chat)

**Owner:** Gary Thomas (garynthomas@gmail.com). **Origin:** spun off from CareerShift's finance modules (Monthly Budget & Finances, Credit Cards & Payments, Obligations & Hardship, Cash Runway, Income/Bills & Taxes, Bills & Money Tracker + the v1.24 email money-capture engine). **Goal:** a robust, modern, comprehensive budgeting / savings / financial-planning app in the spirit of Copilot (track & budget money), for income from all sources on any pay cadence, fixed / variable / irregular expenses, bills, debts, goals and forecasting.

## State as of this handoff (v0.15.0)

- **Working, tested app** — see README for the feature list. 154 unit tests, 128 Playwright smoke checks (desktop + phone), 7 DB-mode checks all pass. The product roadmap (the finance-platform spec mapped onto the app) is `docs/ROADMAP.md`.
- **Supabase project:** `pocketledger` — ref `dshswfcpovdpxcidolqb`, URL `https://dshswfcpovdpxcidolqb.supabase.co`, publishable key in `.env.example`. Schema applied as migrations `pocketledger_init`, `pocketledger_function_grants`, `pocketledger_helper_grants`, `pocketledger_fix_touch_and_log` (the combined, current schema is `supabase/migrations/0001_init.sql`). Email confirmation is ON (default) — new users must click the confirmation email before signing in.
- **A throw-away e2e user exists** (`pl-e2e-1793508196267@gmail.com`, household "E2E household") — safe to delete from Supabase → Authentication.
- **CareerShift's Supabase project (`jowuuzppfhqgusxqoqdk`) was PAUSED** to free the second free-tier slot. CareerShift is offline until it is restored (Supabase dashboard → project → Restore). Free tier allows 2 active projects.
- **Live:** https://garynth41.github.io/wealthpilot/ — repo `github.com/garynth41/wealthpilot` (`main` source, `gh-pages` built). Release = `git push` + `npm run deploy`. `app_meta` holds `latest_version` and `site_url`.
- Gary's account (garynthomas@gmail.com) and household "Thomas" exist. Gmail and Outlook client IDs are saved (Settings → General → Email capture); SimpleFIN is connected with 5 accounts and a daily pg_cron sync (docs/BANK_SYNC.md). Migrations 0005–0008 are applied (0008 = reconciliations, audit_events, bank_balance/check_number columns, complete_reconciliation; applied 2026-11-03). The app and the sync function tolerate a missing 0008 on a fresh project (audit/reconciliations show empty, balances fall back to the book figure). Verified balances: `balanceOf()` in lib/accounts.ts — never read `a.balance` directly in an engine. See docs/RECONCILIATION.md. Duplicates: see docs/DUPLICATES.md — never delete a transaction to de-duplicate; set `duplicate_of`. The bank-sync function also has `backfill`, `dedupe` and cron-secret `maintenance_all` (`dry_run` previews). Leaked-password protection needs Supabase Pro.

## Architecture in one minute

`pages/*` render from the zustand store (`app/store.ts`) which holds the whole household in memory (`Data`) and writes through a `Repo` (`SupabaseRepo` or `MemoryRepo` for the offline demo/tests). Realtime changes trigger a debounced `refresh()`. All math lives in pure functions under `lib/` (unit-tested) — pages only format. Email capture: `lib/email/extract.ts` (email → fact, never invents numbers) → `propose.ts` (match to accounts / recurring / categories, describe changes) → `apply.ts` (writes). Charts go through `components/Chart.tsx` (readable-layout rules from CareerShift v1.26).

## Data model (19 tables)

households, household_members, household_invites · accounts (assets and liabilities in one table, `kind` decides) · statements · categories (group, priority Essential/Important/Discretionary, Fixed/Variable/Irregular, default_budget, rollover) · pay_schedules (frequency + anchor date) · budget_periods + budget_lines (plan only; actuals derived) · transactions (positive amount; kind expense/income/transfer; transfer to a liability = debt payment) · recurring + bill_occurrences · goals + goal_contributions · planned_items · net_worth_snapshots · hardship_outreach · holdings (0.6.0) · email_items + email_ledger · activity_log, ref_counters, app_meta.

## Conventions to keep

- Edit engines in `src/lib`, not in pages. Add a unit test in `src/lib/engines.test.ts` or `src/lib/email/email.test.ts` for every rule change.
- Run `npm run check` before delivering; keep `README.md` current; bump `APP_VERSION` in `src/app/config.ts` (and `app_meta.latest_version` in the DB) on each release.
- Never store email bodies or more than the last 4 digits of an account. Never invent an amount or date that is not in the email.
- Schema changes: add a new file under `supabase/migrations/` AND apply it with the Supabase MCP (`apply_migration`); then run `get_advisors` (security).

## Roadmap

See `docs/ROADMAP.md` (supersedes the list below; items 1 and parts of 2 shipped in 0.3.0).

### Original ideas

1. CSV/OFX import of bank and card statements (map columns → transactions, dedupe by `external_id`).
2. Rules engine for auto-categorizing by payee (extend the remembered-payee rules beyond email).
3. Split transactions and tags UI; attachments (receipt photos) via Supabase Storage.
4. Notifications: daily digest of bills due / low balance via a Supabase edge function + email.
5. Sinking-fund math (yearly budgets spread per period) — the `budget_cadence` column exists, UI not yet.
6. Multi-currency; per-member spending views; shared vs personal accounts.
7. Bank sync via Plaid/Teller (would replace email capture for balances).
8. PWA manifest + offline cache; native app wrappers.
9. Migration helper to import CareerShift's finance data (expenses/debts/hardship/cash) into this schema.

## Kickoff prompt for the new chat

> I'm continuing work on **WealthPilot**, my personal budgeting/savings/financial-planning app. Attached is the project zip (Vite + React + TypeScript + Supabase; project ref dshswfcpovdpxcidolqb). Read HANDOFF.md and README.md first. Keep the conventions: engines in src/lib with unit tests, pages only render, run `npm run check` before delivering, never invent numbers from email. First task: …
