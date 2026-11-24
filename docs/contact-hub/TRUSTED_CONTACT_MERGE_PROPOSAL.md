# Trusted contact merge contract for approval

Phase 1 remains a local simulation. This contract proposes an owner-initiated
write path for one pair at a time, available to Free and Scout with the same
deterministic checks. It makes no AI, enrichment or provider calls to prepare
a merge. The write path, schema and rule changes require approval.

## Preview, confirmation and outcomes

| Action | Request | Result |
| --- | --- | --- |
| `preview` | Unordered pair of contact IDs, chosen survivor ID and explicit choices keyed by conflict ID | Server-verified comparison, inventory and transfer plan. Reports per-side versions, evidence, conflicts, per-record actions, retained and blocked references, counts, limits and rollback eligibility. As yet unresolved choices produce no confirmation token. |
| `commit` | Pair, survivor, same choices, generated UUID operation ID and unexpired preview token | One atomic commit or a typed failure without a partial transfer. Return a receipt and survivor ID. Replaying the same operation with the same request returns the original receipt. |
| `status` | Operation ID | Owner-only result for reconciliation after a timeout. |
| `preview_rollback` | Operation ID | Verifies eligibility and signs the exact inverse plan without writing. |
| `rollback` | Operation ID and explicit confirmation against a fresh rollback preview | One atomic inverse commit or a typed conflict. Repeated matching requests return the original rollback receipt. Available only while the rollback constraints below hold. |

The trusted service derives UID from a revocation-checked Firebase token and
checks the persisted owner and authoritative impersonation session. Custom
sessions and read-only viewers cannot request or confirm the trusted plan.
Every contact or dependency must belong to that owner, except shared
reference definitions that are read only. Both IDs must be distinct, current,
active and merge-eligible. Preserve the chosen survivor's ID. Match evidence
never chooses a survivor or authorizes consolidation.

The preview performs reads only. Resolve canonical field choices as
`survivor` or `source`. Use stable normalized fact IDs for primary channels.
Use explicit inventory IDs for photo and reminder selection. Reject missing
choices, stale candidates, ambiguous references and unsupported record types.
Reject mismatched authoritative identities when the service cannot verify
that both records describe one person. Never offer force merge for that case.
For the resolved preview, return a server-signed token with a 10-minute expiry.
Bind UID, both IDs, chosen survivor, canonical choices, contact versions,
the exact dependency inventory digest and the plan version. Exclude payloads,
credentials, and contact field values from the token. Display the plan before
the user confirms. Any version, membership or eligibility change produces a
fresh preview requirement.

## Supported transfers and explicit decisions

| Area | Contract |
| --- | --- |
| Canonical fields | Fill blanks. Keep equivalent values. Require a choice on differing nonempty names, titles, locations, addresses, primary company and other supported canonical fields. Preserve losing values in owner-only provenance with origin, timestamp and source. Unknown material fields block a merge until classified. |
| Emails and phones | Union all validated existing facts, retaining labels and sources, with explicit primary choices when the existing primaries differ. Normalize emails with existing normalization and phones with existing number parsing plus extension. Collapse only equivalent facts. Keep conflicting labels as provenance. Primary email must agree with the saved-recipient accessor and storage mirrors. Call selection currently prefers phone labels. Introduce an explicit primary phone reference and update the shared accessor before honoring primary-phone choices. Keep labels and copy legacy mirrors through the existing writers. |
| Notes and Activity | Union embedded notes and copy complete supported timeline documents with original authors, timestamps and origin IDs. Keep distinct rows even if text matches. Preserve IDs where available and deterministically remap collisions using the operation and original path. Mark imported rows with their source so cross-surface queries can avoid counting a retired record twice. |
| Stickers | Union authoritative sticker IDs. Preserve each assignment's actor and time and both origins when the same sticker appears twice. Keep the active set within the limit of 50. If necessary, ask which stickers are active and retain overflow in merge provenance. Preserve sticker definitions and existing unrelated assignments. |
| Reminders | Require a choice when both contacts have active reminders. Retarget the selected reminder and its verified queue record while preserving due date, actor and ID. Close the other as superseded with preserved details and history. Preserve completed items. Block protected legacy steps or any queue state whose transitions cannot be verified. |
| Photos | Explicitly choose one independent display state from the available options: original, private upload, private URL, or hidden. Retain both original source records and unselected variants in restricted provenance. Preserve exact JPEG bytes under existing trusted validation and size limits. Update the selected private override and parent marker together. Never reveal a hidden original through fallback. Until the approved private provenance and purge paths are in place, any pair needing photo transfer is ineligible. |
| Companies | Select one current company reference explicitly if both differ. Retain the other relationship and provenance as historical. Repoint verified contact-specific edges only. Keep shared company documents and IDs intact. |
| LinkedIn, external IDs and source records | Union supported aliases only when they resolve to the verified same identity. Retain external namespace, original ID and origin, including imports and provider identifiers. Block conflicting authoritative IDs and mappings that other system owners have not approved. Never rewrite provider records. |
| Gmail and other email activity | Carry Activity events with original message IDs and origin. Leave mailbox items, token records, OAuth exceptions, send ledger and rate-limit records in their original scope. Treat unresolved deliveries as blocking. Existing Contact Hub attempts store a fingerprint and status but lack a queryable contact ID. Until attempts can be safely attributed, block if any unresolved account attempt could relate to either contact. Never retry, retarget or replay a provider send as part of a merge. |
| Permissions and opt-outs | Preserve restrictions by normalized address, provider and origin. Suppression wins. Verification status is not consent. Unknown or conflicting authority cannot authorize a send. Block execution if downstream send paths cannot preserve these restrictions. |
| Pending Scout and Barry work | Inventory both contacts' active claims, queues, drafts, scheduled outreach, reference edges and any pending jobs. Require active provider operations to settle and unknown outcomes to be reconciled. Keep old outbound intents suppressed and bound to their original contact and address. Transfer only explicitly supported non-outbound work. Block unknown dependencies, active claims and unsupported transfers. |

## Atomicity, retirement and rollback

- Start with a bounded atomic MVP. Reject a plan if it needs more than 300
  document mutations including the receipt and recovery copies, if any
  replacement document exceeds 256 KiB, or if the conservative encoded
  transaction estimate exceeds 4 MiB. Treat these as application caps below
  platform limits and verify index overhead and emulator behavior. Oversized
  plans require a different design and separate approval.
- Proposed server-only paths are `contact_hub_merges/{uid}/operations/{operationId}`
  for the receipt and `…/operations/{operationId}/recovery/{pathHash}` for
  recovery copies. Keep writable lifecycle state on the parent contact so
  existing writes can be made to check it. Store the retirement marker at
  `contact_hub_retired/{uid}/contacts/{sourceId}`. All access to these
  server-only documents requires explicit trusted code or denial by rules.
- Use the account-scoped merge receipt keyed by operation ID.
  In the commit transaction reauthorize, reread both contacts and every
  inventoried dependency, recheck membership and digest, then apply all
  mutations and retirement together. Read the operation before writes.
  Reusing the ID with a different request returns `409 operation_conflict`.
  A stale digest returns `409 preview_changed`. Eligibility failures return
  structured blockers. On contention or a lost response, look up status and
  retry the same operation ID with identical inputs. If it failed to commit
  and the preview expired, discard that attempt and prepare a new plan.
- Before release, client rules and all participating Admin writers must
  respect retirement and the same contact lifecycle fence. Reservations for
  provider work must read the contact and record a queryable claim in their
  transaction. The merge transaction reads those claims to arbitrate a race.
  A pre-send snapshot check alone is insufficient. A concurrent ordinary
  deletion must read the same contact state and reject retired or fenced
  records. Keep merges disabled for any path without these guarantees.
- Use a permanent, server-owned retirement marker keyed by owner and source ID.
  Keep the source record frozen and excluded from ordinary lists, search,
  identity matching and active queues. A minimal marker records
  `merged_into`, operation ID and timestamp. A trusted, owner-only resolver
  may redirect a historical person link to the surviving profile. Permit
  only bounded, cycle-checked same-owner chains. Workers reject retired
  IDs and never follow redirects. Prevent client and Admin creation under a
  retired ID. A retired contact is distinct from the ordinary deletion
  marker and cannot be retired by calling Delete.
- Retain private before-images of touched survivor and dependency records,
  plus an exact list of created paths and post-commit versions. Proposed
  rollback window: **7 days**. Keep recovery payloads server-only and out of
  indexes. To roll back, verify the current versions and that no new reference,
  transition, or external side effect depends on the merged state. Restore the
  originals, remove only operation-created copies and release retirement in one
  transaction. If anything changed, refuse automatic rollback and require a
  separately reviewed recovery plan. Never rewrite provider history.
- A failed transaction leaves neither partial copies nor a retired contact.
  If the receipt exists, the merge committed. An inventory that cannot
  fit the atomic model is blocked. Purge recovery copies after the rollback
  window under the approved retention policy. Include receipts, markers,
  archived provenance, dismissals and recovery data in account cleanup.
  Final retention of frozen source data requires approval before activation.

## Persistent false-match dismissals

Use a separate owner-only dismissal collection,
`users/{uid}/contact_duplicate_dismissals/{pairKey}`. Use the SHA-256 hash
of the canonical sorted pair of IDs as the document key. Store only the
pair IDs, fingerprint version, current identity-evidence fingerprint and
dismissal/update times. Protect read/list/write access with explicit
default-deny client rules and an owner-authenticated service using the
same authoritative session checks. No account-global or cross-account
dismissals. Refresh and a later sign-in to the same account reuse the saved
state. Fetch dismissals once per loaded account and update the local
list after an explicit action. Restore deletes the exact owner-scoped
record. A repeated dismiss or restore is idempotent.

Fingerprint the two records' normalized name, organization/relationship
identity, all usable email addresses, person-level phone identities, LinkedIn
and external person IDs, associated with their respective record IDs. Include
the evidence schema version. Store a server-keyed HMAC of the normalized
projection rather than the raw fields. Provide a read-only evaluation endpoint
that pages the owner's dismissals and compares them against current contacts.
Resolve only candidate pairs that have a stored dismissal and batch those
reads. A changed relevant identity or fingerprint version puts the pair
back in review if it still matches. Case and formatting equivalents do not
reopen the pair. Title, notes, activity, reminders, sticker and photo edits
do not reopen it. Exclude stale dismissals from suppression immediately.
Purge orphaned dismissals on account removal and under an approved retention
policy. This feature can be approved independently of merge writes.

## Release verification

With synthetic Free and Scout contacts, verify preview produces no writes,
explicit survivor and conflict choices, account and impersonation denial,
identity changes invalidating a plan, all supported transfers and blockers,
merge/delete races, late worker rejection, recipient and opt-out preservation,
lost responses and idempotency, atomic limits and clean rollback refusal
after either contact changes. Demonstrate that historical links resolve only
for the owner and that a worker cannot use the redirect. Staging rules, worker
coverage and feature-gate activation require separate approval.
