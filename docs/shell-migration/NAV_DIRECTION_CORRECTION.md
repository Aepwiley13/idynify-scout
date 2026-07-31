# Navigation Direction Correction — Global Icon Rail
**Team A | Idynify | Sidebar component only**

Replaces the Sprint 1 text sidebar with the global icon rail. **No other scope.** The shell architecture, routing, breadcrumb, Barry contract and Quick Engage work from Sprint 1 are untouched.

---

## What changed

| | Sprint 1 text sidebar | Global icon rail |
|---|---|---|
| Width | ~260px, collapsible to 64px | **64px, fixed — no collapse** |
| Labels | Every item, always | **Active item only** |
| Subtitles | "Find and qualify prospects", etc. | **Removed** |
| Grouping | Permanent `PIPELINE` / `RELATIONSHIPS` / `INTELLIGENCE` headers | **Dividers** |
| Hover | — | **Tooltip with the full locked label** |
| Barry | Utility row with Settings and Help | **Bottom, below a divider, with the account** |
| Theme | Row in the sidebar | **Account menu** |

Content area gains **196px** on every authenticated route.

## Verified

```
Mission Control  width=64px  activeLabel=["MC"]
Scout            width=64px  activeLabel=["SCOUT"]
Hunter           width=64px  activeLabel=["HUNTER"]
```

Measured in Chromium against the real component. The rail is the same 64px on all three routes — *"the rail never changes shape, width, or structure."*

Tests: 15 in `sidebarLockedIA.test.jsx`, rewritten for the rail. Suite 424 passed / 10 failed — the 10 are the pre-existing `UserSettings` Router failures, unchanged. Build passes, lint clean.

---

## Decisions worth knowing about

**Grouping is not only visual.** Removing the text headers would have made the hierarchy purely decorative for screen-reader users, so each group is a `<ul>` with an accessible name (`pipeline`, `relationships`, `intelligence`). Dividers carry it visually; the accessible name carries it otherwise. A test asserts both.

**`railLabel` is a display abbreviation, never an alternative name.** Only Mission Control (`MC`) and Settings (`SET`) have one — both taken from the brief's own diagram. The tooltip always shows the full locked label, so "MC" is never the only name a user is offered. This is deliberately not a loophole in the locked vocabulary rule.

**The active label is absolutely positioned.** An active item must not be taller than an inactive one, or the rail's rhythm shifts as you navigate. Buttons are a fixed 48×44 regardless of state.

**Tooltips are `position: fixed`, not absolute.** The nav scrolls when the module list outgrows a short viewport, and a scroll container clips on *both* axes — CSS cannot express "scroll vertically, overflow horizontally", because `overflow-y: auto` forces `overflow-x` to compute to `auto`. An absolutely positioned tooltip was cut off at the rail's edge with only its arrow escaping; caught in a screenshot, then confirmed by measuring the clipping ancestor. `positionTooltip()` sets top/left from the button's rect on hover and focus. This is the same trade Linear and Slack make by portalling their rail tooltips.

**Barry has a glyph fallback.** The previous rails hid the `<img>` on error, which left an empty button whenever the asset failed — and Barry is the one control with no icon to fall back to. `/assets/barry_AI.jpg` and `/assets/Short_Logo_Idynify.png` both 404 in this repo (they are not in `public/`), so this is not hypothetical. Barry now falls back to a bear; the brand mark falls back to its gradient.

**The brand mark is not a button.** Mission Control is its own labelled item directly below it. Two controls navigating to the same place is the duplication this navigation work exists to remove. Easy to make it clickable if you'd rather have the familiar logo-is-home behaviour — one line.

---

## One thing to confirm

**Theme switching moved into the account menu.** The direction correction lists what to remove and what to build; the theme control appears in neither, but it was in the Sprint 1 sidebar and dropping it silently would lose a capability. The rail has no room for a theme row, so it now lives with identity — clicking the avatar shows the signed-in email, the active theme name and the theme options.

This also matches the Hunter rail you approved, which surfaced the active theme name under the account (`aaron@idynify.com / Clean Workspace`). If you want theme somewhere else, say where.

---

## Unchanged from Sprint 1

Locked information architecture · `MainLayout` as the single shell · Barry as a persistent overlay, not a destination · `executeSendAction()` routing · the breadcrumb · all routing and shell-persistence work.
