# Firestore Data Architecture

Reference for how Idynify stores data in Firestore: collection paths, ownership,
retention, indexes, and environment configuration.

**Status:** Established 2026-08-08 with the Environment Configuration and
Observability & Telemetry sections. Other collections are documented as they are
brought under Barry OS governance.

---

## Environment Architecture

### Four independent identities

These are four separate concepts. **None may be inferred from another** (BO-011).
Conflating any two of them is what produced the `environment: "dev"` defect.

```
Application Environment  (BARRY_ENV)            ≠
Firebase Project         (FIREBASE_PROJECT_ID)  ≠
Firestore Database       ((default))            ≠
Workspace / Tenant       (userId / workspace_id)
```

| Identity | Authority | Answers |
|---|---|---|
| Application environment | `BARRY_ENV` | *Which deployment is this?* — production, deploy-preview, branch-deploy |
| Firebase project | `FIREBASE_PROJECT_ID` | *Which physical Firebase project receives the write?* |
| Firestore database | `getFirestore()` → `(default)` | *Which database inside that project?* |
| Workspace / tenant | `userId`, `workspace_id` | *Whose data is this?* |

**The current Firebase project is shared across environments.** There is one
project, and production, previews and local development all write to it. The
physical location therefore carries no information about which environment
produced a row — which is precisely why the environment must be named
explicitly rather than derived.

**`BARRY_ENV` is the authoritative environment identifier.** It is read in one
place (`logApiUsage.js`) with no fallback: absent means `unknown`, never a
guess.

> ⚠️ **Netlify captures environment variable values at deploy time.** Adding or
> changing `BARRY_ENV` does not affect already-deployed Functions. **A fresh
> deploy is required** after any environment variable change before Functions
> observe the new value. A Function deployed before the variable existed will
> log `unknown` until it is redeployed.

### Superseded: how `environment` was derived before

Every telemetry row carries an `environment` field. It is computed in one place:

```js
// netlify/functions/utils/logApiUsage.js:89-91
const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'idynify-scout-dev';
const environment = projectId.includes('dev') ? 'dev' : 'prod';
```

**This heuristic has been removed.** It is recorded here because it explains
every historical row. It was a **substring test on the Firebase project ID** —
no dedicated environment variable, no Netlify deploy-context check, no
application configuration.

The Firestore instance that receives the write is resolved separately, from the
same primary variable:

```js
// netlify/functions/firebase-admin.js:20
projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev'
```

Note the two differ: `logApiUsage` falls back to `VITE_FIREBASE_PROJECT_ID`
before the hardcoded default; `firebase-admin` does not. If only the `VITE_`
variable were set, rows would be **labelled from one project ID while being
written to another**. That is not the cause of the current mislabel, but it is a
live trap and is recorded here.

### Root cause of `environment: "dev"` on production rows

**The label is an incorrect classification, not a misrouted write.** The data is
in the right place; only the field is wrong.

Evidence from the repository:

| Fact | Source |
|---|---|
| `environment` is a substring test for `"dev"` in the project ID | `logApiUsage.js:91` |
| The only project ID literal in use is `idynify-scout-dev` | 37 occurrences, all as the hardcoded fallback |
| `idynify-scout-prod` is **not** a configured project | Single occurrence, in `DEPLOYMENT.md:23`, as an example name in setup instructions |
| The write target resolves from the same variable | `firebase-admin.js:20` |

A single Firebase project serves production, and its ID retains a `-dev` suffix
from early development. The heuristic asks *"does the project name contain
'dev'?"* as a proxy for *"is this a development environment?"* — and for this
project that proxy returns `true` in production.

**Whatever `FIREBASE_PROJECT_ID` is set to in the Netlify production context, its
value contains the substring `dev`.** That follows necessarily from the observed
label. Confirming the exact value is the one step that cannot be taken from the
repository alone.

### Consequences

1. **`environment` has never distinguished anything.** Every row ever written by
   `logApiUsage` — development and production alike — is labelled `dev`. This is
   not a regression introduced by the A2 fix; it predates it.
2. **Baseline rows cannot be filtered by environment.** No field on `apiLogs`
   separates production traffic from development traffic. If both share the one
   project, they are presently indistinguishable.
3. **The admin dashboard's environment filter is inert.** `adminGetApiLogs`
   accepts `filters.environment` (`adminGetApiLogs.js:133-134`), which can only ever
   match `dev`.

### Final production environment mapping

| | Value |
|---|---|
| Firebase project serving production | Single project; ID contains `dev` (expected `idynify-scout-dev`) |
| Separate production project | **None configured** |
| Firestore database | `(default)` — `getFirestore()` is called with no database argument |
| Environment authority | `BARRY_ENV` |
| `environment` emitted in production, before the fix | `dev` (every row) |
| `environment` emitted in production, after the fix | `production` |
| `environment` when `BARRY_ENV` is absent | `unknown` — never guessed |

**Resolved.** The heuristic was replaced with `process.env.BARRY_ENV || 'unknown'`.
That also retires the `VITE_` divergence noted above: the label no longer reads
any project ID, so it can never be derived from a different project than the one
receiving the write.

**Rows written before that fix carry `environment: "dev"` regardless of origin
and cannot be reclassified retroactively** — the information needed to
distinguish them was never recorded. Any analysis spanning the cutover must
treat the two eras separately.

---

## Observability & Telemetry

Telemetry is platform architecture, not a utility collection. It is the only
mechanism by which Barry's cost, latency, and failure behaviour can be observed,
and it is a governed surface on the same footing as Signals, Awareness, and
Memory.

### `apiLogs` — top-level collection

| Field | Value |
|---|---|
| **Path** | `apiLogs/{autoGeneratedId}` — **root-level**, not nested under `users` |
| **Written by** | `netlify/functions/utils/logApiUsage.js:128` — the sole writer |
| **Read by** | `netlify/functions/adminGetApiLogs.js:117` — the sole reader, via the Admin SDK service account |
| **Security rules** | `firestore.rules:27` — `allow write: if request.auth != null`, `allow read: if false`. Client reads are denied outright; only the service account (which bypasses rules) can read |
| **Query patterns** | One reader, one shape: `orderBy('timestamp','desc')` plus optional equality filters on `endpoint`, `userId`, `environment`, and range filters on `timestamp`, capped at 1000 (`adminGetApiLogs.js:117-141`) |
| **Index requirements** | **None declared** in `firestore.indexes.json` (which covers only `communication_records`, `contacts`, `missions`, `notifications`). Each equality-filter-plus-`orderBy` combination needs its own composite index: `(endpoint, timestamp desc)`, `(userId, timestamp desc)`, `(environment, timestamp desc)`. Any index currently in use was created outside version control. **Patterns documented; indexes deliberately not created — Document 5** |
| **Retention policy** | **None. Unbounded growth — Document 5** |
| **Environment semantics** | `BARRY_ENV` verbatim, or `unknown` when unset. Historical rows all read `dev` — see Environment Architecture. Not comparable across the cutover |
| **Production verification** | ✅ **Verified 2026-08-08** (evidence below) |

**Row shape.** `userId`, `operation`, `provider`, `endpoint`, `creditsUsed`,
`status`, `responseTime`, `environment`, `timestamp` are always written.
`model`, `inputTokens`, `outputTokens`, `totalTokens`, `traceId`, `errorCode`
and `metadata` are written only when supplied — deliberately absent rather than
zero, because zero is a measurement and "not captured" is not.

`endpoint` is derived as `` `${provider.toUpperCase()}_${operation.toUpperCase()}` ``,
so the provider is recoverable from the endpoint prefix alone.

**Known gap — the reader drops the telemetry fields.** `adminGetApiLogs.js:145-157`
projects `endpoint`, `creditsUsed`, `status`, `responseTime`, `environment`,
`errorCode` and `metadata`, and omits **`provider`, `model`, `inputTokens`,
`outputTokens` and `traceId`**. Those fields are written but cannot be read back
through the only reader, so cost and model reporting cannot be built on that
endpoint. Direct Firestore access is required until the projection is widened.

**Production verification, 2026-08-08** — first confirmed post-deploy Anthropic
row, establishing correct provider attribution:

```
endpoint:      ANTHROPIC_BARRYMISSIONCHAT
provider:      anthropic
model:         claude-haiku-4-5-20251001
inputTokens:   15472
outputTokens:  174
status:        success
timestamp:     2026-08-08 10:15:05 UTC-6
```

The `ANTHROPIC_` prefix rather than `APOLLO_` is the specific evidence that
defect A2 is resolved on the success path.

### `users/{uid}/apiUsage/summary` — rolling counters

| Field | Value |
|---|---|
| **Path** | `users/{userId}/apiUsage/summary` — a single document literally named `summary` |
| **Written by** | `netlify/functions/utils/logApiUsage.js:149-152`, via `set(..., { merge: true })` |
| **Read by** | No repository reader. Written for reporting; nothing consumes it today |
| **Security rules** | Governed by the `users/{userId}` rules; writes here are service-account only in practice |
| **Indexes** | None required — addressed by document path, never queried |
| **Environment dimension** | **None — schema gap, Document 5.** Unlike `apiLogs`, this document carries no `environment` field at all, so every environment's activity is summed into one set of counters and cannot be separated. `BARRY_ENV` does not help here; the field does not exist |
| **Counter reset** | **Never — schema gap, Document 5.** Counters are cumulative for the lifetime of the user document, with no period boundary, so they cannot answer "what did this cost last month" |
| **Production verification** | Not independently verified. The unit tests assert the write shape; no production read has been performed |

**Counter shape.** `lastUpdated`, `calls_{provider}` and `{operation}` increment
on every call. `totalCredits` increments **only when `creditsUsed > 0`**, which
is what keeps Anthropic activity out of the Apollo credit counter — the
substance of defect A2. `totalInputTokens` and `totalOutputTokens` increment only
when token counts were captured.

Every counter uses `FieldValue.increment()` rather than read-then-write, so
concurrent calls accumulate instead of overwriting each other (defect A11).

### Failure behaviour

`logApiUsage` wraps its entire body in `try/catch` and swallows any error to
`console.error` (`logApiUsage.js:158-161`). **Telemetry never breaks the
operation it measures.** The corollary is that telemetry can fail silently: a
run of missing rows indicates a write failure, not an absence of activity. The
`✅ API log:` line emitted on each successful write is the corroborating signal
in the Netlify function logs.

---

## Known Gaps

Gaps recorded here are documented, not scheduled. Implementation belongs to
Document 5 planning.

### B-001 — Relationship Bounce Blind Spot

Contact outreach is sent through Gmail. No repository path ingests delivery
failure or bounce events for Gmail relationship email. `contact.email_bounced`
therefore has no current implementation. Barry cannot incorporate relationship
delivery failure into Awareness.

**Existing infrastructure**

```
resendWebhook.js → receives Resend email.bounced (system email only)
                 → writes emailLogs and emailSuppressionList
                 → does not update Contact state
                 → does not publish a Barry OS signal
```

**Repository evidence**

| Fact | Location |
|---|---|
| Resend bounce events are received and classified hard/soft | `resendWebhook.js:65-66`, `:138-158`, `:213-249` |
| Bounce state is written to the email log, not the contact | `emailLog.js:189-196` — `bouncedAt`, `bounceType` |
| Hard bounces enter the suppression list | `resendWebhook.js:153-156` |
| Resend carries system email | `send-welcome-email.js:29` — the only Resend send path |
| Contact outreach goes through Gmail | `gmail-send.js`, `barry-approve-send.js` |
| Neither outreach path writes to the email log | No `emailLog` / `logEmail` reference in either file |
| No Gmail function processes bounce events | No `bounce` reference in any `gmail-*.js` |

The one Gmail-adjacent match is `gmailMessageService.js:372`, a regex of
automated-sender local-parts (`bounce`, `mailer-daemon`, `postmaster`). That is
inbound sender filtering, not bounce event processing — it reads like a bounce
producer to a text search and is not one.

**Future implementation**

A relationship-email delivery adapter (Gmail, or a future supported delivery
channel) must publish `contact.email_bounced`. Scheduled for Document 5
planning. **Do not implement during baseline week.**
