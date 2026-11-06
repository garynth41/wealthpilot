// Credit-score trend (0.24.0): scores typed from a bureau, a card issuer or a monitoring app — never a credit pull. Bands are the
// FICO ranges; VantageScore uses the same 300–850 scale with slightly different labels, close enough for a trend.
import type { CreditScore, Data } from '../app/data/types'
import { addDays, today } from './dates'

export const BANDS: Array<{ min: number; label: string; cls: 'good' | 'info' | 'warn' | 'crit' }> = [
  { min: 800, label: 'Exceptional', cls: 'good' }, { min: 740, label: 'Very good', cls: 'good' }, { min: 670, label: 'Good', cls: 'info' }, { min: 580, label: 'Fair', cls: 'warn' }, { min: 0, label: 'Poor', cls: 'crit' }]
export const band = (score: number) => BANDS.find(b => score >= b.min)!
export const people = (scores: CreditScore[]) => [...new Set(scores.map(s => s.person || 'Me'))].sort()

export interface PersonTrend { person: string; latest: CreditScore; previous: CreditScore | null; change: number | null; series: CreditScore[]; byBureau: Record<string, CreditScore[]>; stale: boolean; nextBand: { label: string; points: number } | null }
export function creditTrends(d: Pick<Data, 'scores'>, asOf = today()): PersonTrend[] {
  const all = (d.scores || []).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  return people(all).map(person => {
    const series = all.filter(s => (s.person || 'Me') === person); const latest = series[series.length - 1]
    // compare like with like: the previous score from the same bureau and model when there is one
    const same = series.filter(s => s !== latest && (s.bureau || '') === (latest.bureau || '') && (s.model || '') === (latest.model || ''))
    const previous = same[same.length - 1] || series[series.length - 2] || null
    const byBureau: Record<string, CreditScore[]> = {}; for (const s of series) (byBureau[s.bureau || 'Unspecified'] ||= []).push(s)
    const up = BANDS.slice().reverse().find(x => x.min > latest.score) || null
    return { person, latest, previous, change: previous ? latest.score - previous.score : null, series, byBureau, stale: latest.date < addDays(asOf, -90), nextBand: up ? { label: up.label, points: up.min - latest.score } : null }
  })
}
/** What moves a score, given this household's card utilization. */
export function creditTips(utilization: number | null): string[] {
  const out: string[] = []
  if (utilization != null) out.push(utilization > 0.3 ? `Card utilization is ${Math.round(utilization * 100)}% — getting it under 30% (under 10% is best) is the fastest lever` : utilization > 0.1 ? `Card utilization is ${Math.round(utilization * 100)}% — under 10% scores best` : `Card utilization is ${Math.round(utilization * 100)}% — that helps your score`)
  out.push('Payment history counts most: one 30-day late payment can cost 60–100 points, so keep autopay on at least the minimum')
  out.push('Paying the statement balance before the statement date lowers the utilization the bureaus see')
  out.push('Keep old cards open; hard inquiries fall away after two years')
  return out
}
