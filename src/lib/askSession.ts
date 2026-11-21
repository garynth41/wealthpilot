// Ask Cresari's conversation (0.32.0). Kept in memory while the app is open — closing the panel does not lose it — and never saved.
// It lives here, away from the panel, so that signing out can clear it even when the panel is not on screen, and so that a question that
// is still out is known to a panel that was closed and opened again.
import type { Turn } from '../../supabase/functions/ask-cresari/core'

let turns: Turn[] = []; let owner: string | null = null
// which conversation this is: a reply that comes back for an earlier one (started over, signed out, another household) is dropped
let epoch = 0
// the conversation that has a question out, if any — one question at a time
let pending: number | null = null
// a question that failed, with why — held until a panel is on screen to put it back in the box
let lost: { question: string; error: string } | null = null
// which sign-in this is: goes up every time the conversation is cleared by signing out
let signIn = 0
const subs = new Set<() => void>()
const poke = () => subs.forEach(f => { try { f() } catch { /* a listener that is gone */ } })

export const askSession = {
  turns: () => turns,
  busy: () => pending === epoch,
  /** Which sign-in this is. A reply asked for under an earlier one says nothing about the present one. */
  signIn: () => signIn,
  /** The panel says whose conversation it is showing; a different account or household starts a new one. */
  claim(key: string) { if (owner !== key) { turns = []; owner = key; epoch++; pending = null; lost = null } },
  /** Signing out. */
  reset() { turns = []; owner = null; epoch++; signIn++; pending = null; lost = null; poke() },
  /** Start over, same person. Returns whether there was anything to clear. */
  restart() { const had = turns.length > 0 || pending === epoch; turns = []; epoch++; pending = null; lost = null; poke(); return had },
  /** Put a question out. Returns its ticket, or null while another is still out. */
  begin(question: string): number | null { if (pending === epoch) return null; lost = null; turns = [...turns, { role: 'user', content: question }]; pending = epoch; poke(); return epoch },
  /** The reply for a ticket. False when it belongs to a conversation that is gone — nothing is changed then. */
  answer(ticket: number, text: string) { if (ticket !== epoch) return false; turns = [...turns, { role: 'assistant', content: text }]; pending = null; poke(); return true },
  /** The question for a ticket failed: it is taken back. False (and nothing changed) for a conversation that is gone. */
  fail(ticket: number, error = '') { if (ticket !== epoch) return false; let question = ''; if (turns.length && turns[turns.length - 1].role === 'user') { question = turns[turns.length - 1].content; turns = turns.slice(0, -1) } pending = null; lost = { question, error }; poke(); return true },
  /** The question that failed and why, once: the panel on screen puts it back in the box. */
  takeLost() { const l = lost; lost = null; return l },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
