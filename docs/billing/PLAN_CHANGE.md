# Starter → Pro on the existing subscription (W3)

**Status:** code and tests in the W3 PR. Validated in Stripe test mode: not yet (scenarios below).
Nothing here changes production Stripe, Firebase or Netlify by itself.

## What the customer sees

Settings → Billing, for a Starter customer:

1. **Upgrade to Pro.** Idynify asks Stripe for its own preview of what is due today: the rest of the
   current period at Pro's price, less the unused Starter time.
2. The page shows that amount, the renewal date and price, and the extra credits
   (1,250 − 400 = 850). **Confirm upgrade** or **Not now**.
3. On Confirm, the **same subscription** moves to the Pro price. Pro access and the credits arrive
   once Stripe reports the paid change; the page waits for that (usually seconds).
4. If the bank wants confirmation (3-D Secure) or the card fails, the customer is on Starter until
   the invoice is paid on Stripe's invoice page. Nothing else changes.

A Scout "Upgrade to Pro" link for a Starter customer goes to this screen with the preview open,
never to a checkout. **Manage billing** opens Stripe's Customer Portal: payment methods, invoices,
billing details and cancelling at the end of the period. Plan switching is off in the portal.
Pro → Starter goes through support for now.

## How it is made safe

| Risk | Safeguard |
|---|---|
| A second subscription | `change-plan.js` only calls `subscriptions.update` on the subscription on file, after checking customer, status, single Starter item, no pending update, no schedule, not set to cancel. It never creates a session, customer or subscription (asserted by tests) |
| Pro access before payment | `payment_behavior: 'pending_if_incomplete'`: Stripe keeps Starter until the prorated invoice is paid. Access and credits come only from the webhook seeing the paid Pro price |
| A different amount from the one shown | The preview's `proration_date` is passed to the update (Stripe's documented way to match them). A preview older than 30 minutes is refused |
| A double click or a resent request | Stripe idempotency key: subscription, Pro price and proration date |
| Credits granted twice | `billingAllocations` marker per subscription, price and period; the event ledger; the account lock. A switch back and forth in one period grants once |
| Credits taken on a downgrade | None are taken back |
| An unknown portal | `create-portal-session.js` uses only Idynify's configuration (`STRIPE_PORTAL_CONFIGURATION_ID`), never the default |

The webhook change also corrects a gap that existed before W3: a plan change made in the Stripe
Dashboard (for example by support) is now reflected in the account's tier, limits and features.

## Stripe test-mode scenarios (add to the checkout validation run)

| # | Scenario | Pass |
|---|---|---|
| P1 | A Starter account → Upgrade to Pro → Confirm, card `4242…` | Preview amount equals the invoice. One subscription (same id), Pro price. Account: `pro`, 850 more credits, one `plan_change` marker |
| P2 | Same, card `4000 0027 6000 3184` (authentication required) | "Confirm the payment" link; account stays Starter until the invoice is paid there, then Pro |
| P3 | Same, card `4000 0000 0000 0341` (attaches, charge fails) | Stays Starter; the pending update expires; no Pro, no credits |
| P4 | `stripe events resend` the P1 `customer.subscription.updated` | No change; still one marker |
| P5 | Manage billing → update card, view invoice, cancel at period end | Portal shows no plan switching. Account `cancelAtPeriodEnd: true`; Upgrade to Pro is not offered |
| P6 | A Starter account opens `/checkout?tier=pro` | Lands on Billing with the Pro preview open. Still one subscription |

The restricted test-mode key needs, in addition to the checkout list: **Subscriptions: Write**
(the update), **Invoices: Read** (the preview), **Customer portal: Write** (sessions).

## Production configuration (owner approval, each separately)

1. In live Stripe, create a portal configuration with the same settings as
   `scripts/staging/stripeTestModeSetup.mjs` (payment methods, invoices, billing details, cancel at
   period end; **plan switching off**). Set its id as `STRIPE_PORTAL_CONFIGURATION_ID` in Netlify.
   Without it, Manage billing says it is not available yet and nothing else is affected.
2. The live webhook endpoint already receives `customer.subscription.updated`; nothing to add.

## Monthly renewal (W4b)

`invoice.paid` with `billing_reason: 'subscription_cycle'` resets the plan's monthly allowance
(Starter 400, Pro 1,250; unused credits do not carry over) for the subscription on file, once per
invoice (`billingAllocations/{subscription}__renewal__{invoice}`), through the same lock and event
ledger. The first invoice (checkout grants it) and a plan change's proration invoice (granted above)
are not renewals. A downgrade at period end renews at Starter's allowance. Invoices from before the
ledger epoch are not granted; without an epoch the renewal is flagged for review.

**Production change (owner approval):** add `invoice.paid` to the live webhook endpoint's events in
Stripe. Staging: add `invoice.paid` to the `stripe listen --events` list. Without it, renewals are
not granted, and with metering on (W4a) paying customers would run out, so the two go live together.

Test mode: a customer on a test clock, subscribed, clock advanced past the period end →
`invoice.paid` (subscription_cycle) → the allowance resets once; `stripe events resend` changes nothing.
