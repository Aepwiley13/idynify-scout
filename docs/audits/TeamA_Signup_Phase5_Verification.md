# TEAM A — Signup Rebuild, Phase 5 Functional Verification

**Method:** Option 4 — Node for data, Aaron for interaction.
**Project:** `idynify-scout-dev`
**Status:** Team A's half complete, all assertions passed. Aaron's half outstanding.
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

# 5 — Aaron's half: manual browser checks

Not attempted here. Script and expected results below.

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
| Duplicate email error + inline Sign in link | ⬜ **M4** — automated ✅ |
| Bad password error, form preserved | ⬜ **M5** — automated ✅ |
| Show/hide toggle, keyboard accessible | ⬜ **M2** — automated ✅ |
| LEGAL-001 — no placeholder | ⬜ **M6** — automated ✅ |
| Keyboard-only flow end to end | ⬜ **M1** |
| Sticky CTA on Android and iOS | ⬜ **M3** |
| MFA branch unchanged | ⬜ **M7** — automated ✅ |
| Existing-user sign-in (check 7) | ✅ passed at REL-AUTH-001 · ⬜ **M8** re-confirm |
| Pre-existing failures untouched | ✅ #545, not touched |

Automated suite: **35 passed** in the signup file; **1128 passed, 5 failed** overall — the five being #545, unchanged.

**Phase 5 does not close on automated evidence alone.** Team A's half is complete; the sprint closes when M1–M8 are confirmed.

## Open items carried out of the sprint

| Item | Where |
|---|---|
| `forceUpgradeOnSignin: true` in the live policy — blocks Notify → Require | **#546** |
| Pre-existing `HunterContactCard` / `ReconSectionEditor` failures | **#545** |
| Terms and Privacy | **LEGAL-001**, deferred by D2 |
| Orphaned `analytics_events` from the first verification run | §6 — needs Admin SDK |

---

**No production code changed in Phase 5.** The only additions are the verification harness and its loader under `scripts/`, neither of which is imported by the application or run by CI.
