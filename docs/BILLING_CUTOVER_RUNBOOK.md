# Billing ledger cutover — executable release checklist

Who this is for: the operator deploying this PR to production, or responding to an incident
with it already live. Each step names the exact command and the result that means "proceed."
`scripts/billingLedgerCutover.mjs` is advisory/read-mostly throughout — it reports whether
activation is confirmed, it never gates what the live webhook does with any event. What actually
protects against a double grant is `decideAllocationEligibility`'s own consistency guards
(`already_shows_completed_payment_no_marker`, `subscription_dead_no_marker`) in
`netlify/functions/stripe-webhook.js`, always on regardless of whether this checklist is
followed. This document governs the one thing those guards don't: whether automatic allocation
is active at all.

## 0. Preconditions — all of this before any production deployment

### 0.1 Check out the exact reviewed commit

```bash
git fetch origin claude/billing-hardening-pr1
git checkout claude/billing-hardening-pr1
git log -1 --oneline   # confirm this is the exact SHA that passed review/CI
```
Run every command below from *this* checkout — never from a `main` checkout, which does not yet
contain this PR's code or rules.

### 0.2 Required variables

**Netlify production environment** (`netlify api getSiteEnvVars --data '{"site_id":"<SITE_ID>","context_name":"production"}'`):

| Variable | Status for this deploy |
|---|---|
| `STRIPE_SECRET_KEY` | Pre-existing — confirm still set, live-mode key |
| `STRIPE_WEBHOOK_SECRET` | Pre-existing — confirm still set, matches the endpoint checked in §0.3 |
| `STRIPE_PRICE_STARTER` | Pre-existing — confirm value |
| `STRIPE_PRICE_PRO` | Pre-existing — confirm value |
| `STRIPE_PRICE_SCOUT_STARTER_FREE` | **New this PR.** The $0/mo price from the existing subscriber found during the earlier audit. Confirm set explicitly — if unset, `knownPriceIds()` silently shrinks to the two paid prices only (fails closed, not silently wrong, but don't rely on the fallback) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Pre-existing — confirm still set |
| `BILLING_LEDGER_EPOCH_UNIX` | **New this PR.** Must be **unset** right now (§1 arms it later) |
| `VITE_STRIPE_CHECKOUT_MODE` | Build-time, frontend. **Leave as-is — do not set to `'session'`.** Flipping to the new authenticated-checkout flow is a separate decision outside this PR's scope; the legacy Payment Link flow stays the live default throughout |

**Expected result:** every pre-existing variable is present; `BILLING_LEDGER_EPOCH_UNIX` is
absent; `VITE_STRIPE_CHECKOUT_MODE` is absent or not `'session'`.

**Operator-local** (not deployed anywhere — set only on the machine running the command, only
when actually running it): `STRIPE_SECRET_KEY` and `FIREBASE_SERVICE_ACCOUNT_PATH` (a
WRITE-capable key, never the read-only one) for `scripts/manualCreditRecovery.mjs`. These are
unrelated to the Netlify table above and are never set as site environment variables.

### 0.3 API compatibility — verify actual payload shapes, not version-string equality

A different webhook endpoint API version and a different SDK default version are **not
automatically incompatible** — only a mismatch that actually changes a field this code reads
matters. Don't stop on a string difference alone; check the fields.

The installed Stripe SDK (`stripe` npm package, v17.7.0 within `^17.4.0`) defaults to
**`2025-02-24.acacia`** — read directly from `node_modules/stripe/cjs/apiVersion.js`. No
`apiVersion` is pinned anywhere in this codebase, so every outgoing `stripe.*.retrieve()` call
uses this version self-consistently. The only real external variable is the **incoming webhook
payload shape**, which Stripe renders according to the endpoint's own configured API version
(confirmed against docs.stripe.com/api/events/list: "Each event data is rendered according to
[the] Stripe API version at its creation time" — the endpoint's pinned version, not the caller's).

1. In the Stripe Dashboard: **Developers → Webhooks → (the production endpoint) →** note the
   configured API version.
2. If it reads `2025-02-24.acacia`, done — self-consistent, proceed.
3. If it differs, pull one real recent delivery for this endpoint (**Webhooks → endpoint →
   Recent deliveries → open any `checkout.session.completed` and any
   `customer.subscription.updated` → view payload**) and confirm these exact fields are present
   with the expected shape — the complete set this code reads:
   - Subscription: `status`, `current_period_start`, `current_period_end` (or the per-item
     fallback under `items.data[].current_period_start/end`), `cancel_at_period_end`,
     `pause_collection`, `items.data[].price.id`, `customer`, `created`, `metadata.firebaseUID`,
     `latest_invoice`.
   - Checkout Session: `customer`, `subscription`, `payment_status`, `metadata.firebaseUID`,
     `metadata.userId`, `metadata.checkoutOperationId`, `client_reference_id`, `created`.
   - Invoice (reached via `latest_invoice`, used by `scripts/manualCreditRecovery.mjs`): `status`.

   **Expected result:** every field above is present with the shape the code assumes (a string
   for ids, a unix integer for `created`/period fields, a boolean for `cancel_at_period_end`). If
   any of these specifically changed shape between the two versions (check
   docs.stripe.com/changelog for the object types above, between the endpoint's version and
   `2025-02-24.acacia`), stop and resolve before proceeding — a difference confined to fields this
   code never reads is not a blocker.

### 0.4 Monitoring owner

Assign before deploying, not after:
- **Owner:** `_______________` (fill in — not a fact this document can know; record the
  assignment wherever this team tracks on-call).
- **What they watch:** `billingAmbiguousAccounts` document count and growth rate (a sudden jump
  means something upstream is wrong — a price/env misconfiguration, or an undetected payload-shape
  issue from §0.3); the `stripe-webhook` function's error rate in Netlify's function logs; the
  Stripe Dashboard's own webhook delivery success rate for the production endpoint.

### 0.5 Firestore rules — diff against current main before deploying

This branch's `firestore.rules` is main's rules plus this PR's additions, *as of the commit this
branch forked from*. If anything unrelated has shipped to `main`'s rules since, deploying this
branch's file as-is would silently regress it.

```bash
git fetch origin main
git diff origin/main -- firestore.rules
```
**Expected result:** every line this branch *removes* relative to `origin/main` is one this
branch itself also *rewrote* (visible as a replacement in the same diff, e.g. a line refactored
into a new helper) — never content with no corresponding addition. If you see a removed line
with nothing in this branch replacing it, `main` gained something this branch doesn't have; merge
`origin/main` into this branch and resolve `firestore.rules` before continuing to §1.

## 1. Deploy Firestore rules — before the code deploy

Netlify deploying the site/functions does **not** deploy `firestore.rules` — a separate pipeline
(Firebase CLI against the Firebase project directly, `idynify-scout-dev` per `netlify.toml`'s
documented single-project setup). Rules first, so the new server-only collections
(`billingAllocations`, `billingCheckoutOperations`, `billingAmbiguousAccounts`,
`stripeWebhookEvents`, `stripeWebhookPendingEvents`) are locked down before any code that writes
to them goes live.

```bash
firebase deploy --only firestore:rules --project idynify-scout-dev
```
**Expected result:** CLI prints `✔ Deploy complete!`. Confirm in the Firebase Console (Firestore
Database → Rules tab): "Last published" timestamp is within the last few minutes.
`scripts/rules-check` (already run in CI) verifies the rules' *logic* against an emulator — it
cannot confirm this *production* deploy happened; this step is the one that does.

## 2. Deploy the hardened commit with automatic allocation OFF by default

```bash
git push origin main   # or your normal merge path — Netlify auto-deploys
```
Allocation is off for the whole time this takes: `BILLING_LEDGER_EPOCH_UNIX` is still unset, so
every unmarked purchase is flagged into `billingAmbiguousAccounts` (`epoch_unset`) rather than
auto-granted. **Expected result:** new signups during this window appear as pending
`billingAmbiguousAccounts` records, not lost and not mis-granted.

## 3. Confirm the handler is live and drained, nothing armed yet

```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
```
**Expected result:** `NOT RUNTIME-VERIFIED ACTIVE` with `"reason": "epoch_env_var_not_set"` and
a nested `"deploy"` object showing `"ready": true`. `deploy.ready: true` is what this step exists
to confirm; `epoch_env_var_not_set` just confirms nothing is armed yet, which is correct here. If
`deploy.ready` is `false`, wait and re-run — do not proceed to §4 until it reads `true`.

## 4. Arm, force a rebuild, confirm activation

```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID> --apply --epoch "$(date +%s)"
```
**Expected result:** exits `1`, prints `Wrote BILLING_LEDGER_EPOCH_UNIX=... THIS IS NOT YET
ACTIVE`. Correct — writing the value is never activation (Netlify Functions only see a new env
var from the first deploy *built after* the write).

Trigger a new deploy (any mechanism producing a fresh build — an empty commit push, or "Clear
cache and deploy site" in the Netlify UI), wait for it, then:
```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
```
**Expected result:** `RUNTIME-VERIFIED ACTIVE`. This is the release exit criterion. Ordinary
later deploys of newer hardened commits don't need §3–4 repeated — the epoch is a fixed
historical boundary, not something that tracks every deploy.

## 5. Incident response: pre-ledger rollback is prohibited

**Never roll back below the commit that introduced `billingAllocations` and the
`decideAllocationEligibility` consistency guards.** Code from before that point can grant
credits with no marker at all, and nothing in this system can detect or undo that afterward.

- **If a fix-forward is possible** (the normal case): deploy the fix as a new commit. No special
  procedure — §3–4 confirm activation afterward if wanted, but it isn't required for safety.
- **If the webhook must stop receiving traffic entirely**, with zero rebuild and zero risk of
  pre-ledger code running: disable the endpoint in the Stripe Dashboard (Developers → Webhooks →
  the endpoint → disable). Instant, no Netlify deploy, no code touched.

**This is not a retryable pause — verify what it actually does, don't assume:**
- Verified against Stripe's own docs: if a scheduled retry for an already-failing event comes
  due *while* the endpoint is disabled, Stripe **permanently abandons that retry** — it does not
  resume when you re-enable. (Re-enabling *before* that scheduled retry fires still lets it
  happen normally.)
- Events *created* while disabled are never attempted at all, and re-enabling does **not**
  replay them automatically.
- What does persist regardless: the event itself stays in Stripe's account-wide event log
  (§6 covers exactly how long), and nothing in `stripe-webhook.js` ever runs against it while
  disabled — this is the actual safety property, not an automatic delivery queue.

**Record a durable incident window the moment you disable the endpoint** — `disabled_at` and,
later, `reenabled_at`, as Unix timestamps, written somewhere that survives the incident (a ticket,
an incident doc — not just memory). This window is what bounds the recovery query in §6.

## 6. Recovery after re-enabling: inventory, resend, then reconcile outcomes

Once a genuinely fixed hardened commit is confirmed live (§3–4), re-enable the endpoint and find
its id (`we_...`, from the Dashboard endpoint URL, or `stripe webhook_endpoints list`).

**Verified retention/resend limits — four different numbers for four different things, not one
"ceiling":**

| Mechanism | Limit | Verified against |
|---|---|---|
| Event retrieval (`GET /v1/events`, `stripe get /v1/events`) | 30 days from creation | docs.stripe.com/api/events/list |
| Dashboard manual resend | 15 days from creation | Stripe's documented dashboard resend window |
| CLI resend (`stripe events resend`) | 30 days from creation | docs.stripe.com/cli/events/resend |
| Financial records (charges, invoices, subscriptions) | **Do not expire** — distinct from the event log entirely | Stripe's standard account data retention |

### 6.1 Inventory ALL relevant events in the window — not filtered by delivery outcome

`delivery_success` is **not** scoped to this one endpoint — it reflects whether *every*
registered destination on the account succeeded (confirmed against docs.stripe.com/api/events/
list: "whether **all webhooks** were successfully delivered"). If this account has any other
destination configured, an event that never reached our disabled endpoint can still read
`delivery_success: true` overall — filtering on it would silently exclude exactly the events this
recovery exists for. Separately, a `200` from *our* endpoint has never meant "credits granted" —
most of `decideAllocationEligibility`'s own outcomes (flagged ambiguous, a non-credit-granting
price, already-granted) return `200` with no allocation. Inventory by window and type only;
§6.3 is what actually sorts out what happened to each one.

```bash
NEXT=""
> /tmp/incident_events.jsonl
for TYPE in checkout.session.completed customer.subscription.created customer.subscription.updated customer.subscription.deleted; do
  NEXT=""
  while :; do
    PAGE=$(stripe get /v1/events -d "created[gte]=<disabled_at>" -d "created[lte]=<reenabled_at>" \
      -d "type=$TYPE" -d limit=100 ${NEXT:+-d "starting_after=$NEXT"})
    echo "$PAGE" | jq -c '.data[]' >> /tmp/incident_events.jsonl
    HAS_MORE=$(echo "$PAGE" | jq -r '.has_more')
    NEXT=$(echo "$PAGE" | jq -r '.data[-1].id // empty')
    [ "$HAS_MORE" = "true" ] || break
  done
done
```
**Expected result:** `/tmp/incident_events.jsonl` has one full event object per line — every
event of a relevant type created in the window, regardless of what Stripe's own delivery
bookkeeping says about any destination.

### 6.2 Explicit resend

`stripe events resend` defaults to the CLI's own local listener — `--webhook-endpoint` must be
passed or nothing reaches production (verified against docs.stripe.com/cli/events/resend):
```bash
jq -r '.id' /tmp/incident_events.jsonl | while read -r EVENT_ID; do
  stripe events resend "$EVENT_ID" --webhook-endpoint=<we_...>
done
```
Resending an event that was already fully, correctly handled is harmless — `stripe-webhook.js`'s
own idempotency check (`stripeWebhookEvents/{eventId}` pre-check) short-circuits it to a plain
`200` with no re-processing.

### 6.3 Reconcile — distinguish delivered, applied, pending, flagged, and granted

**An event-ledger entry alone must not be read as "credits granted."**
`stripeWebhookEvents/{eventId}` existing means the event reached a transaction commit — nothing
more. `customer.subscription.*` events never grant credits at all (only
`checkout.session.completed` does); even for that type, reaching a commit includes every
non-grant outcome `decideAllocationEligibility` can return (ambiguous, non-credit-granting price,
already granted). The only direct evidence of an actual grant is
`billingAllocations/{subscriptionId}` existing.

For each event, in order:
1. `stripeWebhookEvents/{event.id}` exists? → **delivered & processed**. If not, and the type is
   `customer.subscription.*`, check `stripeWebhookPendingEvents/{customer}/events/{event.id}` →
   **parked, pending** (benign — drains once a binding event arrives) or **not processed**
   (genuine gap).
2. If delivered and the type is `customer.subscription.*` → **lifecycle sync only** — report this
   plainly; never imply a credit outcome for a type that cannot produce one.
3. If delivered and the type is `checkout.session.completed`:
   - `billingAllocations/{event.data.object.subscription}` exists → **granted** (credits were
     allocated for this subscription — possibly by this exact event, possibly by a later one for
     the same subscription; this check cannot tell those apart, and doesn't need to: either way
     the subscription is correctly funded now).
   - Otherwise, query `billingAmbiguousAccounts` for `details.sessionId == event.data.object.id`
     (every checkout-originated ambiguous write includes this field — confirmed against every
     `ambiguous.push(...)` call site in `handleCheckoutCompleted`) → **flagged, pending** or
     **flagged, resolved** (report `reason` and `status`).
   - Neither exists → **processed, no grant and no flag** — this is the expected, correct outcome
     for a non-credit-granting price (e.g. the $0 Scout Starter price; `decideAllocationEligibility`
     returns `flag: false` for exactly this case, by design), but report it explicitly rather than
     silently folding it into "granted" or "flagged" — a human scanning results should be able to
     tell "this was a free-tier purchase, nothing to grant" apart from "this actually got credits."

```js
// scripts/reconcileIncidentEvents.mjs — paste as-is, run with:
//   FIREBASE_SERVICE_ACCOUNT_PATH=<write-capable key> node scripts/reconcileIncidentEvents.mjs /tmp/incident_events.jsonl
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const key = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore();

const events = readFileSync(process.argv[2], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).map(JSON.parse);
for (const event of events) {
  const applied = await db.collection('stripeWebhookEvents').doc(event.id).get();

  if (!applied.exists) {
    if (event.type.startsWith('customer.subscription.')) {
      const customerId = event.data.object.customer;
      const parked = await db.collection('stripeWebhookPendingEvents').doc(customerId).collection('events').doc(event.id).get();
      console.log(parked.exists ? `${event.id} [${event.type}]: PARKED, pending (awaiting a binding event for ${customerId})` : `${event.id} [${event.type}]: NOT PROCESSED — recheck function logs`);
    } else {
      console.log(`${event.id} [${event.type}]: NOT PROCESSED — recheck function logs`);
    }
    continue;
  }

  if (event.type.startsWith('customer.subscription.')) {
    console.log(`${event.id} [${event.type}]: delivered — lifecycle sync only, not a credit-granting event type`);
    continue;
  }

  // checkout.session.completed from here on.
  const subscriptionId = event.data.object.subscription;
  const allocation = subscriptionId ? await db.collection('billingAllocations').doc(subscriptionId).get() : null;
  if (allocation?.exists) {
    console.log(`${event.id} [${event.type}]: GRANTED — billingAllocations/${subscriptionId} exists (grantedAt ${allocation.data().grantedAt})`);
    continue;
  }

  const sessionId = event.data.object.id;
  const ambiguous = await db.collection('billingAmbiguousAccounts').where('details.sessionId', '==', sessionId).limit(1).get();
  if (!ambiguous.empty) {
    const d = ambiguous.docs[0].data();
    console.log(`${event.id} [${event.type}]: FLAGGED, ${d.status} (reason: ${d.reason})`);
    continue;
  }

  console.log(`${event.id} [${event.type}]: processed, no grant and no flag — expected for a non-credit-granting price; confirm the price id before assuming this is correct`);
}
```
**Expected result:** every event prints exactly one of `GRANTED`, `FLAGGED, pending`, `FLAGGED,
resolved`, `delivered — lifecycle sync only`, `processed, no grant and no flag`, `PARKED,
pending`, or `NOT PROCESSED`. Treat `NOT PROCESSED` as still open; treat `FLAGGED, pending` as
still open (needs a human decision, §7); only `GRANTED`, `delivered — lifecycle sync only`,
`FLAGGED, resolved`, and a confirmed-correct `processed, no grant and no flag` count as closed.

## 7. Past the 30-day event-retrieval window, or no subscription id can be found at all

**Match recovery to what `scripts/manualCreditRecovery.mjs` actually accepts.** Its
`--evidence-stripe-session-id` argument takes only a Checkout Session id (`cs_...`) or a
Subscription id (`sub_...`) — **never** a charge (`ch_...`) or invoice (`in_...`) id directly.
For the subscription-id form, the tool itself (not the operator) fetches that subscription's
`latest_invoice` and verifies it's `paid` — see its own header.

- **If a subscription id can still be identified** (Stripe subscriptions, like charges and
  invoices, don't expire the way the 30-day event log does): use the `sub_...` form. This covers
  "past the event-log window" entirely, as long as the subscription object itself still exists
  and has a paid `latest_invoice` — which is the normal case, since subscriptions persist
  indefinitely as `canceled` rather than being deleted.
  ```bash
  node scripts/manualCreditRecovery.mjs --uid <uid> --subscription-id <sub_...> --price-id <price_...> \
    --evidence-stripe-session-id <sub_...> --evidence-note "<why>" --operator "<name>"
  ```
- **Genuinely unsupported case — no subscription id obtainable at all** (not expected in this
  system; every grant this PR handles is subscription-based): `manualCreditRecovery.mjs` cannot
  be used. This requires a manual, ad hoc Firestore write outside this tool's validation, which
  means outside this runbook's scope entirely — it needs its own explicit approval and is not a
  step to perform as part of this checklist.
