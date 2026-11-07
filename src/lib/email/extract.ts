// One email → one money fact. Never invents a number: every amount and date comes from a labelled place in the email; only the last 4 digits of any account are kept.
import type { EmailKind } from '../../app/data/types'
import { iso } from '../dates'
import { cleanText, datesIn, dateAfter, moneyAfter, moneyIn, orgFromDomain, titleCase, type Msg } from './text'
import { maskDigits } from '../simplefin'

export type PayeeKind = 'card' | 'bnpl' | 'loc' | 'auto' | 'student' | 'collection' | 'loan' | 'insurance' | 'phone' | 'electric' | 'gasutil' | 'water' | 'internet' | 'school' | 'sub' | 'hsa' | 'benefit' | 'bank' | 'wallet' | 'rent' | 'other' | 'payroll' | 'refund' | 'deposit'
export const DEBT_KINDS = new Set<PayeeKind>(['card', 'bnpl', 'loc', 'auto', 'student', 'collection', 'loan'])
// [pattern on sender + subject + opening of the body, display name, kind] — extend freely; order matters (first hit wins)
export const PAYEES: Array<[RegExp, string, PayeeKind]> = [
  [/missionlane|mission lane/i, 'Mission Lane', 'card'], [/\bindigo\b/i, 'Indigo', 'card'], [/milestone/i, 'Milestone', 'card'], [/americanexpress|american express|\bamex\b/i, 'American Express', 'card'],
  [/\bollo\b|merrick/i, 'Ollo', 'card'], [/brightway|onemain/i, 'BrightWay', 'card'], [/capitalone|capital one/i, 'Capital One', 'card'], [/discover\.com|discover card/i, 'Discover', 'card'], [/chase\.com|\bchase\b/i, 'Chase', 'card'], [/synchrony/i, 'Synchrony', 'card'], [/credit ?one/i, 'Credit One', 'card'], [/citi(?:bank|cards)?\b/i, 'Citi', 'card'], [/wells ?fargo/i, 'Wells Fargo', 'bank'], [/us ?bank/i, 'U.S. Bank', 'bank'],
  [/koalafi/i, 'Koalafi', 'bnpl'], [/affirm/i, 'Affirm', 'bnpl'], [/klarna/i, 'Klarna', 'bnpl'], [/afterpay/i, 'Afterpay', 'bnpl'], [/sezzle/i, 'Sezzle', 'bnpl'], [/\bzip\.co|quadpay/i, 'Zip', 'bnpl'],
  [/getflex|flex rent/i, 'Flex Rent', 'loc'], [/global lending|glsllc|glblndsvcs/i, 'Global Lending Services', 'auto'], [/nelnet|mohela|aidvantage|edfinancial|navient|student ?loan/i, 'Student loan', 'student'],
  [/ncbi(?:messages)?\.com|ncb management/i, 'NCB Management (collections)', 'collection'], [/rise ?credit|finwise/i, 'RISE / Finwise', 'loan'], [/sofi/i, 'SoFi', 'loan'], [/upstart/i, 'Upstart', 'loan'], [/lending ?club/i, 'LendingClub', 'loan'],
  [/geico/i, 'GEICO', 'insurance'], [/progressive/i, 'Progressive', 'insurance'], [/state ?farm/i, 'State Farm', 'insurance'], [/allstate/i, 'Allstate', 'insurance'], [/nationwide/i, 'Nationwide', 'insurance'],
  [/\bat&t\b|att-mail|att\.com|myat&t/i, 'AT&T', 'phone'], [/verizon/i, 'Verizon', 'phone'], [/t-mobile/i, 'T-Mobile', 'phone'], [/mint mobile/i, 'Mint Mobile', 'phone'],
  [/\baep\b|aep-email|ohio-aep|ohio power/i, 'AEP Ohio', 'electric'], [/duke energy/i, 'Duke Energy', 'electric'], [/columbia gas|columbiagas/i, 'Columbia Gas', 'gasutil'], [/buckeye utility/i, 'Buckeye Utility Billing', 'water'], [/city of columbus|del-?co water/i, 'Water / sewer', 'water'],
  [/spectrum/i, 'Spectrum', 'internet'], [/xfinity|comcast/i, 'Xfinity', 'internet'], [/breezeline|wow!?\s*internet/i, 'Internet provider', 'internet'],
  [/marburn|veracross/i, 'Marburn Academy', 'school'],
  [/anthropic/i, 'Anthropic', 'sub'], [/openai|chatgpt/i, 'OpenAI', 'sub'], [/disney/i, 'Disney+', 'sub'], [/hulu/i, 'Hulu', 'sub'], [/netflix/i, 'Netflix', 'sub'], [/spotify/i, 'Spotify', 'sub'], [/google one|google ai pro/i, 'Google One', 'sub'], [/amazon prime|primevideo/i, 'Amazon Prime', 'sub'], [/apple\.com\/bill|itunes|apple\.com/i, 'Apple', 'sub'], [/google cloud|cloudplatform/i, 'Google Cloud', 'sub'], [/youtube/i, 'YouTube', 'sub'], [/peacock/i, 'Peacock', 'sub'], [/paramount/i, 'Paramount+', 'sub'], [/planet fitness/i, 'Planet Fitness', 'sub'],
  [/healthequity/i, 'HealthEquity', 'hsa'], [/odjfs|jfs\.ohio|ohio means jobs/i, 'Ohio unemployment (ODJFS)', 'benefit'], [/ssa\.gov|social security/i, 'Social Security', 'benefit'],
  [/bankofamerica|bank of america/i, 'Bank of America', 'bank'], [/huntington/i, 'Huntington', 'bank'], [/chime/i, 'Chime', 'bank'], [/\bally\b/i, 'Ally', 'bank'], [/\bpaypal\b/i, 'PayPal', 'wallet'], [/venmo/i, 'Venmo', 'wallet'], [/cash ?app|square cash/i, 'Cash App', 'wallet'], [/zelle/i, 'Zelle', 'wallet'],
]
const PROCESSOR = /billmatrix|invoicecloud|paymentus|doxo|googleplay|play\.google|stripe|paddle|squareup|shopify|veracross|e-?receipt|ereceipt|kubra|speedpay|autopay\.com/i
export interface Payee { name: string; kind: PayeeKind; merchant: string }
export function payeeOf(m: Msg, txt: { subject: string; body: string }): Payee {
  const from = m.from.email || '', name = m.from.name || ''
  const look = (s: string) => { for (const [re, n, k] of PAYEES) if (re.test(s)) return { name: n, kind: k }; return null }
  const proc = PROCESSOR.test(from); let named: string | null = null; const s = txt.subject + ' ' + txt.body.slice(0, 1200)
  const pats = [/(?:payment (?:processed|reminder|confirmation)|scheduled payment processed|recurring payment (?:processed|reminder)) for ([A-Z][\w&.'+ -]{2,40}?)(?:\s*$|\s+(?:customer|account|invoice|\d))/i, /subscription from ([A-Z][\w&.'+ -]{1,30}?) on google play/i, /declined for ([A-Z][\w&.'+ -]{1,30}?) subscription/i, /thank(?:s| you) for (?:shopping|your order) with us!?\s+([A-Z][\w&.'+ -]{2,30}?)(?:\s{1,3}view|\s+receipt|$)/i, /your payment to ([A-Z][\w&.'+ -]{2,40}?)(?:\.|,|\s+(?:another|was|has|for))/i, /^([A-Z][\w&.'+ -]{2,40}?) - (?:autopay|payment|invoice)/i, /invoice from ([A-Z][\w&.'+ -]{2,40}?)[!.]/i]
  for (const re of pats) { const x = s.match(re); if (x) { named = x[1].trim(); break } }
  const merchant = (s.match(/(?:details for|order from|merchant|payment for)\s+([A-Z][A-Z0-9&.' ]{2,30}?)(?=\s+(?:payment|was|have|successful|merchant|order)\b)/) || [])[1] || ''
  let hit: { name: string; kind: PayeeKind } | null = null
  if (!proc) hit = look(from + ' ' + name) || look(txt.subject)
  if (!hit && named) hit = look(named) || { name: named.replace(/\s+(inc|llc|corp)\.?$/i, ''), kind: 'other' }
  if (!hit) hit = look(txt.subject + ' ' + txt.body.slice(0, 600)) || { name: orgFromDomain(from) || name || 'Unknown', kind: 'other' }
  // 0.25.1: a payee or merchant taken from the text never keeps a full account number ("Acme Water account 4400123456" → "…account ••3456")
  return { ...hit, name: maskDigits(hit.name), merchant: merchant && !/^(the|your|this)\b/i.test(merchant) ? maskDigits(titleCase(merchant.toLowerCase())) : '' }
}
/** Last 4 digits only. TO = the bill / card; FROM = the bank account or card paying it. */
export function last4Of(t: string) {
  const re = /(?:ending(?:\s+in)?|ending:|ends in|last 4(?: digits)?(?: of [\w ]{0,24}?)?:?|acc(?:oun)?t\.?(?:\s*(?:#|no\.?|number))?\s*(?:ending(?: in)?)?|card(?:\s*(?:#|no\.?|number))?|lease number|original creditor acct#?|account \(|mastercard|visa|discover)\s*:?\s*(?:in\s*)?[#:(]?\s*(?:[x*•.…]+\s*|\.{2,}\s*|-\s*)?(\d[\d-]{2,18}\d)\b/gi
  const to: string[] = [], from: string[] = []; let m: RegExpExecArray | null
  while ((m = re.exec(t))) { const digits = m[1].replace(/-/g, ''); if (digits.length < 4) continue; const pre = t.slice(Math.max(0, m.index - 50), m.index).toLowerCase(), last = digits.slice(-4)
    if (/(from|funded|bank account|payment method|paid with|with -|debit|checking|savings|payment account|bank name|withdrawn|come out of|out of your|charged to)\W*(?:\w+\W+){0,4}$/.test(pre) || /^(mastercard|visa|discover)/i.test(m[0])) from.push(last); else to.push(last) }
  return { to: to[0] || '', from: from[0] || '' }
}
const KINDS: Array<[EmailKind | 'summary', number, RegExp]> = [
  ['summary', 3, /orders and payments summary|(?:monthly|weekly|year[- ]end) (?:spending )?summary of your orders|year in review/i],
  ['declined', 3, /payment (?:was |has been )?(?:declined|failed|returned|unsuccessful|reversed|rejected)|transaction was declined|payment declined|(?:payment|transaction)s? (?:could not|couldn't) be (?:processed|completed)|\bpaynsf\b|declined for insufficient|returned (?:payment|item)|nsf (?:fee|notice)/i],
  ['alert', 3, /insufficient funds|overdraft|negative balance|overdrawn|low balance alert|balance is below/i],
  ['pastdue', 3, /(?:amount|payment|balance|account)\s+(?:is\s+|was\s+)?past[- ]due|past[- ]due (?:amount|balance)|amount past due|you (?:have|’ve|'ve) (?:an amount )?past due|missed (?:a |your |one )?payment|payment is (?:now )?overdue|is past due|are past due|late payment notice/i],
  ['income', 3, /direct deposit|deposit (?:was |has been )?(?:credited|posted|made|received)|(?:was|were) credited to your account|has been deposited|money (?:is |was )?(?:on (?:its|the) way|sent to you)|sent you \$|you (?:got|received) (?:money|a payment of|\$)|payment (?:has been )?issued to you|(?:benefit|unemployment|ui) payment (?:has been |was )?(?:issued|sent|deposited)|payment has been issued|refund (?:has been |was )?(?:issued|processed|sent|approved)|tax refund|incoming (?:transfer|wire)|your pay(?:check|stub) is (?:ready|available)/i],
  ['paid', 3, /(?:payment|autopay payment|recurring payment|scheduled payment)\b[^.!?]{0,40}\b(?:processed|posted|received|successful|completed?|confirmed)|thanks?(?: you)? for (?:your|the) payment|we(?:'ve| have|’ve)? (?:received|processed) your (?:\$[\d,.]+ |auto ?pay )?payment|payment confirmation|you(?:'ve| have|’ve)? made a payment|payment (?:was )?successful|payment received|was successfully processed|your receipt from|order receipt|subscription (?:from [\w+ ]+ )?(?:on google play )?has renewed|amount paid|paid on [a-z]{3}/i],
  ['scheduled', 3, /auto ?pay(?:ment)? (?:payment )?(?:reminder|is set|is scheduled|will be)|upcoming (?:auto ?pay|automatic payment|recurring payment|payment)|automatic payment is coming up|reminder of an upcoming|recurring payment reminder|(?:will|'ll) be (?:charged|processed|withdrawn|debited|drafted|made|paid via autopay)|scheduled (?:payment|to be paid)|payment (?:is |has been )?scheduled|you(?:'ll| will) pay \$|new scheduled payment amount|scheduled payment amount/i],
  ['bill', 3, /statement (?:is )?(?:now )?(?:ready|available|here)|(?:your )?(?:online )?(?:[\w&]+ )?(?:wireless |electric |gas |water )?bill is (?:ready|available|now available|due)|new (?:bill|invoice|statement)|e-?bill|invoice (?:notification|is ready)|you have a new invoice|statement amount|bill total|amount due|balance due|minimum payment(?: due)?|new balance|payment (?:is )?due|is due on|due date is approaching|bill is due/i],
  ['balance', 2, /account snapshot|balance (?:update|alert|summary)|weekly (?:account )?(?:summary|snapshot)/i],
]
const ORDER: Array<EmailKind | 'summary'> = ['summary', 'declined', 'alert', 'pastdue', 'income', 'paid', 'scheduled', 'bill', 'balance']
const PROMO = /this is a promotional|promotional email|pre-?qualif|approval odds|apply (?:now|today)|bonus miles|could save|see if you|limited time|offer ends|earn up to|up to \$[\d,]+ (?:in|from|bonus)|grant|refinanc|check (?:out )?your (?:credit )?score|credit (?:score|usage|report) (?:is|has|may)|fico|vantage ?score|credit karma|creditwise|rewards? points|cash back offer|sweepstakes|webinar/i
const ANCHOR = /is due on|payment is due|statement balance|minimum payment|payment (?:amount|date|due)|amount due|amount past due|direct deposit|recurring payment|autopay|payment (?:received|processed|confirmation)|thank(?:s| you) for your payment|bill total|balance due|receipt #|amount paid/i
const FUTURE = /\bwill\b|\bsoon\b|upcoming|coming up|reminder|\bscheduled for\b|\bin \d+ days\b/i
export function kindOf(txt: { subject: string; body: string }): EmailKind | 'summary' | null {
  const sc: Partial<Record<string, number>> = {}
  const body = txt.body.slice(0, 1600).split(/(?<=[.!?])\s+/).filter(x => !/\bif (?:you(?:'ve| have|’ve)? )?(?:already )?(?:made|paid|submitted|sent|scheduled)|if your (?:payment|minimum)|to avoid (?:a )?(?:late|past)|payments received after/i.test(x)).join(' ')
  const past = (s: string) => s.split(/(?<=[.!?])\s+/).filter(x => !FUTURE.test(x)).join(' ')
  for (const [k, w, re] of KINDS) { const sub = k === 'paid' || k === 'income' ? past(txt.subject) : txt.subject, bod = k === 'paid' || k === 'income' ? past(body) : body; if (re.test(sub)) sc[k] = (sc[k] || 0) + w * 3; if (re.test(bod)) sc[k] = (sc[k] || 0) + w }
  const ks = Object.keys(sc); if (!ks.length) return null
  const best = Math.max(...ks.map(k => sc[k]!)); return ORDER.find(k => sc[k] === best) || null
}
export interface Fact {
  kind: EmailKind; payee: string; ptype: PayeeKind; merchant: string; last4: string; fromLast4: string
  amount: number | null; minDue: number | null; stmtBal: number | null; balance: number | null; fee: number | null; pastDue: number | null
  dueDate: string | null; txnDate: string | null; stmtDate: string | null; nextAmt: number | null; nextDate: string | null
  autopay: boolean; receipt?: boolean; payer?: string; bank?: string; conf: 'high' | 'medium' | 'low'
  msgId: string; date: string; subject: string; from: string
}
export interface Skip { skip: string; payee?: string; kind?: string; subject: string; msgId: string; date: string }
export function extract(m: Msg): Fact | Skip | null {
  const txt = cleanText(m); const t = txt.subject + ' . ' + txt.body; const ref = iso(m.date || new Date()); const from = m.from.email || ''
  if (m.sent) return null
  if (/(newsletter|substack|beehiiv|medium\.com|news\.|digest|tldr|marketing|offers?@|promo|loyalty|credit-card-offers)/i.test(from)) return { skip: 'Newsletter or offer', subject: m.subject, msgId: m.id, date: ref }
  const kind = kindOf(txt); if (!kind) return null
  if (PROMO.test(t) && !ANCHOR.test(t)) return { skip: 'Promotion or credit-score email', subject: m.subject, msgId: m.id, date: ref }
  if (kind === 'summary') return { skip: 'Monthly summary — the individual payments are read from their own emails', subject: m.subject, msgId: m.id, date: ref }
  const tv = t.split(/(?<=[.!?])\s+/).filter(x => !/^\(?if\b/i.test(x)).join(' ')
  const money = moneyIn(tv), dates = datesIn(tv, ref)
  const A = (re: RegExp | RegExp[], g?: number) => { for (const r of ([] as RegExp[]).concat(re)) { const x = moneyAfter(tv, r, g, money); if (x) return x } return null }
  const D = (re: RegExp | RegExp[], g?: number) => { for (const r of ([] as RegExp[]).concat(re)) { const x = dateAfter(tv, r, ref, g, dates); if (x) return x } return null }
  const p = payeeOf(m, txt), acct = last4Of(t)
  const f: Fact = { kind, payee: p.name, ptype: p.kind, merchant: p.merchant, last4: acct.to, fromLast4: acct.from, amount: null, minDue: null, stmtBal: null, balance: null, fee: null, pastDue: null, dueDate: null, txnDate: null, stmtDate: null, nextAmt: null, nextDate: null,
    autopay: /\bauto ?pay\b|automatic payment|recurring payment|enrolled in (?:our )?auto|automatically (?:be )?(?:charged|paid|debited|drafted|deducted)|(?:charged|paid|debited) automatically/i.test(t) && !/not (?:enrolled|set up) (?:in|for) auto ?pay|turn on auto ?pay|set up auto ?pay|sign up for auto ?pay|enroll in auto ?pay|ability to sign up for recurring/i.test(t),
    conf: 'low', msgId: m.id, date: ref, subject: m.subject || '', from }
  const v = (x: { v: number } | null) => (x ? Math.abs(x.v) : null)
  f.minDue = v(A(/minimum (?:payment )?(?:amount )?(?:due)?:?|min(?:imum)?\.? (?:payment )?due:?/gi, 30))
  f.stmtBal = v(A(/statement (?:balance|amount):?|new balance:?|bill total:?|total (?:amount |payment )?due:?|balance due:?|total balance due:?/gi, 30))
  f.balance = (() => { const x = A(/total balance:?|current balance:?|balance remaining:?|remaining balance:?|balance after (?:transaction\(?s?\)? )?(?:and fees)?:?|(?<!statement |past due |new )balance:/gi, 30); return x ? x.v : null })()
  f.fee = v(A(/(?<!and |of up to |change )\b(?:processing |convenience |overdraft |nsf |late |service |split |transaction )?fee(?:s charged)?\s*:?\s*(?=-?\s?(?:US)?\$)/gi, 4))
  if (kind === 'pastdue') f.pastDue = v(A([/amount past due:?|past[- ]due (?:amount|balance):?/gi, /your payment of/gi], 25))
  f.dueDate = D(/(?:payment )?due(?: date)?:?|due (?:on|by)|pay(?:ment)? by|fix by|final payment is due on|is due on/gi, 26)
  f.stmtDate = D(/statement (?:date|closing date):?|closing date:?|statement period:?[^.]{0,40}? to/gi, 30)
  f.txnDate = D([/(?:payment|deposit|charge|purchase)(?: of)? (?:US)?\$[\d,]+(?:\.\d{2})? (?:was |has been |is )?(?:\w+ )?on|scheduled payment date:?|payment date(?: \(utc\))?:?|auto ?pay date:?|scheduled date:?|processed on:?|paid on|posted to your[^.]{0,70}? on|(?:will be|be) (?:charged|processed|made|withdrawn|paid via auto ?pay) on|(?:process|processed) your (?:automatic |auto ?pay )?payment on|coming up on|deposit date:?|order date:?|transaction date:?/gi, /(?:processed|posted|paid|charged|made|withdrawn|credited|scheduled|set) (?:on|for)|^on|\. on|\bdate:?/gim], 28)
  const nx = t.match(/next payment of (\$[\d,]+(?:\.\d{2})?) will be (?:charged|due|processed) on ([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i); if (nx) { f.nextAmt = moneyIn(nx[1])[0]?.v ?? null; const d = datesIn(nx[2], ref)[0]; f.nextDate = d ? d.date : null }
  const anyAmt = () => { const vals = [...new Set(money.filter(x => x.v > 0).map(x => x.v))]; return vals.length === 1 ? vals[0] : null }
  if (kind === 'paid') { const x = A([/amount paid:?|payment amount:?|in the amount of|recurring payment of|payment received:?|received your|payment of/gi, /(?<!sub)\btotal(?! excluding)(?: amount)?:?|amount:|\bpaid:?|charged:?/gi, /\bamount\b(?! due)/gi], 30); f.amount = v(x) ?? anyAmt(); f.txnDate = f.txnDate && f.txnDate <= ref ? f.txnDate : ref
    // the next due date may come from the email; the next amount only when the email states one (0.25.1: the remaining balance is not a minimum payment)
    if (f.balance != null && f.balance > 0 && f.dueDate && f.dueDate > ref) { f.nextDate = f.nextDate || f.dueDate }
    if (/receipt|subscription|order/i.test(t) && !DEBT_KINDS.has(p.kind)) f.receipt = true }
  else if (kind === 'income') { const x = A([/deposit(?:ed)? (?:amount|of):?|amount:?|payment of|refund of|sent you|you received|net pay:?|take[- ]home:?/gi, /credited/gi], 40); f.amount = v(x) ?? anyAmt(); f.txnDate = D(/\bdate:?|on/gi, 4) || f.txnDate || ref; if (f.txnDate > ref) f.txnDate = ref
    const payer = (t.match(/\bFrom:?\s+([A-Z0-9][A-Za-z0-9&.,' -]{2,40}?)(?=\s+(?:VIEW|View|view|Details|details|to|on|for|was|has|Date|date|Amount|amount|Account|account|Memo|Description|Reference|Type|Status|We|Thank)\b|\s*$|\.)/) || [])[1] || ''
    if (payer) { f.payer = maskDigits(titleCase(payer.trim().toLowerCase())); f.bank = p.name; f.payee = f.payer; f.ptype = /payroll|salary|wages|paycheck/i.test(f.payer) ? 'payroll' : /odjfs|unemploy|state of ohio|ohio jfs|ssa|social security/i.test(f.payer) ? 'benefit' : /irs|treas|tax ref/i.test(f.payer) ? 'refund' : 'deposit' } }
  else if (kind === 'scheduled') { const x = A([/total amount:?/gi, /payment amount:?|amount due:?|auto ?pay payment of|recurring payment of|scheduled payment amount is|you(?:'ll| will) pay|payment of/gi, /\bamount:?/gi], 30); f.amount = v(x) ?? f.stmtBal ?? anyAmt(); f.txnDate = f.txnDate || D(/(?:on|for)\b/gi, 6) }
  else if (kind === 'bill' || kind === 'balance') { const x = A(/your payment of|payment due:?|total payment due:?|amount due:?|statement amount:?|bill total:?/gi, 30); f.amount = f.stmtBal != null ? f.stmtBal : (v(x) ?? f.minDue); if (f.stmtBal == null && x) f.stmtBal = v(x)
    if (kind === 'balance') { const pd = A(/payment due:?/gi, 20); if (pd) f.minDue = v(pd) } }
  else if (kind === 'pastdue') { f.amount = f.pastDue ?? v(A(/payment of|amount due:?|balance due:?/gi, 25)) }
  else if (kind === 'declined') { f.amount = v(A(/amount due:?|payment of|payment amount:?|amount:?/gi, 30)); f.balance = f.balance ?? v(A(/balance due:?|balance:?/gi, 20)); f.txnDate = f.txnDate || ref }
  else if (kind === 'alert') { f.amount = f.fee; f.txnDate = D(/^on|\bon\b/gim, 4) || ref }
  const has = f.amount != null || f.stmtBal != null || f.minDue != null || f.pastDue != null || f.balance != null
  if (!has && !['pastdue', 'declined', 'alert'].includes(kind) && !(kind === 'bill' && f.dueDate) && !(kind === 'scheduled' && f.txnDate && DEBT_KINDS.has(p.kind))) return { skip: 'No amount in the email', payee: p.name, kind, subject: m.subject || '', msgId: m.id, date: ref }
  if (p.kind === 'benefit' && !has) return { skip: 'Notice without an amount', payee: p.name, kind, subject: m.subject || '', msgId: m.id, date: ref }
  f.conf = (f.amount != null || f.stmtBal != null) && p.kind !== 'other' ? 'high' : (f.amount != null || f.stmtBal != null || f.dueDate) ? 'medium' : 'low'
  return f
}
export const isSkip = (x: Fact | Skip | null): x is Skip => !!x && 'skip' in x
/** One masking rule for everything the app stores (0.25.1): any run of 5 or more digits (spaces or dashes allowed inside) keeps only its last
 *  four. Shared with the bank feed (lib/simplefin.ts, which the bank-sync function carries a copy of). */
export { maskDigits }
export const when = (f: Fact) => f.txnDate || f.dueDate || f.stmtDate || f.date
export const eventDate = (f: Fact) => (f.kind === 'bill' || f.kind === 'balance' ? f.stmtDate || f.date : f.kind === 'scheduled' ? f.date : f.txnDate || f.date)
