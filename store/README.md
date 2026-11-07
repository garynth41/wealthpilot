# Store material

What goes into App Store Connect and Play Console. The steps are in [docs/STORE_LAUNCH.md](../docs/STORE_LAUNCH.md).

| Path | Where it goes |
|---|---|
| `listing/apple/name.txt`, `subtitle.txt`, `promotional_text.txt`, `description.txt`, `keywords.txt`, `release_notes.txt` | App Store Connect → the version page (and App Information for name and subtitle) |
| `listing/google/title.txt`, `short_description.txt`, `full_description.txt`, `release_notes.txt` | Play Console → Main store listing; release notes on each release |
| `screenshots/iphone-6.9/*.png` (1320 × 2868), `screenshots/iphone-6.3/*.png` (1206 × 2622) | App Store Connect → iPhone screenshots |
| `screenshots/android-phone/*.png` (1080 × 2112) | Play Console → Phone screenshots |
| `screenshots/*/raw/` | the same screens without captions, in case you prefer them |
| `feature-graphic.png` (1024 × 500), `play-icon-512.png` | Play Console → Feature graphic, App icon |
| `review-household.json` | restored into the App Review account (STORE_LAUNCH.md, section C) |

Limits are checked by `src/lib/storeRelease.test.ts` (part of `npm test`): App Store name and subtitle 30 characters, promotional text
170, keywords 100, description 4,000; Play title 30, short description 80, full description 4,000, release notes 500. App Store text must
not mention Android or Google Play, and Play text must not mention Apple's products.

Redraw: `npm run build && npm run store:shots` (screenshots and the review household), `npm run native:assets` (icons, splash screens,
feature graphic and Play icon).
