# Audit — CSV Contacts → Cadence

Status: audit only. Nothing has been implemented. Date: 2026-10-02. Base commit: `d450c46`.

Legend: ✅ exists and works · 🟡 exists but incomplete or not connected · 🔴 does not exist

---

## TL;DR

- **CSV import is already built.** `src/components/scout/CSVUpload.jsx` parses, maps headers, validates, dedupes through the canonical identity guard, and writes to `users/{uid}/contacts`.
  - Scout+ already renders it (`ScoutPlus.jsx:215-217`). The only thing "Coming Soon" about it is that the menu card is a plain `<div>` with no `onClick` (`ScoutPlus.jsx:177-191`).
  - The orphaned `components/scout/AddContactModal.jsx:118` has the same card live, but nothing imports that modal.
- **The CSV path writes a different, thinner record than Add Manually.** The differences matter:
  - no `company_id` or `company_name`, so People shows **no company** for these contacts
  - `source: 'manual'`, and no `addedFrom`, so the existing "CSV Import" source filter never matches
  - industry, state, first name and last name are mapped and then **dropped**
  - capped at 25 rows; anything beyond is silently truncated
  - a naive `split(',')` parser breaks on `"Acme, Inc."`, even though `papaparse` is already a dependency
- **A "cadence" today is a one-shot bulk email send, recorded after the fact.** It has no steps, no schedule and no enrollment entity. Enrolling a person means sending them the email through `BulkComposeModal` → `BulkSendExecutor`, which writes `users/{uid}/cadences/{id}` with a denormalized `contacts[]` array.
  - **"Put these people into an existing cadence" does not exist.** The closest thing is CadenceDetail's "+ Add more contacts". It pre-fills that cadence's subject and body, then creates a **new** cadence document.
  - Bulk send is **capped at 25** (client and server).
- **The pieces connect with small changes.** A CSV import already yields contact ids in the shape `BulkComposeModal` accepts. Nothing hands them over today: the Scout+ success screen offers only "View in Leads" and "Add More".

**Shortest path:** turn the card on, fix CSVUpload's write shape, stamp an import group, and add an "Add to Cadence" button on the success screen. That button opens the existing `BulkComposeModal` with the imported contacts, pre-filled from a chosen prior cadence. There are no new collections, no API and no migration. Roughly 5–7 files.

---

## A. Current architecture

### Contact creation — "Add Manually" (the reference path)

`ScoutPlus.jsx` → `ManualContactForm.handleSubmit` (`src/components/scout/ManualContactForm.jsx:49`):

1. Validates the form. Name is required. Email must match a regex if present. A LinkedIn URL must contain `linkedin.com`. (`:28-46`)
2. Resolves or creates the company with `ensureCompanyForContact(uid, {name, email, domain})`, which returns `company_id`. (`:71`, `companyIdentityService.js:375`)
3. Runs identity resolution with `prepareContactWrite(uid, candidate, {source:'ManualContactForm'})`. (`:86`, `contactWriteGuard.js:64`)
   - On `merge`, it calls `applyContactMerge` and stops. Nothing new is created; the existing record gets the new identifiers.
   - On `create`, it uses `resolution.fields`, which carries `email_normalized`, `linkedin_url_normalized`, `phone_normalized`, `record_status`, `relationship_status`, `stage`, `is_archived:false` and review flags.
4. Calls `addDoc(users/{uid}/contacts, {...resolution.fields, name, email, phone, company, company_id, company_name, title, linkedin_url, person_type:'lead', source, addedFrom, lead_status:'saved', contact_status:NEW, is_archived:false, ...})`. (`:108-145`)

There is no server function in this path. All contact creation happens client-side under the Firestore rule `users/{uid}/{coll}/{docId}`: owner-only, with no field validation (`firestore.rules:44-57`).

### Contact creation — CSV (`CSVUpload.handleUpload`, `src/components/scout/CSVUpload.jsx:219`)

1. `parseCSV` (`:18`) does a naive split on newlines and commas, lowercasing the headers.
2. `normalizeLeadFieldName` (`:36`) maps header aliases to fields:
   - name, first/last, email, phone, company, title
   - LinkedIn
   - industry (from "vertical"), state
3. `validateLeads` (`:111`) requires a name, or a first name. An invalid email adds an error but **the row is still imported**: there is no `return` at `:143-145`.
4. `rows.slice(0, 25)` (`:199`).
5. A pre-pass for exact duplicate emails, `where('email','in', chunk)` (`:241-274`).
6. `prepareContactWrite(...)` per row (`:327`). It uses the **same guard as Manual**; merges are applied immediately.
7. `writeBatch` with the new contacts (`:342-374`).

### People

- **Canonical model:** `users/{uid}/contacts/{id}`. The schema factory is `createPersonRecord` (`src/schemas/peopleSchema.js:328`). Hand-rolled writers in Scout do not use it.
- **Main People list:** `AllLeads.jsx`, embedded in PeopleMain and ScoutMain. It loads **every** contact (`:1370`) and filters client-side by archive and engagement state (`:1391-1414`). A CSV contact appears here.
- **Lens queries** in `peopleService.js` filter on `is_archived == false`. The "Leads" lens also requires `person_type == 'lead'`, which CSV does not write. These lenses are only used by onboarding (`RelationshipFirstValue.jsx`).

### Cadences (full trace in section 4)

`AllLeads` multi-select ("Start Cadence", `:2133`) or `CadencesList` "+ New Cadence"
→ `BulkComposeModal` (compose → Barry personalization → preview)
→ `BulkSendExecutor`, which writes the `users/{uid}/cadences/{id}` doc and runs a browser-side send loop
→ `executeSendAction` → `gmail-send-quick`.

---

## 1. Existing CSV functionality

| Capability | Status | Evidence |
|---|---|---|
| CSV parsing | 🟡 | `CSVUpload.jsx:18`, a naive `split(',')` that breaks on quoted commas and embedded newlines. `papaparse@5.5.3` is installed but only used for export (`LeadDetail.jsx:9`). A separate LinkedIn-specific parser is at `LinkedInImportModal.jsx:58`. |
| Scout+ card disabled vs unbuilt | ✅ built, 🔴 not clickable | `ScoutPlus.jsx:177-191` is a `<div>` with no handler; `:215` renders `<CSVUpload>` when `currentView==='csv'`. |
| Import endpoint or service | 🟡 | Contacts are written client-side only. `netlify/functions/import-linkedin-connections.js` is server-side but writes to a **different collection** (`users/{uid}/linkedin_connections`). It is not People, so it is not reusable for this. |
| Field mapping | ✅ alias-based | `normalizeLeadFieldName` `:36-77`. There is no interactive column-mapping UI; unrecognized headers pass through unmapped and are then ignored. |
| Validation | 🟡 | Name is required. The email regex reports an error but still imports the row. Phone, title and company have no validation. LinkedIn has no validation (Manual checks it). |
| Deduplication | ✅ / 🟡 | Uses the canonical guard (`prepareContactWrite`), plus an email pre-pass. Weaknesses are listed in section 7. |
| Creates Person records | ✅ | `batch.set(doc(users/{uid}/contacts), contactData)` at `:368-369`. |
| Source recorded | 🟡 | Writes `import_method:'csv'`, but `source:'manual'` (`:352`) overrides the `csv_import` candidate source, and there is no `addedFrom`. `identity_source:'CSVUpload.contacts'` is written. |
| Row limit | 🟡 | 25 (`:199`). The preview shows "N found (max 25)" using the **truncated** count, so the user is never told rows were dropped. |
| Company CSV | ✅ | `uploadType==='companies'` → `resolveCompany` + `createCompanyRecord` (`:276-314`). Out of scope here. |
| Tests | 🔴 | No tests for CSVUpload. |

## 2. "Add Manually" vs CSV

Both call the **same canonical identity guard** (`prepareContactWrite` / `applyContactMerge`). Neither calls a shared "create contact" function: each builds its own document. The CSV document differs:

| Field | Manual | CSV | Effect |
|---|---|---|---|
| `company_id` | ✅ via `ensureCompanyForContact` | 🔴 | Not counted under Saved Companies; the code comment at `ManualContactForm.jsx:65-70` describes exactly this bug. |
| `company_name` | ✅ | 🔴 (only `company`) | **People shows no company.** It renders `company?.name \|\| contact.company_name` (`AllLeads.jsx:694, 1052`), and company search misses these contacts (`:1685`). |
| `person_type` | `'lead'` | 🔴 | Excluded from the `leads` lens in peopleService. |
| `addedFrom` | `'manual'` / `'referral'` | 🔴 | The source filter defaults to `'manual'`. The filter already has a `csv: 'CSV Import'` label (`AllLeads.jsx:2089`) that never matches. |
| `source` | `'manual'` | `'manual'` | Indistinguishable from manual. |
| `first_name`, `last_name`, `industry`, `state`/`location` | n/a | mapped then **dropped** | The data is silently lost. |
| `is_archived`, status triple, `*_normalized` | ✅ | ✅ | Both come from `resolution.fields`. |

**Conclusion:** there is no technical reason for the divergence. CSV should build its record the way Manual does. The cleanest form is to extract Manual's record-building into one shared helper and have both call it, which satisfies "CSV and manual contacts behave the same."

## 3. People

| Question | Answer | Evidence |
|---|---|---|
| Canonical model | `users/{uid}/contacts/{id}`; factory `createPersonRecord` | `peopleSchema.js:328`, `peopleService.js:15` |
| Supported fields | first/last/name, email, phone, linkedin_url, company, title, industry, location, website, photo_url, tags[], sticky_notes[], addedFrom, person_type, brigade, and more | `peopleSchema.js:334-404` |
| Person without a company | ✅ allowed | Manual allows a blank company; the rules do no field validation. |
| Imported people appear in People | ✅ yes, but company-less (see above) | `AllLeads.jsx:1370-1414` |
| Source, status and tags storage | flat fields: `addedFrom`, `source`, `contact_status`, `record_status`/`relationship_status`/`stage`, `tags[]`, ICP stamped at send time | `statusModel.js:467`, `IdentityCard.jsx:679-706` (tag editing) |
| Identify "the 137 I just uploaded" | 🟡 | No batch id. **Two existing filters would solve it with zero UI work if CSV wrote the field:** the source filter on `addedFrom` (`AllLeads.jsx:1653`) and the tag filter on `tags` (`:1663`). |

## 4. Cadences

| Question | Answer | Evidence |
|---|---|---|
| How a cadence is created | A side effect of sending. Compose in `BulkComposeModal`; the doc is written by `BulkSendExecutor` when sending starts. | `BulkSendExecutor.jsx:194` (`addDoc users/{uid}/cadences`), completed at `:270-299` |
| What is enrolled | A denormalized entry in `cadences/{id}.contacts[]`: `{contactId, name, email, status, gmailMessageId, gmailThreadId, icpId?...}`. There is no enrollment collection. | `BulkSendExecutor.jsx:135-152` |
| Enroll an existing Person directly | ✅ via People multi-select → "Start Cadence", or the modal's contact search | `AllLeads.jsx:2133, 2435, 2574`; `BulkComposeModal.jsx:178-205` |
| Enroll into an **existing** cadence | 🔴 / 🟡 | CadenceDetail "+ Add more contacts" (`CadenceDetail.jsx:400, 925-933`) pre-fills that cadence's subject and body, but sending creates a **new** cadence doc. |
| Requires an ICP | No. It is stamped if one is resolvable. | `BulkSendExecutor.jsx:170-185` |
| Requires a company | No | — |
| Requires an email | Yes. The modal excludes contacts without one. | `BulkComposeModal.jsx:171-172, 387, 404` |
| Bulk | ✅ that is the only mode, **max 25** | `BulkComposeModal.jsx:11`, `AllLeads.jsx:39`, `barryBulkPersonalize.js:39, 338` |
| Select-all in People | 🔴 | Contacts must be clicked one at a time in bulk mode. |
| When a cadence "starts" | A sequential loop **in the browser tab**, 1.5 s apart. Closing the tab stops it. There are no steps and no scheduling. | `BulkSendExecutor.jsx:31, 115-125`; `CadencesList.jsx:699` says "Scheduled sending coming soon" |
| Human approval | ✅ a batch preview with editable Barry opening lines, then one Send | `BulkComposeModal.jsx:370-382` |
| Gmail | ✅ through `gmail-send-quick`; falls back to `mailto:` when Gmail is not connected | `sendActionResolver.js:146-160` |
| History | cadence doc counts and `contacts[]`; contact `activity_log`, `last_contacted`, `gmail_thread_id`; `contacts/{id}/timeline` events; `email_logs` | `sendActionResolver.js:408-424, 597`; `gmail-send-quick.js:411-445`; `track-open.js:96-127`; `check-replies.js:175-203` |
| Reply detection | 🟡 only runs when CadenceDetail is opened, with no cron | `CadenceDetail.jsx:125-157` |
| Multi-step sequences | Exist only in the separate **Missions** system (`users/{uid}/missions`, `sequenceEngine.js`), which does not touch cadences | `src/pages/Hunter/CreateMission.jsx`, `src/utils/sequenceEngine.js` |

**Code path, Person → send:**
1. `AllLeads.jsx:2133`: user selects contacts.
2. `BulkComposeModal` `handlePreview` (`:370`) → `barryBulkPersonalize` (one opening line per contact) → `handleSend` (`:382`).
3. `BulkSendExecutor` (`:194`) writes the cadence doc → `sendOne` (`:77`).
4. `executeSendAction` (`sendActionResolver.js:481`) → `sendEmailViaGmail` (`:146`) → `netlify/functions/gmail-send-quick.js` → Gmail API.
5. Contact, timeline and `email_logs` writes; `BulkSendExecutor` marks the cadence `completed`.

**Tests covering this path:**
- `src/test/BulkSendExecutor.test.jsx`
- `src/test/barryBulkPersonalize.test.js`
- `src/test/gmailSendQuick.test.js` (helpers only)
- `src/test/trackOpen.test.js`
- `src/test/icpPersonLineage.test.js`
- `src/test/gate1SendGuard.test.js`

There are none for BulkComposeModal, CadencesList, CadenceDetail or `check-replies`.

**Cadence bugs found that affect this workflow:**
- 🐛 **In-progress cadences are hidden.** `CadencesList.jsx:87-90` orders by `completedAt`, so a cadence whose send never finished (tab closed) never appears in the list. A 47-person send takes about 70 seconds or more in-tab, so this is a real risk.
- 🐛 **Contacts with only a `work_email` fail at send.** The modal admits them, but the resolver reads only `contact.email` (`sendActionResolver.js:104, 160`). CSV writes `email`, so CSV contacts are not affected.
- ⚠ **Old threads are reused.** `existingThreadId: contact.gmail_thread_id`: a contact you have emailed before gets the cadence email threaded into the old conversation.
- ⚠ **No duplicate-enrollment guard.** The same person can be sent the same cadence twice.
- ⚠ **The send guard is not enforced.** `assertSendable` exists (`sendActionResolver.js:466`) but nothing calls it.

## 5. The 50-person question

> If I gave IDYNIFY a CSV of 50 people today, what is the minimum code to import them and enroll all 50 into an existing cadence?

Today, with **zero code** (after flipping the card on), it would go like this:
- Only the first 25 rows import, silently.
- Quoted commas corrupt rows.
- Companies don't show in People.
- To enroll, you would find the 25 contacts in People by hand. There is no source or tag filter that matches them, and no select-all, so it means clicking 25 times.
- Then you compose and send. "Existing cadence" can only mean re-using a prior cadence's subject and body.
- After that, you repeat everything for rows 26–50.

**Minimum code:** see section E. All the pieces exist; what's missing is the connection between them.

## 6. CSV fields vs the Person model

| CSV field | Mapped | Stored by CSVUpload | Model supports | Note |
|---|---|---|---|---|
| First name | ✅ | 🔴 (only merged into `name`) | ✅ `first_name` | — |
| Last name | ✅ | 🔴 | ✅ `last_name` | — |
| Email | ✅ | ✅ `email` + `email_normalized` | ✅ | optional |
| Phone | ✅ | ✅ `phone` + `phone_normalized` | ✅ | — |
| Title | ✅ | ✅ | ✅ | — |
| Company | ✅ | 🟡 `company` only | ✅ `company_id`, `company_name` | needs `ensureCompanyForContact` |
| Industry / vertical | ✅ | 🔴 | ✅ `industry` | — |
| State / location | ✅ (`state`) | 🔴 | ✅ `location` | — |
| LinkedIn URL | ✅ | ✅ + normalized | ✅ | — |
| Notes | 🔴 | 🔴 | 🟡 `sticky_notes[]` (structured) | Manual has no notes field either |

**Actual constraints:**
- **Name is required. Email is optional.**
- Firestore rules enforce nothing beyond ownership.
- For this use case (email + usable identity), the rule should probably be: name **or** email required, with email required for cadence eligibility. The cadence step already enforces that independently.

## 7. Duplicates — current identity behaviour

The engine is `src/utils/identityResolution.js:378` (`resolveContactCore`), used by both browser and server. Its locked hierarchy is:

1. Firestore contact id
2. Normalized email
3. Apollo person id
4. Normalized LinkedIn URL
5. Normalized phone
6. Name + company: **flagged for review, never merged.** The contact is created with `identity_review_required: true`.

On a match, `mergeIdentifiers` (`:522`) only **adds** missing identifiers. It never overwrites name, title or other canonical fields, and it appends to `identity_sources`. If two existing records share one identifier, it throws `IdentityConflictError`. Covered by `src/test/contactIdentityService.test.js` (30 tests).

So "Aaron Wiley" via Scout, LinkedIn, manual entry and CSV collapses to one record **when any of email, LinkedIn URL, phone or Apollo id overlaps**.

**Weaknesses, as applied to CSV:**
1. **No duplicate check within one file.** Each row resolves against Firestore, but new rows sit in an uncommitted batch until the end (`CSVUpload.jsx:374`). The same person twice in one CSV creates two contacts.
2. **Name-only rows can't be matched.** Two "Aaron Wiley, Acme" rows without email or LinkedIn are only flagged (`identity_review_required`), and the CSV preview never shows that flag.
3. **One conflict fails the whole upload, after merges have already been written.** An `IdentityConflictError` on any row throws out of the loop into the generic "Failed to upload" alert (`:386-389`). Merges applied to earlier rows have already been written; the new rows in the batch have not.
4. **Matched rows disappear from the result.** They are counted as "skipped — already in your pipeline" and **not returned** to the caller (`:336-340`), so a follow-on "add to cadence" step would leave out exactly the people who already existed.
5. **Read cost.** `prepareContactWrite` builds a fresh adapter per row (`contactWriteGuard.js:70` → `contactIdentityService.js:197`). Every genuinely new row therefore reloads the 200-doc fallback scan window: about 10k reads for 50 rows. The adapter supports sharing the scan window (`resolveContact(..., {adapter})`), but `prepareContactWrite` does not pass one through.
6. **Old records beyond the scan window.** Records written before normalization that sit outside the 200-doc window are matched only case-sensitively on `email`.
7. **The pre-pass is redundant.** The email pre-pass (`:241-274`) is case-sensitive on raw `email` and duplicates step 2 of the guard.

## 8. Smallest UX

This fits the current architecture with no new concepts:

```
Scout+ → Upload CSV
  ↓ (existing type picker: Lead / Contact List)
Preview
  47 ready · 2 already in IDYNIFY (will be updated, not duplicated) · 1 missing name/email
  ↓
Import 47 contacts
  ↓
47 contacts imported  (+2 existing updated)
[ View People ]  [ Add to Cadence ]
  ↓ Add to Cadence
Choose cadence
  [ Beyond Words Invitation ]   ← prior cadences: pre-fills subject/body
  [ People Pitch Invite ]
  [ + Create cadence ]          ← blank compose
  ↓
Existing BulkComposeModal (Barry personalization + preview) → Send
```

Interpretation matters here. Because cadences have no enrollment model, **"choose an existing cadence" = re-use its subject and body for a new send.** That is exactly what CadenceDetail's "+ Add more contacts" already does (`CadenceDetail.jsx:925-933`). If "existing cadence" must mean one record that accumulates members and runs steps over time, that is the real gap (Option B below), and it is a redesign of cadences.

"View People" should land on People filtered to this import. The existing tag filter can do that.

---

## B. Existing reusable pieces

- `CSVUpload.jsx`: parse, map, validate, dedupe, write. Already mounted in Scout+.
- `contactWriteGuard.prepareContactWrite` / `applyContactMerge`, plus `identityResolution.js`: the canonical dedupe.
- `companyIdentityService.ensureCompanyForContact`: company resolution, as used by Manual.
- `papaparse`: already installed.
- The AllLeads `tags` filter and `addedFrom` source filter. The "CSV Import" label already exists.
- `BulkComposeModal({contacts, initialSubject, initialBody, initialPath, initialCc, initialPersonalize})`: accepts preselected contacts and prefill.
- `BulkSendExecutor` + `executeSendAction` + `gmail-send-quick`: send, tracking and history.
- `CadenceDetail`'s prefill-from-prior-cadence pattern.
- Scout+ success screen (`ScoutPlus.jsx:220-286`): already receives the created contacts with their ids.

## C. Missing connections

1. Scout+ menu card → `csv` view: no `onClick`.
2. CSV contact record → canonical record shape: no `company_id` or `company_name`, wrong `source`, no `addedFrom` or `person_type`, dropped fields.
3. Imported contacts → an identifiable group: nothing stamped.
4. Scout+ success screen → `BulkComposeModal`: no "Add to Cadence" action.
5. Prior cadence → new send for new people: the prefill exists only inside CadenceDetail.
6. Merged (already-existing) CSV rows → the follow-on enrollment set: their ids are discarded.
7. `prepareContactWrite` → shared resolver adapter: not passed through.

## D. Truly missing functionality

- An RFC-compliant CSV parse (swap in `papaparse`; it's already a dependency).
- A duplicate check within one file.
- Import above 25 rows, with Firestore batches chunked at 500.
- Bulk send above 25 (the client caps plus `barryBulkPersonalize`'s server cap), **or** splitting the send into batches of 25.
- A small cadence picker (list `users/{uid}/cadences`, pick one for prefill).
- Tests for CSVUpload.

Not needed for this use case: an import API, an import-batch collection, an enrollment collection, scheduling, or a new dedupe model.

## E. Shortest implementation path

### Option A — recommended (fewest moving parts): wire existing pieces

1. **Enable the card.** `ScoutPlus.jsx`: change the CSV `<div>` to a `<button onClick={() => setCurrentView('csv')}>` and move it above the "Coming soon" divider.
2. **`CSVUpload.jsx` write shape and correctness:**
   - Parse with `Papa.parse(text, {header:true, skipEmptyLines:true, transformHeader})`.
   - Raise the cap to 200 or so, with an explicit message if rows are dropped. Chunk the batch at 450 operations.
   - Treat an invalid email as an error that skips the row. Require name **or** email.
   - Check for duplicates within the file by normalized email, LinkedIn URL and phone (`extractIdentifiers`).
   - Call `ensureCompanyForContact` per row and write `company_id` and `company_name`.
   - Write `first_name`, `last_name`, `industry` and `location`, plus `person_type:'lead'`, `source:'csv_import'` and `addedFrom:'csv'`.
   - **Group stamp:** `import_batch_id` (a uuid) and `tags: ['Import YYYY-MM-DD <file>']`. The existing tag filter then answers "these 137".
   - Return **both** the created contacts and the merged (existing) ones, so enrollment includes people who were already there.
   - Move the counts (ready / already exist / invalid) into the preview instead of post-hoc `alert()`s. The name+company review count can be added cheaply.
   - Better still: extract Manual's record-building into one `buildContactRecord()` helper used by both, so the two paths cannot drift again.
3. **`contactWriteGuard.js`:** let `prepareContactWrite` accept and forward `{adapter}`. CSV builds one `createWebAdapter(uid)` per upload. This is a single optional parameter and cuts reads from about 10k to about 250.
4. **`ScoutPlus.jsx` success screen:** add an "Add to Cadence" button. It opens a small picker (cadences from `users/{uid}/cadences`, newest first, plus "+ Create cadence"), then renders `<BulkComposeModal contacts={imported.filter(hasEmail)} initialSubject initialBody ...>`. The same prop pattern is used at `CadenceDetail.jsx:925`. "View People" navigates to People with the import tag pre-selected.
5. **Over 25 recipients — pick one:**
   - (a) Raise `MAX_CONTACTS` to 50 in `BulkComposeModal.jsx` and chunk the `barryBulkPersonalize` calls client-side, leaving the server cap at 25. (Recommended.)
   - (b) Keep 25 and make the success screen offer "Send in 2 batches".
6. **`CadencesList.jsx:87-90`:** order by `createdAt` instead of `completedAt`, so a cadence interrupted mid-send stays visible. This is a one-line fix that matters more once sends reach 50.

### Option B — real enrollment model (not recommended now)

Add `cadences/{id}/enrollments/{contactId}`, steps, and a scheduled sender (the pattern already in `process-scheduled-engagements.js`), or re-point cadences at the Missions `sequenceEngine`. This gives a true "add people to an existing cadence," multi-step follow-ups and a duplicate-enrollment guard. It is a cadence redesign: new schema, a cron, server-side sending, and a migration of existing cadence docs. Do it only if "existing cadence" must mean a persistent, multi-step membership.

### Option C — server-side import function

A Netlify function using `netlify/functions/utils/contactResolver.js` (the server adapter of the same engine). It is more robust for thousands of rows, but adds an endpoint, auth handling and a deploy surface. It is unnecessary for 50–200 rows.

**Option A has the fewest moving parts.** It changes no schema (only new optional fields), adds no collections and no endpoints, and reuses the canonical dedupe, company resolution, compose/personalize and send paths unchanged.

## F. Complexity (Option A)

| Dimension | Estimate |
|---|---|
| Files affected | 5–7: `ScoutPlus.jsx`, `CSVUpload.jsx`, `contactWriteGuard.js`, `BulkComposeModal.jsx`, `CadencesList.jsx`, optionally a new `CadencePicker.jsx` and a shared `buildContactRecord` helper (extracted from `ManualContactForm.jsx`) |
| Backend changes | None required. Optional: none, if personalization is chunked client-side. |
| Frontend changes | As listed above. CSVUpload carries most of the work. |
| Schema changes | New **optional** contact fields: `import_batch_id`, `addedFrom:'csv'` (already in `ADDED_FROM_SOURCES`), and use of the existing `tags`, `first_name`, `last_name`, `industry`, `location`. No new collections. |
| Migration | None required. Optional: backfill `company_name`/`company_id`/`addedFrom` on contacts already created by CSV (identifiable by `import_method:'csv'`). |
| Tests | New `CSVUpload.test.jsx` covering parse (quoted commas, CRLF, BOM), header mapping, the in-file dedupe, the merged-rows-returned behaviour, the write shape matching Manual, and the cap message. Update `barryBulkPersonalize.test.js` and `BulkComposeModal` tests if the 25 cap changes. Add a test for the `contactWriteGuard` adapter passthrough. |
| Major risks | Covered in the list below. |

**Major risks:**
- **Send runs in the browser tab.** About 50 × 1.5 s plus personalization, and it aborts if the tab closes.
- **Gmail volume limits and deliverability** at 50 or more per batch.
- **Old threads are reused** (`existingThreadId`) for contacts who already exist.
- **No duplicate-enrollment guard.** Re-running the same import and send double-emails people.
- **Weak matches.** Name+company rows create flagged near-duplicates.
- **`IdentityConflictError` aborts mid-upload.** It should be caught per row and reported as "needs review".
