# Stickers: limited pilot runbook (S11)

**Status: DRAFT for owner approval.** Nothing here may be run until every entry gate in §1 is checked and the owner has signed the approval record (§8). Writing or merging this runbook enables nothing.

**Production is `idynify-scout-dev`** (ADR-006: the name is historical; it is production).

**What the pilot is:**
- Native stickers (ADR-007, S2–S7) for a small, named set of production accounts: first the owner (mode `internal`), then designated accounts (mode `beta`).
- Pilot users get the Contact Profile Stickers row, the People sticker filter, search, card chips and bulk add, and the Stickers view.
- Not included: CSV import and export (S8), timeline activity types (S9), Barry reading stickers (S10), mode `on`.
- No data migration, no backfill, no Contact Hub data. Pilot users sticker their own existing contacts.

**What changes for everyone else:**
- Nothing visible: with no enrollment and no admin role, every sticker surface renders nothing.
- The **production rules deploy (§2) is the one step that affects every user.** It replaces the whole ruleset, so it gets its own gate and diff review.

---

## 1. Entry gates

All must be checked, with evidence, before §2.

| # | Gate | Evidence |
|---|---|---|
| G1 | **Staging QA passed:** every check in `STICKERS_QA_PLAN.md` passed in the isolated staging project, exit criteria met | Results sheet: staging project id, build SHA, date, screenshots |
| G2 | The QA fixes (#777) are merged, and `main` CI is green at the pilot SHA | CI run link |
| G3 | Netlify's production deploy is at the pilot SHA (frontend and `stickersConfig`) | Netlify deploy id, commit SHA |
| G4 | **Production ruleset diff reviewed** (§2.1). Every difference that is not a sticker section is listed and accepted, or the pilot stops | The diff, attached |
| G5 | **Admin accounts listed:** every production `users/{uid}` with `role` `admin` or `super_admin`. In `internal` and `beta` they all get stickers | The list (uids only) |
| G6 | **The lockdown variant is prepared:** a copy of `firestore.rules` at the pilot SHA in which `stickerRulesEnabled()` returns `false`, diffed against the live file (one line). Not deployed | The one-line diff |
| G7 | Rollback owner named and reachable during each step | Name |

---

## 2. Production rules deploy (owner runs, separate approval)

### 2.1 Diff first
The deploy replaces the **entire** Firestore ruleset, not just the sticker sections.

1. Copy the **live** production ruleset: Firebase console → Firestore → Rules. Save it outside the repo as `rules-live-<date>.txt`. This is also the record of what ran before.
2. Diff it against `firestore.rules` at the pilot SHA.
3. Expected: the ADR-007 sticker sections (`stickers`, `sticker_enrollment`, `feature_flags`, the contact membership guard).
4. **Anything else goes live too.** `firestore.rules` changed several times in October 2026, and it is not recorded which of these production runs. Each must be either already live or explicitly accepted:
   - `594c879`: clients can no longer set role, permissions, suspension or billing fields
   - `ac630f7`: signup only on the sold tiers
   - `91ad838`: Capture server-only rules
   - `917fbdc`: LinkedIn connect

   **`594c879` matters for stickers.** Admin access comes from `users/{uid}.role`. Without that rule a user could give themselves a role and, in `internal` or `beta`, stickers. The pilot needs it live.

### 2.2 Deploy
From a **clean checkout of the pilot SHA** (no local changes; the repo has no `.firebaserc`, so the project is always explicit):
```bash
git status --porcelain
```
The command must print nothing. Then:
```bash
npx --yes firebase-tools@15 deploy --only firestore:rules --project idynify-scout-dev
```
`feature_flags/stickers` must **not** exist yet, so stickers stay off for everyone.

### 2.3 Check straight after (stickers still off)
On the owner's account:
- People opens and lists contacts.
- A contact opens; a tag add and remove saves; a note saves.
- Adding a contact works.
- Netlify function logs: no new `stickersConfig` `internal_error`.
- Firebase console → Firestore → Usage: no spike in denied requests.

### 2.4 If a non-sticker rule breaks something
- **Roll forward:** fix the rule, keep the sticker sections, and redeploy. Prefer this.
- Restoring `rules-live-<date>.txt` would also remove the sticker guard, which ADR-007 forbids as a rollback. It is an **outage decision for the owner only**, with `feature_flags/stickers` absent or `off` first, and is recorded in §8.

---

## 3. Owner only (mode `internal`, separate approval)

1. Firebase console → Firestore → create `feature_flags/stickers` with the field `mode` = `"internal"` (string). Clients cannot write this document; only the console or the Admin SDK can.
2. Who now sees stickers: exactly the G5 admin list. If that is more than the owner, stop and decide first.
3. Smoke test on the owner's own contacts:
   - create a sticker named "Pilot check" from a profile
   - remove it, then press Undo
   - filter People by it
   - bulk add it to 2 or 3 contacts
   - archive it in the Stickers view, then restore it

   Record each step.
4. Hold for 24 to 48 hours of normal use.

---

## 4. Designated accounts (mode `beta`, separate approval)

1. Fill in the pilot list in §8: uid, who, and confirmation that they agreed to the pilot.
2. For each: create `sticker_enrollment/{uid}` with `stage` = `"beta"`.
3. Set `feature_flags/stickers.mode` to `"beta"`.
4. Each pilot user confirms they see the Stickers row and the People filter. No one outside the admin list and the pilot list should see them.
5. Duration: one to two weeks, with a check-in at the end of each week.

---

## 5. Monitoring and stop conditions

**Watch:**
- **Netlify** (the site's function logs and usage for `stickersConfig`): invocations, and logged outcomes. Only refusals and errors are logged: `forbidden`, `unauthorized`, `internal_error`. This is also the measurement for `STICKERS_CONFIG_READS.md`.
- **Firestore** → Usage: reads, writes and denied requests stay in their usual range.
- **Pilot users' reports.** In the browser console, sticker failures log `[stickers] {action, code, reason}`, codes only.

**Stop and roll back (§6) on any of:**
- a sticker on a contact the user did not choose
- anyone outside the admin and pilot lists seeing sticker controls
- a permission error on any non-sticker edit
- a sticker or membership lost
- a `stickersConfig` `internal_error` rate above a few per day

---

## 6. Rollback (never broadens)

| Level | Action | Effect | Deploy? |
|---|---|---|---|
| 1 | Delete `sticker_enrollment/{uid}` | The rules refuse that user's sticker writes at once; their controls disappear on the next page open or refused write | No |
| 2 | Set `feature_flags/stickers.mode` to `"off"` | The rules refuse every sticker write at once; controls disappear on each user's next page open or refused write | No |
| 3 | Deploy the G6 lockdown variant | Every sticker write is refused by the rules; everything else unchanged | Rules |

- Stored stickers and memberships are **kept** at every level. Undo the level to bring them back.
- **Never** revert the sticker rules section and never delete sticker data. A revert would let owners write stickers and memberships unchecked (ADR-007, "Rollback never broadens").
- Frontend: the UI renders nothing while unavailable, so a code revert is needed only for a defect that shows with stickers off.

---

## 7. Exit

- **Pilot passes:** no stop condition over the period, and pilot users' feedback recorded.
- **Widening** (more accounts, or mode `on`) is a separate decision with its own approval. It is not part of this runbook.

---

## 8. Approval record

| Step | Approved by | Date | Evidence / notes |
|---|---|---|---|
| G1–G7 entry gates | | | |
| §2 production rules deploy | | | |
| §3 mode `internal` | | | |
| §4 mode `beta` and the pilot list below | | | |
| Any §2.4 or §6 action | | | |

**Pilot list:**

| uid | Who | Agreed to the pilot |
|---|---|---|
| | | |
