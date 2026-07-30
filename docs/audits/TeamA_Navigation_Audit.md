# TEAM A — Navigation Audit
**Idynify | Desktop Navigation Sprint**
Findings and recommendations. No code changes. Evidence cited to `file:line`.

---

## Executive Summary

**The product does not have a navigation system. It has four of them, and which one you get depends on which URL you are standing on.**

Every other finding in this audit is downstream of that single fact.

| Nav system | Routes | Chrome | Barry | Logout |
|---|---|---|---|---|
| `MainLayout` (Sidebar + top bar) | 14 | Left sidebar, 8 expandable pillars, page title, user email | `BarryChatPanel` | ✅ |
| Module shells (icon rail + sub-nav) | 10 | 60px icon rail + 190px sub-nav, no top bar | `BarryChat` | ❌ |
| `NavigationBar` (legacy top nav) | 3 | Horizontal top bar, 4 links | none | ✅ |
| No shell at all | ~30 | Nothing | none | ❌ |

The four systems disagree about what the modules are called, what each module contains, how Barry behaves, whether the back button works, and whether you can log out.

**The three highest-severity findings:**

1. **The navigation chrome changes identity mid-module.** `/scout` renders an icon rail. `/scout/contact/:id` renders a sidebar. Same module, same task, completely different navigation — and the sidebar contains two Scout features (Total Market, Game Mode) that the rail does not, so those features are unreachable from Scout itself. (`src/App.jsx:434-526`)

2. **Barry is ten assistants pretending to be one.** Conversations are keyed `drawer_${module}` — one per module (`src/components/barry/BarryChat.jsx:108`). Mission Control uses a *different component* with a *different key* (`src/components/dashboard/BarryChatPanel.jsx:60`). The session history panel reads `barry_sessions`, which only `BarryChatPanel` writes — so **every conversation held inside Scout, Hunter, Sniper, RECON, Command Center, Basecamp, Fallback and Reinforcements is invisible in Barry's own history**.

3. **You cannot log out of eight of the nine modules.** No sign-out affordance exists in any module shell or in Settings. Desktop logout lives only in the `MainLayout` top bar and the legacy `NavigationBar`. A user working in Hunter must navigate back to Mission Control to log out.

**The one architectural rule (D4):** *One persistent application shell owns navigation, Barry, and identity. Routes render into it; they never replace it.*

**The three things to change this sprint (D6):** convert the module shells to children of a single layout route; unify Barry to one mounted instance with one conversation thread; make Contact Profile a context-preserving panel instead of a page with a hardcoded back button.

---

# D0 — Screen Inventory

85 `<Route>` declarations in `src/App.jsx`; 25 are pure redirects. What remains is **~50 authenticated screens**. That is the headline number: fifty screens for a product whose mental model is a five-stage pipeline.

Frequency is an informed estimate from pipeline role — the product has no analytics instrumentation in the routing layer, so these are judgments, not measurements. They should be validated against real telemetry before anything is deleted.

## Class 1 — MainLayout routes (14)

| Screen | Route | Owner Module | Purpose | Frequency | Should Exist? | Keep as Page — or convert? |
|---|---|---|---|---|---|---|
| Mission Control | `/mission-control-v2` | Core | Daily start point, KPIs, module grid | **Dozens/day** | ✅ Yes | **Page** — the one true home |
| Contact Profile | `/scout/contact/:id` | Scout | Single contact, engagement, history | **Dozens/day** | ✅ Yes | **Panel** — already exists as a panel in 3 places |
| Company Detail | `/scout/company/:id` | Scout | Single company profile | Daily | ✅ Yes | **Panel** — already a panel via `CompanyProfileView` |
| Company People | `/scout/company/:id/leads` | Scout | Contacts at one company | Weekly | ⚠️ Merge | **Tab inside Company panel** |
| Cadences List | `/scout/cadences` | Scout | Bulk outreach history | Weekly | ⚠️ Duplicate | **Delete route** — already a Scout tab |
| Cadence Detail | `/scout/cadence/:id` | Scout | One cadence's results | Weekly | ✅ Yes | **Panel** |
| Total Market | `/scout/total-market` | Scout | Full addressable market | Monthly | ✅ Yes | **Scout tab** — currently unreachable from Scout |
| Scout Game | `/scout/game` | Scout | Gamified 15-in-30 review | Weekly (beta) | ⚠️ Flag | **Modal / focus mode** — not a page |
| Create Mission | `/hunter/create-mission` | Hunter | New outreach mission | Weekly | ✅ Yes | **Modal** — creation is not a destination |
| Mission Detail | `/hunter/mission/:id` | Hunter | One mission's status | Daily | ✅ Yes | **Panel** |
| Create Campaign | `/hunter/campaign/new` | Hunter | New multi-contact campaign | Weekly | ✅ Yes | **Modal** |
| Campaign Detail | `/hunter/campaign/:id` | Hunter | One campaign's results | Weekly | ✅ Yes | **Panel** |
| RECON Module (legacy) | `/mission-control-v2/recon` | RECON | Legacy RECON entry | Rare | ❌ No | **Delete** — superseded by `/recon` |
| RECON Section (legacy) | `/mission-control-v2/recon/section/:id` | RECON | Legacy section editor | Rare | ❌ No | **Delete** — superseded by `/recon/section/:id` |

## Class 2 — Self-contained module shells (10)

| Screen | Route | Owner Module | Purpose | Frequency | Should Exist? | Keep as Page — or convert? |
|---|---|---|---|---|---|---|
| Scout hub | `/scout` | Scout | Find & qualify prospects | **Dozens/day** | ✅ Yes | **Page** — primary nav |
| Hunter hub | `/hunter` | Hunter | Engage & follow up | **Dozens/day** | ✅ Yes | **Page** — primary nav |
| Sniper hub | `/sniper` | Sniper | Close deals | Daily | ✅ Yes | **Page** — primary nav |
| Command Center | `/command-center` | Cross-cutting | Full rosters, missions, weapons, arsenal, outcomes | Daily | ⚠️ Overloaded | **Split** — see D3-S4 |
| RECON | `/recon` (+6 children) | RECON | ICP & messaging intelligence setup | Weekly → Monthly | ✅ Yes | **Page** — correct as built |
| Basecamp | `/basecamp` | Basecamp | Customer success / post-close | Weekly | ✅ Yes | **Page** — primary nav |
| Reinforcements | `/reinforcements` | Reinforcements | Referral intelligence | Weekly | ✅ Yes | **Page** — secondary nav |
| Fallback | `/fallback` | Fallback | Archived / lost re-engagement | Monthly | ✅ Yes | **Secondary nav** — does not earn a top slot |
| Blitz Mode | `/hunter/blitz` | Hunter | Rapid 10-in-60s engagement | Daily | ✅ Yes | **Focus mode** — full-screen, intentionally chrome-free |
| Settings | `/settings` | Core | Account, integrations | Monthly | ✅ Yes | **Page** — but must not be a module rail peer |

**RECON is the only module built on real nested routes** (`src/App.jsx:392-406`, `ReconMain.jsx` `RECON_ITEMS` with `path:`). Every other module drives its sub-navigation from a `?tab=` query param written with `{ replace: true }`. RECON is the correct pattern and should be the template.

## Class 3 — Legacy `NavigationBar` pages (3)

| Screen | Route | Owner Module | Purpose | Frequency | Should Exist? | Convert to |
|---|---|---|---|---|---|---|
| Company List | `/companies` | Legacy | Pre-Scout company list | Never | ❌ No | **Delete** — superseded by Scout → Saved Companies |
| Lead Review | `/lead-review` | Legacy | Pre-Scout lead queue | Never | ❌ No | **Delete** — superseded by Daily Discoveries |
| Old Scout | `/old-scout` | Legacy | Pre-Scout contact suggestions | Never | ❌ No | **Delete** |

These three render `NavigationBar` (`src/components/NavigationBar.jsx`), a fourth navigation paradigm whose links point at `/mission-control` — a route that only redirects (`src/App.jsx:741`). Its active-state check `isActive('/mission-control')` can therefore **never** be true. It also labels Mission Control "Dashboard" (`NavigationBar.jsx:24`), the third name for the same screen.

## Class 4 — No navigation shell at all (~23)

| Screen | Route | Purpose | Frequency | Should Exist? | Convert to |
|---|---|---|---|---|---|
| Onboarding Flow | `/onboarding`, `/onboarding/flow` | 6-step first run | Once | ✅ Yes | **Full-screen flow** — chrome-free is correct |
| RECON Onboarding | `/onboarding/recon` | Deep ICP setup | Once | ✅ Yes | **Full-screen flow** |
| Barry Onboarding | `/onboarding/barry` | Legacy ICP setup | Rare | ⚠️ Debt | **Delete after deep links expire** |
| Company Profile Qs | `/onboarding/company-profile` | 4-question profile | Once | ✅ Yes | **Step inside onboarding flow** |
| Getting Started | `/getting-started` | Post-signup orientation | Once | ⚠️ Overlap | **Merge into onboarding** |
| Mission Phase 1–5 | `/mission-phase1..5`, `/launch-sequence` | Legacy phased setup | Never | ❌ No | **Delete** (6 routes) |
| ICP Builder | `/icp` | Legacy ICP editor | Never | ❌ No | **Delete** — superseded by RECON |
| ICP Brief | `/icp-brief` | Legacy ICP view | Never | ❌ No | **Delete** — superseded by `/recon/alignment-brief` |
| Add Company | `/add-company` | Legacy manual add | Never | ❌ No | **Delete** — superseded by Scout+ |
| Old Dashboard | `/old-dashboard` | Legacy unified dash | Never | ❌ No | **Delete** |
| Questionnaire | `/questionnaire` | Legacy questionnaire | Never | ❌ No | **Delete** |
| Prospects | `/prospects` | Legacy prospect list | Never | ❌ No | **Delete** |
| Checkout ×3 | `/checkout`, `/checkout/success`, `/checkout/cancel` | Payment | Once | ✅ Yes | **Full-screen flow** — correct |
| Diagnostic | `/diagnostic/dashboard-init` | Support tool | Rare | ✅ Yes | **Keep, admin-gate it** — currently reachable by any paid user |
| Admin ×7 | `/admin/*`, `/admin-ping-test` | Internal ops | Rare | ✅ Yes | **Own admin shell** — 11 pages with zero navigation |
| Super Admin ×4 | `/super-admin/*` | Internal ops | Rare | ✅ Yes | **Own admin shell** |

### Screens that cannot justify being pages — flagged per the brief

- **Create Mission / Create Campaign** — creation forms are modals. A URL that exists only to hold a form is a page that will be abandoned mid-fill with no recovery.
- **Cadences List** — exists twice, at `/scout/cadences` (with sidebar) and as the `cadences` tab inside the Scout shell (with rail). Identical component, two URLs, two chromes.
- **Company People** — a tab on the Company panel, not a route.
- **Scout Game** — a focus mode. It currently renders inside `MainLayout` with a full sidebar, which defeats the purpose of a timed 15-in-30 drill.
- **Contact Profile** — the single most important flag in this table. It is *already* a panel in `AllLeads`, `CompanyProfileView` and `MissionControl` (`isPanelMode = !!onClose`, `ContactProfile.jsx:99`). The full-page version is the inconsistent one, and it is the one that ships the broken back button (D2-J2-1).

### Dead weight

**45 orphaned component files, 16,575 lines**, imported by nothing. Including four separate Mission Control implementations:

| File | Lines | Status |
|---|---|---|
| `src/pages/Scout/MissionControlDashboardV2.jsx` | 1,262 | **Routed** — the live one |
| `src/pages/Scout/MissionControl.jsx` | 1,191 | Orphan |
| `src/pages/MissionControlDashboard.archived.jsx` | 944 | Orphan |
| `src/pages/MissionControlDashboardV2.jsx` | 573 | Orphan (comment at `App.jsx:19` calls it "preserved") |
| `src/pages/Dashboard.jsx` | 420 | Orphan |
| `src/pages/UnifiedDashboard.jsx` | — | Routed at `/old-dashboard` |

Plus files named `ICPValidationPage OLD.jsx`, `OLD2.jsx`, `old3.jsx`, `Phase1Discoverycopy.jsx`, `copy2`, `copy3`, `ScoutQuestionnaire OLD.jsx`, `old2.jsx` — source control is doing this job already.

Eight imports in `App.jsx` are unused entirely: `ICPValidationPage`, `ScoutDashboardPage`, `AllLeads`, `ImprovedScoutQuestionnaire`, `LaunchSequence`, `Phase1Discovery`, `ImpersonationBanner`, `HunterWeaponRoom`.

---

# D1 — Layout Consistency Matrix

| Route | MainLayout? | Sidebar? | Barry accessible? | Header consistent? | Classification |
|---|---|---|---|---|---|
| `/mission-control-v2` | ✅ | ✅ | ✅ `BarryChatPanel` | ✅ Top bar | **Reference implementation** |
| `/scout` | ❌ | ❌ rail | ⚠️ `BarryChat` (different Barry) | ❌ No header, no logout | **Structural debt** |
| `/scout/contact/:id` | ✅ | ✅ | ✅ `BarryChatPanel` | ✅ Top bar | **UX defect** — chrome flips vs `/scout` |
| `/scout/company/:id` | ✅ | ✅ | ✅ | ✅ | **UX defect** — same flip |
| `/scout/company/:id/leads` | ✅ | ✅ | ✅ | ✅ | **UX defect** — same flip |
| `/scout/cadences` | ✅ | ✅ | ✅ | ✅ | **Technical** — duplicates the Scout `cadences` tab |
| `/scout/total-market` | ✅ | ✅ | ✅ | ✅ | **UX defect** — not reachable from the Scout rail |
| `/scout/game` | ✅ | ✅ | ✅ | ✅ | **UX defect** — focus mode wrapped in full chrome |
| `/hunter` | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** |
| `/hunter/blitz` | ❌ | ❌ none | ❌ | ❌ | **Intentional** — focus mode, chrome-free by design |
| `/hunter/create-mission` | ✅ | ✅ | ✅ | ✅ | **UX defect** — chrome flips vs `/hunter` |
| `/hunter/mission/:id` | ✅ | ✅ | ✅ | ✅ | **UX defect** — same flip |
| `/hunter/campaign/new` | ✅ | ✅ | ✅ | ✅ | **UX defect** — same flip |
| `/hunter/campaign/:id` | ✅ | ✅ | ✅ | ✅ | **UX defect** — same flip |
| `/sniper` | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** |
| `/command-center` | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** |
| `/recon` + 6 children | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** — but correct route model |
| `/basecamp` | ❌ | ❌ rail | ⚠️ `BarryChat` ("CSM") | ❌ | **Structural debt** + naming defect |
| `/reinforcements` | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** |
| `/fallback` | ❌ | ❌ rail | ⚠️ `BarryChat` | ❌ | **Structural debt** |
| `/settings` | ❌ | ❌ rail | ⚠️ `BarryChat` ("default") | ❌ No logout | **UX defect** — Settings without sign-out |
| `/mission-control-v2/recon` | ✅ | ✅ | ✅ | ✅ | **Technical** — dead legacy path |
| `/companies`, `/lead-review`, `/old-scout` | ❌ | ❌ `NavigationBar` | ❌ | ❌ 4th paradigm | **Technical** — delete |
| `/icp`, `/icp-brief`, `/add-company`, `/prospects`, `/questionnaire`, `/old-dashboard` | ❌ | ❌ none | ❌ | ❌ | **Technical** — delete |
| `/mission-phase1..5`, `/launch-sequence` | ❌ | ❌ none | ❌ | ❌ | **Technical** — delete |
| `/onboarding/*`, `/checkout/*` | ❌ | ❌ none | ❌ | ❌ | **Intentional** — first-run flows correctly own the screen |
| `/admin/*` (7), `/super-admin/*` (4) | ❌ | ❌ none | ❌ | ❌ | **UX defect** — 11 internal pages, zero navigation |
| `/diagnostic/dashboard-init` | ❌ | ❌ none | ❌ | ❌ | **Implementation bug** — `requirePayment={false}`, any user can reach it (`App.jsx:634`) |

## Classification summary

**Intentional (documented, keep):** Onboarding and checkout flows owning the full screen. Blitz Mode's chrome-free focus mode. RECON's nested-route sub-navigation.

**Technical debt (known, accepted, not yet addressed):** The shell/MainLayout split is explicitly acknowledged in the codebase — `MainLayout.jsx:286-289` states *"True cross-module persistence requires converting module routes to children of one shared parent layout route. Deferred to a future routing phase."* Engineering already knows. This audit's contribution is that **the deferral has a measurable user cost**, itemised in D2. Also: the legacy route families, the 45 orphan files, the duplicated `MODULE_RAIL` constant.

**UX defect (degrades experience, fix):** The chrome flip between a module hub and its own detail pages. Missing logout in 8 modules. Total Market and Game Mode unreachable from Scout. Admin pages with no navigation. Settings with no sign-out.

**Implementation bug (unintended, must fix):**
1. **Bare `/scout` resolves to three different answers simultaneously.** `ScoutMain.jsx:227` computes `initialItem` → `'all'` (People). `ScoutMain.jsx:239-244` then runs an effect: `else if (!tab) setActiveItem('daily')` → Daily Discoveries. Meanwhile `Sidebar.jsx:101` defaults `urlTab` to `'all-leads'` → highlights **People**, and `MainLayout.jsx:137` returns the title **"People"**. Result: the header says People, the sidebar highlights People, the content shows Daily Discoveries. Hunter does this correctly (`HunterMain.jsx:236-239`, default `'all'` in both places) — proving the Scout version is a slip, not a decision.
2. **`ContactProfileView` in `AllLeads.jsx:1129-1179` calls `useEffect` after two conditional early returns.** If it were ever rendered with a contact that loads successfully, React would throw "rendered more hooks than during the previous render." It is currently unreferenced — dead, but a live landmine if someone wires it up.
3. **`NavigationBar` active state is unreachable** — `isActive('/mission-control')` compares against a redirect-only route.
4. **`MainLayout.getPageTitle()` contains dead branches** for `/scout`, `/hunter`, `/recon`, `/people` (`MainLayout.jsx:136-164`) — none of those routes use `MainLayout`. The function is maintained for screens it never renders.

---

# D2 — Navigation Journey Audit

## Journey 1 — Core pipeline flow

`Login → Mission Control → Scout → Contact Profile → Quick Engage → back to Mission Control`

| # | Transition | Where am I? | Why am I here? | Where can I go? | What changed? | New customer understands? |
|---|---|---|---|---|---|---|
| 1 | Login → `SmartRedirect` → `/mission-control-v2` | Mission Control | Logged in | Sidebar (8 pillars) + module grid (8 tiles) | Everything | ⚠️ Two complete navigation systems on screen at once, listing the same 8 modules with different labels |
| 2 | Module grid → `/scout` | Scout | Clicked SCOUT | Icon rail (8) + sub-nav (6) | **The sidebar vanished.** Rail replaces it | ❌ No |
| 3 | Scout → contact click → `/scout/contact/:id` | Contact Profile | Clicked a person | **Sidebar is back.** Rail gone | Chrome swapped again | ❌ No |
| 4 | Engage → `InlineEngagementSection` | Same page | Chose to engage | Inline, scrolls in place | Compose surface appears | ✅ Yes — best transition in the product |
| 5 | Back → "Back to People" → `/scout` | Scout | Clicked back | Rail again | Chrome swapped a third time | ⚠️ Partly |
| 6 | Scout → logo mark → `/mission-control-v2` | Mission Control | Clicked the logo | Sidebar | Chrome swapped a fourth time | ❌ No — the logo is a brand mark, not an obvious button |

### Journey 1 — Five disorientation moments, ranked by pain

**1. The navigation chrome changes four times in a six-step round trip.** (`App.jsx:434` vs `:520`)
Mission Control → sidebar. Scout → icon rail. Contact Profile → sidebar. Back to Scout → icon rail. Mission Control → sidebar. The user has done one loop through one module and the application's primary navigation has re-rendered as a different object four times. Nothing else in this audit costs more confidence per click. A first-time user reasonably concludes they have left the application and entered a different one.

**2. Mission Control shows two competing navigation systems that disagree with each other.** (`Sidebar.jsx:515-522` vs `ModuleNavigationGrid.jsx:28-168`)
The sidebar lists 8 pillars; the module grid lists 8 tiles. Same eight destinations, presented twice, with different labels — the sidebar says **BASECAMP**, the grid says **HOMEBASE**. On the very first screen a new customer sees, the product cannot agree with itself on what a module is called. The user's first navigational decision is not "where do I go" but "which of these two menus is the real one."

**3. "Back to People" is a hardcoded destination, not a return.** (`ContactProfile.jsx:621, 640`)
The button always navigates to `/scout?tab=all-leads`, regardless of origin. Contact Profile is reachable from **eight** entry points — Mission Control (`MissionControlDashboardV2.jsx:179`), Hunter (`DashboardSection.jsx:158`), Company Detail (`CompanyDetail.jsx:1154`), Company People (`CompanyLeads.jsx:142`), Reinforcements (3 sections), Scout+ (`ScoutPlus.jsx:31`), notifications (`NotificationCenter.jsx:90`), and Barry history (`BarrySessionHistoryPanel.jsx:159`). For seven of those eight, the back button silently relocates the user to a module they were not in. It is not a back button; it is a teleport labelled "back."

**4. Getting home requires knowing that the logo is a button.** (`ScoutMain.jsx:489-509`, `:543-560`)
Each shell offers two ways back to Mission Control: the gradient logo mark at the top of the rail, and a 40px "MC" icon at the bottom with a **7px** label. The logo reads as branding. The MC tile is below the fold of attention and abbreviated. Neither is labelled "Mission Control" in visible text. The one destination every user needs constantly is the least discoverable control on screen.

**5. Bare `/scout` lands on a screen the rest of the UI disagrees with.** (`ScoutMain.jsx:227` vs `:243`; `Sidebar.jsx:101`; `MainLayout.jsx:137`)
Header reads "People." Sidebar highlights "People." Content shows "Daily Discoveries." The user is being told two different things about where they are, by the same screen, at the same time.

---

## Journey 2 — Cross-module workflow *(the more important test)*

`Mission Control → Scout → Find Prospect → Save Prospect → Hunter → Send Email → Return to Mission Control`

| # | Transition | Where am I? | What changed? | Context survives? |
|---|---|---|---|---|
| 1 | MC → `/scout` | Scout hub | Sidebar → rail | ❌ Barry closes, thread abandoned |
| 2 | Scout → Scout+ / Daily Discoveries | Scout, tab switch | `?tab=` rewritten with `{replace:true}` | ⚠️ **No history entry created** |
| 3 | Find prospect → save | Same screen | Contact added to roster | ⚠️ No statement of where it went |
| 4 | Open contact → `/scout/contact/:id` | Contact Profile | Rail → sidebar | ❌ Barry unmounts, different Barry mounts |
| 5 | "Move to Hunter" | **Same page** | Contact's stage becomes `hunter` | ❌ **Nothing navigational changes** |
| 6 | Navigate to Hunter | Hunter hub | Sidebar → rail | ❌ Barry closes again |
| 7 | Send email | Hunter | Email sent | ⚠️ Confirmation is local to the card |
| 8 | Return to MC | Mission Control | Rail → sidebar | ❌ Barry closes a third time |

### Journey 2 — Five disorientation moments, ranked by pain

**1. The pipeline stage changes but the navigation does not — the single worst moment in the product.** (`ContactProfile.jsx:832-837`, `ScoutEngagementPanel.jsx:43-52`)
"Move to Hunter" fires `moveContactToHunter`, then `onMoved` does exactly one thing: `setContact(prev => ({ ...prev, stage: stageTo }))`. Local state. That is all. The user stays on the same URL, the header still reads "Contact Profile", the sidebar still highlights Scout, and the back button still says **"Back to People"** pointing at `/scout`. The contact is no longer in Scout. The user has just performed the single most meaningful action in the pipeline — advancing a prospect — and the application gives no navigational acknowledgement that anything happened. Every affordance on screen still describes the world as it was before the click.

*Context loss:* does not know what changed · does not know what happens next · does not know how to get to the thing they just created.

**2. Barry is a different assistant in every module, and the history panel hides most of him.** (`BarryChat.jsx:108` vs `BarryChatPanel.jsx:60`, `:87`)
Conversations are keyed `barryConversations/drawer_${module}` — ten separate threads. Mission Control uses a *different component* writing to `barryConversations/missionControl` **and** to the `barry_sessions` collection. `BarrySessionHistoryPanel.jsx:111` reads `barry_sessions`. Therefore: **no conversation held inside any module shell ever appears in Barry's session history.** Compounding it, the history button lives in the `MainLayout` top bar (`MainLayout.jsx:212-219`), which is not rendered on any module shell — so from Scout you can neither see module history nor reach the button that would show it.

Across this journey Barry also changes persona label and colour four times: TARGETING (blue) in Scout → *nothing* in transit → PURSUE (yellow) in Hunter → a different component on Mission Control. Each open shows "— Resumed from last session —" for a session the user never had here.

This is the direct falsification of *"Barry is helping me, not competing with me."* Barry cannot help across a workflow he cannot remember.

**3. The browser back button skips the entire module.** (`ScoutMain.jsx:251`, `HunterMain.jsx:241`, and 5 more shells)
Every tab-based shell writes `setSearchParams({ tab }, { replace: true })`. Intra-module navigation creates **zero** history entries. A user who moves People → Saved Companies → Daily Discoveries → Scout+ and presses Back does not step back one tab — they exit Scout entirely to whatever preceded it. RECON, built on real routes, behaves correctly. **Two modules, opposite back-button semantics, no signal to the user which one they are in.**

**4. Saving a prospect produces no handoff.** (`ScoutPlus.jsx:31-43`)
The save succeeds and the user is left where they were. There is no statement of *where the prospect went*, no count, no "3 saved — review in Hunter." In a five-stage pipeline, the moment an object moves between stages is precisely the moment the product must narrate itself. It stays silent.

**5. Two Scout features are invisible from Scout.** (`Sidebar.jsx:221-279` vs `ScoutMain.jsx:168-177`)
The sidebar's Scout pillar has 9 items; the Scout shell's sub-nav has 6. **Total Market** (`/scout/total-market`) and **Game Mode** (`/scout/game`) exist only in the sidebar — which is not rendered on `/scout`. A user standing inside Scout cannot reach two of Scout's features. They are reachable only from Mission Control, by a user who already knows they exist.

---

## Context loss inventory — consolidated

| Transition | Doesn't know where they are | …how they got there | …how to return | …what changed | …what happens next |
|---|:--:|:--:|:--:|:--:|:--:|
| MC → Scout | ✅ | | ✅ | ✅ | |
| Scout → Contact Profile | ✅ | | | ✅ | |
| Contact Profile → back | | ✅ | ✅ | | |
| **Move to Hunter** | ✅ | | ✅ | ✅ | ✅ |
| Scout tab → Scout tab | | ✅ | ✅ | | |
| Any module → any module | | ✅ | | ✅ | ✅ |
| Save prospect | | | | ✅ | ✅ |
| Hunter → send email | | | | ⚠️ | ✅ |

**"Move to Hunter" is the only transition in the product that loses all five.** It is also the transition the business depends on most.

---

# D3 — Navigation Debt Classification

| # | Issue | Location | Type | Sprint or Platform? |
|---|---|---|---|---|
| **S1** | Two layout systems: 14 routes use `MainLayout`, 10 render self-contained shells | `App.jsx:369-628` | **Structural** | **Platform** |
| **S2** | Module rail config duplicated in 8 files (`MODULE_RAIL` ×7 + `NAV_SECTIONS` ×1) | All `*Main.jsx` | **Structural** | **Sprint** — extract to one constant |
| **S3** | Barry mounted per-shell; unmounts on every module change | 9 shells | **Structural** | **Platform** |
| **S4** | Command Center holds 6 unrelated concerns (people, companies, missions, weapons, arsenal, outcomes) | `PeopleMain.jsx` | **Structural** | **Platform** |
| **S5** | Sub-navigation model differs: RECON uses routes, 7 modules use `?tab=` | `ReconMain.jsx:163` vs others | **Structural** | **Platform** |
| **U1** | Chrome identity flips between a module hub and its own detail pages | `App.jsx:434` vs `:520` | **UX** | **Platform** |
| **U2** | "Back to People" hardcoded; wrong for 7 of 8 entry points | `ContactProfile.jsx:621, 640` | **UX** | **Sprint** |
| **U3** | "Move to Hunter" produces no navigational response | `ContactProfile.jsx:833` | **UX** | **Sprint** |
| **U4** | `{replace:true}` on every tab switch — back button skips the module | 7 shells | **UX** | **Sprint** |
| **U5** | No logout in 8 module shells or Settings | all shells, `UserSettings.jsx` | **UX** | **Sprint** |
| **U6** | Total Market & Game Mode unreachable from the Scout shell | `ScoutMain.jsx:168-177` | **UX** | **Sprint** |
| **U7** | Return-to-Mission-Control is an unlabelled logo + a 7px "MC" tile | `ScoutMain.jsx:489, 543` | **UX** | **Sprint** |
| **U8** | 11 admin pages with no navigation of any kind | `pages/Admin/*` | **UX** | **Platform** |
| **U9** | Saving a prospect gives no handoff statement | `ScoutPlus.jsx:31` | **UX** | **Sprint** |
| **U10** | Barry session history invisible for all module conversations | `BarrySessionHistoryPanel.jsx:111` | **UX** | **Sprint** |
| **V1** | Sidebar (list, sublabels) vs rail (7px icons) vs `NavigationBar` (emoji) — three visual vocabularies | 3 systems | **Visual** | **Platform** |
| **V2** | Barry accent colour changes per module (10 values) with no legend | `BarryChat.jsx:27-38` | **Visual** | **Sprint** — decide intentional or not |
| **V3** | Rail labels at 7px are below comfortable reading size | `ScoutMain.jsx:533` | **Visual** | **Sprint** |
| **N1** | **Mission Control / Dashboard / Home** — three names, one screen | `Sidebar.jsx:509`, `NavigationBar.jsx:24`, `App.jsx:742` | **Naming** | **Sprint** |
| **N2** | **Basecamp / HOMEBASE / CSM** — three names, one module | `Sidebar.jsx:519`, `ModuleNavigationGrid.jsx:91`, `BarryChat.jsx:33-36` | **Naming** | **Sprint** |
| **N3** | **Command Center / People / All People** — three names, one module | `Sidebar.jsx:515`, `App.jsx:429`, `MainLayout.jsx:164` | **Naming** | **Sprint** |
| **N4** | "People" means three different things: Scout tab, Hunter tab, Command Center tab | `Sidebar.jsx:126, 224, 284` | **Naming** | **Sprint** |
| **N5** | Barry has 10 persona labels (COACH/TARGETING/PURSUE/CLOSE/SUGGEST/GUIDE/CONNECT/RECOVER/CSM/ASSIST) | `BarryChat.jsx:27-38` | **Naming** | **Platform** — is Barry one character or ten? |
| **T1** | 45 orphaned files, 16,575 lines | `src/**` | **Technical** | **Sprint** |
| **T2** | Four Mission Control implementations, three orphaned | `pages/**` | **Technical** | **Sprint** |
| **T3** | 8 unused imports in `App.jsx` | `App.jsx:35-98` | **Technical** | **Sprint** |
| **T4** | Files named `OLD.jsx`, `copy2.jsx`, `old3.jsx` in `src/` | `components/**` | **Technical** | **Sprint** |
| **T5** | Legacy route families still live (`/icp`, `/prospects`, `/mission-phase1-5`, …) | `App.jsx:754-829` | **Technical** | **Sprint** |
| **T6** | `NavigationBar` — 4th nav system, dead active-state, points at a redirect | `NavigationBar.jsx:24-32` | **Technical** | **Sprint** |
| **T7** | `getPageTitle()` maintains branches for routes that never use `MainLayout` | `MainLayout.jsx:136-164` | **Technical** | **Sprint** |
| **T8** | `/scout/cadences` duplicates the Scout `cadences` tab | `App.jsx:461`, `ScoutMain.jsx:175` | **Technical** | **Sprint** |
| **B1** | Bare `/scout` → header "People", sidebar "People", content "Daily Discoveries" | `ScoutMain.jsx:227` vs `:243` | **Implementation bug** | **Sprint** |
| **B2** | `ContactProfileView` calls `useEffect` after conditional returns | `AllLeads.jsx:1129-1179` | **Implementation bug** | **Sprint** — delete it |
| **B3** | `/diagnostic/dashboard-init` reachable by any authenticated user | `App.jsx:634` | **Implementation bug** | **Sprint** |
| **B4** | `MODULE_CONFIG.basecamp` (CSM) unreachable — route maps send `/basecamp` → `homebase` (GUIDE) | `Sidebar.jsx:48`, `BarryTrigger.jsx:26` vs `BasecampMain.jsx:186` | **Implementation bug** | **Sprint** |

**Totals:** 5 structural · 10 UX · 3 visual · 5 naming · 8 technical · 4 bugs = **35 issues**. 24 are sprint-sized; 11 are platform work.

---

# D4 — One Architectural Rule

## The rule

> ### One persistent application shell owns navigation, identity, and Barry.
> ### Routes render *into* the shell. A route never replaces it.

Concretely: exactly one `<Route element={<AppShell/>}>` wrapping every authenticated route as children. The shell mounts once at login and unmounts at logout. Modules become `<Outlet/>` content. Full-screen flows — onboarding, checkout, Blitz Mode — are the *only* routes permitted outside it, and each must be justified in writing.

## Why this rule and not another

Of the 35 issues in D3, **26 dissolve** if this rule is enforced, because they are not independent problems — they are the same problem observed from different angles:

| Issue | Why the rule eliminates it |
|---|---|
| S1, S2, S5, U1 | One shell means one chrome. The flip cannot occur; the duplicated rail config has nowhere to live |
| S3, U10, N5, V2, J2-2 | Barry mounts once in the shell, holds one thread across every route |
| U4 | Sub-navigation becomes real child routes, so history works by construction |
| U5, U7, U8 | Logout and "home" live in the shell — present on every authenticated route, including admin |
| U6 | One nav definition per module: a feature is either in it or not. It cannot be in one copy and absent from another |
| N1–N4 | One nav source means one label per destination. Divergence becomes impossible rather than merely discouraged |
| T6, T7, V1 | The fourth nav system and the dead title branches have no reason to exist |
| B1 | One place resolves "what does bare `/scout` mean" |

**The evidence that this is the right rule is that the codebase already reached the same conclusion and deferred it.** `MainLayout.jsx:286-289`:

> *"Barry persistence is currently limited to the lifetime of this MainLayout instance. True cross-module persistence requires converting module routes to children of one shared parent layout route. Deferred to a future routing phase."*

That is this rule, written by the team, correctly diagnosed, and postponed. What the deferral did not account for is that the cost is not confined to Barry. It also produced the chrome flip, the divergent labels, the missing logout, the broken back button, and the two unreachable Scout features. This audit's recommendation is not new information — it is a re-pricing of a decision already on the books.

RECON also proves the target state is achievable in this codebase: `App.jsx:392-406` already nests six children under one parent route, and it is the only module with correct back-button behaviour and deep-linkable sub-navigation.

## Would I build it this way from scratch?

**No.** Using only the modules that exist today, I would build this:

**1. Navigation follows the pipeline, because the pipeline is the mental model.**
The product has a five-stage story — *Scout → Hunter → Sniper → Basecamp*, with *RECON* as the intelligence that feeds it and *Fallback / Reinforcements* as recovery paths. Today's navigation presents eight peers in a flat list, which discards the story. A salesperson does not think in eight equal modules; they think "where is this deal, and what is next." Primary navigation should be the pipeline in order, so position in the nav teaches position in the pipeline.

**2. Contact is a panel, never a page.**
The contact is the atomic unit of the product, and it is opened from eight different places. Making it a page forces a return decision that cannot be answered correctly from a hardcoded string. As a panel over the list you came from, "back" is "close" — always right, no state to carry. The codebase already agrees: `isPanelMode` exists and is used in three call sites (`ContactProfile.jsx:99`). I would delete the page variant, not add a ninth back-button special case.

**3. Barry is one entity in the shell, with one thread and one memory.**
Not ten drawers with ten Firestore documents and ten persona labels. Barry may know which module you are in — that is context, and it is valuable — but he must not *forget the conversation* when you cross a boundary. The current design means the assistant loses the thread at exactly the moment the user crosses a module boundary, which is exactly when a user most needs help. Barry should keep one conversation and be told the route, not handed a new brain per URL.

**4. Stage transitions are narrated events, not silent writes.**
"Move to Hunter" should produce a visible, reversible confirmation — *"Sarah Chen moved to Hunter. [Open in Hunter] [Undo]"* — and update the surrounding navigation to reflect the new truth. In a pipeline product, the transition **is** the product. Today it is a `setState` call with no user-facing consequence.

**5. Secondary destinations are not rail peers.**
Fallback (monthly), Settings, and Admin do not deserve the same visual weight as Scout (hourly). Frequency should drive hierarchy. Today all eight modules are peers regardless of whether a user visits them fifty times a day or twice a quarter.

---

# D5 — Desktop Navigation Wireframe

## Proposed — Pipeline Shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [◆ IDYNIFY]   Mission Control ▸ Scout ▸ Sarah Chen        [Barry] [?] [AW ▾] │  ← persistent shell header
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │                                                                 │
│ MISSION    │                                                                 │
│ CONTROL    │                                                                 │
│            │                                                                 │
│ ── PIPELINE│                          <Outlet/>                              │
│  ① SCOUT ● │                     (module content)                            │
│  ② HUNTER  │                                                                 │
│  ③ SNIPER  │                                                                 │
│  ④ BASECAMP│                                                                 │
│            │                                                                 │
│ ── INTEL   │                                                                 │
│  RECON     │                                                                 │
│  COMMAND   │                                                                 │
│  CENTER    │                                                                 │
│            │                                                                 │
│ ── RECOVERY│                                                                 │
│  Fallback  │                                                                 │
│  Reinforce │                                                                 │
│            │                                                                 │
├────────────┤                                                                 │
│ ⚙ Settings │                                                                 │
│ ⏻ Log out  │                                                                 │
└────────────┴─────────────────────────────────────────────────────────────────┘
                                                    ┌──────────────────────────┐
                                                    │  BARRY — one thread      │  ← shell-owned,
                                                    │  persists across routes  │    never unmounts
                                                    └──────────────────────────┘
```

Module sub-navigation is a **horizontal tab strip at the top of `<Outlet/>`**, backed by real child routes:

```
│ SCOUT                                                                        │
│ [People] [Daily Discoveries] [Saved Companies] [Scout+] [Total Market] [ICP] │
├──────────────────────────────────────────────────────────────────────────────┤
│  list of people …                        ┌─────────────────────────────────┐ │
│                                          │ SARAH CHEN            [✕ Close] │ │  ← contact
│                                          │ VP Eng · Acme                   │ │    panel,
│                                          │ [ Move to Hunter ]              │ │    not a page
│                                          └─────────────────────────────────┘ │
```

**Why this hierarchy?** Primary navigation is the pipeline in order, so nav position teaches pipeline position — the nav itself becomes the explanation of the product. Numbering makes the sequence explicit. INTEL and RECOVERY are grouped separately because they are not stages; they are inputs and exits, and grouping them stops a user from reading eight peers as eight steps.

**What I traded away.** Vertical density — three group headers cost roughly 60px. Worth it: an unlabelled flat list of eight is why "where am I in the pipeline" is currently unanswerable. I also moved sub-navigation from a second vertical column to a horizontal strip, which limits a module to ~8 comfortable sub-items. That is a constraint I want; Command Center's current six unrelated concerns should not fit.

**What I left out, deliberately.**
- *The module grid on Mission Control.* Duplicate navigation to the same eight destinations, with labels that already disagree (HOMEBASE vs BASECAMP). Mission Control should show **state** — what needs attention — and let the shell handle movement. Two nav systems on the home screen is why step 1 of Journey 1 fails.
- *Contact Profile as a page.* Deleted in favour of the panel that already exists.
- *The second "MC" home tile.* One home affordance, labelled in words.
- *Per-module Barry colours.* Deferred, not decided — see the open question below.

**Why better than today?** The chrome never changes: four re-renders in Journey 1 become zero. Barry keeps one thread. Back works by construction. Logout is reachable from all 50 screens instead of 17. There is exactly one definition of what Scout contains, so Total Market cannot go missing.

---

## Alternate — Context Bar

For leadership to weigh: same shell, but primary navigation is horizontal and the left column is given to *live pipeline state*.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆  [Mission Control] [Scout] [Hunter] [Sniper] [Basecamp] [More ▾]  [AW ▾]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Scout ▸ Daily Discoveries          47 new · 12 need review     [Barry ▾]     │  ← context bar
├──────────┬───────────────────────────────────────────────────────────────────┤
│ PIPELINE │                                                                   │
│ Scout  47│                          <Outlet/>                                │
│ Hunter 23│                                                                   │
│ Sniper  8│                                                                   │
│ Base    4│                                                                   │
│ ─────────│                                                                   │
│ Today    │                                                                   │
│ • 6 due  │                                                                   │
│ • 2 reply│                                                                   │
└──────────┴───────────────────────────────────────────────────────────────────┘
```

**Why this hierarchy?** It answers "where am I in the pipeline" with **numbers**, continuously. The left column stops being a menu and becomes a dashboard that is always on screen — the pipeline is ambient rather than something you navigate to.

**Tradeoffs.** Horizontal top nav caps primary items at ~6, forcing RECON, Command Center, Fallback and Reinforcements behind "More" — a real demotion for RECON, which new users need early. It also spends the most valuable screen column on information rather than movement, costing a click on every module change.

**What I left out.** Sub-navigation as a persistent element — it lives in the context bar and changes per module, which is more elegant and less discoverable.

**Why better than today?** Same structural wins as Proposed, plus continuous pipeline visibility. **Why I still recommend Proposed:** the "More" menu recreates in miniature the exact failure this audit is about — a destination whose navigation depends on where you are standing. Proposed is the safer answer to the brief's actual question.

---

# D6 — Prioritized Action Plan

Ranked by user impact × engineering effort × risk.

| # | Fix | Impact | Effort | Risk | Sprint or Platform? |
|---|---|---|---|---|---|
| 1 | **Single shell:** wrap all authenticated routes in one `AppShell` layout route; modules become `<Outlet/>` children | **Very High** | High | Med | **Platform** |
| 2 | **Unify Barry:** one mounted instance in the shell, one conversation thread, one persistence key; retire the `BarryChat` / `BarryChatPanel` split | **Very High** | Med | Med | **Platform** |
| 3 | **Contact Profile → panel:** delete the page variant; `/scout/contact/:id` opens the panel over its origin list | **Very High** | Med | Low | **Sprint** |
| 4 | **Narrate stage transitions:** "Move to Hunter" shows a confirmation with *Open in Hunter* + *Undo*, and updates surrounding nav | **Very High** | Low | Low | **Sprint** |
| 5 | **Add logout + labelled Home** to every shell (interim, pending #1) | High | **Very Low** | **Very Low** | **Sprint** |
| 6 | **Extract one `MODULE_RAIL` constant** consumed by all 8 shells + Sidebar | High | **Very Low** | **Very Low** | **Sprint** |
| 7 | **Fix naming (N1–N4):** one name per destination, enforced by #6 — Mission Control, Basecamp, Command Center | High | Low | **Very Low** | **Sprint** |
| 8 | **Drop `{replace:true}`;** convert module tabs to real child routes so back works | High | Med | Med | **Sprint** |
| 9 | **Delete dead surface:** 45 orphan files (16,575 lines), `NavigationBar` + its 3 routes, legacy route families, 8 unused imports | Med | Low | Low | **Sprint** |
| 10 | **Fix B1–B4:** bare-`/scout` default, `ContactProfileView`, diagnostic route auth, Basecamp Barry key | Med | **Very Low** | **Very Low** | **Sprint** |

## If you could only change three things this sprint

### 1. Put every authenticated route inside one shell — starting with the eight module shells

*Why:* It is the root cause. 26 of 35 issues are downstream of its absence. Every other fix is either a workaround for it or gets easier once it lands. Do the module shells first — they are the eight files where the chrome flip actually happens, and they already share an identical `MODULE_RAIL`, so the extraction is mechanical rather than inventive. Mission Control and the detail pages already have a shell; the work is making it *the* shell.

*Test it against the philosophy:* **"The platform feels like one connected operating system."** Today it demonstrably does not — it feels like four applications sharing a domain. Nothing else on this list moves that sentence.

### 2. Make "Move to Hunter" — and every stage transition — a narrated, reversible event

*Why:* It is the highest-value action in the product and the only transition that loses all five context dimensions. It is also cheap: the panel, the mutation and the destination all exist. What is missing is the product *telling the user what it just did*. This is the clearest instance of the brief's design test — it does not reduce clicks, it reduces the "wait, did that work?" pause that currently follows every stage change.

*Test it against the philosophy:* **"I always know where I am in the pipeline."** Right now the one moment that changes your position in the pipeline is the one moment the product says nothing.

### 3. Make Barry one assistant with one memory

*Why:* Barry is the product's differentiator and he is currently ten disconnected assistants, seven of whose conversations are invisible in his own history panel — a panel you cannot even reach from the modules where those conversations happen. This is a correctness problem, not a polish problem: users are losing work. It also gets substantially cheaper the moment #1 lands, which is why these three are one sprint and not three.

*Test it against the philosophy:* **"Barry is helping me, not competing with me."** An assistant who forgets the conversation every time you change screens is competing with you for context.

**Why these three and not the others:** #5–#10 are real and mostly cheap, but they are symptom management. Fix the shell and the naming divergence stops being possible rather than merely fixed; fix the transitions and Barry, and the two philosophy statements the product currently fails become true. The remaining seven can be absorbed into the shell migration or picked up as background cleanup by anyone with a spare afternoon.

---

## The design test, applied

> **Does this reduce clicks, or reduce thinking?**

| Recommendation | Clicks | Thinking | Verdict |
|---|---|---|---|
| Single shell | Neutral | **Large reduction** | ✅ Ship |
| Narrated transitions | **+1** (dismiss/confirm) | **Large reduction** | ✅ Ship — the extra click is the point |
| Contact panel | −1 (no back nav) | **Large reduction** | ✅ Ship |
| Unified Barry | Neutral | **Large reduction** | ✅ Ship |
| Pipeline-grouped nav | Neutral | **Moderate reduction** | ✅ Ship |
| Removing the MC module grid | **+1** to some modules | Moderate reduction | ✅ Ship — one menu that is right beats two that disagree |

Every recommendation in this audit trades clicks for certainty. That is the correct trade for enterprise software, and it is the trade the brief asked for.

---

## Scorecard — does the product produce the intended feeling today?

| Philosophy statement | Today | Blocking issue |
|---|:--:|---|
| *I always know where I am in the pipeline* | ❌ | Chrome flips 4× per loop; stage changes are silent (U1, U3) |
| *Barry is helping me, not competing with me* | ❌ | 10 Barrys, 10 memories, history hides 8 of them (S3, U10) |
| *The platform feels like one connected operating system* | ❌ | Four navigation systems (S1, T6) |
| *Every screen has one clear purpose* | ⚠️ | Mostly true; Command Center holds 6 concerns; ~50 screens is too many (S4, D0) |
| *I can move fast without ever thinking about the UI* | ❌ | Back button skips modules; features unreachable from their own module (U4, U6) |

**One of five is even partially true.** D6 items 1–3 are what move the other four.

---

## Assumptions and limits of this audit

Stated plainly so engineering knows what was measured and what was judged:

- **Frequency of use is estimated, not measured.** There is no analytics instrumentation in the routing layer. The frequency column reflects pipeline role. Validate against telemetry before deleting anything on frequency grounds alone.
- **This is a static read of the codebase**, not a session with the running application. Route/layout/component claims are cited to `file:line` and are verifiable; visual and rendering claims are inferred from source.
- **Journeys were walked through the code path**, not clicked in a browser. Every transition described traces to a specific handler.
- **Mobile was out of scope** per the brief (desktop sprint). One flag anyway: `BottomNav`'s four primary tabs are Scout, Hunter, Sniper and Basecamp (`BottomNav.jsx:36`) — all four are routes that do **not** render `MainLayout`, and therefore do not render `BottomNav`. Every primary mobile tab navigates away from the navigation that offers it. Worth a Team B ticket.
- **Deletion recommendations for legacy routes assume no active deep links.** Check email templates and Crisp macros before removing `/onboarding/barry`, `/icp`, and the `mission-phase*` family.
