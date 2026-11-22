# Desktop UI Polish #003 — Navigation & Visual Hierarchy: audit

**Status: audit complete. 003.1 + 003.2 merged (#830); 003.3 implemented (below); 003.4–003.5 deferred.**
Audited on `main` at `33dc078e`. Companion to `003-compact-navigation.md` (rail labels).

## 003.1 — first improvement (direction approved)

Founder review of #002.1 found that **Campaigns is reachable from Command Center but
not from Hunter**, although campaign creation lives at `/hunter/campaign/*` and is a
Hunter activity.

Approved direction: add Campaigns to Hunter's sub-nav, keep it in Command Center for now.

## 003.1 + 003.2 — Campaigns in Hunter (implemented, combined)

Approved as one change: one canonical campaign list at **`/hunter?tab=campaigns`**.

- **Entry points:** Hunter sub-nav (desktop, after Blitz Mode), Hunter's mobile "More" sheet, and
  Command Center → Campaigns (desktop and mobile) all open the list. None open the wizard directly.
- **List:** `pages/Hunter/sections/CampaignsSection.jsx`. One read-only query,
  `users/{getEffectiveUser().uid}/campaigns` ordered by `createdAt` desc, the same path
  `CampaignDetail` reads. Loading, empty (with New Campaign) and error (with retry) states.
- **Cards:** `CampaignCards.jsx`, extracted from the unrouted `DashboardSection` "Active Campaigns"
  panel, so both render the same cards. A card shows the campaign's real status (Draft /
  In Progress / Completed, CampaignDetail's wording). Mission health and mission counts appear only
  when linked mission data is passed in. Hunter doesn't load missions, so wizard campaigns never
  show a fabricated "On Track".
- **Routes unchanged:** New Campaign → `/hunter/campaign/new`; card → `/hunter/campaign/:id`. The
  wizard's and detail page's Back buttons now return to `/hunter?tab=campaigns` instead of `/hunter`.
- **Isolation:** Firestore rules allow `users/{uid}/**` only to `request.auth.uid == uid`. While an
  admin is impersonating, the client asks for the target's campaigns and the rules deny it, so
  the list shows its error state. That's the same behaviour as Hunter's other client-side reads.
- **No new** collections, queries beyond the one above, dependencies or backend functions.

- **Tests:** `src/test/hunterCampaigns.test.jsx` (9) and `mobileNavigation.test.jsx` (Hunter's pinned
  overflow list gains "Campaigns"). Some existing tests are timing-sensitive under a full local
  run: `cadenceResendHistory`, `stickerWritePaths`, `bulkComposeImportedGroup`,
  `allPeopleNavigation` and `peopleCardRefresh` can time out. Each passes on its own, and the first
  two also fail on unmodified `main` under the same load. None covers a file this change touches.

### #002.2 — CampaignDetail theme (follow-up, not in this change)

`CampaignDetail.jsx` still hardcodes light greys (for example, its status pill uses `text-gray-500 bg-gray-200`), the same
defect class #002.1 fixed in the wizard. Users now reach it from the list, so it gets a
separate #002.2 entry.

## 003.3 — Missions in Hunter (implemented)

Approved: one canonical mission list at **`/hunter?tab=missions`**, the same pattern as Campaigns.

- **Entry points:** Hunter sub-nav (desktop, after Campaigns), Hunter's mobile "More" sheet, Command
  Center → Missions (desktop and mobile), and the legacy `/hunter/missions` redirect, which previously
  went to `/command-center?tab=missions`.
- **Command Center keeps its active-mission count badge** on the Missions item (autopilot + draft),
  from the missions it already loads for Outcomes. No extra query. `/command-center?tab=missions`
  still renders Command Center's own view for any old link.
- **List:** `pages/Hunter/sections/MissionsHost.jsx` runs the same single read-only query Command
  Center uses, `users/{getEffectiveUser().uid}/missions` ordered by `createdAt` desc, and renders the
  existing `MissionsSection`. That component owns loading, empty and list. The host adds an error
  state with retry.
- **Completed missions are included.** Command Center replaced the list with a "Start your first
  mission" prompt whenever nothing was active, so an account whose missions had all finished saw none.
  To make that honest, `MissionsSection`'s copy changed: "Active Missions — N in progress" →
  **"Missions — N missions · K active"**, and the empty title "No Active Missions" → "No Missions Yet".
  No other changes to the component.
- **Routes unchanged:** `/hunter/create-mission`, `/hunter/mission/:id`. Mission detail's two Back
  buttons and the create page's "Back to Hunter" now return to `/hunter?tab=missions`.
- **Isolation and impersonation:** same as 003.2. Rules allow `users/{uid}/**` only to its owner,
  so while impersonating, the read is denied and the list shows its error state.
- **Go To War:** unchanged, still in Command Center.
- **Tests:** `src/test/hunterMissions.test.jsx` (11): loading, status list, completed-only account,
  empty → Create Mission, card → detail, error → retry, no user, impersonated uid path, and every
  entry point, the redirect and the Back targets. `mobileNavigation.test.jsx` pins Hunter's overflow
  list, now with "Missions".

### 003.3 QA follow-up — mission pages couldn't scroll

The same pre-existing cause as the #002.2 campaign fix (#831). Module routes render into a
fixed-height shell (`.shell-fixed-height` pins `.main-content` to `100vh`; `.page-content-full` is
`overflow: hidden`), so a page must scroll itself. `CreateMission` (`.create-mission`) and
`MissionDetail` (`.mission-detail`) had no scroll container, so anything past the viewport was
clipped, including the create flow's actions and long mission plans.

**Fix:** the same `flex-1 min-h-0 overflow-y-auto` container, here as a **wrapper** around each page
root: CreateMission's one root, and MissionDetail's loading, error and main views. The roots are
centred max-width blocks (1000px / 800px). Wrapping them rather than making them scroll keeps their
width and centring exactly as before, and keeps the scrollbar at the page edge. 8 added lines, no
removals. No CSS, shell or global change. The add-contact dialog is `position: fixed` with no
transformed ancestor, so it's unaffected.

**Verified in Chrome** with this branch's compiled CSS, in a harness of the shell structure:

| Page | Viewport | Before | After |
|---|---|---|---|
| CreateMission | 1440×900 / 1280×720 | no scroll; last action unreachable | scrolls; reachable; width 1000, same left offset |
| CreateMission | 390×844 | no scroll; last action at 1949px | scrolls; reachable; ends at 756px, clearing the 56px bar |
| MissionDetail | 1440×900 / 1280×720 | no scroll; last action unreachable | scrolls; reachable; width 800, same left offset |
| MissionDetail | 390×844 | no scroll; last action at 1949px | scrolls; reachable; ends at 756px, clearing the 56px bar |

**Regression protection:** `hunterMissions.test.jsx` asserts that every `create-mission` (1) and
`mission-detail` (3) root sits directly inside the scroll container, and that neither file uses
`min-h-screen`. Checked against a copy with one wrapper removed: it fails.

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
