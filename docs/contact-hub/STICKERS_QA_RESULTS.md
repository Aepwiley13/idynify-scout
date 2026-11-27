# Stickers: QA results and release tracker (S11 owner-only pilot)

Results sheet for `STICKERS_QA_PLAN.md` and the gate and approval record for `STICKERS_PILOT_RUNBOOK.md` (draft PR #778).
Scope of this release: **mode `internal` in production, owner only.** Widening to `beta` or `on` is a separate decision.

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

## 2. Exceptions (accepted only for the owner-only `internal` pilot)

| Check | Not run | Why acceptable for this pilot |
|---|---|---|
| Q1.4 | mode `on` | Not used in this release |
| Q1.5 in `off`/`beta`/`on` | view-as tested in `internal` only | Same server code path in every mode; `off` has no surfaces at all |
| Q2.7, Q4.7 | keyboard-only flows | Owner is the only user; fix before widening |
| Q2.8, Q3.9, Q4.7 | phone layouts | Owner is the only user; fix before widening |
| Q3.7 | bulk add during concurrent archive | Single user; data-safe by rules |
| Q5.3, Q5.4 | lockdown rules drill on staging | Level-3 rollback prepared (G6, one line) but not rehearsed; levels 1–2 need no deploy |
| Q6.2 (email part) | `email_normalized` stays in step | Not Stickers code; unchanged since before S2 |
| Q6.3 | Add Manually / CSV import | Not Stickers code |

**Required before widening to `beta`:** close Q2.7, Q2.8, Q3.7, Q3.9, Q4.7, Q5.3–Q5.4.

## 3. Runbook entry gates

| Gate | Status | Evidence |
|---|---|---|
| G1 staging QA | PASS with §2 exceptions | §1 |
| G2 QA fixes (#777) merged, CI green | PASS | S1–S7 and #777 merged 2026-11-05 |
| G3 production build | PASS | Netlify production `e89e9dc` contains S1–S7 and #777; Stickers code identical to the tested build |
| G4 rules diff | PASS | live ruleset `a76e110f…` == `main` `fc780ee` (629 lines, sha `23978f71fd78`); no rules deploy needed (runbook §2 not required) |
| G5 admin list | PASS | exactly one: `super_admin` `7g5gbYiwLOdIRdCTtogZ7Wn3hG23` (owner) |
| G6 lockdown variant | PASS | prepared locally, one-line diff, not deployed |
| G7 rollback owner | Aaron | rollback level 2 = `feature_flags/stickers.mode = "off"` (script `07-prod-rollback-off.sh`) |

## 4. Approval record (runbook §8)

| Step | Approved by | Date | Evidence / notes |
|---|---|---|---|
| G1–G7 entry gates | | | §3 |
| §2 production rules deploy | n/a | | live rules already == `main` |
| §3 mode `internal` | | | final preflight log, activation log |
| §2 exceptions (owner-only scope) | | | |
