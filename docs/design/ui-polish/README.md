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
| [002.2](002.2-campaign-detail-theme.md) | Campaign Detail Theme Integrity | Hunter → campaign detail; shared campaign buttons and icons | Ready for PR |
| [003](003-compact-navigation.md) | Compact Navigation Labels | Collapsed sidebar rail | Proposed — not authorized |
| [003 audit](003-navigation-audit.md) | Navigation & Visual Hierarchy audit | All modules | Complete |
| [003.1 + 003.2](003-navigation-audit.md#0031--0032--campaigns-in-hunter-implemented-combined) | Campaigns in Hunter | Hunter, Command Center → Campaigns | Merged (#830) |
