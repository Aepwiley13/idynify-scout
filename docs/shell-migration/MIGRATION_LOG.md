# Module Migration Log
**Team A | Idynify | Moving the remaining modules into the global shell**

Order: **Hunter → Sniper → Basecamp → Reinforcements → Fallback → Command Center → Recon.**

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
| Fallback | migrate | migrate | migrate | restyle | migrate |
| Command Center | migrate | migrate | migrate | restyle | migrate |
| Recon | migrate | migrate | migrate | restyle | migrate |

**6 of 9.** The whole pipeline — Scout, Hunter, Sniper — plus Basecamp and Reinforcements. Three left: Fallback, Command Center, Recon.

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

---

## Verification

`shellPersistence.test.jsx` walks **Mission Control → Scout → Contact → Scout → Hunter → Sniper → Basecamp → Reinforcements → Mission Control** and asserts a shell mount count of exactly **1**. Pre-migration that journey mounted the shell 9 times.

Two crossings get their own tests:

- **Scout → Hunter.** The one "Move to Hunter" lands on, and the one the original audit called the worst moment in the product — Scout's rail out, Hunter's rail in, Barry destroyed and rebuilt in between. It now changes nothing but the content.
- **Scout → Hunter → Sniper.** The whole pipeline on one shell, with `current_module` and `source_route` tracking correctly at each step.

`moduleMigration.test.jsx` runs its eight-assertion checklist against every migrated module — 32 tests across Hunter, Sniper, Basecamp and Reinforcements, growing by 8 per migration.

Suite **473 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router failures. Build passes, lint clean on every file touched.

---

## Carried forward

**Mobile is unreconciled.** Each migrated module keeps its mobile branch verbatim and joins `MODULES_WITH_OWN_MOBILE_NAV`, so mobile still shows the module's own top bar alongside the shell's. Doing it per module would leave them inconsistent mid-flight; the mobile sprint reconciles all of them at once.

**No screen recordings.** The brief asks each migration PR to include one. Not possible here: authenticated routes redirect to `/login`, and signing in needs real credentials plus reachable Firebase Auth. Screenshots are the real components rendered in Chromium via a temporary harness, deleted before commit — they verify structure, not a live journey. This applies to all seven migrations, so it is worth deciding whether someone with product access records them or the requirement becomes something reproducible in CI.

**Logo assets** are still absent, so the wordmark, mark and Barry avatar all render their fallbacks.

---

## Next

**Fallback.** Same recipe; its sections are Comeback, People and Companies.
