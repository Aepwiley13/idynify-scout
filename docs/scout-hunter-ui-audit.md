# Scout vs. Hunter UI Audit — Saved Companies / Companies View

**Date:** 2026-03-06
**Branch:** `claude/audit-scout-hunter-ui-uxFHx`
**Files audited:**
- `src/pages/Scout/SavedCompanies.jsx` (815 lines)
- `src/pages/Scout/SavedCompanies.css` (720 lines)
- `src/pages/Hunter/sections/CompaniesSection.jsx` (298 lines)
- `src/pages/Hunter/sections/CompaniesSection.css` (344 lines)

---

## 1. Stats Display

### Current State

| Attribute | Scout | Hunter |
|---|---|---|
| **Layout** | 4-column CSS grid (`repeat(4,1fr)`) | 3-card horizontal flexbox (`flex-wrap: wrap`) |
| **Stats shown** | Total Companies · Total Contacts · With Contacts · Completion Rate | Saved Companies · Companies Engaged · Active Contacts |
| **Card anatomy** | Label (8px, uppercase) + value (18px bold) — no icon | Icon (16px Lucide) + value (22px bold) + label (11px) |
| **Highlight / accent** | 4th card uses cyan theme token (`T.cyanBg`, `T.cyanBdr`) | Active icon uses `#3b82f6`; third icon uses `#8b5cf6` |
| **Hover effect** | None | None |
| **Padding / border** | `10px 12px`, radius 9px | `12px 16px`, radius 12px |
| **Responsive** | Always 4 columns regardless of viewport | `flex: 1; min-width: 130px` — wraps naturally |
| **Source** | SavedCompanies.jsx line 211–226 | CompaniesSection.jsx line 250–272 |

### Key Differences

1. **Column count mismatch.** Scout forces 4 columns at all times (breaks on narrow sidebars). Hunter uses responsive flex.
2. **Metrics mismatch.** Scout tracks *contact completion progress* (discovery phase). Hunter tracks *engagement progress* (activation phase). These are intentionally different and correct.
3. **Icon presence.** Hunter cards have leading Lucide icons; Scout cards don't. Hunter feels more polished.
4. **Value font-size.** Scout uses `18px`; Hunter uses `22px`. Inconsistency creates visual hierarchy differences between modules.

### Recommendation — Standardize on Hunter pattern

Use the Hunter stat-card shell (icon + 22px value + label, flex-wrap, min-width 130px) in both modules. Scout should switch from 4-column grid to `flex-wrap`. The *metrics themselves* should remain distinct per module (they measure different phases).

**Unified stat card spec:**
```
display: flex; align-items: center; gap: 10px;
padding: 12px 16px; border-radius: 12px; border: 1.5px solid <border>;
flex: 1; min-width: 130px;

[Icon 16px] + [value 22px bold] + [label 11px muted]
```

---

## 2. Tab Structure

### Current State

| Attribute | Scout | Hunter |
|---|---|---|
| **Tabs** | Active (*n*) · Archived (*n*) | Companies · People · Weapons · Missions (top-level nav) |
| **Tab level** | Sub-tabs inside the Saved Companies view | Module-level navigation in `HunterMain.jsx` |
| **Active indicator** | 2px bottom border in `BRAND.pink` | Different pattern in HunterMain icon rail |
| **Archived state** | Fully implemented — persists to Firestore, shows count | No equivalent archived state for companies in Hunter |
| **Source** | SavedCompanies.jsx line 229–239 | HunterMain.jsx (module nav) |

### Key Differences

1. **Scope mismatch.** Scout's Active/Archived are content-state tabs within one view. Hunter's tabs are top-level module sections (Companies, People, etc.) — these are architecturally different and shouldn't be conflated.
2. **Archived companies invisible in Hunter.** If a user archives a company in Scout, it disappears from Hunter's Companies view with no indication. Hunter only queries `status === 'accepted'` (CompaniesSection.jsx line 165).
3. **No tab count badges in Hunter.** Scout shows `Active (307)` counts inline; Hunter shows no quantitative summary in its top nav.

### Recommendation

Do **not** add Active/Archived sub-tabs to Hunter's Companies section — the modules serve different roles. Instead:

- **Fix the gap:** Add an "Archived" indicator or count in Hunter's stats bar (e.g., a muted "3 archived" link that navigates to Scout).
- **Consider:** An empty-state callout inside Hunter's Companies view if the user has archived companies ("You have 6 archived companies in Scout").
- **Tab counts in Hunter nav:** Optionally add badge counts to Hunter's sub-nav labels (e.g., "Companies (14)") for parity with Scout's approach.

---

## 3. Company Card Design

### Current State

| Attribute | Scout (`CompanyCardV5`) | Hunter (`CompanyCard`) |
|---|---|---|
| **Layout direction** | Vertical flex column | Vertical flex column |
| **Logo size** | 36×36px, radius 9px | 40×40px (via `CompanyLogo size={40}`) |
| **Header** | Logo + Name (13px) + Industry (10px) + contact count badge | Logo + Name + badge + Industry · Location · Size (11px muted) |
| **Metadata grid** | 2×2 grid: EMPLOYEES · FOUNDED · INDUSTRY · LOCATION (8px label + 10px value) | Inline `<span>` list: industry · location · employees |
| **Progress bar** | None | Engagement % bar (shown only when `engagedCount > 0`) |
| **Stats row** | Contact count badge (green, top-right) | ⚡ Engaged · 🎯 In Deck · 📦 Archived counts |
| **Timing row** | None | Next touchpoint or Last activity (clock icon) |
| **Action buttons** | Visit (purple tint) · LinkedIn (blue tint) · Archive/Restore icon | "View contacts" full-width button |
| **Primary CTA** | "Find Contacts →" (pink gradient) or "View Contacts →" (cyan) | "View contacts" (single action) |
| **Card border radius** | 13px | 14px |
| **Hover effect** | `borderColor` + `translateY(-1px)` via inline `onMouseEnter` | CSS `.hc-company-card:hover` with `#8b5cf6` border + `translateY(-1px)` |
| **Active state class** | None | `.hc-company-card--active` (light blue bg when engaged) |
| **Theme** | Uses `T.*` tokens (dark-mode aware) | Hardcoded light-mode colors (`#ffffff`, `#e5e7eb`) |
| **Source** | SavedCompanies.jsx line 738–814 | CompaniesSection.jsx line 46–144 |

### Key Differences

1. **Metadata presentation.** Scout uses a labeled 2×2 grid (very structured, slightly data-heavy). Hunter uses inline text (clean, minimal). The metadata density in Scout is higher and more useful for company research; Hunter's is better for at-a-glance scanning.
2. **Action surface.** Scout has 3 utility buttons (Visit, LinkedIn, Archive) plus a primary CTA. Hunter has only one action. Scout's multi-button approach risks button overload for a card-first interface.
3. **Engagement data.** Hunter's card adds engagement context (progress bar, stats row, timing) that Scout's card entirely lacks. These are module-specific and intentional.
4. **Dark-mode support.** Scout uses `T.*` tokens; Hunter's CSS has hardcoded light-mode hex colors. **Hunter will break visually in dark mode.**
5. **Active state.** Hunter highlights actively engaged companies with a light-blue background class — Scout has no equivalent visual priority signal.

### Recommendation — Adopt a hybrid card standard

```
Shared card shell:
- Border radius: 12px (unify from 13/14)
- Padding: 14px
- Hover: border accent color + translateY(-1px)
- Theme: T.* tokens everywhere (fix Hunter's hardcoded colors)
- Logo: 36×36 or 40×40 (pick one — suggest 38px)
- Header: Logo + Name + status badge

Scout card adds (discovery context):
- 2×2 metadata grid (Employees, Founded, Industry, Location)
- External link buttons (Visit, LinkedIn)
- Archive / Restore action
- "Find Contacts" or "View Contacts" CTA

Hunter card adds (engagement context):
- Engagement progress bar
- ⚡ Engaged / 🎯 Deck / 📦 Archived stats row
- Next touchpoint / Last activity timing
- Active state background highlight
- "View contacts" CTA
```

Each module keeps its module-specific data layer while sharing the card shell and theming.

---

## 4. Search & Filtering

### Current State

| Attribute | Scout | Hunter |
|---|---|---|
| **Search bar** | Always visible below tabs (except in Swipe mode) | **Absent** |
| **Search scope** | Company name or industry | N/A |
| **Filter mechanism** | Active/Archived tab toggle | Sort by engagement (hardcoded: engaged first, then by last activity) |
| **View toggle** | Cards / List / Swipe (3 modes, persisted to `localStorage`) | Cards only (no toggle) |
| **Source** | SavedCompanies.jsx line 242–255 | CompaniesSection.jsx line 219–226 |

### Key Differences

1. **Hunter has no search.** With a large company list this becomes a UX problem — users can't quickly find a specific company.
2. **Scout persists view mode** to `localStorage`; Hunter has no persistent preferences.
3. **Sort logic differs.** Scout sorts newest-first. Hunter sorts by engagement activity (most engaged float up). Hunter's sort is more operationally useful.

### Recommendation

**Add a search bar to Hunter's Companies view** with the same visual spec as Scout:

```jsx
// Shared search input spec
<div style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 12px',
              display: 'flex', alignItems: 'center', gap: 7 }}>
  <Search size={14} color={T.textFaint} />
  <input placeholder="Search companies..." />
</div>
```

Scout can adopt Hunter's engagement-aware sorting when contacts exist (companies with contacts float up, like Hunter does). Both modules benefit from consistent sort-by-activity logic.

**View mode toggle:** Hunter doesn't need Cards/List/Swipe since its workflow is linear (engage contacts, not find them). Keep Scout's 3-mode toggle as Scout-specific.

---

## 5. Action Buttons

### Current State

| Button | Scout | Hunter |
|---|---|---|
| **Visit (website)** | Yes — purple tint, Globe icon | No |
| **LinkedIn** | Yes — blue tint, Linkedin icon | No |
| **Archive** | Yes — icon-only button | No (archiving only in Scout) |
| **Restore** | Yes — RotateCcw icon (archived tab only) | No |
| **Find Contacts** | Yes — pink gradient (when 0 contacts) | No |
| **View Contacts** | Yes — cyan bg (when has contacts) | Yes — full-width, ChevronRight icon |

### Key Differences

1. **Scout's external links (Visit, LinkedIn) are absent from Hunter.** Since Hunter is the action layer, quick access to company's web presence is arguably more useful there.
2. **Archive is Scout-only.** This is by design — archiving is a discovery-phase action.
3. **"View Contacts" behavior differs.** Scout navigates to `scout/company/:id/leads` or `scout/company/:id`. Hunter navigates to `/hunter?tab=people` (generic People tab — does not filter by company). This is a functional gap — clicking "View contacts" in Hunter loses the company context.

### Recommendation

**Action set per module:**

| Action | Scout Card | Hunter Card |
|---|---|---|
| Visit website | Keep | Add (secondary, icon-only or small) |
| LinkedIn | Keep | Add (secondary, icon-only) |
| Archive | Keep | Remove (intentionally Scout-only) |
| Find / View Contacts | Keep as primary CTA | Keep as primary CTA |
| View Contacts (Hunter) | — | Fix navigation to filter People tab by `company_id` |

**Fix Hunter's "View contacts" navigation** — highest priority bug:

```js
// Current (broken context):
navigate('/hunter?tab=people');

// Proposed fix:
navigate(`/hunter?tab=people&company=${company.id}`);
// Then PeopleSection reads the query param and pre-filters by company_id
```

---

## 6. Additional Structural Differences

| Area | Scout | Hunter | Notes |
|---|---|---|---|
| **Theme system** | `T.*` tokens from `ThemeContext` — dark-mode aware | Hardcoded light hex (`#ffffff`, `#e5e7eb`, `#111827`) | Hunter will break in dark mode |
| **CSS approach** | Mix of inline styles (tokens) + `.css` file (`.kpi-summary` etc.) | External `.css` file (`.hc-*` classes) | Inconsistent — inline styles can't respond to theme |
| **Loading state** | Inline spinner with brand pink border-top trick | `.hc-loading-spinner` CSS class | Both functional; unify into a shared `<Spinner>` |
| **Empty state** | Centered icon + headline + CTA button to Daily Leads | Centered icon + headline + "Go to Scout" CTA | Both good patterns; Hunter's cross-link to Scout is excellent |
| **Max-width** | No max-width (fills container) | `max-width: 900px` | Hunter is better contained; Scout can stretch awkwardly |
| **Animation** | None | `fadeIn` on mount (0.3s) | Hunter feels smoother |
| **Grid min-width** | `minmax(258px, 1fr)` | `minmax(320px, 1fr)` | Hunter's wider cards match its richer content |
| **Data queries** | Parallel fetch (companies + contacts) — no N+1 | Parallel fetch (companies + contacts) — no N+1 | Both correct |

---

## Unified Standard Recommendations

### Priority Matrix

| Priority | Issue | Effort |
|---|---|---|
| 🔴 **P0 – Bug** | Hunter "View contacts" loses company context (navigates to unfiltered People tab) | Low |
| 🔴 **P0 – Bug** | Hunter CSS uses hardcoded light-mode colors — dark-mode breaks | Medium |
| 🟠 **P1 – UX Gap** | Hunter has no search bar for companies | Low |
| 🟠 **P1 – UX Gap** | Archived companies are invisible in Hunter (no indicator) | Low |
| 🟡 **P2 – Consistency** | Stat card shell: unify to icon + 22px value + label + flex-wrap | Medium |
| 🟡 **P2 – Consistency** | Card border-radius: standardize to 12px | Low |
| 🟡 **P2 – Consistency** | Shared `<Spinner>` and `<EmptyState>` components | Medium |
| 🟢 **P3 – Polish** | Add Visit/LinkedIn quick links to Hunter card (icon-only row) | Low |
| 🟢 **P3 – Polish** | Add tab count badges to Hunter nav ("Companies (14)") | Low |
| 🟢 **P3 – Polish** | Scout adopt Hunter's engagement-aware sort | Low |

### Decision Summary

| Topic | Decision |
|---|---|
| **Stats layout** | Standardize on Hunter's flex-wrap stat card (icon + value + label). Scout switches from 4-col grid. |
| **Stats content** | Keep module-specific — different phases, different metrics. |
| **Tabs** | Keep as-is architecturally. Fix: show archived company count/link in Hunter. |
| **Card shell** | Unified: 12px radius, 14px padding, T.* tokens, hover accent. Content layers stay module-specific. |
| **Search** | Add search to Hunter. Keep Scout's search. Shared input spec. |
| **Sort order** | Both adopt engagement-aware sorting (most active floats up). |
| **Action buttons** | Scout keeps Visit+LinkedIn+Archive+CTA. Hunter adds Visit+LinkedIn (icon-only) + fix View Contacts navigation. |
| **Theme** | Hunter migrates hardcoded colors to `T.*` tokens for dark-mode parity. |
| **View toggle** | Scout keeps Cards/List/Swipe. Hunter stays Cards-only (different workflow). |
