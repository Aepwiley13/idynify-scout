# Decision: Hunter Theme Direction

**Date:** February 12, 2026
**Decision:** Option A — Migrate Hunter to Scout's light theme

## Rationale

- Scout is the design standard. Consistency across all three pillars (Recon, Scout, Hunter) is the goal of this project. Option A achieves full 3-for-3 alignment.
- Hunter's visual identity is preserved through its pillar accent colors — the pink/magenta gradient (`#ec4899` / `#8b5cf6`) provides sufficient differentiation on a white canvas without requiring a separate token system.
- Option B would create permanent maintenance overhead. Every new component, every new contributor, and every future feature would require awareness of two parallel token sets. That overhead compounds indefinitely.
- Recon already operates on Scout's light theme foundation. Option A closes the last gap.

## What This Means for Implementation

- All Hunter backgrounds migrate to `#ffffff` and Scout's surface tokens
- All Hunter text migrates to Scout's dark-on-light hierarchy (`#111827` primary)
- All border and surface tokens updated to Scout's values
- Hunter's pink/magenta/purple accent tokens are retained and documented as the Hunter pillar accent set — these do not get replaced, they get properly defined

## Intentional Exceptions

### 1. Recon Breadcrumbs (Finding 11)

**Decision:** Retained as intentional exception.

Recon's 4-level navigation hierarchy (Mission Control > RECON > Module > Section) requires wayfinding that the sidebar alone cannot provide. Breadcrumbs are solving a real navigation problem, not decorating. Styled with Scout tokens (system font-family, `#6b7280` links, `#111827` current, `#9ca3af` separators, Recon accent `#9333ea` on hover). Not replicated in Scout or Hunter — neither pillar has comparable navigation depth.

### 2. Hunter Sticky Header Removed (Finding 7)

**Decision:** Sticky header removed in Phase 3. Gmail status relocated to Weapons tab context.

The sticky header was a structural pattern, not a feature. Gmail connection status is only actionable from the Weapons and Missions tabs — making it globally visible on every Hunter screen added visual weight without utility. Header now uses Scout's centered `enterprise-header` pattern. Gmail status renders inline on the Weapons tab where it's contextually relevant.

### 3. Recon Heatmap Component (Finding 19)

**Decision:** Retained as intentional exception.

The Barry's Knowledge Map heatmap is a unique Recon visualization with no Scout equivalent. Tile containers use Recon-specific tokens (2px borders with status colors, 0.5rem radius) appropriate for the compact grid layout. This is a legitimate content-specific component, not a deviation from the design system.

### 4. Hunter Primary Button Gradient (Finding 16)

**Decision:** Retained as intentional exception.

Hunter's pink-to-purple gradient CTA button (`#ec4899` → `#8b5cf6`) uses the same structural tokens as Scout's buttons (padding, radius, weight, shadow) but with the Hunter pillar accent gradient. This is intentional pillar differentiation, consistent with the decision to preserve Hunter accent colors documented above.

## Layout Container Standard

**Two-tier content width system:**
- **1400px** — List/overview pages: Scout standard, Recon Overview, Hunter main container, Hunter Dashboard
- **900px** — Focused/editor views: Recon Module pages, Recon section editor, Barry Training

A single width everywhere would create uncomfortable line lengths on focused views. The two-tier system reflects actual usage patterns: wide for scanning, narrow for focused work. This is a principled distinction, not inconsistency. Future contributors should reference this standard when adding new pages.

## Approved by

Aaron — aaron@idynify.com
