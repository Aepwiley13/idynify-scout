# Sniper migration plan

**Status:** freeze shipped, migration deferred to the follow-on sprint
**Code:** `src/services/sniperWriteGuard.js`

---

## The problem

Sniper does not read `users/{uid}/contacts`. It reads
`users/{uid}/sniper_contacts` — a parallel collection — and adding someone to
Sniper **copies** them into it.

The copy carries a name, a title, a company and an email. It does not carry:

- the `timeline` subcollection (every engagement event, ever)
- `barry_memory` (who they are, what has worked, tone and channel preference)
- `barry_sessions`
- `engagement_summary` (attempts, replies, channel history)
- `brigade_history`, `next_best_step`, `next_best_step_history`
- `referral_data`, `sticky_notes`, ICP scoring

So a contact worked for three months arrives in Sniper as a stranger, and from
that moment the two records diverge with nothing reconciling them.

---

## What shipped in this sprint — the freeze

**Every new Sniper record carries `canonical_contact_id`.**

```javascript
import { createSniperRecord } from '../services/sniperWriteGuard';

await createSniperRecord(userId, canonicalContactId, sniperFields);
```

`createSniperRecord`:

1. **throws** without a canonical contact id — an orphan created today is a
   manual reconciliation later, and a thrown error at the call site is
   enormously cheaper than that;
2. writes `canonical_contact_id`, and keeps `contactRef` as an alias because
   `AllLeads` and `SharedCompaniesView` already read it;
3. sets `stage: 'sniper'` on the **canonical contact**, so the canonical record
   is correct from the moment of the copy. This is the half that matters: after
   it, the copy is redundant rather than authoritative — which is the state the
   migration needs to start from.

Both write paths now go through it:

| Path | What changed |
|---|---|
| `src/pages/Scout/AllLeads.jsx` — "Add to Sniper" | Was `addDoc(sniper_contacts, {contactRef, …})`. Now goes through the guard, so the canonical contact also gets `stage: 'sniper'`. |
| `src/pages/Sniper/sections/PipelineSection.jsx` — manual add | Was creating a person who existed **only** inside Sniper, linked to nothing. Now the canonical contact is created (or matched, through identity resolution) **first**, and the Sniper record links to it. |

`scripts/verifyWritePaths.mjs` fails the build on any new unlinked write.

### What was deliberately NOT changed

Sniper still **reads** from `sniper_contacts`, and the four read paths
(`PipelineSection`, `TargetsSection`, `TouchesSection`, `OutcomesSection`) are
untouched. Changing reads and writes in the same sprint would mean no rollback
position: the freeze is safe precisely because Sniper behaves identically.

---

## The migration — follow-on sprint

### Target shape

Per the locked decision: `stage: "sniper"` on the canonical contact, **never** a
copied contact in a parallel collection. Sniper-specific detail lives as a
structured object on the canonical contact, or in a related opportunity record
referencing `contactId`.

```javascript
// users/{uid}/contacts/{contactId}
{
  stage: 'sniper',
  sniper: {
    pipeline_stage: 'demo_done',   // demo_done | proposal | negotiation | …
    entered_at: '2026-…',
    last_touch_at: '2026-…',
    // …whatever the Sniper board needs
  }
}
```

Note the field name. `stage` on a `sniper_contacts` record is the **Sniper
pipeline stage** (`demo_done`, …), which is a completely different axis from
`stage` on a contact (`scout` | `hunter` | `sniper` | …). They unfortunately
share a name today. The migration must rename the Sniper one to
`sniper.pipeline_stage` or the two will silently overwrite each other.

### Steps

**1 — Audit (read-only, ships first and alone).**
Count `sniper_contacts` documents; split into linked (has
`canonical_contact_id` or `contactRef`) and orphaned. Report the orphan count
per workspace. Nothing is written. This is the number that decides whether step
3 needs a human.

**2 — Backfill links for the resolvable orphans.**
For each orphan, run `resolveContact()` on its name/email/company. Exact
matches (hierarchy steps 2–5) get `canonical_contact_id` written. Weak matches
(step 6) get flagged, never auto-linked — same rule as contact creation, same
reason: two John Smiths at Acme.

**3 — Resolve the remainder by hand.**
Whatever step 2 flagged. This is expected to be small and is the reason step 1
ships first — the count determines whether this is an afternoon or a project.

**4 — Copy Sniper detail onto the canonical contact.**
For each linked record, write `sniper.*` onto `users/{uid}/contacts/{id}` and
ensure `stage: 'sniper'`. Idempotent; safe to re-run. **Writes only — nothing
is deleted.**

**5 — Move the reads.**
Point the four Sniper sections at `contacts` filtered by `stage === 'sniper'`.
This is the only step with user-visible behaviour change, and it is the step
that can be rolled back by reverting one commit while the data stays valid,
because step 4 only added.

**6 — Retire the collection.**
Only after step 5 has been in production long enough to trust. Archive
`sniper_contacts` (export, then stop writing, then eventually delete). No step
before this one removes anything.

### Rollback per step

| Step | Rollback |
|---|---|
| 1 | Nothing written. |
| 2 | Delete `canonical_contact_id` from the touched records. Additive only. |
| 3 | Same as 2. |
| 4 | Delete the `sniper` object from the touched contacts. `stage` reverts via `stage_source: 'sniper_add'`, which marks exactly which records the migration set. Additive only. |
| 5 | Revert the read commit. The data from step 4 stays valid and unused. |
| 6 | The export from step 6 is the rollback. Do not start it without one. |

Steps 1–4 are all **additive**; there is no point before step 6 at which a
rollback loses information.

---

## Why the freeze was worth shipping alone

Every day the freeze is live is a day of Sniper adds that arrive already
linked. Steps 2 and 3 above — the expensive, partly-manual ones — are sized by
the orphan count, and the orphan count stopped growing the moment this shipped.
