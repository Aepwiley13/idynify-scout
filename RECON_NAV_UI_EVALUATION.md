# Recon Navigation & UI Evaluation Report

**Date:** 2026-01-31
**Scope:** Navigation, Routing, UI Components, Responsiveness, Accessibility
**Codebase:** idynify-scout (React 18 + React Router 6 + TailwindCSS + Lucide Icons)

---

## Executive Summary

The application uses a three-pillar navigation architecture (RECON, Scout, Hunter) with a collapsible sidebar, tab-based sub-navigation, and breadcrumb support in the RECON module. The routing system is comprehensive with 50+ routes, legacy redirects, and auth guards.

This evaluation identified **12 findings** ranging from HIGH to LOW severity. The most critical issues are a route parameter mismatch that breaks Hunter mission detail pages, and a dashboard link pointing to a legacy RECON route. Several medium-severity issues affect tab persistence on page refresh and mobile responsiveness.

---

## Findings

### NAV-01: CampaignDetail Route Parameter Mismatch (HIGH)

- **Severity:** HIGH — Broken functionality
- **Location:** `src/pages/Hunter/CampaignDetail.jsx:12`, `src/App.jsx:414`
- **Description:** Two routes render the same `<CampaignDetail />` component but use different parameter names:
  ```
  App.jsx:414  →  /hunter/mission/:missionId   (param name: missionId)
  App.jsx:430  →  /hunter/campaign/:campaignId  (param name: campaignId)
  ```
  The component only extracts `campaignId`:
  ```javascript
  // CampaignDetail.jsx:12
  const { campaignId } = useParams();
  ```
  When a user navigates to `/hunter/mission/abc123`, the component receives `missionId=abc123` in params but reads `campaignId` which is `undefined`. Line 34 then queries `campaigns/undefined` from Firestore, which fails.
- **Impact:** All links/navigation to `/hunter/mission/:id` show "Campaign not found" error.
- **Steps to Reproduce:**
  1. Navigate to `/hunter/mission/any-valid-id`
  2. Component loads with `campaignId = undefined`
  3. Firestore query fails → "Campaign not found" error displayed
- **Fix:** Extract both params with fallback:
  ```javascript
  const { campaignId, missionId } = useParams();
  const id = campaignId || missionId;
  ```

---

### NAV-02: Mission Control Dashboard Links to Legacy RECON Route (HIGH)

- **Severity:** HIGH — Inconsistent navigation
- **Location:** `src/pages/MissionControlDashboardV2.jsx:299`
- **Description:** The RECON module card on the main dashboard navigates to the legacy route:
  ```javascript
  onClick={() => navigate('/mission-control-v2/recon'))  // Legacy route
  ```
  But the Sidebar navigates to the current route:
  ```javascript
  { path: '/recon', isPrimary: true }  // Current route
  ```
  These resolve to **different components:**
  - `/mission-control-v2/recon` → `RECONModulePage` (old module page)
  - `/recon` → `ReconOverview` (new overview dashboard)
- **Impact:** Users clicking RECON from the dashboard see a different page than users clicking RECON from the sidebar. This is confusing and undermines the new RECON architecture.
- **Steps to Reproduce:**
  1. Click RECON card on Mission Control dashboard → goes to legacy page
  2. Click RECON Overview in sidebar → goes to new overview page
- **Fix:** Change line 299 to `navigate('/recon')`.

---

### NAV-03: Scout Tab State Lost on Page Refresh (HIGH)

- **Severity:** HIGH — Broken user workflow
- **Location:** `src/pages/Scout/ScoutMain.jsx:21`
- **Description:** Active tab is stored via React Router's ephemeral `location.state`:
  ```javascript
  const initialTab = location.state?.activeTab || 'daily-leads';
  const [activeTab, setActiveTab] = useState(initialTab);
  ```
  The Sidebar navigates with:
  ```javascript
  navigate('/scout', { state: { activeTab: 'company-search' } })
  ```
  React Router's `location.state` is **not persisted** across page refreshes or direct URL navigation. When the user refreshes, `location.state` is `null` and the tab resets to `daily-leads`.
- **Impact:** Users lose their tab position on every refresh. URLs cannot be shared to link to specific tabs. Browser back/forward navigation doesn't restore tab state.
- **Steps to Reproduce:**
  1. Click "Company Search" in the Sidebar
  2. Observe you're on the Company Search tab
  3. Press F5 to refresh
  4. Tab resets to "Daily Leads"
- **Fix:** Use URL search params: `/scout?tab=company-search` with `useSearchParams()`.

---

### NAV-04: Hunter Tab State Lost on Page Refresh (MEDIUM)

- **Severity:** MEDIUM
- **Location:** `src/pages/Hunter/HunterWeaponRoom.jsx:28`
- **Description:** Same issue as NAV-03 but for the Hunter module. `activeTab` defaults to `'missions'` and is stored in component state only:
  ```javascript
  const [activeTab, setActiveTab] = useState('missions');
  ```
  The component doesn't even read `location.state?.activeTab` — it completely ignores the Sidebar's navigation state.
- **Impact:** Sidebar clicks to specific Hunter tabs (Weapons, Arsenal, Outcomes) may not actually switch the tab if the component is already mounted.
- **Fix:** Read `location.state?.activeTab` or URL params, same pattern as NAV-03.

---

### NAV-05: ReconSectionEditor Invalid Section Fallback Navigation (MEDIUM)

- **Severity:** MEDIUM
- **Location:** `src/pages/Recon/ReconSectionEditor.jsx:75, 80, 132, 142`
- **Description:** When navigating back from a section editor, the code constructs the path using `parentModule`:
  ```javascript
  navigate(`/recon/${parentModule || ''}`);
  ```
  The `parentModule` comes from `SECTION_TO_MODULE` map (sections 1-10 only). For any invalid `sectionId`, `parentModule` is `undefined`, producing `/recon/` (with trailing slash) instead of `/recon`.
- **Impact:** Navigating to `/recon/section/invalid` and then clicking "Back" sends the user to `/recon/` which may not resolve identically to `/recon` depending on router configuration.
- **Fix:** `navigate(parentModule ? `/recon/${parentModule}` : '/recon')`

---

### NAV-06: ReconOverview Interactive Cards Not Keyboard Accessible (MEDIUM)

- **Severity:** MEDIUM — WCAG 2.1 Level A violation
- **Location:** `src/pages/Recon/ReconOverview.jsx:385-394, 494-502`
- **Description:** Module cards and training dimension items use `<div onClick={...}>` instead of `<button>` elements:
  ```jsx
  <div onClick={() => navigate(mod.path)} className="...cursor-pointer group...">
  ```
  These are missing:
  - `role="button"` or semantic `<button>` element
  - `tabIndex={0}` for keyboard focus
  - `onKeyDown` handler for Enter/Space activation
  - `aria-label` for screen readers
- **Impact:** Keyboard-only users cannot Tab to or activate these elements. Screen readers don't announce them as interactive.
- **Fix:** Replace `<div>` with `<button>` or add `role="button"`, `tabIndex={0}`, and `onKeyDown` handlers.

---

### NAV-07: ScoutMain No In-Component Tab Navigation (MEDIUM)

- **Severity:** MEDIUM
- **Location:** `src/pages/Scout/ScoutMain.jsx:71-80`
- **Description:** The Scout page renders tab content conditionally but provides no visible tab bar within the page itself. A comment on line 71 says "Navigation now handled by sidebar." If the sidebar is collapsed or the user is on mobile with the menu closed, there is no way to switch tabs without opening the sidebar.
- **Impact:** Poor discoverability. Users on mobile or with collapsed sidebar cannot switch Scout tabs without extra interaction.
- **Fix:** Add a horizontal tab bar within ScoutMain that mirrors the sidebar options, or ensure the page header indicates which tab is active.

---

### NAV-08: Silent Failure on Invalid Scout Tab Value (MEDIUM)

- **Severity:** MEDIUM
- **Location:** `src/pages/Scout/ScoutMain.jsx:73-80`
- **Description:** Tab content renders via conditional checks:
  ```jsx
  {activeTab === 'company-search' && <CompanySearch />}
  {activeTab === 'contact-search' && <ContactSearch />}
  ...
  ```
  If `activeTab` contains a typo or invalid value (e.g., `'daily-lead'` without the 's'), none of the conditionals match and the user sees a completely blank content area with no error indication.
- **Impact:** Debugging aid missing; users see blank page with no explanation.
- **Fix:** Add a fallback default render or redirect to `daily-leads` when no match.

---

### NAV-09: No Error UI on RECON Data Load Failures (MEDIUM)

- **Severity:** MEDIUM
- **Location:** `src/pages/Recon/ReconOverview.jsx:197-220`, `src/pages/Recon/ReconModulePage.jsx:199-226`, `src/pages/Recon/BarryTraining.jsx:97-119`
- **Description:** All three RECON pages catch data-loading errors with `console.error()` but provide no UI feedback:
  ```javascript
  catch (error) {
    console.error('Error loading RECON data:', error);
    // No UI feedback — user sees empty/stale data
  }
  ```
- **Impact:** If Firestore is temporarily unreachable, users see a blank page or stale data with no indication that anything went wrong. No retry option.
- **Fix:** Add an `error` state variable and render an error banner with a retry button.

---

### NAV-10: Sidebar Shadow Invisible on Desktop (LOW)

- **Severity:** LOW — Visual polish
- **Location:** `src/components/layout/Sidebar.css:304`
- **Description:** The sidebar's box-shadow has zero opacity:
  ```css
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0);  /* 0 opacity = invisible */
  ```
  The mobile-open state correctly uses `0.15` opacity. Desktop sidebar has no visual depth separation from the main content area.
- **Fix:** Change to `rgba(0, 0, 0, 0.08)` or similar subtle value.

---

### NAV-11: MainLayout getPageTitle Missing Routes (LOW)

- **Severity:** LOW — Non-breaking
- **Location:** `src/components/layout/MainLayout.jsx:23-78`
- **Description:** The `getPageTitle()` function doesn't include titles for all routes. Missing routes (that currently don't use MainLayout, so non-breaking):
  - `/forgot-password` → should return "Reset Password"
  - `/checkout/*` variants
  - `/getting-started`

  Currently returns the default "Idynify Scout" for any unmatched path.
- **Impact:** If any of these routes are changed to use `withLayout={true}` in the future, they'll show the wrong title.
- **Fix:** Add missing cases for completeness.

---

### NAV-12: ReconOverview No Empty State Message (LOW)

- **Severity:** LOW — UX polish
- **Location:** `src/pages/Recon/ReconOverview.jsx:294-296`
- **Description:** When a user has no RECON section data (first-time user), the page shows 0% progress, "Low" confidence, all modules as "Not started" — all technically correct, but no explanatory message guiding the user to start.
- **Impact:** New users may be confused about why everything is empty and where to begin.
- **Fix:** Add a welcome/onboarding banner when `sections.length === 0`.

---

## Findings Summary

| ID | Severity | Category | Title | Location |
|----|----------|----------|-------|----------|
| NAV-01 | HIGH | Routing | CampaignDetail parameter mismatch — mission route broken | `CampaignDetail.jsx:12` |
| NAV-02 | HIGH | Navigation | Dashboard RECON link → legacy route, not current | `MissionControlDashboardV2.jsx:299` |
| NAV-03 | HIGH | State | Scout tab state lost on page refresh | `ScoutMain.jsx:21` |
| NAV-04 | MEDIUM | State | Hunter tab state lost on page refresh | `HunterWeaponRoom.jsx:28` |
| NAV-05 | MEDIUM | Routing | Section editor back-nav fallback produces `/recon/` | `ReconSectionEditor.jsx:75` |
| NAV-06 | MEDIUM | Accessibility | Interactive cards not keyboard accessible | `ReconOverview.jsx:385-394` |
| NAV-07 | MEDIUM | UX | No in-component tab nav in Scout (sidebar-only) | `ScoutMain.jsx:71-80` |
| NAV-08 | MEDIUM | UX | Invalid tab value renders blank page silently | `ScoutMain.jsx:73-80` |
| NAV-09 | MEDIUM | UX | RECON pages silently swallow data load errors | Multiple files |
| NAV-10 | LOW | Visual | Sidebar shadow invisible on desktop | `Sidebar.css:304` |
| NAV-11 | LOW | UX | MainLayout getPageTitle missing some routes | `MainLayout.jsx:23-78` |
| NAV-12 | LOW | UX | No empty state message for new RECON users | `ReconOverview.jsx:294` |

---

## Answers to Evaluation Questions

### Do all links load the correct page?
**No.** Two critical navigation failures:
1. **NAV-01:** `/hunter/mission/:missionId` routes render CampaignDetail which reads `campaignId` → `undefined` → "Campaign not found" error.
2. **NAV-02:** Dashboard RECON card navigates to `/mission-control-v2/recon` (legacy RECONModulePage) instead of `/recon` (current ReconOverview).

All other links (sidebar items, admin routes, breadcrumbs, back buttons) resolve correctly.

### Do UI elements update correctly on state changes?
**Partially.** Tab state is the primary failure point:
1. **NAV-03/04:** Scout and Hunter tab selections are ephemeral — lost on page refresh, not in the URL, and not bookmarkable.
2. **NAV-08:** Invalid tab values produce a blank page with no feedback.
3. **NAV-09:** Failed data loads show no error state — the UI appears stuck or empty.

Sidebar active states, breadcrumbs, loading spinners, and auth state transitions all work correctly.

### Any broken layouts, missing labels, or alignment issues?
**Yes, minor issues:**
1. **NAV-06:** Interactive elements (module cards, training dimensions) use `<div>` instead of `<button>`, making them invisible to keyboard navigation and screen readers.
2. **NAV-10:** Desktop sidebar has an invisible shadow (opacity 0), reducing visual depth.
3. **NAV-12:** No onboarding guidance for new users with empty RECON data.
4. **NAV-11:** Page title bar shows generic "Idynify Scout" for unhandled routes.
