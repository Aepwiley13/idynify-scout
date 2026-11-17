# Phase 2 — Stripe Customer Portal: what it can and cannot do for us

**Status: verification of Stripe's API definitions done; test-mode verification not yet run.**
Nothing here changes code, Stripe or Firebase. Phase 2 implementation is not approved.

## The owner's preferences, against what Stripe handles by itself

| Preference | Stripe alone? | How |
|---|---|---|
| Payment details, invoices, cancellation in the Customer Portal | **Yes** | The portal configuration from `stripeTestModeSetup.mjs`: payment methods, invoices, billing details, cancel at period end |
| Simple customer-controlled pause and resume | **Not yet safely.** Portal pause exists only on the newest API in the redesigned portal (3 weeks old), and it is immediate | Stripe's own scheduled pause and resume calls, from one small function (below) |
| Upgrades only after payment | **No.** The portal has no "apply after payment" setting | Stripe's pending updates, from the same small function |
| Downgrades at period end | Portal yes, but turning portal plan switching on also allows unpaid upgrades | Stripe's subscription schedule, from the same function |
| No unexpected automatic charges | Partly | Cancel and pause never charge. Resume and upgrade show the amount and date and need the customer's confirmation before the call is made |
| Data kept when paid access ends | **Yes, already** | Paid access is one server-written flag. Ending it never touches contacts, stickers, notes or profiles; the account becomes Free |

So the only custom piece is **one server function that makes four kinds of Stripe call**. Stripe
does all the billing: proration, payment, schedules and invoices. There is no new database,
scheduler or ledger.

## How this was verified, and what that does and does not prove

`docs.stripe.com` cannot be reached from the cloud session this was written in (its host is not
on the network allowlist), so Stripe's guides were not read. The Stripe API was instead read
from the official Node SDK's type definitions, which Stripe generates from its OpenAPI spec and
which document every parameter:

| Source | Version | API version it describes |
|---|---|---|
| Installed in this repository | `stripe` 17.7.0 | `2025-02-24.acacia` (every outgoing call today) |
| Newest published (downloaded from npm for reading, not installed) | `stripe` 23.1.0, 2026-10-29 | `2026-10-28.endive` |
| Live webhook endpoint (runbook §0.3) | — | `2025-10-29.clover` |

The types prove **which settings exist** and Stripe's own one-line description of each. They do
not prove **runtime behaviour** (what a customer sees, which events fire, what happens when a card
fails). Every "verify in test mode" row below is a scenario for
[STRIPE_TEST_MODE.md](STRIPE_TEST_MODE.md) with test clocks, once the owner has created the
test-mode key.

## The five requirements

| # | Requirement | Portal can do it? | Evidence | Smallest way to meet it |
|---|---|---|---|---|
| 1 | Starter → Pro prorated, extra access and credits only after payment | **No, not on its own.** The portal's plan-switch feature has `proration_behavior` (`none`, `create_prorations`, `always_invoice`) but **no payment-behaviour setting**, in 17.7.0 and in 23.1.0 (`billing_cycle_anchor`, `default_allowed_updates`, `enabled`, `products`, `proration_behavior`, `schedule_at_period_end`, `trial_update_behavior` — nothing else). A portal upgrade changes the price at once and then tries to collect. | `BillingPortal.ConfigurationCreateParams.features.subscription_update`, both SDKs | **Custom, small:** an in-app "Upgrade to Pro" that calls `subscriptions.update` with the Pro price, `proration_behavior: 'always_invoice'` and `payment_behavior: 'pending_if_incomplete'`. Stripe then applies the change **only once the prorated invoice is paid**; an unpaid change is discarded at `pending_update.expires_at` (both quoted from the SDK). The webhook grants Pro and the extra credits when it sees the new price, so nothing is granted before payment. |
| 2 | Pro → Starter at the end of the paid period | **Yes** — `subscription_update.schedule_at_period_end.conditions: [{ type: 'decreasing_item_amount' }]` ("When any condition is true, the update will be scheduled at the end of the current period"). | same, both SDKs | Portal could do it, but enabling portal plan switching also enables portal **upgrades** without payment gating (row 1). So: an in-app "Switch to Starter at renewal" that adds a Starter phase at `current_period_end` with a subscription schedule, and "Keep Pro" that releases it. Same function as row 1. |
| 3 | Cancel at period end, reversible before then | **Cancel: yes** — `subscription_cancel.mode: 'at_period_end'` (or `immediately`). **Reversal: not shown in the types**; the portal's "renew" option for a scheduled cancellation is a runtime behaviour. | `features.subscription_cancel`, both SDKs | Portal, as configured by `stripeTestModeSetup.mjs`. **Verify in test mode (V5)** that a customer can undo a scheduled cancellation in the portal. If not, an in-app "Keep my plan" that sets `cancel_at_period_end: false` — one call. The webhook already mirrors `cancelAtPeriodEnd` and, on the final `customer.subscription.deleted`, ends paid access (the account becomes Free, data untouched). |
| 4 | Pause and resume independently; customer-chosen length or manual resume, no forced 3 months | **Only on the newest API.** `features.subscription_pause` (duration `indefinite` or preset `interval_options`, up to 3 years) arrived in SDK 23.1.0 on 2026-10-29 for API `2026-10-28.endive`, and "Customers can only pause subscriptions in the redesigned customer portal". The installed 17.7.0 has no portal pause: an older portal pause was deprecated and removed from the SDK in 15.0.0 (2024-04-10). A native `subscriptions.pause` / `resume` exists from SDK 23.0.0 (API `2026-09-30.endive`). | 23.1.0 types and CHANGELOG | See "Pause" below. |
| 5 | Paid access through the paid period, then Free | Depends on the mechanism: cancellation at period end does this already; a native pause is **immediate** ("Pauses a subscription by transitioning it to the paused status") unless scheduled. | `Subscriptions.pause`, `SubscriptionSchedules.pause_schedules` | Pause at `current_period_end` with a subscription schedule's `pause_schedules[].pause.pause_at: { type: 'timestamp', timestamp }`. |

## Pause: three ways, one recommendation

| | A. Native pause, scheduled at period end (**recommended**) | B. Portal pause (redesigned portal) | C. `pause_collection` (works on today's API) |
|---|---|---|---|
| Status while paused | `paused` | `paused` | stays `active` ("the subscription status will be unchanged and will not be updated to `paused`") |
| Access through the paid period | Yes: `pause_at` = `current_period_end` | Not shown; a native pause is immediate, and by default credits unused time (`bill_for.unused_time_from` defaults to `now`). **Verify (V7)** | Yes: the current period was paid; the next invoice is voided |
| Billing periods while paused | Do not advance ("will not advance to new billing periods") | Same | Keep advancing; each invoice is voided, kept as draft, or marked uncollectible (`behavior`) |
| Customer-chosen length | Optional `resume.resume_at`; omit for manual resume | Preset options, or indefinite | Optional `resumes_at` |
| Resume and the next charge | `resume` with `payment_behavior: 'resume_on_payment_success'` (active only once paid) and `billing_cycle_anchor: now` (a fresh period starts and is invoiced at once). We show the amount and date first and ask the customer to confirm | Portal-driven | Clearing `pause_collection`; the next charge is the next period boundary unless the billing cycle is reset |
| What it needs | Calls on API `2026-10-28.endive` (per-request `apiVersion`, or `rawRequest`, from today's SDK; no SDK upgrade). The webhook must treat `paused` as "no paid access" | The redesigned portal switched on (owner, Stripe Dashboard), a portal configuration created on the new API, the same webhook change | The webhook must work out from the voided invoice that the current period is unpaid |
| Maturity | Endpoint about 7 weeks old | About 3 weeks old | Long-standing |

**Recommendation: A**, through one small server function the Billing page calls. It is the only
option that meets all of "keeps the paid period", "customer picks a length or resumes by hand"
and "explicit confirmation before a new charge" with Stripe doing the billing. B is attractive
later, once it has settled and been verified (V7). C is the fallback if the owner does not want
any call on the 2026 API versions.

Webhook payloads would stay on the endpoint's `2025-10-29.clover` version. `paused` has been a
subscription status since 2023 (SDK 11.9.0), long before clover, so the existing lifecycle
handler should receive it. **Verify (V6)** exactly what the clover-rendered `customer.subscription.updated` looks like
for a scheduled pause and a resume.

## What Phase 2 would therefore build (for approval later)

One server function, `manage-subscription`, with five actions. Each takes the uid from the
verified ID token and the customer from the account, checks the subscription belongs to that
customer and is on a known price, sends an idempotency key, and writes an audit-log entry. None
writes the account's billing fields; the webhook mirrors what Stripe did.

| Action | Stripe call |
|---|---|
| `upgrade` (Starter → Pro) | `subscriptions.update`: Pro price, `always_invoice`, `pending_if_incomplete` |
| `schedule_downgrade` / `keep_plan` | Subscription schedule: Starter phase from `current_period_end` / release it |
| `pause` (length optional) | Subscription schedule `pause_schedules`, pausing at `current_period_end` |
| `resume` | `subscriptions.resume`, `resume_on_payment_success`, after the customer confirms the previewed amount |
| `undo_cancel` | Only if V5 fails: `cancel_at_period_end: false` |

The portal stays as configured now: payment methods, invoices, billing details and cancellation
at period end. **Plan switching and pause stay off in the portal**, so there is exactly one way
to change a plan and it is the one whose rules we control.

### Webhook changes that must land first

Portal plan switching was never to be enabled before these. With the in-app path above it does
not need to be enabled at all, but the webhook still needs them:

1. **Plan mirroring.** On every lifecycle event, set `subscriptionTier`, `tierLimits` and
   `features` from the subscription's own price (`STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO`).
   Today only the first checkout sets them, so a plan change made anywhere in Stripe is never
   reflected.
2. **Upgrade credits, once.** When the price moves Starter → Pro, add the difference
   (1,250 − 400 = 850) once, with a `billingAllocations` marker keyed by subscription, period
   start and price, so a replay never grants twice. A downgrade takes nothing back; the next
   renewal grants Starter's amount (Phase 3).
3. **Paused means no paid access.** `paused` ends paid access (the account is Free, nothing is
   deleted); a resume that Stripe reports `active` restores it. Today only `canceled` and
   `incomplete_expired` end access. Needs the decision below on `unpaid`.
4. **Re-run the rehearsal.** The staging rehearsal and emulator suites gain scenarios for each,
   including replays and out-of-order delivery.

No change to the epoch, the allocation guards or the publishing lock.

## Test-mode verification to run (needs the owner's test-mode key)

Each uses a customer created on a test clock, the portal configuration from
`stripeTestModeSetup.mjs`, and `stripe listen` forwarding to the local functions.

| # | Scenario | Pass |
|---|---|---|
| V1 | Upgrade with `pending_if_incomplete`, card `4242…` | Price changes only after the prorated invoice is paid; one `customer.subscription.updated` with the Pro price |
| V2 | Same upgrade, card `…0341` (attaches, charges fail) | The subscription keeps the Starter price; `pending_update` set, then discarded at `expires_at`; no Pro access, no credits |
| V3 | Downgrade scheduled at period end, then advance the clock past it | Starter price from the new period; the customer was not refunded or charged mid-period |
| V4 | Downgrade scheduled, then "keep Pro" before period end | Schedule released; Pro renews |
| V5 | Portal cancel at period end, then try to undo it in the portal | Record whether the portal offers it. Then advance past period end: `customer.subscription.deleted`, account Free, contacts intact |
| V6 | Native pause scheduled at period end (API `2026-10-28.endive`), clock advanced past it | Access through the paid period; then status `paused`; record the clover-rendered webhook payloads |
| V7 | Portal pause (redesigned portal, if the owner switches it on in test mode) | Record whether it pauses immediately or at period end, and what it credits |
| V8 | Resume a paused subscription with `resume_on_payment_success`, card `4242…` then `…0341` | Paid: active and charged once for a new period. Failed: stays paused, no access |
| V9 | Each of V1–V8 with the event redelivered (`stripe events resend`) | No second grant, no state regression |

## Decisions for the owner

1. **Pause mechanism: A** (recommended), B, or C.
2. **What `unpaid` and `past_due` mean for access.** Today both keep paid access, because only
   `canceled` and `incomplete_expired` end it. Recommendation: keep access while Stripe retries
   (`past_due`), end it at `unpaid` (Stripe has given up). A smaller customer base makes this
   low-risk either way; it needs deciding because pausing touches the same code.
3. **Calls on the 2026 API versions** for pause, resume and schedules, by per-request
   `apiVersion` (no SDK upgrade, and no change to the live endpoint's version).
