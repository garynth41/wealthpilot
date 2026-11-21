// AI categorizing (0.34.0): what Review uncategorized sends when the person presses "Ask AI", and how the reply is read.
// Only the merchants the app could not place itself go: each one's description as the bank wrote it (payments to people included — a
// person's name in a description is sent, and the screen says so before anything leaves), money out or in, and the amount; plus the
// household's category names (members' names taken out of those). No ids, account names, notes or dates. The reply is a list of
// suggestions — nothing is filed until the person accepts. Pure functions; the function side is supabase/functions/ask-cresari/core.ts.
import type { ReviewGroup } from './categorize'
import { MAX_ITEMS, MAX_CATS, MAX_DESC, scrub, type Pick as AiPick } from '../../supabase/functions/ask-cresari/core'

export interface AiBatch {
  /** what is sent (the household id is added by the caller) */
  body: { task: 'categorize'; items: Array<{ text: string; kind: 'expense' | 'income'; amount: number }>; categories: Array<{ name: string; kind: 'expense' | 'income' }> }
  /** the review group behind each item and the category behind each choice, by position — these never leave the device */
  groupIds: string[]; catIds: string[]
  /** merchants left for another press (more than fit in one) */
  more: number
}
export interface AiSuggestion { category_id: string; sure: boolean }
/** The groups the AI can be asked about: no answer from the app, and a description to go on. */
export const aiCandidates = (groups: ReviewGroup[]) => groups.filter(g => !g.category_id && g.txns.some(t => (t.payee || '').trim()))

/** Build one request: the largest merchants first (the list arrives sorted that way), at most MAX_ITEMS. */
export function aiBatch(groups: ReviewGroup[], cats: Array<{ id: string; label: string; kind: string }>, cleanName: (s: string) => string): AiBatch {
  const all = aiCandidates(groups), take = all.slice(0, MAX_ITEMS)
  const usable = cats.filter(c => c.kind === 'expense' || c.kind === 'income').slice(0, MAX_CATS)
  return {
    body: { task: 'categorize',
      items: take.map(g => ({ text: scrub(g.name).replace(/\s+/g, ' ').trim().slice(0, MAX_DESC), kind: g.kind, amount: Math.abs(g.txns[0]?.amount || 0) })),
      categories: usable.map(c => ({ name: cleanName(c.label), kind: c.kind as 'expense' | 'income' })) },
    groupIds: take.map(g => g.id), catIds: usable.map(c => c.id), more: all.length - take.length,
  }
}
/** The reply, as a suggestion per review group. Anything that does not point at something that was sent is ignored. */
export function aiApply(picks: unknown, batch: AiBatch): Record<string, AiSuggestion> {
  const out: Record<string, AiSuggestion> = {}
  for (const p of Array.isArray(picks) ? picks as AiPick[] : []) {
    const g = batch.groupIds[p?.item], c = batch.catIds[p?.category]
    if (!g || !c || out[g] || batch.body.items[p.item].kind !== batch.body.categories[p.category].kind) continue
    out[g] = { category_id: c, sure: p.sure === true }
  }
  return out
}
