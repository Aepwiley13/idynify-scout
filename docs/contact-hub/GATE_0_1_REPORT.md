# Contact Hub native integration: Gate 0 and Gate 1 report

> **Superseded in part (2026-11-04):** the Contact Hub is now a reference application only, and no data will be migrated.
> Every migration section below is cancelled. The current plan is `docs/contact-hub/NATIVE_STICKERS_PLAN.md`.
> The Hub security findings still apply to the live Hub, and now belong to a separate project.

**Date:** 2026-11-04
**Scope:** Analysis and contracts only. Nothing was implemented, merged or deployed. No production data was read or changed.
**Approved direction:** an individual-first Contact Hub, native to IDYNIFY's People and Contact Profile (audit option C). It stays inside the existing `users/{uid}` boundaries, with no team sharing.
**For review by:** the product owner (IDYNIFY founder). Work stops here until review.

**Recommendation:**
- **Gate 0: NO-GO.** Five items need the owner: source access, rules, backups, a staging project, and the Hub hotfixes.
- **Gate 1: ready for approval.** The contracts are in §3.
- **Minimum safe first PR:** the offline Hub snapshot inspector (§5). It needs no approval of the contracts and touches nothing that ships.

---

## 0. Answers first

| Asked for | Where |
|---|---|
| Proposed schema | §3.2 (paths and fields), §3.3 (stickers), §3.4 (consent), §3.8 (rules) |
| Outstanding blockers | §6 |
| PR breakdown | §4 |
| Minimum safe first development PR | §5 |
| GO / NO-GO | §7 |

---

## 1. Current state, re-verified on 2026-11-04

| Item | Finding |
|---|---|
| `idynify-scout` `main` | `c2fee5c` (merge of #758, 2026-11-03). **No commits since the audit.** |
| Audit branch `claude/funny-ritchie-cr10nd` | `4f29355`, one commit ahead of `main` (the audit doc). **No PR has been opened**, so the audit is not on `main`. |
| Open IDYNIFY PRs | #761 (draft): "mailto handoff is not a confirmed email send". This touches send records, so cadence consent enforcement (B10) must be built on its result. #753: phone layout. Neither is an identity PR. |
| Open identity issues | #760 (Resolve/Save double count), #739 (can't tell a field the user cleared from one never filled), #691 (enrich after upload). |
| `utadco-hub-functions` `main` | `16c9d09` (2026-04-23). Unchanged. |
| Hub PR #1 | Open, unmerged, `3017104` (2026-10-09). All 3 Netlify checks (redirect rules, header rules, pages changed) **failed** on site `luxury-halva-ccc466`. |
| Hub deployment | Netlify site `luxury-halva-ccc466` builds this repo, which on `main` holds functions only. **The source of the live page at `hub.utahadvocacy.org` is still unknown** (❓ B2). |
| IDYNIFY deployment | One Firebase project, `idynify-scout-dev`, **serves production, deploy previews and branch deploys** (`netlify.toml`, "Non-production contexts"). `src/firebase/config.js` now reads the project from `VITE_FIREBASE_PROJECT_ID`; the `netlify.toml` comment saying it is hard-coded is stale (#661). |
| IDYNIFY CI | Vitest on the whole corpus, plus the Firestore emulator rules suite (`scripts/rules-check`) on every PR. |

### 1.1 Corrections to the audit

1. **IDYNIFY already has a multi-email list.**
   - `contact.emails[] = [{id, value, label}]`, edited in IdentityCard and ContactInfo; `email` mirrors `emails[0]`.
   - The audit said there was none. Hub `extraEmails` can reuse this list, so no `additional_emails` field is needed.
   - The identity engine still matches only `email` and `work_email`, not the other entries.
2. **New identity-readiness defect.** Profile email edits write `emails` and `email` but **not `email_normalized`**, which is the resolver's first email rung (`IdentityCard.jsx:524-539`, `ContactInfo.jsx:145`). Only creation (`identityFields`) and merges (`mergeIdentifiers`) write it.
   - After a user edits an email, the old address still resolves to that contact.
   - The new address resolves only if stored lowercase, or if the contact falls inside the 200-document fallback scan.
   - A migration could therefore create a duplicate of a contact whose email the user edited.
3. **Barry does not read contact notes or tags today.** `barryContextAssembler.js` reads explicit fields (for example `person_type`), and no Barry function serializes a whole contact. Hub notes reach Barry only if Gate 4 adds them on purpose. This lowers audit risk R18 until Gate 4.
4. **The XSS finding stays a code-level analysis.** I did not build or run an exploit. A controlled reproduction is Team A's task, against the Hub test harness and the Firestore emulator in an authorized environment (A2).

---

## 2. Gate 0: Readiness

### 2.1 What was inspected
- Hub frontend `hub/index.html`, its tests and its README at `3017104`.
- `netlify/functions/cc-auth.js` and `netlify.toml` at `16c9d09`.
- PR #1's checks.
- IDYNIFY `main`:
  - identity engine, write guard, contact protection
  - `firestore.rules`, `netlify.toml`, CI
  - Capture's rollout flags
  - IdentityCard, ContactInfo, AllLeads, ContactProfile
  - Barry context assembler
- Open PRs and issues in both repos.
- CC behaviour, from Constant Contact's developer docs.

### 2.2 What exists and can be reused
- PR #1's sticker-ID fix and its in-memory Firestore test harness (`hub/tests/harness.mjs`). This is the right place to test Hub fixes A2–A5.
- IDYNIFY's emulator rules suite. Its pattern (a live rules file, `demo-` project, no credentials) also suits the Hub's future `firestore.rules`.
- IDYNIFY's read-only script conventions: `--dry-run` / `--verify` and service-account loading, as in `detectDuplicateContacts.mjs` and `backfillContactIsArchived.mjs`.

### 2.3 What must be built or changed

**Team A: Hub stabilization** (in `utadco-hub-functions`; nothing merged or deployed without authorization)

| # | Item | Status | Required change |
|---|---|---|---|
| A1 | Firestore rules and roles | ❓ **Blocked** (B3): no rules in any repo; client hides UI by role, incompletely (viewers keep Add contact and Import list) | Export the live rules first; never overwrite blindly. Then version `firestore.rules` with emulator tests: approved users only; role from `get(users/uid)`; no self-approval or role change; `access_requests` create-only with fixed fields; contact delete denied or admin-only; deny creating `stk_*` IDs and any update that rewrites a sticker's `createdAt`. |
| A2 | Stored XSS | ✅ Identified in code: 31 `innerHTML` assignments, no escaping helper; user data inside inline `onclick` attributes | Escape every interpolated value (a small `esc()` helper), or build nodes with `textContent`. Replace inline handlers that carry data with `data-*` attributes and `addEventListener`. Harness test: fields containing HTML metacharacters (`< > " ' &`) render as literal text and add no elements or attributes. Add a Content-Security-Policy header. |
| A3 | Hard-coded PII | ✅ 50 email→phone pairs in `patchPeoplePitchPhones` | Remove it from the page. Deleting it from the file does not remove it from git history, browser caches or anyone who already loaded the page: a policy question for the owner (Q12). |
| A4 | Consent assumptions and CC | ✅ "Subscribed" is the default in the Add form, the Edit form (when empty), CSV import and CC pull. Push sends contacts without a CC ID to `sign_up_form`. Updates use `permission_to_send: 'normal'`, which CC does not document. | Default to `Unknown`. Disable Push to CC. On pull, keep CC's raw `permission_to_send` (and consent date) instead of collapsing it. Remove the `sign_up_form` path. |
| A5 | Destructive operations | ✅ Inventory in §2.5 | Archive becomes a flag, not a delete. "Clean up duplicates" becomes report-only (and admin-only). PR #1 already makes sticker delete soft. Decide whether Log activity is fixed or hidden (Q13). |
| A6 | Sticker IDs | ✅ PR #1 fixes allocation (auto-ID, create-only, soft delete); ❌ not merged; ❓ live state unknown; tests not run here | Fix the failing Netlify checks, run the tests, merge and deploy **after authorization**. Rules from A1 stop stale tabs still running old code. |
| A7 | Legacy sticker overwrite verification | ❓ **Blocked** (B1): needs data | Run the inspector (§5) on a snapshot; grade every `stk_*` sticker (audit §4.3). |
| A8 | Backups | ❌ None established; PITR state ❓ | Owner, in GCP: enable point-in-time recovery; run a managed export to a restricted bucket; schedule exports; do one restore drill into a scratch project. Document it in a runbook (A7 PR). |

**Team B: IDYNIFY identity readiness**

| # | Item | Status | Required change |
|---|---|---|---|
| B-R1 | `email_normalized` goes stale on profile email edits | ✅ Defect (§1.1-2) | A small PR: profile email writes also set `email_normalized` from the new primary. Tests. A backfill check counts contacts where `email_normalized ≠ normalize(email)` (read-only). |
| B-R2 | Extra entries in `emails[]` are not identity-matched | ✅ By design today | Decide in an ADR-002 amendment (§3.2). Until then, the migration checks extra addresses itself. |
| B-R3 | #739 cleared fields | Open | The migration does not depend on it. Matched contacts get identifiers, stickers, notes and events only. No profile field is filled. |
| B-R4 | #760 double count | Open | Not on the migration path (Resolve/Save is not used). |
| B-R5 | Isolated staging | ❌ (#664, #648–#651) | **The owner creates a non-production Firebase project.** Without one, "staging" writes production. |

**Team C: experience readiness.** No blockers. The UX contract is in §3.10.

### 2.4 Files and Firestore paths affected (Gate 0)
- **Hub:** `hub/index.html`, `hub/tests/*`, new `firestore.rules`, new `firestore.indexes.json` (if any), `netlify.toml` (CSP header), docs.
- **Hub Firestore:** `contacts`, `stickers`, `users`, `access_requests` (rules only; no data changes).
- **IDYNIFY:** `src/components/contacts/IdentityCard.jsx` and `ContactInfo.jsx` (B-R1), `scripts/hub/*` (inspector), docs.
- **IDYNIFY Firestore:** none in Gate 0.

### 2.5 Hub destructive-operation inventory

| Operation | Effect | Recoverable? |
|---|---|---|
| Archive contact (`:1576`) | `delete()` of the contact document | Only from a backup |
| Clean up duplicates (`:2425`) | Keeps one record per primary email; **deletes the rest**. Their notes, extra emails, extra phones, `ccContactId` and photo are lost; stickers and activity are merged. | Only from a backup |
| Delete sticker, pre-fix | Strips the ID from every contact, then deletes the doc | Only from a backup |
| Delete sticker, PR #1 | Soft (`deleted: true`) | Yes |
| Create sticker, pre-fix | `set()` over an existing `stk_*` doc: takeover | Name, color and image only from a backup |
| Save edit (`:1555`) | Writes the whole in-memory contact back, last-write-wins: overwrites another user's concurrent edit | Only from a backup |
| Import merge, CC pull | Fill-only for phone, org and notes; appends stickers and extra emails/phones | Additive |
| `patchPeoplePitchPhones` | Fill-only phone writes | Additive |
| IDYNIFY: `undoApprovalSideEffects` | Hard-deletes `icp_auto_discovery` contacts of a company | Only from a backup. **The migration must not merge onto these without review.** |

### 2.6 Security and data-integrity risks (Gate 0)
The audit's R1–R5 are unchanged: CC consent assertion, consent label, XSS, rules unseen, PII in source. Added:
- **R27 (Medium):** `email_normalized` drift (§1.1-2).
- **R28 (Medium):** whole-record last-write-wins on Hub edit. Concurrent edits during the migration window can revert data, so the window needs a write freeze.

### 2.7 Test evidence
- **Static analysis** of every claim above, with file and line references (audit and this report).
- **Not executed:**
  - Hub `stickers.test.mjs` (the sandbox's safety check blocked running repository code).
  - Any Hub reproduction.
  - Anything against Firebase (no credentials).
- **No new tests yet.** Gate 0 tests are specified in §4 (A1–A5, B-R1) and §5.

### 2.8 Dependencies and blockers
B1–B5 in §6.

### 2.9 Gate 0 GO / NO-GO
**NO-GO.** Gate 0 passes when:
- A1–A4 are merged and deployed with authorization.
- A8 backups are taken and a restore has been drilled.
- A snapshot is inspected and every `stk_*` sticker is graded.
- A staging project exists.
- B-R1 is merged.

---

## 3. Gate 1: Contracts (for approval)

### 3.1 Ownership and isolation contract
1. **One owner per record.** Every Hub-derived record lives under exactly one `users/{uid}`, the designated account (Q1). There is no copy per Hub user and no sharing.
2. **No Hub identity becomes an IDYNIFY identity.** Hub UIDs, roles and `access_requests` are provenance only.
3. **Clients write only their own tree,** under the existing rules (`owns(userId)`). New collections get narrower rules (§3.8).
4. **Server code (Admin SDK) bypasses rules,** so every server path:
   - takes the target UID from the verified auth token, or for the migration from an allowlist
   - builds paths from one `users/${uid}` constant
   - asserts the prefix before writing
5. **Viewing as another user** (impersonation) is read-only for every Contact Hub action, matching Capture (`captureAvailability.js`).
6. **No Firebase credentials** for `utadco-hub` ever reach the IDYNIFY client or repo.

### 3.2 Schema: paths and fields

Every new field is **optional**. Readers treat a missing field as empty, so existing contacts and every current People and Profile surface behave as today.

#### 3.2.1 `users/{uid}/contacts/{contactId}` (existing; additions only)

| Field | Type | Written by | Notes |
|---|---|---|---|
| `sticker_ids` | `string[]` (≤ 50) | `contactStickers.js` only | IDs in `users/{uid}/stickers`. Queried with `array-contains`; People filters client-side today, so no index is needed yet. |
| `sticker_assignments` | `map<stickerId, {assigned_at: ISO, assigned_by: 'user'\|'csv_import'\|'utadco_hub_migration', source_ref: string\|null}>` | `contactStickers.js` only | Membership provenance. Removed together with the ID. |
| `emails[]` *(existing)* | `[{id, value, label, source?, added_at?}]` | IdentityCard, ContactInfo, migration | Hub `extraEmails` → entries with `label: 'other', source: 'utadco_hub'`. Primary stays `emails[0]` = `email`. |
| `phones[]` *(existing)* | typed list | `contactPhones.js` | Hub phones → `label: 'unknown', labelSource: 'import'`. Never an identity. |
| `notes[]` *(existing)* | `[{id, content, created_at, updated_at, source?, source_ref?, created_at_basis?}]` | StickyNotes, CSV, migration | A Hub note → `id: 'utadco_hub:<hubId>:note'`, `created_at_basis: 'source_contact_created'` (the Hub kept no note timestamp). |
| `external_ids` | `map` `{utadco_hub_contact?: string, constant_contact?: string}` | **Migration only** | The exact re-run key, queried as `external_ids.utadco_hub_contact == <id>`. The CC ID is a hint (CC account unknown). |
| `source_records.utadco_hub` | `{contact_id, project: 'utadco-hub', source_label, date_added, created_at, created_by_hub_uid, name_inferred_from_email, cc_tags[], cc_lists[], migration_run_id, migrated_at, snapshot_sha256}` | **Migration only** | Keeps the **original creation timestamps** and source. Hub `emailStatus` deliberately stays out of it (§3.4). |
| `addedFrom` *(existing enum)* | `'utadco_hub'` (new value) | Migration | `ADDED_FROM_SOURCES` gains one value. |
| `identity_sources` *(existing)* | `+= 'utadco_hub'` | Migration (through `mergeIdentifiers`) | Append-only, as today. |
| `addedAt` *(existing)* | ISO, the migration time | Migration | **Not backdated.** The original date is in `source_records`; backdating would trip Mission Control age thresholds. |
| `email_status` *(existing)* | — | **Never by Contact Hub work** | It means verification. A test pins this. |

#### 3.2.2 `users/{uid}/stickers/{stickerId}` (new)

| Field | Type | Client-writable | Notes |
|---|---|---|---|
| `schema_version` | `1` | create only | |
| `name` | string, 1–60, trimmed | yes | |
| `name_key` | lowercase, whitespace collapsed | yes (derived) | For a duplicate-name warning only. Never identity. |
| `color` | one of `teal blue purple coral amber pink green gray` | yes | The Hub's palette IDs, so migrated colors carry over |
| `emoji` | string ≤ 16 chars, or null | yes | Image icons are deferred (Q6) |
| `description` | string ≤ 280, or null | yes | |
| `status` | `active` \| `archived` | yes | **No delete.** Archived stickers are hidden from pickers and filters, and their memberships are kept. |
| `archived_at` | timestamp, or null | yes | |
| `created_at` | server timestamp | create only | Takeover guard: an update may never change it |
| `created_by` | uid | create only | Must equal `request.auth.uid` |
| `updated_at` | server timestamp | yes | |
| `source` | `user` \| `csv_import` \| `utadco_hub_migration` | create only (clients: `user` or `csv_import`) | |
| `external_ids.utadco_hub_sticker` | string | **server only** | `stk_100`, `board`, an auto-ID… |
| `legacy_integrity` | `clean` \| `suspect` \| `orphan_named` \| null | **server only** | From the inspector's grading |
| `migration_run_id` | string, or null | **server only** | |

**Member count is not stored.** It is derived (`getCountFromServer` on `sticker_ids array-contains`, or client-side in People), so it cannot drift.

#### 3.2.3 `users/{uid}/email_permissions/{emailKey}` (new)
- **Document ID** `emailKey` = SHA-256 hex of the normalized address. This keeps raw addresses out of document paths and logs, and avoids characters IDs cannot hold.

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `1` | |
| `email_normalized` | string | `normalizeEmail` from `identityNormalization.js` |
| `channel` | `'email_marketing'` | Leaves room for `sms_marketing` later |
| `status` | `unknown` \| `unsubscribed` \| `subscribed` | §3.4 |
| `basis` | `imported_label` \| `provider_record` \| `contact_request` \| `user_recorded` | Why the status is what it is |
| `source` | `utadco_hub` \| `constant_contact` \| `idynify_user` | |
| `observed_label` | string, or null | For example `"Subscribed"`: what the source *said*, kept verbatim |
| `provider_permission` | string, or null | For example CC `permission_to_send`. **Only** from a provider record. |
| `consent_at` | timestamp, or null | Only with `basis: provider_record` or `contact_request` |
| `updated_at`, `updated_by` | | |

- **History:** `users/{uid}/email_permissions/{emailKey}/events/{eventId}`, append-only: `{from_status, to_status, basis, source, observed_label, recorded_at, recorded_by, migration_run_id?}`.

#### 3.2.4 `users/{uid}/contacts/{contactId}/timeline/{eventId}` (existing; one new type)
- **Type** `imported_activity`, added to `TIMELINE_EVENT_TYPES`.
- **Fields:** actor `system`, `metadata: {source: 'utadco_hub', hub_type, detail, amount, date, notes}`.
- **Event ID:** `utadco_hub__<hubContactId>__<n>`, written with `create()` so it exists exactly once.

#### 3.2.5 `users/{uid}/import_review_items/{itemId}` (new; Gate 3; temporary quarantine)
- **Written by the server.** The client may update only `decision` (`same` \| `different` \| `skip` \| `approve_membership` \| `reject_membership`) and `decided_at`.
- **Holds only what a decision needs:** the bucket, the Hub ID, display name, email(s), candidate contact IDs, and for a sticker, its member list.
- **Lifecycle:**
  - `expires_at` is set, and a Firestore TTL policy enforces deletion.
  - Everything is deleted after cutover sign-off.
  - **It is not a contact store.** Nothing reads it except the review screen and the migration.

#### 3.2.6 Server-only top-level collections (new; rules deny every client)
- `hub_migration_runs/{runId}`: `{target_uid, mode, snapshot_sha256, code_commit, started_at, completed_at, counts, status}`.
- `hub_migration_runs/{runId}/writes/{seq}`: the manifest, `{path, action, fields_added, added_ids: {notes, events, stickers, emails}, before_hash, after_hash}`. An exported JSON copy is kept with the run.
- `hub_enrollment/{uid}`: `{stage: 'beta'}`, the rollout list (§3.9).

### 3.3 Sticker identity model
1. **ID** = a Firestore auto-ID, created by `setDoc` on a fresh `doc(collection(...))`. Rules allow `create` with server fields absent, and deny any update that touches `created_at`, `created_by`, `source` or server-only fields. A stale or buggy client's `set()` over an existing sticker is therefore an update that rewrites `created_at`, and it is **denied**. No transaction needed.
2. **IDs are never reused:**
   - no delete (`status: archived` instead)
   - auto-IDs are not derived from counts
   - Hub IDs are never used as IDYNIFY IDs
3. **Names are labels, not identity.** Two stickers may share a name. The picker warns on a `name_key` clash and offers the existing one.
4. **Membership** = `sticker_ids` + `sticker_assignments`, written only through `src/services/contactStickers.js`.
   - Add: `arrayUnion` plus a map entry.
   - Remove: `arrayRemove` plus a field delete.
   - A `verifyWritePaths.mjs` rule fails the build if anything else writes these fields.
5. **Migration:**
   - Each Hub sticker becomes one IDYNIFY sticker, keyed by `external_ids.utadco_hub_sticker`, so re-runs find it.
   - `clean` stickers get their membership.
   - `suspect` stickers are created, but **membership is quarantined** until the owner approves the list.
   - Orphan IDs create nothing unless the owner names them (`orphan_named`).
   - Hub soft-deleted stickers are created `archived`, with membership kept.
6. **Future contact merges** (the dedup sprint) must union `sticker_ids` and `sticker_assignments`. Recorded in the ADR.

### 3.4 Consent and suppression model
1. **Separate from deliverability.**
   - `email_status` (verification) and the platform-wide `emailSuppressionList` (bounces, complaints) are unchanged and never written by this work.
   - The ledger is per workspace, per address.
2. **Hub labels can only lower permission:**

   | Hub `emailStatus` | Ledger `status` | `basis` | `observed_label` |
   |---|---|---|---|
   | `Unsubscribed` | `unsubscribed`, for **every** address of that Hub contact | `imported_label` | `Unsubscribed` |
   | `Subscribed` | **`unknown`** | `imported_label` | `Subscribed` |
   | `Unknown`, blank or anything else | `unknown` | `imported_label` | the value verbatim |

3. **`subscribed` exists only with evidence.** A provider record carrying an explicit or implicit permission and a consent date, or a recorded contact request. Only server code may write it. **No client and no migration can set `subscribed`.**
4. **`unsubscribed` is sticky.**
   - A client may record an unsubscribe at any time.
   - Neither a client nor a re-run may lift one.
   - Lifting needs a future server path with `basis: contact_request`.
   - Product question: does a user need a "recorded by mistake" correction? If so, a server function writes it, with an audit event.
5. **Enforcement** (B10):
   - Bulk cadences exclude `unsubscribed` addresses, listed as "not included", the same pattern as the email-conflict hold-back.
   - One-to-one compose shows a warning (B6 decision).
   - `unknown` is not blocked: it is today's behaviour for every IDYNIFY contact.
6. **Keyed by address,** so an unsubscribe survives contact merges, archives and re-imports.

### 3.5 Source mapping (updated from the audit, §6 there)
The audit's mapping stands with these changes:
- `extraEmails` → existing `emails[]` (§3.2.1), not a new field.
- Hub `emailStatus` → ledger only (§3.4). Never `source_records`, never `email_status`.
- Matched existing contacts get **only**: identifiers that fill a gap (through `mergeIdentifiers`), extra emails added to `emails[]`, stickers, the Hub note, timeline events, `external_ids` and `source_records`.
  - Hub `org`, name and title differences go to the dry-run report as suggestions.
  - No profile field is filled: this sidesteps #739.
- New contacts:
  - `person_type: 'network'` (Q3), `contact_status: New`, `addedFrom: 'utadco_hub'`, `is_archived: false`.
  - Company link through `ensureCompanyForContact` with `nameSource: USER`. The number of companies this would create is reported in the dry run first.
- Photos and sticker images: deferred (Q6).

### 3.6 Migration contract (approve now, build in Gate 3)

| Clause | Contract |
|---|---|
| Input | A JSON snapshot from a **read-only** dump (all root collections through `listCollections()`, including subcollections) with a manifest: `{project, exported_at, tool_commit, collections, counts, sha256 per doc}`. A managed export is taken at the same time as the disaster backup. |
| Modes | `inspect` (offline), `dry-run` (reads the target workspace only), `live`, `verify`, `rollback`. Default is `dry-run`. `live` needs `--target-uid` (allowlisted), `--snapshot-sha`, and a completed dry-run ID for the same snapshot. |
| Target | **One** allowlisted UID per run: the designated pilot account. |
| Lookup order | 1) `external_ids.utadco_hub_contact` 2) `resolveContactCore` (server adapter; Hub phones never offered as identity) 3) each extra address, checked by the migration 4) name-only check, by the migration 5) bucket |
| Buckets | As in the audit §7.2: `NEW`, `MATCHED_EMAIL`, `RERUN_NOOP` / `RERUN_UPDATE`, `HUB_DUP_COLLAPSE`, `HUB_DUP_REVIEW`, `REVIEW_NAME_ONLY`, `REVIEW_EXTRA_EMAIL`, `CONFLICT_IDENTITY`, `NO_EMAIL`, `INVALID`, `STICKER_SUSPECT`, `STICKER_ORPHAN` |
| Quarantine | Every `REVIEW_*`, `HUB_DUP_REVIEW` and `STICKER_SUSPECT` item goes to `import_review_items` and is **not written** until decided. Never merged speculatively. |
| Write unit | Stickers first (create-only). Then one **transaction per contact** against the latest document (#758 pattern). Then timeline `create()`. Then ledger entries and events. |
| Never writes | Canonical fields of existing contacts; `email_status`; `emailSuppressionList`; anything outside `users/<target>/` except `hub_migration_runs` |
| Idempotency | `external_ids`, deterministic note, event and ledger IDs, and sticker `external_ids`. A second run on the same snapshot writes **0** documents. |
| Records with no email | Created with no email identity. A name match → review. Counted separately. |
| Reconciliation | The audit §7.3 equations must hold **exactly**, or the run is marked failed. |
| Logging | Counts, buckets and IDs only. No names, emails, phones or notes in logs (the same policy as Barry Enrich). |

### 3.7 Rollback and restoration
1. **Before every live run:**
   - a JSON backup of `users/<target>/**`, made by script and checksummed
   - a managed export of the IDYNIFY project as the disaster backup

   **A managed import is not a per-user restore.** It imports whole collection groups across every user and would overwrite other users' contacts. Per-user restoration therefore uses the JSON backup and a restore script, never `gcloud firestore import`.
2. **Rollback** follows the manifest, is idempotent, and removes only what the migration added that is still as written:
   - **Created contacts:** deleted if unchanged (hash match). Otherwise reported.
   - **Matched contacts:** added sticker IDs, `emails[]` entries, note IDs, event IDs, `external_ids` and `source_records` are removed only if still equal to what was written. User edits stay.
   - **Stickers created by the run:** archived (never deleted) if no user has since assigned them. Otherwise reported.
   - **Ledger:** the run's events are reverted only if no later event exists. An unsubscribe a user recorded later stays.
3. **If rollback cannot complete,** the restore script restores individual documents from the JSON backup, only on owner approval, with a diff report first.
4. **The Hub stays untouched and read-only** through the pilot, so it is the system of record until sign-off.

### 3.8 Rules contract (implemented in B3, verified by `scripts/rules-check`)
- **Generic blocks.** The 2-deep `/{coll}/{docId}` and deep `/{coll}/{docId}/{rest=**}` blocks add `coll != 'stickers' && coll != 'email_permissions' && coll != 'import_review_items'` to every grant they make, so the narrower rules below are the only ones that apply. This is the pattern the file already uses for `lineageEvents`.
- **`stickers/{id}`:**
  - read: owner
  - create: owner + enrolled (`exists(/hub_enrollment/$(uid))`) + `created_by == uid` + `source in ['user','csv_import']` + no server-only keys + `status == 'active'`
  - update: owner + enrolled + `affectedKeys ⊆ {name, name_key, color, emoji, description, status, archived_at, updated_at}`
  - delete: **false**
- **`email_permissions/{key}`:**
  - read: owner
  - create/update: owner, `status in ['unknown','unsubscribed']`, `basis == 'user_recorded'`, and if the stored status is `unsubscribed` the new one must be too
  - delete: false
  - `…/events/{id}`: create by owner only; update and delete false
- **`import_review_items/{id}`:** read: owner. Update: owner with `affectedKeys ⊆ {decision, decided_at}`. Create and delete: false.
- **`hub_migration_runs/**` and `hub_enrollment/{uid}`:** read and write false (Admin SDK only).
- **Contacts:** no rules change in Gate 2. `external_ids` and `source_records` are guarded by `verifyWritePaths.mjs` (no client module writes them). Locking them at the rules level is a later hardening PR, because it edits the most sensitive block in the file.
- **Mandatory rules-check cases:**
  - case 09 still ALLOW
  - every existing case still passes
  - sticker takeover by `set()` → DENY
  - sticker delete → DENY
  - another user's stickers and permissions → DENY
  - client `subscribed` → DENY
  - lifting an `unsubscribed` → DENY
  - an un-enrolled user's sticker create → DENY

### 3.9 Feature-flag contract (Capture pattern)
- **Mode.** `CONTACT_HUB_MODE` = `off` \| `internal` \| `beta` \| `on`. Anything else means `off`. Read server-side by a `contactHubConfig` function.
- **Enrollment.** `beta` = admins plus users with `hub_enrollment/{uid}.stage == 'beta'`.
- **Client.** A `useContactHubAvailability()` hook hides every Contact Hub surface unless the server says `enabled`. It is never enabled while viewing as another user.
- **Rules.** They check enrollment for sticker writes (§3.8), so a hand-crafted client cannot use the feature while it is dark.
- **Production default.** `off`, so **production navigation does not change until approval**.

### 3.10 Product experience contract (Team C)

**Current layouts, as inspected:**
- **People** (`/command-center?tab=people`, `AllLeads mode="people"`):
  - Loads all contacts and filters client-side.
  - Has a filter chip row (Industry, Warmth, Source, Tag…) with 44px touch targets.
  - `?tag=` is read from the URL. Export CSV exists.
- **Contact Profile** (`ContactProfile.jsx`) has three columns that collapse at 1100, 860 and 600px:
  - **Intel:** company card, IdentityCard (classification chips → **Tags** → emails / phones / socials), actions, Barry Meet, DetailDrawer (with **StickyNotes**)
  - **Action:** engage bar, stage panels, Barry insight, next best step
  - **History:** score, metrics, relationship arc, **EngagementTimeline**

**Component reuse matrix:**

| Need | Reuse | New |
|---|---|---|
| Sticker chips on a contact | IdentityCard tag row styles and add-input behaviour (`IdentityCard.jsx:1139-1210`) | `StickerRow`, `StickerPicker` (sourced from the registry, not `getUniqueTags`, which caps at 500) |
| Filter People by sticker | AllLeads tag filter dropdown (`:2065-2090`), URL param pattern | `stickerFilter` state, `?sticker=` |
| Sticker wall | People list container, theme tokens | `StickerGrid` view inside People (no new route) |
| Manage a sticker | Existing modal and sheet styles | `StickerEditSheet` (rename, color, emoji, archive and restore) |
| Hub notes | `StickyNotes` as is | Source label "From Contact Hub" |
| Hub activity | `EngagementTimeline` | Config entry for `imported_activity` |
| Extra emails | IdentityCard `emails[]` block | — |
| Newsletter permission | IdentityCard email block | `EmailPermissionLine`, "Record unsubscribe" |
| Cadence hold-back | CadencePickerModal email-conflict list | "Unsubscribed" reason |
| CSV stickers | CSVUpload, ScoutPlus success screen | "Apply stickers" step; Stickers column |
| Feature gating | `useCaptureAvailability` pattern | `useContactHubAvailability` |
| Review queue (Gate 3) | CSV preview bucket layout | `HubReviewScreen` |

**Navigation:**
- No new top-level item.
- Stickers live inside People. Contacts still open only through `openContact()` (ADR-004).
- Scout, Hunter and Barry routes are unchanged.

**Screen-by-screen acceptance criteria**

| Screen | Acceptance criteria |
|---|---|
| People, sticker filter | Flag on: a "Sticker" chip appears after "Tag", lists active stickers with counts, and filters in under 1 click after opening. `?sticker=<id>` survives reload and back. It combines with the other filters, and the active-filter count includes it. An archived or unknown ID shows "This sticker is archived" with a Clear action, never an empty list without explanation. Flag off: no visible change. |
| People, Stickers view | Grid of active stickers (color or emoji, name, member count). A tile opens People filtered. "+ New sticker" creates one. **Empty state:** "No stickers yet. Use stickers to group people you know, like board members, volunteers or an event's guests." with a Create button. Phone width: 2 columns, no horizontal scroll. |
| Create / edit sticker | Name required (1–60). A duplicate name warns: "You already have a sticker called Donor. Use that one?" Color from 8 swatches, or an emoji. Save failure: "Couldn't save the sticker. Nothing changed." with Retry. **Archive confirm:** "Archive Donor? It's hidden from pickers and filters. Its 42 people keep it, and you can restore it." No delete action exists. |
| Contact Profile, stickers row | Shown above Tags in IdentityCard. Chips show color or emoji and name. "+ Sticker" opens a searchable picker (recent first, create inline). × removes it with an Undo toast for 5 seconds. Viewing as another user: chips show, no controls. Phone: chips wrap, targets ≥ 44px. |
| Contact Profile, notes | An imported note shows "From Contact Hub" and its original date. It edits like any note, and the edit keeps the source. |
| Contact Profile, timeline | Imported activity shows its type (Attended event, Donation, Volunteered…), detail and date, with an "Imported from Contact Hub" badge, sorted by its own date. |
| Contact Profile, newsletter permission | Under Email: **Unsubscribed** (red, "Not included in cadences"), or **Unknown** (grey; when imported: "Contact Hub said 'Subscribed'"), or **Subscribed** (only with provider evidence: source and date shown). "Record unsubscribe" is always available; there is no "Record subscribe" control. |
| Cadence picker and compose | Unsubscribed recipients are excluded from bulk sends and listed as "Not included: unsubscribed from newsletters". The send count matches. 1:1 compose shows the warning (B6). |
| CSV import | An "Apply stickers" step after naming the import (pick existing, create new, or skip). A `Stickers` column is recognized: names match existing stickers by name; unmatched names are listed, never created silently. Export CSV includes a Stickers column of names. |
| Contact Hub review (Gate 3, owner only) | Buckets with counts. Each item: side-by-side cards, then **Same person / Different people / Skip** (or **Approve list / Edit / Don't import** for stickers). Decisions can change until the run is applied. **Empty state:** "Nothing to review." **Recovery:** if a write fails, the item stays undecided, with a message. |
| Barry (Gate 4) | Reads sticker names and `person_type` as context. Never writes stickers or permissions. Never starts outreach. Hub notes are excluded unless the owner approves (Q5). |

### 3.11 Gate 1 reporting summary
1. **Inspected:** as §2.1.
2. **Reusable:**
   - identity engine and server adapter, `mergeIdentifiers`, contact protection
   - `emails[]`, `phones[]`, `notes[]`, timeline, `identity_sources`
   - People filters and export, IdentityCard tag UI
   - Capture flag pattern, rules-check suite
3. **To build:**
   - `stickers`, `email_permissions` (+ events), `import_review_items`, `hub_migration_runs`, `hub_enrollment`
   - contact fields `sticker_ids`, `sticker_assignments`, `external_ids`, `source_records`
   - one timeline type; one `addedFrom` value
4. **Files and paths:** §3.2, §4.
5. **Risks:**
   - The rules edit to the generic blocks (mitigated by rules-check case 09 and the full suite).
   - `email_normalized` drift (B-R1).
   - Staging not isolated (B5).
   - Consent misuse (prevented structurally by §3.4 and §3.8).
6. **Test evidence:** the contracts are specified as tests in §4 and the audit §14. None written yet.
7. **Dependencies:** owner decisions Q1, Q3, Q5, B6.
8. **PR sequence:** §4.
9. **Gate 1: GO to approve the contracts**, provided Q1 and B6 are answered. Building on them waits for that approval.

---

## 4. PR breakdown

Each PR: small (≤ ~400 changed lines), tests included, a rollback note, no merge or deploy without authorization.

### Team A: `utadco-hub-functions` (Gate 0)

| PR | Title | Tests | Rollback |
|---|---|---|---|
| A1 | Version the live Firestore rules (exported first) and tighten roles, self-approval, deletes and `stk_*` takeover | Emulator suite: viewer cannot write; no self-approval; takeover denied | Redeploy the exported prior ruleset |
| A2 | Render user data as text: escape helper, no data in inline handlers, CSP header | Harness: metacharacters render literally, no new elements | Revert commit; redeploy previous page |
| A3 | Remove hard-coded contact data from the page | Test: page source has no email-like literals outside config | Revert (not recommended) |
| A4 | Consent: default `Unknown`, disable Push to CC, keep raw CC permission on pull, remove `sign_up_form` | Harness: no path sets "Subscribed" by default; push disabled | Revert commit |
| A5 | No hard deletes: archive flag, report-only duplicate cleanup | Harness: archive keeps the doc; cleanup writes nothing | Revert commit |
| A6 | PR #1 (sticker IDs): fix Netlify checks, run tests, merge after A1 | Existing `stickers.test.mjs` | Revert merge |
| A7 | Backup and restore runbook (PITR, scheduled exports, restore drill) | Drill record | Docs only |

### Team B / C: `idynify-scout`

| Gate | PR | Title | Depends on |
|---|---|---|---|
| 0 | **B0** | **Offline Hub snapshot inspector** (§5) | — |
| 0 | B0b | Read-only Hub snapshot dump script (Admin SDK, read-only service account, JSON + manifest) | B0 format |
| 0 | B-R1 | Keep `email_normalized` in sync on profile email edits + read-only drift counter | — |
| 1 | B1 | ADR-007 Contact Hub native integration + ADR-002 amendment (`emails[]` status, `external_ids`) | Owner approval of §3 |
| 1 | B2 | Pure contract modules + tests: `src/constants/contactHub.js`, `src/utils/emailPermission.js` (mapping and transitions), `src/utils/stickerName.js` | B1 |
| 2 | B3 | Rules for the new collections + rules-check cases (§3.8) | B1 |
| 2 | B4 | `CONTACT_HUB_MODE` + `hub_enrollment` + `contactHubConfig` + `useContactHubAvailability` | B1 |
| 2 | B5 | `stickerService.js`: create, rename, archive and restore, list (emulator write-semantics tests) | B3 |
| 2 | B6 | `contactStickers.js` + `verifyWritePaths` rule for sticker fields | B5 |
| 2 | B7 | People: sticker filter and Stickers view (flagged) | B4, B6 |
| 2 | B8 | Contact Profile: `StickerRow` and picker (flagged) | B4, B6 |
| 2 | B9 | Email permission ledger service + `EmailPermissionLine` + Record unsubscribe (flagged) | B2, B3 |
| 2 | B10 | Cadence enforcement: bulk excludes `unsubscribed`, 1:1 warns (unflagged; a no-op while the ledger is empty) | B9, #761 |
| 2 | B11 | Timeline type `imported_activity` + renderer | B1 |
| 2 | B12 | CSV: Apply stickers step, Stickers column, export column (flagged) | B6 |
| 3 | B13 | Pure transform: Hub snapshot → candidates (§3.5) | B2, B0 |
| 3 | B14 | Migration dry run (server adapter, read-only) + report + review items file | B13 |
| 3 | B15 | `import_review_items` + `HubReviewScreen` | B3, B14 |
| 3 | B16 | Live / verify / rollback + manifest + per-user JSON backup and restore scripts | B14, B15 |
| 3 | B17 | Staging rehearsal runbook + results template | B16, staging project |
| 4 | B18 | Barry reads sticker names and `person_type` (read-only), with tests that Barry never writes stickers or permissions and never starts outreach | B6, Q5 |
| 5 | B19 | Pilot runbook: enroll the designated account, regression checklist, production approval record | All |

---

## 5. Minimum safe first development PR (B0)

**Title:** Contact Hub: offline snapshot inspector (read-only, no Firebase)

**Why first:**
- It unblocks Gate 0's "verify live source data" and "has `stk_*` overwritten definitions?" as soon as a snapshot exists.
- It needs no contract approval.
- It touches no app code, no rules and no Firestore.
- Nothing it adds ships in the web bundle or any function.

| | |
|---|---|
| Files | `scripts/hub/inspectHubSnapshot.mjs` (CLI); `scripts/hub/lib/inspect.js` (pure functions); `src/test/hubSnapshotInspect.test.js`; `src/test/fixtures/hub-snapshot-synthetic.json`; `scripts/hub/README.md` (snapshot format and usage) |
| Input | A local JSON file: `{meta: {project, exported_at, tool_commit}, collections: {<name>: [{id, data, subcollections?}]}}` |
| Output | A JSON report plus a short console summary (details below) |
| Privacy | Prints **counts and document IDs only**: never names, emails, phones or notes, verbose mode included. Tested. |
| Isolation | Imports only Node built-ins and `src/utils/identityNormalization.js`, which has no Firebase import, so "same email" means what IDYNIFY means. A test fails if any `firebase` import appears. No network. |
| Tests | A synthetic fixture with: a takeover (members predating the sticker's `createdAt`); an orphan reference; a deleted-but-referenced sticker; mixed `createdAt` clusters; same-email duplicates with compatible and different names; consent defaults; a missing `dateAdded`. Each grade is asserted. Breaking the grading logic must fail a test. |
| Production impact | None. |
| Rollback | Delete the files. Nothing is deployed or migrated. |
| Size | About 300–400 lines including tests |

**What the report contains:**
- counts per collection, and a field inventory (field → count and types), including any unexpected collection
- sticker grades: `clean`, `suspect`, `orphan`, deleted-but-referenced, name-duplicate
- the `stk_*` allocation footprint
- Hub-internal duplicate groups by normalized email (sizes and IDs)
- consent-label distribution
- no-email and name-inferred-from-email counts
- documents the Hub UI hides (missing `dateAdded` or `createdAt`)
- inline-image size statistics
- the snapshot's SHA-256

---

## 6. Outstanding blockers and decisions

### Blockers (owner action)

| # | Blocker | Unblocks |
|---|---|---|
| B1 | Read-only access to `utadco-hub` (a service account with `roles/datastore.viewer`, or a managed export plus a JSON dump delivered to a restricted bucket) | A7, B0b, Gate 0 data verification |
| B2 | How `hub.utahadvocacy.org` is deployed, and which file is live | A2–A6 deployment verification |
| B3 | Export of the live `utadco-hub` Firestore rules | A1 |
| B4 | Authorization for Team A fixes to be merged and deployed | Gate 0 |
| B5 | An isolated non-production Firebase project for IDYNIFY (#664) | Gate 2 staging tests, Gate 3 rehearsal |
| B6 | Consent enforcement policy: block bulk, warn 1:1 (recommended)? A correction path for a mistaken unsubscribe? | §3.4, B10 |
| B7 | CC account access, for real `permission_to_send` and consent dates (optional; without it, Hub-derived permissions stay `unknown` or `unsubscribed`) | Ledger `subscribed` evidence |

### Decisions

| # | Decision |
|---|---|
| Q1 | Designated destination account (UID) for the pilot |
| Q3 | `person_type` for Hub contacts (`network` proposed) |
| Q5 | May Barry read Hub notes in Gate 4? Proposed: no, stickers and `person_type` only |
| Q6 | Photos and sticker images: migrate later or drop |
| Q12 | The PII already published in the page source: any disclosure or notification obligation? |
| Q13 | Hub "Log activity": fix persistence or hide it until cutover |
| Q14 | The other Hub users: read-only Hub until sunset, or their own IDYNIFY accounts later (no sharing in this release) |

---

## 7. GO / NO-GO

| Gate | Recommendation | Condition to move |
|---|---|---|
| **Gate 0: Readiness** | **NO-GO** | B1–B5 cleared; A1–A4 and A8 done with authorization; snapshot inspected; B-R1 merged |
| **Gate 1: Contracts** | **GO to approve §3** (no build) | Owner answers Q1 and B6 and approves §3.2–§3.9 |
| B0 (first PR) | **GO to build when authorized** | None. Safe before Gate 0 completes. |
| Gates 2–5 | Not started | Their gate conditions, in order |
