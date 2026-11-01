# WealthPilot

Personal budgeting, savings and financial-planning app — a stand-alone spin-off of the money modules of CareerShift, rebuilt as a modern Vite + React + TypeScript single-page app on its own Supabase project. (Formerly "PocketLedger"; the Supabase project keeps that name in the dashboard.)

## Brand

- **Mark:** a rising trend line ending in a gold "pilot" arrowhead — `src/components/Logo.tsx` (in-app, on the teal tile) and `public/favicon.svg` (same glyph on a navy tile). Change the glyph in both places together.
- **Theme tokens** (`src/styles.css` `:root`, light and dark): navy ink/rail `#0b1a33`, brand accent teal `--accent #0f766e` (dark: `#2dd4bf`), gold `--gold #f2b632` for the logo and highlights only. Status colours (`--good` green, `--warn`, `--crit`, …) are deliberately separate from the brand accent.
- Rename again: `VITE_APP_NAME` in `.env`/`.env.example`, the fallback in `src/app/config.ts` (and its `LS` storage-key prefix), `<title>`/`theme-color` in `index.html`, `name` in `package.json`, `setup.ps1`, this README and `HANDOFF.md`.

## What it does

| Area | Page | Highlights |
|---|---|---|
| Overview | **Dashboard** | cash on hand, left to spend this period, due in 14 days, next paycheck, runway, debt, net worth, savings rate; "Needs attention" list; 30-day cash chart; coming up; budget by group; goals; accounts |
| | **Cash Flow Forecast** | day-by-day cash calendar (paychecks, bills, subscriptions, card/loan payments, planned items, everyday run-rate), 24-month projection, what-if sliders (cut %, extra income, income stops on…, essentials only), runway gauge, planned one-off items |
| Money in & out | **Budget** | budget by **calendar month, pay period, every 2 weeks, twice a month or week**; planned vs spent per category and group; rollover categories; pace; savings rate; insights; chart; all periods |
| | **Transactions** | ledger with inline editing, filters, add form (expense / income / transfer); every transaction moves account balances; actuals are always derived from here |
| | **Bills & Subscriptions** | recurring items (bills, subscriptions, debt payments, savings transfers, recurring income) with schedules, autopay, reminders; upcoming/overdue list; Mark paid / Skip; cash needed by day |
| | **Income & Pay Periods** | pay schedules (weekly, every 2 weeks, twice a month, monthly, …) from one known pay date; paychecks ahead; expected vs received; income by month |
| Accounts & debt | **Accounts** | checking, savings, cash, investment, retirement, cards, loans; statements history; Record payment / New statement; net-worth snapshots |
| | **Debt Payoff** | avalanche vs snowball, minimums-only vs planned vs extra, utilization, interest cost, payoff projection and dates |
| | **Savings Goals** | emergency fund, sinking funds, purchases, debt-payoff goals; progress, need-per-month, on-track, contributions |
| Planning | **Trends & Analysis** | week / month / year income, spending, debt and net; spending by category and group; day-of-week; net worth |
| | **Hardship & Creditor Outreach** | obligations, status pipeline, relief in effect (feeds the runway), call scripts, "Suggest from my accounts & bills" |
| | **Email Money Capture** | reads Gmail / Outlook (read-only) for bills, statements, payments, deposits, past-due, declined and bank alerts; you review, the app files them (transactions, statements, accounts, recurring items); remembered payees; "Paste an email" tester |
| Administration | **Settings** | household, budget cadence, planning thresholds, categories (priority, fixed/variable, default budget, rollover), members & invites, JSON backup/restore, CSV export, activity log |

Design principles carried over from CareerShift: single household data model loaded into memory with realtime refresh, readable charts (large type, wrapped labels, dynamic height, ⤢ full-size view), row numbers, inline editing, light/dark theme, phone layout with tab bar and card tables, never fabricate numbers from email, store only last-4 of any account.

## Stack

- **Front end:** Vite 8, React 19, TypeScript 7, react-router (hash routing → works on GitHub Pages), zustand store, Plotly (basic bundle) for charts, IBM Plex fonts.
- **Back end:** Supabase (Postgres + Auth + Realtime). Project **pocketledger** (`dshswfcpovdpxcidolqb`, us-east-1). Schema in `supabase/migrations/0001_init.sql` — 18 tables, RLS on every one through `is_member / can_edit / is_owner`, audit trigger (`activity_log`), server-assigned human refs (`A-001`, `T-042`, …), RPCs `create_household`, `accept_invites`, `start_period`.
- **Offline demo:** the same app with an in-memory/localStorage repo and realistic sample data — used by the test suites and as a try-before-sign-up mode.

## Run it

```bash
cp .env.example .env        # already points at the pocketledger Supabase project
npm install
npm run dev                 # http://localhost:5173
```

Scripts: `npm run typecheck` · `npm test` (32 unit tests: engines + email parser) · `npm run build` · `npm run e2e` (Playwright smoke through every page in demo mode, desktop + phone; needs `npx playwright install chromium` once, or set `PW_CHROMIUM` to an installed Chrome/Edge executable) · `npm run e2e:db` (same against Supabase with `E2E_EMAIL` / `E2E_PW`) · `npm run check` (all of the above) · `npm run deploy` (build and push `dist/` to the `gh-pages` branch).

**Windows:** `setup.ps1` (next to this README) does the whole first-time setup — checks Node ≥ 20, extracts the zip, creates `.env`, installs packages and the Playwright browser, runs `npm run check`, then starts `npm run dev` in its own window and opens the app. `powershell -ExecutionPolicy Bypass -File setup.ps1 -Zip "<path to zip>"`. Keep the project **outside OneDrive** (the script defaults to `C:\Users\<you>\CascadeProjects\wealthpilot`): `node_modules` has tens of thousands of files and OneDrive sync fights with `npm install`.

## Deploy (GitHub Pages)

1. Create a repo (e.g. `wealthpilot`), push this folder.
2. `npm run deploy` publishes `dist/` to `gh-pages`. In the repo settings choose Pages → branch `gh-pages`.
3. The app is then at `https://<user>.github.io/wealthpilot/`. `vite.config.ts` uses `base: './'` and the router uses hashes, so no path configuration is needed.
4. In Supabase → Authentication → URL configuration, add that URL to **Site URL / Redirect URLs** (for confirmation and password-reset links).

## Email capture setup (optional)

- **Gmail:** Google Cloud → APIs & Services → enable *Gmail API* → Credentials → OAuth client (Web application) → add your site origin to *Authorized JavaScript origins*. Paste the client ID in Email → Settings. Scope: `gmail.readonly`.
- **Outlook:** Entra admin → App registrations → *Single-page application* with redirect URI `https://<your-site>/` → API permissions `User.Read`, `Mail.Read` (delegated). Paste the Application (client) ID; tenant `consumers` for personal outlook.com.
- Nothing is sent, labelled or deleted. Bodies are never stored.

## Project layout

```
src/
  app/            config, Supabase client, zustand store, hooks
    data/         types (one interface per table), Repo interface, SupabaseRepo, MemoryRepo, demoSeed
  lib/            pure engines (unit-tested): dates, money, accounts, paySchedule, periods, budget, recurring, debts, forecast, goals, ledger
    email/        text/money/date extraction, extract (one email → one fact), propose (match + describe), apply (write), mail (Gmail/Outlook)
  components/     ui (Card, KPI, Pill, Modal…), Table (editable grid), Chart (Plotly wrapper + SVG gauge), Layout (nav, topbar, mobile)
  pages/          one file per screen
supabase/migrations/   schema
e2e/                   Playwright smoke + DB tests
```

## Conventions

- Money is `numeric` in Postgres and `number` in TS; amounts on transactions are always **positive** — `kind` (+ accounts) gives direction.
- Dates are `YYYY-MM-DD` strings in local time; `today()` can be frozen with `setToday()` for tests.
- Budget actuals are **never stored** — they are computed from transactions for the period's date range. A budget line only holds the plan (+ rollover).
- Every write goes through the store (`insert / update / remove`), which is optimistic and falls back to the Repo; transactions post to balances via `lib/ledger.ts`.
- Pages never talk to Supabase directly.

## Changelog

- **0.2.0** — renamed to **WealthPilot**: new logo (`Logo.tsx` + `favicon.svg`), navy/teal/gold theme tokens (light + dark), storage-key prefix `wealthpilot.`, export/backup file names, `app` tag in JSON backups, `package.json` name, `setup.ps1` defaults.
- **0.1.2** — fixed `npm run e2e` crashing on Windows with `EISDIR`: the e2e static servers served any request path that matched a real directory (e.g. `/assets`) straight to `readFileSync`. They now fall back to `index.html` unless the path is a regular file.
- **0.1.1** — e2e scripts resolve `dist/` with `fileURLToPath` so `npm run check` passes on Windows (`URL.pathname` gave `/C:/…`); `setup.ps1` first-time setup script for Windows; README run notes.
- **0.1.0** — first release, spun off from CareerShift's finance modules.
