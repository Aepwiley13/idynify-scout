# Desktop UI Polish #003 — Navigation & Visual Hierarchy: audit

**Status: read-only audit. Nothing implemented; no routes changed.**
Audited on `main` at `33dc078e`. Companion to `003-compact-navigation.md` (rail labels).

## 003.1 — first improvement (direction approved)

Founder review of #002.1 found that **Campaigns is reachable from Command Center but
not from Hunter**, although campaign creation lives at `/hunter/campaign/*` and is a
Hunter activity.

Approved direction: add Campaigns to Hunter's sub-nav, keep it in Command Center for now.

## Where navigation is defined

| Layer | Source |
|---|---|
| Sidebar modules, order, groups | `src/constants/navigationModel.js` (`MODULES`, `SIDEBAR_ORDER`) |
| Desktop module sub-nav | `ModuleSubNav`, items declared per module page (`HUNTER_ITEMS` etc.) |
| Mobile module sections | `src/constants/mobileNavigation.js` (separate copy) |
| Routes and legacy redirects | `src/App.jsx` |

## Current structure

Sidebar: Mission Control · (Contact Hub, flagged) · **Pipeline** Scout, Hunter, Sniper ·
**Relationships** Basecamp, Reinforcements, Fallback · **Intelligence** Recon · Command Center.

| Module | Sub-nav (desktop) |
|---|---|
| Scout | Daily Discoveries, People, Saved Companies, Scout+, Cadences, Total Market, ICP Settings, Game Mode |
| Hunter | Blitz Mode, All People, Companies, Follow Up Now, Today's Actions, Replied, Active, New (Unengaged) |
| Sniper | People, Companies, Pipeline, Targets, Touches, Playbooks, Outcomes |
| Basecamp | People, Companies, Engage, CSM |
| Reinforcements | Dashboard, Opportunities, Leaderboard, Record, Nurture |
| Fallback | Comeback, People, Companies |
| Recon | Overview, Alignment Brief, User Profile, ICP Intelligence, Messaging & Voice, Objections, Competitive Intel, Buying Signals, What Barry Knows |
| Command Center | People, Companies, Missions, **Campaigns**, Cadences, Go To War, Weapons, Arsenal, Outcomes |
| Settings | Account, Security, Billing, Integrations, Your Services, Hunter, Appearance |

## Findings

1. **Hunter's tools live in Command Center.** Missions, Weapons, Arsenal and Outcomes in
   Command Center render Hunter's own components (`pages/Hunter/sections/*`), and the old
   `/hunter/missions|weapons|arsenal|outcomes|people|companies` routes redirect to
   `/command-center?tab=…`. Campaigns and Go To War (bulk mission launcher) are also there.
   A Hunter user leaves Hunter to create a mission or a campaign.
2. **"Campaigns" opens the create wizard, not a list.** Both Command Center entries (desktop and
   mobile) go to `/hunter/campaign/new`. No route lists existing campaigns; `CampaignDetail` is
   reached only straight after creating one. The one "Active Campaigns" list is in
   `HunterWeaponRoom`, which `App.jsx` imports but never routes, so it's unreachable.
3. **Cadences appears twice**: Scout → Cadences and Command Center → Cadences (→ `/scout/cadences`).
   Cadences are outreach (Hunter's job), housed under Scout.
4. **"Outcomes" means two things**: Sniper → win/loss analytics; Command Center → mission
   performance. Same label, different data.
5. **People / Companies appear in six modules plus Contact Hub** (Scout, Hunter, Sniper, Basecamp,
   Fallback, Command Center). Mostly stage-filtered rosters, with Command Center as the full
   roster. **Contact Hub team territory: no proposal here until coordinated.**
6. **Desktop and mobile are maintained separately** and have already drifted (mobile Hunter has
   no "Today's Actions"). Any 003 change has to land in both or be stated as desktop-only.
7. Minor: Hunter's "Active" and "New (Unengaged)" share one icon; Recon is also routed under
   `/mission-control-v2/recon` (legacy).

## Recommended structure (for approval)

**003.1 (approved direction):** Hunter gains **Campaigns**, after Blitz Mode:
`{ id: 'campaigns', label: 'Campaigns', Icon: Mail, desc: 'Send emails to multiple contacts', route: '/hunter/campaign/new' }`.
That's one item in `HUNTER_ITEMS`, which already supports `route` items (Blitz Mode uses one), plus the
same item in mobile `hunter` for parity. Command Center unchanged. While on a campaign route,
Hunter stays the active module (`resolveModule` already maps `/hunter/*`).

**Proposed next, each separately approvable:**

| # | Change | Why |
|---|---|---|
| 003.2 | Hunter gains a **campaign list** (existing campaigns + "New campaign"); Campaigns items point to it | Campaigns can't be found again after creation (finding 2) |
| 003.3 | Hunter gains **Missions** (and Go To War) as direct links; Command Center keeps them for now | Finding 1 |
| 003.4 | Retitle Command Center's Outcomes to **Mission Outcomes** | Finding 4 |
| 003.5 | Cadences: one home (Hunter), one alias | Finding 3; `scoutSubNav.test.jsx` covers Scout's sub-nav, so it moves with a test update |
| — | People / Companies consolidation | Contact Hub team first (finding 5) |

Not proposed: removing anything from Command Center, renaming modules, route changes.
