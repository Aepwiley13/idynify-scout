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

---

## Deployment & Secret Architecture

### The four-layer contract

```
Environment variable
        ↓
Required consumer
        ↓
Allowed scope (Functions / Build / Both / Unused)
        ↓
Allowed deploy context (Production / Preview / Branch / Local)
```

A variable is only correctly configured when all four layers are answered. Today
only the first is answered anywhere.

### Current confirmed status

```
CONFIRMED: All 33 variables use All Scopes across all deploy contexts.
CONFIRMED: Same configured values available across Production, Deploy Preview,
           and Branch Deploy.
CONFIRMED: Inappropriate scoping contributes to Function environment payload.
CONFIRMED: The 4KB limit applies only in Lambda compatibility mode. The modern
           Netlify Functions runtime removes it entirely.
CONFIRMED: Lambda compatibility mode is deprecated. Deploys containing it are
           not accepted after 2027-07-01.
PENDING:   Whether properly scoped required Function variables exceed 4KB.
PENDING:   Whether modern runtime migration is required or optional after
           cleanup.
```

**Count reconciliation.** The dashboard reports 33 configured variables; the
repository references 39 distinct names. The gap is variables referenced in code
but not configured (they fall back to literals or are inert), and possibly
configured variables no code reads. The matrix below covers the referenced
union — reconciling it against the dashboard's 33 requires the dashboard list.

### Sensitivity of shared values — evidence, not assumption

The dashboard proves the same values are present in every context. What those
values *are* is only partly determinable:

| Credential | Determination | Evidence |
|---|---|---|
| Firebase (`FIREBASE_*`) | **Development-project credentials serving production** | One Firebase project exists, `idynify-scout-dev`, hardcoded at `src/firebase/config.js:6-11`. There is no production project (`DEPLOYMENT.md:23` names one only as a setup example) |
| Stripe, Anthropic, Apollo, Resend, Google | **UNKNOWN — live vs test not determinable** | Key prefixes (`sk_live_` vs `sk_test_`) would settle it, but values are not visible from the repository |

Not assumed to be production credentials. For Stripe specifically, the
distinction is decidable in one glance at the key prefix and should be checked
before any context split.

### Remediation matrix

Scope: `FUNCTIONS` / `BUILD` / `BOTH` / `UNUSED`.
Context: `PRODUCTION_ONLY` / `PREVIEW_SAFE` / `CONTEXT_SPECIFIC` / `UNKNOWN`.
Sensitivity: `PUBLIC_CONFIG` / `INTERNAL_CONFIG` / `SECRET` / `HIGH_VALUE_SECRET`.

| Variable | Sensitivity | Scope | Context | Consumers | Recommendation |
|---|---|---|---|---|---|
| `FIREBASE_PRIVATE_KEY` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | `firebase-admin.js:14` | Scope to Functions. Preview needs *a* key for previews to work — use a sandbox service account, not `none` |
| `FIREBASE_CLIENT_EMAIL` | SECRET | FUNCTIONS | CONTEXT_SPECIFIC | `firebase-admin.js:21` | Pairs with the key above |
| `FIREBASE_PROJECT_ID` | INTERNAL_CONFIG | FUNCTIONS | CONTEXT_SPECIFIC | `firebase-admin.js:20` + many | Scope to Functions |
| `FIREBASE_API_KEY` | SECRET | FUNCTIONS | UNKNOWN | auth functions | Scope to Functions |
| `ANTHROPIC_API_KEY` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | every AI function | Scope to Functions. Preview should use a separate key so preview spend is attributable and revocable independently |
| `APOLLO_API_KEY` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | search/enrichment | Scope to Functions. Credit-bearing — preview usage spends real credits |
| `STRIPE_SECRET_KEY` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | checkout | Scope to Functions. **Check the `sk_live_` / `sk_test_` prefix first** — if live, previews can move real money |
| `STRIPE_WEBHOOK_SECRET` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | `stripe-webhook.js` | Scope to Functions |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STARTER` | INTERNAL_CONFIG | FUNCTIONS | CONTEXT_SPECIFIC | checkout | Scope to Functions; must match the key's mode |
| `RESEND_API_KEY` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | `send-welcome-email.js` | Scope to Functions. Sends real email — previews should not use the production sender |
| `GOOGLE_CLIENT_SECRET` | HIGH_VALUE_SECRET | FUNCTIONS | CONTEXT_SPECIFIC | OAuth | Scope to Functions |
| `GOOGLE_CLIENT_ID` | INTERNAL_CONFIG | FUNCTIONS | CONTEXT_SPECIFIC | OAuth | Scope to Functions |
| `GOOGLE_REDIRECT_URI`, `GOOGLE_CALENDAR_REDIRECT_URI` | INTERNAL_CONFIG | FUNCTIONS | **CONTEXT_SPECIFIC** | OAuth | Scope to Functions. Preview URLs differ per deploy — a production redirect URI in preview breaks OAuth there |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | SECRET / INTERNAL_CONFIG | FUNCTIONS | PREVIEW_SAFE | search enrichment | Scope to Functions |
| `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | SECRET / INTERNAL_CONFIG | FUNCTIONS | UNKNOWN | search enrichment | **Verify against the pair above — likely the same integration configured twice** (~118 bytes) |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_VISION_API_KEY` | SECRET | FUNCTIONS | PREVIEW_SAFE | enrichment | Scope to Functions |
| `ADMIN_USER_IDS`, `SUPER_ADMIN_USER_IDS` | INTERNAL_CONFIG | FUNCTIONS | PREVIEW_SAFE | `adminGetApiLogs.js:191` | Scope to Functions |
| `BARRY_ENV` | PUBLIC_CONFIG | FUNCTIONS | **CONTEXT_SPECIFIC** | `logApiUsage.js` | Scope to Functions. Its entire purpose is differing per context |
| `BARRY_MODEL_FAST`, `BARRY_MODEL_DEEP` | PUBLIC_CONFIG | FUNCTIONS | PREVIEW_SAFE | `utils/models.js` | Optional — literal defaults exist. Removal candidate (~76 bytes) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_GOOGLE_PLACES_API_KEY` | PUBLIC_CONFIG | BUILD | PREVIEW_SAFE | Function *fallbacks* only | Redundant — non-`VITE_` twin exists. Removing the fallback is a code change (~173 bytes) |
| `VITE_FIREBASE_APP_ID`, `_AUTH_DOMAIN`, `_MESSAGING_SENDER_ID`, `_STORAGE_BUCKET` | PUBLIC_CONFIG | **UNUSED** | — | **none** | **Removal candidates** (~251 bytes). Client config is hardcoded. Hold pending dashboard/plugin verification |
| `VITE_ADMIN_API_BASE`, `VITE_CRISP_WEBSITE_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_REDIRECT_URI`, `VITE_SHELL_MIGRATION`, `VITE_STRIPE_ENABLED`, `VITE_SUPPORT_EMAIL` | PUBLIC_CONFIG | BUILD | CONTEXT_SPECIFIC (URLs) | client bundle | Scope to Build only — not needed in Function runtime |

**Preview functionality rule applied.** No secret is recommended for removal
from preview contexts on hygiene grounds alone. Where previews need a
capability — Firebase, Anthropic, Apollo, Resend, Stripe — the recommendation is
a **sandbox or non-production credential**, never `none`.

### Payload projection

Value bytes remain estimates. Netlify-injected overhead assumed ~600.

| Scenario | Runtime | +Netlify | % of 4096 |
|---|---:|---:|---:|
| Current — all 39 vars, no scoping | 4301 | 4901 | **120%** |
| A. Scope client/build out of Functions | 3653 | 4253 | **104%** |
| B. + drop the 3 `VITE_` Function fallbacks | 3480 | 4080 | **100%** |
| C. + drop `BARRY_MODEL_*` (defaults exist) | 3404 | 4004 | **98%** |
| D. + drop `GOOGLE_CUSTOM_SEARCH_*` if duplicate | 3286 | 3886 | **95%** |

**Scoping alone (A) does not clear the limit.** Even maximal cleanup (D) lands
at 95% — above the 90% threshold at which the runtime concern stays urgent.
`FIREBASE_PRIVATE_KEY` is 48% of a fully-cleaned runtime payload: one credential
occupies half the budget, and no amount of variable hygiene changes that.

### Conclusion

Cleanup is necessary and insufficient. Two independent findings support the
same conclusion, and the second does not depend on any byte estimate:

1. **Headroom.** Maximal cleanup leaves ≤5% margin. Any new secret re-opens the
   failure.
2. **Deadline.** Lambda compatibility mode is deprecated and deploys containing
   it are **not accepted after 2027-07-01**. Migration is scheduled work, not
   optional work — cleanup only decides whether it happens under a deadline or
   under an outage.

The modern runtime removes the 4KB limit entirely, so migration resolves the
constraint as a class rather than deferring it.

---

## Runtime Migration Readiness — Netlify Modern Functions

Assessment only. Nothing migrated.

> **Source limitation.** `developers.netlify.com` and `docs.netlify.com` are
> blocked by this environment's egress proxy, so the guide named as source of
> truth could not be read directly. Findings below come from search results
> citing Netlify's own documentation and are marked accordingly. **Verify
> against the primary guide before acting.**

### Inventory

| Measure | Count |
|---|---|
| Total deployed Functions | **112** (plus 31 `utils/` modules, not deployed) |
| ESM `export const handler` | 96 |
| ESM `export async function handler` | 2 |
| CommonJS `exports.handler` / `module.exports` | **10** |
| `export default` | 3 |
| Scheduled Functions (`schedule()` from `@netlify/functions`) | **5** |
| Background Functions (`-background` suffix) | 0 |
| Functions with custom timeouts in `netlify.toml` | **14** (nine at 900s, three at 300s, three at 26s) |

Scheduled: `daily-leads-refresh`, `gmail-sync-worker`, `process-barry-inbox-queue`,
`process-barry-queue`, `process-scheduled-engagements`.

### Lambda-specific semantics — the migration cost

| Pattern | Files | Modern equivalent |
|---|---:|---|
| `event.httpMethod` | **106** | `request.method` |
| `event.body` | **100** | `await request.json()` / `.text()` |
| `return { statusCode, body }` | **110** | `new Response(body, { status })` |
| `event.headers` | 3 | `request.headers.get()` |
| `event.queryStringParameters` | 3 | `new URL(request.url).searchParams` |
| `context.*` | 5 | modern `context` differs |
| `event.path` | 0 | — |

**Essentially the entire surface is Lambda-shaped.** 110 of 112 Functions
construct a `statusCode`/`body` response object, and 106 branch on
`event.httpMethod`. This is not a handful of files.

`package.json` declares `"type": "module"` and `@netlify/functions@^5.3.0`, so
ESM is already in place — the gap is request/response semantics, not module
format. The 10 CommonJS Functions need both.

### Migration effort: **HIGH**

Not because any single change is hard — each is mechanical — but because it
touches ~110 files, and each carries a small independent risk of a behavioural
difference in body parsing, header casing, or status handling. Against a
repository whose test coverage does not reach most Function runtimes (15 of 16
AI endpoints have no runtime test, and the build does not bundle `netlify/`),
mechanical breadth is exactly the risk profile that produced the near-miss in
`28da0e9`.

### Transitional path

`@netlify/aws-lambda-compat` **exists** and runs Lambda-style handlers on the
modern runtime *(source: search results citing Netlify docs; not verified
against the primary guide)*. If accurate, it is a viable transitional path:
adopt the modern runtime — removing the 4KB limit — while keeping the existing
handler signature, then convert handlers incrementally.

That ordering matters here. It separates *"escape the environment limit"* from
*"rewrite 110 request/response contracts"*, so the urgent constraint can be
resolved without a 110-file change during a measurement week.

**Verify before relying on it:** whether the compat layer supports `schedule()`,
the 900-second timeouts, and per-function `netlify.toml` configuration. Those
are the three places this codebase is unusual, and all three are load-bearing.

### Deadline

Lambda compatibility mode is deprecated; deploys containing it are **not
accepted after 2027-07-01** *(source: search results citing Netlify docs)*.
Migration is scheduled work whether or not the 4KB issue forces it sooner.

---

## Phase 1 — Approved Direction and Final Matrix

```
Architectural Direction: Option C approved as roadmap.
Implementation gated — Phase 1 requires matrix approval,
Phase 2 requires separate project brief and approval.

Phase 1: scope/context cleanup → unblock #521 → baseline.
Phase 2: zero-behavior-change migration before 2027-07-01.

Infrastructure principle (proposed for Document 5):
No single credential should consume more than 25% of the
Function runtime environment payload.
FIREBASE_PRIVATE_KEY currently at ~48%.
```

### Confirmed facts

```
CONFIRMED: Lambda compatibility mode is deprecated. Deploys will not be
           accepted after 2027-07-01.
CONFIRMED: Migrating to the modern runtime removes the 4KB environment
           variable limit entirely.
CONFIRMED: @netlify/aws-lambda-compat is the officially supported transitional
           path preserving Lambda-style handler contracts. Each handler must
           still be wrapped and exported with withLambda() — handler contracts
           survive, execution semantics may not.
CONFIRMED: STRIPE_SECRET_KEY is a live production key (sk_live_), currently
           available to Deploy Preview and Branch Deploy Functions.
```

### 🔴 Security priority — live Stripe key in preview contexts

`STRIPE_SECRET_KEY` is `sk_live_` and is currently readable by Deploy Preview
and Branch Deploy Functions. **Any preview deploy can create real charges
against real customers.** This is the highest-severity item in Phase 1 and is
independent of the 4KB problem — it would remain a defect even if the payload
were comfortably under the limit.

```
Live Stripe Payment Links in preview environments
CheckoutPage.jsx:71-72

Payment Link URLs are public-facing and are not secret credentials.
The risk is environment isolation, not credential exposure.

Preview and branch deployments currently direct users to the live
Stripe environment. Testing or interacting with checkout from a
preview can create real production payment activity.

Phase 1 secret scoping does not change this behavior — it closes
the Functions path only.

Scheduled for Document 5: preview/branch contexts should use
test-mode Payment Links or have live checkout disabled.
```

### Stripe classifications

| Variable | Classification | Evidence | Recommendation |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **HIGH_VALUE_SECRET**, live (`sk_live_`) | Confirmed by Aaron | Production keeps the live key. Preview and branch use a **Stripe test secret key** if Stripe functionality is required there — never the live key |
| `STRIPE_WEBHOOK_SECRET` | **HIGH_VALUE_SECRET**, per-endpoint signing secret | `stripe-webhook.js:44` — `stripe.webhooks.constructEvent`. Belongs to the endpoint `/.netlify/functions/stripe-webhook` on the **production site domain** | **Not classifiable from the API key prefix** — it is a separate secret per endpoint. Preview and branch deploys have different URLs, so they need their **own test webhook endpoint and its own signing secret**. A production signing secret in preview cannot validate preview-delivered events |
| `STRIPE_PUBLISHABLE_KEY` | **NOT PRESENT** | Exhaustive search of `src/`, `netlify/` and `.env.example` finds no `STRIPE_PUBLISHABLE_KEY`, no `pk_live_`, no `pk_test_` | **No classification required — the architecture does not use one.** Checkout runs through hosted Stripe Payment Links (`CheckoutPage.jsx:71-72`) and a server-created session URL (`create-checkout-session.js:91`); neither needs a client publishable key. If one exists in the dashboard, it is unused and is a removal candidate |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STARTER` | INTERNAL_CONFIG | checkout | Must match the mode of the key in that context — test price IDs with a test key |

### 33 vs 39 variable gap — ledger item

The dashboard reports **33** configured variables; the repository references
**39** distinct names. The gap is not resolvable from the repository. Six
referenced names are the likeliest unconfigured candidates, all with safe
fallbacks:

| Variable | If unconfigured | Risk to the `BARRY_ENV` deployment path |
|---|---|---|
| `BARRY_MODEL_FAST`, `BARRY_MODEL_DEEP` | Literal defaults in `models.js` | **None** |
| `VITE_SHELL_MIGRATION`, `VITE_SUPPORT_EMAIL` | Client-side, falsy | **None** |
| `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Search enrichment degrades | **None on the deploy path** |
| `BARRY_ENV` | Records `unknown` | **Yes — this is the one that matters.** Confirmed configured by Aaron, but it must survive the scope change and be present in the **Functions** scope specifically |

**Flag for Phase 1 verification: `BARRY_ENV` must remain in the Functions scope
after remediation.** If it is scoped to Build only, the deploy succeeds, the
acceptance criteria for the 4KB error pass, and `environment` silently records
`unknown` — a green deploy that fails the actual objective.

### Rollback mapping

Every variable whose configuration changes in Phase 1. **Configuration mapping
only — no secret values.** This is the rollback plan if a downstream Function
breaks hours after a deploy that looked successful.

Current state is identical for every row — All scopes, all contexts — which is
also the rollback target for every row. That uniformity is the reason a partial
rollback is safe: restoring any single variable to All/All cannot conflict with
another.

| Variable | Current scope/context | Approved scope/context | Rollback scope/context | Verification method |
|---|---|---|---|---|
| `BARRY_ENV` | All scopes, all contexts | Functions + per-context values | All scopes, all contexts | Telemetry row shows `environment: production` |
| `STRIPE_SECRET_KEY` | All scopes, all contexts | Functions, **Production live key only**; preview/branch test key or absent | All scopes, all contexts | Checkout session creation succeeds in production |
| `STRIPE_WEBHOOK_SECRET` | All scopes, all contexts | Functions, Production only; preview needs its own test endpoint secret | All scopes, all contexts | Production retains correct live signing secret — see Verification methods |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STARTER` | All scopes, all contexts | Functions; mode must match the key in that context | All scopes, all contexts | Checkout renders correct plan pricing |
| `GOOGLE_CLIENT_SECRET` | All scopes, all contexts | Functions + contexts requiring OAuth | All scopes, all contexts | OAuth refresh on a dedicated test account |
| `GOOGLE_CLIENT_ID` | All scopes, all contexts | Functions + contexts requiring OAuth | All scopes, all contexts | Paired with the secret above |
| `GOOGLE_REDIRECT_URI`, `GOOGLE_CALENDAR_REDIRECT_URI` | All scopes, all contexts | Functions, **context-specific values** — preview URLs differ per deploy | All scopes, all contexts | OAuth round-trip completes on the target context |
| `FIREBASE_PRIVATE_KEY` | All scopes, all contexts | Functions; production key in Production, sandbox key elsewhere | All scopes, all contexts | Any Firestore-touching Function returns 200 |
| `FIREBASE_CLIENT_EMAIL` | All scopes, all contexts | Functions; paired with the key above | All scopes, all contexts | Paired — same check |
| `FIREBASE_PROJECT_ID` | All scopes, all contexts | Functions | All scopes, all contexts | Telemetry row written to the expected project |
| `FIREBASE_API_KEY` | All scopes, all contexts | Functions | All scopes, all contexts | Auth-path Function succeeds |
| `ANTHROPIC_API_KEY` | All scopes, all contexts | Functions; separate key per context | All scopes, all contexts | Telemetry row shows `provider: anthropic`, `status: success` |
| `APOLLO_API_KEY` | All scopes, all contexts | Functions; separate key per context | All scopes, all contexts | Search/enrichment call succeeds |
| `RESEND_API_KEY` | All scopes, all contexts | Functions; production sender in Production only | All scopes, all contexts | Welcome-email path succeeds without sending to a customer |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | All scopes, all contexts | Functions | All scopes, all contexts | Search enrichment returns results |
| `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | All scopes, all contexts | Functions — **or removed if confirmed duplicate** | All scopes, all contexts | Search enrichment unchanged after removal |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_VISION_API_KEY` | All scopes, all contexts | Functions | All scopes, all contexts | Enrichment call succeeds |
| `ADMIN_USER_IDS`, `SUPER_ADMIN_USER_IDS` | All scopes, all contexts | Functions | All scopes, all contexts | Admin endpoint authorises a known admin |
| `BARRY_MODEL_FAST`, `BARRY_MODEL_DEEP` | All scopes, all contexts | Functions — **or removed**, literal defaults exist | All scopes, all contexts | Telemetry `model` field matches expected tier |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_GOOGLE_PLACES_API_KEY` | All scopes, all contexts | **Build only** — Function fallbacks are redundant | All scopes, all contexts | Functions still resolve via non-`VITE_` twin |
| `VITE_FIREBASE_APP_ID`, `_AUTH_DOMAIN`, `_MESSAGING_SENDER_ID`, `_STORAGE_BUCKET` | All scopes, all contexts | **Removal candidates** — held pending verification | All scopes, all contexts | Client app loads and authenticates |
| `VITE_ADMIN_API_BASE`, `VITE_CRISP_WEBSITE_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_REDIRECT_URI`, `VITE_SHELL_MIGRATION`, `VITE_STRIPE_ENABLED`, `VITE_SUPPORT_EMAIL` | All scopes, all contexts | **Build only** | All scopes, all contexts | Client build succeeds; affected UI renders |

**Rollback trigger.** Any of the nine acceptance criteria failing, or any
Function error surfacing in the hours after the deploy. Because telemetry is the
detector and `logApiUsage` swallows its own failures, **an absence of error rows
is not evidence of success** — check for the presence of expected rows, not the
absence of failures.

### Payload projection

```
Current Function payload:
~4,900 bytes (120% of 4,096 limit)

Projected payload after approved scope/context remediation:
~3,900 bytes (95% of 4,096 limit)

Assessment:

  Operational hypothesis:
    Expected to fall below the AWS Lambda 4KB deployment limit.

  Architectural assessment:
    Still exceeds the 90% headroom standard.

  Evidence status:
    Projection only. Actual deployment result after remediation
    determines whether the hypothesis is confirmed.
```

### Phase 1 acceptance criteria — all nine must pass

```
✓ PR #521 deploy succeeds
✓ All Netlify Functions upload successfully
✓ No 4KB environment error occurs
✓ Production Functions still have all required secrets
✓ No Function loses required runtime configuration after scope changes
✓ Normal production Barry call succeeds
✓ Telemetry row shows environment: production
✓ No production-only secret exposed to preview/branch contexts
✓ STRIPE_SECRET_KEY live key not present in Deploy Preview or Branch Deploy
```

### Secret Classification Matrix

| Secret | Criticality | Rotation Difficulty | Break Impact | Rotation Owner |
|---|---|---|---|---|
| `FIREBASE_PRIVATE_KEY` | Critical | High | Entire backend — every Function that touches Firestore or Auth | Aaron |
| `FIREBASE_CLIENT_EMAIL` | Critical | High | Paired with the key; same blast radius | Aaron |
| `STRIPE_SECRET_KEY` | Critical | Medium | Payments — checkout and subscription management | Aaron |
| `STRIPE_WEBHOOK_SECRET` | Critical | Low | Subscription state drifts silently: events are rejected, Stripe retries, entitlements go stale without a user-visible error | Aaron |
| `ANTHROPIC_API_KEY` | High | Low | All AI disabled — every Barry surface | Aaron |
| `APOLLO_API_KEY` | High | Low | Search and enrichment disabled; credit-bearing | Aaron |
| `GOOGLE_CLIENT_SECRET` | High | Medium | Gmail and Calendar OAuth breaks; existing tokens survive until refresh, so failure is delayed and looks intermittent | Aaron |
| `RESEND_API_KEY` | Medium | Low | Transactional email disabled (welcome emails) | Aaron |
| `FIREBASE_API_KEY` | Medium | Medium | Auth-related Function paths | Aaron |
| `GOOGLE_SEARCH_API_KEY` | Medium | Low | Search enrichment degrades | Aaron |
| `GOOGLE_PLACES_API_KEY` | Medium | Low | Place enrichment degrades | Aaron |
| `GOOGLE_VISION_API_KEY` | Medium | Low | Vision enrichment degrades | Aaron |
| `GOOGLE_CUSTOM_SEARCH_API_KEY` | Low | Low | Possibly none — suspected duplicate | Aaron |
| `ADMIN_USER_IDS`, `SUPER_ADMIN_USER_IDS` | Medium | Low | Admin lockout, or unintended admin access if wrong | Aaron |

Two rotation risks worth stating: `STRIPE_WEBHOOK_SECRET` and
`GOOGLE_CLIENT_SECRET` both fail **silently or on a delay** rather than loudly.
Neither surfaces as an immediate error, so neither is caught by a smoke test
immediately after rotation. Verification methods below are written accordingly.

#### Verification methods

```
Stripe webhook validation:
Verify Production retains the correct live webhook signing secret.
If preview Stripe webhook functionality is required, validate with
a dedicated Stripe test-mode endpoint and signing secret.
Do not require a preview webhook secret if previews intentionally
do not process Stripe webhooks.

Google OAuth validation:
Verify GOOGLE_CLIENT_SECRET remains available to Functions requiring
OAuth and token refresh. Use a dedicated test account or controlled
non-customer verification path. Do not force-refresh a customer
account solely for this deployment check.

Principle: validate required configuration without creating
unnecessary production-side effects.
```

### Deployment Change Checklist — Phase 1

```
Deployment Change Checklist — Phase 1

Before changing Netlify:
□ Export current variable list
□ Screenshot current scopes and contexts for all variables
□ Record current configuration as rollback reference

Applying changes:
□ Apply approved remediation matrix variable by variable
□ Verify each context assignment matches the approved matrix
□ Verify Function scope assignments are correct

After applying changes:
□ Confirm all required Function variables are still present
□ Trigger a new deploy
□ Verify all 9 acceptance criteria
□ Confirm BARRY_ENV row shows environment: production
□ Start baseline if all criteria pass
```

---

## Phase 2 — Migration Risk Assessment

Planning only. No implementation authorized.

**Goal: zero observable behaviour change for customers.** Not a redesign, not an
optimisation. Move Barry safely.

### Workload classification — every function with a custom timeout

| Function | Current type | Timeout | Modern target | Compat risk | Business impact if delayed | Required change |
|---|---|---|---|---|---|---|
| `generate-all-reports` | synchronous HTTP | 900s | background | **HIGH** | Reporting unavailable | Reclassify — 900s synchronous cannot survive a modern request timeout |
| `generate-icp-brief` | synchronous HTTP | 900s | background | **HIGH** | ICP briefs unavailable | Reclassify. Also an A5-b dead-endpoint candidate — verify before investing |
| `generate-section-1` | synchronous HTTP | 900s | background | **HIGH** | RECON section 1 unavailable | Reclassify |
| `generate-section-2` | synchronous HTTP | 900s | background | **HIGH** | RECON section 2 unavailable | Reclassify |
| `generate-section-3` … `-10` | synchronous HTTP | **default** | background | **HIGH** | RECON sections 3–10 unavailable | Reclassify. **See the inconsistency below** |
| `daily-leads-refresh` | scheduled `0 9 * * 1-5` | 900s | scheduled | MEDIUM | Daily lead refresh stops | Verify modern scheduled duration limit accommodates it |
| `process-barry-queue` | scheduled `0 9 * * 1-5` | 900s | scheduled | MEDIUM | Barry queue stops draining | Verify duration limit |
| `process-scheduled-engagements` | scheduled `*/15 * * * *` | 900s | scheduled | MEDIUM | Scheduled sends stop | Verify duration limit |
| `process-barry-inbox-queue` | scheduled `*/5 * * * *` **+ HTTP** | 300s | scheduled | MEDIUM | Inbox analysis stops | Hybrid — exports `schedule()` *and* handles `event.httpMethod`. Both paths must survive |
| `gmail-sync-worker` | scheduled `*/10 * * * *` | 300s | scheduled | MEDIUM | Gmail sync stops | Verify duration limit fits the 50-account walk |
| `adminGetUsers` | synchronous HTTP | 26s | synchronous | LOW | Admin user list slow/unavailable | Standard conversion |
| `barryBulkPersonalize` | synchronous HTTP | 26s | synchronous | LOW | Bulk personalisation unavailable | Standard conversion |
| `analyze-website` | synchronous HTTP | 26s | synchronous | LOW | Website analysis unavailable | Standard conversion |
| `generate-leads` | **does not exist** | 900s | — | — | None | **Stale config — delete the block** |
| `generate-leads-v2` | **does not exist** | 900s | — | — | None | **Stale config — delete the block** |

### RECON long-running workload risk

```
RECON long-running workload risk — HIGH MIGRATION RISK CANDIDATES

generate-section-1 and generate-section-2 have 900-second timeout
configuration. Sections 3-10 appear structurally similar but do not
have equivalent timeout configuration. generate-icp-brief and
generate-all-reports require individual invocation/timeout verification.

Do not assume these workloads must become background Functions from
timeout declarations alone. For each one, Phase 2 must verify:
  - current invocation type
  - actual observed/runtime duration where measurable
  - whether a caller waits synchronously for the response
  - whether modern synchronous limits would be exceeded
  - whether background/queue semantics would alter the product experience

Classify as HIGH MIGRATION RISK CANDIDATES until verified.
If a workload genuinely requires more than the modern synchronous
limit, reclassification becomes a behavioral migration requiring
explicit UX and workflow design — not a mechanical wrapper change.

generate-leads and generate-leads-v2: stale 900s timeout blocks for
functions that no longer exist. Remove as dead configuration in Phase 2.

Sections 1-2 vs 3-10 timeout inconsistency: resolve during Phase 2
readiness work. Do not infer which side is correct from current evidence.
```

### Dependency graphs — scheduled and background workflows

```
process-barry-inbox-queue  (*/5 * * * *, 300s, hybrid scheduled + HTTP)
        ↓ firebase-admin (Firestore: barry_processing_queue)
        ↓ utils/barryInboxAnalyzer  → Anthropic
        ↓ utils/barryDraftComposer  → Anthropic
        ↓ Firestore: barry_drafts
        ↓ contact timeline → notifications

gmail-sync-worker  (*/10 * * * *, 300s)
        ↓ utils/messageProcessor
        ↓ Gmail API (walks up to 50 connected accounts)
        ↓ Firestore: barry_processing_queue  → feeds process-barry-inbox-queue

process-barry-queue  (0 9 * * 1-5, 900s)
        ↓ firebase-admin (Firestore queue)
        ↓ Anthropic
        ↓ Firestore writes

process-scheduled-engagements  (*/15 * * * *, 900s)
        ↓ firebase-admin
        ↓ utils/gmailSignature
        ↓ Gmail send
        ↓ contact timeline

daily-leads-refresh  (0 9 * * 1-5, 900s)
        ↓ Apollo / search enrichment
        ↓ Firestore: companies, leads
```

**The critical coupling:** `gmail-sync-worker` writes into
`barry_processing_queue` every 10 minutes, and `process-barry-inbox-queue`
drains it every 5. The cadences are deliberately paired. **Migrating either one
alone changes the pairing**, and the failure mode is a silently growing queue
rather than an error — the same class of defect as A4, where the queue had no
trigger at all and nothing surfaced it.

### Scheduled wrapper migration

All five scheduled functions use `schedule()` imported from `@netlify/functions`
and export `handler = schedule(CRON, fn)`. Under the modern API these move to a
`config.schedule` export. The cron expressions themselves are unchanged:

| Function | Cron | Current form | Modern form |
|---|---|---|---|
| `process-barry-inbox-queue` | `*/5 * * * *` | `export const handler = schedule(QUEUE_SCHEDULE, …)` | `export const config = { schedule: '*/5 * * * *' }` |
| `gmail-sync-worker` | `*/10 * * * *` | `export const handler = schedule(SYNC_SCHEDULE, …)` | `export const config = { schedule: '*/10 * * * *' }` |
| `process-scheduled-engagements` | `*/15 * * * *` | `schedule(…)` | `config.schedule` |
| `process-barry-queue` | `0 9 * * 1-5` | `schedule(…)` | `config.schedule` |
| `daily-leads-refresh` | `0 9 * * 1-5` | `schedule(…)` | `config.schedule` |

Both `process-barry-inbox-queue` and `gmail-sync-worker` export their cron as a
named constant (`QUEUE_SCHEDULE`, `SYNC_SCHEDULE`), so the value is testable and
the migration is mechanical.

### Overall effort: HIGH

The `withLambda()` wrapper preserves handler *contracts* but not necessarily
*execution semantics* — and the semantics are where this codebase carries its
risk: five scheduled workflows with paired cadences, four (plus eight
unconfigured) synchronous 900-second generators that cannot remain synchronous,
and one hybrid scheduled/HTTP function.

**The 900-second synchronous generators are the real work.** They are not a
wrapper problem; they need reclassification to background or queue-driven
execution, and that is a behavioural change to the RECON generation path — the
one surface Aaron has repeatedly protected.
