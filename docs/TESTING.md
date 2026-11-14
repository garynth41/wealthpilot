# Testing Cresari with real people

How to get Cresari into other people's hands before it is in the App Store or Google Play, how they send feedback, and how you work
through it. Added in 0.29.0. The store steps themselves are in [STORE_LAUNCH.md](STORE_LAUNCH.md); this page is the beta around them.

## The short version

| Route | Works | Cost | Testers | Good for |
|---|---|---|---|---|
| **Invite link → the web app, added to the home screen** | today, on any phone or computer | free | as many as you like | everyone, starting now |
| **iPhone: TestFlight** | after the Apple Developer Program and one review | $99 a year | up to 10,000, by a public link | people who want the "real" iPhone app |
| **Android: Google Play internal testing** | after the Play developer account | $25 once | up to 100, by email list | Android people who want the store app |
| **Android: Google Play closed testing** | same | same | 12 or more, opted in 14 days in a row | required before a personal account can publish |

Start with the invite link. It is the same app, the same database and the same account as the store apps will be — a tester who starts
on the web keeps their household when the store apps arrive.

---

## Step 1 — Email that reaches everyone (once, before you invite strangers)

Supabase's built-in email only delivers to members of your Supabase organization. Until custom email (SMTP) is set up, people you invite
**can open the demo but cannot create an account** — their confirmation email never arrives. The sign-up screen now says this in plain
words instead of a code, so nobody is left waiting.

Two ways — pick one. **A** is the one to keep; **B** gets a small beta going today.

### A. Your own domain through Resend (recommended, about 30 minutes plus DNS time)

Cresari already uses Resend for alert and household-invitation emails, so one domain fixes all three kinds of email.

1. **Buy a domain** for the app (about $10–15 a year at any registrar). Cloudflare and GoDaddy domains can be set up in Resend with one
   click (Auto Configure); others take a few copy-and-paste DNS records.
2. **Add it to Resend** — resend.com → **Domains → Add Domain**. Enter a subdomain such as `mail.<your domain>` (Resend's advice: keep
   app email on a subdomain so it never disturbs mail sent from the main domain). Region: US East.
3. **Add the DNS records** on the domain's **Records** tab in Resend (a few records under `send.mail…` and `resend._domainkey.mail…`;
   newer domains may show CNAME records instead of MX/TXT) — use **Auto Configure** if offered, otherwise paste each one at your
   registrar exactly as shown, with only the part before your domain in the Name field. Click **Verify DNS Records**; it usually turns
   green within 15 minutes (up to 72 hours).
4. **Make an API key** — Resend → **API Keys → Create API key**, permission *Sending access*, limited to the new domain. Copy it now; it is
   shown once.
5. **Turn on custom SMTP in Supabase** — production project → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:
   sender email `no-reply@mail.<your domain>`, sender name `Cresari`, host `smtp.resend.com`, port `465`, username `resend`, password =
   the API key. **Save**.
6. **Raise the email limit** — **Authentication → Rate Limits → Email sent**: Supabase starts custom SMTP at 30 an hour; 60 is plenty for a
   beta. (Resend's free plan sends up to 100 emails a day — alerts and invitations included; Pro is $20 a month when you outgrow it.)
7. **Point Cresari's own emails at the domain** — **Edge Functions → Secrets**: set `EMAIL_FROM` and `INVITE_FROM` to
   `Cresari <alerts@mail.<your domain>>` (or ask Claude to). Until then alert and invitation emails reach only you.
8. **Test it** — open your invite link in a private window, **Create my account** with a second address of yours, and check the
   confirmation arrives (Resend → **Emails** shows each one sent). Also check **Authentication → URL Configuration**: the Site URL must be
   `https://garynth41.github.io/wealthpilot/`, or confirmation links open the wrong page.

### B. A dedicated Gmail account (about 10 minutes, fine for a small beta)

1. Create a new Gmail account just for Cresari (not your personal one — the address is visible to testers).
2. Turn on **2-Step Verification** (myaccount.google.com → Security), then create an **App password** (myaccount.google.com/apppasswords,
   name it "Cresari"). Copy the 16 characters without spaces.
3. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**: sender email = the new Gmail address, sender name
   `Cresari`, host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the app password. **Save**.
4. Do A6 and A8 above. Gmail allows about 500 emails a day; mail from a Gmail address lands in spam a little more often than mail from
   your own domain, so ask testers to check spam once. Alert and invitation emails stay on Resend's test sender (reaching only you) until
   you do A.

## Step 2 — Turn on the feedback inbox (once)

Claude does this with your approval — it changes production:

1. Applies database change `0021_feedback_testers.sql` (the feedback table, its limits and the tester counts).
2. Marks your account as the operator (a row in `app_admins`, added on the server by your email address; nothing about you goes into the
   public repository).
3. Deploys the updated `notify` function, so each new note reaches you as a push notification and an email.

After that, **Feedback & testers** appears in your menu under Help. Nobody else ever sees it, and the database refuses its data to
anyone else even if they find the address.

## Step 3 — Invite people

Open **Feedback & testers → Invite testers**.

1. Type an **invite code** for the group — `church`, `family`, `work`, `reddit`… (letters, digits, `-` and `_`). One code per group lets
   you tell later which group signs up, keeps using the app and sends feedback.
2. **Copy message**, **Email**, **Text** or **Share…** sends a ready-written invitation with the link. **Preview** opens the page they
   will see.
3. The link opens a public page, *You are invited to test Cresari*, with three choices: **Open the demo** (nothing to type; it lands on
   Start here), **Create my account** (opens the sign-up form) and **Put it on your phone** (the install steps for the device they are on).

**Testers by invite code** shows, per code: how many signed up, how many used the app in the last 7 days, how many households, how many
notes. Counts only — no names or emails.

Suggested rollout: 5–10 people you know for the first two weeks, fix what they find, then a wider group.

## Step 4 — What testers do

- **Start here** (in the menu, next to Help) walks them through setting up from nothing, in four parts: their starting point (accounts and
  today's balances), money in and out (income and pay schedule, bills, bringing in spending, categories), their plan (budget, emergency
  fund, debt payoff) and keeping it running (alerts and the home-screen app, a 10-minute weekly check-in, inviting their household). Each
  step ticks itself off from their own data, and says what to have at hand before they start.
- The **What to try** list on the invite page gives them a few concrete things to do and judge.
- **✉ Feedback** is at the top of every screen (and in the phone menu bar). They choose *Something broke*, *Confusing*, *Idea*,
  *I like this* or *Other*, write a sentence, optionally rate the app and leave an email for a reply. Their draft is kept if they close it.
  Signed-in testers see their earlier notes and what you decided about each one.

A simple ask that works: *"Try the demo for 10 minutes, then set up your own over a week using Start here. Send at least one thing that
confused you and one thing you liked."*

## Step 5 — Work through the feedback

```
tester taps ✉ Feedback ──► note saved (with the page, version and device, unless they untick it)
                              │
                              ├─► you get a push notification and an email
                              ▼
                 Feedback & testers → Inbox
                 New → Seen → Planned → Fixed   (or Not planned / Already reported)
                              │                 └─► the tester sees the status on their own list
                              ├─► Reply by email (if they left an address)
                              └─► Make GitHub issue → Claude fixes it → it ships in the next release
```

A 20-minute weekly routine: open the Inbox (it shows open notes first), mark each one, reply to anyone who left an email, turn the bugs
and good ideas into GitHub issues, and **Export CSV** if you want the whole list in a spreadsheet.

- **GitHub issues are public.** *Make GitHub issue* copies only the note, the page, version and device — never the tester's email or
  invite code. Read it before you submit it.
- **Limits** keep the inbox clean: 5 notes in 10 minutes and 30 a day per person (or per network, for people not signed in), 500 a day in
  all. Notes are capped at 4,000 characters.
- **Privacy:** a note holds what the tester typed and, if they leave the box ticked, the page, app version, device type, window size and
  look — never balances, transactions or anything from their household. When someone deletes their account, the email on their notes is
  cleared too.

## Step 6 — The store routes, when you are ready

### iPhone — TestFlight

1. Join the Apple Developer Program ($99 a year) and follow STORE_LAUNCH.md **B1–B5**: GitHub builds and uploads the iPhone app; no Mac
   needed.
2. App Store Connect → **TestFlight** → add an **External Testing** group → add the build → fill in *Test Information* (what to test,
   and a feedback email) → submit for **Beta App Review**. The first build of each version is reviewed, usually within a day or two.
3. In that group, **Enable Public Link** and send it with your invitation (paste it into the invite message). Testers install the free
   **TestFlight** app, open the link, and tap Install. Up to 10,000 people; you can cap the number or switch the link off.
4. Each build expires **90 days** after upload — release a new one before then.

TestFlight has its own screenshot feedback; it arrives in App Store Connect, not in Cresari's inbox. Ask testers to use **✉ Feedback**
inside the app so everything lands in one place.

### Android — Google Play testing

1. Create the Play developer account ($25 once) and follow STORE_LAUNCH.md **A1–A5**.
2. **Internal testing** — up to 100 testers by email (their Google account), live within minutes, no review. Good for your first group.
3. **Closed testing** — required for a personal developer account created after November 13, 2023: **at least 12 testers opted in for 14
   days in a row** before you can apply for production. Invite 15–20 so a few dropping out does not restart the clock. Internal testers
   do not count toward the 12. Organization accounts skip this rule (STORE_LAUNCH.md section 0, item 2).
4. Testers open the opt-in link on their phone, accept, then install Cresari from Google Play as usual.

**Sending the Android file directly** (sideloading) is possible but not recommended for testers: Google's developer verification now
puts apps from unverified developers behind an "advanced flow" (developer options, a restart and a 24-hour wait), already enforced in
four countries and coming everywhere in 2027. The Play testing tracks avoid all of that.

## What the web app does and does not do

Added to the home screen, the web app opens from its own icon in its own window, keeps the last data you saw for when you are offline
(read-only), and updates itself. Alerts work on Android and computers; on iPhone they work only from the home-screen icon (not a Safari
tab). The store apps add Face ID / fingerprint unlock and bill reminders scheduled on the phone — see [MOBILE.md](MOBILE.md).

## Checklist

- [ ] Custom email (SMTP) set up and tested with a second address — Step 1
- [ ] Feedback inbox on production, approved — Step 2
- [ ] First invite code and message sent to 5–10 people — Step 3
- [ ] Weekly: inbox triaged, replies sent, issues made — Step 5
- [ ] When ready: TestFlight public link; Play internal, then closed testing with 15–20 people — Step 6
