# Final Navigation Brief — Three-Layer Navigation
**Team A | Idynify | Supersedes all previous navigation direction corrections**

```
[Layer 1]          [Layer 2]              [Layer 3]
Wide sidebar   →   Module sub-nav     →   Content
220px, fixed       190px, collapsible     fills the rest
```

---

## The three changes

### 1. IDYNIFY wordmark

Replaces the icon mark at the top of the sidebar. Clicking it returns to Mission Control.

`ASSETS.logoFull` (`/assets/Idynify_logo1.png`) is used when it loads. **It is not in this repository** — nor are `barry_AI.jpg` or `Short_Logo_Idynify.png` — so a CSS text wordmark renders in its place: bold italic magenta, cyan outline stroke, gradient underline bar, matching the brand mark's description. Without it the top of the sidebar is simply blank wherever the assets are not deployed, which is every environment this code has run in. Worth checking whether those three assets are meant to ship with the app or come from somewhere else.

### 2. Command Center added to the sidebar

It was genuinely missing. It now sits last in the module list with the existing Command Center icon, and `/command-center` is reachable from global navigation for the first time. This also settles the open question from the previous PR — it was demoted to the end of the module rails and flagged; it is now a first-class sidebar item.

### 3. Scout's sub-nav panel

Already shipped in the previous PR. Verified again here: the horizontal tab bar is gone and Scout renders the same expandable left panel as every other module, with the eight sections, short descriptions, and the `‹` collapse control.

### Also, because the sidebar itself changed shape

The brief's Layer 1 spec is a different component from the icon rail, so the sidebar was rebuilt to match it: 220px, always visible, never collapses, no icon-only state, no hover-to-expand, full text labels, active module as a filled violet pill with white text, no group headers, no subtitles, no theme toggle, Barry as a card rather than a nav item.

---

## Verified

Measured in Chromium against the real components:

```
sidebar 220px | sub-nav 190px | active: Scout
modules: Mission Control · Scout · Hunter · Sniper · Basecamp ·
         Recon · Reinforcements · Fallback · Command Center
barry card: "🐻 / Barry / AI SDR / Online"
collapsed sub-nav: 0px | sidebar still 220px
```

Tests: 14 in `sidebarLockedIA.test.jsx` (rewritten for the wide sidebar), 3 new in `navigationModel.test.js` for the sidebar order, 7 in `scoutSubNav.test.jsx`. The "what the sidebar does NOT have" list is tested as hard as the positive spec — group headers, subtitles, collapse control and theme toggle have each been in this component at some point across these sprints.

Suite **433 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router failures. Build passes. Lint clean on every file touched.

---

## Decisions inside the spec

**Sidebar order is a flat list, not the group order.** The brief specifies Recon between Basecamp and Reinforcements, and states the Pipeline / Relationships / Intelligence grouping is architectural rather than visual. So `SIDEBAR_ORDER` is its own exported list and `GROUP_ORDER` is retained to describe the architecture. A test asserts they deliberately differ while containing the same modules — otherwise the next person to touch this reasonably assumes one is a bug.

**Layer 2 stays at 190px.** The diagram says ~220px, but the brief also says the existing panels in Hunter, Sniper, Basecamp, Reinforcements, Recon and Fallback are correct and must not change. Matching them beat matching the number. Trivial to change if you want 220 everywhere — one value.

**Help / Support moved to the top bar.** The Layer 1 spec is wordmark + modules + Barry card, and Help was only ever in the sidebar. Dropping it outright would have removed the only in-product route to support, so it is now an icon button next to Settings, reusing the Crisp widget already mounted for authenticated users.

**Theme was removed with nothing to replace.** Settings already has a Themes section, so the capability is intact.

**The trial banner is not built.** The brief marks it optional and trial-user-only; `useSubscription` exposes no trial-day data, so there is nothing to render from. It needs a data field before it needs a component.

---

## The consistency checklist cannot pass yet — and here is exactly why

| Module | Wide sidebar | Logo | Highlighted | Sub-nav panel | Barry card |
|---|:--:|:--:|:--:|:--:|:--:|
| Mission Control | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scout | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hunter | ✗ | ✗ | ✗ | ✓ | ✗ |
| Sniper | ✗ | ✗ | ✗ | ✓ | ✗ |
| Basecamp | ✗ | ✗ | ✗ | ✓ | ✗ |
| Recon | ✗ | ✗ | ✗ | ✓ | ✗ |
| Reinforcements | ✗ | ✗ | ✗ | ✓ | ✗ |
| Fallback | ✗ | ✗ | ✗ | ✓ | ✗ |
| Command Center | ✗ | ✗ | ✗ | ✓ | ✗ |

The brief lists *"MainLayout as the single application shell — one shell, all routes"* under **What Does Not Change**. That is not yet true, and no sidebar work can make it true.

**Only Mission Control and Scout render inside the shell.** The other seven modules are still self-contained shells: each renders its own icon rail, its own Barry instance and its own layout, and `MainLayout` — which owns the wide sidebar — is never mounted on those routes. Sprint 1 migrated a vertical slice deliberately, and every brief since has said "no architecture changes, no other scope", so the remaining seven were never migrated.

The sub-nav column is the only row that passes for them, because those panels are theirs and always have been.

**What closes it:** the per-module migration in `SPRINT1_DELIVERY.md` § 6 — move the route into the `ShellRoute` group, delete the module's `MODULE_RAIL` and rail markup, keep its sub-nav panel, point its Barry at the shell. Recommended order: **Hunter → Sniper → Recon → Basecamp → Reinforcements → Fallback → Command Center.** Roughly one PR each; Scout was the hard one and it is done.

Until then, a user moving from Scout to Hunter still sees the chrome change. That is the last structural gap in the navigation, and it is module migration work, not sidebar work.

---

## Unchanged

`MainLayout` as the shell for the routes already inside it · the sub-nav panels in Hunter, Sniper, Basecamp, Reinforcements, Recon, Fallback and Command Center · all module content · the Barry context contract · `executeSendAction()` routing · the pink/magenta top bar accent · the breadcrumb.
