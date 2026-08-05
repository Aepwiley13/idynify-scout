# ADR-004 — Navigation contract

**Status:** Accepted · 2026-08 · Canonical identity, routes & navigation sprint

---

## Decision

Every module opens a contact or company through **`openContact()`** or
**`openCompany()`** from `src/utils/navigation.js`. No module constructs
`navigate('/scout/contact/...')` or `navigate('/contact/...')` by hand.

The helpers own the destination, the display mode, and the navigation intent:

```javascript
openContact({
  navigate, contactId,
  entryPoint, reason, recommendedAction, priorityId, taskId,
  returnTo, displayMode,   // 'page' | 'panel'
});
```

`useCanonicalNavigation()` binds `navigate` and defaults `returnTo` to the
current location.

## Reason

A raw path is a decision with nowhere to put its reasoning. Three consequences
followed from that one line being written twenty times:

1. **The URL said Scout, so the shell said Scout.** Every module dragged Scout's
   identity along with it.
2. **There was nowhere to put the reason.** The call knew *which* contact and
   nothing about *why*, so arrival was silent and the user had to hold the
   reason across a navigation.
3. **Nothing was reviewable.** A module that navigated wrongly looked exactly
   like one that navigated correctly, because both were a string. There was no
   diff a reviewer could catch.

A single function makes the contract enforceable rather than merely documented:
bypassing it reintroduces a raw path, and that *is* visible in review.

`returnTo` defaults to the current location because a helper whose `returnTo` is
optional and unset produces a Back button with nowhere to go — the exact failure
the canonical routes exist to remove.

## Consequences

- Navigation intent travels in **router state and dies there** (see ADR-005).
- The breadcrumb comes from `entryPoint`, not the path. Command Bar is
  deliberately absent from the entry-point → module map: search is not a place,
  so it falls through to whatever `returnTo` resolves to.
- `readNavigationIntent()` returns intent **only for the entity on screen**.
  React Router preserves `location.state` across a same-route param change, so
  without the check, clicking from contact A to B would show B a banner
  explaining A.
- The helpers being the single entry point makes them the single place product
  analytics can be emitted with full coverage — `open_contact` / `open_company`
  fire from here. A contract that is genuinely singular pays for itself twice.
- Migrating a module's display mode is a one-line change at its call site.
- **Every future sprint inherits this.** Nothing introduces a new navigation
  pattern for contacts or companies outside these two functions.

**Verified by:** `src/test/canonicalNavigation.test.js`,
`src/test/canonicalRoutes.test.jsx`, `src/test/navigationAnalytics.test.js`.
