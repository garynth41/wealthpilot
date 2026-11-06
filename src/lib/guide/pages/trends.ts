import type { GuidePage } from '../types'

export const trends: GuidePage = {
  path: '/trends',
  summary: 'How your money moves over time: income, spending and what was left by week, month or year, your biggest categories, when and on which days you spend, and net worth.',
  start: [
    'Read the four numbers across the top for your typical recent month.',
    'Switch Income, spending and net between Week, Month and Year to see the pattern at each scale.',
    'Pick 3 mo, 6 mo or 12 mo on Spending by category. The numbers at the top, Insights and Where the money went use the same window.',
    'Hover any bar, tile or square for the figures behind it.',
  ],
  top: [
    { term: 'Avg monthly income', text: 'Income per month over the window chosen on Spending by category (the last 3, 6 or 12 months, this month included).' },
    { term: 'Avg monthly spend', text: 'Spending plus debt payments per month over the same window.' },
    { term: 'Avg savings rate', text: 'Average income minus average spend, as a share of average income. Green at or above your savings-rate target (shown underneath; set it in Settings), amber below it.' },
    { term: 'Net worth', text: 'Today\'s net worth, green when positive and red when negative, with the change since your first recorded snapshot — or a reminder to record snapshots on Account Balances.' },
  ],
  cards: [
    {
      title: 'Income, spending and net',
      what: 'Income, spending, debt payments and what was left over, side by side for each week, month or year, with the same figures in a table underneath.',
      how: ['Click Week, Month or Year at the top right of the card.', 'Hover a bar or point for its amount.', 'Click ⤢ to open the chart full size, where you can zoom and save a picture.'],
      fields: [
        { term: 'Week / Month / Year', text: 'Week shows the last 26 weeks, Monday to Sunday ("Wk of" the Monday). Month shows the last 24 months. Year shows every year with transactions, the current one marked (YTD).' },
        { term: 'Income', text: 'Green bars: income transactions, except ones excluded from the budget.' },
        { term: 'Planned spending', text: 'Grey bars, Month view only: the spending plan in that month\'s budget, rollover included. It appears only for months you budgeted by calendar month.' },
        { term: 'Spending', text: 'Expenses, except ones excluded from the budget. In Month view the bar turns red when it is above the plan.' },
        { term: 'Debt payments', text: 'Transfers into your credit cards and loans.' },
        { term: 'Net', text: 'The line: income minus spending minus debt payments.' },
        { term: '4-week avg spending', text: 'Week view only: a dotted line of spending averaged over the latest four weeks, which smooths out one-off weeks.' },
        { term: 'The table', text: 'Newest first: Income, Planned (Month view; — with no monthly plan), Spending, Debt payments, Net (green when positive, red when negative) and Savings rate (net ÷ income; — with no income).' },
      ],
      tips: [
        'Moving money between your own accounts is not spending; a card or loan payment counts as a debt payment instead.',
        'The current week, month or year is still running, so it looks smaller than a full one.',
      ],
    },
    {
      title: 'Spending by category',
      what: 'Your eight biggest categories month by month as stacked bars, with everything else in one grey slice.',
      how: ['Pick 3 mo, 6 mo or 12 mo at the top right. The choice also sets the window for the numbers at the top of the page, Insights and Where the money went.', 'Click a category in the legend to hide or show it.'],
      fields: [
        { term: '3 mo / 6 mo / 12 mo', text: 'How many months to show, counting this month.' },
        { term: 'Category bars', text: 'The eight categories with the most spending over the window, one color each.' },
        { term: 'Other + debt payments', text: 'Every other category plus your debt payments, in grey.' },
      ],
      tips: ['A split transaction counts each part in its own category.'],
    },
    {
      title: 'Insights',
      what: 'Plain-language observations about the chosen window, and spending by group underneath.',
      fields: [
        { term: 'This month\'s spending is above / at or below your N-month average', text: 'This month so far against the average of the earlier months in the window. Amber when it is more than 5% above, green otherwise.' },
        { term: 'Last N months: kept / overspent by', text: 'Income minus spending and debt payments over the whole window. Green when you kept money, red when you overspent.' },
        { term: '(Category) is your biggest category', text: 'The category with the most spending in the window, its total and its monthly average.' },
        { term: 'Discretionary is N% of spending', text: 'The share of spending in Discretionary-priority categories and its monthly amount — the easiest lever if money gets tight. Amber above 30%.' },
        { term: 'Nothing recorded yet', text: 'Shown until there are transactions in the window.' },
        { term: 'By group · last N months', text: 'Spending in each category group over the window, and that per month.' },
      ],
      tips: ['Set each category\'s group and priority in Settings → Categories so these insights sort spending the way you think about it.'],
    },
    {
      title: 'Where the money went',
      what: 'A treemap of spending by category over the chosen window. Each tile\'s size is its share of the dollars.',
      fields: [
        { term: 'Tile', text: 'One category. Tiles with room show the name, the amount and the percent of all spending; hover any tile for its figures.' },
      ],
      tips: ['Every category with spending in the window gets a tile. With no spending it says "No spending in this window."'],
    },
    {
      title: 'Spending heat map',
      what: 'A calendar of daily spending for the last 26 weeks: one column per week, one row per weekday, darker squares for bigger days.',
      fields: [
        { term: 'Square', text: 'One day. Hover for the date and what you spent. Days with no spending are the palest.' },
        { term: 'less … more', text: 'The four shades for days with spending, split so each holds about a quarter of your spending days.' },
        { term: 'Note under the map', text: 'Total spending over the 26 weeks, the busiest day\'s total, and the amounts where the shades change.' },
      ],
      tips: ['Rows run Monday to Sunday; the month names across the top mark where each month begins.', 'This counts every expense, including ones excluded from the budget.'],
    },
    {
      title: 'Spending by day of week',
      what: 'Total spending on each day of the week over the last 90 days.',
      fields: [{ term: 'Bars', text: 'Sunday to Saturday. Hover a bar for its total.' }],
      tips: ['Weekend-heavy spending usually means dining and shopping; weekday peaks are bills and fuel.', 'This counts every expense, including ones excluded from the budget.'],
    },
    {
      title: 'Net worth',
      what: 'Net worth over time from the snapshots you record on Account Balances, plus today.',
      fields: [{ term: 'Line', text: 'Assets minus debts at each snapshot; the last point is today\'s balances. Hover for the date and amount.' }],
      tips: ['Record a snapshot once a month on Account Balances to fill in this line.'],
    },
  ],
  tasks: [
    { q: 'How do I see whether I am spending more than usual?', steps: ['Read the first line under Insights: this month so far against your average.', 'In Income, spending and net, choose Month: a red spending bar means that month went over its plan.'] },
    { q: 'How do I find my biggest spending categories?', steps: ['Pick 3 mo, 6 mo or 12 mo on Spending by category.', 'Insights names the biggest one; Where the money went shows every category sized by dollars.'] },
    { q: 'How do I see spending week by week?', steps: ['Click Week on Income, spending and net.', 'The dotted line is the four-week average, so one big week stands out.'] },
    { q: 'How do I see how my net worth has changed?', steps: ['Read Net worth at the top for the change since your first snapshot.', 'The Net worth card charts every snapshot. Record a new one on Account Balances each month.'] },
  ],
  glossary: [
    { term: 'Treemap', def: 'A chart of rectangles whose sizes show each item\'s share of a total.' },
    { term: 'Heat map', def: 'A grid of squares shaded by amount — darker means more.' },
    { term: 'Four-week average', def: 'Spending averaged over the latest four weeks, to smooth out one-off weeks.' },
  ],
  links: [['/reports', 'Reports'], ['/insights', 'Spending Intelligence'], ['/accounts', 'Record a net worth snapshot'], ['/settings', 'Savings-rate target and categories']],
}
