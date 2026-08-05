# Platform principles

Short list. Each one exists because breaking it produced a defect that was
invisible in code review.

---

## Discovery enriches. It never replaces.

**Canonical statement in code:** the header of
`src/services/contactIdentityService.js`.

A record already in the workspace is the product of decisions someone made: a
name they corrected, a company they picked, a stage they moved, three months of
timeline, and everything Barry has learned about the relationship.

A newly discovered record is a fresh observation from an external source that
has never met the user.

When the two describe the same person, **the observation is evidence, not an
update.** It contributes what the record does not have. It does not get to
overrule what the record already knows.

### What follows from it

| Rule | Where it lives |
|---|---|
| A match **merges** rather than skips — the old checks threw away the identifier the record was missing, which is why the *next* import created the duplicate | `mergeIdentifiers()` |
| Identifiers accrete; canonical fields do not. A Gmail header saying the name is "j.doe" never overwrites "Jane Doe" | `CANONICAL_FIELDS` |
| A field being **absent** is the only reason a merge may fill it in | `mergeIdentifiers()` |
| Counts count **creations**, not attempts — `contact_count` used to increment by the selection size and double-counted every resolved match | `CompanyDetail`, `CompanyDetailModal` |
| A **weak** signal never merges at all. Name + company means two records *might* be one person; acting on it destroys one of them | hierarchy step 6 |
| **Preview does not write.** Looking at an unaccepted discovery record must not mutate it or spend an enrichment credit on it | `CompanyDetail` preview mode |
| Merging is **reported before it is performed** — the dedup script has no write path | `scripts/detectDuplicateContacts.mjs` |

### The failure it avoids

The opposite policy — last writer wins — is the one that feels obvious. It is
invisible in review, produces no error, and the user discovers it months later
when a contact they curated has been flattened back into whatever Apollo last
returned.

---

## One destination per record, reached one way.

**Canonical statement in code:** the header of `src/utils/navigation.js`.

`/contact/:contactId` and `/company/:companyId` are the only destinations, and
`openContact()` / `openCompany()` are the only way to reach them.

A module that navigated wrongly used to look exactly like a module that
navigated correctly, because both were a string. Now a bypass reintroduces a
raw path, and that is visible in a diff.

Two display modes — page and panel — are two presentations of **one**
implementation: same loader, same actions, same Barry context, same timeline.
A second contact destination is not a feature; it is the bug this replaced.

Corollary: because the helpers are the single entry point, they are also the
single place product analytics can be emitted from with full coverage. Contracts
that are genuinely singular pay for themselves twice.

---

## Navigation intent is ephemeral. Outcomes are persisted.

**Canonical statement in code:** `src/utils/navigation.js`, "NAVIGATION INTENT
IS EPHEMERAL".

The reason a screen opened travels in router state and dies there. What gets
written to the record is the **action the user took and its outcome**.

A contact document that remembered "someone once opened me because a follow-up
was overdue" would accumulate other people's context forever, and every future
reader would have to guess which of those reasons was still true.

---

## Status has dimensions, not values.

**Canonical statement in code:** the header of `src/constants/statusModel.js`.

`record_status`, `relationship_status` and `stage` answer three different
questions and move independently. An archived record can have been a customer.

Adding a value to an existing enum to express a new *kind* of thing is how the
contradictions started — a contact that was `status: 'suggested'` and
`contact_status: 'Engaged'` at the same time. Before adding a status value, ask
whether it is a new value or a new question.

---

## A guarantee that cannot be checked is not a guarantee.

Three of this codebase's worst defects were **omissions** — a missing
`is_archived`, a dedup query on the wrong field name, a Sniper record with no
link home. None threw. None failed a test. All of them looked, in review,
exactly like nothing.

So each guarantee has a mechanical check:

| Guarantee | Check |
|---|---|
| Contact writes carry `is_archived` | `src/test/contactCompanyWriteFields.test.js` |
| Contact writes run identity resolution | `scripts/verifyWritePaths.mjs` |
| Company writes carry `apollo_organization_id` | `scripts/verifyWritePaths.mjs` |
| Sniper writes carry `canonical_contact_id` | `scripts/verifyWritePaths.mjs` |

And each check is itself verified against a deliberate regression before being
trusted — a guard that has quietly stopped guarding is worse than no guard,
because it is also a claim.
