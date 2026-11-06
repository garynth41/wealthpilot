import type { GuidePage } from '../types'

export const income: GuidePage = {
  path: '/income',
  summary: 'Every income source and its pay schedule. Enter one known pay date and how often you are paid, and every other payday is worked out for the budget, the forecast and the paycheck plan.',
  start: [
    'Click + Add income source and fill in the row: Name, Payer / employer, Paid (how often), A known pay date (a recent pay stub date is ideal) and Take-home.',
    'Pick Deposited to (the account the money lands in) and the Income category it counts under.',
    'Add Gross if you know it, so the tax planner uses your pay before tax.',
    'When a paycheck lands, click Allocate… beside it under Recent paychecks to see what it has to cover until the next one.',
  ],
  top: [
    { term: 'Take-home per month', text: 'What your active income sources bring in during an average month: each source\'s take-home × paychecks a year ÷ 12, added up (an Irregular source counts once a month). Underneath: how many sources are active and the yearly total.' },
    { term: 'Next paycheck', text: 'The next payday across all active sources in the next 90 days, with the source, its take-home and how many days away it is. Green when it is three days away or less.' },
    { term: 'Expected · period', text: 'What your active sources should pay during the current budget period: each source\'s take-home × the number of its paydays inside the period. The period follows the budget cadence chosen in Settings.' },
    { term: 'Received · period', text: 'The total of every income transaction dated in the current budget period (any deposit, not only paychecks; anything excluded from the budget is left out), and what share of Expected it is. Green once it reaches Expected.' },
    { term: 'Pay cadence', text: 'How often the first active source in the table is paid (labeled "primary source"), and how many other sources there are. Pay-period budgets follow the active source with the largest take-home.' },
  ],
  cards: [
    {
      title: 'Income sources & pay schedules',
      what: 'One row per paycheck, benefit, side job or other income, with the schedule it pays on. From one known pay date and the cadence, every past and future payday is worked out.',
      how: [
        'Click + Add income source to add a row named Paycheck (paid at the default pay frequency from Settings, with today as the known pay date), then click each cell to fill it in.',
        'Type any real payday in A known pay date; every other payday is counted from it.',
        'When the income stops, set Status to Ended (or Paused if it will restart), or type the last payday in Ends.',
        'Use ✕ at the end of a row to delete a source.',
      ],
      fields: [
        { term: 'Name / Payer / employer', text: 'What you call the income and who pays it.' },
        { term: 'Kind', text: 'Salary, Hourly, Benefit, Severance, Side income, Rental, Investment, Support or Other.' },
        { term: 'Paid', text: 'How often: Weekly, Every 2 weeks, Twice a month, Monthly, Quarterly, Yearly, or Irregular (a one-off, paid only on the known pay date).' },
        { term: 'A known pay date', text: 'Any date you were or will be paid. Weekly and every-2-weeks schedules count forward and back from it in 7- or 14-day steps; monthly, quarterly and yearly schedules keep its day of the month (the last day in shorter months); twice a month pays on the 15th and the last day of the month.' },
        { term: 'Take-home', text: 'The net amount that lands in the account each payday. The totals, the budget and the forecast use it.' },
        { term: 'Gross', text: 'Pay before tax and deductions. The tax planner uses gross × paychecks a year; with no gross entered it uses take-home.' },
        { term: 'Per month', text: 'Take-home × paychecks a year ÷ 12. For example, every 2 weeks is take-home × 26 ÷ 12.' },
        { term: 'Next pay / Last pay', text: 'The next payday from today with the days until it, and the most recent scheduled payday before today. Both come from the schedule, not from deposits.' },
        { term: 'Deposited to / Income category', text: 'The account the money lands in and the income category it counts under. The Received buttons and the forecast use them.' },
        { term: 'Starts / Ends', text: 'Optional first and last pay dates. No paydays are counted outside them.' },
        { term: 'Status', text: 'Active sources count everywhere. Paused and Ended sources stay on the list, greyed out, but drop out of every total, the paychecks ahead and the forecast.' },
        { term: 'Notes / ID', text: 'Your own notes, and a short reference you can quote or search for.' },
      ],
      tips: [
        'When your budget runs by pay period, the periods follow the active source with the largest take-home.',
        'Take-home feeds the forecast and the budget; gross feeds the tax planner.',
      ],
    },
    {
      title: 'Paychecks ahead',
      what: 'Every payday from today through the next 90 days for your active sources, with a button to log the deposit when it lands.',
      fields: [
        { term: 'Date', text: 'The payday, and how many days away it is.' },
        { term: 'Source / Take-home / Into', text: 'Which income source pays, its take-home amount and the account it is deposited to.' },
        { term: 'Received', text: 'Opens Add transaction already filled in as income: the amount, date, account, category and payer, linked to this source. Change anything that differs and click Save; the account balance goes up.' },
        { term: 'Total in the next 90 days', text: 'The sum of every take-home in the list.' },
      ],
      tips: [
        'The bank feed and email capture can record deposits for you, so Received is only needed for deposits nothing else brings in.',
        'The list is worked out from the schedules, so a payday stays listed after you log it.',
      ],
    },
    {
      title: 'Income received by month',
      what: 'A bar chart of the income you actually received in each of the last six months, against the take-home your schedules expect in an average month.',
      fields: [
        { term: 'Bars', text: 'The total of every income transaction dated in that calendar month (anything excluded from the budget is left out). The current month is only partly through. Hover a bar for the amount.' },
        { term: 'Expected / month', text: 'The dotted line: Take-home per month from the top of the page.' },
      ],
      tips: ['Months with three paychecks (every-2-weeks pay) show above the line: a good month to fund a goal or pay extra on debt.'],
    },
    {
      title: 'Recent paychecks',
      what: 'Paychecks that landed in the last 45 days (up to six, newest first), each with Allocate… to plan where it goes until the next one.',
      how: [
        'Click Allocate… beside a paycheck to open Plan this paycheck.',
        'Read what is lined up before the next payday and what is left.',
        'Untick a goal or change its amount, then click Log $X to goals to move that money, or click Close to leave everything as it is.',
      ],
      fields: [
        { term: 'Date / From / Take-home', text: 'When the deposit landed, who it came from, and its amount.' },
        { term: 'Plan this paycheck', text: 'The window Allocate… opens. It shows what this paycheck has to cover from today (or the paycheck\'s date, if later) until the day before the next payday, and how many days that is. The next payday comes from the paycheck\'s pay schedule; without one, from the cash calendar, or else two weeks out.' },
        { term: 'Colored bar', text: 'Each group\'s share of the paycheck: bills, card and loan payments, planned items, goals, your plan\'s extra and everyday spending. The empty part at the end is what is left.' },
        { term: 'Unassigned / short', text: 'The paycheck minus everything listed. Green shows what is left over, a buffer or extra for a goal or debt. Amber shows how much short the paycheck is: trim a goal share or move a planned item.' },
        { term: 'Bills & subscriptions / Card & loan payments / Planned items & estimated tax', text: 'Every unpaid bill, subscription, savings transfer, card or loan payment, planned one-off and estimated tax payment due before the next payday, with its date and amount.' },
        { term: 'Goals', text: 'Each active savings goal\'s share: its monthly contribution ÷ paychecks a month (two when the pay schedule is not known), never more than the goal still needs. Debt-payoff goals are left out. Untick a goal or type a different amount here; the totals update.' },
        { term: 'Your plan\'s extra', text: 'The extra to debt and to retirement from the plan you applied on the Plan page, split the same way across the month\'s paychecks.' },
        { term: 'Everyday spending', text: 'Your recent everyday spending (the weekly average over the last 90 days in variable categories that no bill covers) for the days until the next paycheck.' },
        { term: 'Log $X to goals', text: 'For each ticked goal with an amount, adds the contribution to the goal and, when the goal is saved in a different account that is not a card or loan, records a transfer dated today from the account the paycheck landed in to the goal\'s account. Nothing else is moved.' },
        { term: 'Close', text: 'Closes the plan without changing anything.' },
      ],
      tips: [
        'Only deposits that belong to a pay schedule show here: ones logged with Received, or ones within three days of a payday and within 2% (or $5) of its take-home.',
        'Closing a plan or logging its goals also clears the "Your paycheck landed" card on the dashboard for that paycheck, on this device.',
      ],
    },
    {
      title: 'Status',
      what: 'A quick list of every income source with its status: green for Active, grey for Paused or Ended.',
      tips: ['Change a status in the Status column of Income sources & pay schedules.'],
    },
  ],
  tasks: [
    { q: 'How do I add my paycheck?', steps: ['Click + Add income source.', 'Type a Name and the Payer / employer, pick how often you are Paid, type a recent payday in A known pay date and your Take-home.', 'Pick Deposited to and the Income category. Every payday now appears under Paychecks ahead.'] },
    { q: 'How do I log a paycheck when it lands?', steps: ['Under Paychecks ahead, click Received beside the payday.', 'Check the amount and the date in Add transaction, then click Save.'] },
    { q: 'How do I decide where a paycheck should go?', steps: ['Under Recent paychecks, click Allocate… beside it.', 'Review what is due before the next payday and the amount left over or short.', 'Adjust the goal amounts and click Log $X to goals, or Close.'] },
    { q: 'How do I record that a job or benefit ended?', steps: ['Type the last payday in Ends, or set Status to Ended.', 'The totals, the budget and the forecast stop counting it; the row stays for the record.'] },
    { q: 'Why does a month show more income than expected?', steps: ['If you are paid every 2 weeks, two months a year have three paydays.', 'Income received by month shows those months above the expected line.'] },
  ],
  glossary: [
    { term: 'Pay schedule', def: 'An income source\'s cadence and one known pay date, from which every payday is worked out.' },
    { term: 'Pay cadence', def: 'How often an income source pays: weekly, every 2 weeks, twice a month, monthly, quarterly, yearly or irregular.' },
    { term: 'Take-home pay', def: 'What lands in your account after tax and deductions (net pay).' },
    { term: 'Gross pay', def: 'Pay before tax and deductions.' },
    { term: 'Paycheck allocation', def: 'A plan for one paycheck: what it has to cover until the next payday, each goal\'s share, and what is left.' },
    { term: 'Three-paycheck month', def: 'A month with three paydays on an every-2-weeks schedule. It happens twice a year.' },
  ],
  links: [['/budget', 'Budget'], ['/forecast', 'Cash Flow Forecast'], ['/tax', 'Tax Planning'], ['/goals', 'Savings Goals'], ['/plan', 'Plan'], ['/settings', 'Settings']],
}
