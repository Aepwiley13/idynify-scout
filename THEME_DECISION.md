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

None at this time. Any future exceptions must be added to this file with rationale before implementation.

## Approved by

Aaron — aaron@idynify.com
