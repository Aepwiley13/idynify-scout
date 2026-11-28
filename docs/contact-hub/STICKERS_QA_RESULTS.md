# Stickers: QA results and release tracker (general release, mode `on`)

Results sheet for `STICKERS_QA_PLAN.md` and the gate and approval record for `STICKERS_PILOT_RUNBOOK.md` (draft PR #778).
Scope of this release (owner decision, 2026-11-27): **mode `on` in production for every signed-in user**, shipped together with **Free Contact Hub for every registered user** (#862, #863). The owner-only `internal` pilot was superseded before activation; production was never set to `internal`.

| | |
|---|---|
| Staging project | `idynify-staging` (hosted `https://idynify-staging.netlify.app`) |
| Build under test | `main` `fc780ee` (staging deploy `6b0895e97b2140e3166a693f`) |
| Production build | `e89e9dc` (Netlify, published and locked). `e89e9dc..fc780ee` changes 6 files, all Gmail staging tooling and tests; **no Stickers, rules, flag or impersonation code differs** |
| Run by | Aaron (owner), with Claude; dates 2026-11-25 to 2026-11-26 (America/Denver) |

## 1. Staging results

### 1.1 Hosted UI session (earlier, separate session, build `fc780ee`)
Passed: sticker creation (Q2.2, Q2.3), multi-contact assignment (Q3.6), filtering (Q3.1, Q3.2), removal (Q2.5), persistence after reload, no console errors. Q1.3 (`beta` with enrolled accounts) is the standing staging configuration.

### 1.2 Targeted access checks (`04-access-checks.mjs`, 2026-11-27T02:45Z UTC, 22/22 passed)
Automated against the hosted `stickersConfig` and the deployed staging rules, with QA-Admin (`role: admin`), QA-Beta (enrolled) and QA-User (ordinary). Signed in by short-lived custom tokens; no passwords.

| Q | Result | Evidence |
|---|---|---|
| control | PASS | `beta`: QA-Beta re-saves its own sticker → allowed (refusals below are about access, not request shape) |
| Q1.1 `off` | PASS | `stickersConfig` → `enabled:false` for admin, beta and ordinary; beta edit and admin create **denied** by rules |
| Q1.2 `internal` | PASS | admin `enabled:true, readOnly:false` and creates a sticker; enrolled non-admin and ordinary `enabled:false`, writes **denied** |
| Q1.5 view-as (in `internal`) | PASS | admin viewing as QA-Beta: `readOnly:true`; admin edit of QA-Beta's sticker **denied** |
| Q6.1/Q6.2 tags and profile | PASS | QA-Beta edits title and tags on a contact holding stickers while sticker writes are refused → allowed; restored exactly; stickers untouched |
| Q5.1/Q5.2 off and back | PASS | stickers (7) and memberships (6 contacts) identical before, during and after `off` |
| restore | PASS | staging back to `beta`; both enrollments unchanged; QA-Beta `enabled:true` |

Only artifact left in staging: one sticker "QA gate (internal)" on QA-Admin (the Q1.2 proof). Snapshots before and after differ by that line only.

UI surfaces in §1 were verified at the decision layer (`stickersConfig` and the rules). The UI renders sticker surfaces only from `stickersConfig` (`useStickersAvailability`), and the parity suite ties the two together.

### 1.3 General-release checks, mode `on` (`08-general-release.mjs`, 2026-11-28T00:22Z UTC, 33/33 passed)
Hosted build, live staging rules, synthetic accounts labelled the way the app does (`hasCompletedPayment`, `subscriptionTier`): 2 Free, 3 Starter (one admin). Staging has no Pro synthetic account; see §1.5.

| Check | Result | Evidence |
|---|---|---|
| R1 decision in `on` | PASS | `stickersConfig` → `enabled:true, readOnly:false` for every account, Free and Starter |
| R2 per plan | PASS | Free and Starter create own stickers; add to and remove from own contacts, stored and restored |
| R3 isolation | PASS | another account's stickers unreadable (403); create, edit and membership on another account **denied** |
| R4 signed out | PASS | `stickersConfig` 401; Firestore write 403 |
| R5 bulk with archive (Q3.7) | PASS | 10-contact bulk: adds 1–5 allowed; archived after 5; adds 6–10 **denied**; earlier 5 kept; then removed, every contact back to original |
| R6 import shape (Q6.3) | PASS | a new contact carrying stickers **denied** |
| R7 rollback on → off → on (Q5.1–5.2) | PASS | everyone disabled; writes denied; 12 stickers and 6 memberships identical throughout |
| R8 lockdown drill (Q5.3–5.4) | PASS | lockdown ruleset released: sticker writes **denied** in `on`; original ruleset `66bf0de4…` re-released by name; writes allowed again |
| restore | PASS | staging back to `beta`, both enrollments untouched; only new data: 5 QA-named stickers |

CI emulator suite (runs in mode `on`, green on `fc780ee` and `e89e9dc`): isolation, signed-out, archived, create-with-stickers, concurrent tabs, off and missing flag. 490 sticker component tests pass: keyboard flows for picker, row, wall, People (Q2.7, Q4.7 keyboard) and the picker's phone bottom sheet.

### 1.4 Production final preflight (`05-prod-preflight.sh`, 2026-11-28T00:21Z UTC, read only, passed)
Live rules sha `23978f71fd78` (ruleset `a76e110f…`, unchanged since 2026-11-25); one admin (owner, super_admin); flag absent; 0 enrollments; 0 stickers; `stickersConfig` live on idynify.com, 401 to anonymous callers.

### 1.5 Plan coverage
Sticker access never reads plan, tier or payment (`src/constants/stickersAccess.js`, `stickersConfig`, `firestore.rules`). Pro and Starter differ only in credit allotment (1,250 vs 400) and checkout upgrade; route access treats both as paid (`isPaidPlan`), and the shell-gate suite uses a Pro account as its paid fixture. Live staging coverage: Free and Starter. Pro: verified by code and tests, plus the owner's own production account after launch.

### 1.6 Open before launch
- Phone layouts in a real browser: Sticker Wall (Q4.7), People bulk bar (Q3.9), picker (Q2.8): `11-mobile-shots.mjs`.
- Production App Check and signup protections: `11-prod-signup-protection.sh`.
- Free welcome email copy: owner approval.

## 2. Exceptions

| Check | Status |
|---|---|
| Q1.4 mode `on` | **closed** by §1.3 |
| Q1.5 view-as outside `internal` | accepted: same server path in every mode (tested in `internal`, §1.2) |
| Q2.7, Q4.7 keyboard | **closed** by component tests (§1.3) |
| Q2.8, Q3.9, Q4.7 phone layouts | open: §1.6 |
| Q3.7 bulk during archive | **closed** by R5 |
| Q5.3, Q5.4 lockdown drill | **closed** by R8 |
| Q6.2 email part | accepted: not Stickers code |
| Q6.3 import | **closed** by R6 and CI |
| Pro on live staging | accepted: plan-independent (§1.5) |

Known, not blocking: bulk "Add sticker" exists only on Scout People (`/people`, paid); Contact Hub People offers single-contact stickering. Scout's bulk-select checkboxes are `div`s without keyboard access (pre-existing, Scout).

## 3. Runbook entry gates

| Gate | Status | Evidence |
|---|---|---|
| G1 staging QA | PASS (phone layouts pending, §1.6) | §1.1–§1.3 |
| G2 QA fixes (#777) merged, CI green | PASS | S1–S7 and #777 merged 2026-11-05 |
| G3 production build | PASS | Netlify production `e89e9dc` contains S1–S7 and #777; Stickers code identical to the tested build |
| G4 rules diff | PASS | live ruleset `a76e110f…` == `main` `fc780ee` (629 lines, sha `23978f71fd78`); no rules deploy needed (runbook §2 not required) |
| G5 admin list | PASS | exactly one: `super_admin` `7g5gbYiwLOdIRdCTtogZ7Wn3hG23` (owner); rechecked 2026-11-28 (§1.4) |
| G6 lockdown variant | PASS | prepared locally, one-line diff, not deployed |
| G7 rollback owner | Aaron | level 2 = `mode "off"` (`07-prod-rollback-off.sh ROLLBACK`); level 3 lockdown rehearsed (R8) |

## 4. Approval record (runbook §8)

| Step | Approved by | Date | Evidence / notes |
|---|---|---|---|
| Release scope: Free Contact Hub for all + Stickers `on` | Aaron | 2026-11-27 | supersedes the owner-only pilot |
| Free plan in production (`VITE_FREE_PLAN=on`, #862) | Aaron | 2026-11-27 | merge and publish still need release approval |
| Production Free test account (live verification) | Aaron | 2026-11-27 | create at launch |
| G1–G7 entry gates | | | §3 |
| §2 exceptions | | | |
| Free welcome email copy | | | |
| Publish production build (#862 + #863) | | | |
| `feature_flags/stickers.mode = "on"` | | | `12-prod-activate-on.sh` log |
