# Desktop UI Polish #001 — Global Brand Identity

**Branch** `desktop-ui-sidebar-logo` · **Scope** the shared sidebar's brand mark
· **Behaviour changed** none

## The problem

The IDYNIFY wordmark was painting at **102×34 in a 220px rail — 46.4% of the
width** — set hard against the left gutter with ~88px of empty rail beside it.

The cause was a pair of rules that read as if they cooperate and do not:

```css
.sidebar-wordmark-img {
  max-width: 100%;      /* stretched the element box to 183px */
  max-height: 34px;     /* but capped the paint at 34px tall */
  object-fit: contain;      /* so the artwork letterboxed inside the box */
  object-position: left center;  /* and the letterboxed result sat left */
}
```

The element measured 183px wide; the artwork inside it measured 102px. Anyone
reading the CSS, or measuring the element in devtools, would have concluded the
logo was already filling the rail. It was not. The asset underneath was a
204×68 derivative — correctly cut at 2× for a 34px render height and no more,
so there were no pixels available to grow into either.

## What changed

The wordmark now spans the full **184px between the header's gutters — 83.2% of
the 220px rail**, inside the 80–85% target. The gutters are an even 18px on all
four sides, which makes the spacing rule and the centring the same fact rather
than two numbers that have to be kept in agreement.

Height falls out of the asset's own ratio. Nothing crops, stretches or trims it:
the painted ratio measures **3.0000** against the master's **3.0000**.

| | Before | After |
|---|---|---|
| Painted logo | 102 × 34 | **183 × 61** |
| Share of the 220px rail | 46.4% | **83.2%** |
| Aspect ratio | 3.0000 | 3.0000 |
| Gutters (L/R) | 18 / 101 | **18 / 18** |
| Served asset | 204×68 | **552×184** |
| Effective DPR | 2.00× | **3.02×** |
| Collapsed mark | 32px in a 64px rail | **36px** |

### The assets

Recut from the 2172×724 master at 552×184 — 3× the new render box, so the mark
stays sharp on 2× and 3× panels. Untrimmed and uncropped: the master carries
~100px of asymmetric transparent padding, and trimming it would have changed
the proportions the brief asked to preserve.

Encoders were not chosen by reputation. Each candidate was composited over the
real sidebar backgrounds — light and dark — and its error measured against the
clean resize, because a logo with alpha has undefined colour in its transparent
regions and a naive RGB diff scores formats on pixels nobody sees. Measured
that way, lossy WebP turned out to be the worst option available (mean error
3.87 against a 0.73 rounding floor, with visible ringing on the gradient
edges), and palette PNG — normally the fallback of last resort — the best.

The shipped set: **AVIF q82 (24.3KB) → WebP lossless from the quantised data
(27.9KB) → palette PNG q90 (30.2KB)**. Each format is smaller than the one it
falls back to, so the preference order never costs a viewer bytes. Together
they are ~29KB more than the old set for 9× the pixels.

Recipe, for whoever recuts these next: lanczos3 resize → PNG palette q90 →
that *same quantised data* re-encoded as lossless WebP (which is why the two
agree exactly) → AVIF q82 straight off the resize. It is recorded in the
`logoFullOptimized` comment in `src/theme/tokens.js`.

## What was verified, and how

- **Geometry** — measured in a live browser, not inferred from CSS. 183×61 at
  83.2%, gutters 18/18, ratio 3.0000, effective DPR 3.02.
- **Mobile is pixel-identical** — and this is the part that needed the care.
  The drawer is 264px, not 220px, so `width: 100%` would have inflated the logo
  to 228×76 there. A media query pins it back. Probed in a true 375px viewport
  on both builds: painted logo `102.0×34.0` at offset `18,18`, brand height
  66px, padding `18px 18px 14px` — **equal on both, to the pixel**. Mobile does
  inherit the sharper asset (5.41× effective).
- **Vertical spacing** — the header grew 66px → 97px, which is exactly the
  logo's +27px plus the +4px that evened the bottom gutter. Nothing else moved:
  the Barry card sits at y=723 in both builds, the nav does not scroll in
  either, and the 31px came out of 268px of existing slack below the last nav
  item.
- **Collapse button** — position byte-identical (208,20 wide; 52,20 collapsed).
  It is `position: absolute` on `.sidebar`, not a child of the header, so a
  taller header cannot move it. Verified functionally by clicking it: wide →
  compact → wide. Clearance from the collapsed mark measured 2.5px at the final
  36px, with no overlap.
- **Build** — production build succeeds; the three derivatives land in `dist`
  byte-identical to source at 552×184, and the minified CSS carries the new
  rules.
- **Tests** — 122 passing across all four sidebar-touching test files.
- **Themes** — checked individually on all five (workspace, mission, navy,
  sand, barry).
- **Conflicts** — of 544 remote branches, **none** touches any of the six
  changed files. Three active branches do conflict with `main`, on
  `firestore.rules`, `ContactHub/*` and `App.jsx` — confirmed pre-existing by
  reproducing the identical conflict set from plain `origin/main`.

## Known, and deliberately left

- **The collapsed mark was sized twice.** 40px matched the wordmark's new
  proportion but left it 0.5px from the collapse chevron — not overlapping, but
  abutting. It was reduced to **36px**, which restores a **2.5px** gap (32px
  gave 4.5px) while still reading larger than before. Effective DPR 3.56 from
  the 128px source.
- **The collapsed mark is 1px off-centre** — 13.5px left, 14.5px right. The
  sidebar's 1px right border makes the content box 63px, not 64px. This is
  pre-existing (15.5/16.5 before) and was not introduced here.
- **`tokens.js` defines an AVIF derivative that `<picture>` never serves** —
  the component only has a WebP `<source>`. That predates this work and looked
  deliberate. The AVIF was recut to stay in sync with its siblings, but the
  markup was left alone.
- **No test asserts the new geometry.** The sidebar suite covers structure and
  behaviour, not measurements, and adding a pixel assertion was outside this
  brief. If this logo quietly regresses, nothing will catch it.

## Files

| File | Change |
|---|---|
| `src/components/layout/Sidebar.css` | Brand block sizing, centring, mobile pin, collapsed mark (36px) |
| `src/components/layout/Sidebar.jsx` | `sidebar-wordmark` class on `<picture>`; doc comment. No logic. |
| `src/theme/tokens.js` | Derivative dimensions 204×68 → 552×184, plus the recut recipe |
| `public/assets/sidebar/idynify-wordmark.{avif,webp,png}` | Recut at 552×184 |

`MainLayout` mounts this one `Sidebar` for every authenticated route, so the
change is global and no page was edited to get it.
