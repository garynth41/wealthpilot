// Per-page help (0.23.0): what each page is for, where its numbers come from, and the moves worth knowing. Shown in the help drawer
// (the ⓘ Help button or F1). Plain text only; `to` links stay inside the app.
export interface HelpSection { h: string; items: string[] }
export interface PageHelp { intro: string; sections: HelpSection[]; links?: Array<[string, string]> }

export const HELP: Record<string, PageHelp> = {
  '/': { intro: 'Where you stand today: cash, this budget period, what is due, and anything that needs a decision.', sections: [
    { h: 'The numbers', items: ['Safe to spend is cash on hand minus every bill, debt payment and planned item due before your next paycheck, minus your reserve floor.', 'Runway is how many months your cash lasts at the current pace (income minus bills, everyday spending and debt payments).', 'Net worth is every account marked "in net worth": assets minus what you owe.'] },
    { h: 'Make it yours', items: ['Arrange dashboard (top of the page) reorders the cards or hides the ones you do not use — per device.', 'Needs attention lists overdue bills, sync failures, unreconciled differences and anything your rules flagged; each line links to the fix.', 'When a paycheck lands, "Plan it" shows where it goes until the next one.'] }],
    links: [['/forecast', 'Cash flow forecast'], ['/settings', 'Reserve floor and thresholds']] },
  '/forecast': { intro: 'A day-by-day cash calendar for the weeks ahead and a 24-month runway.', sections: [
    { h: 'What goes in', items: ['Paychecks from your pay schedules, unpaid bills and subscriptions, card and loan payments, planned one-offs and estimated tax payments.', 'Everyday spending is your recent weekly average in variable categories, spread over the weeks ahead.', 'The floor line is your reserve floor; the first day below it is flagged.'] },
    { h: 'What-ifs', items: ['Slide spending cuts, extra income or a job ending to see the runway move; save a combination as a scenario and compare it later.'] }] },
  '/insights': { intro: 'Where the money goes by merchant, recurring charges you may have forgotten, and health scores.', sections: [
    { h: 'Tips', items: ['A merchant charged three months running at a similar amount shows as a possible subscription — add it to Bills so the forecast counts it.', 'Click a number to open the transactions behind it.'] }] },
  '/transactions': { intro: 'Every dollar in and out. Amounts are always positive; the type (expense, income, transfer) gives the direction.', sections: [
    { h: 'Editing', items: ['Click any cell to edit it. Changing a payee or category offers to apply the change to earlier transactions from the same merchant.', 'Select rows with the checkboxes for bulk category, tags, budget in/out or delete — one undo (Ctrl Z) puts it all back.', 'On a phone, swipe a transaction card left to categorize it.'] },
    { h: 'Money moves', items: ['Editing an amount, account or status moves the account balance with it.', 'A transfer to a card or loan is a debt payment; give it a budget line to count it in the budget.', 'Split a transaction to spread it across categories; 📎 holds receipts and 💬 the household conversation about it.'] },
    { h: 'Duplicates', items: ['A bank-feed copy and a manual or email copy of the same purchase are merged automatically; anything unsure waits under Duplicates for your decision.'] }] },
  '/budget': { intro: 'A plan per period (month, pay period, week or half month) against what you actually spent.', sections: [
    { h: 'Methods', items: ['Standard: plan each line; categories with rollover carry unspent money forward.', 'Zero-based: plan until "to assign" is $0 — every dollar of expected income has a job.', 'Envelopes: every line carries its whole balance into the next period; cover an overspent envelope from another, or move money between envelopes.'] },
    { h: 'Good to know', items: ['Actuals are always the sum of the transactions dated in the period — editing a plan never changes history.', 'Yearly costs (registration, gifts, travel) budgeted per year are spread across periods as sinking funds.'] }] },
  '/bills': { intro: 'Recurring bills, subscriptions and autopays, and what is coming up.', sections: [
    { h: 'Tips', items: ['"Mark paid" logs the payment and moves the account balance; a payment from email or the bank feed marks the bill paid automatically.', 'Bills marked "amount varies" (utilities) never trigger a price-rise alert.'] }] },
  '/income': { intro: 'Every income source and its pay schedule — enter one known pay date and the cadence, and every other date is worked out.', sections: [
    { h: 'Tips', items: ['Recent paychecks → Allocate… splits a paycheck into what it has to cover until the next one.', 'Gross pay on a schedule feeds the tax planner; take-home feeds the forecast.'] }] },
  '/accounts': { intro: 'Every account with its balance, available credit, liquidity and statements.', sections: [
    { h: 'Balances', items: ['The book balance moves with every transaction; a bank feed, a statement or a reconciliation adds a verified bank balance.', 'Every balance change is kept, one point per account per day — History on any account charts it and gives the balance on any past date.', 'Statements from email can carry their PDF (turn it on in the email capture settings).'] },
    { h: 'Property & vehicles', items: ['Add your home or car with a free estimate (Zillow, an appraisal, Kelley Blue Book) and the date you looked it up; link the mortgage or auto loan to see equity and loan-to-value.', 'A value a quarter old shows on the dashboard and in the Monday digest; the yearly change you set (cars lose about 15%) gives a guide figure in between.'] }] },
  '/debts': { intro: 'Payoff order (avalanche or snowball), interest cost and the date each debt is gone.', sections: [
    { h: 'Tips', items: ['Promotional rates are used month by month; a warning appears before a 0% promotion ends with the payment that clears it in time.', 'An applied Plan sets the starting extra payment here.'] },
    { h: 'Credit score', items: ['Type the free score your card issuer or bank shows each month — the app never pulls your credit.', 'The change compares the same bureau and model, since FICO and VantageScore differ; the tips start from your card utilization.'] }] },
  '/connections': { intro: 'Where transactions come from: the bank feed, statement files, email capture and manual entry — every transaction once.', sections: [
    { h: 'Imports', items: ['CSV, OFX/QFX and Excel statements; columns are detected and duplicates skipped. Payee rules categorize as rows come in.', 'Year-to-date coverage shows which months of which accounts still have no data.'] },
    { h: 'Moving from another app', items: ['Move from Mint, YNAB, Quicken or Monarch takes one export with every account: accounts and categories are matched by name, transfers paired, duplicates skipped.', 'The imported history fills in trends and reports without changing today\'s balances; new accounts start at zero until you type the balance.'] }] },
  '/reconcile': { intro: 'Tick your register against the bank statement until the difference is zero.', sections: [
    { h: 'Tips', items: ['Outstanding checks and deposits in transit explain most differences; an adjustment is recorded with a reason.', 'A reminder comes five weeks after the last reconciliation.'] }] },
  '/email': { intro: 'Bills, statements, payments and deposits read from Gmail or Outlook. You approve; the app files.', sections: [
    { h: 'Privacy', items: ['Email bodies are never stored — only the amount, date, payee and the last four digits of an account.', 'Nothing is invented: an amount or date that is not in the email is left blank for you to fill in.'] }] },
  '/investments': { intro: 'Holdings, allocation, tax lots and the retirement planner.', sections: [
    { h: 'Holdings', items: ['Holdings with a symbol are priced by the daily feed after the US close; set "Price from" to manual for anything it cannot quote.', 'Lots record each purchase so gains split into short-term (a year or less) and long-term.'] },
    { h: 'Tax-loss harvesting', items: ['Losing positions in taxable accounts with the tax a sale would save at your rates.', 'Do not buy the same security back within 30 days before or after the sale — in any account — or the loss is disallowed (wash sale).'] },
    { h: 'Retirement', items: ['Social Security at your claiming age, pensions and a year-by-year drawdown; Monte Carlo runs thousands of market paths.'] }] },
  '/tax': { intro: 'A planning estimate of federal, state and local tax, withholding and estimated payments — not a return.', sections: [
    { h: 'Tips', items: ['Safe harbor: pay 90% of this year\'s tax or 100% (110% above $150k AGI) of last year\'s to avoid the underpayment penalty.', 'Estimated payments still due appear on their deadlines in the cash calendar.'] }] },
  '/plan': { intro: 'Cash, debt payoff, goals and retirement on one timeline. Decide once where extra money goes; every page agrees.', sections: [
    { h: 'Tips', items: ['"Up to $X/mo fits" checks the extra against your reserve floor.', 'Apply writes the goal contributions, the retirement contribution and the Debts page\'s extra payment; applying again replaces rather than adds.'] }] },
  '/goals': { intro: 'Emergency fund, sinking funds and purchases — progress, pace and the date you get there.', sections: [
    { h: 'Tips', items: ['Give a goal an inflation rate to enter its target in today\'s dollars; the amount needed grows to the target date.', 'A payee rule can count matching transfers toward a goal automatically.'] }] },
  '/protection': { intro: 'Insurance policies, coverage gaps, beneficiaries and the estate checklist.', sections: [
    { h: 'Insurance', items: ['Gaps are rules of thumb — prompts to check, not advice. The life-insurance need is debts plus ten years of income, less savings outside retirement accounts.', 'Only the last four characters of a policy number are kept.'] },
    { h: 'Estate', items: ['Record what exists, when it was done and where the original is kept — never the document or account numbers.', 'Beneficiary forms override a will; review them every few years and after any life event.'] }] },
  '/hardship': { intro: 'Call every lender and provider before a payment is missed.', sections: [
    { h: 'Tips', items: ['Log each call, the person you spoke to and the next follow-up; enrolled relief lowers the payments in the forecast.'] }] },
  '/reports': { intro: 'Monthly, quarterly and annual reports — pick the sections, then export PDF, Excel or CSV.', sections: [
    { h: 'Tips', items: ['Exports keep real figures even in privacy mode, except the PDF, which prints the screen — turn privacy off first.'] }] },
  '/trends': { intro: 'Spending by week, month and year, categories over time, and net worth.', sections: [{ h: 'Tips', items: ['Hover a bar for the totals behind it.'] }] },
  '/settings': { intro: 'Household settings, categories, payee rules, members, notifications, security and backups.', sections: [
    { h: 'This device only', items: ['Theme, the idle lock, privacy mode and the number and date format are saved per device.', 'Everything else is shared by the household.'] }] },
}
export const helpFor = (path: string): PageHelp | null => HELP[path] || null
