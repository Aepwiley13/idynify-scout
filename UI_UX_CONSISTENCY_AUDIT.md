# UI/UX Consistency Audit: Recon & Hunter vs. Scout (Reference Standard)

**Date:** 2026-02-12
**Reference Standard:** Scout section (All Leads, Company Search, Contact Search, Scout+, Saved Companies, Daily Leads, Total Market)
**Sections Audited:** Recon (Overview, ICP Intelligence, Messaging & Voice, Objections & Constraints, Competitive Intel, Buying Signals, Barry Training) and Hunter (Dashboard, Weapons, Missions, Arsenal, Outcomes)

---

## Scout Reference Standard Summary

The Scout section establishes the following design patterns:

| Attribute | Scout Pattern |
|---|---|
| **Background** | `#ffffff` (white) — all pages |
| **Text Primary** | `#111827` (gray-900) |
| **Text Secondary** | `#6b7280` (gray-500) |
| **Text Tertiary** | `#9ca3af` (gray-400) |
| **Border Color** | `#e5e7eb` (gray-200), `1.5px` solid |
| **Border Radius** | Cards: `12px–16px`, Buttons: `8px–10px`, Pills: `999px` |
| **Card Background** | `#ffffff` with `1.5px solid #e5e7eb` border |
| **Font Family** | `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` |
| **Page Title** | `2rem`, `700` weight, `#111827`, centered |
| **Page Subtitle** | `1rem`, `500` weight, `#6b7280` |
| **KPI Cards** | White bg, `1.5px solid #e5e7eb`, `12px` radius, icon-wrapper `48x48` blue |
| **Status Tabs** | Bottom border underline, `2px solid #e5e7eb` track, active `#3b82f6` |
| **Tab Badge** | `#f3f4f6` bg, `999px` radius, active `#dbeafe` bg / `#2563eb` text |
| **Search Input** | `1.5px solid #d1d5db`, `10px` radius, focus: `#3b82f6` border + `3px` ring |
| **Primary Button** | Blue gradient `#3b82f6` → `#2563eb`, white text, `8px` radius |
| **Loading** | Blue top-border spinner (`50px`), `#6b7280` text |
| **Empty State** | Centered, `2px dashed #d1d5db` border, `20px` radius, icon + h2 + description + CTA |
| **Modal Overlay** | `rgba(0,0,0,0.85)`, `4px` blur |
| **Modal Container** | White bg, `16px` radius, max-width `900px` |
| **Max Content Width** | `1400px` (list pages), `750–900px` (focused views) |
| **Hover Effects** | `translateY(-2px)`, border-color change to `#3b82f6`, shadow increase |
| **Focus States** | `box-shadow: 0 0 0 3px rgba(59,130,246,0.1)` |

---

## FINDINGS

### FINDING 1: Hunter uses a completely different dark theme

| | |
|---|---|
| **Screen/Section** | Hunter — All screens (Dashboard, Weapons, Missions, Arsenal, Outcomes) |
| **Description** | Hunter uses a full dark theme (`#0f172a` / `#1e293b` gradient background) with white text, semi-transparent borders (`rgba(71,85,105,0.3)`), and purple accent colors (`#8b5cf6`). Scout uses a white background with dark text and blue accents (`#3b82f6`). This is the single largest inconsistency in the application — every element in Hunter diverges from Scout's established patterns. |
| **Component Reference** | `HunterWeaponRoom.css:5` — `.hunter-weapon-room { background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); }` |
| **Severity** | **HIGH** |
| **Recommended Fix** | **Escalate for design decision.** Either: (A) Convert Hunter to Scout's light theme with the pink/magenta pillar accent color instead of dark mode, or (B) Formally define a dark-mode variant of Scout's design system that Hunter uses intentionally (with matching border widths, radius, spacing tokens). Currently Hunter's dark theme appears ad-hoc rather than systematic. |

---

### FINDING 2: Hunter text colors inverted from Scout

| | |
|---|---|
| **Screen/Section** | Hunter — All screens |
| **Description** | Hunter uses `white` / `#f1f5f9` for primary text and `#94a3b8` for secondary text (light-on-dark). Scout uses `#111827` for primary and `#6b7280` for secondary (dark-on-light). This creates a jarring visual shift when navigating between pillars. |
| **Component Reference** | `HunterWeaponRoom.css:48` — `.hunter-title { color: white; }` vs. Scout's `AllLeads.css:23` — `.page-title { color: #111827; }` |
| **Severity** | **HIGH** |
| **Recommended Fix** | Align with Finding 1 resolution. If Hunter stays dark, define a formal dark-mode text hierarchy. If converting to light, use Scout's `#111827` / `#6b7280` / `#9ca3af` text scale. |

---

### FINDING 3: Hunter border colors and widths differ

| | |
|---|---|
| **Screen/Section** | Hunter — Cards, tabs, containers |
| **Description** | Hunter uses `1px solid rgba(71,85,105,0.3–0.5)` borders. Scout uses `1.5px solid #e5e7eb`. Hunter also uses `2px` borders on mission cards (`MissionsSection.css:4`). Scout standardizes on `1.5px` for cards and `2px` only for lead-card selection states. |
| **Component Reference** | `DashboardSection.css` (1px rgba borders throughout), `MissionsSection.css` (2px borders on cards) vs `AllLeads.css:588` (1.5px standard) |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Standardize on Scout's `1.5px solid #e5e7eb` border pattern (or dark-mode equivalent). Use `2px` only for selected/active states. |

---

### FINDING 4: Hunter loading spinner differs from Scout

| | |
|---|---|
| **Screen/Section** | Hunter — Loading state |
| **Description** | Hunter spinner is `40px` with `3px` border and purple color (`#8b5cf6`). Scout spinner is `50px` with `4px` border and blue color (`#3b82f6`). Hunter has no loading text; Scout shows "Loading your pipeline..." below the spinner. |
| **Component Reference** | `HunterWeaponRoom.css:244` vs `AllLeads.css:1084` |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Align spinner to Scout pattern: `50px` size, `4px` border, pillar accent color. Add loading text below spinner matching Scout's `.loading-text` pattern. |

---

### FINDING 5: Hunter empty states use different styling

| | |
|---|---|
| **Screen/Section** | Hunter — Empty states across sections |
| **Description** | Hunter empty states use dark semi-transparent backgrounds (`rgba(30,41,59,0.3)`), `rgba(71,85,105,0.5)` dashed borders, white text, and a circular icon container (`80px` circle). Scout empty states use white backgrounds, `2px dashed #d1d5db` borders, `20px` radius, `#111827` heading, `#6b7280` description text. |
| **Component Reference** | `HunterWeaponRoom.css:163` (`.hunter-empty-state`) vs `AllLeads.css:1104` (`.empty-state`) |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Match Scout's empty state pattern: white bg, `2px dashed #d1d5db`, centered icon (not in a circle container), h2 heading, description, and CTA button using pillar gradient. |

---

### FINDING 6: Hunter tab navigation pattern differs from Scout

| | |
|---|---|
| **Screen/Section** | Hunter — Tab bar |
| **Description** | Hunter tabs use `3px` bottom border, dark background with purple hover tint (`rgba(139,92,246,0.1)`), and icons before label text. The active tab has a purple bottom-border (`#8b5cf6`) and a tinted background. Scout's All Leads uses a `2px` bottom border underline pattern with no background tint, blue active color (`#3b82f6`), and no icons in tabs. Additionally, Hunter tabs include a badge count component; Scout uses the same pattern but with different styling tokens. |
| **Component Reference** | `HunterWeaponRoom.css:88` (`.hunter-tab`) vs `AllLeads.css:137` (`.status-tab`) |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Align tab pattern: `2px` bottom border, no background tint on hover/active, use pillar accent color for active state. Tab badges should use Scout's `.tab-count` token pattern (`#f3f4f6` bg inactive, pillar-colored bg active). Icons in tabs are acceptable if intentional but should be optional. |

---

### FINDING 7: Hunter page header has a back button; Scout does not

| | |
|---|---|
| **Screen/Section** | Hunter — Header |
| **Description** | Hunter's header includes a left-arrow back button navigating to Mission Control, a large icon container (`56px` with gradient), and an inline sticky header with backdrop blur. Scout's pages have no sticky header or back button — navigation is handled entirely by the sidebar. |
| **Component Reference** | `HunterWeaponRoom.jsx:130–143` (back button + icon + sticky header) vs `ScoutMain.jsx:50–64` (no header at all) |
| **Severity** | **LOW** |
| **Recommended Fix** | Remove the back button from Hunter (sidebar handles navigation). Consider aligning the header pattern — Scout uses a simple centered `.enterprise-header` with `h1` + subtitle, not a sticky bar with actions. If Hunter needs a sticky header for Gmail status, it should match Scout's header structure. |

---

### FINDING 8: Recon Overview uses Tailwind utility classes; Scout uses CSS modules

| | |
|---|---|
| **Screen/Section** | Recon — Overview, Module Pages, Barry Training |
| **Description** | ReconOverview.jsx, ReconModulePage.jsx, and BarryTraining.jsx are styled almost entirely with Tailwind utility classes (`className="max-w-7xl mx-auto"`, `"bg-white rounded-xl border-[1.5px] border-gray-200 p-5"`). Scout pages use dedicated CSS files with named classes (`className="all-leads"`, `className="kpi-summary"`). This creates a maintenance inconsistency — Scout styles are centralized in CSS modules while Recon styles are scattered inline across JSX. |
| **Component Reference** | `ReconOverview.jsx:301` (`<div className="max-w-7xl mx-auto">`) vs `AllLeads.jsx:438` (`<div className="all-leads">`) |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Migrate Recon pages to use CSS module files (like `ReconOverview.css`) with named classes matching Scout's pattern. This ensures consistency, easier auditing, and a single source of truth for design tokens. The existing `ReconEnterprise.css` file already defines some Recon-specific classes but isn't used by the overview pages. |

---

### FINDING 9: Recon loading state differs from Scout

| | |
|---|---|
| **Screen/Section** | Recon — Overview, Module Pages |
| **Description** | Recon's loading state uses a Tailwind inline approach: `<div className="text-purple-600 text-lg font-semibold animate-pulse">Loading RECON...</div>`. Scout uses a structured loading component with a CSS spinner (`50px` circle border animation) and a loading text paragraph. Recon has no spinner, just pulsing text. |
| **Component Reference** | `ReconOverview.jsx:288` vs `AllLeads.jsx:408–415` + `AllLeads.css:1074–1101` |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Use Scout's loading pattern: `<div className="loading-spinner" />` + `<p className="loading-text">Loading RECON...</p>`. Extract the loading component into a shared component. |

---

### FINDING 10: Recon page header structure differs from Scout

| | |
|---|---|
| **Screen/Section** | Recon — Overview |
| **Description** | Recon's header uses a left-aligned layout with an icon box (`40x40`, purple background), title, and subtitle side by side. Scout's header uses a centered layout with just `h1` title + subtitle text, no icon box. Recon title is `text-2xl` (1.5rem equiv); Scout title is `2rem`. |
| **Component Reference** | `ReconOverview.jsx:306–320` vs `AllLeads.jsx:440–445` + `AllLeads.css:15–34` |
| **Severity** | **LOW** |
| **Recommended Fix** | Align to Scout's centered header pattern: `<div className="enterprise-header"><h1 className="page-title">RECON</h1><p className="page-subtitle">...</p></div>`. Drop the icon box from the header (the sidebar already indicates which pillar is active). |

---

### FINDING 11: Recon has breadcrumbs; Scout and Hunter do not

| | |
|---|---|
| **Screen/Section** | Recon — All pages |
| **Description** | Recon uses a `ReconBreadcrumbs` component showing "Mission Control > RECON > [Module] > [Section]". Neither Scout nor Hunter has breadcrumbs. While breadcrumbs are useful for Recon's deeper navigation hierarchy, the implementation creates an inconsistency with the other two pillars. |
| **Component Reference** | `ReconBreadcrumbs.jsx:1–145`, used in `ReconOverview.jsx:303`, `ReconModulePage.jsx:256`, `BarryTraining.jsx` |
| **Severity** | **LOW** |
| **Recommended Fix** | **Escalate for design decision.** Options: (A) Add breadcrumbs to Hunter pages that have depth (Mission Detail, Campaign Detail), or (B) Remove breadcrumbs from Recon and rely on the sidebar + back button pattern, or (C) Keep breadcrumbs as a Recon-specific pattern since it has deeper navigation depth than Scout/Hunter. If keeping, ensure breadcrumb styling matches Scout tokens (font sizes, colors). |

---

### FINDING 12: Recon KPI/Stats cards differ from Scout

| | |
|---|---|
| **Screen/Section** | Recon — Overview (Training Status bar) |
| **Description** | Recon's "Training Status" bar uses a white card with inline stats (Overall %, Barry Confidence, Sections completed) displayed in a horizontal flex layout with a gradient progress bar. Scout's KPI cards use a grid layout with individual cards per metric, each having an icon wrapper (48x48), label, value, and optional progress bar. The visual hierarchy and structure differ significantly. |
| **Component Reference** | `ReconOverview.jsx:323–355` (inline stat bar) vs `AllLeads.jsx:448–514` + `AllLeads.css:37–126` (KPI grid) |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Restructure Recon's training status into individual KPI cards matching Scout's `.kpi-card` pattern: icon wrapper, label, value, optional progress bar. Use purple pillar color instead of blue for the icon wrapper. |

---

### FINDING 13: Recon module cards use different card pattern than Scout

| | |
|---|---|
| **Screen/Section** | Recon — Overview (Training Modules grid) |
| **Description** | Recon module cards use a compact design with a `36x36` icon box (top-left), status badge (top-right), title, description, progress bar, impact area tags, and a hover-reveal CTA. Scout's equivalent cards (Company Cards, Lead Cards) use a larger photo-hero area, gradient overlay, and bottom action bar. While the content differs, the card container patterns diverge: Recon uses `border-[1.5px]` (Tailwind arbitrary) while Scout uses CSS-defined `1.5px solid #e5e7eb`. |
| **Component Reference** | `ReconOverview.jsx:494–561` vs `AllLeads.css:582–601` |
| **Severity** | **LOW** |
| **Recommended Fix** | The card content is appropriately different (Recon shows module status, not contact photos). Ensure card container tokens match: `border: 1.5px solid #e5e7eb`, `border-radius: 12px`, `background: #ffffff`, `hover: border-color + shadow`. Move from Tailwind inline to CSS class for consistency. |

---

### FINDING 14: Recon SectionOutputModal uses mixed dark/light theme

| | |
|---|---|
| **Screen/Section** | Recon — Section Output Modal |
| **Description** | The SectionOutputModal uses a white/translucent overlay (`bg-white/80 backdrop-blur-sm`) with a dark content area (`bg-gradient-to-br from-gray-900 to-black`). Scout modals use a dark overlay (`rgba(0,0,0,0.85)`) with a white content area. The Recon modal inverts this pattern entirely. Its tabs use blue active color with emoji icons; Scout modals don't use emoji-prefixed tab labels. |
| **Component Reference** | `SectionOutputModal.jsx:16–17` (`bg-white/80` overlay + `from-gray-900 to-black` content) vs `CompanyDetailModal.css:2` (`rgba(0,0,0,0.85)` overlay + white modal) |
| **Severity** | **HIGH** |
| **Recommended Fix** | Align to Scout's modal pattern: dark overlay (`rgba(0,0,0,0.85)` + backdrop blur), white modal content, `16px` border-radius, max-width `900px`. Replace emoji-prefixed tab labels with plain text or Lucide icons. |

---

### FINDING 15: Recon section editor uses CSS classes; form elements match well

| | |
|---|---|
| **Screen/Section** | Recon — Section Editor (ReconSectionEditor + Section components) |
| **Description** | The Recon section editor pages use `ReconEnterprise.css` with well-defined classes (`.recon-form-input`, `.recon-card`, etc.). These patterns largely align with Scout's design tokens: white backgrounds, `1.5px` borders, `8px` border radius for inputs, blue focus rings. The sticky header pattern in `ReconEnterprise.css` (`.recon-header`) is unique to Recon and not used in Scout. |
| **Component Reference** | `ReconEnterprise.css:1–495` |
| **Severity** | **LOW** |
| **Recommended Fix** | Form elements are well-aligned. Remove the `.recon-header` sticky bar and use Scout's page header pattern instead. Consider extracting shared form tokens into a global CSS file to ensure future consistency. |

---

### FINDING 16: Hunter primary button uses pink-purple gradient; Scout uses blue

| | |
|---|---|
| **Screen/Section** | Hunter — All screens |
| **Description** | Hunter's primary CTA button (`.btn-primary-hunter`) uses `linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)` (pink to purple). Scout's primary buttons use `linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)` (blue). While pillar-colored CTAs make thematic sense, the button structure also differs: Hunter uses `10px` radius; Scout uses `8px–10px` depending on context. |
| **Component Reference** | `HunterWeaponRoom.css:201` vs `AllLeads.css:300` |
| **Severity** | **LOW** |
| **Recommended Fix** | Pillar-colored primary buttons are acceptable for brand differentiation (Hunter = pink, Scout = blue, Recon = purple). Ensure structural tokens match: same padding (`0.875rem 1.5rem`), border-radius (`10px`), font-weight (`700`), shadow pattern, and hover behavior. Currently aligned. |

---

### FINDING 17: Hunter Dashboard stat cards use opacity-based backgrounds

| | |
|---|---|
| **Screen/Section** | Hunter — Dashboard |
| **Description** | Dashboard stats use `rgba(30,41,59,0.6)` backgrounds with `rgba(71,85,105,0.3)` borders. Stat values are `1.75rem` / `700` weight in `#f1f5f9`. Scout KPI values are `1.875rem` / `700` weight in `#111827`. The font size difference is minor but the approach (opacity layers vs solid colors) creates a fundamentally different visual system. |
| **Component Reference** | `DashboardSection.css` vs `AllLeads.css:44–104` |
| **Severity** | **MEDIUM** |
| **Recommended Fix** | Dependent on Finding 1 resolution. If Hunter converts to light theme, use Scout's `.kpi-card` pattern directly. If staying dark, define equivalent dark-mode tokens that map 1:1 to Scout's light tokens. |

---

### FINDING 18: Hunter Weapons section uses decorative gradient overlays

| | |
|---|---|
| **Screen/Section** | Hunter — Weapons |
| **Description** | Weapon cards have `::before` pseudo-elements with animated gradient overlays (pink to purple, 0 → 1 opacity on hover). No Scout component uses pseudo-element decorations. The hover transform is `translateY(-4px)` vs Scout's standard `translateY(-2px)`. |
| **Component Reference** | `WeaponsSection.css` (`.weapon-card::before`) |
| **Severity** | **LOW** |
| **Recommended Fix** | Standardize hover transform to `translateY(-2px)` matching Scout. The gradient overlay is a stylistic choice that should be evaluated — if keeping Hunter dark, it's acceptable. If converting to light, remove the pseudo-element overlay. |

---

### FINDING 19: Recon Confidence Heatmap has no Scout equivalent

| | |
|---|---|
| **Screen/Section** | Recon — Overview (Barry's Knowledge Map) |
| **Description** | The confidence heatmap is a 7-column grid of color-coded dimension tiles (trained=green, partial=amber, untrained=gray) with hover tooltips. This is a unique data visualization with no Scout equivalent. It uses Tailwind classes for all styling. |
| **Component Reference** | `ReconOverview.jsx:378–417` |
| **Severity** | **LOW** |
| **Recommended Fix** | This is unique to Recon and appropriate for the context. Ensure the tile containers match Scout card tokens (border-radius, border-width). Move styling to a CSS module for consistency with the codebase pattern. |

---

### FINDING 20: Hunter Outcomes section badge colors don't match Scout badge patterns

| | |
|---|---|
| **Screen/Section** | Hunter — Outcomes |
| **Description** | Outcomes uses intent badges (cold=blue, warm=orange, hot=red, followup=purple) with `rgba` transparent backgrounds on dark theme. Scout status badges (verified=green, likely=yellow, unverified=red) use solid light backgrounds on white. The badge structure is similar but the color application is incompatible. |
| **Component Reference** | `OutcomesSection.css` (intent badges) vs `AllLeads.css:899–923` (email status pills) |
| **Severity** | **LOW** |
| **Recommended Fix** | Dependent on Finding 1. If Hunter converts to light, use Scout's solid-background pill pattern. Standardize badge structure: `display: inline-flex`, `padding: 0.125rem 0.5rem`, `border-radius: 999px`, `font-size: 0.625rem–0.75rem`, `font-weight: 700`, `text-transform: uppercase`. |

---

### FINDING 21: Recon "Train Next" recommendation card has no Scout equivalent

| | |
|---|---|
| **Screen/Section** | Recon — Overview (right panel) |
| **Description** | The "Train Next" card uses a purple gradient background (`from-purple-50 to-violet-50`) with a nested white card, tags, and a full-width CTA button. While this specific component doesn't exist in Scout, the card structure should still match Scout tokens. The CTA button uses `bg-purple-600` (Tailwind class), not a CSS gradient like Scout's buttons. |
| **Component Reference** | `ReconOverview.jsx:434–476` |
| **Severity** | **LOW** |
| **Recommended Fix** | Align CTA button to use gradient pattern matching Scout: `background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)` instead of flat Tailwind class. Ensure card border, radius, and shadow match Scout's `.kpi-card` pattern. |

---

### FINDING 22: Max content width varies across sections

| | |
|---|---|
| **Screen/Section** | All sections |
| **Description** | Scout list pages use `max-width: 1400px`. Recon Overview uses `max-w-7xl` (Tailwind = `80rem` = `1280px`). Recon Module pages use `max-w-4xl` (Tailwind = `56rem` = `896px`). Recon section editor uses `max-width: 900px` (CSS). Hunter uses `max-width: 1400px`. No standardized content width. |
| **Component Reference** | `AllLeads.css:8` (`1400px`), `ReconOverview.jsx:301` (`max-w-7xl`), `ReconModulePage.jsx:254` (`max-w-4xl`), `ReconEnterprise.css:133` (`900px`) |
| **Severity** | **LOW** |
| **Recommended Fix** | Define standard widths: full-width list views = `1400px`, focused form/editor views = `900px`, overview/dashboard views = `1280px`. Apply consistently via shared CSS classes. |

---

### FINDING 23: Font family not explicitly set in Recon (Tailwind pages)

| | |
|---|---|
| **Screen/Section** | Recon — Overview, Module Pages, Barry Training |
| **Description** | Scout CSS explicitly sets `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` on key elements. Recon's Tailwind-only pages rely on whatever the Tailwind `font-sans` default is configured to. This could lead to subtle font rendering differences if Tailwind's configuration doesn't match. |
| **Component Reference** | `AllLeads.css:26` (explicit font-family) vs `ReconOverview.jsx` (no font-family) |
| **Severity** | **LOW** |
| **Recommended Fix** | Verify `tailwind.config.js` sets `fontFamily.sans` to match Scout's explicit font stack. If not, add it. |

---

## Summary by Severity

### HIGH (3 findings)
| # | Finding | Section |
|---|---|---|
| 1 | Hunter dark theme vs Scout light theme | Hunter — All |
| 2 | Hunter inverted text color hierarchy | Hunter — All |
| 14 | Recon SectionOutputModal inverted overlay/content theme | Recon — Modal |

### MEDIUM (8 findings)
| # | Finding | Section |
|---|---|---|
| 3 | Hunter border colors and widths differ | Hunter — All |
| 4 | Hunter loading spinner differs | Hunter — Loading |
| 5 | Hunter empty states differ | Hunter — Empty states |
| 6 | Hunter tab navigation pattern differs | Hunter — Tabs |
| 8 | Recon uses Tailwind inline; Scout uses CSS modules | Recon — All pages |
| 9 | Recon loading state differs (no spinner) | Recon — Loading |
| 12 | Recon KPI/Stats cards differ | Recon — Overview |
| 17 | Hunter Dashboard stat cards use opacity backgrounds | Hunter — Dashboard |

### LOW (12 findings)
| # | Finding | Section |
|---|---|---|
| 7 | Hunter has back button; Scout does not | Hunter — Header |
| 10 | Recon header structure differs (left-aligned w/ icon) | Recon — Overview |
| 11 | Recon has breadcrumbs; others do not | Recon — All |
| 13 | Recon module cards use different card pattern | Recon — Overview |
| 15 | Recon section editor form elements align well | Recon — Editor |
| 16 | Hunter primary button uses pillar gradient (acceptable) | Hunter — Buttons |
| 18 | Hunter uses decorative gradient overlays | Hunter — Weapons |
| 19 | Recon heatmap is unique (acceptable) | Recon — Overview |
| 20 | Hunter badge colors don't match Scout pattern | Hunter — Outcomes |
| 21 | Recon "Train Next" card CTA differs | Recon — Overview |
| 22 | Max content width varies | All sections |
| 23 | Font family not explicit in Recon Tailwind pages | Recon — All |

---

## Recommended Priority Actions

### Phase 1 — Critical (Resolve first)
1. **Design decision on Hunter theme** (Findings 1, 2, 3, 4, 5, 6, 17): Decide whether Hunter converts to a light theme matching Scout or gets a formally defined dark-mode variant. This single decision affects 7 findings.
2. **Fix Recon SectionOutputModal** (Finding 14): Flip overlay/content to match Scout's dark-overlay + white-content pattern.

### Phase 2 — Structural Alignment
3. **Migrate Recon pages to CSS modules** (Finding 8): Move from Tailwind inline to CSS files matching Scout's pattern.
4. **Standardize loading states** (Findings 4, 9): Extract shared loading component used by all three pillars.
5. **Align Recon KPI cards** (Finding 12): Restructure to match Scout's `.kpi-card` grid pattern.
6. **Standardize empty states** (Finding 5): Extract shared empty-state component.

### Phase 3 — Polish
7. **Align tab patterns** (Finding 6): Standardize bottom-border underline tabs across all pillars.
8. **Standardize max content widths** (Finding 22): Define and apply consistent width tokens.
9. **Decide on breadcrumbs** (Finding 11): Add to Hunter depth pages or remove from Recon.
10. **Align page headers** (Findings 7, 10): Remove back buttons, standardize centered header pattern.
