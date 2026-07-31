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
| Basecamp | migrate | migrate | migrate | restyle | migrate |
| Reinforcements | migrate | migrate | migrate | restyle | migrate |
| Fallback | migrate | migrate | migrate | restyle | migrate |
| Command Center | migrate | migrate | migrate | restyle | migrate |
| Recon | migrate | migrate | migrate | restyle | migrate |

**4 of 9.** The whole pipeline — Scout, Hunter, Sniper — is now one shell.

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

---

## Verification

`shellPersistence.test.jsx` walks **Mission Control → Scout → Contact → Scout → Hunter → Sniper → Mission Control** and asserts a shell mount count of exactly **1**. Pre-migration that journey mounted the shell 7 times.

Two crossings get their own tests:

- **Scout → Hunter.** The one "Move to Hunter" lands on, and the one the original audit called the worst moment in the product — Scout's rail out, Hunter's rail in, Barry destroyed and rebuilt in between. It now changes nothing but the content.
- **Scout → Hunter → Sniper.** The whole pipeline on one shell, with `current_module` and `source_route` tracking correctly at each step.

`moduleMigration.test.jsx` runs its eight-assertion checklist against every migrated module — 16 tests across Hunter and Sniper today, growing by 8 per migration.

Suite **457 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router failures. Build passes, lint clean on every file touched.

---

## Carried forward

**Mobile is unreconciled.** Each migrated module keeps its mobile branch verbatim and joins `MODULES_WITH_OWN_MOBILE_NAV`, so mobile still shows the module's own top bar alongside the shell's. Doing it per module would leave them inconsistent mid-flight; the mobile sprint reconciles all of them at once.

**No screen recordings.** The brief asks each migration PR to include one. Not possible here: authenticated routes redirect to `/login`, and signing in needs real credentials plus reachable Firebase Auth. Screenshots are the real components rendered in Chromium via a temporary harness, deleted before commit — they verify structure, not a live journey. This applies to all seven migrations, so it is worth deciding whether someone with product access records them or the requirement becomes something reproducible in CI.

**Logo assets** are still absent, so the wordmark, mark and Barry avatar all render their fallbacks.

---

## Next

**Basecamp.** Same recipe. Resolve the `homebase`/`basecamp` Barry persona split as part of it — the module declares `basecamp` (CSM) while the old route maps sent `/basecamp` to `homebase` (GUIDE), so the intended persona was unreachable.
