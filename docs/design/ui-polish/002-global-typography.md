# Desktop UI Polish #002 — Global Typography & Visual Hierarchy

**Phase 1 — read-only audit. Nothing implemented.** Measured against `origin/main`
at `424fa462`. Every number below is counted from the tree, not estimated.

---

## The headline

**There is no centralized typography system.** There is the *shell* of one — a
`TYPE` token in `src/theme/tokens.js` declaring a font family and five weights —
and it is imported by **zero files**. Meanwhile the colour tokens from the same
file are imported 138 times.

That asymmetry is the whole story, and it tells us which mechanism to use:

| Token group | Mechanism | Adoption |
|---|---|---|
| `BRAND`, `STATUS`, `THEMES`, `ASSETS` … | JS export + 37 CSS custom properties | **138 imports, used everywhere** |
| `TYPE` | JS export only, no CSS variable | **0 imports** |

There are **zero typographic CSS custom properties**. All 37 `:root` variables
are colour and surface. Type never got the one delivery mechanism this codebase
has proven it will actually adopt.

**The second headline: we already have Inter.** The question "should we
introduce Inter?" is moot — Inter has been loaded and set on `body` all along.
The problem is that **37 rules across 13 files silently override it back to the
system font stack.** We are paying for a webfont and then throwing it away on
some of the busiest screens in the product.

---

## 1. Current inventory

### Font loading

`index.html` loads **Inter (300–800) and Orbitron (400–900)** from the Google
Fonts CDN — 12 weights, one render-blocking stylesheet, `display=swap`,
`preconnect` present. Not self-hosted; no `@fontsource` package.

What is actually used:

- **Inter 300** — loaded, never used.
- **Inter 650** — used twice, **not loaded**. The browser snaps or synthesizes it.
- **Orbitron** — 6 weights loaded for **6 usages across 2 components**
  (`WithTheForce`, `UserSettings`) plus a `.font-orbitron` utility. None of
  those usages names a weight. Roughly five of the six are dead payload.

`html, body` sets `'Inter', -apple-system, …`. Note this does **not** reach form
controls, which is why 70 rules say `font-family: inherit` — those are correct
and should stay.

### Size scale

| | CSS | Inline JSX | Total |
|---|---|---|---|
| Declarations | 2,284 | 1,918 | **~4,200** |
| Files | — | 113 | **232** |
| Distinct raw values | 66 | — | — |
| **Distinct rendered sizes** | | | **52** |

52 distinct rendered sizes from **7px to 72px**. The same size is routinely
expressed two ways — `0.875rem` appears 282 times and `14px` 101 times, and
they render identically. Fractional sizes (12.8, 13.6, 11.2, 12.48, 11.52,
10.88, 13.12px) come from rem values like `0.8rem` and `0.78rem`.

Sizes below the readable floor: **151 declarations at 9px, 24 at 8px, 8 at 7px.**

### Weights and line heights

| Weight | Uses | | Line height | Uses |
|---|---|---|---|---|
| 600 | 991 | | 1.5 | 124 |
| 700 | 881 | | 1.4 | 80 |
| 500 | 273 | | 1.6 | 75 |
| 800 | 58 | | **1** | **64** |
| 400 | **33** | | 1.2 | 30 |
| 650 | 2 | | *…14 more* | |

**Regular weight is used 33 times in the entire application.** 1,872 of 2,238
weight declarations are 600 or 700. When nearly everything is semibold or
bolder, weight has stopped carrying hierarchy — which is precisely the
"enterprise feel" gap. 19 distinct line-height values, including `1` sixty-four
times (clips descenders).

### No shared primitive layer

`src/components/shared/` holds four files, none of them a primitive. There is no
`ui/` or `common/` directory. So every surface reinvents the same objects:

| Pattern | Separate CSS files defining it |
|---|---|
| badge | **55** |
| `.btn` | 21 |
| section-title | 16 |
| empty-state | 11 |
| page-title | 9 |

### Headings

**Zero bare `h1`–`h4` rules exist.** There are 85 `<h1>`, 181 `<h2>` and 260
`<h3>` in JSX, plus ~90 divs styled as headings inline. 92 CSS rules do target
headings — but all are *scoped descendants* (`.modal-header h2`).

**Tailwind preflight is enabled**, so headings are already reset to
`font-size: inherit; font-weight: inherit; margin: 0`. An unstyled `<h2>`
therefore renders today at body size and body weight — it is not a heading at
all, visually. That is why so many are styled inline.

This cuts both ways, and it matters for sequencing: a new global `h1–h4`
baseline is **safe to add** (every one of those 92 scoped rules outranks it on
specificity, so nothing visually changes), but it **will not fix them either**.
They need individual migration.

### Per-surface

| Surface | State |
|---|---|
| **Sidebar (L1 nav)** | Mixes rem and px in one file (`1.375rem`, `0.6875rem`, then `7px`, `18px`). Uses `font-weight: 650`, which is not loaded. |
| **ModuleSubNav (L2 nav)** | **9px labels in four places**, 12px items. |
| **BottomNav (mobile)** | 10px labels. |
| **Barry** | Fragmented across 8+ CSS files with half-pixel sizes (11.5, 12.5, 13.5px). One file uses rem, the rest px. **Barry has no consistent typographic voice** — his structured turns, coaching responses, reply cards and session history are each styled independently. |
| **Contact Hub** | **The cleanest surface in the codebase.** 24 CSS declarations, **zero inline `fontSize`**, no font-family override. Newest code, already doing the right thing. |
| **Scout** | The worst — but see the correction below: `AllLeads.css` and `DailyLeads.css` are **never imported**, so their 115 declarations are dead. Scout's live type is `DailyLeads.jsx`'s 202 inline styles. |
| **All seven themes** | Carry **colour only**. No theme varies type, so a single scale serves all of them with no per-theme work. *(Correction to the brief's "five": `tokens.js` and `index.css` agree on **seven** — workspace, mission, navy, sand, plus the darkSide / lightSide / theForce easter-egg themes behind `WithTheForce`.)* |

### Mobile

- **74 CSS files change `font-size` inside a media query.** Any global scale
  change has 74 mobile override sites that must be honoured.
- **113 form-control rules set font-size below 16px.** iOS zooms the viewport
  on focus for every one of them. Only one explicit 16px input rule exists.
  This is a live mobile defect with a typographic cause.

---

## Correction — found during Phase 2A, and it moves the priorities

The inventory above counts declarations as they appear in the tree. Two of the
files it names loudest never reach the browser.

**Five CSS files are never imported by any module** — no `import './x.css'`, no
glob, no bundler magic. Between them they carry **137 font-size declarations
that render nothing**:

| File | Dead font-size declarations |
|---|---|
| `src/pages/Scout/DailyLeads.css` | 66 |
| `src/pages/Scout/AllLeads.css` | 49 |
| `src/pages/Hunter/sections/CompaniesSection.css` | 14 |
| `src/components/contacts/ActivityHistory.css` | 8 |

`DailyLeads.css` defines 93 classes; its own component references **two**. The
"Daily Discoveries" title it styles as `.discovery-title` does not exist in the
DOM — the real title is an inline-styled `<h2>` on line 3296 of the JSX.

Three consequences:

1. **Of the 37 font-family overrides, 25 are live and 12 are not.** The 12 in
   `AllLeads.css` and `DailyLeads.css` were still removed, but as tidy-up, not
   as a visual fix. The real visual win is in `TotalMarket.css` (7),
   `ICPSettings.css` (6), Recon (4 files) and Hunter (2).
2. **Phase 2A changes nothing on the Daily Discoveries screen.** Its CSS is not
   loaded, its one `<h2>` is inline-styled so the heading defaults cannot reach
   it, and its other 202 sizes are inline — excluded from scope by decision. A
   before/after of that screen would show two identical images.
3. **The live corpus is smaller than the audit implied** — 2,154 CSS
   declarations rather than 2,284. The inline-style total is unchanged and is
   now, unambiguously, the larger half of the problem.

None of this changes the recommended scale or the font decision. It changes
*where* the remaining work pays, which is the point of finding it before Phase
2B rather than after.

---

## 2. Inconsistencies and root causes

| # | Inconsistency | Root cause |
|---|---|---|
| 1 | 52 rendered sizes | No scale was ever expressed in the mechanism the team uses. `TYPE` existed but, as a JS object with no CSS variable, had no pull — CSS authors would have had to leave CSS to use it. |
| 2 | Inter overridden in 37 places | Copy-paste of a system font stack that predates the Inter decision. Nothing fails when you do it, and no lint rule objects. |
| 3 | rem and px for the same size | No stated unit convention. Both read as correct. |
| 4 | Hierarchy carried by weight, not size | With no scale available, authors reached for the one axis that needs no system — bold. 991 × 600 and 881 × 700 against 33 × 400. |
| 5 | 1,918 inline `fontSize` | No primitive components. A one-off `<div style={{fontSize:12}}>` is the path of least resistance, and it cannot be themed, overridden, or found by a CSS search. |
| 6 | badge reinvented 55× | Same cause as 5, at component scale. |
| 7 | 9px/8px/7px text | Dense-table pressure with no defined floor. |
| 8 | 113 inputs under 16px | Desktop-first sizing; the iOS zoom rule is not widely known and nothing tests it. |

The single structural cause behind 1, 4, 5 and 6: **the absence of a type scale
in CSS variables, combined with the absence of shared primitives.** Fix those two
and the rest become mechanical.

---

## 3. Recommended scale

Nine steps replacing 52, delivered as CSS custom properties on `:root`
alongside the existing 37 colour variables — the mechanism this codebase has
already proven it adopts. Mirrored in `TYPE` for the JSX that needs it.

```css
:root {
  /* Size — rem throughout; px is the thing we are removing */
  --text-2xs:  0.6875rem;  /* 11px — badges, micro-labels, table meta */
  --text-xs:   0.75rem;    /* 12px — supporting labels, timestamps   */
  --text-sm:   0.8125rem;  /* 13px — dense UI, secondary body        */
  --text-base: 0.875rem;   /* 14px — DEFAULT body                    */
  --text-md:   1rem;       /* 16px — emphasised body, ALL inputs     */
  --text-lg:   1.125rem;   /* 18px — card titles                     */
  --text-xl:   1.25rem;    /* 20px — section headings                */
  --text-2xl:  1.5rem;     /* 24px — page headings                   */
  --text-3xl:  2rem;       /* 32px — display / hero                  */

  /* Weight — four roles, down from six-plus */
  --weight-regular:  400;  /* body — should become the common case   */
  --weight-medium:   500;  /* secondary emphasis, nav items          */
  --weight-semibold: 600;  /* headings, card titles                  */
  --weight-bold:     700;  /* page titles, strong emphasis           */

  /* Line height — four, down from 19 */
  --leading-tight:   1.2;   /* display and page headings             */
  --leading-snug:    1.35;  /* card/section headings, nav            */
  --leading-normal:  1.5;   /* body — the default                    */
  --leading-relaxed: 1.65;  /* long-form: Barry, help text           */
}
```

Rules that come with it:

- **11px is the floor.** The 183 declarations at 9px and below move up. This
  will cost horizontal space in dense tables — see Risks.
- **16px minimum on every form control**, which also closes the iOS zoom defect.
- **`line-height: 1` is banned** except on single-glyph icon alignment.
- **Weight 800 survives only as a brand exception** (the wordmark text
  fallback). 650 and 300 are retired.
- **rem only.** px in a `font-size` becomes the lint signal that a file has not
  been migrated.

The scale is deliberately dense at the small end, because this product is dense
at the small end — 12px, 13px and 14px account for 1,955 of the current
declarations. This is a tidy-up of what the product already does, not a redesign.

---

## 4. Font recommendation — keep Inter, and start using it

**Recommendation: keep Inter. Introduce nothing.**

The audit changes the question. Inter is not a candidate — it is already the
body font and has been all along. Introducing a new family would mean a second
migration on top of the one actually needed, which is to *stop overriding the
font we have*.

What to do instead, in order:

1. **Delete the 37 system-stack overrides** (13 files). This alone makes Scout
   and Recon look like the rest of the product. Highest visual return in the
   initiative, and it is deletion, not authoring.
2. **Trim the weight list** to `400;500;600;700`. Drops Inter 300 and 800 from
   the request. Removes the unloaded 650.
3. **Cut Orbitron to the weights actually used** — probably one. It is six
   today for six usages.
4. **Consider self-hosting** (optional, separable): removes a third-party
   render-blocking round-trip and a CDN dependency on the critical path.

Personality is not at risk here. IDYNIFY's character lives in the wordmark, the
magenta/cyan palette, Barry, and the Orbitron accent — not in the body font.
Inter is the quiet, neutral substrate that lets those carry the identity, which
is exactly what "enterprise-grade" asks for.

---

## 5. Prioritized shared components

Ordered by leverage ÷ risk. Everything above the line is shared-surface work;
the page-by-page tail is last on purpose.

| # | Target | Why first | Risk |
|---|---|---|---|
| 1 | `src/index.css` `:root` — add the scale | Nothing consumes it yet, so it cannot break anything. Unblocks all later steps. | **None** |
| 2 | Global `h1`–`h4` baseline | 0 bare rules exist; the 92 scoped ones outrank it. Pure addition. | **None** |
| 3 | Form controls → 16px | Fixes the iOS zoom defect. 113 rules, mechanical. | Low |
| 4 | `Sidebar.css` (L1 nav) | Shared by every authenticated route. Removes `650` and the 7px label. | Low — just shipped #001 here |
| 5 | `ModuleSubNav.css` (L2 nav) | Shared by every module. 9px → 11px. | Low |
| 6 | `BottomNav.css` | All mobile navigation. | Low |
| 7 | **New** `Badge` primitive | Collapses 55 files' worth of duplication. | Medium — new component |
| 8 | **New** `Button` primitive | Collapses 21. | Medium |
| 9 | Barry's 8 CSS files | Gives Barry one voice. Half-pixel sizes are pure debt. | Low |
| 10 | The 37 font-family overrides | Biggest visual win; deletion only. Can be done any time — consider pulling it to #1. | Low |
| — | *1,918 inline `fontSize` (113 files)* | *Highest volume, lowest value per edit. Migrate opportunistically as files are touched; do not make it a milestone.* | Low each |

---

## 6. Scope, risks, acceptance criteria

### Proposed scope

Three PRs, each independently revertible:

- **PR 1 — foundation.** Scale variables, `h1`–`h4` baseline, the 37 override
  deletions, font-weight trim in `index.html`. **No layout changes intended.**
- **PR 2 — shared surfaces.** Nav L1/L2/mobile, form controls to 16px, Barry.
- **PR 3 — primitives.** `Badge` and `Button`, migrating the highest-traffic
  call sites only.

Inline-style migration is explicitly *not* a milestone.

### Risks

1. **The 11px floor costs horizontal space.** 183 declarations move up, many in
   dense tables. Some columns will wrap or truncate. **This is the single
   highest-risk item** and needs a per-table decision, not a global sweep. If it
   proves disruptive, hold the floor at 10px for tabular data only and document
   the exception.
2. **74 files override font-size in media queries.** A global change that
   ignores them produces mobile regressions invisible on desktop. Each must be
   re-checked at 375px.
3. **No test asserts typography** — the same gap flagged in #001. ~4,200
   decision sites and nothing to catch a regression. Recommend at least a lint
   rule banning px `font-size` in new CSS.
4. **Contact Hub is being actively edited.** Its file is already clean and needs
   near-zero work — but PR 1 touches `src/index.css`, which affects their
   surface. Coordinate before PR 1 lands; nothing here should touch
   `ContactHub/*`.
5. **Weight rebalancing is the subjective part.** Moving work from weight to
   size will read as a real visual change, unlike the rest. Needs sign-off on a
   sample screen before it is applied broadly.
6. **Website coordination.** This audit covers `src/` only. If the marketing
   site shares any of these tokens, its typography is out of scope and must not
   be assumed to follow.

### Visual acceptance criteria

PR 1 is correct when:

- `getComputedStyle` reports an Inter-first stack on **every** text node across
  Scout, Recon, Hunter, Basecamp and Settings — currently false in 13 files.
- The Google Fonts request names exactly the weights in use.
- No rendered `font-size` is below 11px, and none is fractional.
- Screenshot diffs on ten representative screens show **no layout shift** —
  PR 1 changes the font that paints, not the metrics.

The initiative is complete when:

- Distinct rendered sizes ≤ 12, down from 52.
- Distinct line-heights ≤ 4, down from 19.
- `font-weight: 400` appears more often than 700 — the clearest single signal
  that hierarchy has moved from weight to scale.
- Every form control is ≥16px; no iOS zoom on focus, verified at 375px.
- All **seven** themes verified, and mobile verified at 375px for every file in
  the 74-file media-query set that was touched.
- Barry renders at one consistent scale across all eight of his surfaces.

---

## Awaiting direction

No code has been changed. The three decisions needed before Phase 2:

1. **Confirm keeping Inter** (recommended) versus evaluating an alternative.
2. **Approve the nine-step scale**, or adjust the steps.
3. **Rule on the 11px floor** for dense tables — the one change that can cost
   layout.

---

## Phase 2A — implemented

Approved 2026-11-21. Scope held to what was approved; 2B not started.

| Item | Done |
|---|---|
| Centralized typography tokens | 9 sizes, 4 weights, 4 line-heights as custom properties on bare `:root` in `src/index.css`. Mirrored in `TYPE` for inline-styled JSX; a test fails if the two drift. |
| Remove the 37 system-font overrides | All 37 gone from 13 files. 25 were live; 12 were in never-imported files. |
| Global heading defaults | `h1`–`h6` given size, weight and line-height. **No margins** — preflight zeroed them and 441 headings were laid out on that basis. |
| Font loading | Inter `300;400;500;600;700;800` → `400;500;600;700;800`; Orbitron `400;500;600;700;800;900` → `700;800`. **12 font files → 7, nothing renders differently.** |
| Safeguard | `scripts/checkTypography.mjs` + `src/test/typographyGuard.test.js`. |

### The brand exceptions, verified before trimming

- **Inter 800 stays.** 58 uses — the sidebar wordmark fallback, Contact Hub's
  `.hub-title` / `.hub-section-title` / `.hub-dialog-title`, Mission Control's
  figures, auth. Dropping it would have broken all of them.
- **Inter 300 went.** Loaded since the beginning, used zero times.
- **Orbitron stays, at 700 and 800 only.** Five call sites across
  `WithTheForce` and `UserSettings`; every one resolves to 700 or 800. The
  other four weights were dead payload. The `.font-orbitron` utility has no
  JSX consumer and was left in place rather than widen the diff.
- **Weight 650** (`Sidebar.css`, `MainLayout.css`) is not loaded and snaps to
  700. Both files belong to Phase 2B; left alone rather than touch 2B surfaces
  early.

### The safeguard

A ratchet, not a gate. 1,023 existing violations across 74 files are recorded
in `scripts/typography-baseline.json` and are **not** failures — rewriting them
was explicitly out of scope. The suite fails only when a file's count rises, or
a clean file stops being clean. Legacy stays legacy; new work uses the tokens.

It checks five things: non-Inter font stacks, px font-sizes, sizes below the
11px floor, weights off the scale, and `line-height: 1`. Contact Hub is
excluded by path. It runs in CI already, since the workflow runs the whole
vitest corpus. Zero new dependencies — node's `fs` and five regexes.

Its own test proves it still bites: it writes a probe file containing one of
each violation and asserts every rule fires. That test caught a real bug on
first run — the `TYPE` mirror check matched `xs` inside `'2xs'`.

### What the specimen caught

The first attempt set `font-size: var(--text-base)` on the `html, body` rule.
`--text-*` are rem values, so this redefined what `1rem` means and silently
rescaled **every rem font-size in the codebase** — and because the rule covers
both elements, the 0.875 applied twice and inherited text resolved to
**12.25px** instead of 16px.

Nothing in the diff looked wrong. It was caught by measuring the rendered
result, which is the whole argument for building the specimen before the
screenshot. The root now stays at the browser's 16px: `--text-base` is what a
component asks for, never what the document defaults to.

### Deliberately not done

- No button or badge architecture.
- No migration of the 1,918 inline sizes.
- No mobile changes — the 74 media-query files are untouched.
- No Contact Hub files touched; it is excluded from the guard by path.
- Weight 650 left in the two Phase 2B files.
- The 113 sub-16px form controls are **not** fixed. It is on the 2B list and
  the iOS zoom defect is still live.

### Phase 2B — not started, awaiting the weight/hierarchy decision

Desktop primary sidebar · module secondary navigation · shared page headers ·
Barry's typography. The 2A heading defaults are the first real hierarchy
change, and the specimen is what there is to approve or reject.

---

## Phase 2B — implemented

Authorized 2026-11-21. Five priorities, in order, plus the iOS defect.

| # | Surface | What changed |
|---|---|---|
| 1 | Desktop sidebar | Nav items 13/500, active pill 600 (was the unloaded 650). Compact rail labels 7px → 11px. Barry's card name 700 → 600. Drawer group label tracking 0.14em → 0.06em. |
| 2 | Module sub-nav | Header 9px/700 at 0.2em → 11px/600 at 0.06em. Item labels 12/400 → 13/500, active 600. Descriptions and badges 9px → 11px. |
| 3 | Shared page headings | `.page-title` → `--text-3xl`/bold across five live pages; subtitles settle on regular. Shell breadcrumb loses its 650. |
| 4 | Card titles | `.card-title` 15/500 → 16/600; detail modals 700 → 600. |
| 5 | Barry | 178 declarations across 14 live stylesheets; 28 distinct sizes → 16; 8 sub-floor → 0. |
| — | Daily Discoveries | 45 sub-floor inline sizes raised; 13 hierarchy declarations retokenised. |
| — | iOS input zoom | One mobile-only rule. |

### Measured

| | Before 2B | After |
|---|---|---|
| Guard baseline violations | 1,023 | **937** |
| Files carrying violations | 74 | **64** |
| CSS declarations below the 11px floor (touched files) | 23 | **10** (all inside restored media queries) |
| Daily Discoveries inline sizes below floor | 45 | **0** |
| Barry distinct size values | 28 | **16** |
| `font-weight: 650` anywhere | 2 | **0** |
| Form controls that zoom iOS | 81 | **0** |

262 tests pass across the 14 affected files. Production build clean. Typography
is **identical across all seven themes** — verified by switching
`html[data-theme]` through every one and comparing computed styles.

### The Daily Discoveries card

Its stylesheet is never imported, so this edited what renders. The hierarchy
went from a pile of bold — company name, match chip and score all at weight 800,
the brand exception — to a ladder:

`28/700` name → `16/600` buttons → `14/700` match chip → `14/400` industry →
`13/400` meta → `11/600` confidence pill.

The confidence pill was uppercase *and* 700 *and* tracked 1px: three emphases
for one word. It keeps the caps and drops the rest.

### The one regression, stated plainly

**Compact rail labels: four of nine now ellipsis where two did before.** 11px is
the approved floor and they are legible for the first time, but REINFORCEMENTS
needs 104px and COMMAND CENTER 110px in a 64px rail — no legible size fits
those. Reclaiming the rail's side padding (10px → 3px, compact only) bought 6px
per label and softened it without solving it. Compact items already carry the
full name as a title tooltip.

If complete labels matter more than legible ones, the fix is shorter `railLabel`
values in `navigationModel.js` — an IA change, covered by the locked-IA test,
and not this initiative's to make.

### Scope held

No Contact Hub, website or billing file is in the diff. No dead CSS deleted. No
buttons or badges rebuilt. No dependencies. No business logic. The 1,918 legacy
inline sizes are untouched except on Daily Discoveries, which was named
specifically.

**Mobile:** the only intentional mobile change is the iOS guard. The Barry sweep
initially reached inside seven media queries in BarryContext and BarryWorkspace;
those blocks were restored verbatim from HEAD and are byte-identical.

**The iOS guard is global by nature.** It is one rule at the platform level, so
it also fixes Contact Hub's inputs on mobile without editing their files. Worth
knowing before that team sees a 16px field they did not write.

### Still open after #002

- 937 legacy violations remain, recorded and forgiven by the ratchet.
- The 1,918 inline sizes outside Daily Discoveries.
- Five never-imported stylesheets, left in place as instructed.
- No test asserts rendered typography; the guard checks source, not pixels.
