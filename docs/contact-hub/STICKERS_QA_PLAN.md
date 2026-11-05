# Stickers: final manual QA plan (staging only)

**Purpose:** sign off native stickers (ADR-007: S2–S7) before any production rules deploy or flag change.
**Where:** only in the isolated staging Firebase project (`STICKERS_STAGING_RUNBOOK.md`). Never on production Firebase, a deploy preview, or a branch deploy of the production site.
**Data:**
- only the test accounts and test contacts created in staging (runbook §3.2–§3.3)
- no production data and no Contact Hub data, copied or imported
- the "Contact Hub" experience is the native People and Contact Profile, on the contacts the test accounts create

**Build under test:** `main` at the commit named on the results sheet (S5–S7 merged). Record it before starting.

**Evidence for every check:** pass or fail, a screenshot, and for a failure the steps, expected and actual results, and console output (codes only; sticker code logs nothing identifying).

---

## 0. Entry criteria (all must hold before step 1)

| # | Check | How |
|---|---|---|
| E1 | The staging project exists, with Firestore (native mode) and Email/Password sign-in enabled | Firebase console |
| E2 | The env file passes the preflight | `node scripts/staging/stagingPreflight.mjs --env=…` prints **Preflight passed.** |
| E3 | The rules on staging are `main`'s | `node scripts/staging/stagingRulesDeploy.mjs --env=… --project=<staging-id> --apply`, from `main` at the commit under test |
| E4 | **One project everywhere** | Browser: every `firestore.googleapis.com` request names `projects/<staging-id>`. Functions: the preflight's `same-project` check. Sign-in: the preflight's `auth-domain` check, and the login page's auth requests go to `<staging-id>.firebaseapp.com`. Rules: the deploy wrapper printed `Target: <staging-id>`. |
| E5 | Test accounts exist: QA-Admin (`role: 'admin'`), QA-Beta, QA-User, QA-Other | runbook §3.2 |
| E6 | Test contacts: import `docs/staging/synthetic-contacts.csv` (30 fictional people, `example.test` addresses) as QA-Beta; archive one; add tags to a few; a few contacts for QA-Other | runbook §3.3 |

If any entry check fails: stop. Do not continue against a partly isolated setup.

---

## 1. Rollout and access

Run with the rollout tool (`scripts/staging/stickersStaging.mjs`), reloading after each mode change.

| ID | Mode | Steps | Pass |
|---|---|---|---|
| Q1.1 | `off` (no document) | Sign in as each of QA-Admin, QA-Beta, QA-User; open People and a Contact Profile | No Stickers row, filter, card chips, bulk action or Stickers view, for anyone |
| Q1.2 | `internal` | Same | QA-Admin sees all sticker surfaces; QA-Beta and QA-User see none |
| Q1.3 | `beta` + QA-Beta enrolled | Same | QA-Admin and QA-Beta see them; QA-User does not |
| Q1.4 | `on` | Same | Everyone sees them |
| Q1.5 | every mode | QA-Admin views as QA-Beta (admin tools) | No sticker surface while viewing as; QA-Beta's own session (another browser) unaffected |
| Q1.6 | `beta` | QA-Beta has a profile open; the operator unenrolls QA-Beta; QA-Beta adds a sticker | "Stickers can't be changed right now."; sticker surfaces disappear; nothing written (check the contact in the console) |
| Q1.7 | `on` | QA-Other opens a link `…?sticker=<QA-Beta's sticker id>` | "That sticker is archived or no longer exists."; everyone shown; QA-Beta's sticker never appears |

## 2. Contact Profile (S5)

As QA-Beta, mode `beta`, desktop and then a phone (or 390 px wide).

| ID | Steps | Pass |
|---|---|---|
| Q2.1 | Open a contact | The Stickers row sits directly above Tags; tags look and work as before |
| Q2.2 | `+ Sticker` → choose one | The chip shows pending, then final; reload: still there |
| Q2.3 | Type a new name → Create | The sticker is created in the next palette color and added |
| Q2.4 | Type an existing name in different case | "“Board” already exists — use it"; no duplicate created |
| Q2.5 | Remove a chip → Undo within 6 s | Removed, then restored |
| Q2.6 | Two tabs: archive a sticker in tab B (Stickers view) while adding it in tab A | Tab A: "That sticker was archived…"; no chip; the stored contact is consistent |
| Q2.7 | Keyboard only: Tab to `+ Sticker`, Enter, type, arrows, Enter, Escape | Every step works; focus returns to `+ Sticker` |
| Q2.8 | Phone | Picker is a bottom sheet; every target is easy to tap; no sideways scroll |
| Q2.9 | (Optional) a contact with 50 stickers | Adding and creating disabled, with the limit line |

## 3. People (S6)

| ID | Steps | Pass |
|---|---|---|
| Q3.1 | Open the Sticker filter | Active stickers, each with a count matching the cards; archived contacts not counted |
| Q3.2 | Choose one | Only those people; the address bar gains `?sticker=…`; reload keeps it; ✕ clears it |
| Q3.3 | Sticker filter plus Tag filter | Only people with both; the filter badge counts 2; "Clear filters" clears both |
| Q3.4 | Search a sticker name that no contact's name, title or company contains (not "Board" or "Volunteer": the synthetic contacts include Board Chairs and Volunteer Leads) | Only that sticker's holders listed; an archived sticker's name matches nobody |
| Q3.5 | Cards and List | Up to 2 chips on a card, 1 on a row, "+n" for more; before tags |
| Q3.6 | Start Cadence → select about 25 → Add sticker → choose | "Adding… n of 25", other bulk buttons disabled, then the summary |
| Q3.7 | Repeat Q3.6 while another tab archives that sticker | Late ones counted "not changed" with the archived message; Details names them; the selection narrows to them; Retry runs for them only |
| Q3.8 | **Side panel:** open a person (Engage), add or remove a sticker in the panel | Their People card updates at once, with no reload |
| Q3.9 | Phone | The filter list is easy to tap; the bulk bar wraps within the screen |
| Q3.10 | Scout, Hunter, Sniper, Basecamp lists | No sticker surfaces there (People only) |

## 4. Stickers view (S7)

| ID | Steps | Pass |
|---|---|---|
| Q4.1 | People → Stickers | One tile per active sticker, name order, counts match Q3.1 |
| Q4.2 | New sticker (name, color, emoji, description) | Created; appears in pickers and the filter |
| Q4.3 | Edit a sticker's color, and then its name | Saved; chips everywhere update; a name another sticker has is allowed with a note |
| Q4.4 | Archive a sticker with members (confirm) | Gone from pickers, filters, chips; "Archived (n)" lists it; members' contacts still hold it (console) |
| Q4.5 | Restore it | Back everywhere, with every member, no re-adding |
| Q4.6 | Click a tile | Cards (or List, if last used) filtered by it |
| Q4.7 | Keyboard and phone | Menu and dialogs work by keyboard; 2 columns on a phone; the dialog fits |

## 5. Rollback drills

| ID | Steps | Pass |
|---|---|---|
| Q5.1 | Mode `off` (rollout tool), reload | All sticker surfaces gone; contacts, tags, notes, timeline work |
| Q5.2 | Mode back to `beta` | The same stickers come back |
| Q5.3 | Edit `firestore.rules` locally so `stickerRulesEnabled()` returns false, then deploy it to **staging** with the wrapper and `--allow-modified-rules`; mode `on` | Every sticker add, remove, create and edit refused; contact edits, notes, timeline, archive still work |
| Q5.4 | Discard the local edit (`git checkout firestore.rules`) and redeploy `main`'s rules to staging | The wrapper names the commit with no local changes; stickers work again |

## 6. Regression (no stickers involved)

| ID | Steps | Pass |
|---|---|---|
| Q6.1 | Tags: add, remove, tag filter, import group view | As before |
| Q6.2 | Profile edits: name, title, phone, email (and B-R1's behaviour if merged) | As before; email edits keep `email_normalized` in step (console) |
| Q6.3 | Add Manually, CSV import into staging (test file only) | Contacts created as before; none created with stickers |

---

## Exit criteria and sign-off
- Every Q-check passes, or has a recorded, accepted exception.
- No console errors from sticker code other than expected refusal codes.
- The results sheet records: the commit, the staging project id, the date, who ran it, and the screenshots.
- **After sign-off, not before:**
  - the production rules deploy (separate approval)
  - creating the production flag document in `internal` or `beta` (separate approval, S11 pilot)

## Bug report
Title, Q-id, account, mode, steps, expected, actual, screenshot, console lines (codes only), commit, staging project id.
