# Module Migration Log
**Team A | Idynify | Moving the remaining modules into the global shell**

Order shipped: **Hunter → Sniper → Basecamp → Reinforcements → Fallback → Recon → Command Center.**

Recon and Command Center are swapped relative to the brief's order. Command
Center went last on purpose: it is the only one with an open product question
attached, and doing it last meant every mechanical migration was finished
before that question had any chance to hold one up.

---

## Consistency checklist

| Module | Wide sidebar | Wordmark | Active highlight | Sub-nav panel | Barry card |
|---|:--:|:--:|:--:|:--:|:--:|
| Mission Control | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scout | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Hunter** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Sniper** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Basecamp** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Reinforcements** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Fallback** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Recon** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Command Center** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Settings** | ✓ | ✓ | n/a | ✓ | ✓ |

**10 of 10. The desktop shell is complete.** Every screen in the product
renders into one shell that is mounted once. Nothing ships application chrome
of its own any more — there is one sidebar, one wordmark, one active-state
treatment, one sub-nav component and one Barry.

Settings came last and is documented separately in `TOPBAR_AND_MOBILE.md`,
because it arrived with the top bar and mobile work rather than as one of the
seven module migrations. Its active-highlight cell is n/a: Settings is not in
the sidebar — it is reached from the top bar's account menu and the mobile
drawer.

---

## The recipe

Now mechanical, and enforced by a table-driven test rather than a checklist someone has to remember:

1. Move the module's routes into the `ShellRoute` group in `App.jsx`, and mirror them in the rollback branch.
2. Delete the module's `MODULE_RAIL`, icon rail, theme picker, settings button, home button, user footer, `BarryChat` instance and user resolution.
3. Render `<ModuleSubNav>` with the module's existing sections and descriptions — unchanged.
4. Drop `{ replace: true }` from tab writes so Back steps back a section instead of exiting the module.
5. Add the module to `MODULES_WITH_OWN_MOBILE_NAV` so mobile does not get two bottom navs.
6. Add one row to `MIGRATED` in `src/test/moduleMigration.test.jsx`, and a probe to the journey in `shellPersistence.test.jsx`.

Step 6 is the important one: each new row inherits the full checklist — no rail, no Barry of its own, no settings/home/user-footer controls, shared panel, header naming, every section and description intact, active section from the URL, collapse under its own key. A module cannot be migrated and quietly skip a step.

---

## 1 — Hunter

`HunterMain.jsx`: **667 → 338 lines.**

Sections unchanged: Blitz Mode, All People, Companies, Follow Up Now, Today's Actions, Replied, Active, New (Unengaged).

Routes moved: `/hunter`, `/hunter/create-mission`, `/hunter/mission/:id`, `/hunter/campaign/new`, `/hunter/campaign/:id`.

**`/hunter/blitz` stays outside the shell, on purpose.** It is a timed focus mode with its own header and its own way back; chrome would defeat it. This matches the Phase 0 classification, where Blitz was the one module route marked *intentionally* chrome-free.

```
sidebar 220px | active: Hunter | sub-nav 190px
sections: Blitz Mode · All People · Companies · Follow Up Now ·
          Today's Actions · Replied · Active · New (Unengaged)
own rail present? false
```

## 2 — Sniper

`SniperMain.jsx`: **642 → 325 lines.**

Sections unchanged: People, Companies, Pipeline, Targets, Touches, Playbooks, Outcomes.

Route moved: `/sniper`.

```
sidebar 220px | active: Sniper | sub-nav 190px
sections: People · Companies · Pipeline · Targets · Touches · Playbooks · Outcomes
```

## 3 — Basecamp

`BasecampMain.jsx`: **670 → 352 lines.**

Sections unchanged: People, Companies, Engage, CSM.

Route moved: `/basecamp`.

**The Barry persona split is resolved.** This module has always declared
`basecamp` (the CSM persona, teal) while the old route maps sent `/basecamp`
to `homebase` (the GUIDE persona, red) — so Barry greeted a customer-success
screen with *"what do you need to set up or configure today?"*, and the
persona the module intended was unreachable through navigation. Basecamp no
longer mounts its own `BarryChat` at all, so the wrong persona cannot be
applied; the shell resolves it from `navigationModel`, which is locked to
`basecamp`. `MODULE_CONFIG.homebase` is now referenced only by the orphaned
`BarryTrigger` and can go with it in the cleanup sprint.

The CSM dashboard needs a user id. It now comes from `useActiveUserId()`
rather than the deleted per-shell resolver, so an admin viewing a tenant still
sees that tenant's portfolio.

```
sidebar 220px | active: Basecamp | sub-nav 190px
sections: People · Companies · Engage · CSM
```

Also fixed while here: sub-nav taglines wrap to two lines instead of
truncating. Scout's fits on one; "Customer success and retention" did not, and
a module's stated purpose is not worth losing to an ellipsis.

## 4 — Reinforcements

`ReinforcementsMain.jsx`: **637 → 303 lines.**

Sections unchanged: Dashboard, Opportunities, Leaderboard, Record, Nurture.

Route moved: `/reinforcements`.

```
sidebar 220px | active: Reinforcements | sub-nav 190px
sections: Dashboard · Opportunities · Leaderboard · Record · Nurture
```

## 5 — Fallback

`FallbackMain.jsx`: **626 → 296 lines.**

Sections unchanged: Comeback, People, Companies.

Route moved: `/fallback`.

```
sidebar 220px | active: Fallback | sub-nav 190px
sections: Comeback · People · Companies
```

## 6 — Recon

`ReconMain.jsx`: **609 → 290 lines.**

Nine sections unchanged: Overview, Alignment Brief, User Profile, ICP
Intelligence, Messaging & Voice, Objections, Competitive Intel, Buying Signals,
Barry Training.

Routes moved: `/recon` and its six children.

**Recon is the one module that already used real nested routes** rather than a
`?tab=` param — which is why it was the only module with correct Back-button
behaviour before any of this started. That is preserved rather than converted:
its sub-nav items navigate, they do not switch a local tab, and its children
still render through `<Outlet/>`. The active item is derived from the pathname,
so the panel and the address bar cannot disagree.

That makes it the only row in `moduleMigration.test.jsx` whose active-section
assertion exercises path resolution instead of a query param, which is worth
having: the shared panel now has both resolution strategies under test.

Step 4 of the recipe (drop `{ replace: true }`) does not apply — there were no
tab writes to fix.

```
sidebar 220px | active: Recon | sub-nav 190px
sections: Overview · Alignment Brief · User Profile · ICP Intelligence ·
          Messaging & Voice · Objections · Competitive Intel ·
          Buying Signals · Barry Training
```

## 7 — Command Center

`PeopleMain.jsx`: **792 → 500 lines.** The smallest drop of the seven, and not
because less came out — the icon rail, hand-built sub-nav, theme picker,
settings button, home button, user footer and Barry instance all went. What
stayed is a mobile branch this module carries in full, plus the missions and
campaigns data loading the sections depend on.

Nine sections unchanged: People, Companies, Missions, Campaigns, Cadences, Go
To War, Weapons, Arsenal, Outcomes.

Route moved: `/command-center`. The `/people` and `/hunter/*` redirects stay
where they are, being redirects.

**Migrated as-is.** Whether these nine belong together behind one route is a
real information-architecture question. It is deliberately not answered here:
the shell gets finished and made consistent first, and the product decision
gets made against a consistent shell rather than in the middle of a migration.

Two things changed that were not on the recipe:

- **The active section is derived from the URL** rather than mirrored into
  state by an effect. The old version held it in state and had an effect push
  the URL into it, so for one render after every navigation the panel showed
  the previous section while the address bar showed the new one.
- **`ModuleSubNav` gained optional per-item badges.** Command Center is the
  only module that shows a count (active missions), and it is existing content
  — the shared panel had to be able to carry it or migrating the module would
  have meant dropping something it displayed.

```
sidebar 220px | active: Command Center | sub-nav 190px
sections: People · Companies · Missions ③ · Campaigns · Cadences ·
          Go To War · Weapons · Arsenal · Outcomes
```

### Two fixes this migration forced

**Section descriptions were truncating.** `.module-subnav-item-desc` was
`white-space: nowrap` with an ellipsis, inherited from Scout's panel where
every description is short enough to fit. Command Center's are the longest in
the product and its pre-migration panel wrapped them, so the shared panel would
have clipped content the module used to show — "Channel selector, message …",
which loses the half that distinguishes the section. Descriptions now wrap to
two lines, the same treatment the header tagline already had. Verified across
every module: nothing clips.

**`inScope` is gone from `navigationModel.js`.** It marked the Sprint 1
vertical slice — which modules were in the shell versus still shipping their
own. Every module is in the shell now, so the flag had no referent and no
readers, while still saying `false` for seven modules that had been migrated.
Deleted rather than left saying something untrue.

---

## Verification

`shellPersistence.test.jsx` walks **Mission Control → Scout → Contact → Scout → Hunter → Sniper → Basecamp → Reinforcements → Fallback → Recon → Command Center → Mission Control** — every module in the product — and asserts a shell mount count of exactly **1**. Pre-migration that journey mounted the shell 12 times.

Two crossings get their own tests:

- **Scout → Hunter.** The one "Move to Hunter" lands on, and the one the original audit called the worst moment in the product — Scout's rail out, Hunter's rail in, Barry destroyed and rebuilt in between. It now changes nothing but the content.
- **Scout → Hunter → Sniper.** The whole pipeline on one shell, with `current_module` and `source_route` tracking correctly at each step.

`moduleMigration.test.jsx` runs its eight-assertion checklist against **all seven** migrated modules — 56 tests. Each migration added one row and inherited the whole checklist, which is why none of them could quietly skip a step.

Suite **497 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router, `ReconSectionEditor` and `HunterContactCard` failures, confirmed identical on `HEAD` without these changes. Build passes; lint at baseline on every file touched.

---

## Carried forward

**Mobile is unreconciled.** Each migrated module keeps its mobile branch verbatim and joins `MODULES_WITH_OWN_MOBILE_NAV`, so mobile still shows the module's own top bar alongside the shell's. Doing it per module would leave them inconsistent mid-flight; the mobile sprint reconciles all of them at once.

**No screen recordings.** The brief asks each migration PR to include one. Not possible here: authenticated routes redirect to `/login`, and signing in needs real credentials plus reachable Firebase Auth. Screenshots are the real components rendered in Chromium via a temporary harness, deleted before commit — they verify structure, not a live journey. This applied to all seven migrations, so it is worth deciding whether someone with product access records them or the requirement becomes something reproducible in CI.

**Logo assets** are still absent, so the wordmark, mark and Barry avatar all render their fallbacks.

---

## Next

The desktop shell is done. Three things are now decidable that were not before,
because they are product questions that needed a consistent shell to be asked
against:

**1. Command Center's contents.** Nine sections behind one route: People,
Companies, Missions, Campaigns, Cadences, Go To War, Weapons, Arsenal,
Outcomes. Some overlap other modules — People and Companies also exist in
Hunter, Basecamp, Sniper and Fallback; Cadences is Scout's. Whether this is a
setup hub, a duplicate of several modules, or two destinations wearing one name
is worth deciding now. Nothing about it was changed during the migration
specifically so this decision is made on the merits.

**2. Mobile.** *(Partly addressed — see `TOPBAR_AND_MOBILE.md`.)* The
hamburger drawer, the More sheet and the mobile top bar have since been done.
What remains is that every module still carries its own mobile branch and its
own top bar, each listed in `MODULES_WITH_OWN_MOBILE_NAV` so the shell does not
stack a second bottom nav on top. Those in-module tab strips are confirmed
correct for mobile; what is not reconciled is that some of those top bars carry
their own theme picker and settings button, now duplicating the drawer. One
pass, not eight.

**3. Barry's navigation contract in production.** The contract is published and
tested, and `barryMissionChat.js` renders it into the system prompt. What has
not happened is watching real conversations to see whether "the user is looking
at Sarah Chen, in Scout, having arrived from Mission Control" actually changes
Barry's answers for the better.

One correction stands, and is confirmed: an earlier brief said Command Center
"is not a top-level module" because it already appears in Hunter's sub-nav. It
does not — Hunter's sub-nav is Blitz Mode, All People, Companies, Follow Up
Now, Today's Actions, Replied, Active, New. Command Center is a first-class
sidebar item and stays exactly where it is.
