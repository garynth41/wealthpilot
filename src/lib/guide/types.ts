// The in-app guide (0.24.1): how to use every page, what every card, number, column, button and switch means, step-by-step
// "How do I…" tasks and a glossary. Plain text only (no markup); `links` stay inside the app. Shown in the help drawer (? on any
// card, the Help button or F1) and on the Help Center page (/help). One file per page under ./pages; ./index.ts collects them.

/** A number, column, button, switch or label on a card, and what it means. */
export interface GuideField { term: string; text: string }

/** One card on a page — keyed by the heading exactly as it is shown on screen. */
export interface GuideCard {
  /** The card's heading exactly as shown (the `title` given to <Card>). For a heading with a variable part, the fixed part. */
  title: string
  /** Regular-expression source for a heading with a variable part, e.g. '^Planned vs spent' or '^Year-to-date coverage'. */
  match?: string
  /** What the card shows and what it is for — one or two sentences. */
  what: string
  /** How to use it: short imperative steps. */
  how?: string[]
  /** Every number, column, button and switch on the card and what it means. */
  fields?: GuideField[]
  /** Good to know: rules, edge cases, shortcuts. */
  tips?: string[]
}

/** A "How do I…?" question answered with steps. */
export interface GuideTask { q: string; steps: string[] }
/** A term the page uses, defined in plain words. */
export interface GuideTerm { term: string; def: string }

export interface GuidePage {
  /** The route, e.g. '/accounts'. */
  path: string
  /** What the page is for — one or two sentences. */
  summary: string
  /** Getting started on this page: the first few things to do. */
  start?: string[]
  /** The summary numbers across the top of the page (outside any card), and what each means. */
  top?: GuideField[]
  cards: GuideCard[]
  tasks?: GuideTask[]
  glossary?: GuideTerm[]
  /** Related pages: [path, label]. */
  links?: Array<[string, string]>
}
