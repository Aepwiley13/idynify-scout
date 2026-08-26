# Gate 2 — Candidate Payload Contract

**Status:** published, Phase 0. Stable for Team C to build against now.
**Owner:** Team A (Gate 2). **Consumer:** Team C (First Experience).

---

## What this is

The single agreed handshake between First Experience and Gate 2.

Team C builds `conversation → clarification → targeting → website context →
search → First Value → selection`. Selection emits a list of
`CandidatePayload` objects. That list is the input to Gate 2's `RESOLVE_SAVE`
and it is the **only** coupling between the two workstreams.

## What this is not

A `CandidatePayload` is **not a record**. It is not an entity, not a document,
not a row, and it has no identity. It exists only inside the body of a
`RESOLVE_SAVE` request and ceases to exist when that request returns.

The reason this matters more than it looks: if the selection UI invents a
shape and persists it, that shape becomes the de facto entity schema for the
product — a second data model created by accident, at the UI layer, by a team
that was not designing one. Publishing the contract four phases before the
code that consumes it is what prevents that.

---

## The payload

```js
CandidatePayload = {
  kind: 'person' | 'company',        // REQUIRED — the only required field

  // ── Authoritative identifiers ────────────────────────────────────────────
  // Pass through VERBATIM from whatever source produced them.
  // Do NOT lowercase, trim, strip, or reshape. See "Send identifiers raw".
  email:                  string | null,
  apollo_person_id:       string | null,   // kind: 'person'
  apollo_organization_id: string | null,   // kind: 'company'
  linkedin_url:           string | null,
  phone:                  string | null,

  // ── Weak identity ────────────────────────────────────────────────────────
  // Used only to ASK the user. Never sufficient to resolve on its own.
  name:         string | null,
  company_name: string | null,
  company_id:   string | null,       // canonical company id, if already known
  title:        string | null,

  // ── Provenance ───────────────────────────────────────────────────────────
  source: string,                    // e.g. 'first_experience_search'
                                     // the server sets actor / operation id

  // ── Client correlation ONLY ──────────────────────────────────────────────
  // Not an id. Not identity. The server never stores it and never resolves
  // against it. Use it as a React key and to map results back to rows.
  clientRef: string,
}
```

Every field except `kind` is optional. **Absence is normal and safe.** A
candidate carrying only a `name` still resolves — it resolves to `ambiguous`
or `new` instead of `matched`, which is the correct outcome, not a failure.

## Request envelope

```js
POST /.netlify/functions/barryResolveSave
{
  userId, authToken,
  operationId,                 // client-generated uuid; bridges preview→commit
  actor: 'barry' | 'user',
  commit: boolean,             // false = resolution preview, writes nothing
  candidates: CandidatePayload[]
}
```

---

## Rules Team C builds against

| Rule | Why it exists |
|---|---|
| **Never mint an id** — not even a temporary or optimistic one | A temporary id is a candidate collection with extra steps. `clientRef` covers every legitimate need |
| **Never persist a `CandidatePayload`** anywhere — not Firestore, not localStorage, not sessionStorage | PROPOSE must not mutate canonical state. Persisted candidates are a parallel entity model |
| **Send identifiers raw** | Gate 2 Phase 2 adds fallback queries that match on the *original* stored bytes — an un-normalized LinkedIn URL is matched by querying the raw incoming value. Normalizing client-side destroys the signal the resolver needs |
| **`clientRef` is correlation only** | It must remain structurally impossible for it to become identity |
| **Never send `contactId`** | The endpoint rejects it outright — along with `contact_id`, `canonicalId`, `personId` and `id`. The model interprets intent; the resolver determines identity. The one way a canonical id may be supplied is `resolutions`, below, and only for an id the resolver itself just offered |
| **Selection may be any size** — do not chunk | The server batches and shares one scan window across the operation |
| **Render the resolution preview before the commit control** | See below |

## The preview requirement

`RESOLVE_SAVE` is called twice with the same `operationId`:

```
selection
  → RESOLVE_SAVE(commit: false)   ← resolves fully, writes nothing
  → render outcomes
  → user approves
  → RESOLVE_SAVE(commit: true)    ← same operationId
```

The user must see **what will happen**, not how many rows are selected:

> 17 existing · 2 new · 1 I can't tell apart

not:

> 20 contacts will be saved

Approving a count is not approving a decision.

## Carrying the user's disambiguation choice

A preview can come back `ambiguous` with the canonical records the resolver
could not choose between. The user picks one. That choice has to reach `commit`
**without letting a client name an arbitrary contact.**

The choice travels in the **request envelope**, never on a `CandidatePayload`:

```js
{
  userId, authToken, operationId, actor,
  commit: true,
  candidates: CandidatePayload[],          // still never carry contactId
  resolutions: { [clientRef]: contactId }  // optional; the user's answers
}
```

Putting it in the envelope keeps the contract's absolute rule literally intact —
a candidate still carries no canonical identity, and `findPayloadViolations()`
keeps rejecting one unchanged.

### The validation rule

For each `resolutions[clientRef]`, the server:

1. **Re-resolves that candidate.** Commit never trusts the preview's verdict —
   the workspace can change between the two calls.
2. Requires the fresh outcome to still be `ambiguous`. If it now resolves on its
   own, or matches nothing, the user answered a question that is no longer being
   asked → `refused`, reason `stale_resolution`.
3. Requires the chosen `contactId` to be **a member of the candidate list that
   re-resolution just produced**. Not a member → `refused`, reason
   `candidate_not_offered`.
4. Needs no separate workspace check: the candidate set is produced by the
   resolver querying `users/{uid}/contacts` for the authenticated workspace, so
   every id in it is by construction inside that workspace and a foreign id can
   never be a member.

**Membership in a freshly computed set is the authorization.** That is stronger
than replaying a token from the earlier call, because it cannot be stale — and
it needs no candidate collection, no operations collection, and no persistent
ambiguity object.

**Honest limit.** With no stored operation record the server cannot prove the id
came from *that* `operationId`'s preview — only that it is a valid answer to the
same question right now. `operationId` carries idempotency and correlation, not
authorization. If binding to a specific preview is ever required, the minimal
upgrade is an HMAC-signed token, not a collection.

A candidate answered this way returns `outcome: 'matched'` with
`matchedOn: 'user_disambiguation'`.

## Response

```js
{
  success, operationId,
  results: [{ clientRef, outcome, contactId, matchedOn, existingName, candidates[] }],
  summary: { matched, created, ambiguous, refused }
}
```

`outcome` is one of:

| Outcome | Meaning | Written on commit? |
|---|---|---|
| `matched` | Resolved to an existing contact on an authoritative signal | Merged, additively |
| `created` | True zero-match | Created |
| `ambiguous` | Only a weak name+company signal, one or more candidates returned | **No** — ask the user |
| `refused` | Either two or more existing records share an authoritative identifier, or the candidate carries too little identity to create (`reason: 'insufficient_identity'`) | **No** — fail closed |

`ambiguous` and `refused` are never persisted. Barry does not manufacture
identity certainty.

### The identity threshold — Barry creates only what Barry can find again

A candidate that matches nothing is created **only if the resolver could
re-find it on a later encounter**. That means at least one of:

* an authoritative identifier — `email`, `phone`, `linkedin_url`,
  `apollo_person_id`; or
* `name` **together with** `company_name` or `company_id`.

Anything less returns `refused` with `reason: 'insufficient_identity'` and a
`detail` saying what would be enough. Creating below the threshold would write a
record no rung of the hierarchy can ever match again — so every later encounter
with that person makes another one, and the first can never be reconciled with
anything. "Add Jane Smith", with no company and no address, is a question rather
than a save.

This is also why `clientRef` is **never persisted**. An earlier draft stored it
as an idempotency key for identifier-less creates; that solved insufficient
identity by writing a UI correlation key into the canonical record, which both
contradicts the rule above and papers over the real problem. Retry safety comes
from resolver identity, plus `identity_operation_id` for an operation's own
re-attempt — never from `clientRef`.

---

## Stability

**Additive-stable.** New optional fields may be added; existing fields will not
be renamed or given new meanings. Team C can build the full selection surface
against this today without waiting for Gate 2 Phases 1–4.

## Team C's authorized boundary

Team C owns everything through selection. Gate 2 owns everything from the
approval click onward. Team C must not create candidate collections, Barry
person/company entities, Scout-specific person/company entities, or canonical
ids of any kind.
