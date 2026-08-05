# Status Architecture — three dimensions, not one state machine

**Owner:** Team Alpha · **Shipped:** canonical identity / routes / navigation sprint
**Code:** `src/constants/statusModel.js` · **Tests:** `src/test/statusModel.test.js`

---

## The decision

A contact carries **three independent status fields**. They are not collapsed
and must not be collapsed.

```javascript
{
  record_status:       "active",          // suggested | active | archived | rejected
  relationship_status: "awaiting_reply",  // new | engaged | awaiting_reply | in_conversation | customer | dormant
  stage:               "hunter"           // scout | hunter | sniper | basecamp | reinforcements | fallback
}
```

| Dimension | Question it answers | Who moves it |
|---|---|---|
| `record_status` | Does this row count? | Discovery, the user accepting/rejecting, archival |
| `relationship_status` | Where is the human relationship? | Engagement actions, replies, outcomes |
| `stage` | Which module owns the work? | Stage transitions, module moves |

They move independently. An `archived` record can have been a `customer`. A
contact in `sniper` can be `awaiting_reply`. Any single field expressing all
three would have to enumerate their cross product — which is what produced the
contradictions the foundation audit found (I-03): a contact simultaneously
`status: 'suggested'` and `contact_status: 'Engaged'`.

Under the three-dimension model that pair is no longer a contradiction. It
says: a suggested record whose relationship has been engaged. Both true.

---

## What was there before

| Legacy field | What it actually meant | Replaced by |
|---|---|---|
| `status` | Discovery/enrichment lifecycle, mixed with archival | `record_status` |
| `contact_status` | Behavioural state machine (Title Case) | `relationship_status` |
| `is_archived` | Soft delete — **and eight read paths filter on it** | `record_status === 'archived'` |
| `lead_status` | Sales pipeline — *unrelated, untouched* | — |
| `stage` | Module ownership — *already correct* | `stage` (validated) |

---

## Compatibility reads — the only safe way to read status

**Never read `contact.status`, `contact.contact_status` or
`contact.is_archived` directly.** Every record in production predates this
sprint and has none of the new fields; records written today have both. Only
the readers in `statusModel.js` know how to reconcile that.

```javascript
import { readRecordStatus, readRelationshipStatus, readStage } from '../constants/statusModel';

readRecordStatus(contact)        // → 'suggested' | 'active' | 'archived' | 'rejected'
readRelationshipStatus(contact)  // → 'new' | 'engaged' | ... | 'dormant'
readStage(contact)               // → 'scout' | 'hunter' | ...
readStatusTriple(contact)        // → all three
isActiveRecord(contact)          // → active or suggested
```

### Precedence

**`readRecordStatus`** — new field → `is_archived === true` → legacy `status`
vocabulary → **default `active`**.

**`readRelationshipStatus`** — new field → legacy `contact_status` map →
`person_type` → **default `new`**.

**`readStage`** — validated `stage` → `person_type` → **default `scout`**.

### Legacy value mappings

`status` → `record_status`

| Legacy | New | Note |
|---|---|---|
| `suggested` | `suggested` | |
| `active`, `saved`, `accepted` | `active` | |
| `archived`, `people_mode_archived` | `archived` | |
| `rejected` | `rejected` | |
| `pending_enrichment`, `enrichment_failed`, `connected`, … | *falls through* | Enrichment lifecycle — says nothing about whether the row counts |

`contact_status` → `relationship_status`

| Legacy | New | Note |
|---|---|---|
| `New` | `new` | |
| `Engaged` | `engaged` | |
| `Awaiting Reply` | `awaiting_reply` | |
| `In Conversation` | `in_conversation` | |
| `Active Customer` | `customer` | |
| `Past Customer`, `Dormant` | `dormant` | |
| `In Campaign`, `Active Mission`, `Mission Complete` | `awaiting_reply` | All three mean "reached out, waiting". None mean `engaged`, which now means *opened the engage module without sending* |
| `Network`, `Partner` | `engaged` | `person_type` values that leaked into the status field. They describe a relationship KIND, not its state |

---

## Records with neither field

**This is the largest population, and the defaults are a product decision, not
an implementation detail.**

| Population | How it arose | Treated as |
|---|---|---|
| Contacts with no `is_archived` at all | Every Scout write path omitted it until PR #510 | `record_status: 'active'` |
| Contacts with no `contact_status` | The Apollo import paths never wrote one | `relationship_status: 'new'` |
| Contacts with no `stage` | Stage postdates most of the collection | `stage: 'scout'` |

`record_status` defaults to **`active`, not `suggested`**, and that choice is
load-bearing. A record with no archival signal is one the user saved and never
dismissed. Defaulting to `suggested` would hide thousands of historical
contacts from every view that filters for active records — the same class of
disappearance the missing `is_archived` field already caused once.

---

## Writing status

```javascript
import { createStatusFields, RECORD_STATUS, STAGE } from '../constants/statusModel';

const doc = {
  ...createStatusFields({ recordStatus: RECORD_STATUS.SUGGESTED, stage: STAGE.SCOUT }),
  // …the rest of the document
};
```

`createStatusFields`:

- writes all three dimensions **explicitly**;
- **also writes `is_archived`**, because eight read paths still filter on it and
  dropping it would break all of them on the day this shipped;
- **throws** on a value outside the vocabulary rather than passing it through —
  same reasoning as `createCompanyRecord` rejecting `status: 'active'`: a
  document written with a value nothing queries for is invisible to every
  reader, and invisible is far more expensive to diagnose than a thrown error.

Write paths get this automatically via `prepareContactWrite()`
(`src/services/contactWriteGuard.js`), whose `fields` include the status triple.

---

## What this sprint did NOT do

- **No historical migration.** Not one existing document was rewritten.
- **No field deletion.** `status`, `contact_status` and `is_archived` all remain
  and are all still written.
- **No read-path rewrite.** Consumers that read the old fields keep working
  because the old fields are still there. Moving them to the compatibility
  readers is incremental and can happen per-consumer.

The old fields stay until every consumer reads through `statusModel.js` and a
backfill has run. Removing them is its own sprint with its own rollback plan.

---

## Rollback

**The whole dimension model:** revert `src/constants/statusModel.js` and the
`createStatusFields` spread in `contactWriteGuard.js`. Documents written in the
interim carry three extra fields that nothing reads. No data loss — the legacy
fields were written the entire time, so every reader that existed before this
sprint keeps working unchanged.

**Just the new fields on a document:** they are additive. Deleting
`record_status` / `relationship_status` from a document returns it to exactly
the state a pre-sprint write would have produced, because `is_archived`,
`status` and `contact_status` were never stopped.

There is no state in which a rollback loses information: this sprint only ever
**added** fields to contact documents.
