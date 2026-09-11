# Contact Profile — Mobile Horizontal Overflow Investigation

**Route:** `/contact/:contactId` (page mode)
**Viewport:** iPhone 12/13 — 390 x 844 CSS px, DPR 3
**Status:** Investigation complete. No code changes made.

---

## The Four Answers

### 1. Scroll Owner

**`document.documentElement`** — the HTML root element.

```
documentElement.scrollWidth  = 569px
documentElement.clientWidth  = 390px
horizontal overflow          = 179px
```

There is no nested horizontal scroll container. The entire document pans
horizontally because `.main-content` (the shell's primary content column)
is forced wider than the viewport.

### 2. Width Owner

Two rules combine to produce the overflow:

| Role | Selector | File : Line | What it does |
|------|----------|-------------|--------------|
| **Content cause** | `.profile-nav-inner` | `ContactProfile.css:222` + inline styles in `ContactProfile.jsx:741-764` | Flex row, `justify-content: space-between`, **no `flex-wrap`**, containing 4 non-wrapping buttons. Min-content width ≈ 537 px. |
| **Propagation enabler** | `.main-content` | `MainLayout.css:16` | Flex item in the row-flex `.main-layout` with the **default `min-width: auto`**. This prevents `.main-content` from shrinking below its content's min-content width, so the 537 px nav bar forces `.main-content` to 569 px (537 + padding). |

#### Why `overflow: hidden` on `.page-content-full` does not help

`.page-content-full` has `overflow: hidden` (MainLayout.css:651), which was
intended to contain overflow. It fails here because:

1. `overflow: hidden` clips **rendered** content but does **not** change an
   element's **intrinsic size**.
2. `.main-content` (the parent, a row-flex item) has the default
   `min-width: auto`, which computes to the content's min-content width.
3. Since `.main-content` itself has no `overflow` constraint, its min-content
   width = max of its children's widths = the wide nav-bar content.
4. `.main-content` expands to 569 px, and `.page-content-full` stretches to
   match (cross-axis `align-items: stretch` in the column flex).
5. At that width the content no longer overflows `.page-content-full` at all —
   both are 569 px wide. The document scrolls because `.main-content` (569 px)
   exceeds the viewport (390 px).

#### Why the mobile CSS rule for `.profile-nav` is a no-op

```css
/* ContactProfile.css:1316 */
@media (max-width: 768px) {
  .profile-nav {
    flex-direction: column;   /* ← no effect */
    gap: 1rem;
    align-items: stretch;
  }
}
```

`.profile-nav` is **not a flex container**. Its only style is `width: 100%`
(line 218). The actual flex container is `.profile-nav-inner` (line 222), which
has **no mobile override** at all.

#### Nav-bar button width breakdown at 390 px

| Button | Padding | Icon | Text | Est. width |
|--------|---------|------|------|------------|
| ← Back to People | 7 + 14 px | 13 px | ~90 px | **130 px** |
| ★ Enrich Contact | 8 + 18 px | 13 px | ~95 px | **150 px** |
| 📦 Archive | 8 + 14 px | 13 px | ~50 px | **97 px** |
| 🧠 Add context | 6 + 12 px | 14 px | ~65 px | **111 px** |

**Right-side group:** 150 + 9 (gap) + 97 + 9 + 111 = **376 px**
**Total flex content:** 130 + 376 = **506 px** (before `.profile-nav-inner` padding of 44 px → **550 px**)

Available space inside `.contact-profile-page` at 390 px with `padding: 1rem`:
390 − 32 = **358 px**. Overflow is guaranteed.

### 3. Proof (Acceptance Test)

Measured with Playwright (Chromium, 390 × 844 viewport, DPR 3, `isMobile: true`)
against a minimal reproduction using the exact CSS rules from the codebase:

| Test | Action | `scrollWidth` | `clientWidth` | Overflow? |
|------|--------|---------------|---------------|-----------|
| Baseline | Full page-mode reproduction | **569** | 390 | **179 px YES** |
| Hide `.profile-nav` | `display: none` | 390 | 390 | **0 px NO** |
| `overflow-x: hidden` on `.main-content` | Added inline | 390 | 390 | **0 px NO** |
| `min-width: 0` on `.main-content` | Added inline | 390 | 390 | **0 px NO** |
| Panel mode (no nav bar) | `.profile-nav` removed | 390 | 390 | **0 px NO** |

**Disabling the profile-nav bar eliminates the overflow entirely.**

Setting `min-width: 0` on `.main-content` also eliminates document-level scroll.
At that point, `.profile-nav-inner` still has `scrollWidth: 515` but the content
is clipped by `.page-content-full`'s `overflow: hidden` — which now works
correctly because `.main-content` is constrained to 390 px.

### 4. Scope Boundary

| Route | Mode | `scrollWidth` | Overflow? |
|-------|------|---------------|-----------|
| `/contact/:id` | Page (nav visible) | 569 | **YES — 179 px** |
| `/scout/contact/:id` | Panel (no nav) | 390 | No |
| `/scout` | Scout list | 390 | No |
| `/` | Mission Control | 390 | No |

**This is a contact-profile bug, not an app-shell bug.** Only the page-mode
route overflows, because only it renders the `.profile-nav-inner` flex row.
Panel mode suppresses the nav bar (`isPanelMode = !!onClose`), so it is clean.

---

## Component Hierarchy with Horizontal Sizing

```
document.documentElement                scrollWidth: 569  clientWidth: 390
 └─ body
   └─ .main-layout.shell-fixed-height  display: flex (row)
     ├─ .sidebar                        position: fixed; transform: translateX(-100%)  [out of flow]
     ├─ .main-content                   flex: 1; min-width: auto ← ROOT ENABLER
     │   ├─ .top-bar                    width: auto (stretches to main-content)
     │   └─ main.page-content-full      overflow: hidden; flex: 1 (column flex child)
     │       └─ .canonical-contact-page
     │           └─ .contact-profile-page    padding: 1rem at ≤768px
     │               ├─ .profile-nav         width: 100%  (NOT display:flex)
     │               │   └─ .profile-nav-inner   display: flex; no flex-wrap ← ROOT CAUSE
     │               │       ├─ Back button       ~130 px, white-space: nowrap
     │               │       └─ div (gap: 9px)    ~376 px total
     │               │           ├─ Enrich Contact    ~150 px, white-space: nowrap
     │               │           ├─ Archive           ~97 px, white-space: nowrap
     │               │           └─ BarryKnowledge    ~111 px, white-space: nowrap
     │               └─ .contact-profile-wrapper     max-width: 1400px; padding: 12px at ≤600px
     │                   └─ .contact-profile-three-col   grid-template-columns: 1fr at ≤600px ✓ safe
     ├─ .bottom-nav                     position: fixed; left: 0; right: 0
     └─ [overlays: Barry, CommandBar, MoreSheet...]
```

## Tag Row Confirmation: Symptom, Not Cause

The IdentityCard's `.idc-tags-row` uses `display: flex; flex-wrap: wrap; gap: 6px`.
Individual `.idc-chip` elements have `white-space: nowrap` but the row wraps.
At 390 px, chips wrap to two or three rows. **Tags are not the cause.**

All `min-width` values in IdentityCard.css (185 px, 200 px, 160 px, 110 px) are
on absolutely positioned elements (menus, panels) that do not participate in
layout flow.

## Bottom Navigation Analysis

BottomNav is `position: fixed; bottom: 0; left: 0; right: 0` at ≤768 px.
When the document is wider than the viewport, the fixed element's layout
viewport expands to match, so BottomNav becomes 569 px wide instead of 390 px.
This explains the differential scroll the user observed: the bottom nav tracks
the viewport, not the content. On iOS Safari, rubber-band scrolling
amplifies this — the nav "lags" the content, appearing to move ~30 pt while
content moves ~105–110 pt.

BottomNav itself does NOT cause overflow. It's a victim of the wider document.

## Regression History

| Date | Commit | Change |
|------|--------|--------|
| 2026-08-16 | `5e18bb7` | ContactProfile.jsx created with profile-nav-inner and all 4 buttons. **Bug exists from day one.** |
| 2026-08-16 | `57d05d1` | Vocabulary/naming updates. Nav bar unchanged. |
| 2026-08-25 | `442e1c9` | Gate 1: timeline, fit-score. Nav bar unchanged. |

The profile-nav-inner flex row was never given a mobile breakpoint. The
`@media (max-width: 768px)` rule targets `.profile-nav` (the non-flex wrapper)
instead of `.profile-nav-inner` (the flex container). This appears to be a
simple targeting mistake from the original implementation.

## Intended Responsive Model

The contact profile has a well-thought-out responsive grid:
- **≤1100 px:** narrower column widths
- **≤860 px:** two columns (intel + action), history below
- **≤600 px:** single column, reduced padding

The three-column grid collapses correctly. The profile nav bar is the gap —
it has no responsive adaptation at all.

## Secondary Overflow Risks

| Priority | Component | Risk |
|----------|-----------|------|
| Medium | `PersistentEngageBar .peb-primary` | Status label + CTA button with `white-space: nowrap`. At ≤640 px, stats and channels hide. Remaining items fit ~356 px — borderline at 390 px if status text is long (>20 chars). |
| Low | `RecessiveActions .recessive-actions` | Flex row, no `flex-wrap`. Three buttons (Email + LinkedIn + Call) total ~330 px + padding. Right at the 390 px limit. |

Neither of these triggers overflow in the reproduction because their content
just barely fits. The profile-nav-inner is the only confirmed overflow source.

---

## Recommended Fixes (Not Implemented)

### Fix A — Shell guard: `min-width: 0` on `.main-content` (1 line)

```css
.main-content {
  min-width: 0;   /* ← add this */
}
```

**Effect:** Allows `.main-content` to shrink to its flex-basis (0) instead of
being held at min-content width. `.page-content-full`'s `overflow: hidden` then
clips horizontal overflow correctly. All routes benefit.

**Trade-off:** Defensive — prevents any future wide content from breaking the
shell. Does not fix the nav bar's usability at mobile (buttons are clipped).

### Fix B — Content fix: responsive `.profile-nav-inner` (targeted)

At ≤768 px, target the actual flex container (not `.profile-nav`):

```css
@media (max-width: 768px) {
  .profile-nav-inner {
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
  }
}
```

**Effect:** Buttons wrap to two rows. "Back to People" takes a full row;
the three action buttons share the second row. All buttons remain tappable.

**Trade-off:** Nav bar is taller at mobile. Content starts lower.

### Fix C — Both (Recommended)

Apply Fix A at the shell level and Fix B at the component level:
- Fix A prevents any future overflow from escaping the shell
- Fix B makes the nav bar actually usable at mobile

Together they close the latent vulnerability (`min-width: auto` on
`.main-content`) and fix the immediate bug (non-wrapping nav buttons).

---

## Reproduction Harness

**Tool:** Playwright (Chromium)
**Viewport:** 390 × 844, DPR 3, `isMobile: true`
**Test file:** Standalone HTML reproduction with exact CSS rules from the codebase

Chrome DevTools equivalent: iPhone 12/13 preset (390 × 844 DPR 3). Open the
contact profile in page mode (`/contact/:contactId`). Scroll horizontally. The
bottom nav and content move at different rates confirming document-level
horizontal scroll.
