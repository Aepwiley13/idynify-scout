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

---

## Infrastructure Constraints

### Netlify Function Environment Payload

```
AWS Lambda compatibility mode: 4KB environment variable limit
Trigger: BARRY_ENV addition exposed platform was at or near the limit
Investigation date: 2026-08-08
```

The build succeeded, tests passed, and Functions bundled. Deployment failed only
when AWS Lambda rejected the environment payload for exceeding 4096 bytes. The
limit counts **key bytes plus value bytes** for the whole payload, so variable
count matters as much as secret length.

#### Size inventory

Key lengths are exact. **Value lengths are estimates** from known credential
formats — actual values are not visible from the repository. `+2` per variable
covers the `=` and separator.

| Group | Vars | Est. bytes | Share of 4096 |
|---|---:|---:|---:|
| Runtime, consumed by Functions | 28 | ~3641 | 89% |
| Client/build only, not consumed by any Function | 11 | ~660 | 16% |
| **User-configured subtotal** | **39** | **~4301** | **105%** |
| Netlify-injected (`URL`, `DEPLOY_URL`, `NETLIFY_URL`, `NODE_ENV`, internal) | — | ~600 | 15% |
| **Estimated grand total** | | **~4901** | **120%** |

Single largest contributor:

| Variable | Key | Est. value | Est. total | Share |
|---|---:|---:|---:|---:|
| `FIREBASE_PRIVATE_KEY` | 20 | ~1850 | ~1872 | **46%** |

One RSA-2048 PEM service-account key consumes nearly half the entire payload.

#### Scope analysis

**No variable scoping is configured in the repository.** `netlify.toml` contains
`[build]`, `[build.environment]` (`NODE_VERSION` only), `[functions]`,
per-function `timeout` blocks, `[dev]`, `[[headers]]` and `[[redirects]]`. There
are **no `[context.*.environment]` blocks and no scope declarations of any
kind**, so nothing in version control differentiates which variables reach
Functions, the build, or the client.

Duplicated server/client pairs, found by enumerating every `process.env.*` in
`netlify/functions/` and every `VITE_` token in `src/`:

| Pair | Function runtime use | Client use |
|---|---|---|
| `FIREBASE_PROJECT_ID` / `VITE_FIREBASE_PROJECT_ID` | Both — the `VITE_` one only as a fallback | Neither |
| `FIREBASE_API_KEY` / `VITE_FIREBASE_API_KEY` | Both | Neither |
| `GOOGLE_PLACES_API_KEY` / `VITE_GOOGLE_PLACES_API_KEY` | Both | Neither |
| `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` | Server only | Client only |
| `GOOGLE_REDIRECT_URI` / `VITE_GOOGLE_REDIRECT_URI` | Server only | Client only |

**Four variables are consumed by nothing.** `VITE_FIREBASE_APP_ID`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_MESSAGING_SENDER_ID` and
`VITE_FIREBASE_STORAGE_BUCKET` are declared in `.env.example` but read by no
code: the client Firebase config is **hardcoded** at `src/firebase/config.js:6-11`
rather than read from the environment. ~251 bytes for nothing.

#### Runtime dependency inventory

| Variable | Used by | Required |
|---|---|---|
| `FIREBASE_PRIVATE_KEY` | `firebase-admin.js:14`, `adminGetApiLogs.js`, other admin fns | Yes |
| `FIREBASE_CLIENT_EMAIL` | `firebase-admin.js:21` | Yes |
| `FIREBASE_PROJECT_ID` | `firebase-admin.js:20` + many | Yes |
| `FIREBASE_API_KEY` | auth-related functions | Yes |
| `ANTHROPIC_API_KEY` | every AI function | Yes |
| `APOLLO_API_KEY` | search/enrichment functions | Yes |
| `BARRY_MODEL_FAST` / `BARRY_MODEL_DEEP` | `utils/models.js` | Optional — literal defaults exist |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | checkout / webhook fns | Yes |
| `RESEND_API_KEY` | `send-welcome-email.js` | Yes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CALENDAR_REDIRECT_URI` | Gmail/Calendar OAuth | Yes |
| `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` | search enrichment | Yes |
| `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | search enrichment | **Possible duplicate of the pair above — verify** |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_VISION_API_KEY` | enrichment functions | Yes |
| `ADMIN_USER_IDS`, `SUPER_ADMIN_USER_IDS` | `adminGetApiLogs.js:191` + admin fns | Yes |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_GOOGLE_PLACES_API_KEY` | Function fallbacks only | **No — non-`VITE_` twin exists** |
| `VITE_FIREBASE_APP_ID`, `_AUTH_DOMAIN`, `_MESSAGING_SENDER_ID`, `_STORAGE_BUCKET` | **nothing** | **No — client config hardcoded** |
| Remaining `VITE_*` (`ADMIN_API_BASE`, `CRISP_WEBSITE_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `SHELL_MIGRATION`, `STRIPE_ENABLED`, `SUPPORT_EMAIL`) | client bundle at build time | Not needed at Function runtime |

#### Conclusion

```
INSUFFICIENT EVIDENCE
```

The failure is real and its cause is bounded, but **the repository cannot
distinguish CONFIGURATION from BOTH**, because the decision turns on actual
value byte counts that live only in Netlify.

What is established from the repository:

- No scoping is configured in version control
- 11 variables (~660 bytes) are not consumed by any Function
- 4 of those (~251 bytes) are consumed by nothing at all
- 3 `VITE_*` Function fallbacks are redundant with non-`VITE_` twins
- One variable, `FIREBASE_PRIVATE_KEY`, is ~46% of the entire limit

Why that is not enough to choose: with every non-runtime variable scoped out,
estimated runtime payload is ~3641 plus ~600 Netlify-injected ≈ **~4241 against
a 4096 limit** — still over, which would indicate BOTH. But the estimate's error
bars span the limit. A private key at 1700 rather than 1850, or Netlify overhead
at 300 rather than 600, puts the same configuration under 4096, which would
indicate CONFIGURATION. **The decision boundary sits inside the margin of
error.**

One measurement closes it — actual byte totals from the Netlify environment:

```
netlify env:list --json | jq '[to_entries[]
  | {k: .key, bytes: (.key|length) + ((.value//"")|length) + 2}]
  | sort_by(-.bytes)'
```

Decision rule, fixed in advance so the follow-up is one step:

| Measured runtime-only total | Conclusion |
|---|---|
| < ~3600 after scoping | CONFIGURATION — cleanup alone resolves it |
| ~3600–4096 after scoping | BOTH — clears now, no sustainable headroom |
| > 4096 after scoping | PLATFORM — migration required |

Dashboard-level scoping, if configured in the Netlify UI rather than
`netlify.toml`, is also invisible from here and would change the client/build
figures.

#### Remediation options

**Option A — Configuration cleanup only**
- *Advantages:* No code or architecture change. Removes ~660 bytes of
  non-runtime variables and ~251 bytes consumed by nothing. Reversible.
  Improves secret hygiene by keeping client values out of the Function runtime.
- *Risks:* Headroom may be thin or absent — by estimate it may not clear 4096 at
  all. Every future variable re-opens the question. Scoping mistakes can remove a
  variable a Function silently depends on, and telemetry is the only detector.
- *Estimated effort:* Low — Netlify scope settings plus deleting four unused
  variables; optionally removing three `VITE_*` fallbacks (a code change).
- *Expected longevity:* Unknown, possibly zero. Depends entirely on the
  measurement above.

**Option B — Runtime migration only**
- *Advantages:* Removes the 4KB ceiling as a class of problem. Structural, not
  incremental. `FIREBASE_PRIVATE_KEY` at 46% stops being an architectural
  constraint.
- *Risks:* Largest blast radius. Changes the execution substrate for every
  Function during a measurement week. Leaves the underlying configuration
  disorder — four unused variables and absent scoping — in place, so the same
  hygiene problem reappears in a new venue.
- *Estimated effort:* High.
- *Expected longevity:* Long for this constraint; the hygiene debt persists.

**Option C — Configuration cleanup + runtime migration**
- *Advantages:* Resolves the immediate failure and the structural ceiling.
  Cleanup is independently valuable and can land first, potentially unblocking
  the deploy while migration is planned.
- *Risks:* Largest combined change surface. If sequenced together, a failure is
  harder to attribute. Cleanup first, migration second is the lower-risk order
  and preserves attribution.
- *Estimated effort:* Low then High, sequenceable.
- *Expected longevity:* Longest.

**No recommendation.** The evidence does not clearly favour one, and which is
correct depends on the measurement above. If the measured total shows cleanup
clears 4096 with real headroom, A is sufficient and C is over-engineering. If it
does not, A is wasted motion on its own.

```
Decision: pending — awaiting Aaron approval
```
