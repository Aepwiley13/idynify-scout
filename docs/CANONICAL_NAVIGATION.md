# Canonical navigation contract

**Code:** `src/utils/navigation.js` · **Tests:** `src/test/canonicalNavigation.test.js`, `src/test/canonicalRoutes.test.jsx`

---

## The routes

```
/contact/:contactId    ContactPage  → ContactProfile (page mode)
/company/:companyId    CompanyPage  → CompanyDetail
```

Registered in `App.jsx` as children of the shell layout route — **siblings of
the modules, not children of `ScoutMain`**. Neither mounts Scout, and nothing
in their tree imports it.

### What happened to the old routes

| Route | Disposition | Why |
|---|---|---|
| `/scout/contact/:id` | **Kept — it is the panel display mode** | Scout has a filtered, sorted, scrolled list worth preserving behind a panel. Same loader, same actions, same Barry context, same timeline as the page. This is decision 3's "two display modes, one implementation." |
| `/scout/company/:id` | **Redirects** to `/company/:id` (`replace`, preserving search + hash) | There was no company panel and no list to preserve — it rendered the same full page the canonical route renders, under a path claiming Scout owned it. |
| `/scout/company/:id/leads` | Unchanged | A different screen (`CompanyLeads`), not a canonical destination. |

---

## The helpers

**No module calls `navigate('/scout/contact/…')` directly.** Every entry point
goes through:

```javascript
// Inside a component
import { useCanonicalNavigation } from '../utils/navigation';
const { openContact, openCompany } = useCanonicalNavigation();
openContact({ contactId, entryPoint: 'hunter' });   // returnTo defaults to here

// Where a navigate() is already in hand
import { openContact, ENTRY_POINTS, DISPLAY_MODES } from '../utils/navigation';
openContact({
  navigate,
  contactId,
  entryPoint: ENTRY_POINTS.MISSION_CONTROL,
  reason: 'next_step_overdue',
  recommendedAction: 'complete_step',
  priorityId, taskId,
  returnTo: '/mission-control-v2',
  displayMode: DISPLAY_MODES.PAGE,
});
```

`useCanonicalNavigation()` defaults `returnTo` to the current location, because
a helper whose `returnTo` is optional and unset produces a Back button with
nowhere to go — the exact failure the canonical routes exist to remove.

A future sprint that bypasses the helpers reintroduces a raw path string, and
that is visible in review.

---

## Navigation intent is ephemeral

Intent travels in **router state** and dies there. It is **never written to the
contact record.**

```javascript
{
  entityType, entityId,
  entryPoint,          // where the user clicked
  reason,              // the recommendation engine's machine type
  recommendedAction,
  priorityId, taskId,
  returnTo,
  displayMode          // 'page' | 'panel'
}
```

Router state survives Back and forward within a session and is dropped on
refresh. That is the correct lifetime: a user who refreshes is no longer
arriving, and has no reason to be told why a screen they are already looking at
opened.

What **is** persisted is the ACTION and its OUTCOME, after the user takes it. A
contact document that remembered "someone once opened me because a follow-up
was overdue" would accumulate other people's context forever.

`readNavigationIntent(location, { entityType, entityId })` returns the intent
**only if it is for the entity on screen**. Without that check the intent would
outlive its navigation — React Router preserves `location.state` across a
same-route param change, so clicking through from contact A to contact B would
show B an arrival banner explaining A's overdue follow-up.

---

## The breadcrumb

`/contact/:id` and `/company/:id` belong to no module by design — that is what
makes them reachable from everywhere. So the breadcrumb names the module the
user **came from**, declared by the canonical page via `useArrival()` and read
by `MainLayout`.

| Entry point | Breadcrumb shows |
|---|---|
| `mission_control` | Mission Control |
| `scout`, `hunter`, `sniper`, `basecamp`, `reinforcements`, `fallback`, `recon`, `command_center` | that module |
| `command_bar` | whatever `returnTo` resolves to — search is not a place |
| nothing (bookmark, refresh, pasted link) | falls back to path resolution → Mission Control |

Only the breadcrumb is overridden. Bottom nav, More sheet and content padding
still follow the route, because those describe where the user *is*, not how
they got here.

---

## Barry

`useArrival()` publishes onto `navigationContext`, which rides along on every
Barry message:

```
entry_point · arrival_reason · recommended_action · return_to ·
source_module · barry_session_key · barry_memory_loaded
```

Memory is **contact-scoped**; sessions live beneath it, keyed by the module the
user arrived from:

```javascript
{ entityType: 'contact', entityId: 'contact_123', sessionType: 'follow_up', sourceModule: 'mission_control' }
```

| Entry point | `sessionType` |
|---|---|
| `mission_control` | `follow_up` |
| `hunter` | `outreach` |
| `sniper` | `post_meeting` |
| `basecamp` | `account_review` |
| `reinforcements` | `referral` |
| `fallback` | `re_engagement` |
| `command_bar` | `lookup` |
| anything else | `general` |

Same person, shared memory; different module, different conversation. A
follow-up nudge is not an outreach draft.

`ContactPage` preloads `loadContactMemory()` on arrival so Barry's first
message already knows the person rather than spending a round trip discovering
them. Note that **rekeying existing Barry conversations to this shape is
explicitly out of scope** — the key is produced and carried; consuming it is a
follow-on change.

---

## Accessibility

| Requirement | Where |
|---|---|
| Focus on open (page) | `ContactPage` / `CompanyPage` focus the labelled page container on mount and on `contactId` change |
| Focus on open (panel) | `ContactProfilePanel` focuses the panel |
| **Focus returns to the trigger on close** | `ContactProfilePanel` captures `document.activeElement` on open and restores it on unmount. Possible precisely *because* the list is never unmounted — so it is a real restore, not a jump to the top |
| Escape closes the panel | `ContactProfilePanel`, with `stopPropagation` so one Escape does not also clear what is behind it |
| Browser Back | Every navigation is a real route change; the redirect uses `replace` so it never traps Back |
| Accessible names | Back buttons carry `aria-label` with their destination; priority cards announce action + title; the company card in `ContactProfile` has a name and handles Enter **and** Space |
| Arrival banner | `role="status"`, `aria-label="Why this contact was opened"` |

A full accessibility audit is a separate sprint. These are the minimum.

---

## Rollback

| Change | Rollback |
|---|---|
| Canonical routes | Remove the two `<Route>` lines in `App.jsx`. The helpers still resolve, and every module falls back to whatever path they build. |
| `/scout/company/:id` redirect | Restore `element={<CompanyDetail />}`. One line. |
| Helper adoption | Each call site is a self-contained edit; reverting one file restores that module's previous navigation without affecting the others. |
| Arrival / breadcrumb | Revert `useArrival` in the two pages. `MainLayout` falls back to `resolveModule(pathname)` on its own when `arrival.originModuleId` is null — no second change needed. |

Nothing here writes to Firestore, so there is no data to roll back.
