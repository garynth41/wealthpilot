/** "$5,000.50", "5,000", "28.99 %", "(120)", "−45" → number; blank or junk → null. */
export const parseNum = (str: unknown): number | null => {
  let s = String(str ?? '').trim().replace(/−|–/g, '-')
  if (!s) return null
  let neg = false
  const p = s.match(/^\((.*)\)$/); if (p) { s = p[1]; neg = true }
  s = s.replace(/[\s$€£,%]|US\$|USD/gi, '')
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1) }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null
  const n = Number(s); return isNaN(n) ? null : neg ? -n : n
}
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const sum = (a: Array<number | string | null | undefined>) => a.reduce<number>((x, y) => x + (+(y ?? 0) || 0), 0)
/** $1,234 (no cents) — for KPIs and charts. */
export const fmtMoney = (n: number | string | null | undefined) => { const v = +(n ?? 0) || 0; return (v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US') }
/** $1,234.56 — for ledgers. */
export const fm2 = (n: number | string | null | undefined) => { if (n == null || n === '' || isNaN(+n)) return '—'; const v = +n; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
export const fmtPct = (x: number | null | undefined, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%')
export const fmtSigned = (n: number) => (n >= 0 ? '+' : '−') + fmtMoney(Math.abs(n)).replace('−', '')
export const close = (a: number | null | undefined, b: number | null | undefined, tol = 0.02) => a != null && b != null && Math.abs(+a - +b) <= Math.max(1, Math.abs(+b) * tol)
