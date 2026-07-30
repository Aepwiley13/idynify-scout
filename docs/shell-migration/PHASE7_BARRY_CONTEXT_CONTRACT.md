# Phase 7 — Barry Context Contract
**Team A | Global Desktop Shell | Sprint 1**

---

## Why a contract, not just persistence

Persistence alone was never the problem worth solving. Before this sprint Barry was **eleven separate assistants**:

- `BarryChat` (nine module shells) persisted to `barryConversations/drawer_${module}` — one thread per module
- `BarryChatPanel` (Mission Control) persisted to `barryConversations/missionControl` **and** to the `barry_sessions` collection
- `BarrySessionHistoryPanel` reads `barry_sessions` — which only `BarryChatPanel` writes, so **every conversation held inside a module was invisible in Barry's own history**, and the button that would have shown it lived in a top bar those modules did not render

Making one of those instances survive navigation would have produced a Barry who remembers the conversation but has no idea the user has moved. The contract is the other half: Barry keeps **one thread** and is told **where the user is standing** on every message.

> Barry recommends. Navigation controls. Modules execute.

The contract is how "recommends" stays accurate as the user moves.

---

## The contract

Produced by `ShellProvider` (`src/context/ShellContext.jsx`), read by any component via `useShell().navigationContext`, and sent with every Barry request.

| Field | Source | Example |
|---|---|---|
| `user_id` | Shell, from auth | `"kJ2n…"` |
| `organization_id` | Shell, from `userData` | `null` — see schema drift below |
| `current_module` | Shell, derived from route | `"scout"` |
| `current_route` | Shell, `pathname + search` | `"/scout/contact/abc123"` |
| `current_entity_type` | **Module**, via `useShellEntity()` | `"contact"` |
| `current_entity_id` | **Module**, via `useShellEntity()` | `"abc123"` |
| `current_pipeline_stage` | **Module**, via `useShellEntity()` | `"scout"` |
| `current_action` | **Module**, via `useShellAction()` | `"quick_engage"` |
| `source_route` | Shell, derived from history | `"/scout?tab=all-leads"` |
| `navigation_history` | Shell, last 10 routes | `["/mission-control-v2", "/scout?tab=all-leads", …]` |
| `entity_label` † | **Module**, via `useShellEntity()` | `"Sarah Chen"` |

† Beyond the brief's required minimum. The shell breadcrumb needs a human name for the open record, and the module is the only thing that knows it. Carried on the same object rather than in a second store, because the brief says not to create duplicate context models.

### Division of responsibility

**The shell derives everything route-shaped.** A module never tells the shell which module it is — `resolveModule()` does that from the pathname, so the answer cannot drift from the sidebar highlight or the breadcrumb.

**Modules contribute only what the shell cannot know**: which record is open, and what the user is doing to it. Two hooks, both self-cleaning:

```jsx
// Contact Profile panel — declares the open record
useShellEntity({ type: 'contact', id: contactId, stage: contact.stage, label: 'Sarah Chen' });

// Quick Engage drawer — declares the action in progress
useShellAction('quick_engage');
```

Both clear on unmount, and the shell clears entity state on every pathname change. That is deliberate: a stale contact id following the user into another module is exactly what makes an assistant answer confidently about the wrong person.

---

## How it reaches Barry

**Client** — `BarryChatPanel` takes a `navigationContext` prop from the shell and includes it in the payload to `barryOrientationBrief` and `barryMissionChat`.

**Server** — `barryMissionChat.js` reads `body.navigationContext` and renders it into the system prompt via `buildNavigationContextBlock()`, positioned just before the ICP capability block:

```
WHERE THE USER IS RIGHT NOW
- Module: scout
- Route: /scout/contact/abc123
- Open record: contact abc123 (pipeline stage: scout)
- In progress: quick_engage
- Arrived from: /scout?tab=all-leads
- Recent path: /mission-control-v2 → /scout?tab=all-leads → /scout/contact/abc123

Use this to make your answer specific to the screen they are on. If they say
"this contact" or "here", resolve it against the open record above. Do not
announce their location back to them or narrate their navigation — they can
see where they are. Only mention a pipeline stage change if it is genuinely
material to what they asked.
```

The closing instruction matters as much as the data. The brief says Barry "acknowledges meaningful stage transitions when useful — does not narrate every click." Handing a model a stream of location updates without telling it to stay quiet produces an assistant that opens every reply with "I see you're in Scout." The block is orientation, not a prompt to comment.

---

## Expected behaviour by location

| Where | What Barry has | What changes |
|---|---|---|
| Mission Control | KPI context, orientation brief, no entity | Priorities and recommended work |
| Scout | `current_module: scout`, no entity | Discovery and triage framing |
| Contact Profile | entity type/id/stage, `entity_label` | "this contact" resolves to the open person |
| Quick Engage | entity **plus** `current_action: quick_engage` | Knows a send is being composed |

Moving between these updates the contract. **It does not start a new thread.** That is the whole point.

---

## Stage transitions

Stage changes are not narrated through the prompt — they are narrated by the shell, through `announce()`:

```jsx
shell.announce({
  message: 'Sarah Chen moved to Hunter.',
  actionLabel: 'Open Hunter',
  actionPath: '/hunter',
  undo: async () => { /* restores the previous stage */ },
});
```

Barry learns about the move implicitly: `current_pipeline_stage` changes on the next message because the entity's stage changed. He does not announce it, and he is not asked to.

This replaces the single worst interaction in the pre-migration product. `onMoved` previously did exactly one thing — `setContact(prev => ({ ...prev, stage: stageTo }))` — so the user performed the highest-value action available to them and the application said nothing: same URL, same header, and a back button still labelled "Back to People" pointing at the stage they had just left.

---

## Schema drift found — reported, not invented

**`organization_id` has no source.** The contract requires it; Idynify has no tenant or organization model. All data is scoped `users/{uid}/…`, and `organization_id` elsewhere in the codebase refers to **Apollo prospect companies**, not the account's own organization (`LinkedInLinkSearch.jsx:115`, `CompanySearch.jsx:117`).

The field is carried and reads from `userData.organizationId ?? userData.tenantId ?? null`, so it populates automatically if an org model lands. It is always `null` today. Per the brief — *"identifies schema drift or persistence gaps but fixes only what is necessary for the vertical slice"* — inventing an org model was out of scope. **Flagged for Aaron:** if multi-seat accounts are coming, this field is a real dependency and needs a real model behind it.

**Two Barry persistence schemas still exist.** This sprint unified the *shell's* Barry onto `BarryChatPanel` for all in-scope routes. The six out-of-scope modules still mount `BarryChat` with `drawer_${module}` threads. Convergence is part of each module's migration, not this one — see the remaining-module plan in `SPRINT1_DELIVERY.md`. Nothing was deleted: legacy `drawer_*` documents are untouched, so nothing a user has said to Barry has been lost.

---

## Tests

`src/test/shellPersistence.test.jsx` covers the contract end to end:

- every required field is present
- `current_module` tracks navigation
- `source_route` is correct **on the same render as the navigation** — this one guards a real bug: building history in an effect leaves the contract holding the previous route for one render, so Barry would be told the wrong origin for the first message after every move
- `navigation_history` accumulates in order
- the open entity appears, and **clears** when the user leaves the screen
- `current_action` reports `quick_engage` while the drawer is open
- navigation alone produces **no** announcement; only an explicit `announce()` does
