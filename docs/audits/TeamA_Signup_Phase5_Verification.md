# TEAM A — Signup Rebuild, Phase 5 Functional Verification

**Method:** Option 4 — Node for data, Aaron for interaction.
**Project:** `idynify-scout-dev`
**Status:** Node-side complete. **M1, M2, M3 (bar real hardware), M4, M5, M6, M8 executed and passed.** M7 and real-device M3 need a human.
**Harness:** `scripts/phase5-verification.mjs` (manual, one-shot — deliberately outside the test-file pattern so CI never runs it)

---

## Result

**33 assertions across three tier paths. All passed.**

The harness mounts the **real `Signup.jsx`** — no mocks — against the **real Firebase project**, fills the real form, presses the real button, and reads the resulting document back with the SDK. The `?tier=` read, the payload construction and the redirect are all the page's own code.

A browser would have been the other way to do this; Chromium cannot reach Firebase from the QA environment while Node and curl can, which is why it runs headless in jsdom. The checks that genuinely need a browser are Aaron's half (§5) and are **not** claimed here.

---

# 1 — `?tier=pro`

Account: `phase5+pro-1786734001763@idynify.com` · uid `2Qf1YC2o1fgLLVRJoqzV4K87wY52`

```json
{
  "email": "phase5+pro-1786734001763@idynify.com",
  "createdAt": "2026-08-14T19:00:02.440Z",
  "selectedTier": "pro",
  "subscriptionTier": "pro",
  "status": "pending_payment",
  "hasCompletedPayment": false,
  "credits": 1250,
  "monthlyCredits": 1250
}
```

| Assertion | Value | |
|---|---|---|
| `selectedTier` | `"pro"` | ✅ |
| `subscriptionTier` | `"pro"` | ✅ |
| `status` | `"pending_payment"` | ✅ |
| `hasCompletedPayment` | `false` | ✅ |
| `credits` | `1250` | ✅ |
| `monthlyCredits` | `1250` | ✅ |
| `credits` is a **number** (shape debt unchanged) | `"number"` | ✅ |
| `email` | correct | ✅ |
| `createdAt` present | `true` | ✅ |
| field count | `8` — no field added, none lost | ✅ |
| **redirect** | `/checkout?tier=pro` | ✅ |

---

# 2 — `?tier=starter`

Account: `phase5+starter-1786734001763@idynify.com` · uid `npNCGHA0YQOTGx6nUysdhg3djYW2`

```json
{
  "email": "phase5+starter-1786734001763@idynify.com",
  "createdAt": "2026-08-14T19:00:03.772Z",
  "selectedTier": "starter",
  "subscriptionTier": "starter",
  "status": "pending_payment",
  "hasCompletedPayment": false,
  "credits": 400,
  "monthlyCredits": 400
}
```

All eleven assertions passed, including **redirect → `/checkout?tier=starter`**.

---

# 3 — No tier parameter

Account: `phase5+notier-1786734001763@idynify.com` · uid `VP4POP5UXyfl6438VDMWtiIiSKX2`

```json
{
  "email": "phase5+notier-1786734001763@idynify.com",
  "createdAt": "2026-08-14T19:00:04.345Z",
  "selectedTier": "starter",
  "subscriptionTier": "starter",
  "status": "pending_payment",
  "hasCompletedPayment": false,
  "credits": 400,
  "monthlyCredits": 400
}
```

**Default behaviour documented:** a visitor arriving with no `?tier=` is created as **Starter with 400 credits** and sent to `/checkout?tier=starter`. That is `Signup.jsx`'s `searchParams.get('tier') || 'starter'`, unchanged from the pre-rebuild implementation — the old code had the identical expression, so the default is preserved rather than newly chosen.

All eleven assertions passed.

---

# 4 — Two things the run proved incidentally

Neither was the point of the exercise; both are stronger evidence than the unit tests because they happened against real infrastructure.

## Analytics buffer-and-flush (D5) works end to end

Every path produced exactly this sequence:

```
[analytics] signup_page_viewed       { tier: 'pro', at_ms: 0,    buffered: true }
[analytics] signup_email_started     { at_ms: 31,   buffered: true }
[analytics] signup_password_started  { at_ms: 37,   buffered: true }
[analytics] signup_submitted         { tier: 'pro', at_ms: 235,  buffered: true }
[analytics] signup_method_selected   { method: 'email', at_ms: 235, buffered: true }
[analytics] signup_succeeded         { tier: 'pro', at_ms: 1563 }
```

Five pre-auth events carry `buffered: true` and their original `at_ms` offsets; the terminal event is written live. **6 documents landed in `users/{uid}/analytics_events`** per signup — confirmed by the cleanup, which counted and deleted 6 each time. No event carries an email address or a password.

The known limitation stands and is unchanged: an abandoned signup produces no uid, so it produces no record.

## Welcome email is genuinely fire-and-forget — proven by a real failure

The Netlify function is not reachable from the harness, so the call failed for real:

```
[signup] welcome email failed to send TypeError: Failed to parse URL from
  /.netlify/functions/send-welcome-email
```

**The account was still created, the document still written, and the redirect still happened.** That is confirmation #3 from Phase 4 demonstrated under an actual failure rather than a mocked one.

---

# 5 — M1–M8

> **GCIP enforcement mode: Notify. The password checklist is currently guidance
> based on the live policy. A user can sign up with a non-compliant password
> today — Firebase accepts it under Notify mode. Hard enforcement at the Firebase
> auth boundary is deferred to #546.**

This release is **not** described as enforcing the 8 + upper + lower + numeric
policy at the Firebase boundary, because it does not. §M5 below is the live
evidence for that statement rather than an assumption about it.

Six of the eight were executable here after all, and were run rather than left
for you. M1, M2 and M6 ran in a **real Chromium** against the dev server. M4, M5
and M8 ran headless against the **real Firebase project**, because Chromium
cannot reach Firebase from this environment. M3's sub-checks all ran; only the
real-hardware part is outstanding. M7 needs an authenticator app.

## ✅ M1 — keyboard-only flow

Real browser, `Tab` only, no mouse.

| Stop | Element | Focus visible |
|---|---|---|
| 1 | `INPUT[email]` — "Email" | ✅ |
| 2 | `INPUT[password]` — "Password" | ✅ |
| 3 | `BUTTON` — "Show password" | ✅ |
| 4 | `BUTTON[submit]` — "Create account" | ✅ |
| 5 | `A` — "Sign in" | ✅ |

Order is logical, focus visible at every stop, then it wraps. **CTA reachable by
Tab and `Enter` on it submits** — verified by observing the `accounts:signUp`
request fire. The form is completable and submittable with no mouse.

## ✅ M2 — show/hide

| Check | Result |
|---|---|
| Keyboard reaches the toggle | ✅ arrives as "Show password" |
| `Space` reveals | ✅ `type` `password` → `text` |
| `Enter` hides | ✅ `type` `text` → `password` |
| Accessible label tracks state | ✅ "Show password" → "Hide password" → "Show password" |
| Focus stays on the toggle | ✅ does not jump back into the field |

## ⚠️ M3 — sticky CTA · all sub-checks pass, real hardware outstanding

Every criterion you listed, across five viewport shapes plus desktop:

| Configuration | Reachable | Covers field | Covers checklist | Scrollable | In form / tabIndex | Dock |
|---|---|---|---|---|---|---|
| iPhone SE 375×667, kb 260 | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | `sticky` |
| iPhone 14 390×844, kb 336 | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | `sticky` |
| Pro Max 430×932, kb 350 | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | `sticky` |
| Android 360×480 (shrunk) | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | `sticky` |
| Landscape 844×390 | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | `sticky` |
| **Desktop 1440×900** | ✅ | ✅ no | ✅ no | ✅ | ✅ / 0 | **`static` — unchanged** |

**Outstanding: a real phone.** The keyboard here is simulated by setting the
same `--auth-kb-inset` the `visualViewport` listener would set. That exercises
the CSS and the layout correctly but not the browser's own focus-scroll
behaviour on real hardware. One Android Chrome and one iOS browser would close
it — noting again that Chrome on iOS is WebKit, so it is not a separate engine.

## ✅ M4 — duplicate email

Against the real project, with a controlled test account.

| Check | Result |
|---|---|
| Message | *"An account already exists with this email. Sign in instead"* |
| `role="alert"` | ✅ |
| Raw Firebase code leaked | ✅ none — no `auth/…` in the text |
| "Sign in instead" | ✅ a real `<a href="/login">`, not plain text |
| Email preserved | ✅ still in the field |
| Password preserved | ✅ |
| CTA re-enabled | ✅ |

## ✅ M5 — password policy under Notify mode

The two questions, answered against the live project. Test password `abcdefgh` —
8 characters, so it clears Firebase's own hard 6-character floor and isolates the
*policy* question rather than the length one.

**Live policy read back:** min length 8 · uppercase required · lowercase required
· number required. `validatePassword("abcdefgh")` → `isValid: false` (length ✅,
uppercase ✗, number ✗).

### (a) Does the client prevent submission? **No.**

The CTA is enabled and the form submits. `disabled` is bound to `submitting`
only; there is no validity gate. **This is the intended implementation, not a
defect** — `PasswordRequirements` was built as guidance from the start, and
`onValidityChange` is deliberately not wired to the button. Gating on it would
have meant a client refusing what the server accepts, and — because the checklist
hides itself when the policy cannot be fetched — a network blip would have
blocked signup entirely.

### (b) Does Firebase accept it under Notify? **Yes.**

Account created successfully with a policy-non-compliant password. Confirms
Notify does not hard-block at the auth boundary, exactly as the release note
says.

**So today a determined user can create an account with `abcdefgh`**: the
checklist tells them it does not meet the requirements, and nothing stops them.
That is the documented, intended behaviour of Notify mode, and it changes when
**#546** moves to Require — after `forceUpgradeOnSignin` is set false.

## ✅ M6 — LEGAL-001

| Check | Result |
|---|---|
| Terms/Privacy text present | ✅ none |
| Dead `/terms` or `/privacy` links | ✅ none |
| Layout ready for the line | ✅ `.auth-legal-slot` reserved, **42px** measured |

Reinstating the line is a render into existing space — no reflow, no redesign.

## ⬜ M7 — MFA regression · not attempted

Needs an MFA-enrolled account and a live authenticator app; enrolling TOTP on the
project to self-test was more intervention than a verification phase warrants.

**Automated coverage exists and passes:** test 15 asserts that
`auth/multi-factor-auth-required` surfaces the TOTP prompt and that
`resolveMfaSignIn` is called with the original error and the typed code; test 16
asserts the verify button stays disabled until six digits. `src/utils/mfa.js` is
untouched by this sprint — confirmed by diff.

**Needs a human with a controlled MFA account.**

## ✅ M8 — existing non-compliant password still authenticates

Built the exact case with an account under our control: the M5 account has, by
construction, a password that does not satisfy the policy.

| Check | Result |
|---|---|
| Signs in with the non-compliant password | ✅ **yes** |
| Forced into a password change | ✅ **no** |
| Live `enforcementState` | `OFF` |
| Live `forceUpgradeOnSignin` | `true` ← **#546** |

**Notify mode did not lock out existing users** — confirmed independently of the
original check 7, on an account no customer owns.

The `forceUpgradeOnSignin: true` reading is why this passes today for a reason
worth stating precisely: it is inert *because* enforcement is off, not because
the flag is set correctly.

---

# 5b — Original manual script *(superseded by §5 for the six that were executed)*

Retained for M3's real-device pass and M7.

| # | Check | What to do | Expected |
|---|---|---|---|
| M1 | **Keyboard-only flow** | From page load, `Tab` only — never touch the mouse | Order: wordmark (skipped, not focusable) → Email → Password → **Show password** → Create account → Sign in. `Enter` in either field submits. Focus ring visible on every stop. |
| M2 | **Show/hide toggle** | `Tab` to the eye, press `Space` and `Enter` | Password becomes visible; the button's accessible name flips "Show password" ⇄ "Hide password". Focus stays on the toggle — it must not jump back into the field. |
| M3 | **Sticky CTA, real device** | On a phone, tap the password field | "Create account" stays visible above the keyboard. Verify on **Android Chrome** and **any iOS browser** — note that Chrome on iOS is WebKit and behaves as Safari, so it is not an independent third case. |
| M4 | **Duplicate email** | Sign up with an address that already exists | *"An account already exists with this email. **Sign in instead**"* — the link is a real link that navigates to `/login`. Typed email and password remain in the fields. |
| M5 | **Bad password** | Submit something the API rejects | Human-readable message, no raw `auth/…` code, both fields preserved, CTA re-enabled. |
| M6 | **LEGAL-001** | Read the page bottom | **No** Terms or Privacy text and **no** placeholder link. Pinned by a test that also asserts no `/terms` or `/privacy` href exists. |
| M7 | **MFA unchanged** | Sign in with an MFA-enrolled account **you control** | TOTP prompt appears, 6 digits enables the button, correct code signs in. `resolveMfaSignIn` is untouched. |
| M8 | **Check 7 re-confirm** | Sign in as an existing account with a non-compliant password | Succeeds. Already passed at REL-AUTH-001; worth one repeat now that #546 has surfaced. |

M1, M2, M4, M5 and M6 have automated equivalents in `src/test/signupAuth.test.jsx` — the manual pass is there to catch what jsdom cannot represent, chiefly real focus behaviour, real assistive-technology output and real device rendering.

---

# 5c — `forceUpgradeOnSignin` — future-change guardrail

Recorded here and in **#546** so it cannot get lost between sprints.

> **`forceUpgradeOnSignin` currently reads `true`. It is inert under Notify mode.
> Any future move to Require enforcement must include a deliberate review and
> confirmation of this flag's state before the policy change is made. Do not
> change enforcement mode without checking this flag first.**

**Not a blocker.** M8 passed on a controlled account whose password the policy
rejects: it signed in cleanly and was not forced to change anything. The current
release is safe.

The reason it needs a guardrail rather than a note: the flag is inert *because*
enforcement is off, not because it is set correctly. Flipping enforcement to
Require is the single action that would activate it — and it would do so as a
side effect, in a change nobody intended to be about existing users.

---

# 6 — Test accounts: created, and cleaned up

Per the authorization: minimum count, clearly identified, no existing account touched, read, or modified.

| Account | uid | Cleaned up |
|---|---|---|
| `phase5+pro-1786734001763@idynify.com` | `2Qf1YC2o1fgLLVRJoqzV4K87wY52` | ✅ 6 analytics events + user doc + auth user |
| `phase5+starter-1786734001763@idynify.com` | `npNCGHA0YQOTGx6nUysdhg3djYW2` | ✅ same |
| `phase5+notier-1786734001763@idynify.com` | `VP4POP5UXyfl6438VDMWtiIiSKX2` | ✅ same |

Plus-addressed on the IDYNIFY domain and timestamped, so they are unmistakable as test data. No email was ever delivered — the welcome-email call fails in this environment (§4).

## ⚠️ Disclosure — orphaned data from an earlier run

The verification ran **twice**. The first run's cleanup deleted the user document and the auth user but **not the `analytics_events` subcollection**, because `deleteDoc` does not cascade in Firestore. I only noticed from the retry noise in the log, and fixed the harness to delete subcollections first, while still authenticated — which is why the second run reports "6 analytics event(s)" per account.

**So three orphaned `users/{uid}/analytics_events` subcollections remain**, under uids whose owners no longer exist. Two are recoverable from the log:

```
bESwpcnLAFeN3CRgSVnDSOulFm72   (starter path, first run)
5F0blQ1H66gbqElUFbJ5WBaUKKU2   (no-tier path, first run)
```

The third — the first run's `pro` account — scrolled out of the captured output and I do not have its uid. All three are filterable by the `phase5+…-1786733951566@idynify.com` address pattern if the auth records were still present, but they are not, so **the Firestore console or the Admin SDK is the only route**. They are inert orphaned event documents, not accounts: no auth record, no user document, no access path for any client.

I could not clean these up myself — the rules require `request.auth.uid == userId`, and those users are deleted. Flagging rather than quietly leaving them.

---

# 7 — Sprint closure status

| Requirement | Status |
|---|---|
| `?tier=pro` → Pro fields → `/checkout?tier=pro` | ✅ §1 |
| `?tier=starter` → Starter fields → `/checkout?tier=starter` | ✅ §2 |
| No tier param → default unchanged, documented | ✅ §3 |
| `credits` shape unchanged (number, not fixed) | ✅ asserted per path |
| Firestore document verified before checkout URL | ✅ document read first, routing asserted after |
| Duplicate email error + inline Sign in link | ✅ **M4** — live |
| Password policy behaviour under Notify | ✅ **M5** — live, both questions answered |
| Show/hide toggle, keyboard accessible | ✅ **M2** — real browser |
| LEGAL-001 — no placeholder | ✅ **M6** — real browser |
| Keyboard-only flow end to end | ✅ **M1** — real browser |
| Sticky CTA | ⚠️ **M3** — every sub-check passed; real hardware outstanding |
| MFA branch unchanged | ⬜ **M7** — automated ✅, needs an authenticator app |
| Existing-user sign-in (check 7) | ✅ **M8** — re-confirmed on a controlled non-compliant account |
| Pre-existing failures untouched | ✅ #545, not touched |

Automated suite: **35 passed** in the signup file; **1128 passed, 5 failed** overall — the five being #545, unchanged.

**Phase 5 does not close on automated evidence alone** — and it no longer rests
on automated evidence alone. M1, M2 and M6 ran in a real browser with real
keyboard events; M4, M5 and M8 ran against the real auth backend and created,
exercised and deleted real accounts.

**Two things still need a human**, and neither is something this environment can
honestly stand in for:

| | What is missing | Why |
|---|---|---|
| **M3** | A real phone, one Android Chrome + one iOS browser | The keyboard here is simulated by setting the inset the `visualViewport` listener would set. Layout and CSS are exercised; the browser's own focus-scroll on real hardware is not. |
| **M7** | An MFA-enrolled account and an authenticator app | Enrolling TOTP on the live project to self-test is more intervention than verification warrants. `src/utils/mfa.js` is untouched by this sprint and tests 15–16 cover the branch. |

The sprint closes when those two are confirmed.

---

# 8 — Sprint closeout record

## M3 — real device *(Aaron)*

| Field | |
|---|---|
| Result | ⬜ PASS ⬜ FAIL |
| Device | _________________ |
| OS version | _________________ |
| Browser + version | _________________ |
| CTA visible and reachable | ⬜ |
| Does not overlap the password field | ⬜ |
| Does not cover or clip the checklist rows | ⬜ |
| Page remains scrollable | ⬜ |
| CTA submits normally | ⬜ |

**Do not claim cross-platform hardware verification if only one platform was
tested.** If a single device is used, record it as single-platform. The two
genuinely distinct engines are Android Chrome and WebKit; every iOS browser,
Chrome included, is WebKit.

## M7 — MFA *(Aaron)*

| Field | |
|---|---|
| Result | ⬜ PASS ⬜ FAIL |
| Controlled account used (not a customer) | ⬜ confirmed |
| Primary credentials accepted | ⬜ |
| MFA challenge appears | ⬜ |
| TOTP code entered | ⬜ |
| Authentication completes | ⬜ |
| No regression in the rebuilt login UI | ⬜ |

## Everything else

| Check | Result | Evidence |
|---|---|---|
| `?tier=pro` → Pro fields → `/checkout?tier=pro` | ✅ PASS | §1, live Firestore document |
| `?tier=starter` → Starter fields → `/checkout?tier=starter` | ✅ PASS | §2 |
| No tier param → Starter, default documented | ✅ PASS | §3 |
| `credits` shape unchanged (number) | ✅ PASS | asserted per path |
| M1 keyboard-only flow | ✅ PASS | real Chromium, §5 |
| M2 show/hide toggle | ✅ PASS | real Chromium, §5 |
| M3 sticky CTA — sub-checks | ✅ PASS | 6 configurations, §5 |
| M3 sticky CTA — real hardware | ⬜ | **above** |
| M4 duplicate email | ✅ PASS | live project, §5 |
| M5 password policy under Notify | ✅ PASS | live project, both questions answered, §5 |
| M6 LEGAL-001 | ✅ PASS | real Chromium, §5 |
| M7 MFA | ⬜ | **above** |
| M8 existing non-compliant password | ✅ PASS | live project, controlled account, §5 |

Automated: **35 passed** in `signupAuth.test.jsx`; **1128 passed, 5 failed**
overall, the five being #545 and untouched.

**Phase 5 and the Signup Rebuild sprint close when M3 and M7 are recorded above
as PASS.**

## Open items carried out of the sprint

| Item | Where | Status |
|---|---|---|
| Terms and Privacy pages | **LEGAL-001** | deferred by D2; layout slot reserved |
| Pre-existing `HunterContactCard` / `ReconSectionEditor` failures | **#545** | open, untouched |
| Notify → Require migration + `forceUpgradeOnSignin` review | **#546** | open; guardrail in §5c |
| Orphaned test data — 5 uids, 4 known | **#547 / CLEANUP-001** | open, **stays open past sprint close** |
| Password enforcement evaluation | **AUTH-POLICY-002** | tracked on #546 |

---

**No production code changed in Phase 5.** The only additions are the verification harness and its loader under `scripts/`, neither of which is imported by the application or run by CI.
