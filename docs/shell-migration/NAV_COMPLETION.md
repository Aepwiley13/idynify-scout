# Desktop Navigation Completion — Three Changes
**Team A | Idynify**

Sidebar toggle, sub-nav style consistency, simplified Barry card. Module migration continues separately, one module per PR, Hunter first.

---

## Change 1 — Sidebar toggle (wide ↔ compact)

| | Wide (default) | Compact |
|---|---|---|
| Width | 220px | 64px |
| Brand | IDYNIFY wordmark | ID mark |
| Modules | icon + full name | icon + short label |
| Barry | card with name + chevron | icon only |
| Active module | filled violet pill | filled violet pill |

Toggled by the chevron on the sidebar's right edge, near the top. Persisted in `localStorage`, so it survives navigation and reload.

**The mode lives in `ShellContext`, not in the sidebar.** The sidebar is `position: fixed`, so the content area is offset by a margin that has to match its width — one owner means the two can never disagree about how wide the sidebar currently is. `MainLayout` puts `sidebar-wide` / `sidebar-compact` on `.main-layout` and the CSS follows.

Verified in Chromium:

```
WIDE    sidebar 220px | sub-nav 190px | barry: "🐻 Barry"
COMPACT sidebar  64px | sub-nav 190px (unchanged) | barry: "🐻"
labels: MC SCOUT HUNTER SNIPER BASECAMP RECON REINFORCEMENTS FALLBACK COMMAND CENTER
main-content margin-left → { wide: "220px", compact: "64px" }
```

The sub-nav stays 190px through the toggle, as required — the two collapse independently.

In compact, the visible label shortens but **the accessible name stays the full locked label**, and `title` carries it on hover, so "MC" is never the only name on offer. The two longest — `REINFORCEMENTS` and `COMMAND CENTER` — ellipsis at 64px; hovering gives the full name. Say the word if you'd rather they had real abbreviations.

Mobile keeps the wide drawer in both modes: a 64px drawer is not useful, and the toggle is a desktop density control.

---

## Change 2 — Sub-nav style consistency

Rather than asking each migrating module to match Scout's panel by eye, **Scout's panel is now a component**: `components/layout/ModuleSubNav.jsx`, lifted out of `ScoutMain` unchanged, with its CSS moved to `ModuleSubNav.css` byte-for-byte.

Scout renders it and looks identical — all 7 Scout sub-nav tests pass untouched, which is the proof the extraction changed nothing.

Migrating a module is now:

```jsx
<ModuleSubNav
  title="HUNTER"
  tagline="Engage and follow up"
  items={HUNTER_ITEMS}          // { id, label, desc, Icon }
  activeId={activeTab}
  onSelect={switchTab}
  storageKey="hunter_subnav_collapsed"
/>
```

Keep each module's existing sections and descriptions exactly as they are — only the visual formatting comes from the component, which is what the brief asks for. Collapse state, persistence, the `‹` control and the expand affordance are all handled.

Two things were added to the component during the migrations, both because a module would otherwise have lost content it displayed: an optional per-item `badge` (Command Center's active-missions count, the only one in the product), and descriptions that wrap to two lines instead of truncating on one.

This matters because "restyle to match Scout" is the same instruction that produced nine diverging copies of the module rail before the shell migration. A shared component makes matching automatic instead of aspirational.

---

## Change 3 — Barry card simplified

Avatar, "Barry", chevron. `AI SDR` and the `Online` status indicator are gone. In compact mode, the icon alone.

---

## Verified

Tests: 20 in `sidebarLockedIA.test.jsx` (6 new for the toggle: default mode, collapse/expand, short labels with full accessible names, active state preserved in compact, Barry reduced to an icon, mode remembered across remount), 7 in `scoutSubNav.test.jsx` unchanged and passing after the extraction, 15 in `navigationModel.test.js`.

One assertion was **removed**: "has no collapse or expand control". It was correct under the previous brief and is contradicted by this one — the toggle is now required, and is covered by the new block.

Suite **439 passed / 10 failed** — the 10 are the unchanged pre-existing `UserSettings` Router failures. Build passes, lint clean on every file touched.

---

## Still open

**Logo assets.** `/assets/Idynify_logo1.png`, `Short_Logo_Idynify.png` and `barry_AI.jpg` are still absent, so all three fall back: CSS wordmark, gradient `ID` mark, bear glyph. Agreed this is not shippable — the fallbacks exist so the sidebar is never blank, not as the brand. Waiting on the files.

**Module migration.** *(Closed — see `MIGRATION_LOG.md`.)* At the time of writing only Mission Control and Scout rendered inside the shell, and the other seven kept their own icon rails, so the wide sidebar, wordmark, toggle and Barry card did not appear on them. All seven have since been migrated in the order set out below. Every module in the product now renders into one shell, mounted once.

Per the brief, each migration PR includes a screen recording of the module's journey before and after. **I cannot produce those here** — every authenticated route redirects to `/login` and signing in needs real credentials plus reachable Firebase Auth, neither available in this environment. Someone with product access needs to record them, or the requirement needs to change to something reproducible in CI.
