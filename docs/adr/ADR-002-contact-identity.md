# ADR-002 — Contact identity

**Status:** Accepted · 2026-08 · Canonical identity, routes & navigation sprint

---

## Decision

The **Firestore document ID** in `users/{uid}/contacts/{contactId}` is the
canonical internal identifier for a person. Nothing supersedes it.

**Email is the primary dedup signal — not the identity.** Before any contact
creation, `contactIdentityService.resolveContact()` runs a fixed hierarchy:

1. Existing Firestore contact ID
2. Normalized email (lowercase, trim)
3. Apollo person ID
4. LinkedIn URL (normalized)
5. Phone (digits)
6. Name + company → **flagged for review, never auto-merged**

A match **merges** identifiers onto the existing record. It does not skip, and
it does not overwrite. Contacts without an email can always be created.

## Reason

Document IDs were non-uniform: composite `{companyId}_{apolloPersonId}` from
Apollo paths, auto-generated from manual ones. The same human entered twice had
two IDs and nothing connected them. Ten write paths each had their own duplicate
check and they disagreed — some matched email exactly as typed, some lowercased,
some checked only the document ID, three checked nothing.

Email is the strongest available signal but is not identity: people change
employers and take an address with them, and people share inboxes. Making it the
identity would have forced a choice between blocking creation for anyone without
one and inventing a synthetic key — both worse than a document ID that already
works.

Steps 1–5 are exact-identifier matches: two records sharing one are the same
person, or the data is wrong in a way fuzzy matching would not fix. Step 6 is
categorically different. "John Smith at Acme" matches a second John Smith at
Acme, and auto-merging destroys one person's history irreversibly. The service
refuses to choose.

Merging rather than skipping follows from **discovery enriches, it never
replaces** (`docs/PLATFORM_PRINCIPLES.md`). The old checks announced "already in
your pipeline" and discarded the LinkedIn URL or Apollo ID the record was
missing — which is precisely why the *next* import created the duplicate
instead.

## Consequences

- Composite IDs stay. They are stable and harmless; the resolver catches what
  they never could.
- Records carry `email_normalized`, `linkedin_url_normalized`,
  `phone_normalized`. Historical records lack them, so resolution falls back to
  a bounded normalizing scan (200 docs, lazily, at most once per resolution) —
  necessary because **Firestore equality is case-sensitive** and
  `Gentry.Moyes@Acme.com` is not matched by a query for the lowercase form.
- Every save normalizes the record it touches, so the backlog fills in without
  a migration.
- Weak matches are created with `identity_review_required` and a candidate list.
  Nothing consumes that flag yet; surfacing it is the dedup sprint's job.
- Merged records accumulate `identity_sources`. Counts must count *creations*,
  not attempts — `contact_count` double-counted resolved matches until this.
- A lookup failure **rethrows**. Treating an unreachable Firestore as "no
  duplicate" would create one.

**Verified by:** `src/test/contactIdentityService.test.js` (30 tests),
`scripts/verifyWritePaths.mjs`. Historical duplicates are counted, never merged,
by `scripts/detectDuplicateContacts.mjs`.
