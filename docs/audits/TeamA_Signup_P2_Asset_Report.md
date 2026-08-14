# TEAM A — P2 Background Inspection + Asset Delivery Report

**Against:** TEAM_A_PHASE2_RESPONSE (Aug 13, 2026) §3 "INSPECT AND REPORT" and §6 "New assets now available"
**Status:** P2 answered. Two source assets committed. **No derivative produced. No code written. No production behaviour changed.**
**Gate:** Phase 3 awaits confirmation on §2 and §4 below.

---

## Summary

| Item | Result |
|---|---|
| **P2 — Barry background** | ❌ **White is baked in.** 0 transparent pixels out of 1,573,520. Background removal is required |
| **Removal preview** | ✅ Produced, attached, and inspected at 125% on the gradient. Clean. **Not committed** — awaiting your confirmation per §3 |
| **ASSET-001 Barry** | ✅ Committed at the approved path |
| **ASSET-002 mockup** | ✅ Committed at the approved path |
| **ASSET-003 / ASSET-004** | ⚠️ **Attachments are swapped, and both are files already in the repo** — checksum-proven. Nothing new arrived |
| **Barry mascot sheet** | ❌ **Still not delivered.** ASSET-001 carries one image; the library was never attached |
| **Chest badge** | ✅ Closed per your §2. No action |

---

# 1 — P2: the background inspection

**Answer: white pixels are baked into the source. There is no usable alpha.**

Measured over every pixel of `barry-signup-source.png` (1105 × 1424 = 1,573,520 px):

| Measurement | Value |
|---|---|
| Fully transparent pixels (α = 0) | **0** |
| Partially transparent pixels (0 < α < 255) | **0** |
| Fully opaque pixels (α = 255) | **1,573,520 — all of them** |
| Opaque near-white pixels (all channels > 245) | 1,006,433 — **63.96% of the image** |
| Content bounding box | the full canvas — the white reaches every edge |

Border samples, all corners and edge midpoints: `rgba(253–255, 253–255, 254–255, 255)`. Opaque white.

The file *is* encoded RGBA, which is why a header check would say "has alpha" — but the channel is uniformly 255. It is a container with nothing in it.

**Why the mockup looked fine.** `signup-mockup-approved.png` is a single generated composition — Barry was *drawn into* the scene, not composited from this PNG. The mockup is evidence of the intended result, not evidence that the delivered file can produce it.

**Conclusion: placed as delivered, Barry renders as a white rectangle on the blue→indigo→purple panel.** Background removal is required.

---

# 2 — Removal preview *(for your confirmation — no derivative committed)*

Two previews are attached: a full before/after on the production gradient, and a 125% edge inspection.

### Method, and why it is safe on this particular asset

The obvious approach — key out white — would destroy Barry, because **his spacesuit, gloves highlights and boots are white too.** That is the trap in this asset.

What was done instead, in two passes:

**Pass 1 — flood fill from the border.** Background is defined not as "light" but as "light *and reachable from the edge of the canvas*". The spacesuit is light, but a flood fill cannot reach it without crossing the bear's dark outline. Connectivity is what protects it, and the preview confirms the suit, boots and belt survive intact.

**Pass 2 — un-matte against white.** The source was composited over white, so every semi-transparent edge pixel satisfies

```
src = fg·α + 255·(1 − α)
```

which inverts exactly to `fg = (src − 255·(1 − α)) / α`. Recovering the true foreground colour is what stops the fur silhouette carrying a pale rim that glows against a dark panel. **This is the step a naive cut-out skips**, and the attached comparison shows the difference on the ear and wrist edges — visible in the "A: no un-matting" vs "B: un-matted" pair.

**Result:** 992,720 px removed outright, 17,472 px feathered, 17,081 of those colour-corrected. Trimmed output **735 × 1309** — a 44% reduction in canvas area, all of it discarded whitespace.

### One thing that looks like a defect and is not

There is a **cyan rim light along the left edge of Barry's fur.** I verified it against the untouched source on its native white background — the third attachment — and **it is in the original artwork.** It is a deliberate rim light on the illustration, not contamination introduced by the cut. I am flagging it because it reads as a matting artifact at a glance and I would rather you know it survived a check than wonder later.

### What I did *not* do

- No derivative committed to `public/` — per your §3, that waits for your confirmation.
- The canonical source is **untouched**: `docs/design/source/barry-signup-source.png`, MD5 `0a4265e163c02f9e43fdcc3714d93998`.

**Requesting:** confirmation to produce the production derivative (AVIF/WebP/PNG, `<picture>`, < 80 KB at 2×) from this method.

---

# 3 — Assets committed

| Path | Source | MD5 | Size |
|---|---|---|---|
| `docs/design/source/barry-signup-source.png` | ASSET-001 (#541) | `0a4265e163c02f9e43fdcc3714d93998` | 1.87 MB, 1105×1424 |
| `docs/design/signup-mockup-approved.png` | ASSET-002 (#542) | `fb3ff4ba6544e7e82389e03bd57f101b` | 1.63 MB, 1024×1536 |

Both outside the Vite-served tree, per the approved §1 paths. Neither deploys.

---

# 4 — ASSET-003 and ASSET-004: the attachments are swapped, and neither is new

This one needs a decision, and the evidence is checksums rather than judgement.

| Issue | Labelled | Attachment actually is | MD5 | Identical to |
|---|---|---|---|---|
| **#543** ASSET-003 | "IDYNIFY wordmark — pink/teal/navy" | **512×512 opaque navy tile, pink ID with cyan keyline** | `88a9d20585f8137bdb4a035a4483ae3e` | **`public/icon-512.png`** — byte-identical |
| **#544** ASSET-004 | "IDYNIFY icon — circular ID badge, 512×512" | **2172×724 italic neon wordmark with underline stroke** | `a56148e366a940922336db61fcc53c3a` | **`public/assets/Idynify_logo1.png`** — byte-identical |

Two separate findings:

**4a — The attachments are crossed relative to their labels.** Your written descriptions are correct — #543's prose describes the wordmark, #544's describes the icon — but the images are on the opposite issues. Building `BrandMark` from the paths as labelled would put a 512px square icon where the wordmark belongs.

**4b — Neither file is new.** Both are already in the repository, byte for byte. Your §6 says these *"replace what the brief previously described as a 1.19 MB unusable PNG wordmark"* — but ASSET-004's attachment **is that exact file**, 1,189,784 bytes, unchanged.

**Consequence:** no new canonical artwork has arrived, so **D3 stands as decided** — optimized raster derivation from the existing wordmark, which you already authorized. Nothing is blocked. But the expectation that a better source landed should be corrected, because it changes nothing about the plan and everything about what we think we have.

**Recommendation: do not commit either file to `docs/design/source/`.** Duplicating 1.4 MB that is already versioned in `public/` creates two canonical copies that can drift. `BrandMark` derives from the existing paths, and this document records the provenance. Say the word if you want the duplicates anyway.

### Wordmark legibility on the white panel — checked, and it passes

The canonical wordmark is 33.75% fully transparent and 65.95% *partially* transparent — an unusually soft, glow-heavy render — so I tested it rather than assuming. Rendered at 180px and 240px on the white left panel and on the dark gradient (attached, panel 3): **it reads cleanly on both.** The navy inner stroke carries the letterforms on white; the cyan keyline does the work on dark. No contrast problem.

### One thing to settle before Phase 4 QA

**The mockup's top-left lockup is not the canonical wordmark.** The mockup shows the ID badge beside plain black "IDYNIFY" set in a neutral sans. The canonical asset is the italic pink/cyan/navy neon lockup. Your §6 says to use the full wordmark, which — consistent with how N2/N3/N4 were resolved — overrides the mockup.

Flagging only so Phase 4 does not log it as a defect: the top-left corner will read noticeably more energetic than the mockup does. That is the instruction, and the attached preview shows it working. It is a deliberate divergence, not a miss.

---

# 5 — The Barry mascot sheet was not delivered

ASSET-001 (#541) carries **one** image: the signup Barry. `Cartoon_astronaut_bear_mascot_set.png` — the full library of poses, expressions, sales actions, hero shots, per-module mission suits and stickers — is not attached to any of the four issues, and there are no issue comments carrying it.

**Not a Phase 3 blocker.** The signup page needs one Barry, and that one is committed. But it does block a stated acceptance criterion:

> "Barry asset library (`Cartoon_astronaut_bear_mascot_set.png`) catalogued for platform use"

**Recommendation:** attach it to #541 when convenient and I will commit and catalogue it as a closing task, or split it out as **ASSET-005** and let it fall out of this sprint's criteria. Either is fine; leaving the criterion in place with no file is not.

---

# 6 — Phase 4 QA expectation, stated now rather than argued later

The acceptance criterion reads *"Desktop implementation closely matches approved mockup."* Six authorized decisions remove content the mockup shows:

| Removed | Authority |
|---|---|
| Google + Microsoft SSO buttons | Q5 |
| The `or` divider | Q5 |
| "Enterprise-grade security / Your data is always protected" | Security decision, Option C |
| Terms of Service + Privacy Policy line | D2 |
| HubSpot / Google / Palo Alto / Segment / Calendly logos | Brief §Social proof |
| "Your AI-powered sales engine…", "I'm your AI SDR…", "Your AI SDR, Always On" | N3 / N4 / frozen positioning |

That is roughly 40% of the mockup's left-panel vertical content and its entire bottom band. The rebuilt page will be **visibly shorter and more spacious** than the mockup — correctly so.

**Proposed reading of the criterion:** match the mockup's *composition and system* — two-panel split with the curved divider, white left, gradient right, Barry lower-right, speech card upper-right, field styling, CTA treatment, four-card below-fold section — and **not** its content inventory. I will screenshot at 1440/1280/768/390 against the mockup and annotate each divergence to its authorizing decision, so QA reviews a list of intended differences rather than a diff.

One more, small: the mockup's Barry is drawn into a generated scene, so his pose, scale and ground shadow cannot be pixel-matched from the delivered PNG. Composition and placement will match; the render will not.

---

# 7 — Phase 3 gate

| Gate condition | Status |
|---|---|
| All assets committed at approved paths | ⚠️ **Partial** — Barry ✅, mockup ✅; wordmark/icon already in repo (§4, recommend no duplicate); mascot sheet not delivered (§5) |
| P2 background inspection reported and confirmed | ✅ **Reported** (§1–2) — ⬜ awaiting your confirmation to produce the derivative |
| GCIP release procedure documented | ✅ `docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md` |
| No new authentication architecture | ✅ Re-verified at Phase 2; unchanged |

### Open

| # | Item | Blocks |
|---|---|---|
| **A1** | **Confirm the background-removal method** in §2 so the production derivative can be produced | The right panel |
| **A2** | **Confirm the ASSET-003/004 swap** (§4a) and that no duplicate commit is wanted (§4b) | `BrandMark` source paths |
| **A3** | **Mascot sheet** — attach it, or move it out of this sprint's acceptance criteria | One acceptance criterion |
| **A4** | *(Optional)* confirm the Phase 4 QA reading in §6 | Prevents a QA disagreement, not the build |

A1 is the only one on the critical path. A2 and A3 are bookkeeping; A4 is expectation-setting.

---

**No derivative produced. No code written. No production behaviour changed. Canonical sources untouched.**
