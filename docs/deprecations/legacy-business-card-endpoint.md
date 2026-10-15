# Deprecated: the legacy business-card endpoint

| | |
|---|---|
| Endpoint | `POST /.netlify/functions/extractBusinessCard` (`netlify/functions/extractBusinessCard.js`) |
| Status | **Deprecated 2026-10-14.** Locked down, still deployed, still working. |
| Only client | `src/components/scout/BusinessCardCapture.jsx`, which no screen renders |
| Replacement | Scout+ Relationship Capture (new endpoints; does not use this one) |
| Removal | A separate PR, only after every [deletion criterion](#deletion-criteria) is met |

Nothing in the app calls this endpoint. **Any call to it is unexpected and should be investigated.**

## Why it is deprecated rather than deleted

Inside the repo there is exactly one caller, and it is unreachable. A repository cannot prove that nothing *outside* it calls the endpoint: a mobile wrapper, an extension, an integration, a script. So the endpoint stays up, safe and observable, for an observation window. Every call it receives during that window is recorded and alerted on.

## What changed when it was locked down

| Area | Before | After |
|---|---|---|
| Logs | Vision's raw response, the first 200 characters of card text, the parsed name/email/phone/company, and whole error objects (which can include the request URL, and so the Vision API key) | One structured line per request (see [Telemetry](#telemetry)): outcome, sizes and counts only |
| Auth | Identity Toolkit REST lookup; any mismatch fell through to a 500 | Firebase Admin `verifyIdToken`. The token's user must equal the requested `userId`. Admin impersonation is refused with 403. The shared `verifyAuthToken` helper is deliberately not used, because it lets any admin act as any user. |
| Errors | Always 500, with the raw error message (including Vision's response body) | A status and stable `code` per case (see [Responses](#responses)), with generic messages |
| Usage rows | `APOLLO_EXTRACTBUSINESSCARD`, 1 Apollo credit per scan, plus an error row against an *unverified* body `userId` | `GOOGLE_EXTRACTBUSINESSCARD`, 0 credits, rows only for a verified user. Historical rows are untouched. |
| Headers | none | `Deprecation: @1791936000` (RFC 9745; 2026-10-14) on every response |
| Off switch | none | `LEGACY_CARD_SCAN_ENDPOINT=off` (see [Kill switch](#kill-switch)) |
| Alerting | none | A throttled ops email on any call (see [Ops alert](#ops-alert)) |

What did **not** change: the success body (`success`, `extractedData`, `rawText`), `parseBusinessCardText` (byte-identical), and the request sent to Vision.

## Known legacy parser defect (intentionally unchanged)

**`parseBusinessCardText` can save the local part of an email as the website.** Its website pattern runs over the whole card text and takes the first match without an `@`. On a card with `jane.smith@acmerockets.com`, the first match is `jane.smith`, so the result is `website: "jane.smith"` even when the card prints `www.acmerockets.com`.

This is a real bug, and it is **deliberately not fixed**. It belongs to the retired scanner, which is being removed rather than repaired. The lockdown changes no parser behavior, so a caller we have not found yet keeps getting exactly what it got before.

`src/test/legacyBusinessCardEndpoint.test.js` ("extracts exactly what the legacy parser always extracted") asserts `website: 'jane.smith'`. **That assertion pins existing behavior; it does not describe desired behavior.** It exists so that any change to the legacy parser is noticed. Relationship Capture uses its own extraction and does not inherit this parser.

## Responses

Every response carries `Content-Type: application/json`, `Access-Control-Allow-Origin: *` and `Deprecation: @1791936000`.

| Status | `code` | When |
|---|---|---|
| 200 | — | Success. Body: `{ success: true, extractedData, rawText }`, unchanged |
| 400 | `INVALID_REQUEST` | Body is not JSON, or `userId` / `imageBase64` missing or not a string |
| 401 | `UNAUTHORIZED` | No token (`Authorization: Bearer` header or body `authToken`), or it does not verify |
| 403 | `USER_MISMATCH` | Token is valid but belongs to someone else, admin impersonation included |
| 405 | `METHOD_NOT_ALLOWED` | Not a POST |
| 410 | `LEGACY_ENDPOINT_DISABLED` | Kill switch is off |
| 422 | `NO_TEXT_FOUND` | Vision returned no text |
| 500 | `INTERNAL_ERROR` | Missing configuration, or an unexpected exception |
| 502 | `UPSTREAM_OCR_FAILURE` | Vision returned non-2xx, was unreachable, or rejected the image |

Error bodies are `{ success: false, error: <generic message>, code }`.

## Telemetry

Every request writes exactly one line at `warn` level:

```
legacy_endpoint.extractBusinessCard { requestId, originHost, stage, authenticated, userMismatch, uid,
  outcome, status, timestamp, ms, imageChars?, textChars?, fieldsExtracted?,
  upstreamStatus?, upstreamError?, errorName?, alertJob, alert }
```

- `uid` is the **verified** token holder, or `null`. The body's `userId` is never recorded.
- `originHost` is the host of `Origin` (or `Referer`) only. A full URL can carry credentials or identifiers in its userinfo, path or query, so none of those are kept.
- `stage` is the last step the request reached: `request` → `auth` → `config` → `ocr` → `parse` → `usage` → `respond`.
- `upstreamError` and `errorName` are error *names* (`TypeError`, or `ConfigMissing` for missing configuration), never messages.
- An `INTERNAL_ERROR` is diagnosed from `errorName` plus `stage`. For example, `ConfigMissing` at `config`, or a `RangeError` at `parse`. The caller only ever sees the generic message.
- `alert` is `sent`, or why it was not: `cooldown`, `no_resend_key`, `alert_budget_exceeded`, `resend_<status>`, …

Requests with a verified user also write an `apiLogs` row with endpoint `GOOGLE_EXTRACTBUSINESSCARD`, so they show up in the admin API-logs view.

### Checking usage

- **Since this change:** search the Netlify function log for `legacy_endpoint.extractBusinessCard`, and filter the admin API-logs view on endpoint `GOOGLE_EXTRACTBUSINESSCARD`.
- **Before this change:** filter the admin API-logs view on endpoint `APOLLO_EXTRACTBUSINESSCARD`. That is the mislabelled name earlier calls were recorded under. Those rows are left as they are.

## Ops alert

Any request raises an alert through `netlify/functions/utils/alertOps.js`, severity `unexpected_use`. The subject is `[UNEXPECTED] <key>`.

**Throttling.** alertOps' existing cooldown sends at most **one email per hour per key**. The cooldown state lives in `ops_alerts/{key}`. There are two keys:

| Key | Used for |
|---|---|
| `extractBusinessCard.legacy.authenticated` | Calls whose token verified: 200, 403, 422, 502, and a 500 after sign-in |
| `extractBusinessCard.legacy.unauthenticated` | Calls that end before a token verifies: 400, 401, 405, 410 |

The keys are separate so that a stream of unauthenticated probes cannot hold the cooldown and hide a real signed-in caller. At most two emails an hour, however many calls arrive.

Other properties of the alert:
- The telemetry line and the `apiLogs` row are written for **every** call, whether or not an email went out.
- The cooldown fails open: if it cannot be read, the alert sends.
- The alert is awaited for at most 3 seconds, then abandoned, so a slow email provider never holds up the caller.
- It sends only where `RESEND_API_KEY` and `OPS_ALERT_EMAIL` are set, as for every other alertOps alert.

> **Monitoring is active only if both variables are set in the Netlify *production* context.** If either is missing, the alert is silently skipped, as it is for the scheduled-job alerts (see `DEPLOYMENT.md`). The telemetry line then reads `alert: 'no_resend_key'` or `'no_ops_alert_email'`. Status at the time of the lockdown PR: **not verified**, because that session had no Netlify access. Confirm both under Site configuration → Environment variables (production context) before relying on the alert. Until then, the telemetry line and the `apiLogs` rows are the only signals.

**Contents.** The endpoint path, the request id, a timestamp, the outcome code and status, the calling host, `authenticated` and `userMismatch`.

**Never included:**
- card text, name, email, phone or company
- the image
- the auth token
- the Google API key
- Vision's response
- any user identifier

Existing ops alerts carry no user identifiers, and this one follows that. To identify an authenticated caller, find the `GOOGLE_EXTRACTBUSINESSCARD` row in the admin API-logs view at the alert's timestamp, or the telemetry line with the alert's `requestId`.

### `ops_alerts` lifecycle

This is existing alertOps behavior, unchanged by this endpoint, which only adds two document ids.

| | |
|---|---|
| Document | `ops_alerts/{key}`, one per alert key |
| Shape | `{ lastAlertAtMs: number, lastAlertAt: ISO-8601 string, job: string }` |
| Written | Only after an email is accepted by the provider, with `set(…, { merge: true })`. The same document is overwritten each time, never appended to. A skipped or failed send writes nothing. |
| Read | On each alert attempt, to check the one-hour cooldown |
| Expiry | None. There is no TTL policy and no cleanup job, and none is needed. A document only holds the time of the last alert; once that is more than an hour old it has no effect. |
| Growth | Bounded by the number of distinct keys, which are constants in code, never derived from a request: five scheduled jobs plus the two keys here, so seven documents at most. |
| Access | Admin SDK only. `firestore.rules` denies every client read and write on `ops_alerts/{job}`, so no client can silence an alert by moving the cooldown forward. |

The five scheduled jobs (`daily-leads-refresh`, `gmail-sync-worker`, `process-barry-inbox-queue`, `process-barry-queue`, `process-scheduled-engagements`) have used this collection the same way since alertOps was introduced.

## Kill switch

`LEGACY_CARD_SCAN_ENDPOINT=off` (trimmed, any case) makes every request return:

```
410 { "success": false, "error": "This endpoint is no longer available.", "code": "LEGACY_ENDPOINT_DISABLED" }
```

The response still carries the `Deprecation` header. There is no token check, no Vision call and no card processing; the telemetry line and the alert still fire. Unset, or any other value, leaves the endpoint on (its pre-deprecation behavior), so a typo keeps the status quo.

Netlify applies a changed environment variable on the next deploy. Turning it off or back on means: change the variable, then redeploy. No code change is needed.

## Callers (as of 2026-10-14)

Checked in this repository:

- `src`, `netlify/functions`, `functions`, `scripts`, `public` and `docs`: the only caller is `BusinessCardCapture.jsx`.
- **ScoutPlus no longer renders it.** The `business-card` view was removed from `validViews`; a navigation asking for it lands on the menu. The "Scan Business Card / Coming soon" card is display-only.
- **`AddContactModal.jsx` no longer offers it.** Its "Scan Business Card" option was removed. The modal itself is unused (nothing imports it) and is kept for a later cleanup PR.
- **Nothing imports `BusinessCardCapture.jsx`,** so it is not in the production bundle.
- `netlify.toml` has no rewrite that reaches the function; the only redirect is the SPA catch-all. No other function calls it.
- The service worker fetches navigations network-first, so a reload picks up the bundle without the scanner.

`src/test/legacyBusinessCardEntryPoints.test.jsx` fails if any file imports `BusinessCardCapture` again, or if anything other than that component names the endpoint.

Not provable from the repo: callers outside it. The observation window below exists for that.

## Deletion criteria

Delete the endpoint only when **all** of these hold:

- [ ] `RESEND_API_KEY` and `OPS_ALERT_EMAIL` were confirmed in production before the 30-day window started. If they were not, the window is judged on the telemetry line and `apiLogs` rows alone, and that should be said explicitly.
- [ ] This lockdown has been deployed to production for at least **30 days**.
- [ ] No unexpected calls in the last 30 days: no `legacy_endpoint.extractBusinessCard` lines, no `GOOGLE_EXTRACTBUSINESSCARD` rows, no alerts. Named, deliberate test calls are the only exception.
- [ ] The historical `APOLLO_EXTRACTBUSINESSCARD` check is done, and its last-call date and count are recorded here.
- [ ] A production build contains no reference to `extractBusinessCard` (`grep -r extractBusinessCard dist/` is empty).
- [ ] The external-caller check is done: the owner confirms that no app, extension, integration or script outside this repo calls the endpoint.
- [ ] A **7-day kill-switch trial** (`LEGACY_CARD_SCAN_ENDPOINT=off`) ended with no breakage reports and no 410s from real callers.

Then, in a separate PR:
- Delete `netlify/functions/extractBusinessCard.js`, `src/components/scout/BusinessCardCapture.jsx`, `src/test/legacyBusinessCardEndpoint.test.js`, and the endpoint checks in `src/test/legacyBusinessCardEntryPoints.test.jsx`.
- Unset `LEGACY_CARD_SCAN_ENDPOINT`.
- **Keep `GOOGLE_VISION_API_KEY`.** Relationship Capture reuses Vision.

Deleting `AddContactModal.jsx` is separate dead-UI cleanup, after Relationship Capture exists.

## Rollback

- **Code:** revert the lockdown commit. That restores the previous behavior exactly. There is no data migration, no Firestore schema or rules change, and no configuration to undo.
- **Kill switch:** if it was turned off and something breaks, unset it and redeploy.
- **What a caller could notice after the lockdown:**
  - Failures now return 4xx/502 with a `code`, instead of always 500. The body still has `success` and `error`.
  - Admin impersonation is refused with 403. It already failed before, as a 500.
- **What reports could notice:** new usage rows read `GOOGLE_EXTRACTBUSINESSCARD` at 0 credits instead of `APOLLO_EXTRACTBUSINESSCARD` at 1, so Apollo credit totals drop by the number of scans.
