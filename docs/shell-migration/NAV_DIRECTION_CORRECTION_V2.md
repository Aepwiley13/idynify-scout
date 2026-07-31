# Navigation Direction Correction v2 — Two-Layer Navigation
**Team A | Idynify | Two changes only**

> The pattern is already built in Hunter, Command Center, Sniper, Basecamp, Reinforcements, Recon, and Fallback. Add Mission Control to the top of the rail. Give Scout the same expandable sub-nav panel that every other module already has.

Both done. No architecture changes, no new patterns.

---

## Change 1 — Mission Control at the top of the rail

**Where it was already right:** the global shell rail (Sidebar.jsx) has led with Mission Control since the previous PR — home icon, `MC` beneath, first item, above the first divider. That rail renders on Mission Control, Scout and every Scout sub-route.

**Where it was actually broken:** the seven modules not yet migrated into the shell — Hunter, Sniper, Basecamp, Reinforcements, Recon, Fallback and Command Center — still render *their own* rails from a local `MODULE_RAIL` array. Those arrays had no Mission Control entry at all and opened with `COMMAND CENTER`. So on those screens the rail genuinely started somewhere other than Mission Control.

Every one of those seven now leads with Mission Control and follows the locked order:

```
MC · Scout · Hunter · Sniper · Basecamp · Reinforcements · Fallback · Recon
```

Two of those modules also had Fallback and Recon transposed relative to the locked IA; fixed in the same pass.

Each array carries a note that it is transitional — when its module moves into the shell, the array is deleted and the shell's rail takes over. Seven copies is exactly the duplication the shell work exists to end; they are load-bearing only until each module migrates.

---

## Change 2 — Scout's sub-nav panel

The horizontal tab bar is gone. Scout renders the same expandable left panel as every other module:

- 190px, collapses to 0, rail unaffected
- Header: `SCOUT` / *Find and qualify prospects*
- `‹` collapse control top-right, `›` expand affordance when collapsed
- Items as name + short description, active item marked with the left accent bar
- Collapse state remembered in `scout_subnav_collapsed`, per module

```
SCOUT · Find and qualify prospects
  Daily Discoveries   Review queue
  People              My leads
  Saved Companies     Hunt list
  Scout+              Add contacts
  Cadences            Bulk outreach history
  Total Market        Full addressable market
  ICP Settings        Targeting criteria
  Game Mode           15 in 30 — beta
```

## Verified

Measured in Chromium against the real components:

```
rail first item: Mission Control | rail 64px | sub-nav 190px
sub-nav: Daily Discoveries · People · Saved Companies · Scout+ ·
         Cadences · Total Market · ICP Settings · Game Mode
collapsed sub-nav width: 0px | rail still 64px
```

Tests: 7 new in `scoutSubNav.test.jsx` — panel present and tab bar absent, header content, all eight sections in order, descriptions, single active item, collapse/expand with persistence across remount. Suite **431 passed / 10 failed**, the 10 being the unchanged pre-existing `UserSettings` Router failures. Build passes. Lint findings in the seven module shells: **38 before, 38 after** — nothing new introduced.

---

## Two things to decide

**1. Command Center is still in the rails, at the end.**

The brief says it is not a top-level module and should not be a rail item, on the grounds that *"it already appears in Hunter's sub-nav panel."* It does not. Hunter's sub-nav is Blitz Mode, All People, Companies, Follow Up Now, Today's Actions, Replied, Active, New (Unengaged) — no Command Center. Nothing else links to `/command-center` except Mission Control's module grid.

Removing it outright would have stranded a live module behind a single tile on one screen, so it was **demoted to the end of the rail rather than deleted**, and flagged here. Two ways to finish it:

- add Command Center to Hunter's sub-nav, then drop it from the rails; or
- leave it last in the rail.

One line either way — it just needs a home first.

**2. Scout's panel has no user footer.**

The other modules end their panel with the signed-in email and theme name. Scout deliberately does not: it renders inside the shell, and the shell's rail already owns the account. Repeating it would be the duplication the shell work removed. This is the one intentional difference from *"same everything."*

---

## Unchanged

Rail width (64px) · collapse behaviour · sub-nav panel width (190px) · all module content · Barry at the bottom of the rail · the pink/magenta accent · the theme system · locked IA · `MainLayout` as the single shell · `executeSendAction()` routing · the breadcrumb.
