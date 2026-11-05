# Stickers: isolated staging runbook (manual QA)

**Who this is for:** the engineer who sets up staging and the person who runs the manual checks.
**Rule:** manual feature QA happens **only** in an isolated, non-production Firebase project. Never on production, and never on a Netlify deploy preview or branch deploy of the production site. Those resolve to the production Firebase project (`idynify-scout-dev` **is production**, despite its name; ADR-006, `src/firebase/config.js`).

> **Status (2026-11-05): the staging project does not exist yet.**
> Creating it is the open decision in Aepwiley13/idynify-scout#664, and it needs the owner. Until it exists:
> - the emulator suites in CI are the only test environment for stickers
> - no manual sticker QA happens anywhere
> - every step below is ready to run once the project exists

---

## 1. What "isolated" means

| # | Requirement | How to check |
|---|---|---|
| I1 | **A separate Firebase project.** Its id contains `staging` or `stg`, and it is not `idynify-scout-dev`. | Firebase console, project settings |
| I2 | **No production or Contact Hub data.** Only the test accounts and test contacts made here. | Nothing is imported except the test CSV in §3.3 |
| I3 | **Its own service account.** The key file stays on the operator's machine. It is never committed, never put in a client build, never pasted into chat. | `git status` is clean; the key path is outside the repo |
| I4 | **The app points at it, front and back.** Either local `netlify dev` with a staging `.env` (recommended: no hosting to set up), or a **separate** Netlify site. Not a context on the production site, because its other variables (Gmail, Stripe, Apollo) are production. | §2 pre-flight, every session |
| I5 | **Integrations unset.** Gmail, Apollo, Stripe, Twilio and Barry keys are left empty. Stickers need none of them. | The staging `.env` contains only the variables in §3.1 |

---

## 2. Pre-flight, at the start of every session

1. **Front end.** In DevTools → Network, filter `firestore.googleapis.com`. Every request path contains `projects/<staging-id>/`.
2. **Back end.** `FIREBASE_PROJECT_ID` in the environment serving the functions is `<staging-id>`. For `netlify dev`, that's the `.env` you started it with.
3. **Signed in as a test account** (§3.2), never a real one.

**If any check shows `idynify-scout-dev` or anything not ending in your staging id: stop, sign out, and report it. Do not continue.**

---

## 3. One-time setup (once the project exists)

### 3.1 Environment (`.env` for `netlify dev`, outside git)
```
VITE_FIREBASE_API_KEY=<staging web config>
VITE_FIREBASE_AUTH_DOMAIN=<staging-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<staging-id>
VITE_FIREBASE_STORAGE_BUCKET=<staging bucket>
VITE_FIREBASE_MESSAGING_SENDER_ID=<staging sender id>
VITE_FIREBASE_APP_ID=<staging app id>
FIREBASE_PROJECT_ID=<staging-id>
FIREBASE_CLIENT_EMAIL=<staging service account email>
FIREBASE_PRIVATE_KEY=<staging service account key>
```
- `vite.config.js` refuses to build without the six `VITE_FIREBASE_*` values.
- `requireProjectId()` refuses to start a function without `FIREBASE_PROJECT_ID`.
- There is no fallback to production on either side.

### 3.2 Test accounts (staging Auth, email and password)

| Account | Set up | Used for |
|---|---|---|
| **QA-Admin** | In the staging console, `users/{uid}.role = 'admin'` | `internal` mode; impersonation |
| **QA-Beta** | Enrolled with the tool (§3.4) | `beta` mode; most UI checks |
| **QA-User** | Nothing | Not enrolled: sees nothing until `on` |
| **QA-Other** | Nothing | Cross-user checks |

Record each uid; the tool takes uids.

### 3.3 Test contacts
- Sign in as QA-Beta and add about 30 contacts with **Scout+ → Add Manually**, or import `docs/staging/controlled-recipients-template.csv` with its placeholders replaced by test addresses.
- Archive one contact.
- Add a few tags to some contacts, so the "tags untouched" checks have something to compare.

### 3.4 Rules and the rollout mode

**Rules.** Deploy to **staging only**, from the S3 branch (which contains S2 and S4), and only with the owner's approval for this staging deploy:
```bash
npx --yes firebase-tools@15 deploy --only firestore:rules --project <staging-id>
```
- The repo has **no `.firebaserc`**, so a deploy without `--project` fails. Keep it that way: never run `firebase use --add`.
- Deploy `firestore:rules` only: no indexes, functions or hosting.

**Rollout mode and beta list.** Use `scripts/staging/stickersStaging.mjs`, which writes only `feature_flags/stickers` and `sticker_enrollment/{uid}`. It refuses any target it cannot prove is non-production:
- `--project` must be listed in `STICKERS_STAGING_PROJECTS`
- the id must contain `staging` or `stg`
- it must equal the `project_id` of the service account in `GOOGLE_APPLICATION_CREDENTIALS`
- it must differ from `PRODUCTION_FIREBASE_PROJECT_ID`

It is a dry run unless `--apply` is passed.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/staging-service-account.json
```
```bash
export STICKERS_STAGING_PROJECTS=<staging-id>
```
```bash
export PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev
```
```bash
node scripts/staging/stickersStaging.mjs --project=<staging-id> --mode=beta --enroll=<QA-Beta uid>
```
Read the plan it prints, then run the same command with `--apply`.

---

## 4. Sessions

Reload the app after each mode change: the availability answer is read once per page.

### 4.1 Rollout matrix (S3 + S2)

| Mode | QA-Admin | QA-Beta | QA-User |
|---|---|---|---|
| `off` (or no document) | no controls | no controls | no controls |
| `internal` | controls | no controls | no controls |
| `beta` | controls | controls | no controls |
| `on` | controls | controls | controls |

**Pass:** each cell is as shown. This is the same table the emulator proves (`stickers-flag-parity.mjs`); staging confirms that the deployed rules, functions and app agree.

### 4.2 Read-only impersonation
- In every mode, QA-Admin starts **view as QA-Beta** from the admin tools.
- **Pass:** no sticker row, filter, bulk action or Stickers view, while QA-Beta's own session in another browser does show them.

### 4.3 Revocation mid-session
1. Mode `beta`. QA-Beta opens a contact.
2. The operator runs `--unenroll=<QA-Beta uid> --apply`.
3. QA-Beta adds a sticker.

**Pass:** "Stickers can't be changed right now."; the controls disappear (AT-5-10); nothing is written.

### 4.4 Rollback drills
1. **Mode off** (no deploy).
   - With stickers on contacts, set `--mode=off --apply`, then reload.
   - **Pass:** every sticker surface is gone; contacts, tags, notes and the timeline work as before.
   - Set `--mode=beta --apply`. **Pass:** the same stickers come back.
2. **Lockdown** (rules deploy, staging only).
   - Deploy a copy of the rules with `stickerRulesEnabled()` returning `false`, with mode `on`.
   - **Pass:** every sticker add, remove, create and edit is refused; contact edits, notes, timeline and archive still work.
   - Redeploy the normal rules.

### 4.5 UI checks (once S5–S7 exist)
- Run every **[S]** test in `STICKERS_UI_SPEC.md`: AT-5-17, AT-6-12, AT-6-13, AT-7-11.
- The 50-sticker limit is proven in the emulator. In staging, check its message only if you have prepared a contact with 50.

---

## 5. Evidence
For each session record:
- the date, branch and commit
- the staging project id
- the pre-flight results (§2)
- one row per check, with pass or fail and a screenshot

Attach it to the PR under test.

## 6. Afterwards
- Set `--mode=off --apply`.
- Keep the project and its test accounts for the next round.
- Nothing is copied out of staging, and nothing is copied in except test data.

## 7. Never
- run the tool, a rules deploy or any manual check against `idynify-scout-dev`
- QA on a deploy preview or branch deploy of the production site
- import Contact Hub data
- put a service account key in the repo or a client build
- enable the flag in production: that is S11, with its own approval
