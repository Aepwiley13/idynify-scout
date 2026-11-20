# Authenticated checkout — Stripe test-mode validation

**Purpose:** prove the authenticated checkout (billing Phase 1b, PR #803) in Stripe **test mode**
before it replaces the Payment Links in production. Run by the owner on the operator machine,
against `idynify-staging`. Nothing here touches live Stripe, production Firebase or Netlify,
and no secret is ever pasted into a chat, a ticket, a commit or a file inside the repository.

Background and tooling: [STRIPE_TEST_MODE.md](STRIPE_TEST_MODE.md). The read-only checker used
after every scenario is `scripts/staging/billingAccountSnapshot.mjs`.

## 1. Create a restricted test-mode key (once)

1. In the Stripe Dashboard, switch on **Test mode** (the toggle at the top). The Dashboard shows a
   test-mode banner. Do every step below with the banner showing.
2. Open **Developers → API keys → Create restricted key**. Name it
   `idynify-staging-validation (test)`.
3. Give it only what the staging run uses:

   | Resource | Access | Used by |
   |---|---|---|
   | Customers | Write | checkout creates the customer |
   | Checkout Sessions | Write | checkout creates, reads and lists sessions; the webhook reads line items |
   | Subscriptions | Read | duplicate check, webhook, snapshot |
   | Products, Prices | Write | the one-time catalog setup |
   | Customer portal | Write | the one-time portal configuration |
   | Everything else | None | — |

   The Dashboard groups these resources slightly differently from this table. Anything not
   listed stays at None.
4. Create it. The key starts `rk_test_`. **If it starts `rk_live_`, stop:** test mode was off.
   Delete that key at once and start again from step 1.
5. Store it on the operator machine, typed at a hidden prompt, in a file outside the repository
   that only you can read:
   ```bash
   umask 077
   ```
   ```bash
   read -rs STRIPE_TEST_KEY
   ```
   (Paste the key at the hidden prompt and press Enter; nothing is shown.)
   ```bash
   printf 'STRIPE_SECRET_KEY=%s\n' "$STRIPE_TEST_KEY" >> ~/idynify-staging/.env.billing && unset STRIPE_TEST_KEY
   ```
   `~/idynify-staging/.env.billing` is the staging env file. The preflight refuses an env file
   that git could commit, and refuses any key that is not a test-mode key.
6. To use the key in a shell for the setup script or the snapshot, read it from that file
   without printing it:
   ```bash
   export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
   ```

When validation is finished: Dashboard (test mode) → Developers → API keys → the key → **Delete**,
and remove the line from the env file.

## 2. Prepare the run (once per session)

1. Check out the integration branch, the one being validated, in the clone used for staging work
   (not linked to Netlify). Run `npm ci`.
2. One-time catalog and portal, if not done yet: `node scripts/staging/stripeTestModeSetup.mjs`,
   then the same with `--apply`. Copy the printed ids into the env file.
3. The env file holds, besides the staging Firebase values:
   ```
   STRIPE_SECRET_KEY=rk_test_…                (step 1.5)
   STRIPE_WEBHOOK_SECRET=whsec_…              (step 2.4)
   STRIPE_PRICE_STARTER=price_…               (setup script)
   STRIPE_PRICE_PRO=price_…                   (setup script)
   STRIPE_PORTAL_CONFIGURATION_ID=bpc_…       (setup script)
   BILLING_LEDGER_EPOCH_UNIX=…                (`date +%s` now; staging's own value)
   VITE_STRIPE_ENABLED=true
   VITE_CONTACT_HUB=on
   VITE_FREE_PLAN=on
   ```
4. In a second terminal, forward Stripe's test events to the local functions and leave it running:
   ```bash
   stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted
   ```
   Put the `whsec_…` it prints into the env file.
5. Check, then start the app:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.billing --billing
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.billing --billing
   ```
   The app is at `http://localhost:8888`.
6. After each scenario, check the account (read-only):
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/billingAccountSnapshot.mjs --email=<the scenario's test address>
   ```
   It prints the plan, the account's billing fields, its grants, its Stripe subscriptions and
   sessions, and ✓/✗ checks. Exit 0 means every check passed.

Use a new address for each scenario (for example `you+s1@yourdomain`). Test cards: `4242 4242 4242
4242` succeeds; `4000 0000 0000 0002` is declined; `4000 0000 0000 9995` is declined for
insufficient funds; any future expiry, any CVC.

## 3. Scenarios

| # | Scenario | Steps | Pass |
|---|---|---|---|
| S1 | **Successful payment, Starter** | Sign up with no card → Contact Hub opens. Settings → Billing shows Free → **Upgrade to Starter** → Stripe Checkout → `4242…` → pay | The success page says it is setting up, then continues into the product (never back to checkout). Snapshot: plan `starter`, 1 live subscription, 400 credits, 1 grant, all ✓. In `stripe listen`: `checkout.session.completed` answered 200 |
| S2 | **Successful payment, Pro** | As S1 with **Upgrade to Pro** | Snapshot: plan `pro`, 1,250 credits, all ✓ |
| S3 | **Canceled checkout** | New Free account → Upgrade to Starter → on Stripe's page use the back arrow | Lands on the cancel page; the account is still Free; snapshot shows no subscription. Upgrade again → the same Stripe session opens (same URL). Then expire it (`stripe checkout sessions expire <cs_… from the snapshot>`) and upgrade again → a new session opens, no error |
| S4 | **Declined payment** | New Free account → Upgrade → card `4000 0000 0000 0002`; then `4000 0000 0000 9995` | Stripe shows the decline on its page; no payment. Snapshot: plan `free`, no live subscription, no grant, no pending review. The account can retry with `4242…` and then passes as S1 |
| S5 | **Resubscription** | The S1 account → in the Stripe Dashboard (test mode) cancel its subscription **immediately** | Snapshot: plan `free`, the subscription `canceled`, all ✓; the account still opens Contact Hub with its people. Then Upgrade to Starter again → pay → snapshot: plan `starter`, the same customer, one canceled and one active subscription, 2 grants, all ✓ |
| S6 | **Existing subscriber tries to buy again** | The S2 (Pro) account: (a) Settings → Billing; (b) open `http://localhost:8888/checkout?tier=starter` directly; (c) any Scout "upgrade to Pro" link | (a) No checkout link, "Change or cancel plan" goes to support. (b), (c) Sent to Settings → Billing, nothing offered. Snapshot afterwards: still exactly 1 live subscription |
| S7 | **Webhook replay** | Resend S1's `checkout.session.completed`: `stripe events resend <evt_…>` | Snapshot unchanged: credits still 400, still 1 grant |
| S8 | **Free account and paid APIs** (Phase 1c) | A Free account opens Scout | "This is part of Scout" in the app; nothing calls Apollo |

Any ✗ in a snapshot, or any outcome different from "Pass", stops the validation. Record what was
seen and do not publish #803.

## 4. Record

For each scenario: date and time (UTC), who ran it, the test address, pass or fail, and the
snapshot's output (it contains ids, never secrets). Keep the record with the release approval
packet. All of S1–S7 must pass before #803 is published to production. S8 belongs to #806.

## 5. What this does not prove

- Live payments and real cards.
- The production webhook endpoint's delivery, which is `2025-10-29.clover` (runbook §0.3).
- Netlify's own function runtime: `netlify dev` runs the same code locally.

The first real purchase after publishing is still checked with runbook §9.1.
