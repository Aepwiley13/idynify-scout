# ADR-006 — Canonical relationship event

**Status:** Accepted · 2026-08-28 · Barry Gmail integration, Sign-Off A
**Approver:** Product owner (Sign-Off A, 2026-08-28)
**Proposed by:** Engineering — Gate 1/Gate 2 audit, Sign-Off A proposal + D4 resubmission
**Relationship to ADR-002:** Complements it. ADR-002 remains authoritative and is
**not** superseded — it owns *who a person is*; this ADR owns *what happened between
that person and the user*.

---

## Decision

**Historical truth is an immutable event log. Everything else is derived from it.**

Three layers, deriving strictly downward:

1. **Canonical event** — `relationship_events/{userId}__{gmailMessageId}`. Immutable,
   append-only. Asserts "this communication occurred at this time".
2. **Materialized state** — `contact.relationship.*`. A read cache. Droppable and
   fully reconstructible from layer 1.
3. **Legacy compatibility mirrors** — eight existing fields, write-only, for consumers
   not yet migrated.

Prohibited in all cases: legacy → materialized, legacy → canonical, and materialized →
reconstructed event history.

**Event identity.** The document ID is `${idynifyUserId}__${gmailMessageId}`. Exactly-once
creation is enforced by Firestore document-ID uniqueness via `DocumentReference.create()`,
inside a transaction that also performs materialization. Existence is decided *solely* by
the event store — never by a current-state field.

**Confirmed inbound reply event.** All four required: inbound and past all ingestion
filters; identity resolved `MATCHED` on an **exact** signal (never `name_company`); the
`contactId` exists; the thread carries a prior outbound message. A `REVIEW` or `NEW`
identity outcome never creates canonical relationship truth.

**`relationship.reply_count`** is the count of unique canonical `inbound_reply` events —
a set cardinality. Replay does not increment it; previously unseen older events do;
processing order is irrelevant.

**Monotonic materialization.** `last_inbound_at` advances only for a strictly newer
`occurredAt`. An out-of-order or backfilled event is recorded and counted, but never
regresses current state.

**Workflow transitions.** A confirmed canonical inbound reply may perform exactly two,
and only from the stated current value:

- `contact_status`: `Awaiting Reply` → `In Conversation`
- `hunter_status`: `awaiting_reply` → `in_conversation`

No other current value may be changed by this contract.

**One writer, multiple callers.** `netlify/functions/utils/relationshipEventWriter.js` is
the only module that creates events, materializes state, or writes mirrors. Automatic
ingestion, manual Sync Replies, backfill tooling, and Sign-Off D identity corrections all
call it. Barry, React/UI, and admin tooling read `relationship.*` and never write it.

**Identity resolution.** ADR-002 remains authoritative. Gmail resolves senders through
`resolveContactCore()` via `createAdminAdapter()` — the backend pairing already used by
`barryPipelineAction` and `barryResolveSave`. `matchContact()` is retired and deleted, not
adapted. Matcher repair precedes normalization backfill; the backfill is separate,
non-blocking work, because the three `findByEmail` rungs already resolve the full measured
population without it.

**Historical re-evaluation.** Every record in the `requiresReview` population — 979
messages, being 131 `name_company_suggestion` plus 848 `unmatched` — must reach exactly one
terminal classification: `MATCHED`, `REVIEW_REQUIRED`, or `UNMATCHED`. No record may remain
indefinitely in an undefined review state. `REVIEW_REQUIRED` records are excluded from Barry
relationship intelligence and automated recommendation generation until resolved under
Sign-Off D. `UNMATCHED` is terminal with a recorded reason and carries an **implemented and
tested reopen path**: a record is re-evaluated if a Contact matching its sender is later
created.

**Validation gating.** `GMAIL_IDENTITY_MODE` gates every write. It defaults fail-safe to
`dry_run` — unset, empty, or any unrecognized value resolves to `dry_run`, and only the
exact string `live` enables writes.

---

## Reason

Four disagreeing "last activity" contracts existed, and the only automatic Gmail path
wrote to the one namespace no consumer read. Production evidence (Gate 2, 2026-08-28):
978 inbound messages ingested, **zero** matched, **zero** Barry analyses, and nine contacts
still marked follow-up eligible after replying.

An event log rather than a state field, because every alternative collapses under replay.
The sync worker replays its batch after any failure *by design*, so replay is the normal
case. A design where "have I seen this message?" is answered by a current-state snapshot
cannot survive out-of-order delivery: state points at the newest message, and the question
is about an older one.

`last_interaction_at` is deliberately **not** claimed by this contract. It is written both
by Gmail reply detection and by `barryPipelineAction` for calls and meetings; deriving it
from relationship events alone would erase every non-email interaction. "Interaction"
needs a broader event vocabulary than inbound email before it can be made canonical.

`contact_status` and `hunter_status` are likewise not owned here beyond the two approved
transitions. `contact_status` has roughly ten independent writers — CSV upload, manual
entry, business-card capture, pipeline actions, the state machine. Deriving it from reply
events would destroy every non-reply transition.

### Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| State field carries replay protection (D4 v1) | Collapses event truth into state. Fails the out-of-order case: state points at the newest message while the question concerns an older one. |
| Supersede ADR-002 with a Gmail-aware identity contract | Would elevate thread-linkage and prior-record propagation to identity signals. Both answer "which conversation is this?", not "who is this?", and both propagate earlier weak decisions into relationship truth. |
| Adapt `matchContact()` in place (`primaryEmail` → `email`) | Two-line fix resolving the same 32 messages, but preserves the competing resolver, its silent `limit(2)` ambiguity bug, and its uncatchable query error. |
| Normalization backfill before matcher repair | Adds zero matches — the three `findByEmail` rungs already resolve the full 32 — while writing to 1,276 contacts before any validated read path exists. |
| Gmail creates contacts for unmatched senders | Would resolve ~947 messages by filling workspaces with newsletters and vendors, then recommending them as outreach targets. Violates "discovery enriches, it never replaces". |
| Feature flag held in Firestore | Needs a read per invocation and fails ambiguously when that read fails — fail-open, which a safety gate must never be. |

---

## Consequences

### Affected services

`messageProcessor`, `gmail-poll-replies`, `contactMatcher` (deleted), plus the consumers
that must migrate to `relationship.*`: `recommendationEngine`, `barryGuardrail`,
`barryStrategyRecommender`, `contactEngageStatus`, `nextBestStepService`,
`barryContextStack`, and Mission Control's reply counter — which today sums
`cadences.repliedCount` and is unrelated to Gmail.

### Field disposition

| Field | Class | Derived from |
|---|---|---|
| `conversationState` | Compatibility-only | `relationship.state` |
| `lastInboundAt` | **Deprecated** — no readers exist | — |
| `lastInboundSubject` | Compatibility-only | newest event subject |
| `replyCount` | **Deprecated** — no readers exist | — |
| `last_reply_at` | Compatibility-only | `relationship.last_inbound_at` |
| `last_replied_at` | Compatibility-only | `relationship.last_inbound_at` |
| `last_interaction_at` | **Contested** — not owned here | not derivable |
| `engagement_summary.replies_received` | Compatibility-only | `relationship.reply_count` |
| `contact_status` | Not owned — one approved transition only | — |
| `hunter_status` | Not owned — one approved transition only | — |

### Migration consequences

`gmail-poll-replies.js:154` sets `receivedAt = new Date()` — **the button-click time** —
and writes it to `last_reply_at`, `contact_status_updated_at` and `last_interaction_at`.
These legacy values are therefore not event times and must never be imported as such.

Canonical events are built only from `communication_records`, which carry real Gmail
timestamps. **Product has acknowledged that recomputation may move displayed reply
timestamps backward** where a legacy field held processing time rather than event time.
The canonical Gmail timestamp is authoritative; this is a data correction, not a
regression. Known instance: one contact whose displayed last reply moves 2026-08-27 →
2026-08-19.

`matchContact.js` is deleted, not deprecated. Two composite indexes currently live in
production but absent from `firestore.indexes.json` should be declared before anything
depends on them further.

### Compatibility requirements

Mirrors are written by a non-exported function inside `relationshipEventWriter.js`, so no
other module can write one. Existing consumers may read them during migration; **new
consumers may not**, enforced by an ESLint `no-restricted-syntax` rule with a finite
path allowlist that only ever shrinks. When the allowlist is empty the mirrors can be
deleted.

A recompute-equality test drops materialized state, rebuilds it from the event log, and
asserts equality — the structural guarantee that state stays derived.

The Patti Hobfoll condition is a permanent CI fixture: two synthetic events at relative
offsets, newer recorded first, asserting `last_inbound_at` does not regress and
`reply_count == 2`. Sanitized — no production identifiers.

The `UNMATCHED` reopen path is likewise implemented and tested, not merely described: a
terminal `UNMATCHED` record must re-enter classification when a Contact matching its sender
is subsequently created.

### Deprecation path

1. `lastInboundAt` and `replyCount` deleted immediately — no readers exist.
2. Consumers migrate to `relationship.*`, shrinking the ESLint allowlist.
3. When empty, remaining mirrors are removed under a later ADR.
4. `last_interaction_at`, `contact_status` and `hunter_status` need their own contract
   and are explicitly out of scope here.

### Blocker

`GMAIL_IDENTITY_MODE=live` is prohibited until the cursor-wedge defect is resolved at the
ingestion layer. The identity engine's fail-closed behaviour must not be weakened to
satisfy it. This is a pre-live blocker, not a Gate 3 opening blocker.
