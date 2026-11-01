# WealthPilot roadmap — the "Finance Platform" spec mapped onto the app

Source spec: `roadmap/finance-platform-spec.md` in the Claude project (also the original attachment). Decision (Nov 1, 2026): treat the spec as the roadmap for the existing app — keep the stack (Vite + React + TS, zustand, Plotly, Supabase, engines in `src/lib` with unit tests) rather than rebuild on Tailwind/Recharts/Context.

Legend — **FE**: pure front-end, buildable now · **DB**: needs a schema migration · **EF**: needs a Supabase edge function (secrets / scheduled work) · **3P**: needs a paid third-party service · **✔**: already in v0.2.0

| Spec area | Spec item | Maps to | Kind | Release |
|---|---|---|---|---|
| Global | Light / Dark / System theme, persisted | Layout theme toggle (light/dark ✔) → add **System** | FE | 0.3.0 |
| Global | Environment / deployment / API / DB status, last sync | About panel + rail footer: hostname → env, Supabase reachability, last `refresh()` | FE | 0.3.0 |
| 1 Spending Intelligence | Transaction tracking across debit / credit / checking / savings / cash | Transactions ✔ (accounts of every kind) | ✔ | — |
| | Auto-categorization | Email remembered payees ✔ → **payee rules engine** for all sources | FE | 0.4.0 |
| | Monthly / weekly / daily trends, category analysis | Trends ✔ (week/month/year, by category, by group, day-of-week) | ✔ | — |
| | Merchant analysis, subscription analysis, recurring charges | **`lib/intelligence.ts`** + Insights page | FE | 0.3.0 |
| | Waste detection: duplicates, rising subscriptions, fees, late fees, unused subscriptions, spikes, outliers | `lib/intelligence.ts` waste engine | FE | 0.3.0 |
| | Health indicators: burn rate, savings rate, expense ratio, cash-flow score, efficiency score | `lib/intelligence.ts` health engine (Dashboard + Insights) | FE | 0.3.0 |
| 2 Account Balances | Balances as last updated (institution, type, current, available, timestamp) | Accounts ✔ (`balance_as_of`); add available = limit − balance | FE | 0.3.0 |
| | Net worth centre | Dashboard / Accounts / Trends ✔ | ✔ | — |
| | Liquidity: emergency-fund coverage, months covered, cash reserve | Dashboard runway ✔ → liquidity card on Accounts | FE | 0.3.0 |
| | Goal allocation engine | Goals ✔ → allocation view (balances vs goals) | FE | 0.5.0 |
| | Manual overrides with audit log | Inline balance edit ✔ + `activity_log` ✔ | ✔ | — |
| 3 Bank Connections | CSV / OFX / QFX import with de-dup | **`lib/import.ts`** + Connections page (`external_id` unique index ✔) | FE | 0.3.0 |
| | Sync status, history, logs, "Sync now" | Connections page: import history (source, file, rows, dupes) | FE+DB | 0.3.0 (history in settings json) |
| | Plaid / Teller / MX | Needs a server to hold secrets + webhooks | EF + 3P | evaluate (step 7h) |
| 4 Investments & Retirement | Holdings: stocks, ETFs, funds, bonds, real estate, cash, alternatives | **new `holdings` table** + Investments page | DB | 0.6.0 |
| | Asset / sector / risk allocation | `lib/portfolio.ts` | FE | 0.6.0 |
| | Retirement planner (age, contributions, return, inflation → value, readiness, replacement ratio) | `lib/retirement.ts` | FE | 0.6.0 |
| | Monte Carlo 1k / 5k / 10k runs; safe-withdrawal 3/4/5/custom % | `lib/retirement.ts` (web worker for 10k) | FE | 0.6.0 |
| 5 Tax Planning | Income aggregation (W-2, 1099, dividends, interest, gains, business, rental) | **new `tax_profile` + `tax_items`** tables | DB | 0.7.0 |
| | Federal / state (Ohio) / local / SE tax engine; underpayment risk; withholding sliders; filing projection; tax calendar | `lib/tax.ts` with dated bracket tables + sources | FE | 0.7.0 |
| 6 Goals & Planning | Emergency fund, debt payoff, retirement, home, education, purchases; progress, forecast, milestones, what-if | Goals ✔ + Forecast what-ifs ✔ → milestones + what-if per goal | FE | 0.5.0 |
| 7 Reports | Monthly / quarterly / annual; spending, investment, tax, net worth; PDF / Excel / CSV | Reports page: print-to-PDF stylesheet, CSV ✔, Excel via SheetJS | FE | 0.8.0 |
| 8 Security & Settings | MFA / 2FA | Supabase Auth TOTP (`auth.mfa.*`) in Settings | FE | 0.4.0 |
| | Session / device management, password | `auth.signOut({scope:'others'})`, password ✔ | FE | 0.4.0 |
| | API-key vault, encryption status | Only client IDs are stored (no secrets in a static app) — show what is stored and where | FE | 0.4.0 |
| | Observability: API calls, sync events, user actions, audit, failed imports | `activity_log` ✔ + import/sync log | FE | 0.3.0 / 0.4.0 |
| | Latency / error rate / uptime | Not meaningful for a static app + Supabase; show Supabase status + last refresh instead | — | — |
| Data tables | Sort, filter, search, pagination, column visibility, resize, CSV/Excel export | `Table.tsx` ✔ sort/search/inline edit → add paging, column picker, resize, export | FE | 0.4.0 |
| Sample data | 50+ transactions, 5+ institutions, investment & retirement accounts | Offline demo ✔ → extend with holdings + tax sample | FE | 0.6.0 |
| Navigation | 8 primary tabs | Regroup the rail zones to the spec's 8 once Investments / Tax / Reports exist | FE | 0.8.0 |

Not planned: MFA beyond TOTP, "API latency / uptime" dashboards, Plaid/Teller/MX until a backend exists.
