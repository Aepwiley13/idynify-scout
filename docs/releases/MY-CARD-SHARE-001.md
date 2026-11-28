# MY-CARD-SHARE-001 — My Card sharing: staging handoff

Branch: `feature/my-card-share` (from `origin/main` `ebfefb73`). Production is untouched: rules, flags and deploys.

## What is built (Share, Scan, Save)
| Plan PR | Scope | Status |
|---|---|---|
| 1 Rules | `publicCards`, `publicIds` registry, schema 2 private card, five link slots, `myCardPublishBlocked`; invariants S1-S8, P1-P4 | Done, 42 emulator cases |
| 2 Service | publish / unpublish / Reset Link / synced saves, gate, schema 2, vCard links | Done, 22 emulator cases against the real rules |
| 3 Owner UI | Flag, Share My Card, Copy Link, publish sheet, Manage sharing, links editor, merged download help | Done, behind `VITE_MY_CARD_SHARING` |
| 4 QR | Full-screen QR (open-source `qrcode`), Download QR | Done |
| 5 Public page | Edge function: page, `.vcf`, `photo.jpg`, preview tags, headers, flag | Done, 26 unit tests; real-network checks pending |
| 6 Admin + attribution | Suspend removes the card; takedown / restore; `signupSource: "card"` | Done |
| 7 Verify + handoff | Device and preview matrix, screenshots, this document, UC-001 | In progress: items below need staging |

## Three layers keep production dark
1. **Rules**: not deployed to production. Without them production refuses any `sharingEnabled: true` write.
2. **UI flag** `VITE_MY_CARD_SHARING`: `on` in branch-deploy and deploy-preview, `off` in production (`netlify.toml`).
3. **Edge flag** `MY_CARD_SHARING_ENABLED`: `true` in branch-deploy and deploy-preview, `false` in production, so `/c/*` is the same "isn't available" page.

## IMPORTANT: staging data caveat
`netlify.toml` notes that branch deploys and previews read and write the **same Firebase project as production**
(`idynify-scout-dev`) unless the six `VITE_FIREBASE_*` values are pointed at an isolated staging project. The plan assumes
rules are deployed to an isolated staging project. **Do not test on a preview that still points at production data**: the
new rules are not there and `publicCards` would not exist. Staging needs, once, from the owner / Codex:
1. The staging Netlify site/context with the six `VITE_FIREBASE_*` values of the isolated staging Firebase project, and `MY_CARD_FIREBASE_PROJECT_ID` (the edge function falls back to `VITE_FIREBASE_PROJECT_ID`).
2. `firestore.rules` from this branch deployed to **that staging project only** (`firebase deploy --only firestore:rules`, using the keyless staging flow in `docs/contact-hub/STICKERS_STAGING_SETUP.md`).
3. Netlify edge functions enabled on the site, and the Firebase project's API access for unauthenticated Firestore REST reads verified.

## Test results (this branch)
- Rules, emulator: `my-card.mjs` 47 / `my-card-share.mjs` 42 / `my-card-share-service.mjs` 22; `cases` 218, stickers 282, sticker services 19, flag parity 27, write semantics 20. All pass; CI runs them.
- Unit: My Card, vCard, edge function, takedown and signup suites. See the full-run line in the PR.
- Build: `vite build` succeeds with the flag on.

## Security verification (plan section: invariants)
| # | Invariant | Where enforced / tested |
|---|---|---|
| S1 | A public ID belongs only to its owner, forever | registry create-once; `my-card-share.mjs` S1 cases |
| S2 | No one can claim, overwrite or delete another's ID | S2 cases (cross-account, anonymous) |
| S3 | Reset Link retires the old ID atomically and it can never return | S3 cases + service "Reset Link" case |
| S4 | No standalone public delete leaves an inconsistent state | S4 cases |
| S5 | A live card never has a stale or missing public copy | S5 cases; service saves-while-live |
| S6 | Stale builds and revisions can't bypass | S6 cases; old-build overwrite refused |
| S7 | Suspended / taken-down can't publish | S7 cases; service `sharing-blocked` |
| S8 | Suspension and deletion remove public access | S8 case; `adminSuspendAccount`, `adminTakedownMyCard` |
| P1 | Anonymous can't read private cards, can't list public | P1 cases |
| P2 | Public copy holds only authorized fields (8 fields + 5 links) | P2 cases (both directions), builder-vs-rules combination case |
| P3 | Private removes it everywhere | P3 cases + `no-store` on every `/c/*` response |
| P4 | Nothing must stay public | P4 cases (turn off / save and turn off always allowed) |
| P5 | One filter for every output | page, `.vcf`, photo and tags are built only from the public copy (edge tests) |
Rules budget: Firestore's 1000-expression limit per request is respected even for Reset Link with all five links and a photo (tested). `myCardRules.js` and the rules share limits; a link that is unchanged is not re-validated (`validLinkSlot`).

## Needs a person (the short list)
1. Complete the staging setup above.
2. On your own phone: open My Card, **Turn on sharing**, **Show QR**; scan it with a second phone's normal camera; tap **Save to Contacts**; send the card by text from **Share My Card**.
3. `curl -I https://<staging>/c/<id>` shows `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; and confirm the global CSP in `netlify.toml` doesn't override the edge function's.
4. Preview matrix: iMessage, WhatsApp, Slack, LinkedIn DM, Gmail, Android Messages (record what each shows and how long it keeps a preview).
5. Confirm `/c/` is unused on the production domain before any QR is printed.
6. Billing budget alert on both Firebase projects (direct Firestore REST reads, Escalation 2). Account deletion has no flow in code: **run `adminTakedownMyCard` before any manual deletion** (Escalation 1).

## Release (after explicit approval only)
Deploy rules to `idynify-scout-dev`, turn on `VITE_MY_CARD_SHARING` and `MY_CARD_SHARING_ENABLED` in production, verify with a demo account.
**Rollback:** turn both flags off and redeploy the same commit (minutes). If needed redeploy the previous rules so public reads stop. Existing private cards are never touched.

## Later (not in scope)
Report-abuse flow; per-link icons and click counts; wallet passes; NFC.

## Staging verification (2026-11-28)

Target: Netlify site `idynify-staging` (no repo, no custom domain), alias `my-card-share`, Firebase `idynify-staging`.
Production: untouched (not deployed, rules not deployed, flags off).

- Rules deployed to `idynify-staging` only, with the guarded `stagingRulesDeploy.mjs` (validate, then apply).
- Site variables added: `MY_CARD_SHARING_ENABLED=true`, `MY_CARD_FIREBASE_PROJECT_ID=idynify-staging`. Nothing else changed.
- Alias deploy (draft, not published): `https://my-card-share--idynify-staging.netlify.app`.
- Demo account (fictional data) published a card through the app's own service against the staging rules.
- `/c/<id>`: 200, page title and preview tags built from the public copy, links on the alias origin.
- `/c/<id>/contact.vcf`: 200, `text/vcard`, attachment, fictional data only.
- Unknown ID and malformed ID: the same 404 page.
- Headers on the page: edge CSP (`default-src 'none'`) is NOT overridden by the site-wide policy; `no-store`, `no-referrer`, `nosniff`, `noindex`, HSTS.
- Built bundle names `idynify-staging`, not the production project.
- Finding: an account with no `users/{uid}` document cannot publish (rules deny; real signups have the document).
- Finding: `netlify dev` hands edge functions only UI/account/add-on/`.env` variables, so `/c/` cannot be exercised through the local launcher.
- Still to do: add the alias host to Firebase Authorized domains (owner), phone and preview-matrix checks, screenshots.
