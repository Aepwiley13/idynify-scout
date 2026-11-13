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

## Current state (recorded 2026-11-13) — read this first

This checklist was written for a first deployment of PR #769. That deployment was **attempted on
2026-11-12 and rolled back the same day**; the release is **not complete**. The timeline and the
open items are in [BILLING_RELEASE_APPROVAL_PACKET.md §0](BILLING_RELEASE_APPROVAL_PACKET.md).
What that changes about following this document now:

- **Production serves `e87691d`, pre-#769 code, with Netlify auto-publishing locked.** The live
  webhook is the unhardened handler. §5's "never roll back below the ledger commit" was violated
  by that rollback, so §6's inventory applies to every purchase since 2026-11-12 19:11:44 UTC —
  the unhardened handler granted them with no `billingAllocations` marker.
- **PR #769 is already merged** (`2f53861f`); `main` is `2b0c0053`. §0.1's "check out the PR
  branch, never `main`" is obsolete — `main` now contains this code and these rules. §2's merge
  is done; what remains is *publishing*, which is blocked by the lock and by the open items.
- **`BILLING_LEDGER_EPOCH_UNIX` is already set** (`1794507945`, written 2026-11-12 18:26:07 UTC).
  §0.2's "must be unset" no longer holds, and §2's "allocation is OFF during the deploy" is
  **false** for any build made after that write — such a build has allocation on from the moment
  it is published. Either clear the variable first to get §2–§4's sequence back, or accept that
  publishing arms it and go straight to §4's verification.
- **§1 (production rules): inspected in the Firebase Console on 2026-11-13.** The published
  version contains `signupBillingLegacyNumber()`, `signupBillingObjectShape()` and
  `signupBilling()` (both numeric and object `credits` accepted at signup) and the server-only
  blocks for the billing ledger collections, so `main`'s signup is not rejected by production
  rules. This was a check for those elements, not a full diff against `main`'s `firestore.rules`,
  and it covers rules only — it is not a statement that the billing workflow is safe to publish.
  Re-check if rules are deployed again before release.
- **`scripts/billingLedgerCutover.mjs` could not have produced any result on 2026-11-12** — its
  env-var read used an API call that returns Not Found. It is fixed now (§0.2); treat any
  activation claim from before the fix as unverified.

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

**Netlify production environment.** The env-var API is account-scoped — it needs the owning
account's id as well as the site id:

```bash
netlify api getSite --data '{"site_id":"<SITE_ID>"}'          # read "account_id" from the output
netlify api getEnvVars --data '{"account_id":"<ACCOUNT_ID>","site_id":"<SITE_ID>"}'
```
(The site-scoped `netlify api getSiteEnvVars` this document used to give returns
`JSONHTTPError: Not Found` — verified 2026-11-13, netlify-cli 27.15.0. The output of `getEnvVars`
includes secret values; do not paste it anywhere.) Check the `production`-context value of each:

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

### 0.3 API compatibility — CONFIRMED, not just checked

**Resolved this session.** Production's webhook endpoint is pinned to **`2025-10-29.clover`** —
confirmed by the account owner, not inferred. This differs from the installed Stripe SDK's own
default (`2025-02-24.acacia`, read from `node_modules/stripe/cjs/apiVersion.js` — no `apiVersion`
is pinned anywhere in this codebase, so every outgoing `stripe.*.retrieve()` call uses acacia
regardless of what the webhook endpoint delivers). A version-string difference is **not**
automatically incompatible — only a mismatch that changes a field this code reads matters.

One real, verified breaking change exists between these two versions, confirmed against Stripe's
own changelog: as of `2025-03-31.basil` and every later version including clover,
`current_period_start`/`current_period_end` are **removed entirely** from the top-level
Subscription object (docs.stripe.com/changelog/basil/2025-03-31/
deprecate-subscription-current-period-start-and-end) — replaced by
`items.data[].current_period_start/end` on each subscription item.

**Correction**: this was first (wrongly) attributed to "flexible billing mode" becoming the
Clover default. A real production payload supplied by the account owner carries
`billing_mode.type: "classic"` and **still** has item-level-only periods — direct proof the
removal is a property of the API version rendering the object, not of which `billing_mode` a
given subscription happens to use. Do not assume any particular `billing_mode` distribution
across live subscriptions; the code doesn't need to know — `resolvePeriod()`'s fallback is driven
entirely by which fields are present, never by `billing_mode`, confirmed by a dedicated test
(`src/test/stripeWebhookCloverApiVersionCompat.test.js`) that classic and flexible resolve
identically. Separately, this app's own `VITE_STRIPE_CHECKOUT_MODE` build flag (§0.2 — session
vs. legacy Payment Link) is unrelated to Stripe's `billing_mode` and carries no implication about
it either way.

`resolvePeriod()` (`netlify/functions/stripe-webhook.js`) already had a fallback to item-level
fields, written before this was confirmed. **Verified this session**, against representative
clover-shaped fixtures for all four relevant event types (`checkout.session.completed`,
`customer.subscription.created/updated/deleted`), including the per-item disambiguation path for
a multi-item subscription — see `src/test/stripeWebhookCloverApiVersionCompat.test.js` (12/12
passing). No code change was needed; the gap was test coverage, not behavior.

Checked and ruled out as *not* affecting this code, also against the real changelog rather than
assumed:
- `cancel_at_period_end` (docs.stripe.com/changelog/basil/2025-07-30/cancel-at-enums): the
  `basil`/`clover` change here only adds new `cancel_at` enum values (`min_period_end`/
  `max_period_end`) for *creating/updating* mixed-interval subscriptions.
  `cancel_at_period_end` itself is unchanged as a read field, and this account doesn't use mixed
  intervals.
- Checkout Session `shipping_details` moved to `collected_information.shipping_details` on
  basil — irrelevant, this codebase never reads `shipping_details` at all (confirmed by grep).
- `items.data[].price.id` (used by `priceIdOfSubscription`/`priceIdOfSession`): unaffected by
  any changelog entry found for these versions.

No further action needed for this item — if the endpoint's configured version changes again in
the future, re-run the same comparison: check docs.stripe.com/changelog between the old and new
version for the object types this code reads (Subscription, Checkout Session, Invoice), and
extend `stripeWebhookCloverApiVersionCompat.test.js` with fixtures for whatever changed.

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

### 6.3 Reconcile — distinguish processed, synced, flagged, pending, and granted

**An event-ledger entry alone must not be read as "credits granted."**
`stripeWebhookEvents/{eventId}` existing means the event reached a transaction commit — nothing
more. `customer.subscription.*` events never grant credits at all (only
`checkout.session.completed` does); even for that type, reaching a commit includes every
non-grant outcome `decideAllocationEligibility` can return (ambiguous, non-credit-granting price,
already granted). The only direct evidence of an actual grant is
`billingAllocations/{subscriptionId}` existing.

A processed `customer.subscription.*` event is not proof the sync itself succeeded, either —
`applySubscriptionLifecycleEvent` marks the ledger (`markLedger: true`) the same way whether
`decideReconciliation` actually applied the fields or refused and flagged ambiguous
(`user_not_found`, `unknown_price`, `customer_mismatch`, `replacement_not_authorized` — confirmed
against every `flagAmbiguous` branch in `decideReconciliation`). "Processed" only means a decision
was made and committed; it says nothing about which decision.

For each event, in order:
1. `stripeWebhookEvents/{event.id}` exists? → **processed**. If not, and the type is
   `customer.subscription.*`, check `stripeWebhookPendingEvents/{customer}/events/{event.id}` →
   **parked, pending** (benign — drains once a binding event arrives) or **not processed**
   (genuine gap).
2. If processed and the type is `customer.subscription.*`: resolve the candidate uid the same
   way the handler does (`event.data.object.metadata.firebaseUID`, else a `users` query by
   `stripeCustomerId == event.data.object.customer`), then check for an associated ambiguous
   record. Reconciliation's own `flagAmbiguous` writes use **two different detail field names**
   depending on the reason (`details.subscriptionId` for `user_not_found`/`unknown_price`/
   `customer_mismatch`; `details.incomingSubscription` for `replacement_not_authorized` — both
   confirmed against the actual call sites, not assumed to share one field) — check both.
   - Found → **FLAGGED, {status}** (report `reason`) — the lifecycle sync was refused, not
     applied, for this event specifically.
   - Not found → compare the resolved user doc's stored `subscriptionStatus` against this
     event's own `data.object.status`. Match → **lifecycle synced, confirmed**. Mismatch → report
     it, but don't treat it alone as a failure: if a *later* event for the same subscription id
     is also in this inventory, its own processing legitimately moved the stored state further
     forward after this one — check for that before escalating a mismatch as a real problem.
3. If processed and the type is `checkout.session.completed`:
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

This performs no writes — use the **read-only** service-account key (`roles/datastore.viewer`),
the same convention `scripts/reconcileBillingSubscriptions.mjs` already documents, never the
write-capable key `scripts/manualCreditRecovery.mjs` needs:
```js
// scripts/reconcileIncidentEvents.mjs — paste as-is, run with:
//   FIREBASE_SERVICE_ACCOUNT_PATH=<read-only key, roles/datastore.viewer> node scripts/reconcileIncidentEvents.mjs /tmp/incident_events.jsonl
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const key = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore();

async function resolveCandidateUid(subscription) {
  if (subscription.metadata?.firebaseUID) return subscription.metadata.firebaseUID;
  const q = await db.collection('users').where('stripeCustomerId', '==', subscription.customer).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

async function findAmbiguousForSubscription(subscriptionId) {
  const [bySubscriptionId, byIncomingSubscription] = await Promise.all([
    db.collection('billingAmbiguousAccounts').where('details.subscriptionId', '==', subscriptionId).limit(1).get(),
    db.collection('billingAmbiguousAccounts').where('details.incomingSubscription', '==', subscriptionId).limit(1).get(),
  ]);
  if (!bySubscriptionId.empty) return bySubscriptionId.docs[0].data();
  if (!byIncomingSubscription.empty) return byIncomingSubscription.docs[0].data();
  return null;
}

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
    const subscription = event.data.object;
    const flagged = await findAmbiguousForSubscription(subscription.id);
    if (flagged) {
      console.log(`${event.id} [${event.type}]: FLAGGED, ${flagged.status} (reason: ${flagged.reason}) — lifecycle NOT applied for this event`);
      continue;
    }
    const uid = await resolveCandidateUid(subscription);
    if (!uid) { console.log(`${event.id} [${event.type}]: processed, but no uid resolvable now and no flag found — investigate`); continue; }
    const userDoc = await db.collection('users').doc(uid).get();
    const storedStatus = userDoc.data()?.subscriptionStatus;
    if (storedStatus === subscription.status) {
      console.log(`${event.id} [${event.type}]: lifecycle synced, confirmed (subscriptionStatus matches: ${storedStatus})`);
    } else {
      console.log(`${event.id} [${event.type}]: stored subscriptionStatus "${storedStatus}" != event status "${subscription.status}" — check for a LATER event for ${subscription.id} in this inventory before escalating (it may have legitimately moved the state further)`);
    }
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
**Expected result:** every event prints exactly one of `GRANTED`, `FLAGGED, {pending|resolved}`,
`lifecycle synced, confirmed`, a reported status mismatch, `processed, no grant and no flag`,
`PARKED, pending`, or `NOT PROCESSED`. Treat `NOT PROCESSED` as still open; treat any `FLAGGED,
pending` as still open (needs a human decision, §7); treat an unexplained status mismatch (no
later event for the same subscription accounts for it) as still open. Only `GRANTED`, a
confirmed `lifecycle synced`, `FLAGGED, resolved`, and a confirmed-correct `processed, no grant
and no flag` count as closed.

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
