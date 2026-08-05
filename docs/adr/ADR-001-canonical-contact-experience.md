# ADR-001 — Canonical contact experience

**Status:** Accepted · 2026-08 · Canonical identity, routes & navigation sprint

---

## Decision

Every cross-module contact navigation opens **`/contact/:contactId`**, a
module-agnostic route rendered by `ContactPage` → `ContactProfile`. It is
registered as a sibling of the modules, not a child of `ScoutMain`, and nothing
in its tree imports Scout.

Scout retains its **panel-over-list** behaviour at `/scout/contact/:contactId`
using the same foundation: same data loader, same actions, same Barry context,
same timeline, same arrival handling. Two display modes (`page`, `panel`), one
implementation.

`ContactProfile` is the single contact experience. Any second contact
destination is a defect, not a feature.

## Reason

Before this, every module navigated to `/scout/contact/:id`, so React mounted
`ScoutMain` beneath the record. A user who clicked a priority in Mission Control
landed on their contact with Scout's Daily Leads visible behind it, a breadcrumb
reading "Scout", and a Back button returning them to a module they had never
opened. The URL claimed ownership the interaction did not have.

Scout is the one module where the panel is right, and for a specific reason: it
has a filtered, sorted, scrolled list the user built, and closing the panel
should be a genuine *return* rather than a re-navigation that rebuilds it.
Mission Control, the Command Bar, Hunter and the rest have no such list —
overlaying a panel on an unrelated screen was the bug.

Two components would have been simpler to write and impossible to keep
consistent. The foundation audit found the previous split (a full-page route
plus an embedded panel in three components) had already diverged on back
semantics alone.

## Consequences

- `/contact/:id` belongs to no module, so the breadcrumb cannot come from the
  path. It comes from navigation intent instead — see ADR-004.
- `ContactProfile` gains `returnTo`, `returnLabel` and a `banner` render prop.
  Panel mode is still keyed off `onClose` being present.
- `/scout/contact/:id` is **not** a legacy alias and must not be redirected. A
  future "cleanup" that redirects it deletes Scout's panel behaviour.
- Any change to loading, actions or Barry wiring lands in both modes at once.
  That is the intended cost of having one implementation.
- Entry-point migration is incremental: modules can move from `panel` to `page`
  one line at a time. Hunter, Basecamp, Fallback and Command Center were
  deliberately left on `panel` in this sprint, pending staging validation.

**Verified by:** `src/test/canonicalRoutes.test.jsx` — asserts the route renders
the contact with a Scout mount count of zero.
