#!/usr/bin/env node
// Roll back the last change (0.26.0). Shows the last 10 deploys (gh-pages) and the last 10 commits on main, then either puts an older
// build back on the live site (`--to`, runs .github/workflows/rollback.yml) or takes a change out of the code (`--revert`, a revert
// branch and a pull request). No dependencies: it calls `git` and `gh`. docs/ROLLBACK.md explains when to use which.
import { execFileSync } from 'node:child_process'

const USAGE = `Usage
  node scripts/rollback.mjs                              show the last 10 deploys and the last 10 commits on main
  node scripts/rollback.mjs --to <ref> [--reason "..."]  put that commit's build back on the live site (runs the rollback workflow)
  node scripts/rollback.mjs --revert <sha>               open a pull request that reverts that commit (merge commit or plain)
  node scripts/rollback.mjs --help

  <ref>  a commit SHA, tag or branch on main's history. Takes a minute or two: watch it with \`gh run watch\`.
         Afterwards run the SQL the workflow prints (app_meta.latest_version), or every user sees a false "update available" banner.
  <sha>  the commit to undo — for a feature, the merge commit of its pull request (shown in the list as "(#NN)").
         Makes branch revert/<sha7> from origin/main, reverts, pushes (never force) and opens the PR. CI deploys when you merge it.

  Both actions need a clean working tree and the GitHub CLI (gh) signed in. Nothing here touches the database.`

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : (args[i + 1] ?? '') }
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0) }
const to = flag('--to'), revert = flag('--revert'), reason = flag('--reason') ?? ''
for (const a of args) if (a.startsWith('-') && !['--to', '--revert', '--reason'].includes(a)) fail(`Unknown option ${a}\n\n${USAGE}`)
if (to !== undefined && revert !== undefined) fail('Use either --to or --revert, not both.')
if ((to !== undefined && !to) || (revert !== undefined && !revert)) fail(`Missing value.\n\n${USAGE}`)

function fail(msg) { console.error(`\nrollback: ${msg}`); process.exit(1) }
function run(cmd, cmdArgs, opts = {}) {
  try { return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'] }).trim() }
  catch (e) {
    if (e.code === 'ENOENT') fail(`${cmd} is not installed or not on PATH.${cmd === 'gh' ? ' Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.' : ''}`)
    if (opts.soft) return null
    fail(`\`${cmd} ${cmdArgs.join(' ')}\` failed${e.status != null ? ` (exit ${e.status})` : ''}.`)
  }
}
const tryRun = (cmd, cmdArgs) => run(cmd, cmdArgs, { soft: true, quiet: true })

// --- where are we ---------------------------------------------------------------------------------------------------------------------
if (tryRun('git', ['rev-parse', '--is-inside-work-tree']) !== 'true') fail('Run this inside the repository.')
const dirty = run('git', ['status', '--porcelain'])
const hasRemote = tryRun('git', ['remote', 'get-url', 'origin'])
if (!hasRemote) fail('No "origin" remote — this script works against github.com/garynth41/wealthpilot.')

// --- the lists -------------------------------------------------------------------------------------------------------------------------
const fetched = { main: tryRun('git', ['fetch', '--quiet', 'origin', 'main']) !== null, pages: tryRun('git', ['fetch', '--quiet', 'origin', 'gh-pages']) !== null }
if (!fetched.main) console.log('\n(could not fetch origin/main — offline? Showing what is already known locally.)')

console.log('\nLast 10 deploys (gh-pages — newest first; "ci: deploy <sha7>" is the main commit that was built)')
const deploys = tryRun('git', ['log', 'origin/gh-pages', '--format=%h%x09%ci%x09%s', '-n', '10'])
if (deploys) console.log(indent(deploys))
else console.log(`  (no origin/gh-pages here${fetched.pages ? '' : ' and fetching it failed — check the network or run: git fetch origin gh-pages'})`)

console.log('\nLast 10 commits on main (newest first; "(#NN)" is the pull request — that is the sha to revert a feature)')
const mains = tryRun('git', ['log', 'origin/main', '--format=%h%x09%ci%x09%s', '-n', '10'])
if (mains) console.log(indent(mains)); else console.log('  (no origin/main here — run: git fetch origin main)')

if (to === undefined && revert === undefined) { console.log(`\n${USAGE}`); process.exit(0) }

// --- shared checks for both actions -------------------------------------------------------------------------------------------------------
if (dirty) fail(`the working tree has uncommitted changes — commit or set them aside first:\n${indent(dirty)}`)
if (!fetched.main) fail('could not fetch origin/main — not safe to continue offline.')
if (run('gh', ['auth', 'status'], { quiet: true, soft: true }) === null) fail('the GitHub CLI is not signed in — run `gh auth login` first.')
const sha = resolveOnMain(to ?? revert)
const sha7 = sha.slice(0, 7)
const subject = run('git', ['log', '-1', '--format=%s', sha])

// --- --to: redeploy an older build ----------------------------------------------------------------------------------------------------------
if (to !== undefined) {
  const version = versionAt(sha)
  console.log(`\nPutting ${sha7} (version ${version}) back on the live site: ${subject}`)
  run('gh', ['workflow', 'run', 'rollback.yml', '--ref', 'main', '-f', `ref=${sha}`, '-f', `reason=${reason}`])
  console.log(`
Started the rollback workflow. Watch it:   gh run watch   (or GitHub → Actions → rollback)
When it is green the site is back to ${version}. Then run this on the production database (Supabase → SQL editor), or every user
sees an "update available" banner that leads nowhere:

  update public.app_meta set value = '${version}' where key = 'latest_version';

main is unchanged: the next push to main deploys main again. To remove the change from the code, run --revert on its merge commit.`)
  process.exit(0)
}

// --- --revert: a revert branch and a pull request ----------------------------------------------------------------------------------------
const branch = `revert/${sha7}`
if (tryRun('git', ['rev-parse', '--verify', '--quiet', branch]) !== null) fail(`branch ${branch} already exists here — delete it or finish that revert first.`)
if (tryRun('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`]) !== null) fail(`branch ${branch} already exists on origin — there is probably an open pull request for it.`)
const parents = run('git', ['rev-list', '--parents', '-n', '1', sha]).split(' ').length - 1
const isMerge = parents > 1
const startedOn = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
console.log(`\nReverting ${sha7}${isMerge ? ' (a merge commit — reverting the whole pull request)' : ''}: ${subject}`)
run('git', ['checkout', '--quiet', '-b', branch, 'origin/main'])
const revertArgs = isMerge ? ['revert', '--no-edit', '-m', '1', sha] : ['revert', '--no-edit', sha]
if (run('git', revertArgs, { soft: true }) === null) {
  tryRun('git', ['revert', '--abort']); run('git', ['checkout', '--quiet', startedOn]); run('git', ['branch', '-D', branch])
  fail(`the revert does not apply cleanly (later commits changed the same lines). Do it by hand:\n  git checkout -b ${branch} origin/main && git ${revertArgs.join(' ')}\nthen resolve the conflicts, commit, push and open a pull request.`)
}
run('git', ['push', '--quiet', '-u', 'origin', branch])   // a new branch: a plain push, never --force
const title = `Revert "${subject}"`
const body = `Reverts ${sha} (${subject}).\n\nReason: ${reason || '_(fill in)_'}\n\nMerging this makes CI deploy main without that change. Database migrations are not undone by a revert — see docs/ROLLBACK.md.`
const pr = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body])
console.log(`
Done:
  - branch ${branch} made from origin/main
  - ${isMerge ? `git revert -m 1 ${sha7}` : `git revert ${sha7}`} committed
  - pushed to origin (no force)
  - pull request opened: ${pr}

You are now on branch ${branch}. Review the PR, let CI pass and merge it — the deploy job then publishes main without that change.
After it is live, if the app's version went down, set app_meta.latest_version to the live version (docs/ROLLBACK.md).`)

// --- helpers --------------------------------------------------------------------------------------------------------------------------------
function resolveOnMain(ref) {
  // a branch name means the branch on GitHub (the local one may be behind); a SHA or tag resolves directly
  const full = tryRun('git', ['rev-parse', '--verify', '--quiet', `origin/${ref}^{commit}`]) ?? tryRun('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  if (!full) fail(`"${ref}" is not a commit, tag or branch this clone knows about.`)
  if (tryRun('git', ['merge-base', '--is-ancestor', full, 'origin/main']) === null) fail(`${ref} (${full.slice(0, 7)}) is not on main's history — only commits that were on main can be rolled back to or reverted.`)
  return full
}
function versionAt(commit) {
  try { return JSON.parse(run('git', ['show', `${commit}:package.json`], { quiet: true })).version } catch { return '(unknown — package.json not readable at that commit)' }
}
function indent(text) { return text.split('\n').map((l) => `  ${l}`).join('\n') }
