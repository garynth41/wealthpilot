// App-wide help (0.24.1): getting started, how-tos that span pages, troubleshooting, and the core vocabulary.
import type { GuideTask, GuideTerm } from './types'

export interface FaqEntry { q: string; a: string[] }
export interface StartStep { title: string; text: string; to: string }

export const GENERAL: { intro: string; start: StartStep[]; tasks: GuideTask[]; faq: FaqEntry[]; glossary: GuideTerm[]; basics: Array<{ h: string; items: string[] }> } = {
  intro: 'Cresari keeps your household\'s money in one place: what you have, what is coming in and going out, what you owe, and the plan for the rest. Every page answers one question; this guide explains each page, every card on it and what every number means.',
  start: [
    { title: 'Name your household and choose a budget cadence', text: 'Settings → General: the household\'s name (Household card), your reserve floor — the cash you never want to drop below (Planning thresholds) — and whether you budget by calendar month, pay period, every 2 weeks, twice a month or week (Budget cadence). Then click Save settings.', to: '/settings' },
    { title: 'Add your accounts', text: 'Account Balances: every bank, savings, investment and retirement account with today\'s balance, then every card and loan with what is on its latest statement.', to: '/accounts' },
    { title: 'Add your pay schedule', text: 'Income & Pay Periods: one known pay date, the cadence and the take-home amount — every future paycheck is worked out from that.', to: '/income' },
    { title: 'List your bills and subscriptions', text: 'Bills & Subscriptions: rent, utilities, insurance, phone, streaming — with the amount, how often and the next due date.', to: '/bills' },
    { title: 'Bring in your transactions', text: 'Cash & Account Operations: connect the bank feed, import a statement file, or move your history over from Mint, YNAB, Quicken or Monarch.', to: '/connections' },
    { title: 'Set your budget', text: 'Budget: give each category a plan for the period; the actuals fill in from your transactions.', to: '/budget' },
    { title: 'Check the dashboard', text: 'Dashboard: safe to spend, what is due, and anything that needs a decision. Come back here each day or two.', to: '/' },
  ],
  basics: [
    { h: 'Finding your way', items: [
      'The menu on the left groups pages by job: Overview, Spending Intelligence, Account Balances, Cash & Account Operations, Investments & Retirement, Tax Planning, Goals & Financial Planning, Reports & Analytics, and Security & Settings. On a phone, tap ☰.',
      'Press Ctrl K (or /) to jump to any page, account, bill, goal or payee by typing part of its name.',
      'Every card has a small ? beside its heading — it opens this guide at that card. Help (or F1) opens the guide for the whole page.',
    ] },
    { h: 'Editing', items: [
      'Most tables edit in place: click a cell, type, then click away (or press Tab) to save.',
      'Ctrl Z undoes the last bulk change on Transactions.',
      'A member with Read-only access sees everything they are allowed to but cannot change it; edit buttons are hidden or greyed out. Only owners can save household settings.',
    ] },
    { h: 'Your data and privacy', items: [
      'Press H (or the eye button) to hide every amount on this device — handy in a coffee shop or on a shared screen. Press H again to show them.',
      'Your records keep only the last four digits of an account number, and email capture never stores message bodies. A statement PDF you choose to save is the bank\'s own document, so it can show the full number.',
      'A signed-in household is backed up every night and the last 30 days are kept; Settings → Backup & data → Download JSON backup saves a copy whenever you like.',
    ] },
  ],
  tasks: [
    { q: 'How do I add a transaction?', steps: ['Open Transactions and press N (or use + Add).', 'Pick the type (expense, income or transfer), the account, the amount, the payee and the category.', 'Save — the account balance moves with it.'] },
    { q: 'How do I see what I can safely spend?', steps: ['Open the Dashboard.', 'Safe to spend is your cash minus everything due before your next paycheck, minus anything overdue and still unpaid, and minus your reserve floor.'] },
    { q: 'How do I invite my partner or a family member?', steps: ['Open Settings → Members.', 'Under Invite someone, type their email and choose their access: Full, Read-only, or Limited (for Limited, tick the sections they may see).', 'Click Invite & draft email: it records the invitation and drafts the email for you to send (or says it was emailed for you).', 'They sign in — or sign up — with that address and join the household; until then they are listed under Waiting to sign up. To make someone an owner, use Change on their row once they have joined.'] },
    { q: 'How do I hide amounts on my screen?', steps: ['Press H, or click the eye button in the top bar.', 'Every amount shows as ••• on this device until you press H again.'] },
    { q: 'How do I get a report for my accountant?', steps: ['Open Reports.', 'Choose the period and the sections (tax is one of them).', 'Download it as PDF, Excel or CSV.'] },
  ],
  faq: [
    { q: 'An account balance does not match my bank', a: ['Open Checkbook Reconciliation for that account and enter the balance from your statement — the app lists the entries that explain the difference (outstanding checks, missing or duplicate transactions).', 'If you simply want to match the bank today, type the bank\'s balance into the Balance cell on Account Balances.'] },
    { q: 'The bank sync failed or stopped updating', a: ['Open Cash & Account Operations → Automatic bank sync and read the last error.', 'Most failures mean the bank asked SimpleFIN to sign in again: open SimpleFIN Bridge, reconnect the bank, then click Sync now.', 'A failed sync shows under Needs attention on the dashboard, and the alerts warn you when the feed has not updated for 3 days.'] },
    { q: 'I see the same transaction twice', a: ['A bank-feed copy and a typed or email copy of the same purchase are merged automatically; anything the app is unsure about waits under Duplicates on the Transactions page for you to keep or merge.'] },
    { q: 'A red bar says a newer release is available', a: ['That tab is still running the previous version. Click the button in the bar (or reload the page) to switch to the new one; nothing you saved is lost.', 'On the installed app, close it fully and open it again.'] },
    { q: 'Every amount shows as •••', a: ['Privacy mode is on for this device. Press H or click the eye button to show amounts.'] },
    { q: 'I cannot edit anything', a: ['Your access may be Read-only, or Limited to some sections — a blue bar at the top says which. Ask a household owner to change it in Settings → Members.', 'Household settings — thresholds, payee rules and alert choices — can only be saved by an owner.', 'When you are offline, editing is paused until you are back online.'] },
    { q: 'I am offline', a: ['The app opens from the read-only copy this device kept, with a banner saying how old it is. Everything is visible; changes are paused until you are back online, and the page updates by itself when the connection returns.', 'The copy is kept in this browser only and cleared when you sign out. Turn it off in Settings → General → This device on a shared computer.', 'The offline demo keeps working without a connection.'] },
    { q: 'Sync now is greyed out', a: ['On-demand syncs are limited to one every 15 minutes and 12 in any 24 hours per household; the line beside the button says when the next one is available. The nightly sync still runs.', 'It is also greyed out until at least one bank account is matched to one of yours.'] },
    { q: 'A red banner says the household will be deleted', a: ['An owner scheduled the household for deletion. It is read-only until the date shown and then deleted for good, for every member.', 'Any owner can click Cancel the deletion in the banner (or in Settings → General) to keep it.'] },
    { q: 'Where did a number come from?', a: ['Open the ? beside the card for what the number means and how it is worked out. Most totals are clickable and open the transactions behind them.'] },
    { q: 'How do I get my data out?', a: ['Settings → Backup & data → Backup → Download JSON backup saves everything as one file you can restore later; Transactions as CSV gives a spreadsheet of every transaction. Reports downloads PDF, Excel or CSV for any period, and tables have their own CSV download.'] },
  ],
  glossary: [
    { term: 'Household', def: 'Everyone who shares this set of accounts, bills and budgets. You can belong to more than one household.' },
    { term: 'Access levels', def: 'What a member can do: Owner (everything, including members and household settings), Full access (change any data), Read-only (look but not change) or Limited (only the sections an owner picked). Owners cannot be limited.' },
    { term: 'Safe to spend', def: 'Cash on hand minus every bill, debt payment and planned item due before your next paycheck, minus anything overdue and still unpaid, minus your reserve floor.' },
    { term: 'Reserve floor', def: 'The cash balance you never want to drop below. Set it in Settings; safe-to-spend, the forecast and the alerts keep it untouched.' },
    { term: 'Runway', def: 'How many months your cash would last at your current pace of spending.' },
    { term: 'Cash on hand', def: 'The total of the accounts marked "Counts as cash" — usually checking, savings and cash.' },
    { term: 'Budget period', def: 'The stretch of time a budget covers — a calendar month, a pay period, every 2 weeks, twice a month or a week — as chosen in Settings → General → Budget cadence.' },
    { term: 'Category priority', def: 'Essential (you could not cut it), Important or Discretionary. Liquidity, the runway and the hardship plan use it.' },
    { term: 'Cost type', def: 'Fixed (the same each time), Variable (changes month to month) or Irregular (a few times a year).' },
    { term: 'Transfer', def: 'Money moving between two of your own accounts — including a card or loan payment. It is not spending: paying a card is moving money (what you bought with it was the spending), a loan payment is counted apart as a loan payment, and money moved into savings is saving. A savings transfer or loan payment counts on a budget line when you give it one; a card payment never does.' },
    { term: 'Excluded from budget', def: 'A transaction that stays in the account but does not count against any budget category.' },
    { term: 'Pending / Cleared / Void', def: 'A transaction\'s status: not yet posted by the bank, posted, or cancelled (kept for the record but not counted).' },
    { term: 'Payee rule', def: 'A rule that categorizes (and can rename or tag) every transaction from a merchant automatically as it arrives.' },
    { term: 'Reconcile', def: 'Tick your register against a bank statement so the book balance and the bank agree to the cent.' },
    { term: 'Bank feed', def: 'Transactions and balances downloaded from your bank through SimpleFIN Bridge, once a day and whenever you click Sync now.' },
    { term: 'Privacy mode', def: 'Hides every amount on this device (H to toggle).' },
    { term: 'Offline demo', def: 'A sample household stored only in your browser, for trying the app without an account.' },
  ],
}
