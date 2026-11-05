# Contact Hub features in IDYNIFY: revised plan (no migration)

**Date:** 2026-11-04 · **Status:** direction approved 2026-11-04. S1 contract (ADR-007, §6) proposed. S2–S4 and B-R1 are draft PRs. **Nothing merged, deployed or enabled.**
**Supersedes:** every migration part of `docs/audits/CONTACT_HUB_INTEGRATION_AUDIT.md` and `docs/contact-hub/GATE_0_1_REPORT.md`. Those documents stay as the record of what was considered.

## Scope (official change, 2026-11-04)

- The Utah Advocacy Contact Hub is a **reference application only**. Its database, contacts, stickers, history, users and Constant Contact integration stay untouched. **Nothing is read from it or copied out of it.**
- IDYNIFY gains the Hub's best capabilities **natively**, on IDYNIFY's existing contact records, in People and Contact Profile.
- **Ownership:** individual (`users/{uid}`). No team sharing, no second contact database.
- **Hub security maintenance** is an independent project, and **not a dependency** of this work. The Hub findings are recorded in the audit and still apply to the live Hub (Push to CC consent assertion, stored XSS, contact data in page source); that project owns them.

**Removed:**
- the snapshot inspector (B0, cancelled; its local commit was never pushed)
- dump scripts
- the migration engine and its review queue and manifests
- reconciliation, migration rollback and restore
- `external_ids` and `source_records`
- `addedFrom: 'utadco_hub'` and the `imported_activity` timeline type
- migration feature flags

**Kept separately:** **B-R1**, email identity consistency, as an IDYNIFY maintenance fix (§5).

---

## 1. Architecture

### 1.1 What stays exactly as it is
- **Contact identity:**
  - the ADR-002 engine, `prepareContactWrite`, `mergeIdentifiers`
  - contact protection (`contactProtection.js`) and archive (soft)
  - `notes[]` / StickyNotes, the timeline and EngagementTimeline, `emails[]` / `phones[]`
  - People (`AllLeads`) filters, search, bulk selection and export
  - ContactProfile's layout, and `openContact()` navigation
- **Scout, Hunter, Barry and Mission Control routes and behaviour:** unchanged.
- **Existing `tags[]`:** unchanged (see decision D1).

### 1.2 What is added (one collection, two contact fields)

**`users/{uid}/stickers/{stickerId}`**

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `1` | |
| `name` | string, 1–60 | Label, not identity. Two stickers may share a name; the UI warns (comparison key computed client-side, not stored). |
| `color` | `teal blue purple coral amber pink green gray` | |
| `emoji` | string ≤ 16, or null | Image icons: not in this release |
| `description` | string ≤ 280, or null | |
| `status` | `active` \| `archived` | **Never deleted.** Archived stickers are hidden from pickers and filters; memberships are kept and come back on restore. |
| `created_at`, `created_by` | server timestamp, uid | Set once; any update that changes them is denied |
| `updated_at`, `archived_at` | timestamps | |

- **ID:** a Firestore auto-ID, never derived from a count, never reused.

**On the existing `users/{uid}/contacts/{contactId}`** (optional; a missing field reads as "no stickers"):

| Field | Type | Notes |
|---|---|---|
| `sticker_ids` | `string[]`, ≤ 50 | Membership. Filtered client-side in People (People already loads every contact), so no new index is needed. |
| `sticker_assignments.<stickerId>` | `{assigned_at, assigned_by: 'user' \| 'csv_import'}` | Who added it and when |
| `sticker_change` | `{op: 'add' \| 'remove', sticker_id, at}` | The one sticker the last write changed. It lets the rules check that sticker (§1.4). |

### 1.3 Write rules (one module per concern)
- **`src/services/stickerService.js`** (registry): create, rename, recolor and emoji, archive, restore, list (live via `onSnapshot`; the collection is small).
- **`src/services/stickers/stickerCore.js`** is the **only** writer of stickers and of `sticker_ids`, `sticker_assignments` and `sticker_change`. `stickerService.js` and `contactStickers.js` bind it to the web SDK.
  - **Enforced:** `src/test/stickerWritePaths.test.js` (CI) and rule 5 of `scripts/verifyWritePaths.mjs`.
  - **No Firebase import:** Firestore arrives as an adapter, so the emulator suite runs this exact code against the real rules.
  - **Add and remove run in a transaction:**
    - read the sticker (it must exist under the same `users/{uid}` and be `active`)
    - read the contact as stored now
    - write `arrayUnion` / `arrayRemove`, the assignment entry and `sticker_change` together
  - An archive that lands at the same moment makes the add fail with "This sticker was archived." Nothing is half-written.
  - **Contention vs authorization:** a refused write is retried (re-read, re-decided, at most 4 attempts) only when the data it read has changed since the refusal. A refused read, or the same write refused twice on unchanged data, is final, reported as `read_denied` or `write_denied`. A retry never sends a weaker write.
  - **Bulk add** (People selection) runs one transaction per contact. The result lists any failures; one failure never undoes the others.
- **Contact protection:**
  - Sticker fields are never written by enrichment, identity merges, CSV merge rules or Barry. Tests pin this.
  - A future duplicate-merge (the dedup sprint) must union memberships. Recorded in the ADR.

### 1.4 Firestore rules (verified by `scripts/rules-check` in CI)
- **Generic blocks.** The 2-deep and deep generic blocks exclude `coll != 'stickers'`, the same pattern used for `lineageEvents`, so only the narrow rule applies.
- **`stickers/{id}`:**
  - read: owner
  - create: owner + enrolled + `created_by == uid` + only known fields + `status == 'active'`
  - update: owner + enrolled + only `name`, `name_key`, `color`, `emoji`, `description`, `status`, `archived_at`, `updated_at` change
  - **delete: false**
- **`sticker_enrollment/{uid}`:** no client read or write (Admin SDK only).
- **Contacts:** any write that touches a membership field must:
  - add or remove exactly one sticker, named in `sticker_change`
  - keep one assignment per sticker, with no other assignment touched
  - stay at 50 or fewer
  - when adding, name an existing active sticker of the same user (checked with `get()`)

  A contact is never created with stickers. Writes that don't touch these fields are unchanged.
- **Implemented:** S2 (#762). Verified by `scripts/rules-check/stickers.mjs`: 141 cases, each against the live rules and the lockdown variant (282 checks), including malformed and legacy contacts, the rollout matrix and shutdown.

### 1.5 Feature flag
- **Mode** in Firestore, not an env var, so the rules can read it: `feature_flags/stickers.mode` = `off` \| `internal` \| `beta` \| `on`. A missing document or any other value means `off`.
- **Enrollment.** `beta` = admins (`users/{uid}.role` in `admin`, `super_admin`) plus users in `sticker_enrollment/{uid}` with `stage: 'beta'`. Both documents are server-only.
- **One decision, two enforcers.** `decideStickerAccess()` in `src/constants/stickersAccess.js` is the decision. The rules (S2) and `stickersConfig` (S3) apply it to the same inputs, and a shared parity table is run against both.
- **Env admin lists not used.** `ADMIN_USER_IDS` / `SUPER_ADMIN_USER_IDS` are invisible to the rules, so they don't grant sticker access.
- **Client.** `useStickersAvailability()` hides every sticker surface unless the server says enabled and not read-only. It is never enabled while an admin is viewing as another user.
- **Production default:** no flag document, so `off`. Production navigation doesn't change until approval.

### 1.6 Barry (last phase)
- Barry may read the **names** of a contact's active stickers, and `person_type`, as relationship context.
- It never writes stickers. A sticker never triggers outreach, and no automated outreach is added.

---

## 2. Feature-reuse matrix

| Hub capability | IDYNIFY today | Decision |
|---|---|---|
| Contact list, cards, search | People (`AllLeads`): list, filters, search | **Reuse.** Search also matches sticker names (one line beside the existing tag match). |
| Contact detail | Contact Profile (ADR-001) | **Reuse.** Add a Stickers row. |
| Add contact + duplicate check | Add Manually + identity engine | **Reuse.** Add an optional sticker picker. |
| Edit contact, multiple emails and phones | IdentityCard, `emails[]`, `phones[]` | **Reuse.** B-R1 fixes email identity sync. |
| Notes | `notes[]` / StickyNotes | **Reuse as-is** |
| Activity history | Timeline + EngagementTimeline; manual "log outreach" | **Reuse as-is.** Extra relationship activity types (attended event, donation, volunteered) are optional (D3). |
| Archive | Soft archive | **Reuse** (the Hub's hard delete is not copied) |
| Duplicate handling | Identity engine; report-only duplicate script | **Reuse** (the Hub's auto-delete "clean up" is not copied) |
| **Stickers** (stable ID, name, color, emoji) | Free-text `tags[]` only | **Build:** registry + membership |
| Sticker wall (grid with counts) | — | **Build:** a Stickers view inside People |
| View one sticker's people | Tag filter, `?tag=` | **Extend:** sticker filter, `?sticker=<id>` |
| Assign / remove stickers | IdentityCard tag row UI | **Extend:** Stickers row, same interaction pattern |
| Bulk tagging | People bulk selection (used for bulk brigade, export) | **Extend:** "Add sticker" in the bulk bar |
| CSV import with a sticker | CSV import with a group tag | **Extend:** "Apply stickers" step; `Stickers` column recognized |
| CSV export (all, or per sticker) | People export | **Extend:** Stickers column; follows the active filter |
| Newsletter subscribed / unsubscribed | None (`email_status` is verification) | **Optional separate track** (D2) |
| Roles, approvals, team | — | **Not needed** (individual ownership) |
| Constant Contact sync | — | **Not needed** |
| Luma, Sheets, Zapier, public signup | — | **Not needed** |
| Photos | Contact photo and identity viewer | **Reuse** |

---

## 3. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **D1** ✅ decided: separate | **Stickers vs tags.** Both would sit on the same profile. | Keep both, with distinct jobs, and **no automatic conversion**. **Stickers** are curated relationship categories with stable IDs, color, counts and a wall ("who they are to you": Board, Donor, Volunteer). **Tags** stay as free-text labels, including CSV import group tags. A per-tag "Turn into sticker" action can come later, user-initiated. |
| **D2** ✅ decided: separate engineering track | Email opt-outs (the Hub's "Unsubscribed"): in scope? | A separate track, not needed for stickers. If approved: a per-address opt-out record, a "Record unsubscribe" action on the profile, and enforcement at the final send boundary for cadence and marketing sends. Unknown is never treated as opt-in. |
| **D3** ✅ decided: approved for a later phase | Relationship activity types (attended event, donation, volunteered) | Optional, phase 3. Logged through the existing timeline, with no new store. |
| **D4** ✅ decided: isolated Firebase staging for manual QA; no feature writes against production | Where QA happens | Rules and services are tested in the emulator in CI. Manual UI QA happens **only** in the isolated Firebase project (#664), because deploy previews use production Firebase. **No manual feature QA in production.** Steps: `STICKERS_STAGING_RUNBOOK.md`. |

---

## 4. Phased PR plan (for approval)

Every PR: small, with tests, a rollback note, and draft status. No merge or deploy without authorization.

| Phase | PR | What | Rollback |
|---|---|---|---|
| 1 Foundations | **S1** | ADR-007 "Native stickers" (the model above, D1, contact-protection rule) | Docs only |
| | **S2** | Rules for `stickers` and `sticker_enrollment`, plus rules-check cases | Mode `off` (no deploy), or `stickerRulesEnabled()` → false and deploy. **Not a revert:** reverting would make stickers and membership owner-writable, which is broader (§6). |
| | **S3** | Rollout mode in `feature_flags/stickers`, enrollment, `stickersConfig`, `useStickersAvailability`, guarded staging tool | Set `off`, or revert (the rules keep refusing; S3 only decides what the UI shows) |
| | **S4** | `stickerService` + `contactStickers` (transactional) + `verifyWritePaths` rule; emulator write-semantics tests | Revert; nothing calls them yet |
| 2 Native UI (flagged) | **S5** | Contact Profile: Stickers row and picker (search, recent first, create inline, remove with undo) | Flag off |
| | **S6** | People: sticker filter, `?sticker=`, counts, search by sticker name, "Add sticker" in the bulk bar | Flag off |
| | **S7** | People: Stickers view (grid; rename, color, emoji, archive, restore) | Flag off |
| 3 Workflows (flagged) | **S8** | CSV import "Apply stickers" step and `Stickers` column; export Stickers column | Flag off |
| | *S9 (D3)* | Relationship activity types on the timeline | Flag off |
| 4 Barry | **S10** | Barry reads active sticker names (read-only); tests that it never writes stickers or starts outreach | Revert |
| 5 Release | **S11** | Pilot runbook: enroll the designated account, regression checklist, approval record | Unenroll |
| Maintenance (independent) | **B-R1** | Email identity consistency (§5) | Revert |
| Separate track (D2, if approved) | *P1–P2* | Opt-out record + profile action; send-boundary enforcement | Revert |

**Minimum safe first PR:** S1 (ADR, docs only), then S2 and S4 together as the first code. Neither shows anything to users or changes navigation.

---

## 5. B-R1: email identity consistency (maintenance, independent)

Already authorized. Paused per the 2026-11-04 scope change; it starts on your go-ahead.

**Defect.** Profile email edits update `email` and `emails[]` but not `email_normalized`.
- The resolver reads `email_normalized` first, so after an edit the old address still matches the contact and the new one can miss.
- `ContactInfo` updates `emails[]` without touching `email` at all.
- Duplicate detection is wrong for edited contacts.

**Fix.**
- One pure builder keeps `emails[]`, `email` (= first entry) and `email_normalized` consistent, including clearing and replacing the primary.
- A transaction applies the edit to the latest stored list, so concurrent edits are not lost.

**Tests:** normalization, secondary emails, duplicate detection after an edit, clearing, replacing, and concurrent edits.

**Drift assessment:** a read-only script that counts drifted records. No production backfill.

---

## 6. S1: strengthened security contract (2026-11-04, hardened 2026-11-05)

ADR-007 (`docs/adr/ADR-007-native-stickers.md`) records the decisions. This section maps each requirement to what enforces it and what proves it. Every emulator suite runs in the CI `rules` job.

| Requirement | How it is met | Evidence |
|---|---|---|
| **Membership is transaction-safe** | Add and remove are Firestore transactions against the stored contact and sticker, using `arrayUnion` / `arrayRemove`. A refusal is classified, never retried with a weaker write. | `stickerCore.test.js` (49): concurrent adds, add vs archive, add vs edit, remove mid-add, "a retry never sends a weaker write". `sticker-services.mjs` (19, stable over 3 runs): 10 concurrent adds all land; 8 adds racing an archive end consistent. |
| **Contention vs authorization** | Each refused attempt is fingerprinted from what it read (`read_denied` / `write_denied` / `contention_exhausted`, at most 4 attempts):<br>- a refused **read** is final at once<br>- the **same write refused twice on the same data** is final (`write_denied`)<br>- only a write refused after the data **changed** is re-read and retried | Unit: revocation, unsettled contention, refused read, aborted commits. Emulator: another user's contact fails at the read on attempt 1; feature off, or access revoked, fails as `write_denied` after 2 attempts; archived is not retried. |
| **Protected against unauthorized direct writes** | The rules refuse any membership write that doesn't change exactly one sticker named in `sticker_change`, with matching assignments, at most 50, and (for an add) an existing active sticker of the same user. One module writes membership, enforced by a CI source scan. | `stickers.mjs`: membership cases (archived, nonexistent, other user's sticker, two at once, missing or mismatched `sticker_change`, client time, bad source, duplicate, tampered assignment, 51st, stale write, create with stickers, overwrite). `sticker-services.mjs`: a direct write that skips the service is refused. |
| **Malformed or legacy data** | The same checks run on whatever is stored. A malformed contact can be repaired by a remove, and unrelated edits are unaffected. | `stickers.mjs`:<br>- non-list `sticker_ids`, non-map assignments<br>- a repeated sticker, an unassigned sticker and an orphan assignment, each repairable by a remove; an orphan blocks adds; a repeat hidden behind an orphan<br>- 51 stored, repairable by a remove<br>- stored stickers with no status or an unknown status<br>- an unrelated edit to a malformed contact |
| **Archived stickers** | Only active stickers can be added. Archive is a status change, never a delete (delete is refused). | Rules, service and emulator: an add to an archived sticker is refused with `sticker_archived` and not retried; an add racing an archive leaves consistent data. |
| **Cross-user isolation** | Everything lives under `users/{uid}`, governed by `owns(userId)`. An added sticker is looked up under the same uid. Rollout documents are server-only. | `stickers.mjs`: another user, **including an admin**, cannot read, create, update or add U's stickers, nor write membership on U's contacts; U cannot add another user's sticker; an admin cannot set the flag from a client. `sticker-services.mjs`: the same through the service. |
| **Rules, endpoint and hook agree in every mode** | The mode, role and enrollment are read from Firestore by the rules and by `stickersConfig`, through one decision function. The hook shows controls only for `enabled: true` and `readOnly: false`. | `stickers-flag-parity.mjs` (27): for all 19 rows of `STICKER_ACCESS_MATRIX`, a real write judged by the rules, `resolveStickersConfig` and `availabilityFromConfig` all agree. Breaking the hook or the `internal` mode fails it. Env admin lists are proven ignored. |
| **Viewing as another user is read-only** | `stickersConfig` answers an impersonating admin with `readOnly: true`; the hook shows nothing (and never asks while impersonating); the rules refuse the admin's writes. | `stickers-flag-parity.mjs`, in off, internal, beta and on: hook unavailable, admin membership write refused, admin sticker create refused. `stickersConfig.test.js` (38), `useStickersAvailability.test.jsx` (8). |
| **Concurrent updates and the 50 limit** | Transactions plus atomic array operations. The 50 limit is checked by the service and by the rules. | 49 + two concurrent adds gives exactly 50 (unit and emulator). The 50th is allowed and the 51st refused by the service; a direct 51st write, or a 51st added atomically, is refused by the rules. |
| **Feature shutdown** | Mode `off`, no flag document, or an unknown value (`"On"`) refuses every sticker write. Reads and unrelated contact edits still work. | `stickers.mjs` shutdown section: create, rename, archive, restore, add and remove each refused in all three states. |
| **Server-side authorization, not only UI checks** | Every sticker write is decided by `firestore.rules` on the server. `stickersConfig` verifies the ID token and the impersonation session before answering. The UI hook is a convenience. | As above, plus `stickersConfig.test.js` (token, who may ask, read-only impersonation). |
| **Rollback never broadens** | 1) set the mode to `off` (no deploy); 2) make `stickerRulesEnabled()` return false and deploy. **Reverting the rules section is not a rollback.** | `stickers.mjs` runs all 141 cases against the live rules and the lockdown variant. The runner computes each outcome and **fails if lockdown is ever looser**: stricter in 31 cases, looser in 0. `stickersAccess.test.js` (29) pins the wiring structurally; four partial-revert mutations each fail it. |
| **No manual QA on production** | Manual QA only in an isolated project (`STICKERS_STAGING_RUNBOOK.md`). The rollout tool refuses any target it can't prove is non-production, and writes only the two rollout documents. | `stickersStaging.test.js` (19): each of the 7 guard checks is load-bearing (dropping any one fails a test). An emulator run with `--apply` wrote exactly `feature_flags/stickers` and `sticker_enrollment/u1`. |

### PR status

| PR | Scope | Base | State |
|---|---|---|---|
| S1 | ADR-007, this plan, the UI spec, the staging runbook | `main` | draft, Aepwiley13/idynify-scout#766 |
| S2 | Rules + emulator suite | `main` | draft, Aepwiley13/idynify-scout#762 |
| S4 | Services | S2 | draft, Aepwiley13/idynify-scout#763 |
| S3 | Rollout flag, parity suite, staging tool | S4 | draft, Aepwiley13/idynify-scout#764 |
| B-R1 | Email identity consistency | `main` | draft, Aepwiley13/idynify-scout#765; follow-up Aepwiley13/idynify-scout#768 |

**Merge order** (each only on approval): S1 → S2 → S4 → S3. B-R1 is independent.

**What a merge does and doesn't do:**
- **Rules** go out only through a manual `firebase deploy`. That deploy to production is its own approval, after S2 merges.
- **Netlify** publishes `main` automatically. Merging S3 makes `stickersConfig` live, but it answers `enabled: false` while no flag document exists, and no screen uses it until S5.
- **B-R1** changes profile email saves for every user as soon as it merges. It is not behind the flag.
- **The flag document** is never created by a merge.

**2026-11-05: GO.** Foundation PRs merge one at a time, each after its CI passes. The UI spec is approved, with all five decisions as proposed; S5–S7 are built in separate draft PRs behind the flag. **Not authorized:** deploying the rules to production, enabling the flag, or any production backfill.
