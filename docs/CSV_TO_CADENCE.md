# CSV → People → Cadence

How a user uploads a CSV of people and sends them a cadence. This builds on the audit in `docs/AUDIT_CSV_TO_CADENCE.md`. It adds no new collections, API, scheduler or dedupe engine.

## The workflow

1. **Scout+ → Upload CSV → Lead / Contact List → choose a file.**
2. **Preview.** No writes happen yet. Every row is classified, and every row that won't import is listed by spreadsheet row number with the reason.
   - **Ready to import:** new contacts, plus people already in IDYNIFY. Existing people are updated, never duplicated.
   - **Email conflict:** an existing person matched by phone, LinkedIn or Apollo ID whose stored email differs from the CSV email. They join the group with the stored email unchanged, both addresses are shown, and they are **not** passed to Add to Cadence.
   - **Possible duplicates:** repeats within the file (skipped), the same existing person reached by two rows (skipped), and name + company matches (imported, flagged `identity_review_required`).
   - **Invalid rows:** bad email; a row with more cells than the header (usually an unquoted comma); an identity conflict (two existing contacts share an email, LinkedIn URL or phone); a failed duplicate lookup. None of these import.
   - **Missing required information:** no name and no email.
   - Columns that match no contact field are listed as "not imported".
3. **Name this import → Import N contacts.** Every contact in the group, new or existing, gets the tag `CSV Import - <name> - <YYYY-MM-DD>`.
4. **Success screen.** It shows "N contacts imported successfully" with **[View People]** and **[Add to Cadence]**.
   - **View People** opens `/command-center?tab=people&tag=<tag>`, with the People tag filter already set to this import.
5. **Add to Cadence → choose cadence.** The picker lists each existing cadence name once, using its most recent send, plus **Create new cadence**. The imported people who have an email are passed straight into the existing compose flow. Nobody has to be re-selected.
6. **Compose → Preview.** Barry personalizes as before, in batches of 25. People who already received this cadence are excluded (see below).
7. **Send Test to Me**, then **Send to N contacts**.
8. The send appears in Cadences. It stays visible even if the tab closes mid-send.

## Where things live

| Piece | File |
|---|---|
| Parse, map headers, validate, in-file duplicates, group tag | `src/utils/csvContactImport.js` |
| Workspace duplicate check (preview), writes (commit) | `src/services/csvImportService.js` |
| Contact document shared with Add Manually | `src/schemas/userAddedContact.js` |
| Upload UI | `src/components/scout/CSVUpload.jsx` |
| Success screen, View People / Add to Cadence | `src/pages/Scout/ScoutPlus.jsx` |
| Cadence picker | `src/components/cadences/CadencePickerModal.jsx` |
| Send limits, resend guard, template reuse, list sort | `src/utils/cadenceSend.js` |
| Compose, personalization, test send | `src/components/scout/BulkComposeModal.jsx` |
| Send loop, cadence record | `src/components/scout/BulkSendExecutor.jsx` |

## Contacts

- **Parsing** uses PapaParse. It handles quoted commas (`"Acme, Inc."`), escaped quotes, CRLF line endings, a BOM, blank cells, short rows and any column order.
- **Fields kept:** name, first and last name, email, phone, title, company, industry/vertical, state, location, LinkedIn URL and notes. Notes are added to `notes[]`, the shape the sticky-notes UI reads.
- **Document shape:** contacts are built with `buildUserAddedContact`, the same builder Add Manually now uses. The CSV-specific fields are:
  - `source: 'csv_import'`
  - `addedFrom: 'csv'` (the existing "CSV Import" source filter in People)
  - `import_method: 'csv'`
  - `import_batch_id`, `import_name`, `import_file_name`
  - `tags: [<group tag>]`
- **Company:** linked through `ensureCompanyForContact`, the same as Add Manually. Each distinct company name is resolved once per import.
- **Duplicates:** checked by the canonical `prepareContactWrite`, which matches on email, then Apollo ID, then LinkedIn URL, then phone. Name + company is only flagged. One resolver adapter is shared across the whole import, so the fallback scan of existing contacts is loaded once.
- **Existing contacts:** for a person already in IDYNIFY, the import:
  - adds identifiers they don't have yet (`mergeIdentifiers`; never overwrites name, title or other canonical fields)
  - fills in a missing company link
  - adds the group tag
  - returns them in the import result, so they're included in the cadence

  A note that's already on the record is not added again.
- **Failure is per row.** One bad row can't abort the file. New contacts are committed in chunks of 400, and any rows that fail to save are reported by row number.
- **Limit:** 500 contacts per file (`MAX_IMPORT_ROWS`). Rows past the limit are listed, not dropped silently.

## Cadences

A cadence is still a one-time bulk send recorded as one `users/{uid}/cadences` doc. "Add to Cadence" means sending the chosen cadence's message to these people under the same cadence name. There is no persistent enrollment or step scheduling yet.

- **Template reuse:** new sends store `templateSubject`, `templateBody`, `path`, `personalizedWithBarry`, `cc` and `hasAttachment`.
  - Reuse fills compose from these fields. The doc's `subject` and `body` are the first recipient's rendered email, so they aren't used.
  - Older cadences without a template have the leading greeting stripped, and the picker says "review the message before sending".
  - A PDF attachment is not stored, so it must be re-attached; the picker says so.
- **One message.** Every send has one subject and one body. A PDF attachment and a CC are optional additions, and both need Gmail connected. When the body contains `{{personalize}}`, Barry fills the tag in place and no greeting is added. Otherwise each email is "Hi {first}," + Barry's opening line (if on) + the body. A contact with no real first name (email-only) gets "Hi,". The preview, Send Test and the real send all render through `renderCadenceEmail`.
- **Up to 100 recipients per send** (`MAX_BULK_CONTACTS`). Barry personalization is requested 25 at a time, the per-request limit of `barryBulkPersonalize`, with one progress count.
- **Send Test to Me** sends the first recipient's fully rendered email to the signed-in user, through the same `gmail-send-quick` function and Gmail account as the real send:
  - same subject (prefixed `[TEST]`), body, personalization and attachment
  - no CC, no contact id and no cadence id, so no contact is updated, nothing is tracked and nothing is counted
  - requires Gmail to be connected

### Archived matches

An import can match a contact that's archived, or whose company is archived. That person is tagged and counted, and the success screen says "N are archived". People shows them only in that import's tag view, under a banner, and they stay archived; they are not reactivated.

### Resend protection

On Preview, compose loads every cadence doc with the same **name**. Anyone recorded as delivered on any of them is excluded from this send. "Delivered" means:
- a `contacts[]` row with status `sent` or `opened` (handed off to the mail app), or
- an id in `deliveredContactIds`.

A banner shows how many people were excluded, with a **Send to them again** checkbox to include them. The check is per cadence name; sending a different cadence to the same person is allowed.

### Interrupted sends

- The send loop runs in the browser tab.
- Each delivery is written to the cadence doc as it happens, as `deliveredContactIds` (arrayUnion), `sentCount` / `nativeHandoffCount` (increment) and `lastSentAt`. This doesn't wait for the completion write.
- The Cadences list no longer orders by `completedAt`, which Firestore requires to exist. It sorts client-side by `completedAt`, then `lastSentAt`, then `createdAt`.
- A send that started and has had no activity for 30 minutes shows as **Interrupted**.

## Not in this phase

Multi-step cadences, scheduled or background sending, persistent enrollment, select-all in People, a column-mapping UI, and stored attachments.
