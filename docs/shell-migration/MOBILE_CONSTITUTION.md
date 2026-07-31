# Mobile Navigation — the Constitution
**Team A | Idynify | Supersedes the mobile sections of `TOPBAR_AND_MOBILE.md`**

---

```
HAMBURGER    = change the workspace   (move between modules)
BOTTOM BAR   = change the view        (inside the current workspace)
TOP BAR      = where you are          (+ search and notifications)
```

Three surfaces, three jobs, no overlap.

---

## What was wrong

The previous brief said the bottom bar had "the right instinct — keep it exactly
as is: Scout · Hunter · Sniper · Basecamp · More", and that the horizontal
section strips inside each module were "correct for mobile — keep them". I
implemented both. Both were wrong, and they preserve the duplication rather
than fix it:

- The bottom bar listed **modules** — the hamburger's job — so global navigation
  appeared twice on the same screen.
- Each module compensated by rendering a horizontal strip of its **sections**
  just under the top bar, putting module navigation in the one place a phone
  user's thumb cannot comfortably reach.
- Several modules also drew their own top bar in that strip: a logo, a settings
  gear, a theme picker, and in Scout's case a scrollable row of *every other
  module* — a third copy of the global navigation.

Sections have moved to the bottom bar. That is what frees the strips to be
deleted, and it is why this is one change and not three.

---

## 1 — The bottom bar now belongs to the module

`constants/mobileNavigation.js` declares each module's bar: at most four
primary items, plus overflow. Four is the ceiling because More is a fifth cell,
and five is the most a 360px screen holds without labels collapsing into
initials.

| Module | Bar | More |
|---|---|---|
| Scout | Daily · Saved · People · Scout+ | Cadences, Total Market, ICP Settings, Game Mode |
| Hunter | Blitz · All People · Companies · Follow Up | Today's Actions, Replied, Active, New (Unengaged) |
| Sniper | People · Companies · Pipeline · Targets | Touches, Playbooks, Outcomes |
| Basecamp | People · Companies · Engage · CSM | — |
| Reinforcements | Dashboard · Opportunities · Leaderboard · Nurture | Record |
| Fallback | Comeback · People · Companies | — |
| Recon | Overview · ICP · Messaging · Training | Alignment Brief, User Profile, Objections, Competitive Intel, Buying Signals |
| Command Center | People · Missions · Campaigns · Arsenal | Companies, Cadences, Weapons, Go To War, Outcomes |
| Settings | Account · Security · Billing · Integrations | Your Services, Hunter, Appearance |

The active item takes the module's colour, so which workspace you are in is
legible without reading a word.

**Settings is not in the brief's table.** It is here because the Constitution
applies to it: it is a workspace with seven views, and its strip was the last
one in the product. Making its sections reachable from the bar required moving
its active section from local state into the URL — which also means a link can
now point at a Settings section, refresh keeps you where you were, and Back
steps through sections instead of leaving Settings.

### Mission Control does not get one

The brief specifies `[Priorities] [Pipeline] [Activity] [Barry]` for Mission
Control. **Those four sections do not exist.**
`MissionControlDashboardV2` is a single scrolling dashboard — a module grid and
a "Top Recommended Companies" list — with no tabs, no routes, and nothing to
switch between. Building them is product work, and the brief says module content
changes by zero.

The brief's other statement about Mission Control is implementable and is what
ships: *"the global bottom bar should only appear when the user has no active
module context — i.e. on the Mission Control screen only, or as a fallback."*
So Mission Control and anything unmatched fall through to the global module
list, and the module bar takes over inside a module.

Flagged rather than invented. **If those four sections should exist, that is a
Mission Control brief.**

---

## 2 — The two More surfaces

They must never be mistaken for each other, so they differ on four axes at once:

| | ≡ hamburger | ⋯ bottom bar More |
|---|---|---|
| **Contains** | modules, grouped | sections of the current module |
| **Edge** | left, full height | bottom, only as tall as its contents |
| **Title** | IDYNIFY | the module's name |
| **Colour** | neutral | the module's colour |

A user who opens one expecting the other is one tap from being lost. The answer
to "which am I in" is available before reading anything.

The global sheet keeps its tile grid; the module sheet is a **list**, because
section names ("Competitive Intel", "New (Unengaged)") are long enough that
tiles would truncate or wrap into a ragged grid.

---

## 3 — The hamburger is grouped now

```
IDYNIFY                    ✕
  Mission Control
PIPELINE
  Scout · Hunter · Sniper
RELATIONSHIPS
  Basecamp · Reinforcements · Fallback
INTELLIGENCE
  Recon
  Command Center
─────────────
⚙ Settings   🛟 Help
─────────────
[AW] Aaron Wiley
     aaron@idynify.com
→ Log out
```

Group labels are muted small caps and are **not** tappable — a group describes
the platform, it is not a destination, and a heading that looks tappable but is
not is worse than no heading.

**Desktop is untouched.** It deliberately draws a flat list: the final nav brief
calls the Pipeline / Relationships / Intelligence split an architectural
decision, not a visual one in that sidebar style. The drawer is the only place
modules are listed on mobile, so it is where the shape has to be legible.

The two orders genuinely differ — desktop puts Recon between Basecamp and
Reinforcements; grouped puts it under INTELLIGENCE after Fallback — so one list
cannot serve both. They share a `ModuleLink` component so a change to how a
module renders cannot land on one surface and miss the other.

**Only one is built, not merely hidden.** `useIsMobile()` decides which. Two
`<nav aria-label="Global navigation">` landmarks in the DOM is one stylesheet
failure away from rendering both, and it makes every query against the sidebar
ambiguous — which is exactly what it did to the test suite before this changed.

---

## 4 — What was removed

- **The horizontal section strip**, from all eight modules and Settings.
- **Each module's mobile top bar** — logo, settings gear, theme picker, and in
  Scout's case a scrollable row of every other module.
- **`MODULES_WITH_OWN_MOBILE_NAV`.** It listed modules that shipped their own
  bottom nav so the shell would yield rather than stack a second one — a
  holding position from Phase 0 constraint C3, kept while mobile was out of
  scope. No module renders navigation of its own now; there is nothing to
  yield to.
- Every module's mobile branch is content only. Nine files, one shape.

---

## 5 — One layout bug this surfaced

`.page-content-full` zeroes all padding at ≤1024px and wins on specificity over
`.page-content`'s reserved room for the bottom bar. That never showed, because
every module drew its own bottom nav with its own padding. With the shell owning
the bar, the last row of every list would have sat underneath it. Fixed in the
mobile block.

Same class of thing in the drawer: it is full height and the bar is fixed on
top of it, so the Barry card at its foot was half-covered and untappable. The
drawer's footer now clears the bar.

---

## Verification

**582 tests, 577 passing.** The 5 failures are pre-existing and unrelated —
`HunterContactCard` (date-fns) and `ReconSectionEditor` (×4) — confirmed
identical on `main`.

`mobileNavigation.test.jsx` (27) covers the acceptance criteria directly: the
bar shows the current module's sections and changes with the module; it never
lists another module; no More cell for a module whose sections all fit; the
active item is marked from the URL, from a bare module URL, and from a path
(Recon, longest match winning); the active item takes the module colour; the
module More sheet contains **no module names at all**; the drawer is grouped
and the group labels are not tappable.

**The drift guard is the important one.** `constants/mobileNavigation.js` is a
second copy of each module's section list — the shell must not import nine
module files to draw a bar, and a second copy is exactly how nine diverging
module rails happened. Two assertions per module in `moduleMigration.test.jsx`:

1. Every label in the mobile model **is** a section the module really renders.
2. Every section the module renders **is reachable** from the bar or its More
   sheet — because the strip is gone, so anything in neither is unreachable on
   a phone.

Items that abbreviate ("Follow Up" for "Follow Up Now", "ICP" for "ICP
Intelligence") declare the real name in a `section` field, so the comparison is
exact rather than a prefix guess a rename could hide behind.

Build passes. Lint at or below baseline on every file touched.

---

## Carried forward

**Mission Control's bottom bar.** See §1 — needs a product decision, not a
navigation one.

**Logo assets** are still absent; the wordmark, mark and Barry avatar render
fallbacks.

**`support@idynify.com` is still not live** — one line in
`constants/support.js` when it is.

**No real-device testing.** Everything here is verified in Chromium at 390×844
with a stubbed viewport. Safe-area insets, the iOS keyboard, and momentum
scrolling behind a fixed bar are the three things that behave differently on
hardware and cannot be checked here.
