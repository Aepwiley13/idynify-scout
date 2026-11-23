# Desktop UI Polish

Small, isolated visual improvements to surfaces that already work, taken one at
a time while larger programmes (Contact Hub, the website) run in parallel.

The point of the series is that each entry is *small enough to verify
completely*. An entry earns its number by meeting all of these:

- it changes presentation, not behaviour — no navigation, no data, no routing;
- it lands in a shared component, so it applies everywhere at once rather than
  page by page;
- it ships with before/after evidence and the measurements behind it, not an
  assertion that it looks better;
- it states what it deliberately did **not** change, so the next person knows
  which neighbouring oddities were seen and left alone on purpose.

An improvement that cannot be verified in isolation is not polish — it is a
project, and it belongs somewhere else.

| # | Title | Area | Status |
|---|-------|------|--------|
| [001](001-global-brand-identity.md) | Global Brand Identity | Shared sidebar — brand mark | Merged (#825) |
| [002](002-global-typography.md) | Global Typography & Visual Hierarchy | Platform-wide type system | Merged (#828) |
| [002.1](002.1-hunter-theme-integrity.md) | Hunter Theme Integrity | Hunter → Create Campaign, Mission Setup | Merged (#829) |
| [002.2](002.2-campaign-detail-theme.md) | Campaign Detail Theme Integrity | Hunter → campaign detail; shared campaign buttons and icons; campaign page scrolling | Merged (#831) |
| [003](003-compact-navigation.md) | Compact Navigation Labels | Collapsed sidebar rail | Superseded by 003.6 (compact rail flyout) |
| [003 audit](003-navigation-audit.md) | Navigation & Visual Hierarchy audit | All modules | Complete |
| [003.1 + 003.2](003-navigation-audit.md#0031--0032--campaigns-in-hunter-implemented-combined) | Campaigns in Hunter | Hunter, Command Center → Campaigns | Merged (#830) |
| [003.3](003-navigation-audit.md#0033--missions-in-hunter-implemented) | Missions in Hunter | Hunter, Command Center → Missions; mission page scrolling | Merged (#832) |
| [003.4 / 003.5 / 004 audit](004-audit-and-003.4-003.5.md) | Outcomes, Cadences, Desktop Screen Utilization | Navigation; all module layouts | Audit approved (#833, #837) |
| [004.1](004-audit-and-003.4-003.5.md#0041--implemented) | Reachability | Total Market, Scout Game, Cadences | Merged (#834) |
| [003.4](004-audit-and-003.4-003.5.md#0034--implemented) | Mission Outcomes in Hunter; Sales Outcomes | Hunter, Command Center, Sniper | Merged (#835) |
| [003.5](004-audit-and-003.4-003.5.md#0035--implemented) | Cadences in Hunter | Hunter, Scout, Command Center | Merged (#836) |
| [004.2 / 004.5](004-audit-and-003.4-003.5.md#planning-approved-for-preparation-not-implemented) | Workflow width; density audit; Hunter grouping | Workflow pages; people views | Proposal — awaiting approval (docs #837) |
| [003.6](003.6-unified-navigation.md) | Unified Navigation | Sidebar + every module's section panel | Direction approved; implementation gated on Contact Hub ([coordination](003.6-contact-hub-coordination.md)) |
| [005 audit](005-barry-audit.md) | Barry's Visual Experience | Every Barry surface | 005.2 / .3 / .4 / .5 / .7 ready for PR; 005.1 / .6 after 003.6 |

## Roadmap

| Initiative | Status |
|---|---|
| #001 Global Brand Identity | Done (#825) |
| #002 Global Typography, with 002.1 / 002.2 theme integrity | Done (#828, #829, #831) |
| #003 Navigation & Visual Hierarchy | 003.1–003.5 done (#830, #832, #835, #836). **003.6 Unified Navigation: approved, waiting on Contact Hub** |
| #004 Desktop Screen Utilization | 004.1 done (#834). 004.2 width and 004.5 density: proposals. 004.3 / 004.4 on hold (004.4 largely absorbed by 003.6) |
| #005 Barry's Visual Experience | 005.2–005.5 and 005.7 ready for PR; 005.1 / 005.6 after 003.6 |

