// Opening the guide from anywhere (0.24.1): a card's ? asks the layout to open the help drawer at that card.
export const HELP_EVENT = 'wp:help'
export interface HelpRequest { card?: string | null; tab?: 'page' | 'tasks' | 'glossary' }
export function openHelp(card?: string | null, tab?: HelpRequest['tab']) { try { window.dispatchEvent(new CustomEvent<HelpRequest>(HELP_EVENT, { detail: { card: card ?? null, tab } })) } catch { /* not in a browser */ } }
