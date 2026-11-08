# Putting Cresari in the App Store and Google Play

Everything the apps need is built: the iPhone and Android projects, icons and launch screens, a privacy policy, terms, support and
account-deletion pages, "delete my account" inside the app, the store listing text, screenshots, and a GitHub workflow that builds and
uploads store builds. What is left are the steps only you can do — accounts in your name, payments, keys and a few answers. This page
walks through them in order. Technical details of the apps themselves are in [MOBILE.md](MOBILE.md).

Plan on about **$124** ($99 a year for Apple, $25 once for Google) and, for a new personal Google account, **at least 3 weeks** before
the Android app can go public (Google's 14-day testing rule, below). Apple usually reviews in 1–3 days.

---

## 0. Decide these first

1. **The store name: Cresari (chosen 2026-11-07).** The app was renamed from WealthPilot because that name was already used by other
   finance apps (another developer's *WealthPilot: AI Money Manager* on the App Store, and a German company that publishes
   wealth-management apps). A web search for "Cresari" found no app, company or trademark with that exact name, and `cresari.com`,
   `.net`, `.org` and `.io` were unregistered on 2026-11-07. Still to do before you submit: **register the domain(s) now** (a free
   domain can be taken at any time), search the App Store, Google Play and the USPTO trademark database yourself (a web search cannot
   see them all), and ideally have a trademark attorney confirm. Near-misses to know about: CRESA (a commercial real-estate firm,
   different field) and similar-sounding names. The app ID is now `com.cresari.app` (it is permanent once published; only the
   stores' web addresses show it) — change it in `capacitor.config.ts`, `android/app/build.gradle` and the Xcode project together
   if you ever want a different one, before the first upload.
2. **Personal or organization developer accounts.** Both stores offer either.
   - *Personal (individual):* quickest. Apple shows your legal name as the seller. Google requires the 14-day test with 12 testers before
     the first public release (section A7), and shows your name and country on the listing.
   - *Organization:* needs a legal business (an LLC, for example) and a free D-U-N-S number from Dun & Bradstreet (can take a couple of
     weeks). Shows the business name, skips Google's 12-tester rule, and is the safer footing for a finance app: Apple's guideline
     5.1.1(ix) says apps in "highly regulated fields such as banking and financial services" should come from a legal entity, and
     Google requires organization accounts for apps that provide "financial products and services, including but not limited to
     banking, loans, stock trading, investment funds". Cresari is a budgeting and planning tool that moves no money and gives no
     advice, which both stores generally allow from individuals — but an organization account removes the question entirely.
3. **The support email** shown on both listings (it is public). A dedicated address (for example a new Gmail just for the app) keeps your
   personal inbox private. Tell Claude which address to use and it adds it to the support, privacy and account-deletion pages.
4. **Where to sell it.** Recommended: **United States only** at first. The app's taxes, Social Security and examples are American, and
   selling only in the US also means you don't need to file EU "trader" details (the EU Digital Services Act). You can add countries later.
5. **Price:** free, no in-app purchases (that is what the listing text and these answers assume).
6. **Email that reaches everyone — required before strangers can sign up.** Supabase's built-in email service only delivers to members
   of your Supabase organization (since September 2024); anyone else gets "Email address not authorized", so their sign-up confirmation
   and password-reset emails never arrive — including the App Review team's. Check Supabase → Authentication → **Emails → SMTP Settings**:
   if custom SMTP is off, turn it on with a real email provider. Two ways:
   - *Best:* buy a domain for the app's name (about $10–15 a year), verify it in **Resend** (already used for the alert emails), and use
     Resend's SMTP: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender `no-reply@<your domain>`. Then set
     the edge-function secrets `EMAIL_FROM` and `INVITE_FROM` to `Cresari <alerts@<your domain>>` too — Resend's test sender
     (`onboarding@resend.dev`) only delivers to your own address, so today alert and invitation emails reach only you. The domain also gives
     you a support address (`support@<your domain>` forwarded to your inbox) and a home for the website.
   - *Quick:* a dedicated Gmail account with 2-Step Verification and an **App password**: host `smtp.gmail.com`, port `465`, user and
     sender = that Gmail address, password = the app password. Fine for a small number of users (Gmail allows about 500 emails a day).

---

## A. Google Play (Android)

**A1. Create the developer account** — https://play.google.com/console/signup. Pay the $25 fee, verify your identity, and verify a
physical Android phone with the Play Console app when asked (new accounts must).

**A2. Create the app** — Play Console → **Create app**: name (section 0), default language English (United States), **App**, **Free**;
accept the declarations.

**A3. Make the upload key** (once). On your Windows computer, in the Cresari folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-android-upload-key.ps1
```

It needs Android Studio (or any Java JDK) installed for its `keytool`. It creates `%USERPROFILE%\WealthPilot-signing\` with the key and a
`KEEP-THIS-SAFE.txt` holding its password and the four values for GitHub. If the GitHub CLI is installed and signed in it offers to save
the four secrets for you; otherwise add them by hand (GitHub → the repository → **Settings → Secrets and variables → Actions → New
repository secret**): `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
`ANDROID_UPLOAD_KEY_PASSWORD`. Back the folder up (a password manager or an encrypted USB drive); never put it in the repository.
(If the bridge to your computer is connected, Claude can run this for you.)

**A4. Build the first bundle** — GitHub → **Actions → release apps → Run workflow**: platform `android`, rebuild `0`, Play track `none`.
When it finishes, download **cresari-android-…** from the run's Artifacts and unzip it: inside is `cresari-0.25.1-250100.aab`.

**A5. Upload it by hand** (Google only accepts the very first bundle through Play Console). Play Console → **Test and release → Testing →
Closed testing** → create a track (for example "Friends and family") → **Create new release** → accept **Play App Signing** (Google keeps
the app's signing key; yours is only the upload key) → upload the `.aab` → release notes from `store/listing/google/release_notes.txt` →
save, review, and start the rollout to closed testing. Add testers by email list.

**A6. Store listing** — Play Console → **Grow users → Store presence → Main store listing**:
- App name, short description, full description: `store/listing/google/title.txt`, `short_description.txt`, `full_description.txt`
- App icon (512 × 512): `store/play-icon-512.png` · Feature graphic (1024 × 500): `store/feature-graphic.png`
- Phone screenshots (2–8): `store/screenshots/android-phone/01-…png` to `06-…png`
- Category **Finance**; contact email (section 0); website `https://garynth41.github.io/wealthpilot/`;
  privacy policy `https://garynth41.github.io/wealthpilot/privacy.html`

**A7. App content** — Play Console → **Policy and programs → App content**. Answer each:

| Item | Answer |
|---|---|
| Privacy policy | `https://garynth41.github.io/wealthpilot/privacy.html` |
| App access | **All or some functionality is restricted** → add the review account (section C) with instructions: "Sign in with these details. Or tap Open the offline demo on the sign-in screen to explore sample data without an account." |
| Ads | **No, my app does not contain ads** |
| Content rating | Questionnaire, category **All other app types**; answer **No** to every content question (no violence, sexuality, gambling, user-to-public sharing, etc.). Expected: Everyone / PEGI 3 |
| Target audience | **18 and over** only |
| News app | No |
| COVID-19 apps | No |
| Data safety | the table below |
| Government apps | No |
| Financial features | **My app doesn't provide any financial features** (it moves no money, lends nothing, trades nothing, gives no advice). If Google asks for an organization account anyway, see section 0.2 |
| Health apps | No health features |
| Advertising ID | **No** (the app does not use it) |
| Account deletion URL | `https://garynth41.github.io/wealthpilot/delete-account.html` |

**Data safety answers.** *Does your app collect or share user data?* **Yes**. *Is all data encrypted in transit?* **Yes**. *Ways to
request deletion:* **in the app** and **the web link above**; *can people ask for some data to be deleted without deleting the account?*
**Yes** (any record can be deleted). Nothing is **shared** (the hosting and email services only process data for the app, which
Google does not count as sharing). Every type below is **collected**, **not processed ephemerally**, and used for **App functionality**
(crash logs and diagnostics: **Analytics**, which here means finding and fixing errors):

| Category | Type | Required? |
|---|---|---|
| Personal info | Email address · User IDs | required |
| Personal info | Name (display name) | optional |
| Financial info | Purchase history (transactions) · Other financial info (balances, income, debts, budgets) | required |
| Financial info | Credit score | optional |
| Messages | Other in-app messages (comments on transactions) | optional |
| Photos and videos | Photos (receipts) | optional |
| Files and docs | Files and docs (statements and receipts as PDFs) | optional |
| App activity | App interactions (the household's change history) · Other user-generated content (notes, goals, plans) | required / optional |
| App info and performance | Crash logs · Diagnostics | required |

Not collected: location, contacts, calendar, health, web history, audio, device IDs, email messages (email capture exists only on the
website), payment card numbers (only the last four digits are kept).

**A8. Testing** — with a personal account created after November 13, 2023, Google requires **at least 12 testers opted in to the closed
test for 14 days in a row** before you can apply for production. Invite friends and family (they need Android phones and must stay
opted in), then Play Console → **Dashboard → Apply for production**. Google usually answers within 7 days. Organization accounts skip this.

**A9. (Optional) Let GitHub upload future versions** — Google Cloud console (https://console.cloud.google.com): create a project →
enable **Google Play Android Developer API** → **IAM & Admin → Service accounts → Create** → open it → **Keys → Add key → JSON** (a file
downloads). Play Console → **Users and permissions → Invite new users** → the service account's email → **App permissions**: Cresari →
"Release to testing tracks" (and "Release to production" if you want). Then save the file as the `PLAY_SERVICE_ACCOUNT_JSON` secret:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-store-secrets.ps1 -PlayJson "$env:USERPROFILE\Downloads\<the file>.json"
```

From then on, **release apps** with a Play track uploads each new version as a **draft** on that track; you review and roll it out in
Play Console.

---

## B. App Store (iPhone)

**B1. Join the Apple Developer Program** — https://developer.apple.com/programs/enroll/ with your Apple Account (two-factor on). $99 a
year. Individuals are usually approved within a day or two.

**B2. Register the app ID** — https://developer.apple.com/account/resources/identifiers/list → **+** → App IDs → App → description
"Cresari", **Explicit** bundle ID `com.cresari.app`. No capabilities are needed.

**B3. Create the app record** — https://appstoreconnect.apple.com → **Apps → + → New App**: platform iOS, name (section 0), primary
language English (U.S.), the bundle ID above, SKU `cresari-ios`, full access. Open **App Information** and note the **Apple ID**
number — tell Claude, so the app's "update available" button can link to the listing.

**B4. The App Store Connect key for GitHub** — App Store Connect → **Users and Access → Integrations → App Store Connect API → Team Keys →
Generate API Key**: name "GitHub", access **Admin** (needed for Apple's cloud signing). Download the `.p8` file (you can only download it
once) and note the **Key ID** and the **Issuer ID** shown above the list. Your **Team ID** is at https://developer.apple.com/account →
Membership details. Then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-store-secrets.ps1 -P8 "$env:USERPROFILE\Downloads\AuthKey_<KEYID>.p8" -KeyId <KEYID> -IssuerId <ISSUER-ID> -TeamId <TEAMID>
```

(or add `ASC_KEY_P8_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `APPLE_TEAM_ID` by hand — the first is the `.p8` file in base64).

**B5. Build and upload** — GitHub → **Actions → release apps → Run workflow**: platform `ios`, rebuild `0`. It archives the app on a
Mac in GitHub's cloud, signs it with Apple's cloud-managed certificate and uploads it. After Apple processes it (10–30 minutes) it appears
in App Store Connect → **TestFlight**. No Mac needed.

**B6. Try it on your iPhone** — install **TestFlight** from the App Store; in App Store Connect → TestFlight → **Internal Testing**, add
yourself; open the invitation on the phone. Answer the export-compliance question if asked: the app uses only standard encryption
(HTTPS), which is exempt — the app already declares this.

**B7. The listing** — App Store Connect → your app → the version page (**1.0 Prepare for Submission**). First change the version number
at the top to **0.25.2**, so it matches the build:
- Name, subtitle, promotional text, description, keywords: `store/listing/apple/*.txt`
- What's New: `store/listing/apple/release_notes.txt`
- Screenshots: **iPhone 6.9″** ← `store/screenshots/iphone-6.9/01…06.png`; **iPhone 6.3″** ← `store/screenshots/iphone-6.3/…`
  (Apple scales these for every other iPhone; no iPad screenshots are needed — the app is iPhone-only)
- Support URL `https://garynth41.github.io/wealthpilot/support.html` · Marketing URL `https://garynth41.github.io/wealthpilot/`
- Privacy Policy URL (App Privacy page) `https://garynth41.github.io/wealthpilot/privacy.html`
- Category **Finance** (secondary: Productivity) · Copyright "2026 <your name or business>"
- Build: pick the TestFlight build from B5 · Price **Free** · Availability: section 0.4

**B8. App Privacy** — App Store Connect → **App Privacy → Get Started**: *Do you or your partners collect data?* **Yes**. Select
exactly these, and for each: used for **App Functionality** only, **linked to the user**, **not used for tracking**:

| Category | Data types |
|---|---|
| Contact Info | Name · Email Address |
| Financial Info | Credit Info · Other Financial Info |
| Purchases | Purchase History |
| User Content | Photos or Videos · Other User Content |
| Identifiers | User ID |
| Usage Data | Product Interaction |
| Diagnostics | Crash Data · Other Diagnostic Data |

These match the privacy manifest built into the app (`ios/App/App/PrivacyInfo.xcprivacy`) and the privacy policy.

**B9. Age rating** — answer **None / No** to the content questions (no violence, mature themes, gambling, contests, medical advice or
unrestricted web browsing; no ads). The only things people write in the app — notes and comments on transactions — are seen only by the
members of their own household, whom an owner invited; nothing is public and strangers cannot contact anyone. Expected rating **4+**.

**B10. App Review information** — sign-in required: **Yes**, with the review account (section C). Notes (paste):

> Cresari is a household budgeting and planning app. Sign in with the account above — it has two-factor sign-in off and a sample
> household. You can also tap "Open the offline demo" on the sign-in screen to explore sample data without an account.
> • Delete an account: Settings → Security → Delete my account (or, signed in with no household yet, Delete my account on the welcome screen).
> • Bill reminders (local notifications): Settings → Notifications → Reminders on this phone.
> • Face ID unlock: appears on the idle lock (Settings → Security sets when the app locks).
> • Bank sync uses SimpleFIN Bridge, a separate paid service the person signs up for; it is not needed to review the app.
> • No in-app purchases, no ads, no tracking. Privacy policy: https://garynth41.github.io/wealthpilot/privacy.html

**B11. Submit for Review.** When it is approved, release it (manually or automatically, as you chose on the version page).

---

## C. The review account (both stores)

Reviewers need a working sign-in. After the email setup in 0.6 (the confirmation email has to arrive), create one account just for them on the website (https://garynth41.github.io/wealthpilot/ → **Create
an account**) with an address you control — a plus address works, e.g. *yourname+review@gmail.com* — and a strong password you don't use
anywhere else. Confirm the email, create a household called "Our household", and restore the sample data into it: **Settings → Backup &
data → Restore**, choose `store/review-household.json` (sample data with generic names). Leave two-factor **off** for this account.
Enter the email and password only in App Store Connect and Play Console — never in the repository.

---

## D. After launch

- **Tell the app a new version exists** (after a store has released it):
  `update public.app_meta set value = '0.25.2' where key = 'latest_native_version';` — app users then see "A new version is available".
  Only for changes an older app would break (such as a database change) also set `min_native_version`, which blocks older apps until
  they update.
- **Each new version:** raise the version as usual (every release already does), then run **release apps** (`both`). Android lands as a
  draft on the chosen track; iOS lands in TestFlight — submit it from App Store Connect.
- **Screenshots** after visible changes: `npm run build && npm run store:shots`, then upload the new files.
- **Upload rejected for its number?** Run the workflow again with rebuild `1` (then `2`, …).

<a id="secrets"></a>
## Secrets the release workflow uses

| Secret | What | Made in |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | the upload key file, base64 | A3 (script) |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_PASSWORD` | its password (the same for both) | A3 |
| `ANDROID_UPLOAD_KEY_ALIAS` | `upload` | A3 |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Play API key (optional) | A9 |
| `APPLE_TEAM_ID` | 10-character team ID | B4 |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | App Store Connect API key IDs | B4 |
| `ASC_KEY_P8_BASE64` | the `.p8` key file, base64 | B4 (script) |

GitHub never shows a secret again after it is saved, and workflows started from other people's pull requests cannot read them.
