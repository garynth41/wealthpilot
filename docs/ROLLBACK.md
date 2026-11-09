# Rolling back a change

Since 0.26.0 Cresari has two ways to undo the last change: put an older build back on the live site in a few minutes, or take the change
out of the code with a pull request. Both are run from `scripts/rollback.mjs` (or the Actions tab). Neither touches the database or the
phone apps — those are covered further down. Everything here needs the GitHub CLI (`gh`) signed in.

## Find the sha of the last change

```bash
git fetch origin && git log --oneline origin/main -5
node scripts/rollback.mjs          # the same list, plus the last 10 deploys from gh-pages
```

Every pull request merges as one commit whose message ends with its number, e.g. `Fix: the menu … (#8)`. That commit is the "change".
The gh-pages list shows which main commit each deploy was built from (`ci: deploy <sha7>`); `Updates` is a deploy made by hand with
`npm run deploy`.

## 1. Undo the live site now

Use this when something is broken for users and you want the previous version back before working out why.

- **From the terminal:** `node scripts/rollback.mjs --to <sha> --reason "why"` (the sha of the last good commit, usually the one below
  the top of the list).
- **From GitHub:** Actions → **rollback** → Run workflow. Leave *ref* empty to go back one commit on main, or enter a sha, tag or branch.

What happens: the workflow checks out that commit, builds it (`npm ci`, `npm run build`) and publishes `dist/` to the `gh-pages` branch
with the same command CI's deploy uses, as commit `ci: rollback to <sha7> — <reason>`. The site at
https://garynth41.github.io/wealthpilot/ shows the old version a minute or two later (hard-refresh; the service worker picks it up on the
next load). It only accepts commits that are on main's history, and it waits for any deploy that is already publishing.

**Then run the SQL the job summary shows**, on production (Supabase → SQL editor, project `dshswfcpovdpxcidolqb`):

```sql
update public.app_meta set value = '<version now live, e.g. 0.25.3>' where key = 'latest_version';
```

Why: the app compares `app_meta.latest_version` with its own `APP_VERSION` and shows an "update available" banner when the database
value is newer. After a rollback the live app is older than that value, so every user would see the banner — and reloading would not
make it go away. CI has no database credentials, so this is the one step done by hand.

Remember that main still has the change. The next push to main deploys main again, so follow up with step 2, or fix forward.

## 2. Undo a feature in the code

```bash
node scripts/rollback.mjs --revert <sha>     # the "(#NN)" commit from the list
```

The script makes branch `revert/<sha7>` from `origin/main`, runs `git revert` (with `-m 1` when the commit is a real merge commit),
pushes it — never with `--force` — and opens a pull request. Review it, let CI pass and merge it; the deploy job publishes main without
the change. If the revert does not apply cleanly the script stops, cleans up and prints the commands to do it by hand.

A revert PR does not change `package.json`'s version. If the live app's version went down, run the `latest_version` SQL above.

## 3. Database changes are not rolled back

Migrations in `supabase/migrations` are applied to staging and production by hand and are **not** undone by either step above. A
reverted app running on a newer schema is usually fine (it ignores columns it does not know), but not always — a renamed or dropped
column, or a changed function, breaks the old build. So:

- **Rule: write the reverse SQL before applying a migration to production.** Keep it next to the migration (for `0020_x.sql`, a
  `0020_x.down.sql` or a `-- down:` block at the end) and read it once before you run the up step. If a migration cannot be reversed
  (dropping data), say so there and take a backup first (Supabase → Database → Backups).
- To roll the database back, run that reverse SQL on staging, check the old build against staging (`npm run e2e:db`), then run it on
  production, then redeploy the old build (step 1).
- `app_meta.latest_version` and `min_native_version` are data, not schema — set them to match whatever is live (step 1 and MOBILE.md).

## 4. Phone apps cannot be rolled back

The App Store and Google Play never go back to an earlier build. If a store version is bad, ship a fix: raise the version in
`package.json` (or use the *rebuild* number), run **release apps**, and submit. Until the fix is approved, you can stop the broken
version from being used by raising `app_meta.min_native_version` (MOBILE.md), which shows every older app a full-screen "update
required" notice — only do that when the build really cannot be left running. The phone apps carry their own copy of the web app, so a
website rollback (step 1) does not affect them.

## Files

| Path | What |
|---|---|
| `.github/workflows/rollback.yml` | rebuilds an older commit and publishes it to gh-pages; prints the version and the SQL in the job summary |
| `scripts/rollback.mjs` | lists the last deploys and commits; `--to` runs the workflow, `--revert` opens a revert PR |
