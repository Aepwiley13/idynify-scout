# #003.4 / #003.5 navigation audit and #004 screen utilization audit

**Status: read-only audit, for approval. Nothing implemented.** Audited on `main` at `27b9f96c`.
Contact Hub, billing and website areas aren't touched; items that border them are marked.

## Part 1 — #003.4 Outcomes and #003.5 Cadences

### Outcomes: two different things with one label

| Where | Component | What it measures | Data |
|---|---|---|---|
| Command Center → Outcomes | `pages/Hunter/sections/OutcomesSection.jsx` (a Hunter component; its own heading already says "Mission Outcomes") | Outreach performance: reply rate by engagement style, campaign send stats, a Barry insight on the best style | missions + campaigns |
| Sniper → Outcomes | `pages/Sniper/sections/OutcomesSection.jsx` | Sales results: win/loss, conversion rate, time-to-close, pipeline velocity | Sniper records |

The legacy `/hunter/outcomes` redirects to Command Center. Mobile mirrors both.

**Recommendation (003.4):** name them for what they are, and give Mission Outcomes the same canonical
Hunter home as Campaigns and Missions.
- Hunter gains **Mission Outcomes** at `/hunter?tab=outcomes`, hosting the existing
  `OutcomesSection` with the existing missions + campaigns queries, the same host pattern as
  `MissionsHost`.
- Command Center → Outcomes (desktop and mobile) and `/hunter/outcomes` point there.
  Command Center relabels the item **Mission Outcomes**.
- Sniper → Outcomes relabels to **Win/Loss**, matching its own description ("Win/loss analytics").
  Same destination.

### Cadences: outreach, housed under Scout

Cadences are bulk email sends. They're launched from Scout's people list (`AllLeads` bulk compose) and
Scout+, and sent by `BulkSendExecutor`. History lives at Scout → Cadences (`/scout?tab=cadences`), at
`/scout/cadences`, and at detail `/scout/cadence/:id`. Command Center → Cadences links to
`/scout/cadences`, so opening it from Command Center switches the active module to Scout.

Cadences and Campaigns both mean "email many contacts", on two separate systems (`cadences` and
`campaigns`). Consolidating them is a **product decision**, not polish. Navigation can at least put
them side by side.

**Recommendation (003.5):** Hunter is the home, and the routes stay.
- Hunter gains **Cadences** at `/hunter?tab=cadences`, rendering the existing `CadencesList`
  unchanged, the way Scout's tab does today.
- Command Center → Cadences and mobile point there. CadenceDetail's two Back buttons
  return to `/hunter?tab=cadences`.
- `/scout/cadences` and `/scout/cadence/:id` are kept. **Decision:** while on a cadence detail page
  the shell highlights Scout, because `resolveModule` maps `/scout/*`. A one-line `resolveModule`
  rule (like the existing Recon one) would highlight Hunter instead, with no route change.
- **Decision:** whether Scout keeps a Cadences entry (a link to Hunter's list) or drops it.
  `scoutSubNav.test.jsx` pins Scout's section list either way, so it needs updating.

### Redundant navigation and clicks

| Task (desktop) | Today | After 003.4 + 003.5 |
|---|---|---|
| A Hunter user checks cadence history | Sidebar → Scout → Cadences: 2 clicks, module switch | 1 click in Hunter |
| Check mission performance | Sidebar → Command Center → Outcomes: 2 clicks, module switch | 1 click in Hunter |
| From Command Center → Cadences | lands in Scout | lands in Hunter |

Left in Command Center after this: People, Companies (Contact Hub territory), plus Go To War,
Weapons and Arsenal. The last three are Hunter tools rendered from `pages/Hunter/sections` and
`GoToWar`; moving them is a candidate **003.6**, not proposed now.

**Hunter's sub-nav length.** With Campaigns, Missions, Cadences and Mission Outcomes it reaches 12
items: 5 outreach destinations plus 7 people lenses. `ModuleSubNav` has no grouping today. Adding a
group label ("Outreach" / "People") would be a shared-component change. That's recommended only if
the list reads as crowded on review.

### Simplest architecture

- **Scout** (find): Daily Discoveries, People, Saved Companies, Scout+, Total Market, ICP Settings, Game Mode
- **Hunter** (engage): Blitz, Campaigns, Missions, Cadences, Mission Outcomes · All People, Companies, Follow Up Now, Today's Actions, Replied, Active, New
- **Sniper** (close): People, Companies, Pipeline, Targets, Touches, Playbooks, **Win/Loss**
- **Command Center** (roster, in transition): People, Companies, and links to Hunter's lists. Future shape depends on Contact Hub.

## Part 2 — #004 Desktop screen utilization

Method: layout source plus Chrome measurement of page-root patterns against the compiled CSS.
Authenticated pages can't be rendered here, so density findings need a logged-in screenshot pass.

### Usable width

Shell chrome: sidebar 220px (64px compact), module sub-nav 190px, top bar 64 / 72 / 80px
(<1280 / ≥1280 / ≥1536 wide; 64px again on short viewports ≤820px high).

| Screen | Module workspace (sidebar + sub-nav) | Detail page (sidebar only) |
|---|---|---|
| 1280 | 870px (chrome = 32%) | 1060px |
| 1440 | 1030px | 1220px |
| 1920 | 1510px | 1700px |

Content caps on workflow pages, and the share of a 1920px detail area left empty:

| Page | Cap | Empty at 1920 |
|---|---|---|
| Mission detail | 800px | 53% |
| Create Mission | 1000px | 41% |
| Campaign wizard / detail | 1024px | 40% |
| Recon module pages (prose) | 900px of 1510px | 40%, but reasonable for reading |
| AllLeads, campaign list | 1400px | not binding below ~1810px |

### Unreachable content (highest impact)

The fixed-height shell needs each page to scroll itself (fixed for campaigns in #831 and missions in
#832). Chrome measurement of the remaining page-root patterns, at 1280×720, 1920×1080 and 390×844:

| Pattern | Pages | Result |
|---|---|---|
| `min-height: 100vh`, no overflow | Total Market, Scout Game | anything below the fold is unreachable (last action 824–1168px out of view) |
| no scroll rules | Company Leads *(company-related: coordinate with Contact Hub)* | same |
| `flex: 1; min-height: 100dvh; overflow-y: auto` | Cadences list and detail | scrolls, but the bottom 49–80px (the top-bar height) is cut off |

These are root-pattern measurements. Each page needs confirming before a fix, because a page may
have an inner scroll area. Recon, Barry and Settings weren't checked yet.

### 004.1 — implemented

Same cause and approach as #831/#832. Company Leads is untouched, pending Contact Hub.

| Page | Change |
|---|---|
| Total Market | loading and main roots wrapped in `flex-1 min-h-0 overflow-y-auto`; `.total-market` `min-height: 100vh` → `100%` |
| Scout Game | both roots wrapped; `.scout-game-page` `min-height: 100vh` → `100%` |
| Cadences list | `minHeight: '100dvh'` → `0` on the main and loading roots (already `flex: 1; overflow-y: auto`) |
| Cadence detail | `minHeight: '100dvh'` → `0` on the main, loading and not-found roots |

`min-height: 100%` fills the scroll area exactly. With `100vh` (taller than the area), even short pages
scrolled by the top bar's height (64–105px). Widths are unchanged.

**Verified in Chrome** with the compiled CSS at 1280×720, 1920×1080 and 390×844: short content
needs no scroll (0px) and long content is fully reachable on all four pages. Cadences also works
inside Scout's `.scout-list` host. Before, Cadences clipped the last row at every size.
**Regression:** `src/test/shellReachability.test.js` (8).

### Ranked recommendations

Impact = user effect; effort and risk as estimated from the source.

| Rank | Item | Impact | Effort | Risk |
|---|---|---|---|---|
| 1 | **004.1** Reachability: confirm and fix scrolling on Total Market, Scout Game and Cadences list/detail with the #831/#832 pattern; extend the regression check. Company Leads only after Contact Hub sign-off. | High: blocked actions | Low | Low |
| 2 | **003.4** Outcomes: relabel (Mission Outcomes / Win/Loss); Hunter home; Command Center, mobile and redirect point there | Medium | Low–medium | Low |
| 3 | **003.5** Cadences: Hunter home; Command Center, mobile and Back point there; routes kept | Medium | Medium | Medium (Scout test, module highlight decision) |
| 4 | **004.2** Widen workflow detail pages to one shared cap (~1200px): mission detail, Create Mission, campaign wizard/detail. Leave Recon prose and forms narrow. | Medium on ≥1440 | Low | Low–medium (inner grids) |
| 5 | **004.3** Keep the top bar at 64px on desktop (drop the 72/80px growth): +8–16px of height | Low–medium | Low | Low (global, but a single rule) |
| 6 | **004.4** Laptop chrome: start the sidebar compact below ~1366px (+156px width) | Medium–high on laptops | Medium | Medium: shell change affecting all modules; needs explicit approval |
| 7 | **004.5** Density pass (card sizes, list rows, empty space inside modules) from logged-in screenshots at 1280 / 1440 / 1920 | Unknown until measured | Low to measure | None (read-only) |
| — | Hunter sub-nav grouping, 003.6 (Go To War / Weapons / Arsenal), Campaigns vs Cadences consolidation | — | — | Deferred, or a product decision |
