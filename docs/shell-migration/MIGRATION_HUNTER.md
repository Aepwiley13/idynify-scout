# Module Migration 1 of 7 — Hunter
**Team A | Idynify**

Hunter now renders inside the global shell. First of the seven remaining modules, in the agreed order: **Hunter → Sniper → Basecamp → Reinforcements → Fallback → Command Center → Recon.**

---

## What changed

`HunterMain.jsx` went **667 → 338 lines**. Everything removed was chrome the shell already provides:

| Deleted | Now provided by |
|---|---|
| `MODULE_RAIL` + the 60px icon rail | the wide sidebar |
| Its own `BarryChat` instance (thread `drawer_hunter`) | the shell's single Barry + context contract |
| Theme picker | Settings → Themes |
| Settings button, "back to Mission Control" button | top bar / sidebar |
| User footer (email + theme name) | sidebar account |
| `Particles`, `BarryAvatar` helpers | — (belonged to the deleted rail) |
| Impersonation-aware user resolution | the shell |

**Hunter's sections did not change.** Blitz Mode, All People, Companies, Follow Up Now, Today's Actions, Replied, Active, New (Unengaged) — same items, same descriptions, same order. Only where the panel's formatting comes from changed: it renders the shared `ModuleSubNav`, so it cannot drift from Scout's.

Also fixed while in there: tab writes no longer use `{ replace: true }`, so browser Back steps back a section instead of exiting Hunter entirely — the same defect Scout had.

## Routes

`/hunter`, `/hunter/create-mission`, `/hunter/mission/:id`, `/hunter/campaign/new` and `/hunter/campaign/:id` moved into the `ShellRoute` group, with matching entries in the rollback branch.

**`/hunter/blitz` stays outside the shell, on purpose.** It is a timed focus mode with its own header and its own way back; chrome would defeat it. This matches the Phase 0 classification, where Blitz was the one module route marked *intentionally* chrome-free.

## Verified

```
sidebar 220px | active: Hunter | sub-nav 190px
hunter sections: Blitz Mode · All People · Companies · Follow Up Now ·
                 Today's Actions · Replied · Active · New (Unengaged)
own rail present? false
```

Tests: 8 new in `hunterMigration.test.jsx` — no module rail, no Barry of its own, no settings/home/user-footer controls, uses the shared panel, every section and description intact, header naming, active section from the URL, collapse under its own storage key without touching Scout's.

`shellPersistence.test.jsx` now walks **Mission Control → Scout → Contact → Scout → Hunter → Mission Control** and still asserts a shell mount count of exactly **1**. Pre-migration that journey mounted the shell 6 times. There is also a dedicated Scout → Hunter test: this is the crossing "Move to Hunter" lands on, and the one that used to swap the entire application chrome — Scout's rail out, Hunter's rail in, Barry destroyed and rebuilt in between. It now changes nothing but the content.

Suite **448 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router failures. Build passes, lint clean on every file touched.

## Consistency checklist

| Module | Wide sidebar | Wordmark | Active highlight | Sub-nav panel | Barry card |
|---|:--:|:--:|:--:|:--:|:--:|
| Mission Control | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scout | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Hunter** | **✓** | **✓** | **✓** | **✓** | **✓** |
| Sniper | migrate | migrate | migrate | restyle | migrate |
| Basecamp | migrate | migrate | migrate | restyle | migrate |
| Reinforcements | migrate | migrate | migrate | restyle | migrate |
| Fallback | migrate | migrate | migrate | restyle | migrate |
| Command Center | migrate | migrate | migrate | restyle | migrate |
| Recon | migrate | migrate | migrate | restyle | migrate |

Three of nine.

## Notes

**Mobile is unreconciled, same as Scout.** Hunter's mobile branch is preserved verbatim and `/hunter` is added to the shell's `MODULES_WITH_OWN_MOBILE_NAV` list so it does not get two bottom navs. Mobile Hunter therefore still shows its own top bar alongside the shell's — the same deferred state Scout is in. The mobile sprint reconciles both at once; doing it per module would leave the two inconsistent in the meantime.

**No screen recording.** The brief asks each migration PR to include one. I cannot produce it here: authenticated routes redirect to `/login` and signing in needs real credentials plus reachable Firebase Auth. The screenshot above is the real components rendered in Chromium via a temporary harness, deleted before commit — it verifies structure, not a live journey. This will be true of all seven migration PRs, so it is worth deciding now whether someone with product access records them or the requirement becomes something reproducible in CI.

## Next

**Sniper.** Its shell is the closest structural twin to Hunter's, and the recipe is now mechanical: move the route, delete the rail, render `ModuleSubNav` with the module's existing sections, drop `{ replace: true }`, add the module to the persistence journey.
