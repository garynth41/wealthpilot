import type { GuidePage } from '../types'

// Feedback & testers (0.29.0) — only for whoever runs Cresari (pages/FeedbackInbox.tsx).
export const feedback: GuidePage = {
  path: '/feedback',
  summary: 'For the person who runs Cresari: invite testers with a link, see how each invite is doing, and work through the feedback testers send — sort it, note it, reply, and turn it into GitHub issues.',
  start: ['Under Invite testers, type a code for the group you are inviting (church, family, linkedin), then Copy link, Email or Text it.', 'Check the Inbox every few days: set each note to Seen, Planned, Fixed or Won’t do, and reply to anyone who left an address.', 'Turn a bug or an idea into a GitHub issue with Make GitHub issue — check it holds nothing personal first, the repository is public.'],
  top: [{ term: 'New', text: 'Feedback nobody has looked at yet (status New).' }, { term: 'This week', text: 'Feedback received in the last 7 days, and how much in all.' },
    { term: 'Open bugs', text: 'Notes marked Something broke that are not Fixed, Won’t do or Duplicate.' }, { term: 'Average rating', text: 'The average of the 1–5 star ratings testers gave, and how many gave one.' }],
  cards: [
    { title: 'Feedback & testers', what: 'Shown instead of the page to anyone who does not run Cresari: only the operator can read testers\' feedback.' },
    { title: 'Invite testers', what: 'A link to the public Try Cresari page, where someone can open the demo, make an account or install the app — with a ready-made message to send.',
      fields: [{ term: 'Invite code', text: 'A label for the group you are inviting. It is added to the link, kept on the tester\'s device, and counted under Testers by invite code. Not a password: the link works without it.' },
        { term: 'Copy link / Copy message / Share… / Email / Text', text: 'Send the invitation the way you like; Email and Text open your own email or messages app with the message filled in.' }, { term: 'Preview', text: 'Opens the Try Cresari page as a tester sees it.' }],
      tips: ['People you do not know can only make an account once Cresari sends its sign-up emails through its own email service (docs/TESTING.md, step 1). The demo works for everyone already.'] },
    { title: 'Testers by invite code', what: 'For each invite code: how many signed up with it, how many signed in during the last 7 days, how many households they made and how much feedback came from it. Counts only — no names or addresses.',
      fields: [{ term: 'No code', text: 'Accounts and feedback that did not come through an invite link — you included.' }] },
    { title: 'Inbox', what: 'Every piece of feedback, newest first, with what kind it is, the rating, the note, the page and device it came from, and who sent it if they left an address.',
      how: ['Pick Open, New, Closed or All and a kind to narrow the list; search finds words in the notes.', 'Change Status as you go — a signed-in tester sees the status on their own earlier feedback.', 'Type your own note on an item; it saves when you click away and only you see it.'],
      fields: [{ term: 'Status', text: 'New, Seen, Planned, Fixed, Won’t do or Duplicate. Open means New, Seen or Planned.' },
        { term: 'Reply by email', text: 'Opens your email app addressed to the tester, quoting their note — only when they left an address.' },
        { term: 'Make GitHub issue', text: 'Opens GitHub\'s new-issue form with the note, page and device filled in (never the tester\'s address). Check it before saving: the repository is public.' },
        { term: 'Link issue', text: 'Saves an issue\'s address on the item, so Open issue goes straight to it.' }, { term: 'Delete', text: 'Removes the item for good — for spam only; mark real feedback Won’t do instead.' },
        { term: 'Export CSV', text: 'The items shown, as a spreadsheet file.' }],
      tips: ['On production each new piece of feedback also arrives as a push on your devices and an email.'] },
  ],
}
