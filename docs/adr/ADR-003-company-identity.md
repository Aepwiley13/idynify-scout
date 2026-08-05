# ADR-003 — Company identity

**Status:** Accepted · 2026-08 · Canonical identity, routes & navigation sprint

---

## Decision

The **Firestore document ID** in `users/{uid}/companies/{companyId}` is the
canonical identifier for an organization.

**`apollo_organization_id` is the standard field** for Apollo's organization ID.
`apollo_id` continues to be written as a compatibility alias from the same
value, and lookups check both. Every company creation path runs
`companyIdentityService.resolveCompany()` first.

**Preview mode is a permissions decision, not a storage one.** A discovery
company with `status: 'pending'` opens in `CompanyDetail` without being
accepted, and opening it writes nothing. Approve flips status in place; the same
screen becomes the saved experience.

## Reason

Apollo's organization ID was written under two names — `apollo_organization_id`
by Scout discovery and manual search, `apollo_id` by the LinkedIn and
contact-search paths — and **each path's dedup query was correct about its own
field and blind to the other**. A company discovered through Scout and
re-encountered through a LinkedIn import produced two documents for one
organization, each with its own `contact_count`, its own `status` and half the
contacts. Nothing errored. The company simply appeared twice.

Removing `apollo_id` outright would break the readers that have not moved
(`SharedCompaniesView`, `DailyLeads`, several netlify functions). Writing both
from one value makes the alias a mirror rather than a second source of truth.

On preview: "unsaved" reads like a storage question and is not one. These
records are Firestore documents from the moment `search-companies.js` writes
them — what they are not is **kept**. `status: 'pending'` means the user has not
said yes, and until they do, looking at a record must not change it. Two
side effects violated that: ICP title persistence and auto-enrichment both fired
on load, mutating a record the user might be about to reject and spending an
Apollo credit on it. Preview is the permission boundary that says *looking is
not deciding*.

## Consequences

- New company writes spread `apolloIdFields(orgId)`, which emits both names.
  Hand-writing `apollo_id` alone now fails `scripts/verifyWritePaths.mjs`.
- `resolveCompany()` queries both fields in parallel, so a workspace predating
  this sprint is deduped correctly whichever name its documents carry.
- Companies with no Apollo ID (business cards, CSV rows, manual adds) resolve on
  **exact name**. Deliberately exact: "Acme" and "Acme Corp" are not provably
  the same organization, and prefix matching would fold subsidiaries into
  parents.
- In preview, `CompanyDetail` skips the title-persistence write and the
  enrichment call. Both resume after Approve.
- `apollo_id` cannot be removed until every reader moves. That is a follow-on,
  and the alias is load-bearing until then.
- Company lifecycle stays `pending → accepted → archived` (+ `rejected`).
  Expanding it is deferred — see the sprint order in the PR.

**Verified by:** `scripts/verifyWritePaths.mjs` (company write rules),
`src/test/contactCompanyWriteFields.test.js` (`status` guarantee). Preview's
no-write behaviour is the one claim requiring human verification against the
Firestore console — Flow 5 of `docs/STAGING_WALKTHROUGH.md`.
