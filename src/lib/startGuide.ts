// Start here (0.29.0): setting up Cresari from nothing, step by step — accounts, balances, income, bills, spending, categories, the budget,
// savings, debts, alerts, a weekly routine and the household. Shown on /start (pages/Start.tsx). Each step names the page, the buttons and
// the fields exactly as they appear, and ticks itself off from the household's own data the same way the Dashboard's checklist does
// (lib/onboarding.ts) — nothing to mark by hand. Steps without a check (the weekly routine) say so.
import type { Data, Settings } from '../app/data/types'
import { LIABILITY_KINDS } from '../app/data/types'
import { setupSteps } from './onboarding'

export interface StartStep {
  key: string; phase: string; title: string; minutes: number; why: string
  /** What to have at hand before starting this step. */
  need?: string
  steps: string[]; tips?: string[]
  to: string; toLabel: string
  /** Not needed to finish setting up. */
  optional?: boolean
}
export interface StepState { done: boolean | null; detail: string }

export const GATHER: string[] = [
  'Every account you have — checking, savings, credit cards, loans, investments — and today\'s balance for each (your bank\'s app shows it).',
  'Your latest pay stub: your take-home pay, how often you are paid, and a recent payday.',
  'Your bills: rent or mortgage, utilities, phone, insurance, subscriptions. The last two months of your bank statement list them all.',
  'For each card or loan: the statement balance, minimum payment, due date and interest rate (APR).',
  'One or two things you are saving for, and roughly what you can put aside each month.',
]

export const START_STEPS: StartStep[] = [
  { key: 'accounts', phase: 'Your starting point', title: 'Add your accounts', minutes: 10, to: '/accounts', toLabel: 'Open Account Balances',
    why: 'Every other number — cash on hand, what you owe, net worth, the forecast — starts from your accounts.',
    need: 'the list of your accounts and today\'s balances',
    steps: ['Open Account Balances.', 'Add each bank account with + Checking, + Savings, + Investment, + Retirement or + Cash, and give it the name you know it by.',
      'Add every credit card and loan under Credit cards & loans: copy the statement balance, minimum payment, due date and APR from the latest statement.',
      'Optional: add your home or car under Property & vehicles with today\'s estimate, and link its mortgage or loan to see your equity.'],
    tips: ['Use the account\'s last four digits in its name ("Chase Checking 4019") so you can tell them apart; the app never asks for full account numbers.', 'An account that is not your money — a child\'s, or one you hold for someone — can stay listed but out of your figures: untick In my figures beside it.'] },
  { key: 'balances', phase: 'Your starting point', title: 'Enter today\'s balances', minutes: 5, to: '/accounts', toLabel: 'Open Account Balances',
    why: 'The forecast and Safe to spend count forward from today\'s balance, so a stale one throws every projection off.',
    steps: ['On Account Balances, click each account\'s Balance cell and type today\'s balance from your bank.', 'Tick Counts as cash for the accounts you spend from (usually checking and savings), so Safe to spend and the low-cash alert use them.'],
    tips: ['Connect the bank feed (step 6) and balances keep themselves current from then on.'] },
  { key: 'income', phase: 'Money in and out', title: 'Add your income and pay schedule', minutes: 5, to: '/income', toLabel: 'Open Income & Pay Periods',
    why: 'Paydays drive the cash calendar, Safe to spend, and a budget that runs pay period to pay period.',
    need: 'your latest pay stub',
    steps: ['Open Income & Pay Periods and click + Add income source.', 'Fill in the row: Name, Payer / employer, Paid (how often), A known pay date (a recent pay stub date is ideal) and Take-home.',
      'Pick Deposited to — the account the money lands in — and the Income category it counts under.', 'Add Gross if you know it, so the tax planner uses your pay before tax.', 'Repeat for every other income: a second job, benefits, child support, side work.'],
    tips: ['Paid twice a month on set days? Choose Twice a month under Paid.', 'When a paycheck lands, Allocate… beside it shows what it has to cover until the next one.'] },
  { key: 'bills', phase: 'Money in and out', title: 'List your bills and subscriptions', minutes: 15, to: '/bills', toLabel: 'Open Bills & Subscriptions',
    why: 'So nothing due is a surprise: bills feed the forecast, Needs attention, the budget and the reminders.',
    need: 'the last two months of your bank statement',
    steps: ['Open Bills & Subscriptions and click + Add under Recurring items for each bill.', 'Fill in Name, Payee (as it shows on your bank statement), Kind, Amount, Every, Day and Next due.',
      'Pick the From account it is paid from and the Budget line it counts against, and tick Autopay for anything the company takes by itself.',
      'For a card or loan payment, set Kind to Card / loan payment and Pays to that card or loan, so Mark paid lowers what you owe. For a regular savings transfer, set Pays to the savings account.'],
    tips: ['Go down two months of your bank statement line by line — subscriptions hide there.', 'A bill whose amount changes (electric, water): tick Varies and use a typical amount.', 'Rent split with someone, or paid in two halves? Add each half as its own bill on its own day.'] },
  { key: 'transactions', phase: 'Money in and out', title: 'Bring in your spending', minutes: 10, to: '/connections', toLabel: 'Open Cash & Account Operations',
    why: 'Your actual spending fills in the budget, the trends and the insights. Pick whichever way suits you — or combine them.',
    steps: ['Automatic: on Cash & Account Operations, connect your banks under Automatic bank sync (SimpleFIN) — subscribe at bridge.simplefin.org, link your banks, copy the setup token, paste it and click Connect, then choose where each bank account Goes into and click Save matching & sync now.',
      'From a file: download your account activity as CSV, Excel, OFX or QFX from your bank\'s website and add it under Import a statement.',
      'From your inbox: on Email Money Capture, connect Gmail or Outlook so bills, payments and deposits are filed from their emails.',
      'By hand: on Transactions, + Add transaction (or press N) for each purchase.'],
    tips: ['Bank sync is the least work after setup; SimpleFIN is a small yearly subscription you pay them directly.', 'Moving from Mint, YNAB, Quicken or Monarch? Use Move from … on Cash & Account Operations with one export file.', 'The same purchase arriving twice (bank feed and email) is merged automatically; anything unsure waits for you under Review.'] },
  { key: 'categorize', phase: 'Money in and out', title: 'Sort your spending into categories', minutes: 10, to: '/transactions', toLabel: 'Open Transactions',
    why: 'Uncategorized spending counts against no budget line, so the budget only tells the truth once spending is sorted.',
    steps: ['On Transactions, click Auto-categorize at the top to fill in what your history can.', 'Click Uncategorized under Type and give each remaining one a category.',
      'For anything that repeats, make a payee rule: Settings → Payee rules → + Add rule, type part of the merchant name, choose Set category, and click Apply to N transactions.'],
    tips: ['A receipt that covers several things (groceries and household goods) can be split across categories.', 'The categories are yours to change under Settings → Categories: rename, add, archive, and set each one\'s group and priority.'] },
  { key: 'budget', phase: 'Your plan', title: 'Build your budget', minutes: 15, to: '/budget', toLabel: 'Open Budget',
    why: 'A plan for the period: what is coming in, what has to go out, and what is left to save or spend.',
    steps: ['Choose how you slice time — calendar month, pay period, every two weeks — in Settings → General → Budget cadence, then Save settings.',
      'Give each category a default budget in Settings → Categories, so every new period starts filled in.',
      'Open Budget and click Start with the period\'s name.', 'Pick Standard, Zero-based or Envelopes at the top, then type a planned amount on each line under Spending plan.',
      'Plan the essentials first — housing, utilities, food, transport, insurance, minimum debt payments — then savings, then everything else.'],
    tips: ['Zero-based gives every dollar a job: plan until the bar says Every dollar has a job.', 'Savings transfers and loan payments get a budget line too; a credit card is budgeted by what you buy with it, not by the payment.', 'Yearly bills (car registration, insurance) are easiest as a monthly sinking-fund line.'] },
  { key: 'goal', phase: 'Your plan', title: 'Start saving: your emergency fund first', minutes: 5, to: '/goals', toLabel: 'Open Savings Goals',
    why: 'Three to six months of essential spending, set aside, keeps a car repair or a missed paycheck from becoming debt.',
    steps: ['Open Savings Goals and click + Add goal on the All goals card.', 'Set Kind to Emergency fund, type the Target and the By date, and pick the savings account in Saved in.',
      'Type what is already saved in Starting amount and what you will add each month in Per month.', 'Each time you put money aside, click + Contribute on the goal (keep "also log the transfer" ticked).',
      'Add your next goals the same way: a car, a holiday, a down payment.'],
    tips: ['Make the monthly amount automatic: add it as a bill with Pays set to the savings account, on the day after payday.', 'What if… on a goal shows how a bigger monthly amount or a lump sum moves the date.'] },
  { key: 'debts', phase: 'Your plan', title: 'Plan your debt payoff', minutes: 5, to: '/debts', toLabel: 'Open Debt Payoff',
    why: 'See the date you are debt-free and how much sooner a little extra each month gets you there.',
    steps: ['Make sure every card and loan is on Account Balances with its balance, APR, minimum payment and due date (step 1).', 'Give each a Planned payment — at least the minimum — so the payoff date uses what you really pay.',
      'On Debt Payoff, pick Avalanche (highest interest first — least interest) or Snowball (smallest balance first — quickest wins) under Payoff strategy.', 'Drag the extra-payment slider to see how much sooner you are debt-free and how much interest you save.'],
    tips: ['A 0% promotion? Add the Promo APR % and Promo ends date so the page warns you if it will not be paid off in time.', 'No debts? This step ticks itself off.'], optional: true },
  { key: 'alerts', phase: 'Keep it running', title: 'Turn on alerts and add the app to your phone', minutes: 5, to: '/settings', toLabel: 'Open Settings',
    why: 'Bills due, low cash, large charges and a Monday summary reach you even when the app is closed.',
    steps: ['Add Cresari to your phone\'s home screen — Install the app, at the top of this page, shows the steps for your phone.', 'Open Settings → Notifications and click Enable on this device on each phone or computer, then allow notifications.',
      'Tick Email me if you also want them by email, choose what to be alerted about under What to alert on, then click Send a test.'],
    tips: ['On iPhone, alerts work only from the home-screen app, not from a Safari tab.'], optional: true },
  { key: 'routine', phase: 'Keep it running', title: 'Your 10-minute weekly check-in', minutes: 10, to: '/', toLabel: 'Open the Dashboard',
    why: 'A few minutes a week keeps every number true, so the app keeps telling you the truth.',
    steps: ['Weekly: open the Dashboard and clear Needs attention — red first, then amber.', 'Sort any new spending on Transactions (Uncategorized under Type), and click Mark paid on bills you paid by hand.',
      'Look at Budget: which lines are close to their plan for the rest of the period?',
      'Monthly: reconcile each bank account against its statement (Checkbook Reconciliation), start the next budget, and read the month\'s report on Reports.'],
    tips: ['Pick the same time every week — Sunday evening or the morning after payday works well.'], optional: true },
  { key: 'household', phase: 'Keep it running', title: 'Invite your household', minutes: 3, to: '/settings', toLabel: 'Open Settings',
    why: 'Share the budget with a partner — with full access, read-only, or only the sections you choose.',
    steps: ['Open Settings → Members.', 'Under Invite someone, type their email and name, and choose their access (Limited lets you tick the sections they may open).', 'Click Invite & draft email and send it to them.'],
    tips: ['Everyone signs in with their own email and password; you can change or remove access at any time.'], optional: true },
]

/** Each step's state from the household's own data: done (true / false), or null for a step there is nothing to check (the routine). */
export function startState(d: Data, s: Settings): Record<string, StepState> {
  const base = Object.fromEntries(setupSteps(d, s).map(x => [x.key, x.done]))
  const active = d.accounts.filter(a => a.status === 'Active')
  const liab = active.filter(a => (LIABILITY_KINDS as readonly string[]).includes(a.kind))
  const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`
  const out: Record<string, StepState> = {
    accounts: { done: !!base.accounts, detail: active.length ? n(active.length, 'account') + ' added' : 'no accounts yet' },
    balances: { done: !!base.balances, detail: base.balances ? 'balances entered' : 'no balance entered yet' },
    income: { done: !!base.income, detail: (() => { const k = d.paySchedules.filter(p => p.status === 'Active').length; return k ? n(k, 'income source') : 'no income yet' })() },
    bills: { done: !!base.bills, detail: (() => { const k = d.recurring.filter(r => r.status === 'Active').length; return k ? n(k, 'bill') + ' listed' : 'no bills yet' })() },
    transactions: { done: !!base.transactions, detail: d.transactions.length ? n(d.transactions.length, 'transaction') + ' so far' : 'no transactions yet' },
    categorize: { done: !!base.categorize, detail: base.categorize ? 'recent spending is sorted' : 'some recent spending is uncategorized' },
    budget: { done: !!base.budget, detail: d.periods.length ? n(d.periods.length, 'budget period') : 'no budget yet' },
    goal: { done: !!base.goal, detail: d.goals.length ? n(d.goals.length, 'goal') : 'no goals yet' },
    debts: { done: liab.length === 0 || liab.every(a => (a.planned_payment ?? 0) > 0 || (+a.balance || 0) === 0), detail: liab.length ? `planned payment set on ${liab.filter(a => (a.planned_payment ?? 0) > 0).length} of ${n(liab.length, 'card or loan', 'cards and loans')}` : 'no debts listed' },
    alerts: { done: !!base.alerts, detail: base.alerts ? 'alerts chosen' : 'not set up yet' },
    routine: { done: null, detail: 'a habit — nothing to tick' },
    household: { done: !!base.household, detail: d.members.length > 1 ? n(d.members.length, 'member') : 'just you so far' },
  }
  return out
}
/** How far along: the required steps done, and the first step not done yet (a required one before an optional one). */
export function startProgress(state: Record<string, StepState>) {
  const req = START_STEPS.filter(x => !x.optional), done = req.filter(x => state[x.key]?.done).length
  const next = req.find(x => !state[x.key]?.done) || START_STEPS.find(x => state[x.key]?.done === false) || null
  return { done, total: req.length, all: done === req.length, next, minutesLeft: START_STEPS.filter(x => state[x.key]?.done === false).reduce((m, x) => m + x.minutes, 0) }
}
