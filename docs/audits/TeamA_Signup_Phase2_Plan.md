# TEAM A — Signup Rebuild, Phase 2 Implementation Plan (Final)

**Against:** SIGNUP_PHASE2_AUTHORIZATION (Aug 13, 2026) · SIGNUP_IMPLEMENTATION_BRIEF v5.2
**Status:** Planning complete. **No code written. No production behaviour changed.**
**Gate:** Phase 3 build awaits asset commit + the two decisions in §2.

---

## Deliverable checklist

| Required by Phase 2 Authorization | Where |
|---|---|
| Proposed asset paths for D1 (exact copy/paste, three paths) | **§1** |
| Chest-badge reconciliation finding | **§2** |
| Confirmed file / component / test plan | **§4–§6** |
| GCIP change documented as a release procedure step | **§3** → `docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md` (committed) |
| Confirmation that no new authentication architecture has appeared | **§7** |

**Two items need a decision before Phase 3 opens.** Both are in §2. One is a
sequencing conflict in D1 itself; the other is a property of the Barry asset
that determines whether the right panel can be built as drawn.

---

# 1 — D1 asset paths

Copy/paste destinations. Rationale follows.

```
docs/design/source/barry-signup-source.png
docs/design/source/barry-mascot-sheet-source.png
docs/design/signup-mockup-approved.png
```

| Upload | Destination |
|---|---|
| `Cheerful_bear_in_futuristic_spacesuit.png` | `docs/design/source/barry-signup-source.png` |
| `Cartoon_astronaut_bear_mascot_set.png` | `docs/design/source/barry-mascot-sheet-source.png` |
| `ChatGPT_Image_Aug_13__2026__09_20_17_PM.png` | `docs/design/signup-mockup-approved.png` |

### Why originals go under `docs/design/` and not `public/`

`netlify.toml:3` publishes `dist`. Vite copies **everything in `public/`** into
`dist` verbatim. So any original placed in `public/` is deployed, publicly
downloadable, and counted in the build — including the mascot sheet, which the
application never renders.

This satisfies all three of D1's requirements, and satisfies the second one
better than putting originals in `public/` would:

- ✅ *"Original source PNGs committed, not only the optimized derivatives"* — both originals are committed, versioned, and canonical
- ✅ *"Approved mockup stored under `docs/design/` or equivalent — the application does not need to download it"* — and neither does it need the mascot sheet or the un-optimized Barry
- ✅ *"Optimized WebP/AVIF derivatives live in the production asset directory"* — below

The example paths in the authorization used `public/assets/barry/`; this proposal
moves the two **sources** out of the served tree while leaving derivatives
exactly where the authorization asks. Flagging the deviation explicitly rather
than making it silently.

### Derivatives Team A will generate (Phase 3, after §2 is resolved)

```
public/assets/barry/barry-signup.avif
public/assets/barry/barry-signup.webp
public/assets/barry/barry-signup.png
public/assets/brand/idynify-wordmark.webp
public/assets/brand/idynify-wordmark.png
```

Barry: `<picture>` with AVIF → WebP → PNG fallback, sized to actual render
dimensions at 1× and 2×, aspect ratio preserved, **target < 80 KB at 2×.**

Wordmark (D3): derived from the existing canonical
`public/assets/Idynify_logo1.png` — **which stays exactly where it is, untouched,
as the retained source.** Target ~10 KB, replacing a 1.19 MB payload. `Sidebar.jsx`
continues to reference `ASSETS.logoFull` and is **not modified** — it is outside
the three-screen scope of D7.

---

# 2 — Chest-badge reconciliation — and a second finding

## 2a — The reconciliation cannot happen in the order D1 specifies

D1 requires:

> "Before optimization, reconcile the chest-badge discrepancy between
> `Cheerful_bear_in_futuristic_spacesuit.png` (badge variant) and
> `Cartoon_astronaut_bear_mascot_set.png` (IDYNIFY text on chest) — flag which is
> canonical **before committing**."

**I cannot do this.** Neither file is in the repository or in this session — only
the briefs were uploaded. I cannot compare two images I have never seen, and I
will not guess which badge treatment is canonical and call it a finding.

The instruction also contains an ordering conflict independent of me: reconcile
*before committing*, but reconciliation requires the files, and the files arrive
*by* committing.

**Proposed resolution — one extra step, no extra round trip:**

| Step | Who | Action |
|---|---|---|
| 1 | Aaron | Commit both originals at the §1 paths. Originals are canonical source assets per D1 — committing them is correct regardless of the reconciliation outcome, so nothing is being pre-empted |
| 2 | Team A | **Phase 3 pre-flight step 0.** Open both, compare the chest treatment, report the difference concretely — which mark, what size, what position, whether one is a newer revision |
| 3 | Aaron | Confirm canonical |
| 4 | Team A | **Then** optimize and build |

No derivative is generated and no pixel is committed to `public/` until step 3.
The intent of "reconcile before optimizing" is preserved exactly; only the
commit boundary moves, and it moves to the one place it can.

## 2b — The signup Barry has a white background, and the panel behind it is a gradient

This is a finding I can make from the brief alone, and it needs a decision.

The brief describes the signup asset as:

> `Cheerful_bear_in_futuristic_spacesuit.png` — **"clean, white BG"**, full body, thumbs up

and then, sixteen lines later:

> "Ensure transparent background is clean if needed for the right panel gradient overlay."

Those cannot both be satisfied by the same file. The right panel is specified as
a **deep blue → indigo → purple gradient**. A white-background PNG placed on it
renders as **a white rectangle sitting on the gradient** — not the composition in
the mockup.

Three ways out. Two need your authorization; one does not.

| Option | What it means | Verdict |
|---|---|---|
| **A — The asset already has alpha** and "white BG" describes how it was delivered for preview, not the file's actual background | Nothing to decide; build proceeds | ✅ Best case. **Verifiable in seconds once the file is committed** — Team A will report the alpha channel state as part of pre-flight step 0 |
| **B — Remove the background** to produce a transparent derivative | This is **modifying an approved brand asset**. The brief says "Do not redesign Barry… Do not substitute, recreate, or approximate." Background removal is none of those, but it is not nothing — a soft edge or a spacesuit highlight can be damaged by a careless cut | ⚠️ **Needs explicit authorization.** Team A will not do this unprompted |
| **C — Design around it** — Barry sits inside a light card/panel on the gradient, or a soft radial vignette bridges the two | No asset modification at all. But it changes the composition, and the mockup is the visual source of truth | ⚠️ Needs authorization; likely diverges from approved QA |

**Team A's recommendation:** wait for the file, confirm which case we are in
(A is genuinely likely), and only escalate if it turns out to be B or C. Flagging
now so it is not discovered mid-build.

---

# 3 — GCIP release procedure step

**Written and committed:** `docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md` (REL-AUTH-001).

Covers: exact before/after policy, why it is a release step rather than a code
change, blast radius, pre-flight, console execution steps, eight verification
checks, rollback, and an execution record to sign.

**One safety finding surfaced while writing it, and it is the reason the document
exists.**

GCIP exposes **two** enforcement modes:

1. **Enforce on sign-up and password change** — new passwords must comply. Existing users are untouched until they next change a password.
2. **Require on next sign-in** (force upgrade) — **every existing user is interrupted and made to change their password at their next login.**

D4 accepted exactly the first: *"existing users who next reset their passwords
will be subject to the new policy."*

Mode 2 sits next to mode 1 in the same console panel and is a materially larger
blast radius than was authorized — it would interrupt every currently paying user
on a sprint about the signup page. **The runbook calls it out in bold, and
verification check 7 is specifically "an existing user can still sign in with
their old non-compliant password" — the check that distinguishes the change you
approved from the one you did not.**

Rollback is a console revert, and because the checklist reads the live policy,
the UI follows automatically with **no code deploy** — so a bad release window
does not strand the product displaying rules that stopped being true.

### One design consequence of D4 worth knowing before build

`validatePassword(auth, password)` is **asynchronous and network-backed** — the
first call fetches the policy from the Identity Toolkit; subsequent calls use the
cached policy. So:

- `PasswordRequirements` warms the policy once on mount, then re-evaluates per keystroke against the cache. No per-keystroke network call.
- Until the policy resolves, the checklist renders in a neutral (unchecked, non-error) state rather than guessing. It never shows a rule it has not confirmed.
- If the fetch fails entirely, the field degrades to plain validation with no checklist — **never to a hardcoded checklist**, which would be exactly the false claim D4 forbids.
- Tests mock `validatePassword` (see §6), so no test hits the network.

**Verified:** `validatePassword` is present in the installed SDK
(`firebase@12.6.0`) — checked against `node_modules`, not assumed from docs.

---

# 4 — Files

### Modified

| File | Change | Risk |
|---|---|---|
| `src/pages/Signup.jsx` | Full rewrite against the approved composition. **Auth call sequence preserved verbatim** (§7) | Medium — mitigated by §6 tests |
| `src/pages/Login.jsx` | Re-skin onto `AuthLayout` (quiet variant). **`resolveMfaSignIn` and the entire MFA branch treated as untouched logic re-skinned** | Medium — MFA is the sharp edge |
| `src/pages/ForgotPassword.jsx` | Re-skin onto `AuthLayout` (quiet variant) | Low |
| `src/theme/tokens.js` | Add `BRAND.indigo = "#4f46e5"` per D6 | Low |
| `docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md` | Already committed | None |

### Created

| File | Purpose |
|---|---|
| `src/components/auth/AuthLayout.jsx` + `.css` | Two-panel desktop / stacked mobile; `variant="full" \| "quiet"` |
| `src/components/auth/AuthField.jsx` | Label + `for`/`id` + input + icon + `autocomplete` + inline validation + `role="alert"` error |
| `src/components/auth/PasswordField.jsx` | `AuthField` + show/hide toggle |
| `src/components/auth/PasswordRequirements.jsx` | Live checklist driven by the real GCIP policy |
| `src/components/auth/BrandMark.jsx` | IDYNIFY lockup, fallback pattern reused from `Sidebar.jsx:80-104` |
| `src/components/auth/WhyIdynify.jsx` | Below-fold four cards, lazy-loaded |
| `src/services/signupAnalytics.js` | D5 buffer-and-flush |
| `src/test/signup.test.jsx`, `login.test.jsx`, `forgotPassword.test.jsx`, `authComponents.test.jsx` | §6 |
| `public/assets/barry/*`, `public/assets/brand/*` | §1 derivatives |

### Explicitly NOT modified

`src/App.jsx` (no route changes — D2 removes the legal line, so no `/terms` or
`/privacy` route is created) · `src/firebase/config.js` · `src/utils/mfa.js` ·
`src/pages/CheckoutPage.jsx` · `CheckoutSuccessPage.jsx` · `firestore.rules`
(D5 explicitly) · `src/services/analytics.js` (extended by a new module, not
edited) · `src/components/layout/Sidebar.jsx` (outside D7 scope).

---

# 5 — Components and behaviour

### `AuthLayout`
Desktop ≥1024px: left panel 56% white / right panel 44% gradient
(`BRAND.navy → BRAND.indigo → BRAND.purple`). Below 1024px: single column, form
first, **Barry demoted beneath the form** so he can never push the CTA below the
fold. `variant="quiet"` renders the gradient panel without Barry or the speech
card, for Login and Forgot Password.

**D2 — legal line removed.** Per the decision, no legal text and no placeholder
links ship. The layout reserves the slot below the CTA as a bottom margin sized to
hold two lines of 13px copy, so **LEGAL-001** reinstates the line by rendering
into existing space — no reflow, no redesign.

### `AuthField`
Accessibility is a **property of the component, not a per-screen fix**: `id` is
generated with `useId()` and `htmlFor` is wired from it, so a field cannot be
rendered unlabelled. `autocomplete` is a **required prop** — omitting it is a
lint-visible mistake, not a silent regression. Errors get `role="alert"` +
`aria-live="polite"` + `aria-describedby`, and set `aria-invalid`. Every
interactive target ≥44×44 (today's footer links measure 20px tall).

Email: `label="Email"`, `placeholder="you@company.com"`,
`autocomplete="email"`, `type="email"`. Validation fires **after meaningful
interaction, not on first blur**, per the brief. Error: *"Enter a valid email
address."* Consumer domains accepted (Q5b).

### `PasswordField`
`autocomplete="new-password"` on signup, `current-password` on login. Toggle is a
real `<button type="button">` with `aria-label` that reflects state
("Show password" / "Hide password"), keyboard reachable, inside the tab order,
never inside the input's label. Default hidden. **No confirm-password field** —
Firebase never receives a second value, so it is not "technically required".

### `PasswordRequirements`
See §3. Renders only rules the live policy actually enforces.

### `BrandMark`
Reuses the `Sidebar.jsx:80-104` `onError` fallback pattern verbatim. `<picture>`
with WebP → PNG. If an official vector lands later (D3), it swaps by changing one
source list — nothing else in the tree knows the format.

### CTA
"Create account →", full width, 56–60px, `linear-gradient(135deg, BRAND.pink,
BRAND.purple)` — the product's existing primary, not a new gradient. Loading:
"Creating your account…" + spinner, `disabled` for the duration. **Duplicate
submission blocked by both the disabled attribute and an in-flight guard in the
handler** — the attribute alone is a race.

### Error mapping (brief + N6)
`email-already-in-use` → *"An account already exists with this email."* + an
inline **Sign in** link (a real link, not plain text) · `invalid-email` ·
`weak-password` → *"Choose a stronger password."* · **`network-request-failed`**
→ *"Connection issue — check your internet and try again."* (N6) · default →
*"Something went wrong. Please try again."* No raw Firebase codes surface. **Form
values are never cleared** — already true today and preserved.

### Motion
All animation inside `@media (prefers-reduced-motion: no-preference)`, matching
the seven shell CSS files that already do this and the four pre-auth pages that
do not. Barry fades/slides in once; speech card follows; CTA hover shifts; arrow
moves 2–4px. **No continuous animation.** The 200-div starfield is not carried
over.

---

# 6 — Tests

Vitest + jsdom + Testing Library, per `vite.config.js:7-12` and
`src/test/setup.js`. Firebase mocked with the established convention —
`vi.mock('../firebase/config')` + `vi.mock('firebase/auth')` — as in
`src/test/canonicalRoutes.test.jsx:25-38`. **No test touches the network**;
`validatePassword` is mocked to return a policy fixture.

Written **before** the rewrite lands, against today's behaviour, so they fail if
the rebuild changes it. That ordering is the whole point: there is currently
**zero** auth-page coverage.

| # | Test | Guards |
|---|---|---|
| 1 | Signup renders: wordmark, headline, both fields, CTA | Composition |
| 2 | Every input has an accessible name via `for`/`id`; `getByLabelText` resolves all | The CRITICAL a11y failure in the audit |
| 3 | `autocomplete` is `email` / `new-password` | WCAG 1.3.5; password managers |
| 4 | Invalid email → *"Enter a valid email address."*, `role="alert"`, `aria-describedby` wired | Announced errors |
| 5 | Checklist reflects the **mocked policy**, not hardcoded text; updates per keystroke | D4 — cannot display unenforced rules |
| 6 | Policy fetch failure → no checklist, no false claims, field still usable | D4 degradation |
| 7 | Show/hide toggles `type` password↔text; `aria-label` follows state; keyboard operable | Brief requirement |
| 8 | Two rapid CTA presses → `createUserWithEmailAndPassword` called **once** | Duplicate submission |
| 9 | Auth rejects → form values survive; specific message shown; `email-already-in-use` renders a real Sign-in link | "Do not wipe the form" |
| 10 | **`?tier=pro` → `setDoc` receives `selectedTier: 'pro'`, `subscriptionTier: 'pro'`, `credits: 1250`; redirect is `/checkout?tier=pro`** | **The sprint's most important regression guard** |
| 11 | **`?tier=starter` and no-param → `'starter'`, `credits: 400`, `/checkout?tier=starter`** | Same, both other paths |
| 12 | `setDoc` payload shape is **byte-identical** to today's — same keys, `credits` still a **number** | Credits schema debt must not shift |
| 13 | Welcome-email rejection does **not** block `navigate` | Fire-and-forget |
| 14 | Login renders; email/password sign-in calls `signInWithEmailAndPassword` and navigates | No auth regression |
| 15 | **`auth/multi-factor-auth-required` → MFA form appears; code submit calls `resolveMfaSignIn` unchanged** | The sharpest edge in the sprint |
| 16 | Forgot Password renders; submit calls `sendPasswordResetEmail`; success state shown | Third screen |

Test 10 exists because it is the exact failure mode the redesign invites: the UI
stops mentioning tier, so nothing visible breaks when the parameter stops flowing
— and a Pro customer silently becomes Starter.

---

# 7 — Confirmation: no new authentication architecture has appeared

Re-verified at plan time, not carried over from Phase 1.

**Method.** Repository-wide search of `src/`, `netlify/` and `functions/` for
every federated, passwordless and custom-token entry point:
`GoogleAuthProvider`, `OAuthProvider`, `SAMLAuthProvider`, `OIDC`,
`signInWithPopup`, `signInWithRedirect`, `linkWithPopup`,
`sendSignInLinkToEmail`, `isSignInWithEmailLink`, `signInWithCustomToken`.

**Result: 0 matches.** `origin/main` is unchanged since Phase 1 discovery
(`6027519`), and no auth file differs between this branch and main.

**The complete `firebase/auth` surface in use — ten APIs, all of them first-party
email/password or TOTP MFA:**

```
getAuth · onAuthStateChanged · createUserWithEmailAndPassword
signInWithEmailAndPassword · sendPasswordResetEmail · signOut
multiFactor · TotpMultiFactorGenerator · TotpSecret · getMultiFactorResolver
```

`sendEmailVerification` exists in the SDK and is **not imported anywhere** — no
verification is sent or required today, and this sprint does not change that
(D7).

**This plan adds one API and no architecture:** `validatePassword`, which is a
**read** of the project's configured password policy. It creates no identity, no
credential, no session, and no provider. The signup call sequence
(`createUserWithEmailAndPassword` → `setDoc` → welcome email → redirect) is
preserved exactly, with the single change D4 authorized: the welcome email
becomes genuinely non-blocking.

✅ **Confirmed: no new authentication architecture has appeared, and this plan
introduces none.**

---

# 8 — Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **`?tier=` silently dropped** — invisible in the UI by design after this sprint | Medium | Tests 10–11; Phase 5 checks the Firestore document for both paths |
| **MFA branch regressed while re-skinning Login** | Medium | Test 15; `resolveMfaSignIn` and `utils/mfa.js` not touched |
| **Checklist ships before the GCIP policy** | Medium | Runbook §2 requires same-window execution — and because the checklist reads the live policy, the failure mode is "shows the old rule", not "shows a false rule" |
| **Force-upgrade mode enabled by accident** | Low / **severe** | Runbook §3 and verification check 7 |
| **Barry's white background** (§2b) | Unknown until the file lands | Pre-flight step 0 reports alpha state before any build work |
| **Credits schema shape shifts** | Low | Test 12 asserts byte-identical `setDoc` payload; debt documented, not fixed |
| **Wordmark derivation drifts from canonical** | Low | Derived from the existing PNG by resampling only — no redraw, no re-tracing. Original retained per D3 |
| **Below-fold section slows first paint** | Low | Lazy-loaded; AVIF/WebP; the 1.19 MB wordmark is retired from the render path |

---

# 9 — Phase 3 gate

| Gate condition (from the authorization) | Status |
|---|---|
| Barry + mockup assets committed at confirmed paths | ⬜ **Awaiting Aaron** — paths in §1 |
| D2 legal line removal confirmed in the plan | ✅ §5 — removed, space reserved, tracked as LEGAL-001 |
| GCIP release procedure step documented | ✅ §3 — `docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md` committed |
| Final plan reviewed, no new auth architecture | ✅ §7 — 0 matches, verified at plan time |

### Open decisions

| # | Decision | Blocks |
|---|---|---|
| **P1** | **Commit the two Barry originals so the chest-badge reconciliation can happen** (§2a). Sequencing only — the reconciliation itself is unchanged, it just has to follow the commit rather than precede it | Pre-flight step 0, then optimization |
| **P2** | **If the signup Barry has an opaque white background** (§2b): authorize background removal, or authorize a composition change? | The right panel |

P2 may resolve itself — if the file carries alpha, there is nothing to decide,
and Team A will confirm which case it is within minutes of the commit.

---

**Phase 2 complete. No code written, no production behaviour changed, no assets
modified. Phase 3 build awaits asset commit and P1–P2.**
