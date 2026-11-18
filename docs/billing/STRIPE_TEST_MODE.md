# Stripe test mode for staging billing work

**Who this is for:** whoever validates billing changes before release. Everything here runs
against Stripe **test mode** and the **staging** Firebase project (`idynify-staging`). Nothing
here touches live Stripe, production Firebase or Netlify.

Production billing is governed by [BILLING_CUTOVER_RUNBOOK.md](../BILLING_CUTOVER_RUNBOOK.md)
and [BILLING_RELEASE_APPROVAL_PACKET.md](../BILLING_RELEASE_APPROVAL_PACKET.md). This document
does not change either.

## What the tools allow, and what they refuse

The staging tools refuse every integration key by default. A **billing run** (`--billing`)
allows Stripe and nothing else:

| Variable | Allowed in a billing run | Refused |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…` | Any live key (`sk_live_`, `rk_live_`) by name; anything unrecognisable |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`, the secret `stripe listen` prints | Anything else |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` | `price_…` ids from the setup script below | Anything else |
| `STRIPE_PORTAL_CONFIGURATION_ID` (optional) | `bpc_…` | Anything else |
| `BILLING_LEDGER_EPOCH_UNIX` | Staging's own Unix time in seconds | Missing, or not seconds |
| Every other integration key (Apollo, Anthropic, Gmail, …) | — | Still refused |

Stripe and `BILLING_*` variables are only ever read from the env file. `stagingDev.mjs` drops
them from the shell, so a live key exported in a terminal can never reach the app.

The staging epoch is unrelated to production's (`1794632515`). It only makes the webhook grant
credits in staging the way it does in production. Use the time the session starts.

## One-time setup

1. **The owner creates a restricted test-mode key** (`rk_test_…`), stored outside the repository
   and never pasted into a chat. The exact steps, permissions and storage are in
   [CHECKOUT_TEST_MODE_VALIDATION.md](CHECKOUT_TEST_MODE_VALIDATION.md) §1.
2. **Create the test catalog and portal configuration.** The dry run only reads. `--apply`
   creates what is missing and is safe to run again.
   ```bash
   node scripts/staging/stripeTestModeSetup.mjs
   ```
   ```bash
   node scripts/staging/stripeTestModeSetup.mjs --apply
   ```
   It creates Scout Starter (test, $20/month), Scout Pro (test, $50/month) and a portal
   configuration with payment methods, invoices, billing details and cancellation at the end of
   the period. **Plan switching is off** in that configuration until the webhook mirrors plan
   changes. It prints the env-file lines; they are ids, not secrets.
3. **Install the Stripe CLI** on the operator machine (stripe.com/docs/stripe-cli) and run
   `stripe login`.

## The staging env file

Add to the staging env file (outside the repository, as for sticker QA):

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…          # from step 2 of "Each session"
STRIPE_PRICE_STARTER=price_…           # from the setup script
STRIPE_PRICE_PRO=price_…               # from the setup script
STRIPE_PORTAL_CONFIGURATION_ID=bpc_…   # from the setup script
BILLING_LEDGER_EPOCH_UNIX=…            # `date +%s` when the session starts
VITE_STRIPE_ENABLED=true
VITE_STRIPE_CHECKOUT_MODE=session
VITE_CONTACT_HUB=on                    # free plan testing needs Contact Hub
VITE_FREE_PLAN=on                      # the free plan switch (free-accounts PR)
```

## Each session

1. Start forwarding webhooks to the local functions. Leave it running:
   ```bash
   stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid
   ```
   It prints a `whsec_…` signing secret. Put it in the env file as `STRIPE_WEBHOOK_SECRET`.
2. Check the env file, then start the app:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingPreflight.mjs --env=/path/outside/repo/.env.staging --billing
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingDev.mjs --env=/path/outside/repo/.env.staging --billing
   ```
3. Use Stripe's test cards: `4242 4242 4242 4242` succeeds; `4000 0000 0000 0341` attaches but
   every charge fails; `4000 0025 0000 3155` asks for authentication.

## Simulating time (test clocks)

Renewals, period-end cancellations, downgrades and pauses need time to pass. Stripe test clocks
do that, but only for a customer **created on the clock**. Checkout creates its own customer, so
for time-based scenarios create the customer on a clock first (Dashboard → Billing → Test
clocks, or the CLI), subscribe it there, then advance the clock and watch the webhook in the
`stripe listen` window and the account in the staging Firestore.

## What this never does

- Use a live key, read live data, or change any live Stripe setting.
- Touch production Firebase (`idynify-scout-dev`); the preflight refuses it.
- Deploy anything, or read Netlify's variables (`netlify dev --offline`, unlinked checkout).

Test data can be removed at any time from the Stripe Dashboard in test mode
(Developers → "Delete all test data"); that is the owner's call.
