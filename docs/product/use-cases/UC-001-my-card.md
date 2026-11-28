# UC-001 — My Card

| | |
|---|---|
| Use case ID | UC-001 |
| Product | My Card |
| Platform | Free Contact Hub |
| Pricing | Free. No credits. |
| Initiative | MY-CARD-SHARE-001 (branch `feature/my-card-share`) |
| Release status | Engineering-verified on staging (2026-11-28). **Customer acceptance: PENDING owner approval.** Production is off. |

**Website headline:** "One card. One scan. All your connections."
**Call to action:** "Create Your Free Card" (links to `/signup?ref=card`)

## The experience
Open My Card, tap **Show QR**, they scan it with their normal camera, they tap **Save to Contacts**. No account and no
app install for the person scanning. The link and QR code never change when details change, only when the owner taps
**Reset link**.

## Customer stories
Each is **Supported** only after its checks pass on staging. Until then it is *Built, not yet verified on a device*.

| # | Story | Depends on | Status |
|---|---|---|---|
| 1 | Meet someone and exchange contact information with a QR code | QR, public page, Save to Contacts | Engineering-verified on staging (browser, phone-size): QR opens, the public page loads with no sign-in, Save to Contacts downloads a vCard. A real phone-camera scan and Add Contact on a device: pending. Customer acceptance: pending |
| 2 | Share contact information and social profiles through a single link | Share sheet, public page, LinkedIn and Instagram | Public page and link verified on staging with email, phone and website. LinkedIn and Instagram: covered by rules and unit tests, not exercised in the staging run. Share sheet and previews on a device: pending. Customer acceptance: pending |
| 3 | Update contact information without replacing the link or QR | Synced saves, stable ID | Engineering-verified on staging: an edit appeared on the same link; turning sharing off made the link unavailable; turning it on again restored the same link. Customer acceptance: pending |
| 4 | Turn introductions into meetings through a booking link | Additional links | Built; verified in the emulator and unit tests; not exercised on staging. Customer acceptance: pending |
| 5 | Invite people to upcoming events through selected event links | Additional links | Built; verified in the emulator and unit tests; not exercised on staging. Customer acceptance: pending |

## Capabilities (as built)
- Share My Card (the phone's share sheet; Copy Link where there is none), Copy Link, full-screen QR code (PNG download).
- Public card page at `/c/<id>`: photo or initials, name, title, organization, one tap to call, text, email, LinkedIn,
  Instagram, website, and up to five additional links (label with the destination host shown beneath it).
- Save to Contacts: a standard `.vcf` including shared links.
- Every field and link has its own Shared / Private switch. A Private value is not on the page, the contact file or the
  preview, from the next request.
- Turn sharing off and on again (same link), Reset link (old link and QR stop for good), automatic updates.
- Personalized link previews: name, "Title · Organization" and photo only, never contact details or links.
- Suspended accounts and admin takedown remove the public card; they cannot republish.

## Known limitations (also shown in Manage sharing)
- A contact someone already saved stays on their phone.
- A link preview already shown in a message stays in that conversation; Slack, LinkedIn and Facebook keep their own copies.
- Screenshots and downloaded card images can't be recalled.
- Reset link stops old links and QR codes; it doesn't recall saved copies.
- `noindex` keeps cards out of search results; it is not access control. The unguessable ID and the rules are.
- Android Add Contact behaviour varies by device (to be verified).

## Marketing handoff
- **Screenshots:** from a demo account with the `scripts/visual/my-card` harness and on devices. *Pending staging.*
- **Screen recording** of share, scan, save (needs a second phone). *Pending.*
- **Suggested website copy:** headline and call to action above, then the three steps under "The experience".
- **Placement:** the Contact Hub / My Card section of the website, with the Free badge.
- Nothing here claims results or performance. The record states only what was verified.
