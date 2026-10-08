# Staging validation: CSV → People → Cadence

> **Operators: use `docs/STAGING_OPERATOR_RUNBOOK.md`.** That is the step-by-step test with PASS/FAIL criteria. This file is the engineering background: the pre-flight findings and how they were fixed.

**Status: NOT YET RUN on staging.** P1–P4 below were fixed in code on 2026-10-07; they still need confirming on staging. The session that built this feature had no staging URL, no Firebase credentials, no connected Gmail account and no Contact Hub export. Nothing below is a staging result. This document has three parts:

1. **Pre-flight findings.** Issues found by reading the code each test exercises, plus a local run of the real parser on a fixture. Each one is a prediction to confirm or rule out on staging.
2. **Runbook.** Exact steps and what to inspect, per test.
3. **Results template.** Fill this in during the run; it produces the A–F report.

Fixture: `docs/staging/csv-edge-cases.csv`. Replace `REPLACE+csvNN@REPLACE.com` with plus-addresses on an inbox you control (for example `you+csv01@yourdomain.com`), so every real send lands with you. Before uploading, create **Fay Existing** (`…+csv09@…`) through Add Manually.

---

## 1. Pre-flight findings (predicted from code — confirm on staging)

| # | Severity if confirmed | Test | Finding |
|---|---|---|---|
| P1 | **Fixed** (was: wrong recipient) | 3, 9 | A phone, LinkedIn or Apollo match whose stored email differs from the CSV email is now flagged as an **Email conflict** in the preview (banner, row reason, badge) and on the success screen. The stored email and `email_normalized` are left unchanged. The person joins the import group but is **held back from Add to Cadence**, and the picker lists them with both addresses. |
| P2 | **Fixed** (was: People count mismatch) | 4 | Matched contacts that are archived, or whose company is archived, show in **this import's tag view only**, under a banner saying how many are archived. They stay archived and are hidden again when the tag filter is cleared. The success screen reports "N are archived". They **remain eligible for Add to Cadence** by design: the uploaded list is the intended audience. |
| P3 | **Fixed** (was: blocker for the flyer send) | 7 | There is now **one message**. The PDF and CC are optional additions to it, so attaching the flyer keeps the reused subject and body, the "Hi {first}," greeting and the Barry toggle. A body containing `{{personalize}}` still gets Barry's text in place, with no added greeting. The test send and the real send render through the same function. |
| P4 | **Fixed** | 6 | An email-only contact is greeted "Hi,", and `{{first_name}}` is left empty for them. |
| P5 | Minor (data) | 1 | The CSV **Tags** column is not imported. The preview lists it under "Columns not imported". Contact Hub tags are lost; only the import tag is applied. |
| P6 | Expected — not a bug | 3 | Existing matched contacts keep their original `source`/`addedFrom`; that's the non-destructive rule. They get the import tag, `identity_sources` gains `csv_import`, and `last_import_batch_id` is set. Only **new** contacts get `source: csv_import` and `addedFrom: csv`. Test 3's expectation should be read that way. |
| P7 | Minor | 8 | A test send writes one `email_logs` entry (`contactId: null`, no `cadenceId`, `source: quick_engage`). It touches no contact, timeline or cadence. |
| P8 | Minor | 9 | During a send, the cadence doc's `sentCount` and `deliveredContactIds` update live. The per-person rows in `contacts[]` stay "pending" until the send completes, so Cadence Detail's per-person status doesn't move while sending. |
| P9 | Minor | 12 | Each delivery record is written right after the send, without waiting for the write to finish. If the tab closes in the instant between a send and that write, that one recipient isn't recorded and isn't protected from a resend. |
| P10 | Expected | 10 | Replies are picked up by **`check-replies`, which runs only when Cadence Detail is opened**, marking `replied` on the cadence row, and by `gmail-sync-worker` every 10 minutes (Barry inbox intelligence). No follow-up logic changes. |
| P11 | Unknown | 1 | Contact Hub header names are unknown. Headers recognized today are in `HEADER_ALIASES` in `src/utils/csvContactImport.js`. Likely gaps: "Organization Name", "Home Phone", "Address", "Zip", "Tags". Unrecognized headers are listed in the preview, never silently used. |

The local run of the real parser and classifier on the fixture gave the expected per-row classification:

```
row 2  ready   Ada Testone
row 3  ready   Ben Testtwo        company "Acme, Inc." (quoted comma kept)
row 4  ready   Cara Testthree     blank phone/title/state OK
row 5  invalid Invalid email address: not-an-email
row 6  missing Needs a name or an email address
row 7  duplicate_in_file  Same person as row 2 (email case differs)
row 8  ready   name = the email address  (see P4)
row 9  ready   company The "Big" Gallery, notes with quotes and a comma
row 10 ready   Fay Existing → should preview as "already in IDYNIFY"
ignored column: Tags
```

**Expected preview:** Ready **6** (5 new · 1 already in IDYNIFY) · Possible duplicates **1** · Invalid **1** · Missing **1** = **9 rows**.

---

## 2. Runbook

**Before you start**
- Staging build from branch `claude/vibrant-ptolemy-6e4r6q`.
- Gmail connected (Settings → Integrations).
- Firestore console open on the staging project at `users/{yourUid}`.
- Name the test cadence `STAGING - Beyond Words Test`.

### Test 1: Real Contact Hub export
Export 10–20 contacts and save the header row here. Upload, then record the preview's "Columns not imported" line. Open two imported contacts in Firestore and check `first_name`, `last_name`, `email`, `phone`, `company`/`company_name`/`company_id`, `title`, `state`/`location` and `notes[]`.

### Test 2: Preview (fixture first, then the real export)
Compare the tiles with the expected numbers above. Check every "Row N" in "Rows needing attention" against the spreadsheet. **Screenshot** the tiles, the attention list, and the sample.

### Test 3: Import and reconciliation
After import, filter `users/{uid}/contacts` on `tags array-contains "<tag>"`, and on `import_batch_id == <batchId>` (new contacts only). Check:

```
CSV data rows = new + existing + possible-dup-skipped + invalid + missing + over-limit
contacts with tag     = new + existing        (= "N contacts imported")
docs with import_batch_id = new
```

On **Fay Existing**, confirm that `name`, `title` and `source` are unchanged, the tag was added, and `identity_sources` includes `csv_import`.

### Test 4: People group
Also check: if the batch matched an archived contact, it appears here under the amber "Includes N archived contacts" banner and disappears when the tag filter is cleared.
Click **View People**. The URL should be `/command-center?tab=people&tag=…`. The count shown should equal "N contacts imported"; if it doesn't, check P2. Check that company, email and phone display.

### Test 5: Add to Cadence
To test P1, include one row whose phone or LinkedIn matches an existing contact but whose email is different. Check that the preview shows "Email conflict" with both addresses, and that the picker lists that person as "not included".
Click Add to Cadence and choose `STAGING - Beyond Words Test` (send it once to yourself first if it doesn't exist yet). Check that the name, subject and body are pre-filled and the header shows "N contacts".

### Test 6: Personalization
Click Preview. Check every card's greeting and opening line against that card's contact. Spot-check five. For more than 25 people, the button shows "Personalizing X of N…".

### Test 7: Attachment
Reuse the cadence, then attach the flyer PDF in the same compose screen; there is no mode switch any more. Check that the subject and body are unchanged and Personalize with Barry is still on. On the review cards, check "Hi {first}," plus Barry's line, and "PDF attached: <file>" on every card.

### Test 8: Send Test
Click **Send Test to Me**. In Gmail, check the From account, the `[TEST]` subject, body, personalization, links, formatting and attachment. In Firestore, check:
- no change to the first recipient's contact doc
- no new `cadences` doc
- no timeline event
- one `email_logs` entry (P7)

### Test 9: Real send (3–5 controlled recipients)
Click Send. Watch `cadences/{id}` update `sentCount` and `deliveredContactIds` live. Check Gmail Sent. On completion, `status: completed` and `contacts[]` statuses should be filled in.

### Test 10: Reply
Reply from one recipient. Wait at least 10 minutes, then open Cadence Detail and record where the reply shows (P10).

### Test 11: Resend protection
Run the same cadence with the same people. The banner should say "N … already received", the button should show the reduced count, and **Include them again** should restore it. Then pick a different cadence for the same people: it should not exclude anyone.

### Test 12: Interrupted send
Send to 3 or more controlled recipients and close the tab after the first "Sent". Check that the cadence still appears in the list with status Active, and turns **Interrupted** after 30 minutes with no activity. Re-run the same cadence: recipients already sent to should be excluded.

### Test 13: Limits (UI only — do not send)

| Case | Expected |
|---|---|
| More than 25 contacts in compose | Personalization progress counter |
| Over 100 with email (import) | The picker warns that up to 100 can be sent and the remainder can be sent from People. The compose header shows 100. |
| Over 100 selected in People | The Compose button is disabled with "Maximum 100 contacts per bulk send". |
| CSV with 501+ rows | Amber banner "N rows are over the 500-contact limit", with the rows listed. |

---

## 3. Results (fill in)

| Test | Result (PASS / UX / BUG / BLOCKER) | Notes / screenshot |
|---|---|---|
| 1 Contact Hub mapping | | headers not recognized: |
| 2 Preview | | |
| 3 Import + reconciliation | | rows / new / existing / skipped: |
| 4 People group | | |
| 5 Add to Cadence | | |
| 6 Personalization | | |
| 7 Attachment | | |
| 8 Send Test | | |
| 9 Real send | | |
| 10 Reply | | observed behavior: |
| 11 Resend protection | | |
| 12 Interrupted send | | |
| 13 Limits | | |

**F. Live readiness** (answer after the run): YES / YES, AFTER THESE FIXES / NO
