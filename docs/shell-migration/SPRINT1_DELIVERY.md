# Sprint 1 Delivery — Global Desktop Shell Vertical Slice
**Team A | Idynify**

Companion documents: `PHASE0_MIGRATION_SAFETY.md` · `PHASE7_BARRY_CONTEXT_CONTRACT.md`

---

## Definition of Done — status

> *A user can move from Mission Control into Scout, inspect a person, engage them, and return — without the application ever feeling like it changed into a different product.*

**Met, with one deliverable outstanding** (screen recording — see Phase 8 below).

The measurable form of "never changed into a different product" is that the shell is **mounted exactly once for the whole journey**. Before this sprint it mounted once per transition, because `MainLayout` was applied per route rather than above the routes — so the sidebar, top bar and Barry were destroyed and rebuilt on every navigation, including navigation between two routes that both used `MainLayout`.

`src/test/shellPersistence.test.jsx` asserts a mount count of exactly 1 across Mission Control → Scout → Contact Profile → back → Mission Control.

---

## 1. Before-and-after route / layout matrix

### In-scope routes

| Route | Before | After |
|---|---|---|
| `/mission-control-v2` | `MainLayout`, remounted per navigation | Shell child — shell persists |
| `/scout` | **Self-contained shell** — own icon rail, sub-nav, theme picker, settings, home button, user footer, own Barry | Shell child, content only |
| `/scout/contact/:id` | `MainLayout`, sibling route — opening a contact unmounted Scout | **Child of `/scout`** — panel over the live list |
| `/scout/company/:id` | `MainLayout`, remounted | Shell child |
| `/scout/company/:id/leads` | `MainLayout`, remounted | Shell child |
| `/scout/total-market` | `MainLayout`, **unreachable from Scout** | Shell child, in Scout's own nav |
| `/scout/cadences` | `MainLayout`, duplicate of a Scout tab | Shell child |
| `/scout/cadence/:id` | `MainLayout`, remounted | Shell child |
| `/scout/game` | `MainLayout`, **unreachable from Scout** | Shell child, in Scout's own nav |

### Out of scope — unchanged and fully functional

`/hunter`, `/hunter/blitz`, `/sniper`, `/basecamp`, `/reinforcements`, `/fallback`, `/recon` (+6 children), `/command-center`, `/settings` all keep their existing self-contained shells. They appear in the new sidebar and their routes are untouched. **No fake screens were created.**

### Measured outcomes

| Metric | Before | After (in-scope slice) |
|---|---|---|
| Shell mounts across the Phase 8 journey | 6 | **1** |
| Barry instances mounted across the journey | 4 | **1** |
| Barry conversation threads in the slice | 2 (`drawer_scout`, `missionControl`) | **1** |
| Navigation systems on in-scope routes | 2 | **1** |
| Logout reachable on in-scope routes | Mission Control + detail pages only | **All** |
| Scout features reachable from `/scout` | 6 of 8 | **8 of 8** |
| Definitions of "what Scout contains" | 2 (sidebar: 9 items, rail: 6) | **1** |
| Copies of the module list | 9 | **1** (+1 mobile icon map, sourced from it) |
| Meanings of bare `/scout` | 3, simultaneously | **1** |

---

## 2. Acceptance criteria

### Phase 1 — Shared shell

| Criterion | Status | Evidence |
|---|---|---|
| Sidebar does not unmount between in-scope routes | ✅ | `shellPersistence.test.jsx` — mount count 1 across 4 transitions |
| Top bar does not visually or structurally swap | ✅ | One `ShellChrome`, above `<Outlet/>` |
| Barry remains available throughout | ✅ | `BarryChatPanel` mounted once in the shell, `inert` when closed |
| Content changes inside a stable boundary | ✅ | `<main className="page-content">` is the only thing that swaps |
| Refresh on any in-scope route restores shell + content | ✅ | Real routes; no state-dependent rendering |
| Direct-linking a contact does not bypass the shell | ✅ | `/scout/contact/:id` is a shell descendant |
| Auth/authorization behaviour intact | ✅ | `ShellRoute` runs the identical auth + payment checks as `ProtectedRoute`; only presentation moved |

### Phase 2 — Sidebar

| Criterion | Status |
|---|---|
| Mission Control stands alone at the top | ✅ asserted in `sidebarLockedIA.test.jsx` |
| Groups visually distinguishable | ✅ static group headers, dividers |
| Active module always indicated | ✅ `aria-current="page"` + styling |
| Location clear on nested routes | ✅ longest-prefix resolution keeps Scout lit on `/scout/contact/:id` |
| Groups add no interaction to hide few items | ✅ test asserts group headers are **not** buttons |
| Locked vocabulary only | ✅ all labels from `navigationModel.js`; test asserts "Homebase" appears nowhere |
| Predictable at different desktop widths | ✅ collapse retained (pre-existing capability) |

### Phase 4 — Scout

| Criterion | Status |
|---|---|
| Mission Control → Scout does not replace the shell | ✅ |
| No competing sidebars inside Scout | ✅ icon rail and sub-nav column deleted |
| Active module **and** active Scout view both identifiable | ✅ sidebar + breadcrumb (module), tab strip (view) |
| Scout state preserved opening/closing a contact | ✅ Scout is the parent route; it never unmounts |
| Existing Scout behaviour continues to function | ✅ all six view components unchanged; `?tab=` deep links preserved |

### Phase 6 — Quick Engage

| Criterion | Status |
|---|---|
| Opening does not change global navigation | ✅ no route change; shell-hosted overlay |
| Closing returns to exact prior context | ✅ nothing underneath unmounts |
| Selected person unambiguous throughout | ✅ named in heading and on the send button |
| Send success / failure / pending states clear | ✅ resolver states surfaced verbatim, including native handoff |
| Barry understands an engagement is in progress | ✅ `current_action: 'quick_engage'` |
| Routes through `executeSendAction()` | ✅ no new send path |

---

## 3. Migration risk notes and rollback plan

Full assessment in `PHASE0_MIGRATION_SAFETY.md`. Operational summary:

| Layer | Mechanism | Blast radius | Revert time |
|---|---|---|---|
| **1. Per-route** | Move a route out of the `ShellRoute` group back to `<ProtectedRoute withLayout>` — both wrappers are retained | One route | ~1 min |
| **2. Whole slice** | `VITE_SHELL_MIGRATION=off`, or `SHELL_MIGRATION.enabled = false` | Vertical slice | ~1 min, env-driven needs no code deploy |
| **3. Git** | Revert the merge commit | Everything | one deploy cycle |

**Degraded mode is real, not theoretical.** With the flag off, every in-scope route falls back to the pre-migration `<ProtectedRoute withLayout>` wrapping in the `else` branch of `App.jsx`. Scout renders inside `MainLayout` rather than bare — it no longer carries its own rail, so it must not be rendered unwrapped. Behaviour degrades to "shell present but remounting per route", which is exactly where the product was before this sprint.

**The Scout-only flag sketched in Phase 0 was not implemented, deliberately.** Keeping Scout's icon rail behind a branch would preserve the second Scout chrome this sprint exists to remove. Reverting Scout specifically is a `git revert`, not a flag. Phase 0 has been corrected to match.

**Barry data is not destructively migrated.** The unified thread writes to `barryConversations/missionControl` — the key `BarryChatPanel` already used. Legacy `drawer_${module}` documents are untouched and still read by the six out-of-scope modules. Rolling back loses nothing.

### Risks accepted, stated plainly

1. **Scout's rail is gone in one step.** It was the only route to six modules from inside Scout, so the sidebar had to land in the same change. Both are in this sprint; they cannot be deployed separately.
2. **Mobile Scout is unreconciled.** Constraint C3: the shell suppresses its own `BottomNav` on `/scout` so mobile does not get two. Scout's mobile layout is otherwise preserved untouched. This is a deferral, not a fix — the mobile sprint owns it.
3. **`{ replace: true }` removal changes back-button behaviour.** Previously Back from anywhere in Scout exited the module; now it steps back a view. This is the intended fix, but it is a behaviour change users may have adapted to.
4. **Global search does not exist.** Constraint C2. The top bar renders a disabled, labelled affordance rather than a fake input. **Aaron's call:** if global search is meant to ship, it is a feature with its own scope, not part of a chrome migration.

---

## 4. Controlled deletion manifest

Only code made obsolete **by this migration**. Per the brief, no broad repository cleanup was performed — the 45 orphaned files and ~16,500 unreferenced lines found in the navigation audit are a separate sprint and were left alone.

### Safe to remove — deleted

| Item | Former purpose | Replacement | Verification |
|---|---|---|---|
| `Sidebar.jsx` pillar data (`peopleItems`, `reconItems`, `scoutItems`, `hunterItems`, `sniperItems`, `basecampItems`, `reinforcementsItems`, `fallbackItems`) | Eight hand-maintained nav lists | `constants/navigationModel.js` | Locked IA tests; full build |
| `Sidebar.jsx` `SIDEBAR_ROUTE_MODULE_MAP` | Route → Barry persona | `resolveBarryModule()` | Unit test asserts `/basecamp` → `basecamp`, fixing the persona that was unreachable |
| `ScoutMain.jsx` `NAV_SECTIONS`, icon rail, sub-nav column, `ThemePicker`, `BarryAvatar`, `Particles`, user footer, MC button, settings button | Scout's own application chrome | `MainLayout` | Scout renders; tests pass |
| `ScoutMain.jsx` user resolution block | Rendered an email in the sidebar footer | Shell owns identity | No consumer remained |
| `MainLayout.getPageTitle()` | Page title by pathname string-match | `Breadcrumb` | Function had dead branches for `/scout`, `/hunter`, `/recon`, `/people` — routes that never rendered `MainLayout` |
| `Sidebar.css` — 28 rules (`.nav-pillar*`, `.pillar-*`, `[data-pillar=…]`, `.nav-item.settings-item*`, `.nav-item.primary-item`) | Styled the pillar sidebar | Grouped-nav rules | `grep` for each class across all `.jsx`: zero emitters |
| `MainLayout.css` — `.topbar-settings-btn` ×4 rules | Mobile settings shortcut | `.topbar-icon-btn` | `grep`: zero emitters |

### Verify first — NOT deleted

| Item | Why it is suspect | Why it stayed |
|---|---|---|
| `ContactProfile` non-panel branch (page header, "Back to People") | Every remaining caller passes `onClose`, so panel mode always wins | Still reachable through the rollback branch of `App.jsx`. Delete when the flag is removed. |
| `/mission-control-v2/recon`, `/mission-control-v2/recon/section/:id` + `RECONModulePage`, `RECONSectionPage` | Superseded by `/recon`; the Mission Control tile now points at the real module | May be deep-linked from sent emails or Crisp macros. **Check before deleting.** |
| `AllLeads.jsx` → `ContactProfileView` (lines ~1129–1179) | Unreferenced, and calls `useEffect` after two conditional early returns — would throw "rendered more hooks than during the previous render" if a contact loaded successfully | Pre-existing dead code, not created by this migration. Out of scope per the brief's cleanup boundary. **Recommend deletion in the cleanup sprint.** |
| `components/barry/BarryTrigger.jsx` | Orphaned; App.jsx comment says it was removed | Pre-existing orphan, unrelated to this migration |
| `MODULE_CONFIG.homebase` in `BarryChat.jsx` | Basecamp's real persona is `basecamp` (CSM); `homebase` (GUIDE) was reached only through the old route maps | Basecamp is out of scope. Resolve during Basecamp's migration. |

### Roadmap — Aaron reviews before deletion

| Item | Note |
|---|---|
| `components/NavigationBar.jsx` + `/companies`, `/lead-review`, `/old-scout` | The fourth navigation system. Its links point at `/mission-control`, a redirect-only route, so its active state can never be true. Removing it means removing three routes. |
| `/scout/cadences` as a distinct route | Duplicates the Scout `cadences` view. Both work today; collapsing them is a URL decision, not a code one. |

### Unknown owner

None found in the in-scope surface.

---

## 5. Phase 8 verification

### Automated — passing

| Suite | Tests | What it proves |
|---|---|---|
| `shellPersistence.test.jsx` | 10 | Shell mounts once across the journey; Scout stays mounted under the panel; full context contract including `source_route` correctness and entity clearing; navigation alone never narrates |
| `sidebarLockedIA.test.jsx` | 7 | Locked hierarchy against the **real** `Sidebar`; group order; Mission Control outside the groups; no disclosure controls; active state on nested routes; Barry is a control not a destination |
| `navigationModel.test.js` | 12 | One label and one path per module; "Homebase" appears nowhere; longest-prefix route resolution; Basecamp's Barry persona |

**Full suite: 409 passed / 10 failed — byte-identical to the pre-change baseline.** The 10 failures are pre-existing (`UserSettings` calls `useLocation()` in tests that do not wrap it in a Router) and unrelated to this work. Verified by running the suite on a clean stash before and after.

**Build:** passes. **Lint:** no new errors beyond the repository's existing baseline of 50 `static-components` findings, none of which this work added.

### Manual — blocked, and here is exactly why

The brief asks for screenshots or a screen recording of the authenticated journey. **This is not delivered, and I am not going to claim otherwise.**

The dev server boots and serves correctly — verified in Chromium: the homepage renders with one network error (`ERR_CONNECTION_RESET` reaching Firebase), which is expected in a sandbox with no outbound access to `idynify-scout-dev.firebaseapp.com`. Every authenticated route redirects to `/login`, and signing in requires real credentials plus reachable Firebase Auth. Neither is available in this environment.

**What is needed to close this deliverable:** one authenticated session on a machine with Firebase access, walking

```
Login → Mission Control → Scout → Contact Profile → Quick Engage
      → Close Quick Engage → Close Contact Profile → Mission Control
```

and confirming at each step: no chrome swap, breadcrumb correct, back predictable, Scout filters and scroll intact on panel close, Barry reachable and holding one thread, no legacy shell flash during transition. The automated suite asserts the structural half of that list; the visual half needs eyes on a running app.

### The Move to Hunter proof point

Implemented and wired end to end:

1. `ScoutEngagementPanel` calls `moveContactToHunter()` — unchanged
2. `onMoved` reaches `handleStageMoved` in `ContactProfile`, which now does three things instead of one:
   - updates the record's stage locally (as before)
   - calls `shell.announce()` with the destination and an undo that restores the previous stage
   - leaves the contract's `current_pipeline_stage` updated, so Barry's next answer is about a contact in the new stage
3. `ShellAnnouncements` renders **"Sarah Chen moved to Hunter."** with *Open Hunter* and *Undo*. Announcements offering an undo do not auto-dismiss.

The undo restores whatever stage the contact was in, not Scout — the same handler serves every stage transition, not only Scout → Hunter.

**Verified by test** (announcement fires on explicit call, never on navigation). **Not yet verified visually**, for the reason above.

---

## 6. Remaining module migration plan

Each module is one PR. The pattern is now fixed; Scout was the hard one because it had the most chrome.

### Per-module recipe

1. Move the route into the `ShellRoute` group in `App.jsx`.
2. Delete the module's `MODULE_RAIL`, icon rail, sub-nav column, theme picker, settings button, home button and user footer.
3. Convert its sub-navigation to a horizontal view strip inside the content boundary — or, better, to real child routes.
4. Replace its `BarryChat` instance with the shell's Barry. Add a one-time read of `barryConversations/drawer_${module}` so the user's existing thread is carried into the unified thread rather than orphaned.
5. Call `useShellEntity()` wherever the module opens a record.
6. Drop `{ replace: true }` from tab writes.
7. Add the module to the persistence test's journey.

### Order, and why

| # | Module | Effort | Why here |
|---|---|---|---|
| 1 | **Hunter** | Medium | Completes the pipeline's core loop with Scout, and it is the destination "Move to Hunter" points at — until Hunter is migrated, the most important transition in the product still lands in a different chrome. Its shell is the closest structural twin to Scout's. |
| 2 | **Sniper** | Low | Same shape as Hunter, fewer views. Finishes PIPELINE. |
| 3 | **Recon** | Low | Already uses real nested routes — the only module that does. Mostly chrome deletion. Sequenced early because it is the cheapest genuine win. |
| 4 | **Basecamp** | Medium | Resolve the `homebase`/`basecamp` Barry persona split as part of this. |
| 5 | **Reinforcements** | Low | Small surface. |
| 6 | **Fallback** | Low | Smallest surface; lowest frequency. |
| 7 | **Command Center** | **High** | Deliberately last. It holds six unrelated concerns (people, companies, missions, weapons, arsenal, outcomes) behind one route, and the locked IA does not list it as a module. Migrating it is an information-architecture decision, not a chrome swap — **needs Aaron before it starts.** |

Once modules 1–6 land, the rollback branch in `App.jsx`, the `SHELL_MIGRATION` flag, `BarryChat`, the `drawer_*` persistence path, and `ContactProfile`'s non-panel branch all become genuinely dead and can be removed together in one cleanup PR.

### Not on this list

`/settings`, the admin surfaces (11 pages with no navigation at all), and the ~30 no-shell legacy routes. Each needs its own decision about whether it belongs in the shell. Admin in particular probably wants its own shell rather than the sales-pipeline sidebar.

---

## 7. Escalation — three items for Aaron

Per the escalation protocol. **None of these blocked the locked architecture**; all three were implemented as specified with the deviation stated in code.

1. **Global search does not exist.** Listed among the shell's responsibilities, but there is no global search in the product and Phase 2 says not to expand features. The shell renders a disabled, labelled mount point. If it is meant to ship, it needs its own scope.

2. **`organization_id` has no source.** The contract requires it; the product has no tenant model and all data is scoped `users/{uid}`. The field is carried and always `null`. If multi-seat accounts are coming, this needs a real model.

3. **Contact Profile on direct URL renders Scout *with* the panel, not a standalone page.** The brief suggested a full content route. A standalone page reached cold has no origin to return to — which is precisely where the old hardcoded "Back to People" came from. Rendering the list alongside means there is always somewhere to go back to. Below 1100px the list hides and the panel takes the full workspace, which is the full-content-route behaviour the brief describes. Say the word and it becomes a standalone route.
