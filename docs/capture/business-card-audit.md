# Business-card historical audit

`scripts/auditBusinessCardRecords.mjs` reports what the legacy business-card scanner left in Firestore. It reads only. It writes nothing to Firestore, to files or anywhere else. It is PR 3 of Relationship Capture and implements section 26 of the architecture plan.

Running it against production is a separate, approved step. Any cleanup it calls for is a separate script with its own dry run and its own approval.

## Running it

```
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/read-only-key.json \
  node scripts/auditBusinessCardRecords.mjs [--user-id=<uid>] [--details] [--json]
```

| Flag | Effect |
|---|---|
| none | Summary only: totals, counts per flag, counts per workspace, months, usage, the cleanup decision, and documents read |
| `--details` | Also lists document IDs under each flag. Off by default to keep output short and limit identifier exposure |
| `--json` | The same report as JSON |
| `--user-id=<uid>` | Audits one workspace instead of all |

Any other argument is an error (exit 1), including anything that sounds like a write mode (`--apply`, `--live`, `--dry-run`).

**Credentials.** `FIREBASE_SERVICE_ACCOUNT_PATH` must point to a key for a service account that can only read Firestore (`roles/datastore.viewer`). The project comes from the key's `project_id`. Nothing is hard-coded, and no other credential (`GOOGLE_APPLICATION_CREDENTIALS`, application-default credentials) is tried.

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Completed. Cleanup is `NONE` **or `OPTIONAL`** |
| `2` | Completed. Cleanup is `REQUIRED` |
| `1` | Did not complete: a bad argument, a missing or unreadable key, or a Firestore error |

## What it reads

A workspace is a user: contacts live at `users/{uid}/contacts`, companies at `users/{uid}/companies`. Every query is an equality query on a single field, so no new index is needed.

| Records | Selected when | Lineage label |
|---|---|---|
| Contacts | `source == 'Scanned Business Card'` | `source` |
| | `capture_method == 'business_card_ocr'` | `capture_method` |
| | `enrichment_status == 'ocr_extracted'` | `enrichment_status` |
| | `identity_sources` contains `'Scanned Business Card'` (the scanner merged into an existing contact) | `identity_sources` |
| Companies | `source == 'Scanned Business Card'` (created by the scanner) | `source` |
| | `accepted_via == 'Scanned Business Card'` (a pending company the scanner promoted) | `accepted_via` |
| | Referenced by a selected contact's `company_id` | `referenced` |
| Usage | `apiLogs` rows with `operation == 'extractBusinessCard'`, or `endpoint` in `APOLLO_EXTRACTBUSINESSCARD` / `GOOGLE_EXTRACTBUSINESSCARD` (older rows) | n/a |

A record matched by several selectors is audited once.

It also reads the following, to answer specific questions:

- **Duplicates:** for each selected contact, up to five queries limited to two documents each: `email_normalized` and `email` equal to the normalized email, `email` equal to the raw email, `phone_normalized` equal to the normalized phone, and `phone` equal to the raw phone.
- **Linked:** for each selected company that no selected contact points to, one query for any contact with that `company_id`, limited to one document.
- **Duplicate domains and names:** every company in a workspace that has selected companies, reading only `name`, `domain`, `primary_domain`, `website_url` and `website`.
- **Usage:** with `--user-id`, usage rows are still read in full and narrowed in memory.

**Read volume.** The report prints the number of documents read, queries made, and queries that returned nothing (each of those is billed as one read). Approximately:

```
users listed (1 per user, all-workspace runs only)
+ 6 queries per workspace
+ up to 5 small queries per selected contact
+ 1 per referenced company not already selected
+ 1 per selected company with no selected contact pointing at it
+ all companies in workspaces that have selected companies
+ the extractBusinessCard usage rows (read twice when both selectors match them)
```

## Flags

Every flag is a fixed rule over the stored document. Normalization uses the identity-matching normalizers (`normalizeEmail`, `normalizePhone`, preferring the stored `*_normalized` fields) and the capture building blocks (`domainKey` from the ICANN Public Suffix List, the shared-host list, the free-mail and ISP lists, `nameKey`).

### Contacts

| Flag | Raised when |
|---|---|
| `MISSING_COMPANY` | `company_id` is empty, and the contact has an email whose domain is not a free-mail or ISP provider |
| `NO_ADDED_FROM` | `addedFrom` is empty, so People shows the contact as "Manual". The scanner never wrote this field, so this is systemic. **Reported as a total only**; IDs are never listed, even with `--details` |
| `IDENTITY_REVIEW_UNSURFACED` | `identity_review_required` is `true`. No UI ever shows this flag |
| `NAME_LOOKS_LIKE_TITLE` | The name reads as a job title (every word a title word and at least one a role word, e.g. "VP of Sales"), or equals the contact's own `title` |
| `NAME_LOOKS_LIKE_COMPANY` | The name's `nameKey` equals the contact's `company` or `company_name`; or it ends in Inc, Incorporated, LLC, LLP, Ltd, Limited, Corp, Corporation, PLC or GmbH; or it is only generic company words ("Consulting Group") |
| `NAME_POSSIBLY_STRIPPED` | **Heuristic.** A word looks like an apostrophe was dropped (`O`, `D` or `L` followed by a capital and lower-case letters: "OBrien", "DAngelo"), or the name contains a replacement character (U+FFFD). Never used by a `REQUIRED` rule |
| `NO_EMAIL_OR_PHONE` | No usable email and no usable phone |
| `DUPLICATE_EMAIL` | Another contact in the workspace has the same normalized email |
| `DUPLICATE_PHONE` | Another contact in the workspace has the same normalized phone |

### Companies

Identity fields are `domain` and `primary_domain`. Observed URLs are `website_url` and `website`. A company is **linked** when at least one contact's `company_id` points to it.

| Flag | Raised when |
|---|---|
| `PERSONAL_PROVIDER` | Any identity field or observed URL has a registrable domain that is a free-mail or ISP provider; or the `nameKey` is a free-mail brand (Gmail, Yahoo, Outlook…) and the company has no usable domain. ISP names are not matched by name, because Verizon, Orange or Sky are also real companies |
| `MALFORMED_DOMAIN` | An identity field contains `@` or whitespace, or has no registrable domain under the Public Suffix List |
| `FIRST_LAST_DOMAIN` | An identity field or observed URL is shaped like a person: (1) it equals the local part of a linked contact's email (the old parser's defect); (2) it is two or three letter-only labels with no public suffix ("sarah.chen"), unless it is an OCR misreading of a suffix ("acme.corn", which is `MALFORMED_DOMAIN`); or (3) two of its labels before the public suffix are words of a linked contact's name |
| `SHARED_HOST_DOMAIN` | An identity field is a shared host (site builder, social network, link-in-bio). A shared-host observed URL alone is not flagged: it is a valid website, just never a company key |
| `DUPLICATE_DOMAIN` | Another company in the workspace shares a registrable domain from any of the four fields. Provider and shared-host domains are excluded |
| `DUPLICATE_NAME` | Another company in the workspace has the same `nameKey` |
| `NO_LEGITIMATE_DOMAIN` | No field yields a usable domain: one that is registrable, not a provider, not a shared host and not person-shaped |
| `LOCKED_GUESSED_NAME` | `name_source` is `'user'` and the name exactly equals `companyNameFromDomain(domain)`, so enrichment will not correct it. This can include a name the user genuinely typed that happens to equal the guess |
| `ORPHAN` | `contact_count` is 0 or missing, and no contact points to the company |

The report also counts scanner-created companies by month (from `saved_at`) and companies promoted via `accepted_via` by month.

### Usage

The usage section reports the number of calls, successes and errors, calls by month, the number of distinct workspaces, the log format (`APOLLO_` rows predate 2026-10-14, `GOOGLE_` rows are current), and error codes. A stored `errorCode` that is not one of the endpoint's own codes is counted as `OTHER` and never printed. Before 2026-10-14 that field could hold raw Google Vision response text. Error rows before 2026-10-14 also recorded an unverified user ID.

## Cleanup decision

The decision is computed by `decideCleanup()`, not judged. It is evaluated over every audited workspace together. Every `REQUIRED` rule that matches is reported with its count.

| Rule | Level | Matches when |
|---|---|---|
| R1 | `REQUIRED` | A company flagged `PERSONAL_PROVIDER` is linked to a contact |
| R2 | `REQUIRED` | A company flagged `FIRST_LAST_DOMAIN` is linked to a contact |
| R3 | `REQUIRED` | More than 5 duplicate-domain pairs involve an audited company. A pair is two companies in the same workspace sharing a registrable domain, at least one of them audited; each pair counts once |
| R4 | `REQUIRED` | An audited contact is flagged `NAME_LOOKS_LIKE_TITLE` or `NAME_LOOKS_LIKE_COMPANY` |
| O1 | `OPTIONAL` | No `REQUIRED` rule matched, and at least one flag was raised |
| N1 | `NONE` | No flag was raised, including when nothing was selected |

The heuristic flag `NAME_POSSIBLY_STRIPPED` can only produce `OPTIONAL`.

## Privacy

The report contains workspace IDs, document IDs (only with `--details`), flag codes, counts and months. It never prints a name, email, phone, domain, company name, OCR text or stored error text. A bad "domain" such as `sarah.chen` is itself personal data, so domains are never printed either. A test runs every output mode over fixtures full of distinctive personal values and fails if any of them, or an `@`, appears. An execution error prints the error's code and message, never the key file.

## Read-only guarantees

- **One read section.** Every database call sits in one marked section of the script, which uses only `collection`, `doc`, `where`, `select`, `limit`, `get`, `getAll` and `listDocuments`. Everything else is pure functions over plain objects.
- **Source scan.** A test, with comments stripped, fails the build if the script:
  - calls a write method (`update`, `delete`, `create`, `batch`, `commit`, `runTransaction`, `bulkWriter`, `recursiveDelete`, `FieldValue`, or the web SDK's `setDoc`/`addDoc`/`updateDoc`/`deleteDoc`/`writeBatch`);
  - calls `set(` or `add(` inside the read section;
  - touches the database outside it;
  - names a write flag.

  The scan targets calls, not words: comments and in-memory `Map.set` are not flagged, and a self-test proves the patterns catch real writes.
- **Runtime fake.** Tests run the whole audit against an in-memory Firestore whose every write method throws and is recorded. They assert zero writes, and that the script's read counter matches the reads the fake served.
- **No hard-coded project.** CI's `check:env` scans `scripts/`. The project comes only from the key.
- **Read-only key.** Use a service account limited to `roles/datastore.viewer`, so the credential cannot write even if the code tried.

## Known limits

- **Duplicates use equality queries.** These match how identity matching's fast paths work. A duplicate is missed when the other contact has no `*_normalized` field and stores the value in a different format; matching's 200-document fallback scan is not reproduced.
- **Person-shaped domains are judged against contacts the audit holds.** These are the selected contacts pointing at the company, plus the one found by the linked query.
- **Older history is not inspectable.** The scanner's code before 2026-08-25 could not be inspected. Missing or unexpected fields are tolerated rather than assumed.
- **Older scanner companies differ.** Those created before 2026-09-17 stored `domain` without lower-casing it and have no `name_source`. Domains are normalized before comparison.
