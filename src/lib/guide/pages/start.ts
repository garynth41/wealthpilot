import type { GuidePage } from '../types'

// Start here (0.29.0) — setting up from nothing, step by step (pages/Start.tsx, steps in lib/startGuide.ts).
export const start: GuidePage = {
  path: '/start',
  summary: 'Setting Cresari up from nothing, one step at a time: what to have at hand, where to click and what each step is for — accounts, balances, income, bills, spending, categories, the budget, savings, debts, alerts and a weekly routine. Each step ticks itself off from your own data.',
  start: ['Read Before you start and gather what it lists — about ten minutes.', 'Work down the steps in order; the one marked Next is where to go now.', 'Click the button at the end of a step to open the page it uses, then come back here from the menu (Help → Start here).'],
  cards: [
    { title: 'Your progress', what: 'How many of the required setup steps are done, about how long the rest take, and the next step to do.',
      fields: [{ term: 'Progress bar', text: 'The share of required steps done. Optional steps (debts, alerts, the routine, the household) do not count toward it.' }, { term: 'Go to step', text: 'Scrolls to the first step not done yet.' }],
      tips: ['Nothing is ticked by hand: a step is done when your data shows it — accounts added, a pay schedule set, a budget started.'] },
    { title: 'Before you start', what: 'What to have at hand before setting up: your accounts and their balances, a pay stub, your bills, your cards and loans, and what you are saving for.', tips: ['Missing something? Skip it — every step can be done or changed later.'] },
    { title: 'Install the app', what: 'How to add Cresari to the home screen or desktop of the phone or computer you are using, so it opens from its own icon like any other app. Where the browser offers it, an Install app button does it in one click.',
      tips: ['On iPhone, alerts work only once it is on the home screen.', 'Cresari is not in the App Store or Google Play yet; the installed web app works the same.'] },
    { title: 'Setup step', what: 'One step of setting up: why it matters, what to have at hand, numbered instructions with the buttons and fields named as they appear, tips, and a button to the page where it is done.',
      fields: [{ term: 'Done / Next / To do', text: 'Done means your data shows this step is finished; Next is the first step still to do; a habit step has nothing to tick.' }, { term: 'about N min', text: 'Roughly how long the step takes, with everything at hand.' }, { term: 'optional', text: 'Useful, but not needed for the numbers to be right.' }],
      tips: ['A finished step folds away — Show the steps again opens it.'] },
    { title: 'Stuck, or something unclear?', what: 'Send feedback about setting up: a step that did not match the screen, or a word that did not make sense.' },
  ],
  tasks: [{ q: 'How do I set Cresari up from scratch?', steps: ['Open Help → Start here.', 'Gather what Before you start lists.', 'Follow the steps in order — each one says where to click and ticks itself off when done.'] }],
  links: [['/accounts', 'Account Balances'], ['/income', 'Income & Pay Periods'], ['/bills', 'Bills & Subscriptions'], ['/budget', 'Budget'], ['/goals', 'Savings Goals']],
}
