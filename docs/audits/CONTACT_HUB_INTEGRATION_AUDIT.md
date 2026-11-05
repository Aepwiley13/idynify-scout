# Contact Hub → IDYNIFY integration: architecture audit

> **Superseded in part (2026-11-04):** the Contact Hub is now a reference application only, and no data will be migrated.
> Every migration section below is cancelled. The current plan is `docs/contact-hub/NATIVE_STICKERS_PLAN.md`.
> The Hub security findings still apply to the live Hub, and now belong to a separate project.

**Date:** 2026-11-04
**Type:** Audit only. Nothing was built, migrated, deployed or merged. No production data was read or changed.
**Verdict:** **NO-GO for migration today.** Approve Option C (integrate into People and Contact Profile), then start Phase 0 and Phase 1, both read-only.

| Repository | Revision read |
|---|---|
| `Aepwiley13/idynify-scout` | `main` at `c2fee5c` (merge of #758) |
| `Aepwiley13/utadco-hub-functions` | `main` at `16c9d09` (Netlify function only) |
| `Aepwiley13/utadco-hub-functions` | branch `claude/festive-goldberg-15t5rl` at `3017104`, [PR #1](https://github.com/Aepwiley13/utadco-hub-functions/pull/1) (open, unmerged): **the Hub frontend** |

Labels used below:
- ✅ **Verified**: read in source code at the revision above.
- ⚠️ **Inferred**: follows from the code, but needs production data to confirm.
- ❓ **Unverified**: blocked. See section 9.

---

## Contents

1. [Summary](#1-summary)
2. [Verified current-state architecture](#2-verified-current-state-architecture)
3. [Contact Hub feature inventory](#3-contact-hub-feature-inventory)
4. [Legacy sticker IDs (`stk_*`)](#4-legacy-sticker-ids-stk_)
5. [IDYNIFY destination review](#5-idynify-destination-review)
6. [Source-to-destination field mapping](#6-source-to-destination-field-mapping)
7. [Migration architecture](#7-migration-architecture)
8. [Product integration: A vs B vs C](#8-product-integration-a-vs-b-vs-c)
9. [Blockers and unresolved questions](#9-blockers-and-unresolved-questions)
10. [Security review](#10-security-review)
11. [Risk register](#11-risk-register)
12. [Reuse / build / defer matrix](#12-reuse--build--defer-matrix)
13. [Proposed user experience](#13-proposed-user-experience)
14. [Acceptance tests](#14-acceptance-tests)
15. [Phased roadmap](#15-phased-roadmap)
16. [PR plan](#16-pr-plan)
17. [Final recommendation and GO / NO-GO criteria](#17-final-recommendation-and-go--no-go-criteria)

---

## 1. Summary

**What the Hub is.** One HTML file, about 2,500 lines with inline JavaScript. The browser reads and writes Firestore directly in Firebase project `utadco-hub`. The only server code is one Netlify function that proxies Constant Contact (CC). The frontend is **not on `main`**. It exists only on the unmerged PR #1 branch, committed on 2026-10-09 as "currently deployed". How the live site is deployed is unknown.

**What IDYNIFY is.** Contacts live at `users/{uid}/contacts/{contactId}`, one tree per user. There is **no shared or team workspace**: in this codebase "workspace" means one user's account. Identity, merge and enrichment rules are mature and documented (ADR-002, `contactProtection.js`, the "discovery enriches, never replaces" principle). There is **no isolated staging Firebase project** ([#664](https://github.com/Aepwiley13/idynify-scout/issues/664)).

**Findings that change the plan:**

1. **The Hub's "Subscribed" label is not consent** ✅. Four write paths default to it: the Add form, the Edit form when the field is empty, CSV import, and CC pull. CC pull also turns every CC permission except `unsubscribed` into "Subscribed". Importing it as consent would create exactly the inferred consent this audit must prevent.
2. **The Hub's "Push to CC" can assert explicit consent and re-subscribe people** ✅. Every contact with an email and no `ccContactId`, including Hub "Unsubscribed" contacts, is sent to CC's `sign_up_form` endpoint. CC documents that endpoint as only for contacts who gave explicit permission, and warns it can mark an unsubscribed contact as having given explicit permission ([CC docs](https://developer.constantcontact.com/api_guide/contacts_create_or_update.html)). This is a live compliance exposure in the Hub, separate from any migration.
3. **Legacy sticker membership is unreliable** ✅⚠️. Before the unmerged fix, every page load restarted sticker IDs at `stk_100`, and new stickers overwrote existing documents. Import-created stickers were never saved but were still referenced by contacts. Membership of any `stk_*` sticker can be a mix of several unrelated stickers, and the data does not record which.
4. **Hub access control is UI-only as far as the code shows** ✅❓. No Firestore rules exist in any repository. The client hides buttons by role, but viewers can still reach Add contact and Import. Every list renders unescaped user data through `innerHTML`, including Google display names inside admin `onclick` handlers (stored XSS).
5. **The Hub page source embeds 50 email-to-phone pairs** ✅ (`patchPeoplePitchPhones`). It is the same HTML as the sign-in screen, so anyone who can load the page can read them.
6. **The Hub's "Log activity" never saves** ✅. `saveActivity` changes only in-memory state, and looks contacts up by a field that new contacts do not have. "Archive" is a hard delete. "Clean up duplicates" hard-deletes and drops the losing records' notes, extra emails and CC IDs.
7. **IDYNIFY already imports Hub CSVs** ✅ (CSV → People → Cadence). That path drops `Stickers`, `Source`, `Email Status` and `Date Added`, caps a file at 500 rows, and has never been run on staging ("NOT YET RUN"). It is not a migration path.

**Recommendation.** **Option C**: bring the Hub's useful capabilities into IDYNIFY's existing People and Contact Profile, keeping one canonical contact store. Load the data with a one-time, server-side, idempotent migration from a frozen Firestore snapshot of `utadco-hub`, not from CSV. Add three small destination structures, none of them a contact database:

- a per-workspace **sticker registry**
- a namespaced **external identity map** on contacts
- a per-workspace, per-address **email permission ledger**

---

## 2. Verified current-state architecture

### 2.1 Source: Utah Advocacy Contact Hub

```
hub.utahadvocacy.org  (single index.html; Firebase JS "compat" SDK 10.12.0)
 │
 ├── Firebase Auth ── project utadco-hub ── Google sign-in (popup)
 │
 ├── Firestore ── project utadco-hub   ← read/written directly by the browser
 │     contacts/{autoId}
 │     stickers/{id}            ids: 8 slug seeds | legacy stk_<n> | auto-ids (fix branch)
 │     users/{firebaseUid}      role: viewer | editor | admin, approved: bool
 │     access_requests/{autoId}
 │     (rules: not in any repo ❓; other collections: unknown ❓)
 │
 ├── localStorage: CC access token, Luma API key, proxy URL, CC list id
 │
 └── POST {proxy from localStorage}/.netlify/functions/cc-auth
        utadco-hub-functions (Netlify; CORS limited to hub.utahadvocacy.org; no caller auth)
          actions: token | contacts | get_lists | push_contact
          └── Constant Contact v3 API (api.cc.email)
```

| Fact | Status | Evidence |
|---|---|---|
| The frontend is one file; the deployed copy is on an unmerged branch only | ✅ | PR #1; `hub/README.md`; commit `dbef78f` "as currently deployed" |
| Which code is live (pre- or post-sticker-fix) | ❓ | Site unreachable from the audit sandbox (DNS blocked). PR #1's Netlify deploy preview failed. |
| Firestore rules for `utadco-hub` | ❓ | Not in either repo; no project credentials |
| Collections | ✅ for the four the code uses; ❓ for others | `index.html`. A comment mentions a Firestore "config" holding the CC client secret (`index.html:2225`), but no code reads it. |
| Authorization | ✅ client-side only in code | `applyRoleUI` (`index.html:985`) |
| Analytics or usage telemetry | ✅ none | No analytics code, so which features people use can only be inferred |

### 2.2 Destination: IDYNIFY

```
IDYNIFY SPA (React 18, Vite, Firebase Web SDK 12)
 ├── Firebase Auth (IDYNIFY project; a separate user pool from utadco-hub)
 ├── Firestore (one project serves production, previews and local dev: FIRESTORE_DATA_ARCHITECTURE.md §Environment)
 │     users/{uid}                          owner-only; server-controlled fields guarded
 │     users/{uid}/contacts/{contactId}     canonical contact (ADR-002)
 │       └── timeline/{eventId}             typed events (src/constants/timelineEvents.js)
 │     users/{uid}/companies/{companyId}    ADR-003
 │     users/{uid}/cadences, missions, …
 │     relationship_events/{uid}__{gmailMessageId}   immutable (ADR-006)
 │     emailSuppressionList/{email}         PLATFORM-WIDE (hard bounces, complaints)
 └── Netlify functions (firebase-admin; bypass rules; verifyAuthToken)
       contactResolver.js → the same identity engine (src/utils/identityResolution.js)
```

| Fact | Status | Evidence |
|---|---|---|
| Tenancy is one user (`uid`) | ✅ | `firestore.rules:106-162` (`owns(userId)`); the identity adapter's `userId` is "the workspace being resolved against" |
| No team, shared or organization workspace | ✅ | No membership model; "workspace" in code means one user's tree |
| Staging is not isolated from production | ✅ | `FIRESTORE_DATA_ARCHITECTURE.md` (§Final production environment mapping); [#664](https://github.com/Aepwiley13/idynify-scout/issues/664); staging issues #648–#651 open |
| Rules are tested against an emulator in CI | ✅ | `scripts/rules-check/`, `.github/workflows/ci.yml` |

---

## 3. Contact Hub feature inventory

### 3.1 Screens and workflows

Line numbers are `hub/index.html` at `3017104`.

| # | Screen / workflow | What it does | Roles that can see it (UI) | Notes |
|---|---|---|---|---|
| 1 | Sign-in | Google popup. A first sign-in self-creates `users/{uid}` (`approved:false, role:'viewer'`) and an `access_requests` doc. | all | `:902` |
| 2 | Pending approval | Shown until an admin approves | all | |
| 3 | **Sticker wall** (home) | Grid of stickers with member counts, edit pencil, "New sticker" | all, viewers included | Filters `!s.archived`; the sidebar does not (`:1124`) |
| 4 | **All contacts** | List/card toggle; search by name, org and email; Export CSV; always-on "Clean up duplicates" banner | all | |
| 5 | **Sticker view** | One sticker's members; search; Export CSV | all | |
| 6 | **Add contact** | Photo, name, email, phone, org, source, email status (default **Subscribed**), notes, stickers. Checks for duplicates by email (merges stickers, adds the email or phone as an extra) and by exact name (asks the user). | admin, editor, **and viewer through the sidebar** | Viewers only lose the top-bar button (`:994`) |
| 7 | Contact detail panel | Fields, extra emails and phones, stickers, activity timeline, "+ Log activity", Edit, Archive | all (Edit: admin and editor; Archive: admin) | |
| 8 | Edit contact | All fields; email status defaults to **Subscribed** when empty (`:1547`); writes the whole record back | admin, editor | No duplicate check after an email change |
| 9 | Log activity | Event, newsletter, form, pitched, donation (amount), volunteered, custom | admin, editor | **Never saved** (§3.3) |
| 10 | Archive | `contacts/{id}.delete()`, a **hard delete** (`:1579`) | admin | |
| 11 | **CSV import** | Step 1: create a sticker for the import. Step 2: apply existing stickers. Step 3: review in buckets (email match, phone and name match, name-only match needing a decision, new). Then confirm. | admin, editor, **and viewer through the "Import list" button** | Naive `split(',')` parser (`:1652`); recognizes Google Contacts headers |
| 12 | CSV export | All contacts or one sticker | all | Unquoted cells (§3.4) |
| 13 | Team | Approve requests with a role, deny, copy the invite link, remove members | admin | |
| 14 | Integrations: Luma | Saves an API key to localStorage, then shows **three hard-coded events**. "Import attendees" just opens CSV import. | admin | A mock; not a working integration (`:2183`) |
| 15 | Integrations: Constant Contact | Implicit-grant OAuth; token in localStorage; proxy URL typed by the user; Pull; Push | admin | §10.3 |
| 16 | Integrations: Google Sheets, Zapier, Public signup | Placeholders ("Coming soon", "Roadmap") | admin | |
| 17 | Clean up duplicates | Groups by primary email, keeps the "richest" record, merges stickers and activity, **hard-deletes the rest** | **all roles** (UI) | Loses the deleted records' notes, extra emails, extra phones, `ccContactId` and photo (`:2425`) |
| 18 | `patchPeoplePitchPhones` | One-off console function with 50 hard-coded email→phone pairs | none (console) | PII in page source (`:2502`) |

**Which features users rely on** (⚠️ inferred; the Hub has no telemetry):
- **Core:** the sticker wall and sticker views (the home screen), CSV import with stickers, search, the contact detail panel, CSV export.
- **Used at least once:**
  - CC pull: a banner reads "Duplicates detected from the Constant Contact import".
  - A "People Pitch" import: the phone patch and the sticker incident in commit `3017104`.
- **Probably unused or broken:**
  - Luma (a mock).
  - Log activity (never saves).
  - CC push (likely failing for existing CC contacts; see §10.3).
  - Sheets, Zapier and Public signup (placeholders).

### 3.2 Data model

**`contacts/{autoId}`** ✅. These are the fields written by any code path. Production may hold more, written by older versions ❓.

| Field | Type / values | Written by |
|---|---|---|
| `first`, `last` | string | all |
| `email` | string (primary) | all |
| `extraEmails` | string[] | duplicate merges |
| `phone`, `extraPhones` | string, string[] (unlabeled) | all, duplicate merges |
| `org` | string | all |
| `notes` | **single string** | add, edit, CSV (fill-only on merge) |
| `source` | free string: "Manual entry", "Constant Contact", "Luma event", "CSV import", "Google", "Site owner", "Referral", or any CSV `source` value | all |
| `emailStatus` | `Subscribed` \| `Unsubscribed` \| `Unknown` \| any CSV value | all; §1 finding 1 |
| `dateAdded` | `YYYY-MM-DD` string, or a CSV value | all |
| `photo` | **base64 data URL, stored inline** | add, edit |
| `stickers` | sticker ID[] | all |
| `activity` | `[{type, detail, amount, date, notes}]` | ⚠️ probably empty everywhere (§3.3) |
| `createdBy` | Hub Firebase UID | all |
| `createdAt` | server timestamp (one batch shares one commit time) | all |
| `ccContactId` | CC contact ID | CC pull and push |
| `ccTagNames`, `ccListNames` | string[] | CC pull, new contacts only |

**`stickers/{id}`** ✅:
- **Fields:** `name`, `colorId` (one of 8 palette ids), `image` (base64), `emoji`, `createdAt`, `deleted`, `deletedAt`, `deletedBy` (fix branch only).
- `archived` is read, but nothing writes it.

**`users/{uid}`** ✅: `name`, `email`, `photo`, `role` (`viewer`/`editor`/`admin`), `approved`, `requestedAt`, `approvedAt`, `approvedBy`.

**`access_requests/{autoId}`** ✅: `uid`, `name`, `email`, `requestedAt`, `status` (`pending`/`approved`/`denied`).

**Behaviours that affect migration** ✅:
- The Hub loads contacts with `orderBy('dateAdded')` and stickers with `orderBy('createdAt')`. Firestore leaves out documents that lack the ordering field, so **counts in the UI can be lower than the data**. Reconciliation must use raw snapshot counts.
- CSV import makes up names from email prefixes when a row has no name (`rowToCandidate`, `:1764`). Those names are **inferred, not observed**.
- Duplicates inside one import file are not detected: two rows with the same email both become "new". CC pull skips name-only matches **silently**: neither added nor counted (`:2316`).
- The import commits every row in one batch. Local state is changed before the commit, so a failed commit leaves phantom contacts on screen until reload.

### 3.3 Activity and history

`saveActivity` (`:1613`) has no Firestore call, and it looks contacts up with `x.id === activeContactId`. Loaded contacts carry `firestoreId`, and no current write path stores an `id` field. **Activity logged in this version is never persisted.**

⚠️ `activity[]` in production is therefore expected to be empty, or to hold data from older versions or from duplicate-merge concatenation. The snapshot must confirm this.

### 3.4 Imports and exports

- **Import headers recognized:**
  - name, first/last, email (including Google Contacts' `E-mail 1 - Value`), phone, org (`Organization Name`), `source`, `email status`, `date added`, `notes`
  - Rows with no name and no email are dropped silently.
- **Export columns:** `First,Last,Email,Phone,Organization,Source,Email Status,Date Added,Notes,Stickers`.
  - Only Stickers is quoted. Commas in notes become spaces.
  - A comma in a name or organization, or a newline in notes, shifts or splits columns.
- **IDYNIFY's CSV import of this export** (✅ `HEADER_ALIASES`):
  - Maps First, Last, Email, Phone, Organization and Notes.
  - Ignores **Source, Email Status, Date Added and Stickers**.
  - Rejects rows with extra cells as invalid.
  - **CSV is not a safe migration channel.**

---

## 4. Legacy sticker IDs (`stk_*`)

### 4.1 How IDs were allocated before the fix (✅ from the `3017104` diff)

| Mechanism | Effect |
|---|---|
| `let nextStkId = 100` on every page load, in every tab | Every session allocates `stk_100`, `stk_101`, … from scratch. Two users, or two tabs, allocate the same IDs. |
| `createSticker` wrote with `set()` (overwrite, no existence check) | **Takeover**: the new sticker replaced the existing document's name, color, image, emoji and `createdAt`. Every contact already pointing at that ID now showed under the new name. The commit message records two real cases: "People Pitch Volunteer → Advisory Board Member" and "Sponsors → Test". |
| `createImportSticker` used the same counter and **never saved the document** | If the ID already existed, imported contacts joined the unrelated existing sticker (**membership merge**), and the import's sticker name was lost on reload. If it did not exist, the contacts held an **orphan reference** that a later `createSticker` in any session would **adopt**. |
| `deleteSticker` removed the ID from every contact, then **hard-deleted** the doc | The ID became free to reuse. Deleting a taken-over sticker also removed the original sticker's membership, **irreversibly** unless a backup exists. |
| Seed stickers (`board`, `coach`, `donor`, `giving`, `nonprofit`, `volunteer`, `events24`, `pitched`) | Stable slug IDs, written only when the collection was empty. Lower risk. |

### 4.2 The fix on PR #1 (✅ read; ❌ not executed here)

- Auto-IDs come from `db.collection('stickers').doc().id`.
- `persistNewSticker` creates in a transaction and refuses an existing ID.
- Deletes are soft (`deleted: true`), and import stickers are saved on confirm.
- Regression tests: `hub/tests/stickers.test.mjs`, against an in-memory Firestore.

**What the fix does not cover:**
- It is **not merged**, the deploy preview **failed**, and whether it is live is ❓.
- **Tabs left open on old code** can keep allocating `stk_<n>` with `set()` until they reload. Only Firestore rules can stop them. Two rule shapes would work:
  - deny creating or updating document IDs that match `^stk_`
  - deny any update that changes `createdAt`, which every takeover rewrites
- It repairs nothing already damaged.
- The test seed's numbers (1,500 contacts, 721 in `stk_100`) are **synthetic**, not measured production values.

### 4.3 Detection the snapshot inspector must run (read-only)

| Check | Classifies as |
|---|---|
| A sticker ID referenced by a contact with no sticker doc | **Orphan** |
| A reference to a doc with `deleted: true` | **Deleted, still referenced** (keep as history, hidden) |
| Two or more live stickers with the same normalized name | **Name duplicate** |
| `stk_<n>` whose members were mostly created *before* the sticker's `createdAt` | **Suspected takeover or adoption**. A strong signal, not proof: members can be tagged later by edit or merge. |
| `stk_<n>` whose members fall into several `createdAt` clusters (one batch shares one commit timestamp) | **Suspected mixed membership** |
| Highest `stk_<n>`, and every gap below it | Allocation footprint |
| Auto-ID vs `stk_` vs slug | Era (post-fix, pre-fix, seed) |

**Rule for migration.** Every `stk_*` sticker is migrated with an integrity grade: `clean`, `suspect` or `orphan`.
- A **suspect** sticker's membership is applied only after the owner reviews and signs off its member list.
- **Orphans** become no sticker. They are listed for the owner, who may name them.
- No Hub sticker ID is ever reused as an IDYNIFY ID. Hub IDs live only in `external_ids`.

---

## 5. IDYNIFY destination review

| Area | Current state | Evidence |
|---|---|---|
| Canonical schema and path | `users/{uid}/contacts/{contactId}`. The document ID is the identity. | ADR-002, `peopleSchema.js` |
| Ownership | Owner only, by rules. Server functions use the Admin SDK and bypass rules. | `firestore.rules:129-161` |
| Creation | Every client path calls `prepareContactWrite`, checked by `scripts/verifyWritePaths.mjs`. Add Manually and CSV share `buildUserAddedContact`. | `contactWriteGuard.js`, `userAddedContact.js` |
| Identity hierarchy | ID → email → Apollo ID → LinkedIn → phone (person-level labels only on typed lists) → name **+ company** (flag only, never merge). Two records sharing one identifier is a refusal. | `identityResolution.js` |
| Merge | `mergeIdentifiers`: identifiers accrete; `CANONICAL_FIELDS` are never written; `company_id` and `company_name` are fill-only; provenance goes to `identity_sources` (append-only). | `identityResolution.js:484-605` |
| Enrichment | Fill-only. A differing value becomes a suggestion. Field provenance is in `enrichment_provenance`. LinkedIn is attached only through Confirm. | `contactProtection.js`, `docs/architecture/enrichment-rules.md` |
| Recent identity work | #758 (merged 2026-11-03): LinkedIn Confirm and Resolve/Save decide races in a transaction against the latest doc. | PR #758 |
| Pending identity work | #760 (double counting); **#739** (no way to tell a field the user cleared from one never filled); #691 (whether to enrich after upload); the dedup sprint (`identity_review_required` is written, nothing consumes it). | open issues; ADR-002 |
| CSV import | PapaParse; preview before writing; in-file duplicates; email conflicts held back; group tag `CSV Import - <name> - <date>`; `import_batch_id`; notes → `notes[]` with `source`; 500 rows max; staging run **not yet done**. | `docs/CSV_TO_CADENCE.md`, `STAGING_VALIDATION_CSV_TO_CADENCE.md` |
| Companies | `ensureCompanyForContact` reuses a company by Apollo ID, name or domain, and a user-typed name is protected. | ADR-003 |
| Tags | `tags: string[]`, free text, **no stable IDs and no registry**. Suggestions come from the first 500 active contacts. | `IdentityCard.jsx:681-745`, `peopleService.js:539` |
| Archive | Soft: `is_archived: true` plus `status`. People are never hard-deleted. One exception: undoing a company approval hard-deletes that company's `icp_auto_discovery` contacts. | `peopleService.js:450`, `companyDecision.js:354` |
| Notes | `contact.notes[]` = `{id, content, created_at, updated_at, source?}`. The schema doc says `sticky_notes`, but the UI uses `notes`. | `StickyNotes.jsx`, `csvImportService.js:205` |
| Timeline | `users/{uid}/contacts/{id}/timeline/{eventId}`, typed allowlist. No type for event, donation, volunteer, newsletter or imported activity. | `timelineEvents.js` |
| `email_status` | **Means email verification** (`verified`/`likely`/`unverified`, from Apollo). | `contactProtection.js:199`, `IdentityCard.jsx:425` |
| Marketing consent | **None per workspace.** Only the platform-wide `emailSuppressionList` (bounces, complaints). | `netlify/functions/utils/emailLog.js:270-320` |
| Multiple emails | **None.** One email identity per contact (`email`/`work_email`). | `identityNormalization.js:114` |
| Profile UI | `/contact/:id` → `ContactPage` → `ContactProfile`. One implementation; a second contact destination is a defect. | ADR-001, ADR-004 |
| People | `/command-center?tab=people`; tag filter through `?tag=`; source filter; Export CSV. | `AllLeads.jsx`, `PeopleMain.jsx` |
| Mission Control | Recommendations need `strategic_value` high or critical, so a bulk import does not flood them. Backdating `addedAt` would trip age thresholds once a contact is marked high-value. | `recommendationEngine.js:359` |

### 5.1 What already supports the Hub with no new structures

| Hub need | Existing IDYNIFY field |
|---|---|
| Name | `name`, `first_name`, `last_name` |
| Primary email | `email`, `email_normalized` |
| Phones (unlabeled) | `phones[]` with label `unknown` (`labelSource: 'import'`), plus `phone` |
| Organization | `company`, `company_name`, optionally `company_id` |
| Notes | `notes[]` with `source` |
| Import grouping | `import_batch_id`, `import_name`, group tag |
| Where a record came from | `identity_sources` (append-only), `identity_source` |
| Weak-match flag | `identity_review_required`, `identity_review_candidates` |
| Archive | `is_archived`, `record_status` |
| Relationship type | `person_type` (`network` or `partner` fit a community rolodex better than `lead`) |
| Photo | `photo_url` (a URL, not inline base64) |

### 5.2 What needs new (small) structures

| Need | Why existing fields fail |
|---|---|
| **Stable sticker IDs and a registry** | `tags[]` are strings: a rename rewrites every member, two stickers with one name merge, and nothing holds color, emoji or provenance. |
| **External identity map** | Nothing records "this is Hub contact X". Re-runs need an exact, queryable key. |
| **Email permission ledger** | `email_status` already means verification. The suppression list is platform-wide. Permission belongs to an address in a workspace, not to a person. |
| **Additional emails** | One email per contact. Hub `extraEmails` are identity-relevant (ADR-002 amendment). |
| **Imported-activity timeline type** | The allowlist rejects unknown types. |
| **`addedFrom` value `utadco_hub`** | `ADDED_FROM_SOURCES` is an enum. |

---

## 6. Source-to-destination field mapping

**Destination workspace** = one IDYNIFY `uid`, chosen by the owner (Q1). Hub users and Hub UIDs are **not** mapped to IDYNIFY users.

| Hub field | IDYNIFY destination | Rule |
|---|---|---|
| `contacts/{id}` doc ID | `external_ids.utadco_hub_contact` | Exact key; checked before the identity hierarchy on every run |
| `first`, `last` | `first_name`, `last_name`, `name` | New contact: written. Matched contact: **never** written (canonical). A differing name is recorded as a suggestion in the report. Names derived from an email prefix get `hub_provenance.name_inferred: true`. |
| `email` | `email`, `email_normalized` | Primary identity. Invalid format → review queue. |
| `extraEmails[]` | `additional_emails[]` and `additional_emails_normalized[]` (new) | Each one is resolved. A hit on a *different* IDYNIFY contact → review. Never promoted to primary. |
| `phone`, `extraPhones[]` | `phones[]` entries labelled `unknown`; `phone` only when the contact has none | `unknown` never identifies a person (ADR-002 amendment), so no phone-only merges |
| `org` | New contact: `company`, `company_name`, plus `ensureCompanyForContact` (`nameSource: USER`). Matched contact: suggestion only. | Fill-only would refill a field the user cleared (#739). How many companies would be created is shown in the dry run. |
| `notes` (string) | `notes[]` entry `{id: 'utadco_hub_<hubId>', content, created_at: <hub createdAt>, source: 'utadco_hub'}` | Deterministic ID; skipped if the same content is already present; existing notes untouched |
| `activity[]` | `timeline/{utadco_hub__<hubId>__<n>}` type `imported_activity`, actor `system`, metadata `{hub_type, detail, amount, date, notes}` | Created with `create()` (exactly once) |
| `stickers[]` | `sticker_ids[]` (new) + `sticker_provenance.<id>` `{added_at, source:'utadco_hub', integrity}` | Mapped through the registry's `external_ids.utadco_hub_sticker`. Suspect stickers wait for sign-off (§4.3). |
| `emailStatus` | `users/{uid}/email_permissions/{email_normalized}` (new) | `Unsubscribed` → `unsubscribed` for **every** address of that contact. `Subscribed` → `unknown` with `observed_label: 'Subscribed'`. Anything else → `unknown`. **Never `subscribed`. Never `email_status`.** |
| `source` | `hub_provenance.source_label`; `addedFrom: 'utadco_hub'`; `identity_sources += 'utadco_hub'` | The Hub label is provenance, not an IDYNIFY source enum |
| `dateAdded`, `createdAt` | `hub_provenance.date_added`, `hub_provenance.created_at` | `addedAt` = migration time (not backdated) |
| `createdBy` | `hub_provenance.created_by_hub_uid` | A Hub UID in another auth pool, never an IDYNIFY owner |
| `photo` (base64) | Deferred (Q6). If kept: upload to Storage → `photo_url`. | Never inline in a document |
| `ccContactId` | `external_ids.constant_contact` | The CC account ID is unknown, so it is a hint, not an identity |
| `ccTagNames`, `ccListNames` | `hub_provenance.cc_tags`, `hub_provenance.cc_lists` | Not stickers unless the owner decides (Q7) |
| `stickers/{id}` | `users/{uid}/stickers/{autoId}` `{name, name_normalized, color, emoji, status, created_at, external_ids.utadco_hub_sticker, legacy_integrity}` | Soft-deleted Hub stickers are migrated as `status: 'archived'` so their history keeps resolving |
| `users`, `access_requests` | Not migrated; kept in the snapshot only | |

**New-contact defaults:**
- `person_type`: `network` (Q3)
- `contact_status`: `New`
- `is_archived`: `false`
- automatic enrichment: off (Q11)

---

## 7. Migration architecture

### 7.1 Principles

1. **One canonical contact per workspace and identity.** The migration goes through `resolveContactCore` and the server adapter (`contactResolver.js`). There is no second resolver.
2. **Source IDs live in a namespaced map** (`external_ids.utadco_hub_contact`, `external_ids.utadco_hub_sticker`, `external_ids.constant_contact`). Lookup order: external ID first, so a re-run is recognised; then the ADR-002 hierarchy.
3. **Stable sticker IDs per workspace.** IDYNIFY auto-IDs, created inside a create-only transaction. Hub IDs are never reused.
4. **Non-destructive merge with provenance.** `mergeIdentifiers` rules plus `hub_provenance`, per-field sources, and per-sticker provenance. No canonical field on an existing contact is written; differences become suggestions.
5. **Four things kept separate:**
   - **identity:** contact doc identifiers
   - **notes:** `notes[]`
   - **marketing permissions:** the ledger, keyed by address
   - **relationship metadata:** stickers, `person_type`, the timeline
6. **Records without email** are created with no email identity. They are never merged on name alone; a name match goes to review. `phones[]` are labelled `unknown`, and the report counts these records separately.
7. **No inferred consent.** A Hub label can only lower permission (`unsubscribed`) or leave it `unknown`.
8. **Idempotent.** Deterministic IDs for notes, timeline events and manifests. A re-run writes nothing.
9. **Nothing uncertain is merged automatically.** It goes to the review queue.

### 7.2 Pipeline

```
[A] Freeze + snapshot (Hub)                  read-only to IDYNIFY
    rules write-freeze on utadco-hub → managed Firestore export (all collections
    via listCollections, incl. subcollections) → JSON snapshot + per-doc sha256 + counts
        │
[B] Inspect (offline, pure)                  no network
    schema inventory · sticker integrity (§4.3) · Hub-internal duplicate groups ·
    consent-label distribution · no-email count · doc-size/base64 report
        │
[C] Transform (offline, pure, unit-tested)
    Hub doc → candidate {identity, profile, notes, events, stickerRefs, permissions}
        │
[D] Resolve — DRY RUN against target workspace (Admin SDK, READ-ONLY)
    per candidate: external id → ADR-002 hierarchy → extra emails → name-only check
    → outcome bucket (below) → dry-run report + review-queue file
        │
[E] Human review                              owner decides every queue item
    same / different / skip; suspect-sticker sign-off
        │
[F] LIVE (staging first, then production)    Admin SDK, target uid allowlisted
    stickers (create-only) → contacts (transaction per contact against latest doc)
    → notes / timeline (deterministic ids, create()) → permissions ledger
    every write appended to migration manifest
        │
[G] Verify + reconcile                       read-only; must be exact
        │
[H] Rollback (if needed)                     manifest-driven, only what is still as written
```

**Dry-run outcome buckets:**

| Bucket | Action in a live run |
|---|---|
| `NEW` | Create |
| `MATCHED_EMAIL` | Merge identifiers, add stickers, notes and events. No canonical writes. |
| `RERUN_NOOP` / `RERUN_UPDATE` | Nothing / fill-only |
| `HUB_DUP_COLLAPSE` | Several Hub docs, same email, compatible names (equal, or one empty) → one IDYNIFY contact, union of stickers and notes |
| `HUB_DUP_REVIEW` | Same email, different names (shared inbox?) → review |
| `REVIEW_NAME_ONLY` | Name matches an IDYNIFY contact, no exact identifier. IDYNIFY's step 6 needs a company, so the migration adds this check. → review, never merged |
| `REVIEW_EXTRA_EMAIL` | An extra email hits a different contact than the primary → review |
| `CONFLICT_IDENTITY` | `IdentityConflictError` (two IDYNIFY contacts share the email) → not imported; listed |
| `NO_EMAIL` | Create with no email identity (or review, on a name match) |
| `INVALID` | Bad email format, or no name and no email → not imported; listed |
| `STICKER_SUSPECT` / `STICKER_ORPHAN` | Membership held until sign-off / reported |

### 7.3 Backups, manifest, reconciliation, rollback

- **Backups (both must be taken and test-restored before a live run):**
  - the Hub snapshot (kept until sign-off + 90 days, in a restricted bucket)
  - a managed export of the IDYNIFY project, or at least `users/{target}/**`
  - Whether point-in-time recovery is enabled on either project is ❓.
- **Manifest** (`migration_manifests/{runId}`, server-only, or an off-database file), with one entry per written document:
  - `path` and `action` (`created` / `updated`)
  - `fields_added` and `before_hash` / `after_hash`
  - IDs of notes, events and stickers added
  - Snapshot hash and the code commit
- **Reconciliation (must hold exactly):**

  ```
  hub_contacts_in_snapshot
      = created + matched + collapsed_into_other + review_held + conflict + invalid
  idynify contacts with external_ids.utadco_hub_contact (counted per Hub id)
      = created + matched + collapsed
  for each migrated sticker: hub member set (live, not held) == idynify member set (via id map)
  notes migrated == hub contacts with non-empty notes (minus held)
  timeline events == hub activity entries (minus held)
  unsubscribed addresses in ledger ⊇ every address of every Hub "Unsubscribed" contact
  ```

  Plus a human spot check: all review items and a random 5% sample.
- **Rollback:** idempotent and driven by the manifest. It removes only what the migration added and is still as written:
  - **Created contacts:** deleted only while unchanged (hash matches). Changed ones are reported, not deleted.
  - **Matched contacts:** only the added identifiers, sticker IDs, note IDs and event IDs are removed. User edits made after the migration stay.
  - **Ledger entries:** the migration's entries are removed. An unsubscribe recorded later by a user action stays.

### 7.4 Write safety

- **Server-side script, not a browser path:** `scripts/hub/migrateContactHub.mjs`, following the `--dry-run` / `--verify` conventions of `backfillContactIsArchived.mjs`.
- Default mode is dry run. Live mode needs `--live --target-uid=<uid> --snapshot-sha=<sha>`, and the UID must be on an allowlist.
- Each contact is written in a transaction against the latest document (the #758 pattern), so an edit made between the dry run and the live run is never overwritten.
- Every path written is built from one `users/${TARGET}` constant, and verification asserts the manifest has no path outside that prefix.
- Do not merge onto `source: 'icp_auto_discovery'` records without review. `undoApprovalSideEffects` hard-deletes them (`companyDecision.js:354`).

---

## 8. Product integration: A vs B vs C

| Criterion | **A. Embed the Hub** | **B. Rebuild as an independent IDYNIFY module** | **C. Integrate into People and Contact Profile** |
|---|---|---|---|
| Contact databases | **Two, permanently** (violates constraint) | Two if it keeps its own store; if not, it is C plus a second contact destination (violates ADR-001) | **One** |
| Identity and dedup | None across systems | Needs its own, or reuses C's anyway | ADR-002 engine, already tested |
| Auth | Two sign-ins; Google popup inside an iframe; separate user pools | One | One |
| Security | Inherits the Hub's XSS, UI-only roles, token in localStorage | Rebuilt | IDYNIFY rules and React escaping |
| Barry, Scout, Hunter, Mission Control | No | Partial, through glue code | Native: same contact, timeline and Barry context |
| UX | Context switching, two lists | A third place to look for a person | One place; stickers sit beside tags, notes and timeline |
| Engineering risk | Low to build, high to live with | High (duplicate surfaces drift) | Medium, concentrated in a one-time migration with dry run and rollback |
| Speed to market | Days | Weeks to months | ~4–7 weeks of small PRs, gated by decisions and staging |
| Maintainability | Worst (two stacks forever) | Poor | **Best** |

**Recommendation: C.** It is the only option that meets "no second permanent contact database" and ADR-001. It also reuses the most code: the identity engine, contact protection, CSV import, People filters and export, `notes[]`, the timeline and archive. The Hub's distinctive value is a small set of features: stickers as stable categories, the sticker wall, sticker-scoped import and export, and a newsletter unsubscribe state. Each fits into an existing surface.

---

## 9. Blockers and unresolved questions

### Blockers (must be cleared before any GO)

| # | Blocker | Needed |
|---|---|---|
| B1 | No access to `utadco-hub`: data, rules, Auth, indexes, other collections, backups | A read-only service account, or a managed export delivered to a restricted bucket |
| B2 | Live site unreachable from the audit sandbox. Which code is deployed is unknown. How the site is deployed is unknown (the frontend is not on `main`). | The owner confirms, or opens the network allowance |
| B3 | No Firestore rules for `utadco-hub` in any repo | Export the rules; review them; test them in the emulator |
| B4 | No isolated non-production Firebase for IDYNIFY (#664, #648–#651) | Decide and stand it up. Emulator tests are necessary but not enough. |
| B5 | IDYNIFY has no team workspace; the Hub has several users with roles | Owner decision: single-owner workspace, or a separate team-workspace ADR first |
| B6 | Consent policy | Owner decision: do Hub/CC unsubscribes block IDYNIFY cadences (recommended: block bulk, warn on 1:1)? Will IDYNIFY ever send newsletters? |
| B7 | True CC permission values (the Hub label loses information) | CC account access for a read-only re-pull of `permission_to_send` and consent dates |
| B8 | The Hub's regression tests were not executed: the sandbox's safety check blocked running repository code | Run `node --test hub/tests/stickers.test.mjs` in CI or locally |

### Unresolved questions

| # | Question |
|---|---|
| Q1 | Which IDYNIFY account (`uid`) is the destination workspace? |
| Q2 | How many Hub users are there, and who must keep access after cutover? |
| Q3 | `person_type` for Hub contacts: `network` everywhere, or derived per sticker (for example Donor → `partner`)? |
| Q4 | Should the Hub `source` label show on the profile, or be provenance only? |
| Q5 | Donation amounts and advocacy affiliations in notes and activity: any sensitivity policy before they reach Barry (Anthropic API) or Apollo enrichment? |
| Q6 | Photos and sticker images: migrate to Storage, or drop? |
| Q7 | Should CC tags and lists become stickers? |
| Q8 | Sunset: read-only period, final archive, and who owns the `utadco-hub` project afterwards? |
| Q9 | Have hard deletes (Archive, Clean up duplicates, old sticker delete) already lost data? Is there a backup older than those events? |
| Q10 | Is PR #1 merged and deployed before the freeze, or is the freeze the fix? |
| Q11 | Should Hub contacts be enriched at all (#691)? Proposed default: never automatically. |

---

## 10. Security review

### 10.1 Authentication and authorization boundaries

| Boundary | Hub | IDYNIFY |
|---|---|---|
| Identity provider | Firebase Auth, project `utadco-hub`, Google | Firebase Auth, IDYNIFY project. **A separate pool: the same person has different UIDs. Never assume they match.** |
| Who can read data | Any signed-in user, *as far as the client code shows*. The client loads all contacts after checking `approved` itself. Rules ❓. | Owner of `users/{uid}` only (rules, CI-tested) |
| Role enforcement | **Client-side** (`applyRoleUI`, `:985`), and incomplete: viewers keep Add contact and Import list, and every role sees sticker create/edit/delete and "Clean up duplicates" | Rules, plus server-controlled user fields |
| Self-approval risk | A first sign-in writes its own `users/{uid}` with `approved:false, role:'viewer'`. If rules let a user write their own user document, they can set `approved:true, role:'admin'`. ❓ **Critical until rules are verified.** | `role` and the other server fields are denied to clients (`firestore.rules:65-116`) |

### 10.2 Server-side access

- **IDYNIFY** functions run on the Admin SDK and **bypass rules**. The migration will too, so isolation depends on code: target UID allowlist, single path prefix, manifest audit (§7.4), emulator tests (§14).
- **The Hub's `cc-auth` function:**
  - Has no caller authentication. CORS restricts browsers only.
  - Its `contacts` action returns everything a supplied token can read, so it is a relay for anyone with a CC token.
  - Its `token` action would exchange codes using the client secret, but the frontend never calls it: `exchangeCCToken` is undefined (`:2217`).

### 10.3 Constant Contact OAuth, tokens and permissions (✅ code; CC behaviour from CC docs)

| Issue | Severity |
|---|---|
| `push_contact` without `ccContactId` → `POST /contacts/sign_up_form` for **every** contact with an email, ignoring `emailStatus`. CC: "only use this method when a contact gives you their explicit permission", and it can set an unsubscribed contact to explicit permission. | **Critical** (compliance) |
| `push_contact` with `ccContactId` sends `permission_to_send: 'normal'`, which is not a documented CC value. ⚠️ These updates probably fail and are counted as "skipped". | Medium |
| Pull: every CC permission except `unsubscribed` (implicit, explicit, pending, temp hold, not set) → "Subscribed" | **Critical** for migration semantics |
| Implicit grant (`response_type=token`). The token sits in `localStorage` (readable by any XSS). Users are told to reconnect after ~2 hours. | High |
| The proxy URL is typed by the user and kept in `localStorage`. A wrong value sends the CC token to that host. | Medium |
| Luma API key in `localStorage` (unused) | Low |

**Recommendation:** do not port any of this. If CC sync is needed later, rebuild it server-side:
- authorization code with PKCE
- encrypted refresh tokens stored server-only (like `integrations/linkedin`)
- writes to the permission ledger with the real `permission_to_send` and consent dates
- push limited to the CC endpoints and permission values CC documents for account-initiated updates
- no `sign_up_form` unless the contact acted themselves

### 10.4 Cross-workspace isolation

- **Hub:** one tenant, the whole project.
- **IDYNIFY:** per-user rules are sound. New collections (`stickers`, `email_permissions`) under `users/{uid}` inherit owner-only access through the existing wildcard blocks. A rules-check case must still pin that, plus three narrower rules:
  - deny client delete on `stickers`
  - make `email_permissions/*/history` append-only
  - deny client writes to `external_ids`, so only the migration can set them

### 10.5 Data protection

| Finding | Severity |
|---|---|
| **Stored XSS:** 31 `innerHTML` assignments with no escaping helper anywhere. Contact names, notes, organizations, sticker names and access-request names are interpolated, some inside `onclick` handlers. Any Google account can create an access request whose name runs script in an admin's Team view. | **Critical** (source) |
| 50 email→phone pairs hard-coded in the page source, readable before sign-in | **High** (source) |
| Base64 photos inline in Firestore docs | Low (performance and size) |
| Hub notes and activity may hold donations and affiliations. In IDYNIFY they would reach Barry prompts and could trigger Apollo enrichment. | Medium (policy, Q5, Q11) |
| IDYNIFY renders contact text through React only (no `dangerouslySetInnerHTML` in `src/`), so migrated strings are safe to display | ✅ |

---

## 11. Risk register

Severity:
- **Critical:** legal or compliance exposure, unauthorized access, or irreversible loss is likely.
- **High:** a significant integrity or security risk.
- **Medium:** contained impact.
- **Low:** minor.

| ID | Risk | Sev. | Where | Mitigation |
|---|---|---|---|---|
| R1 | Push to CC asserts explicit consent and may re-subscribe opt-outs | **Critical** | Hub (live) | Stop using Push now; audit CC for contacts whose permission changed through the sign-up form after Hub pushes |
| R2 | The "Subscribed" label is migrated as consent | **Critical** | Migration | Map to `unknown`; test AT-PERM-1 |
| R3 | Stored XSS reaches an admin session (self-approval, data exfiltration, CC token theft) | **Critical** | Hub (live) | Escape output, add a CSP, restrict access until fixed; do not port code |
| R4 | Rules unseen; UI-only roles; possible self-approval or open reads | **Critical** until verified | Hub | B3; emulator tests |
| R5 | PII hard-coded in public page source | High | Hub (live) | Remove from the deployed page |
| R6 | Corrupted `stk_*` membership becomes permanent in IDYNIFY | High | Migration | §4.3 grading plus owner sign-off |
| R7 | Sticker fix not deployed, so corruption may continue until freeze | High | Hub | Deploy PR #1 or freeze writes; rules blocking takeover |
| R8 | No team workspace; credential sharing or lost access | High | IDYNIFY | B5 decision first |
| R9 | No isolated staging; "staging tests" would touch production | High | IDYNIFY | B4 |
| R10 | Users expect activity history that was never saved | High | Hub | Confirm in snapshot; tell users |
| R11 | Earlier hard deletes (Archive, dedupe, old sticker delete) may already have lost data | Medium | Hub | Q9; freeze; hide dedupe |
| R12 | Hub-internal duplicates and shared inboxes | Medium | Migration | Collapse only when names are compatible; otherwise review |
| R13 | Name-only matches: IDYNIFY step 6 needs a company | Medium | Migration | `REVIEW_NAME_ONLY` bucket; never auto-merge |
| R14 | Unlabeled Hub phones are shared organization lines and cause false merges | Medium | Migration | Import as `unknown` |
| R15 | Names made up from email prefixes treated as observed names | Medium | Migration | `name_inferred` flag; never written onto existing contacts |
| R16 | `emailStatus` mapped onto `email_status` (meaning collision) | Medium | Migration | Never map; AT-PERM-5 |
| R17 | A field the user cleared in IDYNIFY is refilled by the Hub value (#739) | Medium | Migration | For matched contacts, Hub org is a suggestion only; identifiers only |
| R18 | Sensitive notes reach the LLM or enrichment | Medium | IDYNIFY | Q5, Q11; no automatic enrichment for `addedFrom: utadco_hub` |
| R19 | Undoing a company approval hard-deletes an auto-discovery contact carrying merged Hub data | Medium | IDYNIFY | Review merges onto `icp_auto_discovery`, or make undo skip records with other `identity_sources` |
| R20 | CC and Luma secrets in `localStorage` | Medium | Hub | Do not port |
| R21 | Hub UIDs treated as IDYNIFY identities | Medium | Migration | Provenance only |
| R22 | An Admin SDK bug writes into the wrong workspace | Low | Migration | Allowlist, prefix assertion, manifest audit, AT-ISO |
| R23 | 500-contact caps on tag suggestions and search hide stickers or contacts | Low | IDYNIFY | Registry-backed sticker picker |
| R24 | CSV used as the migration channel: drops stickers, consent label, provenance; breaks rows | Low (avoided) | Migration | Snapshot, not CSV |
| R25 | CC pull dropped name-matched contacts silently, so the Hub ≠ CC | Low | Hub | Separate CC reconciliation, if CC is ever the source of truth |
| R26 | UI counts ≠ data (documents missing an `orderBy` field are hidden) | Low | Reconciliation | Use raw snapshot counts |

---

## 12. Reuse / build / defer matrix

| Hub capability | IDYNIFY today | Decision | Notes |
|---|---|---|---|
| Google sign-in, approval queue | IDYNIFY auth | **Reuse IDYNIFY auth**; drop the queue | Team access waits on B5 |
| Viewer / editor / admin roles | none | **Defer** (B5) | |
| Contact list, cards, search | People | **Reuse** | |
| Add contact with duplicate check | Add Manually + `prepareContactWrite` | **Reuse**, add a sticker picker | |
| Contact detail, edit | ContactProfile, IdentityCard | **Reuse**, add a stickers row and provenance labels | ADR-001 |
| Archive | Soft archive | **Reuse** (the Hub's hard delete is dropped) | |
| Notes | `notes[]` | **Reuse** | |
| Extra emails | none | **Build** `additional_emails[]` (ADR-002 amendment) | |
| Extra phones | `phones[]` | **Reuse** (label `unknown`) | |
| Activity log | timeline | **Build** the `imported_activity` type; **defer** new manual activity types | The Hub never saved it |
| Stickers (create, rename, color, emoji, delete) | tags (strings) | **Build** a registry + `sticker_ids` | Images deferred |
| Sticker wall | none | **Build** a People "Stickers" view | Small, read-only |
| Sticker-filtered list and export | Tag filter, Export CSV | **Reuse** the patterns, filter on `sticker_ids` | |
| CSV import with stickers and review buckets | CSV import (preview, review, tag) | **Reuse**, add an "Apply stickers" step | |
| CSV export | People Export CSV | **Reuse**, add a Stickers column | |
| Clean up duplicates | `detectDuplicateContacts` (report-only) | **Drop** the Hub behaviour; dedup sprint later | |
| Email status label | none | **Build** the permission ledger + send-path enforcement | |
| CC pull / push | none | **Defer**; rebuild server-side (§10.3) | |
| Luma | none | **Drop** (mock) | |
| Sheets, Zapier, Public signup | none | **Defer** | |
| `patchPeoplePitchPhones` | — | **Drop** | |
| Team page | none | **Defer** (B5) | |

---

## 13. Proposed user experience

**People** (`/command-center?tab=people`):
- A **Stickers** chip row above the list: each sticker with its member count. Selecting one filters the list, the same way `?tag=` does today, with a `?sticker=<id>` URL.
- A **Stickers** view toggle shows the Hub's familiar grid (color or emoji, name, count). "+ New sticker" creates one in the registry.
- **Export CSV** follows the active sticker filter and includes a Stickers column.

**Contact Profile** (one implementation, page and panel):
- **Stickers** row beside Tags in IdentityCard: add an existing sticker, create one inline, remove one. Hovering a sticker shows its provenance: "From Contact Hub · Nov 2026".
- **Notes:** an imported Hub note carries a small "Contact Hub" label.
- **Timeline:** "Attended event: Giving Voices Forum · Jan 18 2025 · imported from Contact Hub".
- **Email permission** line, worded plainly:
  - "Unsubscribed from newsletters (Contact Hub)" in red, with "Not included in cadences".
  - "Newsletter permission: unknown (Contact Hub said 'Subscribed')" in grey.
  - Nothing is ever shown as "Subscribed" without evidence.
- **Also known as:** additional emails.

**CSV import** gains Step 1, "Apply stickers": choose existing stickers or create one. The Hub users' habit is kept.

**Cadences:** unsubscribed recipients are excluded from bulk sends and listed in the picker as "not included: unsubscribed", the same pattern as the existing email-conflict hold-back. On 1:1 compose they get a warning, per B6.

**One-time "Contact Hub review" for the owner.** Each bucket asks one question with three answers: Same person / Different people / Skip.
- possible same person (name only)
- shared email, different names
- extra email belongs to someone else
- stickers to check (suspect legacy membership): shows the member list with Approve / Edit / Don't import

Before Phase 4 ships, this can be a reviewed CSV fed back to the script.

**Barry** sees stickers as relationship context ("Board member · Donor") read-only, and never writes them. **No automatic enrichment** for Hub contacts.

**Mission Control:** no change. The migration triggers no recommendations.

**Hub after cutover:** read-only for 30 days with a banner pointing to IDYNIFY, then archived (Q8).

---

## 14. Acceptance tests

Automated tests run in Vitest with the Firestore emulator; rules cases go in `scripts/rules-check`; the whole set is rehearsed on staging with a real or anonymized snapshot. Each test must fail against a deliberate regression before it is trusted (PLATFORM_PRINCIPLES).

### Sticker-ID collision prevention
- **AT-STK-1** Create 50 stickers across 5 simulated sessions → 50 unique IDs, none matching `^stk_\d+$`, and no existing document's bytes changed.
- **AT-STK-2** Creating a sticker with an ID that is already taken throws, and the existing doc is unchanged (service and rules).
- **AT-STK-3** Rules: a client cannot delete a sticker doc, cannot change `created_at`, and cannot write `external_ids`.
- **AT-STK-4** The migration maps `stk_100` and `stk_101` to two distinct IDYNIFY IDs. A re-run maps to the **same** IDs. No IDYNIFY ID equals a Hub ID.
- **AT-STK-5** An archived (soft-deleted) sticker is never reissued, and its references still resolve to an archived sticker.

### Correct sticker membership
- **AT-MEM-1** For every `clean` sticker, the set of Hub member IDs (live, not held) equals the set of IDYNIFY members mapped back through `external_ids`.
- **AT-MEM-2** A contact with 3 stickers has 3. Removing one in IDYNIFY leaves the other 2 and both other stickers' counts.
- **AT-MEM-3** A `suspect` sticker applies no membership until it is signed off; after sign-off, exactly the approved list.
- **AT-MEM-4** Orphan references create no sticker and appear in the report.
- **AT-MEM-5** Collapsed Hub duplicates carry the union of their memberships.

### Repeated imports produce no duplicates
- **AT-IDEM-1** Live run ×2 on the same snapshot → the second run writes **0** documents, and every count is unchanged.
- **AT-IDEM-2** Change one Hub contact → exactly one IDYNIFY contact updated, fill-only.
- **AT-IDEM-3** Kill the run at ~50% and re-run → no duplicates, and it completes.
- **AT-IDEM-4** Two Hub docs with the same email and compatible names → one IDYNIFY contact.
- **AT-IDEM-5** A Hub contact whose email matches an existing IDYNIFY contact → no new doc, and an external ID is attached.
- **AT-IDEM-6** Notes, timeline events and ledger entries are not duplicated on a re-run (deterministic IDs).

### Existing fields never silently overwritten
- **AT-PROT-1** An existing contact with name, title, company, email, phones, LinkedIn, `stage` and `enrichment_provenance` → after migration every one of those fields is deep-equal to before. Hub differences appear only in the report or as suggestions.
- **AT-PROT-2** A user edit made between the dry run and the live run survives (transaction against the latest doc).
- **AT-PROT-3** `email_status` is never written by the migration.
- **AT-PROT-4** No `notes[]` entry, timeline event or tag that existed before is changed or removed.

### Notes and historical metadata preserved
- **AT-NOTE-1** A Hub `notes` string becomes exactly one `notes[]` entry with byte-equal content, `source: 'utadco_hub'` and a deterministic ID.
- **AT-NOTE-2** Activity entries become the same number of timeline events with `type`, `detail`, `amount`, `date` and `notes` preserved.
- **AT-NOTE-3** `hub_provenance` holds the Hub ID, `createdBy`, `createdAt`, `dateAdded`, the source label and the CC tags and lists.
- **AT-NOTE-4** Extra emails and extra phones are all present.

### Cross-workspace isolation
- **AT-ISO-1** The script refuses to run live without an allowlisted `--target-uid`.
- **AT-ISO-2** Every path in the manifest starts with `users/<target>/`.
- **AT-ISO-3** Workspace B holds a contact with the same email as a Hub contact → B is untouched and never read for matching.
- **AT-ISO-4** Rules-check: user B cannot read or write `users/A/stickers/*` or `users/A/email_permissions/*`.
- **AT-ISO-5** No Hub UID appears in any IDYNIFY ownership field.

### Subscription and suppression
- **AT-PERM-1** Hub `Subscribed` → ledger `unknown` with `observed_label: 'Subscribed'`, never `subscribed`.
- **AT-PERM-2** Hub `Unsubscribed` → `unsubscribed` for the primary and every additional address. A bulk cadence excludes them; a test send is warned or blocked per B6.
- **AT-PERM-3** `Unknown`, blank or any other value → `unknown`.
- **AT-PERM-4** A re-run never moves `unsubscribed` to anything else. Only a recorded contact action can.
- **AT-PERM-5** The migration never writes the platform-wide `emailSuppressionList` or `email_status`.
- **AT-PERM-6** An unsubscribe survives a later contact merge or archive (the ledger is keyed by address).

### Safe rollback and correct counts
- **AT-RB-1** The reconciliation equations in §7.3 hold exactly on staging.
- **AT-RB-2** Rollback removes created contacts that are unchanged; changed ones are reported, not deleted.
- **AT-RB-3** Rollback on matched contacts removes only what the migration added; later user edits stay.
- **AT-RB-4** Rollback is idempotent. After it, the untouched part of the workspace hashes equal to the pre-run backup.
- **AT-RB-5** Every write appears in the manifest (compared against an emulator write log).

---

## 15. Phased roadmap

| Phase | Scope | Writes | Exit |
|---|---|---|---|
| **0. Decide and harden the source** | Get B1–B3 and B7 access; owner decisions B5, B6, Q1–Q11; Hub hotfixes, owner's call, in `utadco-hub-functions` (stop Push to CC, remove hard-coded PII, escape output, rules blocking sticker takeover, deploy or close PR #1); stand up staging (B4) | Hub only, by the owner | Decisions recorded; snapshot access works |
| **1. Read-only discovery** | Snapshot export; snapshot inspector (schema inventory, sticker integrity, duplicates, consent distribution) | None | Integrity report reviewed |
| **2. Destination foundations** | ADR-007 + ADR-002 amendment; sticker registry; `sticker_ids`; `external_ids`; permission ledger; timeline type; rules + tests. No UI, no data. | Code only | CI green; rules-check cases |
| **3. Migration engine** | Pure transform; dry-run resolver; review-queue file; live / verify / rollback with manifest | Emulator, staging | Every AT in §14 passes on the emulator |
| **4. Product UI** | People sticker filter and view; Contact Profile stickers row, provenance, permission line; CSV "Apply stickers"; cadence enforcement; review queue (or script-applied decisions) | Code only | UX review |
| **5. Rehearse and cut over** | Full rehearsal on staging → reconcile → owner sign-off → Hub freeze → production dry run → review → live → verify → Hub read-only → sunset | Production, once | §17 GO criteria met |
| **6. Deferred** | Server-side CC sync; team workspaces (if decided); photos; new manual activity types | — | Separate decisions |

---

## 16. PR plan

Each PR stands on its own, includes tests, and stays under ~400 changed lines. All PRs are in `idynify-scout` unless marked.

| PR | Title | Depends on | Notes |
|---|---|---|---|
| H-1 | *(utadco-hub-functions, owner)* Hub hotfixes: disable Push to CC, remove `patchPeoplePitchPhones`, escape output, add rules | — | Outside this plan; urgent, separate from migration |
| 1 | ADR-007: Contact Hub integration (external identities, stickers, marketing permissions) + ADR-002 amendment (external IDs, additional emails) | Decisions B5, B6 | Docs only |
| 2 | `scripts/hub/inspectHubSnapshot.mjs`: offline, read-only inspector + fixture tests | Snapshot format | No Firestore access |
| 3 | `src/utils/hubMigration/transform.js`: pure Hub → candidate mapping (§6) + tests | 1 | No I/O |
| 4 | Sticker registry service: create-only auto-IDs, soft delete, rename + rules + rules-check cases | 1 | No UI |
| 5 | Contact sticker membership helper (`sticker_ids`, `sticker_provenance`) + `verifyWritePaths` check | 4 | |
| 6 | Email permission ledger: service, append-only history rules, tests | 1 | No enforcement yet |
| 7 | Cadence send path honours `unsubscribed` (bulk excluded, 1:1 warned) + tests | 6, B6 | Product gate |
| 8 | Timeline type `imported_activity` + renderer label + contract test | 1 | |
| 9 | `additional_emails[]` + resolver support (ADR-002 amendment) + tests | 1 | Touches identity; careful review |
| 10 | Migration dry run (Admin SDK, read-only): resolve, buckets, report, review file | 3, 9 | |
| 11 | Migration live / verify / rollback + manifest + emulator idempotency and rollback tests | 4–6, 8, 10 | |
| 12 | People: sticker filter chips and Stickers view | 4, 5 | Read-only UI |
| 13 | Contact Profile: stickers row, provenance labels, email-permission line | 5, 6 | |
| 14 | CSV import: "Apply stickers" step | 4, 5 | |
| 15 | Review-queue resolution (UI, or apply a reviewed decisions file) | 10 | |
| 16 | Staging rehearsal runbook + results template | 11 | Docs |

---

## 17. Final recommendation and GO / NO-GO criteria

**Recommendation:** Option C. Approve Phase 0 decisions and Phase 1 (read-only) now. Separately, and urgently, consider the Hub hotfixes for R1, R3 and R5: they are live exposures that exist with or without any migration.

**Current status: NO-GO.** The source data, rules and deployed version are unverified (B1–B3). Staging is not isolated (B4). The team-access and consent decisions are open (B5, B6).

**GO for the production migration requires all of these:**

1. A verified `utadco-hub` snapshot: every collection enumerated, counts and checksums recorded, and the rules reviewed.
2. The sticker integrity report reviewed, with every `suspect` sticker's membership signed off by the owner.
3. Recorded decisions on Q1, B5, B6, Q3, Q5 and Q11.
4. An isolated non-production Firebase project, with a full rehearsal there passing **every** acceptance test in §14 and exact reconciliation.
5. A production dry run against the target workspace, reviewed, with **zero** undecided review items.
6. Backups of the Hub snapshot and the IDYNIFY target workspace taken, with a restore tested.
7. Rollback rehearsed on staging.
8. Unsubscribe enforcement live in IDYNIFY cadences before any Hub contact can be emailed from IDYNIFY.
9. The Hub write-frozen (rules) for the duration of the run, and Push to CC disabled beforehand.

**NO-GO (stop or roll back) if any of these happen:**
- any reconciliation mismatch
- any change to a canonical field of an existing contact
- any write outside `users/<target>/`
- any `unknown` permission treated as `subscribed`
- any unresolved review item
- staging that shares the production project
