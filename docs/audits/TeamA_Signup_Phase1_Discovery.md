# TEAM A — Signup Rebuild, Phase 1 Discovery
**Against:** SIGNUP_IMPLEMENTATION_BRIEF v5.2 (Build Approved, pending Q1/Q5/Q8 — all now resolved in brief)
**Status:** Discovery complete. **No code written. No production behaviour changed.**
**Gate:** Phase 2 implementation plan attached as a draft; Phase 3 build awaits your approval.

---

## Headline

Discovery is clean on the parts the brief assumed would be hard (auth is stable and reusable; the access gate is trivially preservable; tokens exist) and blocked on parts the brief assumed were already done.

**Four items block acceptance criteria and none of them are code problems:**

| # | Blocker | Which criterion it fails |
|---|---|---|
| **B1** | **The three Barry/mockup assets are not in this session or the repo.** Only the two briefs were uploaded. | "Barry asset is used, optimized, correct"; "Screenshot QA performed against mockup" |
| **B2** | **Terms of Service and Privacy Policy do not exist** — no route, no page, no URL, anywhere in the repo. | "Terms of Service link resolves to real page"; "Privacy Policy link resolves to real page" |
| **B3** | **There is no IDYNIFY SVG.** The only wordmark is a **1.19 MB PNG** at 2172×724. The brief says "Use official SVG/vector asset. Do not recreate in text." | "IDYNIFY wordmark is correct and official"; Performance section |
| **B4** | **The existing analytics service physically cannot record 8 of the brief's 10 events** — it writes to `users/{uid}/…` and returns early when there is no signed-in user. | "Analytics follow existing conventions" |

Everything else is buildable as specified. Details and options for each blocker are in §9.

---

# 1 — Current signup route(s) and component(s)

| Item | Finding |
|---|---|
| Route | `/signup` — `src/App.jsx:352` |
| Guard | `!user ? <Signup /> : <Navigate to="/checkout" />` — an already-authenticated visitor is bounced to checkout, never to signup |
| Component | `src/pages/Signup.jsx` — **one file, 359 lines, zero imported components** |
| Query params read | `?tier=` only (`Signup.jsx:17`), defaulting to `'starter'` |
| Sibling pre-auth routes | `/login` → `Login.jsx` (`App.jsx:351`) · `/forgot-password` → `ForgotPassword.jsx` (`App.jsx:353`) |
| Reset-password route | **Does not exist.** Firebase's own hosted handler is used — nothing in-repo to align |
| Email-verification route | **Does not exist.** No verification is sent or required (see §2) |
| Existing tests | **None.** No test in `src/test/` touches Signup, Login, or ForgotPassword |

**Note for Q8 scope.** The brief authorizes aligning five screens: Create Account, Sign In, Forgot Password, Reset Password, Email Verification. Only **three** exist. Reset Password is Firebase-hosted and cannot be visually aligned without building a custom action handler (auth architecture change — out of scope per the guardrail). Email Verification has nothing to align. **Realistic Q8 scope is three screens, not five.**

---

# 2 — Auth provider and existing behaviour

**Provider:** Firebase Authentication, web SDK **v12.6.0**. Config is hardcoded, not env-driven — `src/firebase/config.js:5-12`, project `idynify-scout-dev`.

**Google Cloud Identity Platform (GCIP) is enabled.** Inferred with confidence from `src/utils/mfa.js:8`, which uses `TotpMultiFactorGenerator` — TOTP MFA is a GCIP-only feature. This matters for §4: **GCIP is what makes a real, server-enforced password policy available to us.**

### What `handleSignup` does today — `Signup.jsx:38-109`

```
validate password match (client)        → Signup.jsx:42
validate length ≥ 6 (client)            → Signup.jsx:48
createUserWithEmailAndPassword          → Signup.jsx:56   [await]
setDoc users/{uid} { … }                → Signup.jsx:61   [await]
fetch /.netlify/functions/send-welcome-email
                                        → Signup.jsx:74   [await]
navigate(`/checkout?tier=${tier}`)      → Signup.jsx:89
```

| Behaviour | Finding |
|---|---|
| Email verification | ❌ **Never sent, never required.** No `sendEmailVerification` anywhere in the repo |
| Welcome email | ✅ `netlify/functions/send-welcome-email.js`, via Resend. **Awaited before redirect** (`Signup.jsx:74`) despite the comment on line 72 saying "don't block on this" — the comment is wrong; a slow Resend call delays the redirect. Its `catch` only logs, so a failure is invisible to the user |
| Firestore write | `users/{uid}` — `email`, `createdAt`, `selectedTier`, `subscriptionTier`, `status: 'pending_payment'`, `hasCompletedPayment: false`, `credits: <number>`, `monthlyCredits` (`Signup.jsx:61-70`) |
| Loading / disabled state | ❌ **None.** No `loading` state exists in the component. `Login.jsx:14` and `ForgotPassword.jsx:10` both have one |
| Duplicate-submit guard | ❌ **None.** No re-entry check in `handleSignup` |
| Error mapping | ✅ Already maps 4 codes + default (`Signup.jsx:92-107`). Missing `auth/network-request-failed`, which the brief requires |
| Form preservation on error | ✅ Values already survive — state is never reset |
| MFA at signup | Not involved. `Login.jsx:26` handles `auth/multi-factor-auth-required` at sign-in only |

**Reuse verdict: high.** `createUserWithEmailAndPassword` + `setDoc` + redirect is sound and needs no architectural change. The brief's guardrail ("reuse existing auth logic wherever it works") is comfortably satisfiable — the gaps are UI state, not auth.

---

# 3 — Google / Microsoft OAuth

**Neither exists. Confirmed by exhaustive search, not assumption.**

Zero occurrences across `src/`, `netlify/`, `functions/` of: `GoogleAuthProvider`, `OAuthProvider`, `signInWithPopup`, `signInWithRedirect`, `linkWithPopup`, `signInWithCustomToken`, `sendSignInLinkToEmail`, `isSignInWithEmailLink`.

This **confirms Q5** — no SSO buttons, no `or` divider, nothing to remove because nothing was ever built.

**One relevant adjacency for Phase 2, flagged not proposed.** A Google Cloud OAuth client already exists for **Gmail data access**: `netlify/functions/gmail-oauth-init.js:67-70` and `gmail-oauth-callback.js`. That is a *data* authorization, entirely separate from Firebase *identity* — but it means the Google Cloud project, consent screen and client credentials already exist. When Phase 2 SSO is authorized, that is a materially shorter path than starting cold. **Out of scope this sprint.**

---

# 4 — Current password requirements vs. the brief's three rules

### What is enforced today

| Layer | Rule |
|---|---|
| `Signup.jsx:48` | `password.length < 6` → "Password must be at least 6 characters" |
| `Signup.jsx:269,284` | `minLength="6"` on both password inputs |
| Firebase (server) | Default minimum **6 characters**. No complexity requirement |
| Anywhere | ❌ No uppercase, lowercase, numeric, or symbol rule of any kind |

### The conflict

The brief specifies displaying:

```
✓ 8+ characters
✓ Upper & lowercase letters
✓ At least one number
```

…and instructs: *"Verify these match actual Firebase auth rules before shipping. Do not display requirements that are not actually enforced."*

**As things stand, all three would be false.** Today the server accepts `aaaaaa`.

### The good news — this is fixable properly, not faked

Because GCIP is enabled (§2), Firebase supports a **server-enforced password policy**, and the installed SDK (v12.6.0) exposes `validatePassword(auth, password)` from `firebase/auth`, which returns the *project's actual policy* and per-rule pass/fail.

Three options, in order of preference:

| Option | What happens | Verdict |
|---|---|---|
| **A — Configure the GCIP policy to min 8 + upper + lower + numeric, then drive the UI from `validatePassword()`** | The checklist reflects real server rules by construction; it cannot drift | ✅ **Recommended.** Console change + client read. No auth architecture rewrite |
| **B — Enforce the three rules client-side only** | Checklist is honest about what *this form* enforces; the API still accepts weaker passwords from any other path | ⚠️ Acceptable fallback. Weaker, but not a false claim |
| **C — Display only "6+ characters"** | Truthful today, contradicts the approved mockup | ❌ Not recommended |

**`[NEEDS AARON]` — Option A requires a Firebase console change I cannot make and should not make.** It also affects **existing users at next password reset**, which is a product decision, not a design one. Confirm A or B before Phase 3.

**Also note:** the brief says *"No confirm password field unless technically required by auth provider."* It is **not** required — Firebase never sees a second value. Dropping it is safe, and it is the right call given show/hide ships in the same change.

---

# 5 — Terms of Service and Privacy Policy routes

**They do not exist. This is blocker B2.**

Searched `src/`, `netlify/`, `index.html`, `public/manifest.json` for `/terms`, `/privacy`, "terms of service", "privacy policy". **The only hit in the entire repository** is an admin placeholder string: `src/pages/Admin/UserDetail.jsx:188`, `'e.g., "Violation of terms of service"'`.

- No route in `App.jsx`
- No page component
- No external URL in any config, footer, or email template
- `Homepage.jsx:435` footer is `© 2024 Idynify Scout. All rights reserved.` — and nothing else

The brief requires *"By continuing, you agree to our Terms of Service and Privacy Policy"* with *"Both links must resolve to real pages. Do not create placeholder links."*

**`[NEEDS AARON]` — three ways forward, none of them mine to pick:**

| Option | Note |
|---|---|
| Provide existing URLs (e.g. on the marketing site) | Fastest. If they exist somewhere outside this repo, I just need the URLs |
| Authorize in-repo `/terms` and `/privacy` routes | Requires the actual legal copy. Team A does not write legal text |
| Ship without the legal line | **Contradicts the brief's own acceptance criteria** and is the weakest trust posture. Not recommended |

This is on the critical path: the legal line is in the approved composition, and one of the acceptance criteria is that both links resolve.

---

# 6 — Available IDYNIFY logo assets

Verified by content-type against a running server, not by directory listing — because two paths that look present are not.

| Asset | Path | Real? | Format | Size | Notes |
|---|---|---|---|---|---|
| Wordmark | `/assets/Idynify_logo1.png` | ✅ | PNG | **1.19 MB** @ 2172×724 | Pink `#e8197d` fill, cyan `#00c4cc` keyline, navy `#1a1040` inner stroke — **exactly on-token** |
| ID mark (PWA) | `/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png` | ✅ | PNG | 31 KB / 214 KB | Pink ID on navy with cyan keyline. Shipped `9f1eb78`→`323220a` |
| Favicons | `/favicon-16.png`, `/favicon-32.png`, `/apple-touch-icon.png` | ✅ | PNG | small | Consistent with the ID mark |
| Compact mark | `/assets/Short_Logo_Idynify.png` | ❌ **404** | — | — | Referenced by `tokens.js:50`; `Sidebar.jsx:88` falls back to the text `"ID"` |
| Barry avatar | `/assets/barry_AI.jpg` | ❌ **404** | — | — | Referenced by `tokens.js:48` and **ten components** — every Barry in the product is currently the 🐻 emoji fallback |
| Old signup Barry | `/barry-bear.jpg` | ✅ | JPG | 56 KB | Used **only** by `Signup.jsx:203`. Pre-update asset |
| **Any SVG** | — | ❌ **None exists** | — | — | Only `vite.svg` (framework default) and one inline `<svg>` grid pattern |

### Conflict with the brief — blocker B3

> "IDYNIFY icon + wordmark, upper left. **Use official SVG/vector asset. Do not recreate in text.**"
> "Logos: SVG where possible."

There is no SVG, and the available PNG is **1.19 MB** — an unacceptable payload for a 32px-tall wordmark, and directly at odds with the Performance section ("Fast on slower mobile connections").

**Recommendation:** supply the vector source. If it is unavailable, Team A can produce an optimized raster set (SVG trace or 2×/3× WebP at render size, ~8–15 KB) — but that is **deriving a brand asset**, which the "Do not redesign Barry / do not recreate in text" posture suggests you want to approve explicitly. **`[NEEDS AARON]`**

### Barry asset system — blocker B1

The brief names three files as build inputs:

- `Cheerful_bear_in_futuristic_spacesuit.png` — the signup Barry
- `Cartoon_astronaut_bear_mascot_set.png` — the full library
- `ChatGPT_Image_Aug_13__2026__09_20_17_PM.png` — the approved mockup

**None of the three is in this session or the repository.** Only the two markdown briefs were uploaded.

Consequences, stated plainly:
- The right panel cannot be built as specified — and the brief forbids the workaround (*"Do not recreate Barry in CSS"*, *"Do not substitute any other Barry"*).
- Phase 4 visual QA is impossible without the mockup to compare against.
- The brief's own §"Asset decision for Team A" — reconciling the chest badge between the two Barry files — cannot be actioned; I cannot see either file.
- The acceptance criterion "Barry asset library catalogued for platform use" cannot be met.

**This is the single hardest blocker.** Everything else has a workaround; this one does not. Please attach the three files.

---

# 7 — Existing design tokens and colours

**`src/theme/tokens.js` is the single source of truth** — and, critically for this sprint, **the pre-auth surface does not use it.** Signup, Login, ForgotPassword, all three Checkout pages and Homepage import **zero** tokens between them (verified across all seven files). That is the finding from the Team A audit that this brief happens to fix as a side effect.

### What exists and is directly usable

```js
BRAND = { pink: #e8197d, purple: #7c3aed, cyan: #00c4cc, navy: #1a1040, black: #000000 }
STATUS = { green: #10b981, red: #dc2626, amber: #f59e0b }
TYPE   = { fontFamily: "Inter, system-ui, sans-serif", weights: 400–800 }
THEMES = { mission, workspace, navy, sand, darkSide, lightSide, theForce }
```

Plus CSS custom properties on `html[data-theme]` in `src/index.css` — including `--input-focus: #e8197d`, which is why the product focuses **pink** and today's signup focuses **cyan**.

### Mapping the mockup onto existing tokens

| Mockup element | Token | Status |
|---|---|---|
| Left panel, white | `THEMES.workspace.cardBg #ffffff` | ✅ exists |
| Left panel body text | `workspace.text #12082a` / `textMuted #5a4880` | ✅ exists |
| "IDYNIFY" accent in headline | `BRAND.purple #7c3aed` | ✅ exists |
| CTA gradient | `linear-gradient(135deg, BRAND.pink, BRAND.purple)` — the product's existing primary (`OnboardingFlow.jsx:84-86`) | ✅ exists |
| Input surface / border | `workspace.input #ede9f8` / `border2 #d0c8e8` | ✅ exists |
| Focus ring | `--input-focus #e8197d` | ✅ exists |
| Right panel gradient: **deep blue → indigo → purple** | ⚠️ **Partial.** `BRAND.navy #1a1040` and `BRAND.purple #7c3aed` cover the endpoints; **there is no indigo token.** Nearest in-repo is `MODULE_COLORS.reinforcements #6366f1`, which is a *module* colour and semantically wrong to reuse | ⚠️ **needs one new token** |
| Below-fold card icons | Lucide, documented `tokens.js:391-418` | ✅ exists |

**Only one genuinely new value is required:** the indigo mid-stop of the right-panel gradient. Team A recommends adding it to `BRAND` (e.g. `indigo: "#4f46e5"`) rather than hardcoding it — a hardcoded gradient in the new signup would reproduce the exact defect this sprint exists to fix. **`[NEEDS AARON]` — one new brand colour, or confirm a two-stop navy→purple gradient instead.**

### What does not exist

- **No spacing scale.** `tokens.js` covers colour, type and asset paths only. Every "8px grid" claim would be unfalsifiable today.
- **No radius scale.** In-repo values range across 2/6/8/9/10/11/12/16/24/999px.
- **No shared form primitives.** No `Button`, `Input`, `Field` or `FormLabel` component exists anywhere in `src/`. The new signup will be **creating the first ones** — which is the right outcome, and is what makes Q8's "one coherent authentication experience" achievable rather than three hand-matched pages.

---

# 8 — Current post-signup redirect destination

```
Signup.jsx:89   navigate(`/checkout?tier=${tier}`)
                  ↓
App.jsx:359     /checkout  →  ProtectedRoute requirePayment={false}  →  CheckoutPage
                  ↓
CheckoutPage.jsx:60   VITE_STRIPE_ENABLED === 'true' ?
                  ├─ true  → window.location = Stripe Payment Link
                  │            starter: buy.stripe.com/…1gs04
                  │            pro:     buy.stripe.com/…1gs05
                  │            + client_reference_id=uid, prefilled_email
                  └─ false → DEV: simulate 2s, write payment fields, → /checkout/success
                  ↓
App.jsx:360     /checkout/success  →  CheckoutSuccessPage
                  ↓  hard 3-second setInterval (CheckoutSuccessPage.jsx:6-21)
App.jsx:370     /onboarding/barry  →  BarryOnboarding
```

**Per Q1, none of this changes this sprint.** Documented here because the brief requires it before anything is touched.

### One dependency the brief must not lose — the `tier` parameter

`?tier=` is not cosmetic. It drives **two** things:

1. Displayed claims (enrich count, contact count, credits, price) — **all removed by this brief** ✅
2. **`Signup.jsx:59` — the credits actually written to Firestore:** `tier === 'pro' ? 1250 : 400`, then `navigate('/checkout?tier=' + tier)`

The brief removes every *visible* trace of tier from signup. **The parameter must still be read and forwarded**, or every user arriving from the Pro pricing button (`Homepage.jsx:309`) silently becomes Starter.

Entry points today: `Homepage.jsx:256` (`?tier=starter`), `:309` (`?tier=pro`), and `:27`, `:104`, `:420` (**no tier — silently default to starter**). Preserving pass-through is a one-line concern, but it is exactly the kind of thing a visual rebuild deletes by accident. Flagged so it doesn't happen.

**`[NEEDS TEAM B]`** — Team A's read is that credits are written twice in two different shapes: `Signup.jsx:68` writes `credits: 400` (a number), `CheckoutPage.jsx:96-101` overwrites it with `{total, used, remaining, resetDate}` (an object). Not this sprint's job to fix, but Phase 5 verification should confirm the rebuild doesn't perturb it.

---

# 9 — Conflicts between the brief/mockup and production reality

Ordered by whether they block the build.

### BLOCKING

| # | Conflict | Detail | Resolution needed |
|---|---|---|---|
| **B1** | **Barry and mockup assets absent** | All three named PNGs are missing from the session and repo | **Attach the three files.** No workaround — the brief forbids substituting or recreating Barry |
| **B2** | **Terms / Privacy do not exist** | Zero occurrences repo-wide | **Provide URLs, or authorize creating the routes with supplied legal copy** |
| **B3** | **No SVG logo; the PNG is 1.19 MB** | Brief mandates vector; conflicts with its own Performance section | **Supply vector, or authorize an optimized raster derivation** |
| **B4** | **Analytics service cannot record pre-auth events** | See below | **Choose an option below** |

#### B4 in detail — the analytics conflict is structural, not effort

The brief says *"Follow the existing repository analytics conventions."* Here is the entire existing convention:

- `src/services/analytics.js` — the only analytics module.
- **Two** event names exist: `open_contact`, `open_company` (`analytics.js:45-48`).
- **Two** call sites exist, both in `src/utils/navigation.js`.
- Events are written to **`users/{uid}/analytics_events`** (`analytics.js:128`).
- `analytics.js:122-124`: `if (!realUid || !activeUid) return;` — **no signed-in user, no event.**
- `firestore.rules:7-8` confirms it at the database: `allow write: if request.auth != null && request.auth.uid == userId`.
- There is **no page-view convention, no funnel convention, and no anonymous event path** anywhere in the codebase.

Of the brief's ten events, **eight fire before an account exists**: `signup_page_viewed`, `signup_email_started`, `signup_password_started`, `signup_submitted`, `signup_failed`, `signup_signin_clicked`, `signup_method_selected`, plus the two OAuth events (moot this sprint per Q5). Routed through the existing service they will be **silently dropped** — no error, no event, and `console.info` will still print them, so it will *look* instrumented in dev while recording nothing in production.

Only `signup_succeeded` is recordable, and only after `createUserWithEmailAndPassword` resolves.

| Option | What it means | Verdict |
|---|---|---|
| **A — Instrument only `signup_succeeded`** | Honest, follows the convention exactly, no new dependency | ⚠️ Loses the entire funnel — which is the reason the events were specified |
| **B — Buffer pre-auth events in memory, flush to `users/{uid}/analytics_events` on success** | Full funnel for **completed** signups; **no new dependency, no rules change**; abandoners still invisible | ✅ **Recommended.** Best available under "no new dependency" |
| **C — Add a top-level `signup_events` collection with anonymous-write rules** | Captures abandoners — the actual conversion question | ⚠️ Requires a `firestore.rules` change and an unauthenticated write path. **Security review required.** `[NEEDS TEAM B]` |
| **D — Add a third-party analytics SDK** | Standard solution | ❌ `analytics.js:19-22` explicitly rejects this: *"adding an SDK to ship six event types would be a new external dependency the sprint explicitly forbids"* |

**`[NEEDS AARON]` — B or C.** Team A recommends **B** for this sprint, with C noted as the honest answer to "did signup conversion improve", which was the original reason for instrumenting at all.

### NON-BLOCKING — resolvable inside the sprint

| # | Conflict | Resolution |
|---|---|---|
| **N1** | **Password rules in the mockup are not enforced anywhere** (§4) | Configure the GCIP policy (Option A) or enforce client-side (Option B). `[NEEDS AARON]` |
| **N2** | **The mockup still shows the security badge** ("🛡 Enterprise-grade security / Your data is always protected") in the right panel, which the brief's Security decision **removes** | Follow the brief text, not the image. Right panel = gradient + speech card + Barry only. Noted so Phase 4 QA doesn't flag its absence as a defect |
| **N3** | **The mockup's supporting copy** ("Your AI-powered sales engine is a few minutes away") **is prohibited by the frozen positioning table** | Brief already resolves this — use "Know who matters, why they matter, and what to do next." Same as N2: mockup and brief disagree; brief wins |
| **N4** | **The mockup's Barry card copy** uses "AI SDR", "find the right people", "sales engine" | Brief already supplies frozen replacement copy. Use it verbatim |
| **N5** | **No indigo token** for the right-panel gradient (§7) | Add one `BRAND` value, or confirm a two-stop navy→purple. `[NEEDS AARON]` |
| **N6** | **`auth/network-request-failed` is not mapped** (`Signup.jsx:92-107`) | Add it. Trivial |
| **N7** | **Welcome email is awaited before redirect** (`Signup.jsx:74`), despite the comment claiming otherwise — it delays the CTA's completion | Make it genuinely fire-and-forget. Small, real perceived-performance win |
| **N8** | **Below-fold section conflicts with "Do not add navigation to the signup page"?** | No conflict — the four "Why sales teams love IDYNIFY" cards are content, not navigation. Noted only because the two instructions sit near each other |
| **N9** | **Social proof section has no verified content** | The brief already answers: remove entirely rather than fabricate. Confirming that is the plan |
| **N10** | **Q8 lists five screens; only three exist** (§1) | Scope Q8 to Create Account, Sign In, Forgot Password |
| **N11** | **No test covers any auth page** | Recommend adding render + validation + a11y tests alongside the rebuild. Currently there is no regression net for "No authentication regression" |
| **N12** | **`?tier=` must survive a rebuild that removes all tier UI** (§8) | Keep reading and forwarding it. One line, easy to lose |

---

# Phase 2 — Implementation plan *(draft — build not started, awaiting approval)*

Included so approval can cover both phases in one pass. **No files have been modified.**

### Files to modify

| File | Change |
|---|---|
| `src/pages/Signup.jsx` | Full rewrite against the approved composition |
| `src/theme/tokens.js` | Add the right-panel gradient stop (pending N5) |
| `src/App.jsx` | Only if `/terms` + `/privacy` routes are authorized (B2) |
| `src/pages/Login.jsx`, `src/pages/ForgotPassword.jsx` | Quieter variant of the new system, per Q8 |

### Components to create — the first shared form primitives in the codebase

| Component | Why it must be shared, not inline |
|---|---|
| `AuthLayout` | Two-panel desktop / stacked mobile. Signup uses the full composition; Login and Forgot use the quiet variant. One layout = Q8's "coherent experience" by construction |
| `AuthField` | Label + `for`/`id` + input + icon + `autocomplete` + inline validation + `role="alert"` error. Removes the accessibility failures **as a property of the component**, not as three hand-fixes |
| `PasswordField` | `AuthField` + show/hide toggle with `aria-label` + live requirement checklist. The reason no toggle exists today is that no wrapper exists to hang one on |
| `PasswordRequirements` | Reads real policy (§4 Option A) or the agreed client rules |
| `BrandMark` | IDYNIFY lockup with a real fallback. `Sidebar.jsx:80-104` already has this pattern — reuse it, don't reinvent |

### Asset optimization plan

Executable once B1 lands: Barry PNG → sharp → AVIF + WebP + PNG fallback via `<picture>`, sized to actual render dimensions at 1×/2×, transparent background preserved for the gradient. Target **< 80 KB** at 2×. Wordmark: vector if supplied; otherwise WebP at render size (~10 KB) replacing the 1.19 MB PNG.

### Auth changes

**None.** `createUserWithEmailAndPassword` + `setDoc` + redirect are reused as-is. The one *possible* auth-adjacent change is the GCIP password policy (§4 Option A) — a console setting, not code — which the brief's guardrail requires me to flag before building. **Flagged.**

### Responsive strategy

Two-column ≥1024px; single column below, Barry demoted beneath the form and legal so it can never push the CTA below the fold (explicit brief requirement). Below-fold cards 4→2→1. Verified at 1440/1280/1024/768/430/390/375/320 plus 200% zoom, landscape, keyboard-open, autofill and long-error, using the same measurement harness as the Phase-0 audit — so the badge/HUD/radar collisions found at 320–640 are confirmed gone, not assumed gone.

### Accessibility strategy

WCAG 2.2 AA, enforced by component design rather than review: `for`/`id` and `autocomplete` are non-optional props of `AuthField`; errors get `role="alert"` + `aria-live="polite"` + `aria-describedby`; the toggle is a real `<button>` with a state-accurate `aria-label`; requirement checklist is an `aria-live="polite"` list; Barry gets the brief's alt text; all links ≥44×44 (today's are 20px tall); every animation inside `@media (prefers-reduced-motion: no-preference)` — matching the seven shell CSS files that already do this and the four pre-auth pages that don't.

### Analytics changes

Per B4 Option B: an in-memory buffer flushed through the existing `logEvent` on auth success. No new dependency, no rules change, existing convention respected.

### Risks

| Risk | Mitigation |
|---|---|
| **No test covers any auth page** — highest risk in the sprint | Add render/validation/a11y tests before the rewrite lands |
| Rewriting `Signup.jsx` wholesale could perturb the checkout gate | Phase 5 verifies `?tier=` pass-through and the `users/{uid}` document shape explicitly |
| Q8 alignment touching Login could regress the MFA branch (`Login.jsx:90-142`) | Treat the MFA form as untouched logic re-skinned; no changes to `resolveMfaSignIn` |
| Password requirements shipping ahead of the GCIP policy | Ship the checklist and the policy together, or use Option B wording |
| Right-panel gradient hardcoded under time pressure | Token first (N5), then build — otherwise we recreate the defect this sprint exists to remove |

---

# Decisions needed before Phase 3

| # | Question | Blocks |
|---|---|---|
| **D1** | **Attach `Cheerful_bear_in_futuristic_spacesuit.png`, `Cartoon_astronaut_bear_mascot_set.png`, `ChatGPT_Image_Aug_13__2026__09_20_17_PM.png`** | Right panel, Phase 4 QA, asset catalogue, the chest-badge reconciliation the brief asks Team A to confirm |
| **D2** | **Terms of Service and Privacy Policy** — existing URLs, or authorize creating routes with supplied copy? | Approved composition + 2 acceptance criteria |
| **D3** | **IDYNIFY vector logo** — supply SVG, or authorize an optimized raster derivation? | 1.19 MB PNG is unusable as-is |
| **D4** | **Password policy** — configure GCIP to 8 + upper/lower/number (Option A), or client-side only (Option B)? | The requirement checklist must be true |
| **D5** | **Analytics** — buffer-and-flush (B), or an anonymous pre-auth collection with a rules change (C)? | The funnel; C needs security review |
| **D6** | **Right-panel gradient** — add an indigo `BRAND` token, or two-stop navy→purple? | Token-first build |
| **D7** | Confirm **Q8 scope is three screens**, not five (Reset Password is Firebase-hosted; Email Verification doesn't exist) | Sprint scope |

---

**Phase 1 complete. No code written, no assets modified, no production behaviour changed. Phase 3 build awaits approval on D1–D7.**
