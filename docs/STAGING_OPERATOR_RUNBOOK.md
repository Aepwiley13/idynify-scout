# Staging runbook: CSV → People → Cadence

**Who this is for:** the person running the staging test. Follow it top to bottom.
**Build under test:** branch `claude/vibrant-ptolemy-6e4r6q`. Confirm with engineering that staging is running this branch before you start.
**Time:** about 2 hours, including a 30-minute wait in Step 26.

> **The two safety rules**
> 1. **Never send to real Contact Hub people during this test.** Part A uses the real export but stops at "Send Test to Me" (which only emails you).
> 2. **Live sends (Part B) go only to the controlled addresses in your controlled CSV.**

Workflow covered: real Contact Hub CSV → Upload CSV → Preview → Import → View People → Add to Cadence → Attach flyer → Send Test to myself → Send to 3–5 controlled recipients → Verify Gmail and cadence history → Resend protection → Real reply → Interrupted send.

---

## 1. Preparation

### 1.1 What you need

| # | Item | Details |
|---|---|---|
| P1 | **Staging URL** | Get it from engineering. It isn't recorded in the repo. Write it here: `________________` |
| P2 | **Staging login** | A test account on staging. **The email you log in with is where "Send Test to Me" goes.** Write it here: `________________` |
| P3 | **Connected Gmail** | Logged in to staging, go to **Settings → Available integrations → Gmail → Connect**. Pass: Gmail is listed under **Connected**. Every email in this test is sent *from* this account. |
| P4 | **Real Contact Hub CSV** | Export **10–20 real contacts** from the UAC Contact Hub. Don't edit it. It's used in Part A only and is never sent to. |
| P5 | **Controlled CSV** | Copy `docs/staging/controlled-recipients-template.csv` (9 data rows; see 1.4). Replace the placeholder emails. Ideally swap in the Contact Hub's own header names (see 1.3) so this file tests the same columns. |
| P6 | **Event flyer** | The real Beyond Words flyer, as a **PDF, 4 MB or smaller**. Anything else is rejected. |
| P7 | **Invite text** | The real subject line and body, including the **full registration link starting with `https://`** on its own line. |
| P8 | **Controlled recipients** | **4 addresses on your own inbox using plus-addressing** (for example `you+new1@yourdomain.com`; Gmail and Google Workspace deliver these to you), **plus 1 separate mailbox someone else can reply from**, such as a colleague or a personal Gmail. The reply test fails if the reply comes from the Gmail account connected in P3; see Step 24. |
| P9 | **Browser** | Chrome with DevTools open (F12 → Console), so errors can be copied into bug reports. |
| P10 | **Firestore console access (optional)** | Some checks are marked *(Firestore)*. If you don't have access, have an engineer check them, or skip and note it. |
| P11 | **A results sheet** | Copy the checklist in Section 13 and fill it in as you go. Take a screenshot at every step marked 📸. |

### 1.2 Where things are in the app

- **Scout+:** Scout → **Scout+** tab (`/scout?tab=scout-plus`)
- **People (from an import):** opened for you by the **View People** button. The address will be `/command-center?tab=people&tag=…`
- **Cadences:** Scout → **Cadences** tab (`/scout?tab=cadences`)

### 1.3 CSV columns IDYNIFY recognizes

Header names can be in any order. Upper or lower case, spaces, `_` and `-` are all treated the same.

| Contact field | Header names recognized |
|---|---|
| **Full name** | Name, Full Name, Contact Name, Contact |
| **First name** | First Name, First, FName, FirstName, Given Name |
| **Last name** | Last Name, Last, LName, LastName, Surname, Family Name |
| **Email** | Email, Email Address, E-mail, Work Email, Business Email, Primary Email |
| **Phone** | Phone, Phone Number, Mobile, Mobile Phone, Cell, Cell Phone, Work Phone, Direct Phone |
| **Company** | Company, Company Name, Organization, Organisation, Account Name, Account, Employer |
| **Title** | Title, Job Title, Position, Role |
| **LinkedIn** | LinkedIn, LinkedIn URL, LinkedIn Profile, LinkedIn Profile URL, Person LinkedIn URL |
| **Industry** | Industry, Vertical, Sector |
| **State** | State, State/Province, Province, Region |
| **Location** | Location, City |
| **Notes** | Notes, Note, Comments, Comment |

- **Required for each row:** a name (Name, or First Name with optional Last Name) **or** an email. Everything else is optional.
- **Not imported:** any other column, for example **Tags**, Address, Zip, Home Phone or "Organization Name". These are listed on the preview screen as *"Columns not imported"*. Nothing is guessed.
- **If a column you need is "not imported"** (for example the Contact Hub calls email "Email 1"): record it as a finding, rename that header in a *copy* of the file to one of the names above, and continue.

### 1.4 What the controlled CSV contains

After you replace the placeholders, the template has these 9 data rows. Spreadsheet row numbers count the header as row 1.

| Row | Person | Purpose |
|---|---|---|
| 2 | New One (`you+new1@`) | New contact |
| 3 | Reply Tester (**separate mailbox**), company `"Acme, Inc."` | New contact; checks that a quoted comma stays in one field; used for the reply test |
| 4 | Existing Test (`you+existing@`), Title "Intern" | Matches an existing contact **by email**. The title must *not* overwrite. |
| 5 | LinkedIn Test (`you+linkedin@`) + LinkedIn URL | Matches an existing contact **by LinkedIn**. The email gets filled in. |
| 6 | Conflict Test (`you+conflict-new@`), phone 801-555-0199 | Matches **by phone**, but the email differs. Must be **held back**. |
| 7 | Archive Test (`you+archived@`) | Matches an **archived** contact. Must stay **eligible**. |
| 8 | New Again (`YOU+NEW1@` — same address as row 2, different case) | **Duplicate within the file.** Must be skipped. |
| 9 | Bad Email (`not-an-email`) | **Invalid.** Must be rejected. |
| 10 | (no name, no email) | **Missing required information.** Must be rejected. |

### 1.5 One-time setup in staging (do this before Step 1)

Use **Scout+ → Add Manually** for S1–S5. For any field not listed, leave it blank.

| ID | Create this contact | Then |
|---|---|---|
| S1 | Name **Existing Test**, Email `you+existing@…`, Company Staging Test Org, Title **Board Member** | — |
| S2 | Name **LinkedIn Test**, LinkedIn URL `https://www.linkedin.com/in/idynify-staging-linkedin-test`, **no email** | — |
| S3 | Name **Conflict Test**, Email `you+conflict-old@…`, Phone `801-555-0199` | — |
| S4 | Name **Archive Test**, Email `you+archived@…` | Open People, find Archive Test, and click **Archive** on the card (or **Archive** on the contact page). Pass: it disappears from People. |
| S5 | Name **Seed Recipient**, Email `you+seed@…` | Used for S6 only. |
| S6 | **Create the test cadence.** Open People, search "Seed", click **Start Cadence**, click Seed Recipient, then click **Compose Email**. Set Cadence Name to exactly **`STAGING - Beyond Words Test`**, enter the real invite Subject and Body (P7), and leave **Personalize with Barry** on. Click **Preview**, then **Send to 1 contact**. | Pass: "1 of 1 sent" and "1 sent, 0 failed". You receive the email at `you+seed@`. In **Cadences**, `STAGING - Beyond Words Test` is listed. |

*Optional, for the archived-company case:* create **CoArchive Test** (`you+coarchive@…`, Company **Staging Archived Co**). Then in **Saved Companies**, archive "Staging Archived Co". Add a row for this person to the controlled CSV. Every count in Part B then increases by one: one more "already in IDYNIFY", one more archived, one more recipient.

---

## 2. Step-by-step instructions

### PART A — Real Contact Hub CSV (no sending except to yourself)

**STEP 1 — Open CSV import**
- **ACTION:** Scout → **Scout+**. Click **Upload CSV**.
- **EXPECTED:** The heading reads "Upload CSV". The screen asks *"What are you uploading?"* with two choices: **Lead / Contact List** and **Company List**.
- **PASS:** The card is clickable, has no "Coming Soon" badge, and shows the choice screen.
- **FAIL:** The card does nothing, shows "Coming Soon", opens a different screen, or shows an error.

**STEP 2 — Choose the list type**
- **ACTION:** Click **Lead / Contact List**.
- **EXPECTED:** The header reads "Lead / Contact Upload — Required: a Name (or First + Last Name) or an Email." Below it are CSV Upload Guidelines ("Up to 500 contacts per upload") and a **Choose File** button.
- **PASS:** As described.
- **FAIL:** Anything else, or the Company List screen opens.

**STEP 3 — Upload the real Contact Hub CSV** 📸
- **ACTION:** Click **Choose File** and pick the Contact Hub export (P4).
- **EXPECTED:** A progress panel shows *"Checking for people already in IDYNIFY… X of N"*, then the **Preview** screen appears.
- **PASS:** The preview appears within about a minute for 20 rows.
- **FAIL:** An error appears ("Could not read this file…", "None of the columns look like contact fields…"), it hangs, or the page goes blank.

**STEP 4 — Check column mapping**
- **ACTION:** Read the line *"Columns not imported (no matching contact field): …"*.
- **EXPECTED:** It lists only columns you don't need (Tags, Address, and so on). It's absent if every column was recognized.
- **PASS:** First name, last name, email, phone, organization, title, state, notes and LinkedIn (where the export has them) are **not** on that line.
- **FAIL (mapping finding):** Any of those fields is on that line. Record the exact header name, then follow 1.3 (rename the header in a copy) and re-upload.

**STEP 5 — Check the preview counts** 📸 *(full rules in Section 3)*
- **ACTION:** Compare the four tiles, *"N rows in file"*, and the **Rows needing attention** list against the spreadsheet.
- **EXPECTED:** The tiles are **Ready to import**, **Possible duplicates**, **Invalid rows** and **Missing required information**. Every row that won't import is listed by spreadsheet row number with a reason.
- **PASS:**
  - The counts reconcile using the formula in Section 3.
  - Each listed row number matches the spreadsheet.
  - Values containing commas (for example "Acme, Inc.") appear intact in the Sample.
- **FAIL:** The counts don't reconcile, a row number points at the wrong spreadsheet row, a row is missing from both the counts and the list, or a field appears split or shifted.

**STEP 6 — Name and import** 📸
- **ACTION:** Under **Name this import**, type `Staging UAC Real`. Note the tag shown beneath it (*"Every imported contact is tagged CSV Import - Staging UAC Real - YYYY-MM-DD"*). Click **Import N contacts**.
- **EXPECTED:** The heading changes to **"Import Complete"**, then shows **"N contacts imported successfully"**. Below that:
  - "X new · Y already in IDYNIFY (updated, not duplicated)"
  - the tag chip
  - if they apply: an email-conflict line, an archived line, and a "rows could not be saved" line
  - "What would you like to do next?" with **View People** and **Add to Cadence**
- **PASS:**
  - N equals the **Ready to import** tile, minus any rows listed as "could not be saved".
  - X + Y = N.
- **FAIL:** N doesn't reconcile, any row "could not be saved", or there's an error alert.

**STEP 7 — Check imported data** *(Firestore, or open 2–3 contacts in People)*
- **ACTION:** Open two new contacts and compare them with the CSV.
- **EXPECTED:**
  - Name, email, phone, company, title, state/location and notes match the CSV, with notes on the contact's notes.
  - *(Firestore)* `users/{uid}/contacts/{id}` has `source: "csv_import"`, `addedFrom: "csv"`, `tags` containing the import tag, and `import_batch_id` set.
- **PASS:** All values match, and nothing is blank that was filled in the CSV.
- **FAIL:** A value is missing, shifted into the wrong field, or different.

**STEP 8 — View People** 📸
- **ACTION:** Click **View People**.
- **EXPECTED:**
  - People opens, and the address contains `tab=people&tag=CSV+Import+-+Staging+UAC+Real…` (spaces show as `+`).
  - The **Tag** pill in the filter bar is highlighted and shows `CSV Import - Staging UAC Real - <date>`.
  - Only this import's contacts are listed.
- **PASS:**
  - The number of people listed equals **N** from Step 6.
  - Every name from the import is present, and nobody else.
  - Company, email and phone show on the cards.
- **FAIL:** The count is different, someone is missing, an unrelated contact appears, or company/email doesn't show.

**STEP 9 — Return to the import and open Add to Cadence**
- **Why this step exists:** the success screen isn't kept once you leave it. Browser Back from People returns to the **Scout+ menu**, not the success screen. That's current behavior (NON-BLOCKING). The way back is to re-import the same file under the **same name**. That's safe: everyone is matched, nobody is duplicated, and the tag stays the same.
- **ACTION:**
  1. Scout+ → **Upload CSV** → **Lead / Contact List** → the same Contact Hub file.
  2. Keep the import name `Staging UAC Real`, then click **Import**.
  3. On the success screen, click **Add to Cadence**.
- **EXPECTED:**
  - The re-import preview shows **0 new**; everyone is "already in IDYNIFY".
  - After import, the success screen shows the same tag as Step 6.
  - **Choose cadence** opens (Section 6).
- **PASS:**
  - No new contacts are created (People with the tag still shows N).
  - The picker lists `STAGING - Beyond Words Test` (from S6).
- **FAIL:** The re-import creates new contacts, the picker doesn't open or is empty, or your cadence is missing.

**STEP 10 — Choose the cadence, check the message** 📸 *(Section 7)*
- **ACTION:** Click **STAGING - Beyond Words Test**.
- **EXPECTED:** **Compose Cadence** opens: *"Step 1 of 3 — Compose · M contacts"*. Cadence Name, Subject and Email Body are filled with the S6 text, and **Personalize with Barry** is on.
- **PASS:** The subject and body match S6 exactly (with `{{first_name}}`-style tags still visible if you used them), and M matches Section 6.
- **FAIL:** The subject or body is empty, different, or starts with a person's name ("Hi Seed,…"), or M is wrong.

**STEP 11 — Attach the flyer** 📸
- **ACTION:** In **Attachment (optional, PDF only, max 4MB)**, click **Drop a PDF here or click to browse** and choose the flyer.
- **EXPECTED:** The file name and size appear in place of the drop zone. **Nothing else on the screen changes.**
- **PASS:** The subject, body, cadence name and the Personalize toggle are identical to Step 10. There's no "Gmail connection required" warning.
- **FAIL:** Any text disappears or resets, the screen switches mode, or a Gmail warning appears (go back to P3).

**STEP 12 — Preview (Barry personalization)** 📸
- **ACTION:** Click **Preview**.
- **EXPECTED:**
  - The button shows *"Personalizing X of M…"*; with more than 25 contacts it counts up in batches of 25.
  - Then **Step 2 — Preview** shows one card per person. Each card has **"Hi <their first name>,"**, a **Barry's opening** box (editable), the body, and **"PDF attached: <flyer name>"**.
- **PASS:**
  - Spot-check 5 cards: the greeting and opening line match *that* card's person and company, with no mixing between cards.
  - Every card shows the PDF.
  - People with no first name show **"Hi,"**, never an email address.
- **FAIL:** The wrong name or company appears on a card, an opening line is empty for many people, the PDF line is missing, or "{{personalize}}" or "{{first_name}}" appears as literal text.

**STEP 13 — Send Test to Me** 📸 *(Section 8)*
- **ACTION:** Click **Send Test to Me**.
- **EXPECTED:** The footer shows *"Test sent to <your login email> — personalized as <first person's name>."*
- **PASS:** The message appears, and the Gmail checks in Section 8 all pass.
- **FAIL:** "Test failed: …" appears, no email arrives within 2 minutes, or any Section 8 check fails.

**STEP 14 — Stop Part A without sending**
- **ACTION:** **Do not click "Send to … contacts".** Click **Edit**, then the **X**, to close Compose.
- **EXPECTED:** Compose closes. Nothing was sent to anyone except your test.
- **PASS:** In **Cadences**, no new cadence was created by Part A. Only S6's cadence exists.
- **FAIL:** Any new cadence entry, or any email reaching a Contact Hub person.

### PART B — Controlled list (real sends to addresses you control)

**STEP 15 — Upload the controlled CSV** 📸
- **ACTION:** Scout+ → **Upload CSV** → **Lead / Contact List** → choose the controlled CSV (P5).
- **EXPECTED:** The preview shows **9 rows in file** and these tiles:

  | Tile | Value | Sub-line |
  |---|---|---|
  | Ready to import | **6** | "2 new · 4 already in IDYNIFY (updated, not duplicated)" |
  | Possible duplicates | **1** | |
  | Invalid rows | **1** | |
  | Missing required information | **1** | |

  - An amber banner reads **"1 email conflict."**
  - **Rows needing attention** lists:
    - **Row 6** (Conflict Test): *matched by phone. CSV email you+conflict-new@… ≠ IDYNIFY email you+conflict-old@…*
    - **Row 8:** *Same person as row 2*
    - **Row 9:** *Invalid email address: not-an-email*
    - **Row 10:** *Needs a name or an email address*
  - In the Sample, Reply Tester's company shows **"Acme, Inc."**.
- **PASS:** Exactly as above (6 + 1 + 1 + 1 = 9).
- **FAIL:** Any number or row differs.

**STEP 16 — Import**
- **ACTION:** Name the import `Staging Controlled`, then click **Import 6 contacts**.
- **EXPECTED:**
  - "**6 contacts imported successfully**"
  - "2 new · 4 already in IDYNIFY (updated, not duplicated)"
  - the tag chip `CSV Import - Staging Controlled - <date>`
  - "**1 email conflict** — kept their IDYNIFY email and won't be added to a cadence until checked in People"
  - "**1 is archived** — shown in this import's People view, still archived"
- **PASS:** As above.
- **FAIL:** Any difference.

**STEP 17 — Check existing-contact handling** *(Section 4; Firestore or the contact pages)*
- **ACTION:** Open Existing Test, LinkedIn Test, Conflict Test and Archive Test.
- **EXPECTED:**
  - **Existing Test:** title is still **Board Member** (not Intern).
  - **LinkedIn Test:** email is now `you+linkedin@`.
  - **Conflict Test:** email is still `you+conflict-old@`.
  - **Archive Test:** still archived.
  - All four carry the import tag.
- **PASS:** As above.
- **FAIL:** Any overwrite, an email changed on Conflict Test, Archive Test reactivated, or a missing tag.

**STEP 18 — View People** 📸
- **ACTION:** Click **View People**.
- **EXPECTED:**
  - The Tag pill shows `CSV Import - Staging Controlled - <date>`.
  - **6 people** are listed: New One, Reply Tester, Existing Test, LinkedIn Test, Conflict Test and Archive Test.
  - An amber banner reads *"Includes 1 archived contact from this import. It appears only in this import's view and stays archived."*
- **PASS:**
  - As above.
  - Then clear the Tag pill (click its **×**): Archive Test disappears, and Seed Recipient, plus any other contacts, reappear.
- **FAIL:** The count isn't 6, Archive Test is missing, an unrelated contact appears while the tag is selected, or Archive Test still shows after the tag is cleared.

**STEP 19 — Add to Cadence** 📸 *(Section 6)*
- **ACTION:** Re-import the controlled CSV under the **same name** `Staging Controlled`, as in Step 9. The preview should show "0 new · 6 already in IDYNIFY", 1 email conflict and the same rejected rows. Click **Import 6 contacts**, then click **Add to Cadence**.
- **EXPECTED:**
  - **Choose cadence**, with the subtitle *"5 contacts will be added to the send"*.
  - An amber box: *"1 contact is not included — the email in your CSV differs from the one in IDYNIFY: Conflict Test: CSV you+conflict-new@… · IDYNIFY you+conflict-old@… (matched by phone)"*.
  - Below that, the cadence list and **Create new cadence**.
- **PASS:** As above.
- **FAIL:** The count isn't 5, Conflict Test is included, or Archive Test is excluded.

**STEP 20 — Compose, attach, preview, test**
- **ACTION:** Click **STAGING - Beyond Words Test**. Repeat Steps 11–13: attach the flyer, click **Preview**, then click **Send Test to Me**.
- **EXPECTED:** *"Step 1 of 3 — Compose · 5 contacts"*. On the preview, 5 cards (New One, Reply Tester, Existing Test, LinkedIn Test, Archive Test), each with "Hi <First>,", Barry's line and the PDF. Footer button: **"Send to 5 contacts"**.
- **PASS:** As in Steps 11–13, and **no "already received" banner** (none of these 5 received this cadence in S6).
- **FAIL:** The same as Steps 11–13, or an "already received" banner appears.

**STEP 21 — Live send to the 5 controlled recipients** 📸 *(Section 9)*
- **ACTION:** Click **Send to 5 contacts**. **Keep the tab open** until it finishes.
- **EXPECTED:**
  - **Step 3 — Sending**, with *"Sending — do not close this tab"* and a running *"X of 5 sent"*.
  - Each row goes Pending → Sending… → **Sent**, about 2–4 seconds apart.
  - At the end: **"5 sent, 0 failed"**.
- **PASS:** "5 sent, 0 failed", and no row says "Opened in mail app" or "Failed".
- **FAIL:** Any **Failed** row, any **"Opened in mail app"** (Gmail isn't connected; that's a fail for this test), or the counter stops.

**STEP 22 — Verify Gmail** *(per-recipient checklist in Section 9)*
- **ACTION:** Check the connected Gmail's **Sent** folder, each `you+…@` delivery in your inbox, and the Reply Tester's inbox.
- **PASS:** Each of the 5 got exactly **one** email, with the correct personalization and the PDF.
- **FAIL:** A recipient got none or two, an email went to a wrong address (especially `you+conflict-new@` or `you+conflict-old@`), or the PDF is missing.

**STEP 23 — Verify cadence history** 📸
- **ACTION:** Scout → **Cadences**. Open the newest **STAGING - Beyond Words Test**.
- **EXPECTED:**
  - There are now two entries with this name: the S6 send and this one. Every send creates its own entry; the newest is first.
  - The new one is **Completed**, with 5 contacts each showing **Sent**.
  - *(Firestore)* `users/{uid}/cadences/{id}` has `status: "completed"`, `sentCount: 5`, `deliveredContactIds` containing 5 ids, `templateSubject`/`templateBody` equal to the S6 text, and `hasAttachment: true`.
  - **Archive Test is still archived.** It isn't in People without the tag, and *(Firestore)* `is_archived: true`.
- **PASS:** As above.
- **FAIL:** The entry is missing, the status is wrong, contacts are missing, or Archive Test was reactivated.

**STEP 24 — Real reply** *(Section 10)*
- **ACTION:** From the **Reply Tester mailbox** (not the connected Gmail account), reply to the invite. Wait **2 minutes**, then open the cadence in **Cadences** (opening it triggers the reply check).
- **EXPECTED:** Reply Tester's row shows **Replied**.
- **PASS:** "Replied" appears within 2 minutes of opening Cadence Detail. Refresh the page once if needed.
- **FAIL:** It still isn't marked Replied after 2 refreshes 5 minutes apart. Make sure the reply came from a different account than the connected Gmail before reporting it.

**STEP 25 — Resend protection** 📸 *(Section 11)*
- **ACTION:**
  1. Scout+ → **Upload CSV** → **Lead / Contact List** → upload the **same controlled CSV** again, named `Staging Controlled Re-run`.
  2. Expect "**0 new · 6 already in IDYNIFY**" and 1 email conflict. Click **Import 6 contacts**.
  3. Click **Add to Cadence** → **STAGING - Beyond Words Test** → **Preview**.
- **EXPECTED:**
  - A banner: *"5 people have already received "STAGING - Beyond Words Test". They are excluded from this send."*
  - Each card shows **"Already received — excluded"**.
  - The send button reads **"Send to 0 contacts"** and is disabled.
- **PASS:**
  - As above.
  - Then tick **Send to them again**: the button becomes **"Send to 5 contacts"**. **Do not click it.** Untick the box.
  - Then close Compose, click **Add to Cadence** → **Create new cadence**, type the name `STAGING - Different Cadence` and a subject/body, then click **Preview**: **no** banner, and **"Send to 5 contacts"** is enabled. **Do not send.** Close.
- **FAIL:** Already-sent people aren't excluded by default, the override doesn't work, or a different cadence is wrongly blocked.

**STEP 26 — Interrupted send (safe version)** 📸 *(Section 12)*
- **ACTION:**
  1. Go to People with the `Staging Controlled` tag. Click **Start Cadence**, click **New One, Existing Test, LinkedIn Test and Archive Test** (4 people, all your own inbox), then click **Compose Email**.
  2. Set Cadence Name `STAGING - Interrupt Test`, Subject "Interrupt test", Body "Ignore — staging test." Turn **Personalize with Barry off**.
  3. Click **Preview**, then **Send to 4 contacts**.
  4. **As soon as the counter shows "1 of 4 sent" or "2 of 4 sent", close the browser tab.**
  5. Reopen staging, go to **Cadences**, and note what you see. Wait **30 minutes**, then refresh.
- **EXPECTED:**
  - Right after reopening: **STAGING - Interrupt Test** is listed with status **Active**.
  - After 30 minutes with no activity: status **Interrupted** (amber).
  - Your inbox has only the emails that were sent before you closed the tab. Gmail Sent matches.
  - *(Firestore)* `deliveredContactIds` lists exactly those people, and `sentCount` matches.
- **PASS:** As above. Then repeat actions 1–3 with the **same 4 people and the same name**: the preview banner excludes the people already sent to, and the button counts only the rest. Send to the remainder, or close.
- **FAIL:** The cadence is missing from the list, it never shows Interrupted, the delivered people aren't recorded or aren't excluded, or anyone received the interrupt test twice.

---

## 3. CSV preview expectations

**What each tile counts:**

| Tile | Includes |
|---|---|
| **Ready to import** | New contacts + contacts flagged for review (same name and company as someone existing) + people already in IDYNIFY + email conflicts. All of these are imported. |
| **Possible duplicates** | Rows that repeat an earlier row in the file (skipped) + rows that resolve to the same existing person as an earlier row (skipped) + **review-flagged rows (imported, and also counted under Ready)** |
| **Invalid rows** | Bad email, a row with more cells than the header (usually an unquoted comma), two existing contacts sharing the same email/phone/LinkedIn ("resolve them in People first"), or "Could not check this row for duplicates". None are imported. |
| **Missing required information** | No name and no email. Not imported. |
| **Over-limit banner** (only above 500 rows) | Rows beyond the 500th importable row. Not imported. |

**The reconciliation formula, exactly as the code behaves:**

```
Rows in file  =  Ready to import
               + Possible duplicates
               + Invalid rows
               + Missing required information
               + Over-limit rows
               − Rows flagged for review   (they're counted in both Ready and Possible duplicates)
```

Review-flagged rows are listed in "Rows needing attention" with *"same name and company as an existing contact — imported and flagged for review"*. With no review-flagged rows and no over-limit rows, the formula is simply Ready + Possible duplicates + Invalid + Missing.

**Other rules:**
- **Rows in file** ("N rows in file" under the file name) doesn't count **completely blank lines**. Those are ignored, and row numbers still match the spreadsheet.
- **After import:** "**N contacts imported**" = Ready to import − rows listed as "could not be saved". The success line "X new · Y already in IDYNIFY" always satisfies **X + Y = N**.
- **Row numbers** count the header as row 1, so the first contact is row 2.
- **Ignored columns** are listed once, by their header name.
- **Email conflicts** appear in Ready (as "already in IDYNIFY"), in an amber banner, and as a row with both addresses.
- **"Could not check this row for duplicates"** means the duplicate check failed. Treat it as a **FAIL** and report it, even though it's counted as Invalid.

---

## 4. Existing contact rules

When a CSV person already exists in IDYNIFY, nothing they already have is overwritten. Name, title, company and email are kept, and only **missing** details are filled in. Every matched person gets the import tag.

| Situation | Preview shows | After import | Eligible for the cadence? |
|---|---|---|---|
| Same email as an existing contact | Counted under "already in IDYNIFY"; Sample badge **Already in IDYNIFY** | Gets the tag; missing fields filled; existing values kept | **Yes** |
| Matched by **phone**, no email in IDYNIFY or the same email | Already in IDYNIFY | The CSV email is added if the record had none | **Yes** |
| Matched by **LinkedIn**, no email in IDYNIFY or the same email | Already in IDYNIFY | The CSV email is added if the record had none | **Yes** |
| Matched by phone or LinkedIn, but **the CSV email differs** from the stored one | **Email conflict** banner, badge and row reason, with both addresses | Joins the group with the **stored email unchanged**; success screen counts it | **No — held back.** Shown in the cadence picker with both addresses. Check the email in People and send from there if appropriate. |
| **Archived** contact | Already in IDYNIFY | Gets the tag and **stays archived**; success screen says "N are archived" | **Yes.** The uploaded list is intentional. Sending to them doesn't reactivate them. |
| Contact whose **company is archived** | Already in IDYNIFY | Gets the tag; company stays archived | **Yes**, and is not reactivated |
| Same name and company only, with no matching email, phone or LinkedIn | Listed as "flagged for review" | Created as a **new** contact, flagged for review | **Yes** |
| No email at all | — | Imported | **No — held back** ("has no email and can't be emailed") |

**The only people held back from a cadence are email conflicts and people with no email.** Nobody is held back for being archived.

---

## 5. People view

- **Where the tag appears:**
  - on the import success screen, as the chip under the counts
  - in People, as the highlighted **Tag** pill in the filter bar (it shows the full tag text)
  - in the page address, as `tag=…`
  - on each contact's tags
- **The tag's format** is `CSV Import - <the name you typed> - <today's date, YYYY-MM-DD>`.
- **Total:** the number of people listed equals "N contacts imported". Archived members are included in this view only, under the amber *"Includes N archived contact(s) from this import…"* banner.
- **No unrelated contacts:** only people carrying the tag are listed while the pill is selected. Clearing the pill (its **×**) returns to normal People, where archived contacts are hidden again.
- **Re-importing** the same file under a new name adds a second tag to the same people. It doesn't create new people.

---

## 6. Cadence picker

After you click **Add to Cadence**:

- **Title:** "Choose cadence". **Subtitle:** "*M* contacts will be added to the send", where M = imported people − email conflicts − people with no email, capped at 100.
- **Held-back people** appear in amber boxes above the list:
  - **Email conflicts:** *"N contact(s) not included — the email in your CSV differs from the one in IDYNIFY:"* followed by each person: name, CSV address, IDYNIFY address, and how they were matched.
  - **No email:** *"N imported contact(s) has/have no email and can't be emailed."*
  - **Over 100:** *"Up to 100 people can be sent at once — the other N can be sent from People afterward."*
- **The list:**
  - Each previously **sent** cadence appears **once**, by name, newest first. A cadence only exists after it has been sent at least once, which is why S6 is needed.
  - Each entry shows its subject and "Last sent <date>".
  - Entries may say "Re-attach the PDF before sending" (it was sent with a PDF, which isn't stored) or "Older cadence — review the message before sending" (sent before this release).
- **Choosing one** opens Compose with that cadence's name, subject, body and Barry setting, and the M people as recipients. There's no reselecting.
- **Create new cadence** opens a blank Compose with the same M people.
- **People not in the cadence picker** (email conflicts, no email) are still in the import group in People. Nothing is lost.

---

## 7. Message and attachment

**Before attaching (Step 10), check:**
- **Cadence Name** = `STAGING - Beyond Words Test`.
- **Subject** and **Email Body** = exactly your S6 text (template tags like `{{first_name}}` stay as tags here).
- **Personalize with Barry** toggle = on.
- **Recipient count** in the header = M from Section 6.
- **How the greeting works:** each email is *"Hi <first name>,"* + **one** Barry sentence + your body. The system owns the greeting:
  - Barry's sentence never starts with a greeting or the recipient's name; any such start is removed.
  - A greeting you type at the start of your body ("Hey {{first_name}}, …") is removed, so **don't write your own greeting**.
  - Each preview card shows the email **exactly as sent**.
  - If your body contains `{{personalize}}`, Barry writes that spot instead, no greeting is added, and a note *"{{personalize}} detected…"* replaces the toggle.

**After attaching (Step 11), check:**
- The **flyer name and size** are shown.
- **Subject, body, name, toggle and recipient count are unchanged.** The attachment is an addition to the same message; there's no mode switch and nothing resets.
- There's **no** red "Gmail connection required…" warning.
- **FAIL** if anything disappears, resets or changes.

---

## 8. Send Test

**How:** on the Preview screen (Step 2 of 3), click **Send Test to Me**. The test is the **first recipient's** real email ("personalized as <name>"). It's sent through the same Gmail connection, with the same subject, body, Barry line and PDF as the real send.

**In your real inbox (your staging login email), check:**

| Check | Expected |
|---|---|
| From | The Gmail account connected in P3 |
| To | Your staging login email |
| Subject | `[TEST] ` + the subject, with tags filled for the first recipient |
| Greeting | "Hi <first recipient's first name>," |
| Barry personalization | The same opening line shown on that person's preview card |
| Body | Your body text in paragraphs, followed by your Gmail signature (added automatically) |
| Registration link | The full `https://…` link is present, **clickable** (IDYNIFY now sends it as a link), and opens the registration page. If it isn't clickable, that's FIX FIRST. |
| Special characters | The subject shows em dashes (—), curly quotes (’ “ ”) and accents (é) exactly as typed. Any `Ã` or `Â` is FIX FIRST. |
| Greeting | Exactly one greeting ("Hi <first>,"). The recipient's name is not repeated in the next sentence. |
| Formatting | Paragraph breaks preserved; no `{{` tags visible |
| PDF | Attached, with the correct file name, and it opens |
| CC | **Not** copied, even if a CC is set. Tests never go to the CC address. |

**What a test does NOT write to IDYNIFY:**
- no change to any contact (including the first recipient)
- no new cadence or cadence counts
- no timeline event
- no "already received" record
- no open tracking

**What it DOES write:** one admin email log entry (`email_logs`, with no contact and no cadence; source `quick_engage`). That's expected and not a bug.

---

## 9. Controlled live send

**How to keep it to 3–5 people:**
- Only the controlled CSV (Part B) is ever sent to.
- In Compose, check the header count (**5 contacts**) and the preview cards before clicking **Send to 5 contacts**.
- To drop someone, go back with **Edit** and remove them from **Recipients** (the small **×** next to their name).

**What to watch during the send:**
- **Progress:** *"Sending — do not close this tab"* and *"X of 5 sent"*.
- **Per person:** Pending → Sending… → **Sent**.
- **End state:** *"5 sent, 0 failed"*. If anything failed, a **Retry failed (N)** button appears. Record it before retrying.
- **Gmail Sent folder:** 5 new messages appear as they send.
- **Cadence history:** if open in another tab, Scout → Cadences shows the new entry as **Active** while sending.
  - Per-person rows in Cadence Detail switch from Pending to Sent **when the send completes**, not one by one. That's expected.
  - The sent count updates live *(Firestore `sentCount`, `deliveredContactIds`)*.

**After the send, check each recipient:**

| Recipient | 1 email arrived (not 2) | Correct "Hi <first>," | Barry line fits them | PDF attached, opens | Link works | Shows Sent in Cadence Detail |
|---|---|---|---|---|---|---|
| New One | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Reply Tester | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Existing Test | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| LinkedIn Test | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Archive Test (still archived afterwards) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Conflict Test: **must receive nothing** at either address | ☐ | — | — | — | — | — |

---

## 10. Real reply (current behavior only)

- **Who replies:** the Reply Tester mailbox. The reply must come from a **different account than the connected Gmail**. A reply from the connected account, or from a plus-address of it, counts as you and is ignored.
- **How long to wait:** about 2 minutes after the reply arrives in the connected Gmail inbox.
- **Do you need to open Cadence Detail?** **Yes.** Replies are checked when you open the cadence's page (Scout → Cadences → click the cadence). There's no background check for cadence replies.
- **Where you'll see it:**
  - the contact's row in Cadence Detail shows **Replied**, and the cadence's reply count goes up
  - the contact's status changes to **In Conversation**
  - a "reply received" event is added to the contact's timeline
- **Barry inbox sync:** it runs separately every 10 minutes and processes new inbox messages for Barry's inbox features. It isn't needed for the cadence's Replied status.
- **What is NOT automated:**
  - no follow-up email is sent
  - nothing is scheduled
  - no notification is required
  - nothing else about the cadence changes
- **Known limitation:** for a send that was **interrupted** (Step 26), replies aren't detected on the cadence page, because the thread link is only saved when a send completes.

---

## 11. Resend protection (exact behavior)

- **What counts as the same cadence:** the **same cadence name**. It's case-sensitive and ignores spaces at the start and end. Choosing the cadence in the picker always uses the exact name.
- **When it's checked:** on **Preview**.
- **Who is excluded:** anyone who was delivered **any** earlier send with that name. That covers people shown as sent, or opened in the mail app, and people recorded as delivered in a send that was interrupted.
- **Warning:** an amber banner, *"N people have already received "<name>". They are excluded from this send."*, plus **"Already received — excluded"** on each of those cards. The send button counts only the rest.
- **"Send to them again":** ticking it includes them; the button count goes back up and the banner says *"They will be sent it again."* Unticking restores the exclusion.
- **A different cadence** (a different name) is **not** blocked, even for the same people.
- **Not covered:** a send that finished seconds before the tab closed may, rarely, not have recorded its last recipient.

---

## 12. Interrupted send

| Question | Answer |
|---|---|
| What sent successfully? | Every email sent before the tab closed. Gmail Sent is the source of truth. |
| What remains recorded? | The cadence entry, plus each delivered person (recorded the moment their email went out) and the sent count. Per-person rows in Cadence Detail stay **Pending**, because they're only updated when a send completes. |
| When does it become Interrupted? | It shows **Active** until **30 minutes after its last send** (or after it started, if nothing sent). After that it shows **Interrupted**. Refresh the Cadences list to see the change. |
| Resend protection afterwards | Re-running the **same name** with the same people excludes everyone already delivered. Only the people who never got it are sendable. |
| Replies | Not detected on the cadence page for interrupted sends (see Section 10). |

---

## 13. Go / no-go checklist

| # | Check | Critical? | YES / NO |
|---|---|---|---|
| 1 | Contact Hub CSV mapped correctly (no needed column under "not imported"; values intact) | ✅ | ☐ |
| 2 | Preview totals reconciled with the Section 3 formula; row numbers correct | ✅ | ☐ |
| 3 | No rows disappeared silently | ✅ | ☐ |
| 4 | Import count = Ready (minus unsaved rows); new + existing = imported | ✅ | ☐ |
| 5 | Imported fields correct; source shows CSV import | ✅ | ☐ |
| 6 | Existing contacts handled correctly (nothing overwritten; missing fields filled) | ✅ | ☐ |
| 7 | Email conflicts were flagged and held back; stored email unchanged | ✅ | ☐ |
| 8 | Archived contacts stayed eligible, were sent to, and stayed archived | ✅ | ☐ |
| 9 | Import group appeared in People with the correct tag and exact count (archived included) | ✅ | ☐ |
| 10 | Cadence picker listed the cadence; correct recipient count; held-back people shown | ✅ | ☐ |
| 11 | Cadence loaded the correct subject and body | ✅ | ☐ |
| 12 | Attaching the flyer preserved the message (nothing reset) | ✅ | ☐ |
| 13 | Barry personalization correct per person; no mixing | ✅ | ☐ |
| 14 | Test email matched the real message (subject, greeting, Barry line, body) | ✅ | ☐ |
| 15 | PDF arrived (test and live) and opens | ✅ | ☐ |
| 16 | Registration link present and clickable | ✅ | ☐ |
| 17 | Small live send succeeded: 5 sent, 0 failed; each recipient got exactly one | ✅ | ☐ |
| 18 | Conflict Test received nothing | ✅ | ☐ |
| 19 | Cadence history recorded the deliveries (Completed, 5 Sent) | ✅ | ☐ |
| 20 | Reply appeared as Replied after opening Cadence Detail | ✅ | ☐ |
| 21 | Resend protection excluded prior recipients; override worked; a different cadence wasn't blocked | ✅ | ☐ |
| 22 | Interrupted send stayed visible, turned Interrupted, and protected those already sent | ✅ | ☐ |
| 23 | Navigation felt smooth (the success screen isn't kept after View People; re-import is the documented way back) | — | ☐ |
| 24 | Wording, layout and progress messages were clear | — | ☐ |

**Decision rule:**
- **SHIP:** every ✅ item is YES.
- **FIX FIRST:** any issue that can cause a **wrong recipient**, a **missing or wrong message**, a **missing attachment**, a **duplicate send**, a **failed Gmail delivery**, **missing imported contacts**, or a non-clickable registration link. Stop the rollout, file the bug, and re-run the affected steps after the fix.
- **NON-BLOCKING:** pure UX roughness that doesn't affect correctness or safety, such as wording, layout, extra clicks, or having to re-import to get back to the success screen (items 23–24). Log it and ship.

---

## 14. Bug report template

```
STEP:            (e.g. STEP 15 — Upload the controlled CSV)
EXPECTED:        (copy the EXPECTED line from this runbook)
ACTUAL:          (what happened, word for word)
CONTACT:         (name + email of the person affected, or "n/a")
CADENCE:         (cadence name + date/time, or "n/a")
SCREENSHOT:      (attach)
CONSOLE ERROR:   (DevTools → Console, copy any red lines)
FIRESTORE RECORD:(path + the relevant fields, or "not checked")
GMAIL RESULT:    (arrived / not arrived / arrived twice / missing PDF / wrong address…)
SEVERITY:        FIX FIRST / NON-BLOCKING
```

---

*This runbook describes the behavior of the build named at the top. If staging behaves differently from an EXPECTED line, that's a finding: report it, don't adjust the expectation.*
