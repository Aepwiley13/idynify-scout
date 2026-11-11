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

## 1. Required variables — confirm before deploying

| Variable | Scope | Status for this deploy |
|---|---|---|
| `STRIPE_SECRET_KEY` | functions | Pre-existing — confirm still set, live-mode key |
| `STRIPE_WEBHOOK_SECRET` | functions | Pre-existing — confirm still set, matches the endpoint in step 4 |
| `STRIPE_PRICE_STARTER` | functions | Pre-existing — confirm value |
| `STRIPE_PRICE_PRO` | functions | Pre-existing — confirm value |
| `STRIPE_PRICE_SCOUT_STARTER_FREE` | functions | **New this PR** — the $0/mo price from the existing subscriber found during the earlier audit. Confirm set, or `knownPriceIds()`/`isKnownIdynifyPrice` silently shrinks to the two paid prices only (fails closed, not silently wrong — but confirm deliberately, don't rely on the fallback) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | functions | Pre-existing — confirm still set |
| `BILLING_LEDGER_EPOCH_UNIX` | functions | **New this PR** — must be **unset** before step 3; armed in step 6 |
| `VITE_STRIPE_CHECKOUT_MODE` | build | **Leave as-is — do not set to `'session'`.** Flipping to the new authenticated-checkout flow is an explicit, separate decision outside this PR's scope; the legacy Payment Link flow stays the live default throughout this cutover |

Check what's currently set:
```bash
netlify api getSiteEnvVars --data '{"site_id":"<SITE_ID>","context_name":"production"}'
```
**Expected result:** every pre-existing variable above is present; `BILLING_LEDGER_EPOCH_UNIX` is absent; `VITE_STRIPE_CHECKOUT_MODE` is absent or not `'session'`.

## 2. Deploy Firestore rules — separate from, and before, the code deploy

Netlify deploying the site/functions does **not** deploy `firestore.rules` — that's a distinct
pipeline (Firebase CLI against the Firebase project directly, `idynify-scout-dev` per
`netlify.toml`'s own documented single-project setup). Deploy rules first so the new
server-only collections (`billingAllocations`, `billingCheckoutOperations`,
`billingAmbiguousAccounts`, `stripeWebhookEvents`, `stripeWebhookPendingEvents`) are locked down
*before* any code that writes to them goes live — never the other order.

```bash
firebase deploy --only firestore:rules --project idynify-scout-dev
```
**Expected result:** CLI prints `✔ Deploy complete!`. Then confirm in the Firebase Console
(Firestore Database → Rules tab): "Last published" timestamp is within the last few minutes.
`scripts/rules-check`'s suite (already run in CI) verifies the rules' *logic* against an
emulator — it does not and cannot confirm this *production* deploy happened; this step is the
one that does.

## 3. Deploy the hardened commit with automatic allocation OFF by default

```bash
git push origin main   # or your normal merge path — Netlify auto-deploys
```
Allocation is off for the whole time this takes: `BILLING_LEDGER_EPOCH_UNIX` is still unset
(step 1), so every unmarked purchase is flagged into `billingAmbiguousAccounts`
(`epoch_unset`) rather than auto-granted. **Expected result:** new signups during this window are
visible as pending `billingAmbiguousAccounts` records, not lost and not mis-granted.

## 4. Confirm the real Stripe API version matches what this code assumes

The installed Stripe SDK (`stripe` npm package, confirmed this session at v17.7.0 within the
`^17.4.0` range) defaults to API version **`2025-02-24.acacia`** — read directly from
`node_modules/stripe/cjs/apiVersion.js`, not inferred. No `apiVersion` is pinned anywhere in this
codebase, so this default governs how `stripe.webhooks.constructEvent` and every `stripe.*`
call in this PR interpret payloads.

In the Stripe Dashboard: **Developers → Webhooks → (the production endpoint) →** check the
"API version" field on the endpoint detail page.

**Expected result:** it reads `2025-02-24.acacia`. If it differs, STOP — do not proceed past
this step. A mismatch means webhook payloads may carry a different shape than this code assumes
(the original audit flagged exactly this risk: `current_period_start/end` presence,
`subscription.items` structure, and discount/tax fields are the usual places versions diverge).
Resolve by either updating the endpoint's pinned version to `2025-02-24.acacia` in the dashboard,
or — a follow-up code change, out of scope for this deploy — pinning `apiVersion` explicitly when
constructing the Stripe client and re-verifying representative payloads for the endpoint's actual
version.

## 5. Confirm the handler is live and drained, nothing armed yet

```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
```
**Expected result:** `NOT RUNTIME-VERIFIED ACTIVE` with `"reason": "epoch_env_var_not_set"` and
a nested `"deploy"` object showing `"ready": true`. `deploy.ready: true` is what this step exists
to confirm (live, matching commit, drained); `epoch_env_var_not_set` just confirms nothing is
armed yet, which is correct here. If `deploy.ready` is `false`, wait and re-run — do not proceed
to step 6 until it reads `true`.

## 6. Arm, force a rebuild, confirm activation

```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID> --apply --epoch "$(date +%s)"
```
**Expected result:** exits `1`, prints `Wrote BILLING_LEDGER_EPOCH_UNIX=... THIS IS NOT YET
ACTIVE`. This is correct — writing the value is never activation (Netlify Functions only see a
new env var from the first deploy *built after* the write).

Trigger a new deploy (any mechanism that produces a fresh build — an empty commit push, or
"Clear cache and deploy site" in the Netlify UI) and wait for it to finish, then:
```bash
node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
```
**Expected result:** `RUNTIME-VERIFIED ACTIVE`. This is the release exit criterion. Ordinary
later deploys of newer hardened commits don't need steps 5–6 repeated — the epoch is a fixed
historical boundary, not something that tracks every deploy.

## 7. Monitoring ownership and outage deadlines

- **Owner:** the engineer who runs this checklist is the incident owner for this cutover until
  they explicitly hand off (record the handoff wherever this team tracks on-call — not specified
  here because it isn't a fact this document can know). Fill in: `_______________`.
- **What to watch:** `billingAmbiguousAccounts` document count and growth rate (a sudden jump
  means something upstream is wrong — a price/env misconfiguration, or the API-version mismatch
  in step 4); the `stripe-webhook` function's error rate in Netlify's function logs; the Stripe
  Dashboard's own webhook delivery success rate for the production endpoint.
- **Outage recovery deadlines**, tied to the actual Stripe retention windows (verified this
  session, not assumed):
  - If the webhook is merely failing (returning 5xx) rather than deliberately disabled: each
    individual event stops retrying after **3 days** (Stripe's own exponential-backoff retry
    window); after repeated failures, Stripe auto-disables the endpoint entirely and emails the
    account. Fix forward within this window or move to the deliberate-disable procedure in §8.
  - If the endpoint is deliberately disabled (§8): Stripe does **not** auto-resend events that
    arrived while it was disabled. Re-enable and complete manual resend (§8) within **15 days**
    of each event (Dashboard resend window) to use the simplest recovery path; **30 days** is the
    hard ceiling (Stripe CLI resend / event log existence) — past that, see §9.

## 8. Incident response: pre-ledger rollback is prohibited — the tested, supported alternative

**Never roll back below the commit that introduced `billingAllocations` and the
`decideAllocationEligibility` consistency guards.** Code from before that point can grant
credits with no marker at all, and nothing in this system can detect or undo that afterward.

Verified this session (previous versions of this document speculated about a Netlify redirect —
wrong: redirects and env vars both require a rebuild to take effect, same constraint as §6):

- **If a fix-forward is possible** (the normal case): deploy the fix as a new commit. No special
  procedure — §5–6 confirm activation afterward if you want it, but it isn't required for safety.
- **If the webhook must stop receiving traffic entirely**, with zero rebuild and zero risk of
  pre-ledger code ever running: **disable the endpoint directly in the Stripe Dashboard**
  (Developers → Webhooks → the endpoint → disable). This is instant, requires no Netlify deploy,
  and touches no code. Stripe keeps a full copy of every event for 30 days regardless of
  delivery status — nothing is lost, only not yet delivered.
- **Recovery, once a genuinely fixed hardened commit is confirmed live (§5–6):** re-enable the
  endpoint, note its id (`we_...`, from the Dashboard endpoint URL or `stripe webhook_endpoints
  list`), then identify and resend exactly the events that arrived while it was disabled. `stripe
  get` calls the real API directly with the same `created[gte]`/`created[lte]` filter syntax as
  the REST API (verified against docs.stripe.com/api/events/list); `stripe events resend`
  defaults to resending to the CLI's own local listener, so `--webhook-endpoint` must be passed
  explicitly or nothing reaches production (verified against docs.stripe.com/cli/events/resend):
  ```bash
  stripe get /v1/events -d "created[gte]=<disabled_at_unix>" -d "created[lte]=<reenabled_at_unix>" -d "type=checkout.session.completed" -d limit=100
  stripe get /v1/events -d "created[gte]=<disabled_at_unix>" -d "created[lte]=<reenabled_at_unix>" -d "type=customer.subscription.updated" -d limit=100
  stripe get /v1/events -d "created[gte]=<disabled_at_unix>" -d "created[lte]=<reenabled_at_unix>" -d "type=customer.subscription.deleted" -d limit=100
  # for each event id not already applied (cross-check stripeWebhookEvents/{event.id} in Firestore):
  stripe events resend <event_id> --webhook-endpoint=<we_...>
  ```
  Each resent event flows through the exact same hardened path, with the exact same idempotency
  and consistency guards, as any live delivery — a resend is not a special or weaker code path.
  Only events within 30 days of creation can be resent at all (`stripe events resend`'s own
  limit) — past that, see §9.

## 9. Expired-event recovery (past the 30-day Stripe event-log window)

Past 30 days, Stripe's Events API no longer returns the event at all — there's nothing left to
resend. Stripe's charge/invoice/subscription *records* themselves don't expire, unlike the event
log, so recovery falls back to reconstructing from those directly:

1. Identify the affected customer/subscription from Stripe's own records (Dashboard search, or
   `stripe subscriptions list --customer <id>` / `stripe charges list --customer <id>`).
2. Confirm it's a genuine, paid, never-granted purchase for a recognized price.
3. Run `scripts/manualCreditRecovery.mjs` with that evidence — it independently re-verifies
   ownership, price, payment, and subscription status against live Stripe data before writing
   anything (see its own header), exactly as it would for any other flagged account. The missing
   event log changes nothing about how this tool validates; it only changes where the operator's
   evidence comes from (the charge/invoice record directly, rather than a resendable event id).
