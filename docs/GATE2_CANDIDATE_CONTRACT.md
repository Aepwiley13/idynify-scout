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
| **Never send `contactId`** | The endpoint rejects it. The model interprets intent; the resolver determines identity |
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
| `refused` | Two or more existing records share an authoritative identifier | **No** — fail closed |

`ambiguous` and `refused` are never persisted. Barry does not manufacture
identity certainty.

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
