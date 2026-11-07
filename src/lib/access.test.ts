import { describe, it, expect } from 'vitest'
import { isCommonPassword, MODULES, GRANTABLE, ALWAYS_ON, moduleForPath, allowedModules, canViewPath, allowedPaths, normaliseModules, accessLevel, accessToMember, describeAccess, genTempPassword, isTempPassword, passwordProblems, inviteEmailDraft, mailtoLink } from './access'
import { VIEWS } from '../components/Layout'

describe('modules', () => {
  it('every page in the nav belongs to exactly one module', () => {
    for (const v of VIEWS) expect(MODULES.filter(m => m.paths.includes(v.path)).length, v.path).toBe(1)
    const all = MODULES.flatMap(m => m.paths); expect(new Set(all).size).toBe(all.length)
  })
  it('null = everything; a list adds the always-on modules and drops unknown keys', () => {
    expect(allowedModules(null)).toEqual(MODULES.map(m => m.k))
    expect(allowedModules(['transactions', 'bogus'])).toEqual([...ALWAYS_ON, 'transactions'].sort((a, b) => MODULES.findIndex(m => m.k === a) - MODULES.findIndex(m => m.k === b)))
    expect(canViewPath('/transactions', ['transactions'])).toBe(true); expect(canViewPath('/insights', ['transactions'])).toBe(true)
    expect(canViewPath('/accounts', ['transactions'])).toBe(false); expect(canViewPath('/', ['transactions'])).toBe(true); expect(canViewPath('/settings', [])).toBe(true)
    expect(canViewPath('/not-a-page', [])).toBe(true)   // unknown paths are left to the router
    expect(allowedPaths(['goals'])).toEqual(['/', '/forecast', '/help', '/goals', '/plan', '/reports', '/trends', '/settings'])
    expect(moduleForPath('/debts')).toBe('accounts')
  })
  it('normalises module lists: full set → null, duplicates and always-on dropped, sorted', () => {
    expect(normaliseModules(null)).toBeNull(); expect(normaliseModules(GRANTABLE.map(m => m.k))).toBeNull()
    expect(normaliseModules(['goals', 'budget', 'goals', 'overview', 'x'])).toEqual(['budget', 'goals'])
    expect(normaliseModules([])).toEqual([])
  })
})

describe('access levels', () => {
  it('derives the level from role, read-only and modules, and back', () => {
    expect(accessLevel({ role: 'owner', read_only: false, modules: null })).toBe('owner')
    expect(accessLevel({ role: 'editor', read_only: false, modules: null })).toBe('full')
    expect(accessLevel({ role: 'editor', read_only: true, modules: null })).toBe('readonly')
    expect(accessLevel({ role: 'viewer', read_only: false, modules: null })).toBe('readonly')
    expect(accessLevel({ role: 'editor', read_only: false, modules: ['budget'] })).toBe('limited')
    expect(accessLevel({ role: 'editor', read_only: false, modules: GRANTABLE.map(m => m.k) })).toBe('full')   // every module granted = full
    expect(accessToMember('full', null, false)).toEqual({ role: 'editor', read_only: false, modules: null })
    expect(accessToMember('readonly', ['budget'], true)).toEqual({ role: 'viewer', read_only: true, modules: null })
    expect(accessToMember('limited', ['budget', 'goals'], true)).toEqual({ role: 'editor', read_only: false, modules: ['budget', 'goals'] })
    expect(accessToMember('limited', ['budget'], false)).toEqual({ role: 'viewer', read_only: true, modules: ['budget'] })
  })
  it('describes access in one line', () => {
    expect(describeAccess({ role: 'viewer', read_only: true, modules: null })).toMatch(/^Read-only/)
    expect(describeAccess({ role: 'editor', read_only: false, modules: ['budget', 'goals'] })).toBe('Limited — Budget, Savings goals & plan (can add and change there)')
    expect(describeAccess({ role: 'viewer', read_only: true, modules: ['tax'] })).toBe('Limited — Tax planning (read-only)')
  })
})

describe('temporary passwords and password rules', () => {
  it('generates WP-xxxx-xxxx-xxxx without ambiguous characters', () => {
    let s = 1; const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
    const pw = genTempPassword(rnd); expect(isTempPassword(pw)).toBe(true); expect(pw).not.toMatch(/[0O1lI]/)
    expect(genTempPassword(rnd)).not.toBe(pw)
    expect(isTempPassword('WP-abcd-efgh-ijk')).toBe(false)
  })
  it('rejects weak, reused or temp-shaped passwords', () => {
    expect(passwordProblems('Sunny-Harbor-2026', { temp: 'WP-abcd-efgh-jkmn', email: 'gary@x.com', confirm: 'Sunny-Harbor-2026' })).toEqual([])
    expect(passwordProblems('short1A')).toContain('at least 10 characters')
    expect(passwordProblems('alllowercase1')).toContain('upper- and lower-case letters')
    expect(passwordProblems('NoDigitsHereAtAll')).toContain('a number')
    expect(passwordProblems('WP-abcd-efgh-jkmn', { temp: 'WP-abcd-efgh-jkmn' })).toContain('different from the temporary password')
    expect(passwordProblems('WP-Abcd-efgh-jkm2')).toContain('not in the temporary-password format')
    expect(passwordProblems('Garynthomas99', { email: 'garynthomas@gmail.com' })).toContain('not contain your email name')
    expect(passwordProblems('Abcdefghij12', { confirm: 'Abcdefghij13' })).toContain('the two entries must match')
  })
})

describe('common-password blocklist', () => {
  it('blocks common bases with years, symbols and look-alike swaps', () => {
    for (const pw of ['Password123', 'P@ssw0rd2026', 'Qwerty12345!', 'Welcome2026', 'Letmein99', 'Wealthpilot1', 'Iloveyou2026', 'pass-word_2025']) expect(isCommonPassword(pw), pw).toBe(true)
    expect(passwordProblems('Password2026')).toContain('not a common password')
  })
  it('lets genuine passphrases through, including ones that merely contain a common word', () => {
    for (const pw of ['Sunny-Harbor-2026', 'Correct7Horse-Battery', 'MyWelcomeMat-Is-Blue9', 'Tr0ub4dor&3xKcd']) expect(isCommonPassword(pw), pw).toBe(false)
    expect(passwordProblems('Sunny-Harbor-2026')).toEqual([])
  })
})

describe('invitation email', () => {
  const base = { appName: 'WealthPilot', household: 'Thomas', inviter: 'gary@x.com', email: 'pat@example.com', siteUrl: 'https://example.github.io/wealthpilot/' }
  it('carries the access line and the site link — never a password, nothing else from the household (0.25.1)', () => {
    const d = inviteEmailDraft({ ...base, displayName: 'Pat', access: { role: 'editor', read_only: false, modules: ['budget'] }, note: 'Call me if stuck.' })
    expect(d.subject).toBe('You\'re invited to "Thomas" on WealthPilot')
    expect(d.body).toMatch(/^Hi Pat,/); expect(d.body).toContain('Limited — Budget (can add and change there)')
    expect(d.body).toContain(`To join, open ${base.siteUrl} and sign in with ${base.email}`); expect(d.body).toContain('create your account with that address'); expect(d.body).toContain('Call me if stuck.')
    expect(d.body).not.toMatch(/password|Email: /i)
  })
  it('builds a mailto link with everything encoded', () => {
    const l = mailtoLink('pat@example.com', 'A & B', 'line 1\nline 2'); expect(l.startsWith('mailto:pat%40example.com?subject=A%20%26%20B&body=line%201%0Aline%202')).toBe(true)
  })
})

// 0.25.1 review: the invite function keeps its own copy of the sections that can be given (an Edge Function cannot import from src/)
const INVITE_FN = import.meta.glob<string>('../../supabase/functions/invite-member/index.ts', { query: '?raw', import: 'default', eager: true })
describe('invite-member sections', () => {
  it('match GRANTABLE exactly (a section missing there could not be given in an invitation)', () => {
    const src = Object.values(INVITE_FN)[0]; const m = /const MODULES = \[([^\]]*)\]/.exec(src)
    expect(m).toBeTruthy()
    const fn = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    expect(fn).toEqual(GRANTABLE.map(g => g.k).sort())
  })
})
