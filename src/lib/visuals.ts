// Layout math for the SVG visuals (0.9.0): a squarified treemap and a calendar heat map of daily spending. Pure, unit-tested.
import type { Data } from '../app/data/types'
import { addDays, today } from './dates'
import { round2 } from './money'

export interface Rect { key: string; label: string; value: number; x: number; y: number; w: number; h: number }
/** Squarified treemap (Bruls, Huizing & van Wijk): rectangles whose areas are proportional to value, laid out to keep aspect ratios near 1. */
export function treemap(items: Array<{ key: string; label: string; value: number }>, W: number, H: number): Rect[] {
  const data = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value); const total = data.reduce((s, i) => s + i.value, 0); if (!total || W <= 0 || H <= 0) return []
  const scale = (W * H) / total; const out: Rect[] = []; let x = 0, y = 0, w = W, h = H; let row: typeof data = []
  const worst = (r: typeof data, side: number) => { const areas = r.map(i => i.value * scale); const s = areas.reduce((a, b) => a + b, 0); const mx = Math.max(...areas), mn = Math.min(...areas); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)) }
  const layout = (r: typeof data) => { const s = r.reduce((a, i) => a + i.value * scale, 0); if (w >= h) { const cw = s / h; let cy = y; for (const i of r) { const ch = (i.value * scale) / cw; out.push({ key: i.key, label: i.label, value: i.value, x, y: cy, w: cw, h: ch }); cy += ch } x += cw; w -= cw } else { const rh = s / w; let cx = x; for (const i of r) { const cw = (i.value * scale) / rh; out.push({ key: i.key, label: i.label, value: i.value, x: cx, y, w: cw, h: rh }); cx += cw } y += rh; h -= rh } }
  for (const it of data) { const side = Math.min(w, h); if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it); else { layout(row); row = [it] } }
  if (row.length) layout(row)
  return out.map(r => ({ ...r, x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) }))
}
export interface HeatCell { date: string; amount: number; week: number; dow: number; level: 0 | 1 | 2 | 3 | 4 }
/** Daily spending (expenses, non-void) for the last `weeks` weeks ending on the week of asOf; columns are Monday-start weeks, rows Mon..Sun. Levels are quartiles of the non-zero days. */
export function spendingHeatmap(d: Data, weeks = 26, asOf = today()): { cells: HeatCell[]; max: number; thresholds: number[]; total: number } {
  const dow0 = (s: string) => (new Date(s + 'T12:00').getDay() + 6) % 7   // Monday = 0
  const end = addDays(asOf, 6 - dow0(asOf)), start = addDays(end, -(weeks * 7) + 1)
  const by = new Map<string, number>(); for (const t of d.transactions) if (t.kind === 'expense' && t.status !== 'void' && t.date >= start && t.date <= asOf) by.set(t.date, (by.get(t.date) || 0) + t.amount)
  const nz = [...by.values()].filter(v => v > 0).sort((a, b) => a - b); const q = (p: number) => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * (nz.length - 1)))] : 0
  const thresholds = [q(0.25), q(0.5), q(0.75)]; const cells: HeatCell[] = []
  for (let i = 0; i < weeks * 7; i++) { const date = addDays(start, i); if (date > asOf) break; const amount = round2(by.get(date) || 0); const level = (amount <= 0 ? 0 : amount <= thresholds[0] ? 1 : amount <= thresholds[1] ? 2 : amount <= thresholds[2] ? 3 : 4) as HeatCell['level']; cells.push({ date, amount, week: Math.floor(i / 7), dow: i % 7, level }) }
  return { cells, max: nz.length ? nz[nz.length - 1] : 0, thresholds, total: round2([...by.values()].reduce((a, b) => a + b, 0)) }
}

/** True when no chart trace has a single non-zero number to draw — the chart would be empty axes (0.23.0). */
export function noData(data: ReadonlyArray<object>): boolean {
  const nums = (v: unknown): number[] => (Array.isArray(v) ? (v as unknown[]).flatMap(x => (Array.isArray(x) ? nums(x) : typeof x === 'number' && isFinite(x) ? [x] : [])) : [])
  return data.every(t => { const tr = t as Record<string, unknown>; const vals = [...nums(tr.y), ...(tr.orientation === 'h' ? nums(tr.x) : []), ...nums(tr.values), ...nums(tr.z)]; return vals.every(v => v === 0) })
}
