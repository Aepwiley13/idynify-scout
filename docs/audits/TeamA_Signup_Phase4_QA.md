# TEAM A — Signup Rebuild, Phase 4 Visual QA

**Against:** Phase 3 Review / Phase 4 Authorization (Aug 13, 2026)
**Branch:** `claude/team-a-29qz5h`
**Status:** QA complete, recapture done against the live policy.
**Reference:** `docs/design/signup-mockup-approved.png` — the single visual reference.

> **REL-AUTH-001 is live.** The password section has been recaptured against the
> real configuration — see §1b. One discrepancy was found in the live config and
> raised as **#546**; it does not affect behaviour today.

---

## Summary

| Check | Result |
|---|---|
| Composition vs. approved mockup | ✅ Matches; 10 divergences, all mapped to a decision (§4) |
| Breakpoints 1440 / 1280 / 1024 / 768 / 430 / 390 / 375 / 320 | ✅ No horizontal scroll, no clipping, no undersized targets |
| Reduced motion | ✅ **Zero** animated elements when the preference is set |
| 200% zoom | ✅ Reflows, no horizontal scroll |
| Keyboard open | ✅ **Closed** by the authorized sticky CTA — §5b |
| Error states | ✅ Announced, actionable, form preserved |
| REL-AUTH-001 | ✅ Live, recaptured — §1b. ⚠️ config discrepancy raised as **#546** |
| Barry provenance | ✅ §2 |
| Welcome email fire-and-forget | ✅ §3 |
| Pre-existing failures | ✅ Issue **#545** opened |

**The keyboard-open case took three attempts and the first two looked fine in the
metrics.** It failed its criterion on first measurement (§5); tightening the
mobile rhythm reduced it but left 105px on a 375px SE; the sticky CTA authorized
in the Phase 4 review closes it entirely (§5b) — after a first build that pinned
the CTA on top of the password field while reporting "fully visible" the whole
time. Only the screenshot caught it.

---

# 1 — REL-AUTH-001, before execution *(superseded by §1b)*

Kept for the record. **Status at the time: ⬜ NOT RUN.** Two independent reasons:

1. **No console access, by design.** The runbook assigns execution to Aaron:
   *"Team A does not have and should not have console access."* Changing a
   production authentication setting is not something this sprint should be able
   to do unilaterally.
2. **This environment cannot reach the endpoint.** `validatePassword()` fires the
   correct request — verified in the browser:
   `GET https://identitytoolkit.googleapis.com/v2/passwordPolicy?key=…` — and it
   never completes here, because outbound egress is filtered. The component
   therefore renders **no checklist at all**, which is the specified failure mode
   working exactly as intended.

**So, per your instruction, every screenshot in this report is labelled
"simulated post-policy state."** The policy response is stubbed with precisely
what identitytoolkit will return once the console change lands:

```json
{ "customStrengthOptions": { "minPasswordLength": 8,
    "containsUppercaseCharacter": true, "containsLowercaseCharacter": true,
    "containsNumericCharacter": true },
  "enforcementState": "ENFORCE", "forceUpgradeOnSignin": false }
```

Note `"forceUpgradeOnSignin": false` — the stub encodes the mode you authorized,
not the one you didn't.

### What still has to happen, in order

1. Aaron executes **REL-AUTH-001** (`docs/releases/RELEASE-GCIP-PASSWORD-POLICY.md`)
2. **Verification check 7 immediately after** — an existing user whose current
   password does not satisfy the new policy signs in successfully. This is the
   check that distinguishes the authorized change from the unauthorized one, and
   it is mandatory before the sprint closes.
3. Team A recaptures the password section against the real policy and replaces
   the simulated screenshots.

**Until step 1 lands, the shipped page will display the policy that is actually
in force** — Firebase's default 6-character minimum, shown as "6+ characters".
That is truthful, not broken: the checklist mirrors the console, so it is correct
before and after, and the transition needs no deploy. It simply will not match
these screenshots until the console change is made.

---

# 1b — Recapture against the live policy

**REL-AUTH-001 is live.** Fetched directly from the endpoint, three times, stable:

```json
{
  "customStrengthOptions": {
    "minPasswordLength": 8,
    "maxPasswordLength": 4096,
    "containsLowercaseCharacter": true,
    "containsUppercaseCharacter": true,
    "containsNumericCharacter": true,
    "containsNonAlphanumericCharacter": false
  },
  "enforcementState": "OFF",
  "forceUpgradeOnSignin": true,
  "schemaVersion": 1
}
```

## ✅ All three displayed rules originate from the live configuration

Driven by the **verbatim live response body**, so the SDK performs its real
REST-name → SDK-name conversion on the real payload:

| Password | Checklist |
|---|---|
| *(empty)* | 8+ characters ✗ · Upper & lowercase letters ✗ · At least one number ✗ |
| `abcdefgh` | 8+ characters **✓** · Upper & lowercase ✗ · number ✗ |
| `Abcdefg1` | **✓ ✓ ✓** |

Nothing is hardcoded: `minPasswordLength: 8` produces "8+ characters", and the
case row appears only because both `containsUppercaseCharacter` and
`containsLowercaseCharacter` are true in the live policy. Change the console and
the checklist follows with no deploy.

**Notify mode does not change what the checklist shows.** It reads
`customStrengthOptions`, which Notify and Require both populate identically —
now confirmed empirically against a live `enforcementState: "OFF"` response.

## ⚠️ `forceUpgradeOnSignin` is `true` in the live config — raised as #546

The release note records *"Force upgrade on sign-in: OFF"*. The live endpoint
reports `true`.

**Nothing is broken today, and check 7 passing is consistent with this.** With
`enforcementState: "OFF"` nothing is enforced, so the flag is inert and no
existing user is affected.

**It matters for what comes next.** The flag is inert *because* enforcement is
off — and flipping enforcement to Require, which is exactly what AUTH-POLICY-002
exists to evaluate, is what would activate it. At that moment every existing user
with a non-compliant password would be forced to reset at next sign-in: the
outcome the sprint was explicit about never causing, arriving as a side effect of
a change nobody intended to be about existing users. The two settings the release
note describes as separate are currently coupled in the live config.

Tracked as a blocking precondition on **#546**. Set it to `false` and re-fetch
before evaluating Require.

## How this was captured, precisely

`curl` reaches the endpoint through the agent proxy and returns HTTP 200. **The
browser cannot**: Playwright's Chromium verifies certificates through an NSS
store that does not carry the proxy CA, so the intercepted TLS connection is
reset (`ERR_CONNECTION_RESET`). The CA is present and valid in the system store,
but `certutil` is not available to add it to NSS, and disabling certificate
verification is not an acceptable workaround.

So the screenshots replay the **verbatim live response bytes** into the browser
rather than a composed fixture. Only the network hop is simulated; the payload,
the SDK conversion and the render path are all real. That is a materially
stronger claim than the earlier stub, and weaker than a true end-to-end capture —
stated plainly so it can be judged rather than assumed.

**A genuine end-to-end browser capture needs an environment with outbound egress
to `identitytoolkit.googleapis.com`.** See §8 — the same constraint applies to
Phase 5 and is worth settling before that phase starts.

### Documentation correction, applied

Per the release note, this release is **not** described as enforcing stronger
passwords at the Firebase auth boundary. The accurate description, used
throughout:

> **Password-strength guidance enabled through the live GCIP policy. Hard
> enforcement deferred.**

Firebase in Notify mode will still accept a non-compliant password at the API.
The client-side checklist is guidance, and `PasswordRequirements` was already
built on that assumption — `onValidityChange` reports guidance, never gates
submission, and the server remains the authority.

---

# 2 — Barry derivative: provenance

Asset provenance, not a design review.

| Confirmation | Evidence |
|---|---|
| **Canonical source untouched** | `docs/design/source/barry-signup-source.png`, MD5 `0a4265e163c02f9e43fdcc3714d93998` — byte-identical to the file committed at `476ea42`, and touched by no commit since. Verified after the build, not before. |
| **Original alpha state** | **Baked-in white.** 1,573,520 of 1,573,520 pixels fully opaque; **0** transparent, **0** partially transparent. 63.96% of pixels are opaque near-white (all channels > 245). Every border sample reads ~`rgba(254,254,254,255)`. |
| **Only the derivative was modified** | Source is read-only input. All output went to `public/assets/barry/`. |
| **Design not altered** | See below. |

### The transformation, exactly

**Pass 1 — flood fill from the canvas border**, through pixels whose darkest
channel is ≥ 186, four-way connectivity. Background is defined as *light and
reachable from the edge*, never as *light*. That distinction is the whole
method: Barry's spacesuit, gloves highlights and boots are white, and a
brightness key would have erased them. The fill cannot reach them without
crossing the bear's dark outline.

**Pass 2 — un-matte the feathered band against white.** The source was
composited over white, so each edge pixel satisfies `src = fg·α + 255·(1−α)`,
which inverts exactly to `fg = (src − 255·(1−α)) / α`. Without this step the fur
silhouette keeps white-blended colour at partial alpha and glows against the
dark panel.

**Pass 3 — trim** to the content bounding box: 1105×1424 → 735×1309, discarding
only whitespace.

**Pass 4 — resample** to 640×1140 (aspect ratio preserved to sub-pixel) and
encode: AVIF q60 · WebP q82 · PNG palette, served through `<picture>`.

| Counter | Value |
|---|---|
| Pixels set fully transparent | 992,720 |
| Pixels feathered (partial alpha) | 17,472 |
| Of those, colour-corrected | 17,081 |
| Interior pixels altered | **0** — no pixel inside the figure was touched by passes 1–3 |

### Face, suit, proportions, chest treatment

**Unaltered.** No crop of the figure, no recolour, no redraw, no retouch, no
warp. Aspect ratio preserved. The only operation reaching the figure is the
Pass-4 resample, which is a uniform scale to render size.

The **rotated chest badge is intact** — the IDYNIFY activated state you
confirmed in the Phase 2 response. Visible in every screenshot.

**One thing I checked so it is not mistaken for damage:** there is a cyan rim
light along the left edge of Barry's fur. I verified it against the untouched
source on its native white background — **it is in the original artwork**, a
deliberate rim light, not a matting artifact.

| Output | Size |
|---|---|
| `barry-signup.avif` | **56.4 KB** (under the 80 KB target) |
| `barry-signup.webp` | 87.6 KB |
| `barry-signup.png` | 175.8 KB (last-resort fallback) |

---

# 3 — Welcome email: fire-and-forget confirmed

**Confirmed. The approved behaviour is in place.**

`src/pages/Signup.jsx`, in order:

| Line | Operation | Awaited? |
|---|---|---|
| 109 | `await createUserWithEmailAndPassword(auth, email, password)` | ✅ yes |
| 119 | `await setDoc(doc(db, 'users', uid), {...})` | ✅ yes |
| **135** | `fetch('/.netlify/functions/send-welcome-email', {...})` | ❌ **no `await`** |
| 139 | `.catch(err => console.error('[signup] welcome email failed to send', err))` | — |
| 146 | `navigate(`/checkout?tier=${tier}`)` | — |

The `fetch` is issued and its promise is dropped. Navigation does not depend on
it, so **Resend latency cannot delay checkout and Resend failure cannot prevent
it.** The previous implementation awaited this call despite a comment on the line
above claiming it did not.

**Failure logging is preserved** — an explicit `.catch` with a `[signup]`-tagged
`console.error`, so a systemic Resend outage is diagnosable rather than silent.

**Pinned by test 13**, "reaches checkout even when the email service is failing":
`fetch` is mocked to reject, and the test asserts the user still lands on
checkout. It fails if anyone re-adds the `await`.

---

# 4 — Annotated mockup comparison

Side-by-side artifact: `docs/design/qa/mockup-comparison.png`.

| # | In the mockup | Built | Authorized by |
|---|---|---|---|
| 1 | Google + Microsoft SSO buttons | Removed | **Q5** — Phase 2 authorization |
| 2 | `or` divider | Removed | **Q5** |
| 3 | "Your AI-powered sales engine is a few minutes away" | "Know who matters, why they matter, and what to do next." | **N3** / frozen positioning |
| 4 | "I'm your AI SDR… Let's build your sales engine." | Frozen Barry card copy, verbatim | **N4** |
| 5 | "Enterprise-grade security / Your data is always protected" | Removed | Security decision, **Option C** |
| 6 | "By continuing, you agree to our Terms of Service and Privacy Policy" | Removed; space reserved | **D2** — LEGAL-001 |
| 7 | HubSpot · Google · Palo Alto · Segment · Calendly + star rating | Removed entirely | Brief §Social proof — unverified |
| 8 | "Your AI SDR, Always On" card | "Barry connects the dots" | Brief §Below-fold copy table |
| 9 | Top-left: ID badge + plain black type | Canonical neon wordmark | **Aaron §6** — "use the full wordmark" |
| 10 | "Work Email" label | "Email" | **Q5b** |
| 11 | Barry drawn into a scene with a grid floor | Delivered PNG, background removed | **A1** — the mockup's Barry is generated art, not this asset placed on a gradient |

### What matches

Two-panel split with the curved divider · white left / gradient right ·
headline with "IDYNIFY" in the accent · field styling with leading icons and the
reveal eye · requirement checklist with tick circles · full-width gradient CTA
with trailing arrow · "Already have an account? Sign in" · Barry lower-right
with the speech card above him and its pointer aimed down · four-card below-fold
section.

### Reading the criterion

Six authorized removals take out roughly 40% of the mockup's left-panel content
and its entire bottom band, so **the built page is visibly shorter and more
spacious than the mockup, by design.** "Closely matches" is met on composition
and system, not on content inventory.

---

# 5 — Breakpoints and states

Password pre-filled with a compliant value so the checklist state is visible.
`?tier=pro` throughout, to confirm the tier is invisible.

| Width | H-scroll | Doc height | CTA top | Barry below CTA | Checklist | Undersized targets |
|---|---|---|---|---|---|---|
| 1440 | ✅ none | 1381 | 666 | n/a (side panel) | 3/3 met | 0 |
| 1280 | ✅ none | 1381 | 666 | n/a | 3/3 | 0 |
| 1024 | ✅ none | 1400 | 648 | n/a | 3/3 | 0 |
| 768 | ✅ none | 2131 | 587 | ✅ yes | 3/3 | 0 |
| 430 | ✅ none | 2345 | 506 | ✅ yes | 3/3 | 0 |
| 390 | ✅ none | 2345 | 506 | ✅ yes | 3/3 | 0 |
| 375 | ✅ none | 2367 | 506 | ✅ yes | 3/3 | 0 |
| 320 | ✅ none | 2457 | 506 | ✅ yes | 3/3 | 0 |

No clipping, no overlap, Barry never above the form on mobile. Compare the old
page, which had the Early Access badge colliding with both HUD corners at every
width from 320 to 640 and the radar overlapping the card up to 768.

### Reduced motion — ✅ zero animated elements

With `prefers-reduced-motion: reduce`, enumerating every element whose computed
`animation-name` is not `none` returns **`[]`**. Every animation is opt-in behind
`@media (prefers-reduced-motion: no-preference)`. The spinner is the deliberate
exception, degrading to an opacity pulse — it is feedback, not decoration, and
must survive.

### 200% zoom — ✅

720 CSS px at 2×: `scrollWidth 720 = clientWidth 720`. Reflows, no horizontal
scroll. WCAG 1.4.10 satisfied.

### Keyboard open — ✅ closed by the authorized sticky CTA

**Updated after the Phase 4 review authorized a sticky mobile CTA.** The
measurements immediately below are the *pre-fix* state, kept because they are
what the decision was made on. The post-fix state is §5b.

#### Pre-fix measurements

This is the one criterion that is not fully met, and the numbers are below rather
than summarised away. Measured with the password field focused and a realistic
keyboard height subtracted from the visible band:

| Device | Band above keyboard | CTA below fold — before | after tightening |
|---|---|---|---|
| iPhone 14 Pro Max 430×932 | 582px | 22px | ✅ **0 — fully visible** |
| iPhone 14 390×844 | 508px | 96px | **54px** |
| Android 360×800 | 480px | 107px | **82px** |
| iPhone SE 375×667 | 407px | 113px | **105px** |

Where the browser shrinks the *layout* viewport (Android Chrome, and landscape),
a height-scoped media query tightens the rhythm further: **31px** on Android at
360×480, **3px** at 390×508.

**What was changed:** vertical rhythm only — panel padding, head margins, title
size, form gap, checklist spacing. **No content was removed.**

**Why it is not zero.** Closing the remaining 105px on a 375px SE would mean
deleting the subheading or the requirement checklist — both approved content, and
not Team A's call. Against the old page, where the CTA sat roughly 823px below
the fold, a 54–105px scroll is a different category of problem. **Flagged rather
than fixed, and available if you want it:** a sticky mobile CTA would close it
entirely, but that is a composition change beyond the approved mockup.

**One caveat worth stating:** iOS Safari does not resize the layout viewport when
the keyboard opens, so the height-scoped query does not fire there. The iPhone
figures above are the conservative case and assume it does not.

---

# 5b — Sticky CTA (authorized in the Phase 4 review)

**Result: the CTA is fully visible above the keyboard on every device measured,
including the 375px SE that was 105px short.**

| Device | Band above keyboard | Pre-fix | Post-fix |
|---|---|---|---|
| iPhone SE 375×667 | 407px | 105px below fold | ✅ **fully visible** |
| iPhone 14 390×844 | 508px | 54px | ✅ **fully visible** |
| iPhone 14 Pro Max 430×932 | 582px | 0 | ✅ fully visible |
| Android 360×800 → 360×480 | 480px | 82px | ✅ **fully visible** |
| Landscape 844×390 | 390px | 121px | ✅ **fully visible** |
| No keyboard, any size | — | fine | ✅ unchanged, not pinned |

Desktop is untouched: at 1440px the dock computes to `position: static`.

## How it works, and why it is not fragile

**Sticky, not fixed.** The CTA stays in normal flow, in normal tab order, and in
the form it submits. It pins only when it would otherwise be out of reach and
releases as soon as it would not. A fixed bar would float permanently, cover
content at every scroll position, and mean shipping the primary action twice.

**One CSS rule covers both platforms:**

```css
bottom: calc(var(--auth-kb-inset, 0px) + 12px);
```

- **Android Chrome** shrinks the *layout* viewport when the keyboard opens, so
  `bottom: 0` is already above it and the inset resolves to ~0.
- **iOS Safari** leaves the layout viewport at full height, so `bottom: 0` would
  sit *behind* the keyboard. The inset lifts it clear.

**`--auth-kb-inset` is read from `window.visualViewport`** — 15 lines in
`useKeyboardInset()`. This is deliberately **not** the fragile keyboard detection
the review warned against: no user-agent sniffing, no height thresholds, no
focus/blur guessing. `visualViewport` is the standard API whose entire purpose is
reporting the actually-visible region, and it is the only mechanism that works on
iOS at all. Where it is unsupported, no listener is attached, the inset stays 0,
and the CTA behaves exactly as it does on Android.

## The bug this fix introduced, and how it was caught

**The first build made things worse.** The dock has an opaque background so
pinned content stays legible — and on a 407px band, what it pinned over was the
password field the user was typing into. The CTA sat on top of the input. That is
a worse failure than the scroll it replaced, and it was invisible in the metrics:
"CTA fully visible" was `true` the whole time. Only the screenshot showed it.

**Fix:** `scroll-margin-bottom` on the inputs. When the browser scrolls a focused
field into view it now reserves space below it, so the field, its checklist and
the pinned CTA all land in the band instead of stacking.

**And the first value was wrong too.** At 160px the CTA cleared the input but
clipped the last requirement row in half — "At least one number" cut through the
middle, which reads as a rendering bug rather than a deliberate overlay. 190px
clears the checklist as well: 72px list + 11px gap + 15px form gap + 56px CTA +
~34px dock padding and offset.

Verified with an explicit overlap test — the CTA's box against the password
input's box and against the checklist's box — on all six configurations. Both are
`false` everywhere.

## Known limitation — iOS Safari

Documented per the review, not a blocker.

iOS Safari does not resize the layout viewport when its keyboard opens, so:

- Height-scoped media queries (`@media (max-height: …)`) do **not** fire there.
  The rhythm tightening from §5 applies on Android and in landscape but not on an
  iPhone with the keyboard up.
- The sticky offset on iOS depends entirely on `visualViewport`. It is supported
  in all current iOS versions, but if it were ever unavailable the CTA would
  degrade to `bottom: 12px` — behind the keyboard, i.e. the pre-fix behaviour.
  Nothing breaks; the improvement is simply absent.
- **Chrome on iOS is WebKit**, so it shares Safari's behaviour exactly. The
  review asks for verification on "Android and Chrome on iOS" — worth noting
  those are not two independent engines. Chrome-on-iOS results will match Safari,
  and Android Chrome is the only genuinely separate case.

The measurements above cover both engine behaviours: the "layout viewport
shrinks" rows are the Android case, the "inset does the work" rows are the
WebKit case.

## Coverage

Two tests added (35 total, all passing): the CTA is wrapped in the dock, and it
remains inside the form, `type="submit"`, and in normal tab order — so a future
change to `position: fixed` or a detached bar fails the suite.

### Error states

| Case | Behaviour |
|---|---|
| Duplicate email | *"An account already exists with this email. **Sign in instead**"* — `role="alert"`, a real `<a href="/login">`, and the typed email preserved (verified: `taken@example.com` still in the field) |
| Invalid email | *"Enter a valid email address."* — `role="alert"`, `aria-invalid="true"`, linked by `aria-describedby`. Does not fire on first blur through an empty field |
| Network failure | *"Connection issue — check your internet and try again."* |
| Unknown | *"Something went wrong. Please try again."* — no raw Firebase code ever surfaces |

### Quiet variant

Sign in and Forgot Password captured at 1440 and 390, plus the sign-in error
state. Same system, no Barry, no below-fold section. The MFA branch is
re-skinned logic — `resolveMfaSignIn` untouched — pinned by tests 15 and 16.

---

# 6 — Screenshot index

Committed to `docs/design/qa/`:

```
mockup-comparison.png          annotated side-by-side, 11 divergences
signup-1440.png   signup-1280.png   signup-1024.png   signup-768.png
signup-430.png    signup-390.png    signup-375.png    signup-320.png
reduced-motion-1440.png        zero animations
zoom-200.png                   720 CSS px at 2x
keyboard-open-390x400.png      short-viewport state
sticky-cta-ios-se-keyboard.png   CTA pinned above a simulated iOS keyboard, 375x667
sticky-cta-ios-14-keyboard.png   same, 390x844
sticky-cta-android-keyboard.png  Android, layout viewport shrunk to 360x480
error-duplicate-email.png      alert + inline sign-in link
error-invalid-email.png        field-level validation
login-1440.png   login-390.png   login-error-1440.png
forgot-1440.png  forgot-390.png
```

All signup captures show the **simulated post-policy state** (§1).

---

# 7 — Pre-existing test failures

**Issue #545 opened**, as instructed. Not fixed here.

Reproduced on an unmodified tree by stashing every rebuild change:
`2 files failed, 5 tests failed, 22 passed` — identical to the result with the
rebuild applied.

- `HunterContactCard` × 1 — a literal `"3 days ago"` assertion that looks time-dependent
- `ReconSectionEditor` × 4 — `window.matchMedia` is not implemented in jsdom, so
  `ReconSectionEditor.jsx:119` throws in a `useState` initializer and the whole
  block fails at mount

The fix for the four is a `matchMedia` stub in `src/test/setup.js` — a global
test-environment change touching all 52 test files, which is exactly why it does
not belong inside this sprint.

Signup rebuild suite: **33 passed, 0 failed.** Full suite: **1126 passed, 5 failed** — those five.

---

# 8 — Phase 5 readiness, and one environment constraint to settle first

## The constraint

Phase 5 requires creating real accounts and reading the resulting Firestore
documents. Reachability to Firebase from this environment was tested rather than
assumed:

| Client | Reaches `identitytoolkit.googleapis.com` |
|---|---|
| `curl` (via the agent proxy) | ✅ HTTP 200 |
| Node `fetch` (no proxy needed) | ✅ HTTP 200 |
| **Playwright Chromium** | ❌ fails via the proxy *and* with `--no-proxy-server` |

**So a browser-driven end-to-end signup cannot be performed here.** That is the
same constraint that forced the §1b replay, and it needs a decision before
Phase 5 starts rather than three steps into it.

Two viable routes:

**A — Node-hosted integration run.** Mount the real `Signup.jsx` in jsdom wired
to the **real Firebase SDK against the real project** instead of mocks. Node can
reach Firebase, so this executes the actual component code — the real `?tier=`
read, the real `setDoc` payload — creates real accounts, and reads the documents
back for assertion. It verifies everything Phase 5 asks about except browser
rendering, which Phase 4 already covered. It does write real accounts to the
project.

**B — Aaron runs it in a browser** against a normal environment, with Team A
supplying an exact click-by-click script and the assertions to check.

Team A recommends **A** for the Firestore assertions, because inspecting the
written document directly is stronger evidence than reading a URL bar, with **B**
for the interaction checks that need a real browser (keyboard-only flow, sticky
CTA on real devices, show/hide). `[NEEDS AARON]` — A creates accounts in a live
project, which is not something to start unasked.

## What gets verified either way

Automated coverage exists (tests 10, 11, 12) and the review is explicit that a
passing suite is necessary but not sufficient, so all three paths need
verification against a real Firebase project:

```
?tier=pro     → users/{uid}.selectedTier = 'pro',     credits = 1250 → /checkout?tier=pro
?tier=starter → users/{uid}.selectedTier = 'starter', credits = 400  → /checkout?tier=starter
no param      → starter, unchanged from the pre-rebuild baseline
```

Plus, from §1, **verification check 7** — an existing user with a non-compliant
password can still sign in — immediately after REL-AUTH-001.

---

# 9 — Signoff blockers

| # | Item | Status |
|---|---|---|
| ~~1~~ | ~~Execute REL-AUTH-001, then verification check 7~~ | ✅ **Done** — live, check 7 passed |
| ~~2~~ | ~~Recapture the password section against the real policy~~ | ✅ **Done** — §1b |
| **3** | `forceUpgradeOnSignin: true` in the live config | ⚠️ **#546** — no behavioural impact today, blocks Notify → Require |
| **4** | How Phase 5 runs, given the browser cannot reach Firebase here | `[NEEDS AARON]` — §8 |

Items 1 and 2 are closed. **Phase 4 is complete from Team A's side.** Item 3 is
tracked and does not block signoff. Item 4 blocks Phase 5, not Phase 4.

~~Item 3 — sticky CTA decision~~ **Resolved.** Authorized in the Phase 4 review
and implemented; see §5b.

---

**No production behaviour changed in Phase 4.** The code changes are mobile
presentation only: vertical rhythm and the sticky CTA dock in `AuthLayout.css`,
the `useKeyboardInset()` hook in `AuthLayout.jsx`, and a wrapper `<div>` around
the CTA on the three auth pages. No content, no copy, no routing, no data, no
authentication.
