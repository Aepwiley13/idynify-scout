# ADR-005 — Barry context

**Status:** Accepted · 2026-08 · Canonical identity, routes & navigation sprint

---

## Decision

Barry's context has **two layers with different lifetimes**, and they are never
conflated.

**Persistent relationship intelligence** lives in Firestore, scoped to the
contact: `barry_memory` on the contact document, the `barry_sessions`
subcollection, the `timeline`, `engagement_summary`. Loaded on arrival via
`loadContactMemory()`.

**Session navigation intent** is ephemeral, carried in router state, published
onto `navigationContext` by `useArrival()`, and cleared when the user leaves the
screen. It is **never written to the contact record**.

Memory is keyed by **contact, not module**. Sessions live beneath it:

```javascript
{ entityType: 'contact', entityId: 'contact_123',
  sessionType: 'follow_up', sourceModule: 'mission_control' }
```

## Reason

Barry's drawer conversations were keyed by module (`barryConversations/drawer_{module}`).
Switching modules started a separate conversation about the same person, so
Barry could hold two divergent views of one relationship and neither knew about
the other. The relationship belongs to the person; only the *conversation* is
per-context.

But collapsing to a single per-contact thread is also wrong. A follow-up nudge
prompted by Mission Control and an outreach draft started in Hunter are two
different conversations about one person. They must not share a thread — and
neither may start from nothing. Contact-scoped memory with per-module sessions
beneath it is what satisfies both.

Intent is ephemeral because the alternative is corrosive. A contact document
that remembered "someone once opened me because a follow-up was overdue" would
accumulate other people's reasons forever, and every future reader would have to
guess which were still true. What gets persisted is the **action the user took
and its outcome** — facts about the relationship, not about a navigation.

Router state is the right lifetime precisely because it drops on refresh: a user
who refreshes is no longer arriving and has no reason to be told why a screen
they are already looking at opened.

## Consequences

- `navigationContext` carries `entry_point`, `arrival_reason`,
  `recommended_action`, `return_to`, `source_module`, `barry_session_key`,
  `barry_memory_loaded` on every Barry message.
- `ContactPage` preloads memory on arrival so Barry's first message already
  knows the person rather than spending a round trip discovering them.
- Arrival clears on pathname change, so a stale reason cannot follow the user to
  an unrelated screen — the class of bug that has Barry answer about the wrong
  person.
- `sessionType` derives from `entryPoint`: `mission_control → follow_up`,
  `hunter → outreach`, `sniper → post_meeting`, `basecamp → account_review`,
  `reinforcements → referral`, `fallback → re_engagement`,
  `command_bar → lookup`, otherwise `general`.
- **The key is produced and carried; it is not yet consumed.** Rekeying existing
  conversations to this shape is the next sprint. Until then Barry receives a
  correct key and ignores it — deliberate, so the rekey lands against a contract
  already flowing rather than one invented alongside it.
- Anything that needs to survive a reload belongs in the persistent layer. If a
  new field is tempting to add to intent *and* to the record, that is the signal
  it has been mis-classified.

**Verified by:** `src/test/canonicalRoutes.test.jsx` — memory loads on arrival,
session keys differ by origin for the same contact, intent clears on navigation
away.
