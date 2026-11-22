# Trusted contact merge proposal

This write path requires separate approval. Phase 1 exposes only an
account-scoped comparison and a simulated combined preview of the loaded
My People contact fields.

## Execution contract

1. An owner-authenticated trusted endpoint accepts a survivor and source ID,
   both current revisions, an operation ID, and explicit conflict choices.
   Recheck account and active impersonation state server-side. Prepare a
   bounded dry run listing transfer counts, address restrictions, limits,
   pending jobs and unresolved dependencies. Require explicit confirmation
   of that exact plan.
2. On confirmation, transactionally acquire an operation fence on both
   records. Any later writer must respect it and use a fresh revision.
   Queue processors must hold or suppress work tied to either contact until
   completion. A send already underway must settle or remain unresolved
   before proceeding. An outbound intent never follows an alias.
3. Transfer approved data with deterministic, idempotent IDs. Check the
   operation version and checkpoints on every retry. Validate the resulting
   ownership, counts and provenance before publishing a scoped inbound
   redirect and retiring the source. Preserve a minimal audit receipt and a
   product-approved recovery window. Keep ordinary Delete separate from
   merge retirement.

## Records and decisions

| Area | Required transfer or decision |
| --- | --- |
| Contact fields | Union email and phone facts, preserve labels and sources, and apply explicit primary-field choices. LinkedIn and external person ID disagreements require identity review. Retain immutable importer/source references. |
| Companies and stickers | Preserve approved company associations without rewriting shared company records. Union sticker IDs and preserve assignment provenance. Require choices if the sticker maximum would be exceeded. |
| Notes and Activity | Preserve authors, times and sources. Remap colliding IDs deterministically. Load and check the full contact subcollections, including Gmail activity, before approval. Preserve send records and deduplication keys in their original scope. |
| Reminders and photos | Choose a single active reminder and safely reconcile both queue entries. Preserve historical reminders. Capture both original photo sources and the selected override or hidden state. Private payload transfer requires an approved storage and provenance policy. |
| Email permissions | Confirm address- and provider-specific opt-outs and suppression from the authoritative systems. Missing or conflicting evidence leaves sending eligibility unresolved. |
| Pending and external references | Inventory Scout activity, provider records, reminders, imports and other contact-specific references. Transfer only explicitly supported references. Stop on unresolved ownership, permissions, pending send outcomes, record limits or an unknown reference type. |

Phase 1 uses the loaded contact snapshot. It shows embedded notes, available
contact facts, photo markers, and known local indicators. It does not load
private photo bytes, full Activity or Gmail history, reminder queue details,
external source documents, or authoritative consent records. The preview
therefore cannot authorize a transfer or an outbound send.
