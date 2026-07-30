# Phase 0 — Migration Safety Assessment
**Team A | Global Desktop Shell vertical slice | Sprint 1**
*Completed before any code changes, per brief. No deletions in this phase.*

---

## Assessment table

| Area | Current owner | Current behavior | Required target behavior | Migration risk |
|---|---|---|---|---|
| **MainLayout** | `ProtectedRoute withLayout={true}` per route (`App.jsx:215-239`) | Wraps **14 routes individually**. Because each `<Route>` builds its own element tree, MainLayout **unmounts and remounts on every navigation** — even between two MainLayout routes. Sidebar, top bar and Barry are all destroyed on each transition. | One layout route. `<MainLayout>` mounts once at login, `<Outlet/>` swaps content beneath it. | **Medium.** Route restructuring touches every in-scope route. Mitigated by keeping paths byte-identical — only nesting changes. |
| **Mission Control shell** | `pages/Scout/MissionControlDashboardV2.jsx` (1,262 lines) | Renders inside MainLayout. Also renders `ModuleNavigationGrid` — a second global navigation listing the same 8 modules as the sidebar, with divergent labels (`HOMEBASE` vs `BASECAMP`). | Stays in the shell. Grid is retained as the *contextual launch* step of the Barry→work→launch model, but re-labelled to locked vocabulary and demoted from "navigation" to "launch". | **Low.** Label + copy changes only. |
| **Scout shell** | `pages/Scout/ScoutMain.jsx` (727 lines) | Self-contained. Owns a 60px icon rail (8 modules), a 190px sub-nav column, a theme picker, a settings button, an "MC" home button, a user footer and its own Barry instance. Explicitly documented as "does NOT use MainLayout". | Content-only. Keeps Scout view tabs as a horizontal strip inside the content boundary. Surrenders all global chrome to the shell. | **High.** Largest single behavioral change in the slice. Tab state, `?tab=` deep links and impersonation-aware user resolution must all survive. |
| **Contact Profile** | `pages/Scout/ContactProfile.jsx` (947 lines) | Dual-mode already: full page at `/scout/contact/:id` (MainLayout) **and** embedded panel via `isPanelMode = !!onClose` (`:99`) in 3 call sites. Page mode ships a hardcoded "Back to People" → `/scout` that is wrong for 7 of its 8 entry points. | Panel by default, over the Scout list it was opened from. Full content route retained for direct link and refresh. Back returns to actual origin. | **Medium.** Panel mode already exists and is proven — the work is routing and return-path logic, not a rewrite. |
| **Quick Engage** | `components/contacts/InlineEngagementSection.jsx` (~1,800 lines) | Renders inline inside Contact Profile, scrolls into view. Not addressable, not closable without losing position. | Contextual drawer over the current screen. Opens from Scout row or Contact Profile. Closes to exact prior context. Routes through `executeSendAction()`. | **Medium.** Must not fork the send path — `executeSendAction` (`sendActionResolver.js:432`) stays the single entry point. |
| **Barry session/context** | Two components: `BarryChat` (9 shells) + `BarryChatPanel` (MainLayout) | `BarryChat` persists to `barryConversations/drawer_${module}` — **one thread per module**. `BarryChatPanel` persists to `barryConversations/missionControl` **and** `barry_sessions`. History panel reads `barry_sessions`, so 8 modules' conversations are invisible. Both unmount on navigation. | One instance, shell-mounted, one thread. Context contract supplied by the shell per Phase 7. | **High.** Two persistence schemas must converge without orphaning existing user conversations. See rollback note below. |
| **Top bar** | `MainLayout.jsx:198-246` | Present on 14 routes. Holds page title, Barry session history, settings, user email, logout. Absent from all 10 module shells — **logout is unreachable from 8 of 9 modules**. `getPageTitle()` maintains branches for `/scout`, `/hunter`, `/recon`, `/people` — routes that never render MainLayout, so those branches are dead. | Always present on authenticated routes. Title derived from the route, breadcrumb shows nesting. Logout always reachable. | **Low.** Additive. |
| **Route guards** | `ProtectedRoute` (`App.jsx:215`), `ProtectedAdminRoute`, `ProtectedSuperAdminRoute` | Auth + payment gate per route. `withLayout` is a *prop of the guard*, conflating authorization with presentation. | Guard and layout separated. A `ShellRoute` composes guard + shell; guard semantics unchanged. | **Low, but must be verified.** Any regression here is a security regression, not a UX one. Payment redirect and impersonation must behave identically. |

---

## Required answers

### 1. Which capabilities currently live only inside Scout or Mission Control shells?

**Only in the Scout shell (`ScoutMain.jsx`):**
- Scout view switching (People / Saved Companies / Daily Discoveries / Scout+ / ICP Settings / Cadences) with `?tab=` sync
- Company drill-in via `drillCompanyId` → `CompanyProfileView` rendered in place
- Sub-nav collapse persisted to `localStorage` (`scout_subnav_collapsed`)
- Impersonation-aware user resolution (`useActiveUser` + `onAuthStateChanged` fallback, `:711-723`)

**Only in Mission Control (`MissionControlDashboardV2.jsx`):**
- KPI context production, handed upward to Barry via `setBarryPageContext`
- `ModuleNavigationGrid` module launch tiles with live status badges
- Orientation brief consumption (`orientation` prop injected by MainLayout's `cloneElement`)

**Only in MainLayout:** logout, Barry session history, page title, settings shortcut, mobile bottom nav + More sheet.

**Only in the module shells collectively:** the theme picker. It exists in `ScoutMain` and each shell, and in `Sidebar` — but a user on a no-shell route cannot change theme at all.

### 2. Which capabilities must move into `MainLayout`?

| Capability | Reason |
|---|---|
| Global navigation (locked hierarchy) | Brief: modules may not create separate application chrome |
| Logout + account access | Currently unreachable from 8 of 9 modules |
| Barry container, visibility, and single conversation thread | Phase 7; cannot be per-module and persistent simultaneously |
| Settings access | Same reachability defect as logout |
| Theme picker | Currently duplicated 9× and absent on ~30 routes |
| Global search entry point | Brief Phase 1 requirement; **does not exist today** — see constraint C2 |
| Notifications entry point | `NotificationCenter` exists but is not mounted in the shell — see constraint C2 |
| Barry session history | Button lives in the top bar; must be reachable wherever Barry is |
| Impersonation-aware user resolution | Currently re-implemented per shell; belongs to the shell once |

### 3. Which should remain module-owned?

Scout keeps everything that changes the *working view inside Scout* and nothing that moves the user across Idynify:

- Lead/company/people view tabs, filters, sorting, search-within-view, bulk actions
- Company drill-in and its back affordance
- Scout-specific empty states, loading states, data fetching
- ICP Settings and Scout+ panels
- Contact row actions (engage, save, archive)

Contact Profile keeps its own content: enrichment, timeline, engagement panels, stage transition controls, notes.

**The dividing line used throughout this migration:** *does this control move the user across Idynify, or change what they are looking at within one module?* Global → shell. Local → module.

### 4. What would break if the old shell were removed immediately?

Enumerated so nothing is discovered late:

1. **Scout's icon rail is the only way to reach 6 modules from Scout.** Removing it before the sidebar renders on `/scout` strands the user. → Sidebar must land *before* the rail is removed.
2. **`MainLayout` injects props via `React.cloneElement`** (`:250-259`): `orientation`, `openBarry`, `setBarryPageContext`. Under `<Outlet/>` these are no longer passed positionally. Mission Control reads all three. → Must move to context before the layout route lands, or MC loses its Barry briefing.
3. **`getPageTitle()`** is string-matched against pathnames. Every path it matches must keep working; its 4 dead branches can go.
4. **`/scout/cadences` and the Scout `cadences` tab render the same component.** Removing either without a redirect breaks a sidebar link.
5. **Barry conversation continuity.** Users have live threads in `barryConversations/drawer_scout`. Switching to a single thread without a read-path for the old docs silently loses their history.
6. **Mobile.** `BottomNav` and `MoreSheet` render inside MainLayout. Putting `/scout` inside MainLayout gives mobile Scout a bottom nav it never had, on top of Scout's own mobile bottom nav. → **Two bottom navs.** Must be guarded this sprint even though mobile is a later sprint.
7. **Impersonation.** `ImpersonationBanner` offsets layout via a `body.impersonating` class. Shell restructuring must preserve the offset.
8. **`useSearchParams` + `{replace:true}`.** Scout writes tab state with `replace`, so no history entries exist. Any code assuming back-navigation within Scout works today is already wrong; changing it changes behavior users may have adapted to.

### 5. Can the migration be performed route by route?

**Yes — and it is being done that way.** The layout route accepts children incrementally. A route inside `ShellRoute` gets the new shell; a route left outside keeps its current behavior exactly. The two coexist with no shared mutable state.

Sprint 1 moves in-scope routes only:

```
/mission-control-v2      → ShellRoute   (already MainLayout; now persistent)
/scout                   → ShellRoute   (was self-contained shell)
/scout/contact/:id       → ShellRoute   (already MainLayout; now panel-capable)
/scout/company/:id       → ShellRoute
/scout/company/:id/leads → ShellRoute
/scout/total-market      → ShellRoute
/scout/cadences          → ShellRoute
/scout/cadence/:id       → ShellRoute
/scout/game              → ShellRoute
```

Hunter, Sniper, Basecamp, Reinforcements, Fallback and Recon keep their existing self-contained shells untouched. They remain fully functional and are reachable from the new sidebar. **No fake screens.**

### 6. What is the rollback mechanism?

Four layers, cheapest first:

| Layer | Mechanism | Blast radius | Time to revert |
|---|---|---|---|
| **1. Per-route** | Move a route out of `<Route element={<ShellRoute/>}>` back to `<ProtectedRoute withLayout>`. Both wrappers are retained this sprint. | One route | ~1 minute |
| **2. Scout only** | `ScoutMain` keeps its self-contained rendering path behind `SHELL_MIGRATION.scoutInShell`. Flip false → the old rail returns. | Scout | ~1 minute |
| **3. Whole slice** | `src/constants/shellMigration.js` exports one flag consumed by `App.jsx`. False → every in-scope route reverts to pre-migration wrapping. | Vertical slice | ~1 minute, no deploy if flag is env-driven |
| **4. Git** | Migration is one branch, phase-by-phase commits. `git revert` of the merge commit. | Everything | one deploy cycle |

**Barry data rollback:** the unified thread writes to `barryConversations/missionControl` — the key `BarryChatPanel` already uses. Legacy `drawer_${module}` documents are **read-migrated, never deleted**: on first load the shell reads the module thread if the unified thread is empty. Rolling back leaves both intact. No destructive migration in Sprint 1.

---

## Constraints found during assessment

Flagged per the escalation protocol. **Neither blocks the locked architecture**; both are scope observations, not conflicts. Proceeding, with the resolution noted.

**C1 — `cloneElement` prop injection is incompatible with `<Outlet/>`.**
`MainLayout` currently injects `orientation`, `openBarry` and `setBarryPageContext` into its child by cloning it (`MainLayout.jsx:250-259`). Under a layout route the child is an `<Outlet/>`, which cannot receive them this way. **Resolution:** replace with a `ShellContext` provider consumed by a `useShell()` hook. Strictly better — it works at any depth, so Contact Profile and Quick Engage can reach Barry without prop drilling. Implemented in Phase 1.

**C2 — Two Phase 1 requirements have no existing implementation.**
The brief lists "global search entry point" and "notifications entry point" among what MainLayout must own. There is **no global search** in the product today, and `NotificationCenter` exists but is not mounted in any shell. Phase 2 also says *"Do not add new badges, counters, animations... The goal is clarity, not feature expansion."* Building a global search feature is out of scope for a chrome migration. **Resolution:** the shell reserves and renders both mount points in the top bar. Notifications is wired to the existing `NotificationCenter`. Global search renders a disabled affordance with an explicit "Coming soon" title rather than a fake input. **Flagged for Aaron:** if global search is meant to ship this sprint it is a feature, not a migration, and needs its own scope.

**C3 — Mobile will inherit a second bottom nav.**
Putting `/scout` inside MainLayout means `BottomNav` renders on Scout, which already has its own mobile bottom nav. Mobile is explicitly out of scope. **Resolution:** Scout's self-contained mobile branch is preserved as-is for `max-width: 768px`, and the shell suppresses its own `BottomNav` on routes whose module renders one. Desktop is unaffected. Mobile reconciliation is handed to the mobile sprint with a written note.

---

## Pre-migration baseline

Captured so Phase 8 has something to compare against.

| Metric | Before |
|---|---|
| Distinct navigation systems | 4 |
| Routes rendering `MainLayout` | 14 |
| Routes rendering a self-contained shell | 10 |
| Authenticated routes with **no** navigation | ~30 |
| Shell unmounts across the Phase 8 journey | **6** (one per transition) |
| Barry conversation threads | 11 (`drawer_×10` + `missionControl`) |
| Barry instances mounted across the journey | 4 (a new one per shell) |
| Routes where logout is reachable (desktop) | 17 of ~50 |
| Scout features reachable from `/scout` | 6 of 8 (Total Market, Game Mode unreachable) |
| `MODULE_RAIL` / `NAV_SECTIONS` copies | 9 |
| Test suite | see Phase 8 |

Targets for the in-scope slice: shell unmounts **0**, Barry instances **1**, Barry threads **1**, logout reachable on **all** in-scope routes, Scout features reachable from Scout **8 of 8**.
