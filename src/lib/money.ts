import { numberFormat, separators, isPrivate, MASK } from './display'
/** "$5,000.50", "5,000", "28.99 %", "(120)", "−45" → number; blank or junk → null. */
export const parseNum = (str: unknown): number | null => {
  let s = String(str ?? '').trim().replace(/−|–/g, '-')
  if (!s) return null
  let neg = false
  const p = s.match(/^\((.*)\)$/); if (p) { s = p[1]; neg = true }
  // both separators typed: the last one is the decimal point ("1.234,56" or "1,234.56"); a comma alone is a decimal point only where
  // the locale writes decimals with a comma ("12,5" in Germany, 125 in the US); a dot alone is always a decimal point (fields are prefilled that way)
  s = s.replace(/US\$|USD|[$€£%\s\u00a0\u202f']/gi, '')
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.')
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lc >= 0) s = separators().decimal === ',' && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1) }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null
  const n = Number(s); return isNaN(n) ? null : neg ? -n : n
}
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const sum = (a: Array<number | string | null | undefined>) => a.reduce<number>((x, y) => x + (+(y ?? 0) || 0), 0)
/** $1,234 (no cents) — for KPIs and charts. */
export const fmtMoney = (n: number | string | null | undefined) => { const v = +(n ?? 0) || 0; if (isPrivate()) return '$' + MASK; return (v < 0 ? '−' : '') + numberFormat({ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(Math.round(v))) }
/** $1,234.56 — for ledgers. */
export const fm2 = (n: number | string | null | undefined) => { if (n == null || n === '' || isNaN(+n)) return '—'; if (isPrivate()) return '$' + MASK; const v = +n; return (v < 0 ? '−' : '') + numberFormat({ style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v)) }
/** A plain number in the reader's locale ("1,234.5" / "1.234,5"); masked in privacy mode when `money`. */
export const fmtNum = (n: number | null | undefined, digits = 0, money = false) => (n == null || !isFinite(n) ? '—' : money && isPrivate() ? MASK : numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n))
export const fmtPct = (x: number | null | undefined, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%')
export const fmtSigned = (n: number) => (n >= 0 ? '+' : '−') + fmtMoney(Math.abs(n)).replace('−', '')
export const close = (a: number | null | undefined, b: number | null | undefined, tol = 0.02) => a != null && b != null && Math.abs(+a - +b) <= Math.max(1, Math.abs(+b) * tol)
