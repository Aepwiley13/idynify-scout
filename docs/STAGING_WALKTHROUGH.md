# Staging walkthrough — canonical identity, routes & navigation

**PR:** #511 · **Branch:** `claude/canonical-identity-routes-nav-yhcoq2`
**Gate:** all eight flows pass → merge.

Eight flows. Six verify that behaviour changed correctly or did not change at
all; **Flow 7 verifies a data guarantee and is the highest-risk item in the
PR** — it is the only one where a failure corrupts records rather than
inconveniencing a user. Flow 8 was added after staging found a regression.

Automated coverage exists for the *logic* behind most of these
(`src/test/canonicalRoutes.test.jsx` asserts Flow 1 clause by clause, including
a Scout mount count of zero). None of it substitutes for a live workspace with
real data, real auth and Barry actually responding.

---

## Flow 1 — Mission Control priority → contact

1. Open Mission Control. Find a priority card naming a contact.
2. Click its action button.

| Check | Expected |
|---|---|
| URL | `/contact/:contactId` — **not** `/scout/contact/...` |
| Underneath | No Scout list, no Daily Leads, nothing from Scout visible |
| Breadcrumb | **Mission Control** ▸ contact name |
| Arrival banner | "Surfaced by Mission Control", the overdue reason, and the recommended action |
| Banner action button | Opens the engagement flow (same one the page's own Engage uses) |
| Back | Returns to `/mission-control-v2` |

**Fails if:** breadcrumb reads Scout, any Scout chrome is visible, or Back lands
anywhere but Mission Control.

---

## Flow 2 — Scout panel-over-list (must be unchanged)

1. Open Scout. Apply a filter, sort, and scroll partway down the list.
2. Click a contact.

| Check | Expected |
|---|---|
| Presentation | Panel **over** the list, list still visible behind |
| URL | `/scout/contact/:contactId` — this route is intentionally retained |
| Filters / sort / scroll | All intact behind the panel |
| Escape | Closes the panel, returns to the list in the same state |
| Focus after close | Returns to the **row you clicked**, not the top of the list |
| Tab from the row | Reaches the panel's controls in order |

**Fails if:** the list rebuilds, filters reset, or focus jumps to the document
top. This is the "golden path" the audit confirmed working — a regression here
is worse than a missing feature.

---

## Flow 3 — Hunter contact (must be unchanged)

1. Open Hunter → Dashboard. Click a contact name in an attention item.

| Check | Expected |
|---|---|
| Destination | Same as before this PR — Scout panel at `/scout/contact/:id` |
| Everything else | Identical to previous behaviour |

**This flow is deliberately unchanged.** Hunter now routes through
`openContact()` with `displayMode: 'panel'`, which produces the exact path it
always used. Moving Hunter to the canonical page is a deferred entry-point
update. **Verify no regression, not new behaviour.**

---

## Flow 4 — Command Bar from Hunter

1. Open Hunter. Press ⌘K. Search a contact. Open the result.

| Check | Expected |
|---|---|
| URL | `/contact/:contactId` |
| Underneath | Application does **not** switch to Scout |
| Breadcrumb | **Hunter** — Command Bar has no module of its own, so origin comes from `returnTo` |
| Back | Returns to Hunter, not to Scout |

Repeat once for a company result → `/company/:companyId`.

**Fails if:** the app switches to Scout underneath, or the breadcrumb reads
Scout or Command Bar.

---

## Flow 5 — Company preview: no auto-writes

**Have the Firestore console open on the company document before you click.**

1. Find a company with `status: 'pending'` (a discovery record).
2. Note its current fields — specifically `selected_titles`,
   `titles_updated_at`, `titles_source`, `apolloEnrichment`, `apolloEnrichedAt`.
3. Open it at `/company/:companyId`.
4. **Re-read the document in the console.**

| Check | Expected |
|---|---|
| Preview banner | Present, amber, "not yet in your pipeline", with match reasons / fit score if the record has them |
| Firestore, after opening | **Byte-identical.** No `selected_titles`, no `titles_updated_at`, no `titles_source`, no `apolloEnrichment`, no `apolloEnrichedAt` |
| Approve & Save | `status` → `accepted`, `approvedAt` set, `approved_from: 'company_detail_preview'` |
| After Approve | Same screen, no navigation, banner gone, saved behaviour available |

**This is the only assertion about a write that must NOT happen, and that is
exactly the kind that fails quietly.** Do not skip the before/after comparison
in the console.

---

## Flow 6 — Barry continuity across origins

1. Open a contact **from Mission Control**. Open Barry. Note that it knows the
   person (does not ask who they are).
2. Go back. Open the **same contact from Scout**.

| Check | Expected |
|---|---|
| Memory, both times | Loads — Barry does not re-ask what it already knows |
| `barry_session_key.entityId` | Same contact ID both times |
| `barry_session_key.sessionType` | **Differs** — `follow_up` from Mission Control, `general` from Scout |
| Console | `[analytics] open_contact` logged with the correct `entryPoint` each time |

**Note:** the session key is *produced and carried*, not yet consumed —
rekeying conversations is the next sprint. What is being verified here is that
the key is correct and memory loads, not that two separate threads exist yet.

---

## Flow 7 — Duplicate prevention *(highest risk — verify with real data)*

**This is the one that matters most.** It is the only flow where a failure
writes bad data rather than showing the wrong screen, and the only one that
exercises the identity resolver end-to-end against a real Firestore.

1. **Create a contact manually** via Scout+ → Add Contact → manual form. Give it
   a name, an email, and a company. Note the resulting document ID.
2. Give it some history — open it, start an engagement, leave a note. Anything
   that writes a timeline entry.
3. **Import the same person again through a different path.** Either:
   - **LinkedIn:** Scout+ → LinkedIn Link, with that person's profile URL; or
   - **CSV:** upload a one-row CSV with the same email, plus a phone or
     LinkedIn URL the manual record does **not** have.
4. Inspect the workspace.

| Check | Expected |
|---|---|
| Contact count | **One** record for this person. No second document. |
| The record | The **original** document ID — the one from step 1 |
| Identifiers | New ones **attached**: `linkedin_url` / `apollo_person_id` / `phone` from the second import, plus their `*_normalized` forms |
| Canonical fields | **Unchanged** — name, company, stage exactly as you set them in step 1 |
| Timeline | Intact. Step 2's history still there |
| UI feedback | Told you the person was already in the pipeline and that details were added — not a silent no-op, not an error |
| Console | `[contact-identity] matched existing contact on email` (or `linkedin_url`) |

**Then repeat with mixed case.** Manually create `Test.Person@Example.com`, then
import `test.person@example.com`. Still one record.

**Fails if:** two documents exist, the original's name or company was
overwritten, the timeline is gone, or the second import silently did nothing
without saying so.

This is the flow that proves **discovery enriches, it never replaces**
(`docs/PLATFORM_PRINCIPLES.md`) against real data rather than a mock.

---

## Flow 8 — Scout+ "Go to Lead" *(regression, found in staging)*

1. Scout+ → Add Contact → manual form. Save one contact.
2. On the success screen, click **Go to Lead**.

| Check | Expected |
|---|---|
| URL | `/contact/:contactId` |
| What you see | The contact you just saved. **No Daily Lead Insights, no Scout list behind it** |
| Breadcrumb | **Scout** ▸ contact name |
| Back | Returns to `/scout?tab=scout-plus` |

Repeat via **LinkedIn Link**, which auto-navigates on save without the success
screen — same expectations.

**What was wrong:** the button used panel display mode, which routes under
`/scout` and mounts ScoutMain on its default tab. **Fails if** you land on
Daily Lead Insights, or Back goes to the homepage.

---

## Optional — duplicate baseline

Before or after the walkthrough, capture the pre-existing duplicate count. This
is the input to the dedup sprint and costs nothing:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
node scripts/detectDuplicateContacts.mjs --user-id=<your-uid>
```

Read-only. No write path exists in that script.

---

## Result

| Flow | Pass / Fail | Notes |
|---|---|---|
| 1 — Mission Control → contact | | |
| 2 — Scout panel unchanged | | |
| 3 — Hunter unchanged | | |
| 4 — Command Bar from Hunter | | |
| 5 — Company preview, no writes | | |
| 6 — Barry continuity | | |
| 7 — Duplicate prevention | | |
| 8 — Scout+ "Go to Lead" (regression) | | |

All eight pass → merge PR #511.
Any failure → report it; the rollback for each change is documented in
`docs/CANONICAL_NAVIGATION.md`, `docs/STATUS_ARCHITECTURE.md` and
`docs/SNIPER_MIGRATION.md`.
