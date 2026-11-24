# Contact Hub duplicate-management audit

## Utah Advocacy Hub

The public [Utah Advocacy Hub](https://hub.utahadvocacy.org/) returned HTTP
200 and its served frontend identifies the separate `utadco-hub` Firebase
project. This review used public HTML source only. No Firestore data or
Constant Contact account was queried or changed. The
[historical integration audit](../audits/CONTACT_HUB_INTEGRATION_AUDIT.md)
records the source snapshot, frontend PR, uncertainty about deployment
provenance, and historical sticker collisions. The public source confirms
behavior independently of PR or Netlify status.

| Capability | What the public Utah source does |
| --- | --- |
| Prevention | Manual entry checks existing email and prompts on a name match. CSV matches any stored email or exact normalized name plus phone. Its preview compares against the existing list and does not track new rows against one another. A shared household or organization phone can produce an incorrect match. |
| Add information | The import adds alternate emails, phones and stickers and fills empty phone, organization and notes fields. A populated note does not receive the incoming note. |
| Detect existing duplicates | The cleanup groups exact normalized primary email only. Secondary emails, missing email and cross-signal clusters are outside this operation. |
| Review | The CSV fuzzy-name flow offers merge, add new, or skip. The existing-record cleanup chooses a keeper by a count of populated fields and offers no per-field review. |
| Consolidate records | Cleanup copies sticker IDs and activity plus missing phone or organization, then hard-deletes the losers. The operation does not transfer losing notes, secondary addresses and phones, external IDs, photo or email consent. Historical sticker IDs can refer to inconsistent membership. This behavior is unsuitable for IDYNIFY. |

## Existing IDYNIFY building blocks

| Capability | Reuse and limits |
| --- | --- |
| Prevention | `contactIdentityService`, `contactWriteGuard` and `identityResolution` handle owner-scoped identity resolution, exact-signal conflicts and weak-match review. CSV separately catches within-file duplicates. An exact identifier shared by multiple contacts is a refusal, never an automatic picker. |
| Add information | `mergeIdentifiers` and the CSV commit path add normalized identifiers, provenance and allowed fill-only fields to one existing record. They protect canonical fields. This is single-record enrichment, with no source-contact retirement or reference migration. |
| Detect existing duplicates | `scripts/detectDuplicateContacts.mjs` is a read-only operator report. Reuse its pure grouping logic after reviewing its signals and removing user-facing reliance on the historical “SAFE” label. Its grouping by individual signal is not a conflict-free transitive clustering algorithm. Shared numbers, conflicting cross-signal associations and email permissions require review. Use one account at a time and keep reports containing identifiers inside authorized storage. |
| Review | CSV already shows matches, issues and held email conflicts. CaptureReview and BarryResolutionPreview provide precedents for review and explicit approval. Identity flags carry candidate IDs, but are not a My People side-by-side review queue or a merge executor. |
| Consolidate records | No approved two-existing-record workflow was found. The new trusted delete action is an erase flow. It must not serve as the merge executor. |

## Smallest safe delivery

1. Add a read-only Possible Duplicates review in My People using one owner's
   existing contact snapshot. Show the reason for each pair, the record
   sources and conflicting values. Treat names and shared numbers as
   suggestions. Strong evidence proposes a pair for review. It does not
   authorize consolidation. Avoid auto-union of transitive groups.
2. Produce a dry-run change plan for one chosen pair. Show prospective
   survivor, source, fields and reference counts, blocked conflicts and
   records that require a choice. Permit leaving the pair alone. Check
   stale inputs, read-only sessions, unrelated contacts and cross-account
   isolation using fixtures. Get approval for the preview and transfer
   contract before adding a write path.
3. After separate approval, use a trusted, audited, idempotent operation
   with versions and a durable merge-specific state. Validate ownership,
   source and survivor revisions and required choices again at execution.
   Fence both records against concurrent user edits and workers. Transfer
   and verify dependent data, publish a scoped source-to-survivor redirect,
   then retire the source. Retain an operation receipt and an approved
   rollback window. Partial transfer stays resumable. Ordinary deletion
   never redirects references or authorizes new writes.

### Transfer and conflict policy for review

- Canonical values require explicit choices on conflict. Union normalized
  secondary identifiers and immutable source records with provenance.
  Preserve provider- or address-specific email consent and suppression
  history. Conflicting or missing consent never grants send permission.
- Preserve both notes and timeline events with original IDs, timestamps,
  authors and provenance. Use deterministic remaps for ID collisions and
  deduplicate only demonstrably identical events. Retain audit references.
- Union sticker memberships using authoritative sticker IDs and assignment
  metadata, flagging the 50-sticker limit for selection. Never infer legacy
  Utah membership from ambiguous IDs.
- Keep one active reminder only after explicit resolution. Transfer the
  matching queue reference, preserve other history, and never reactivate
  losers or completed reminders. Preserve both photo sources and the
  selected photo/hidden state explicitly. Keep private data account-scoped.
- Inventory company links, referral and Scout associations, source/import
  operations and pending queues. Preserve shared companies and denominators.
  Repoint only contact-owned references that are safe to transfer. Drain or
  suppress pending outreach, drafts and background operations under source
  IDs. An alias must not retarget outbound Gmail or Scout operations to a
  different email address. Keep original send intents and their idempotency
  scope, and never replay or guess the outcome of an in-flight provider call.
