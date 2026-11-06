// Retirement engine (0.6.0): deterministic projection, readiness score, income-replacement ratio, Monte Carlo and safe-withdrawal stress test.
// Pure functions. Money in today's dollars unless stated; `expectedReturn`, `inflation`, `returnStdDev` are annual decimals (0.07 = 7%).
import type { RetirementInputs } from '../app/data/types'
import { round2 } from './money'

export const RETIREMENT_DEFAULTS: RetirementInputs = { currentAge: 40, retireAge: 65, lifeExpectancy: 92, annualContribution: 12000, expectedReturn: 0.07, inflation: 0.025, returnStdDev: 0.12, desiredIncome: 60000, socialSecurity: 24000, currentIncome: 90000, ssMonthly: null, ssStartAge: 67, ssHaircut: 0, pensions: [] }

// ---------------- guaranteed income (0.20.0) ----------------
/** Social Security per year in today's dollars: the monthly SSA figure when given, else the legacy annual field. */
export const ssAnnual = (i: RetirementInputs) => i.ssMonthly != null && i.ssMonthly > 0 ? i.ssMonthly * 12 : (+i.socialSecurity || 0)
/** Age Social Security starts (defaults to the later of 67 and the retirement age when unset). */
export const ssStart = (i: RetirementInputs) => i.ssStartAge && i.ssStartAge > 0 ? i.ssStartAge : Math.max(67, i.retireAge)
/** Guaranteed income at `age`, $/yr in today's dollars: Social Security (less the haircut scenario) once claimed, plus pensions that have started.
 *  A pension without COLA loses purchasing power: its real value shrinks by inflation every year after it starts. */
export function guaranteedIncome(i: RetirementInputs, age: number, haircut = i.ssHaircut || 0): number {
  const ss = age >= ssStart(i) ? ssAnnual(i) * (1 - Math.max(0, Math.min(1, haircut))) : 0
  const pen = (i.pensions || []).filter(p => +p.monthly > 0 && age >= +p.startAge).reduce((n, p) => n + (+p.monthly * 12) * (p.cola === false ? Math.pow(1 + i.inflation, -(age - +p.startAge)) : 1), 0)
  return round2(ss + pen)
}
/** Guaranteed income once every line has started (the steady state the 4% rule is measured against). */
export const steadyGuaranteed = (i: RetirementInputs, haircut = i.ssHaircut || 0) => guaranteedIncome(i, Math.max(ssStart(i), ...(i.pensions || []).map(p => +p.startAge || 0), i.retireAge), haircut)
export interface Drawdown { path: Array<{ age: number; guaranteed: number; draw: number; balance: number }>; depletionAge: number | null; endingBalance: number; bridgeYears: number; bridgeDraw: number; totalDraw: number; totalGuaranteed: number }
/** Year by year from retirement to the plan age, today's dollars at the expected real return: what guaranteed income covers, what the portfolio must supply, and what is left. */
export function drawdown(balanceAtRet: number, i: RetirementInputs, haircut = i.ssHaircut || 0): Drawdown {
  const realRate = (1 + i.expectedReturn) / (1 + i.inflation) - 1; const path: Drawdown['path'] = []; let b = balanceAtRet, depletion: number | null = null, totalDraw = 0, totalG = 0, bridgeYears = 0, bridgeDraw = 0
  for (let age = i.retireAge; age < Math.max(i.retireAge + 1, i.lifeExpectancy); age++) {
    const g = guaranteedIncome(i, age, haircut); const draw = Math.max(0, i.desiredIncome - g); if (age < ssStart(i)) { bridgeYears++; bridgeDraw += draw }
    totalDraw += draw; totalG += Math.min(g, i.desiredIncome)
    b = b * (1 + realRate) - draw; if (b <= 0 && depletion == null) depletion = age; b = Math.max(0, b)
    path.push({ age, guaranteed: g, draw: round2(draw), balance: round2(b) })
  }
  return { path, depletionAge: depletion, endingBalance: round2(b), bridgeYears, bridgeDraw: round2(bridgeDraw), totalDraw: round2(totalDraw), totalGuaranteed: round2(totalG) }
}

export interface Projection { years: number; nominal: number; real: number; realRate: number; path: Array<{ age: number; nominal: number; real: number }>; needed: number; guaranteed: number; bridgeYears: number; readiness: number; replacementRatio: number | null; sustainableIncome: number; shortfall: number; contributionForTarget: number | null }
/** Grow the current balance with annual contributions (contributions grow with inflation) to retirement; express in today's dollars; score readiness against the income you want. */
export function projectRetirement(balance: number, i: RetirementInputs, swr = 0.04): Projection {
  const years = Math.max(0, i.retireAge - i.currentAge); const r = i.expectedReturn, g = i.inflation; const realRate = (1 + r) / (1 + g) - 1
  let nominal = balance, contrib = i.annualContribution; const path: Projection['path'] = [{ age: i.currentAge, nominal: round2(balance), real: round2(balance) }]
  for (let y = 1; y <= years; y++) { nominal = nominal * (1 + r) + contrib; contrib *= 1 + g; path.push({ age: i.currentAge + y, nominal: round2(nominal), real: round2(nominal / Math.pow(1 + g, y)) }) }
  const real = round2(nominal / Math.pow(1 + g, years))
  // the portfolio must fund (income wanted − guaranteed income) at the withdrawal rate once every guaranteed line has started, plus the bridge
  // years before Social Security begins, which it funds in full (discounted at the real rate)
  const steady = steadyGuaranteed(i); const needFromPortfolio = Math.max(0, i.desiredIncome - steady)
  let bridge = 0; for (let age = i.retireAge; age < ssStart(i) && age < i.lifeExpectancy; age++) { const extra = Math.max(0, i.desiredIncome - guaranteedIncome(i, age)) - needFromPortfolio; bridge += Math.max(0, extra) / Math.pow(1 + realRate, age - i.retireAge) }
  const needed = round2(needFromPortfolio / swr + bridge)
  const sustainableIncome = round2(real * swr + steady)
  const readiness = Math.max(0, Math.min(100, Math.round(needed > 0 ? real / needed * 100 : 100)))
  const replacementRatio = i.currentIncome > 0 ? round2(sustainableIncome / i.currentIncome) : null
  const shortfall = round2(Math.max(0, needed - real))
  // contribution (today's dollars, growing with inflation) that would close the gap: solve FV of growing annuity in real terms
  let contributionForTarget: number | null = null
  if (shortfall > 0 && years > 0) { const fvFactor = realRate !== 0 ? (Math.pow(1 + realRate, years) - 1) / realRate : years; const have = balance * Math.pow(1 + realRate, years); contributionForTarget = round2(Math.max(0, (needed - have) / fvFactor)) }
  return { years, nominal: round2(nominal), real, realRate: round2(realRate * 10000) / 10000, path, needed, guaranteed: steady, bridgeYears: Math.max(0, Math.min(i.lifeExpectancy, ssStart(i)) - i.retireAge), readiness, replacementRatio, sustainableIncome, shortfall, contributionForTarget }
}

/** Deterministic PRNG (mulberry32) so simulations are reproducible in tests and across re-renders. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
/** Standard normal via Box–Muller. */
export const normal = (u: () => number) => { let a = 0; while (a === 0) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()) }

export interface MonteCarlo { runs: number; successRate: number; median: number; p10: number; p90: number; medianAtRetirement: number; worst: number; years: number; bands: Array<{ age: number; p10: number; p50: number; p90: number }>; depletionAges: number[] }
/** Accumulate to retirement, then withdraw `desiredIncome − guaranteed income at that age` (inflation-adjusted) until life expectancy. Returns are lognormal-ish: normal(mean, sd) each year, floored at −95%. Values in today's dollars. */
export function monteCarlo(balance: number, i: RetirementInputs, runs = 1000, seed = 42): MonteCarlo {
  const u = rng(seed); const accYears = Math.max(0, i.retireAge - i.currentAge), drawYears = Math.max(1, i.lifeExpectancy - i.retireAge); const total = accYears + drawYears
  const needAt = (age: number) => Math.max(0, i.desiredIncome - guaranteedIncome(i, age)); const finals: number[] = [], atRet: number[] = [], depletion: number[] = []; const byYear: number[][] = Array.from({ length: total + 1 }, () => [])
  for (let k = 0; k < runs; k++) {
    let v = balance, contrib = i.annualContribution; let dead = -1
    byYear[0].push(v)
    for (let y = 1; y <= total; y++) {
      const ret = Math.max(-0.95, i.expectedReturn + i.returnStdDev * normal(u))
      if (y <= accYears) { v = v * (1 + ret) + contrib; contrib *= 1 + i.inflation } else { const draw = needAt(i.currentAge + y) * Math.pow(1 + i.inflation, y); v = v * (1 + ret) - draw; if (v <= 0 && dead < 0) { dead = i.currentAge + y; v = 0 } }
      byYear[y].push(v / Math.pow(1 + i.inflation, y))   // today's dollars
      if (y === accYears) atRet.push(v / Math.pow(1 + i.inflation, y))
    }
    finals.push(v / Math.pow(1 + i.inflation, total)); if (dead > 0) depletion.push(dead)
  }
  const q = (arr: number[], p: number) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] }
  const bands = byYear.map((arr, y) => ({ age: i.currentAge + y, p10: round2(q(arr, 0.1)), p50: round2(q(arr, 0.5)), p90: round2(q(arr, 0.9)) }))
  return { runs, successRate: round2((runs - depletion.length) / runs), median: round2(q(finals, 0.5)), p10: round2(q(finals, 0.1)), p90: round2(q(finals, 0.9)), medianAtRetirement: round2(accYears ? q(atRet, 0.5) : balance), worst: round2(Math.min(...finals)), years: total, bands, depletionAges: depletion }
}

export interface SwrResult { rate: number; annualIncome: number; totalIncome: number; yearsLast: number | null; lastsToLifeExpectancy: boolean; endingBalance: number }
/** Deterministic stress test: withdraw rate × starting balance (inflation-adjusted) each year at the expected real return; how long does it last? */
export function safeWithdrawal(startBalance: number, i: RetirementInputs, rates = [0.03, 0.04, 0.05]): SwrResult[] {
  const realRate = (1 + i.expectedReturn) / (1 + i.inflation) - 1; const horizon = Math.max(1, i.lifeExpectancy - i.retireAge); const cap = 100
  return rates.map(rate => { const draw = startBalance * rate; let v = startBalance, years = 0; let total = 0
    while (v > 0 && years < cap) { v = v * (1 + realRate) - draw; total += draw; years++ }
    const lasts = years >= cap || v > 0; const ending = (() => { let b = startBalance; for (let y = 0; y < horizon; y++) { b = b * (1 + realRate) - draw; if (b <= 0) return 0 } return b })()
    return { rate, annualIncome: round2(draw + steadyGuaranteed(i)), totalIncome: round2(total), yearsLast: lasts ? null : years, lastsToLifeExpectancy: lasts || years >= horizon, endingBalance: round2(Math.max(0, ending)) } })
}
