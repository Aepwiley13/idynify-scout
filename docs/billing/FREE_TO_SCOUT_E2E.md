# Free → Scout: the end-to-end test (W6)

**What it proves, in one run, in a real browser:** a new Free account (no card) can create its
card, add and import people, organize them with stickers and notes, see what Scout would add,
upgrade through Stripe test mode, come back to the same person in Scout, enrich them with credits
charged exactly once, and lose nothing it made. With `--with-pro`, it also moves Starter → Pro on
the same subscription.

It runs on the operator machine against **staging Firebase, Stripe test mode and a local Apollo
stand-in**. No real Apollo request is made (the test checks it), nothing touches production, and
`--base` must be a local address.

## Before the first run

1. Everything in [CHECKOUT_TEST_MODE_VALIDATION.md](CHECKOUT_TEST_MODE_VALIDATION.md) §1–2: the
   restricted test-mode key (add **Subscriptions: Write**, **Invoices: Read** and **Customer
   portal: Write** for `--with-pro`), the test catalog and portal configuration, the env file.
2. Check out the CI-only integration branch (#808), which carries every PR the journey needs.
   My Card (the Contact Hub team) is not in it yet; until it is, run with `--skip-my-card`.
3. In the env file, besides the checkout lines:
   ```
   VITE_CONTACT_HUB=on
   VITE_FREE_PLAN=on
   VITE_STRIPE_ENABLED=true
   CREDIT_METERING=on
   ```
   The staging sticker rollout must allow the new account (the Contact Hub team's
   `feature_flags/stickers`).
4. `npx playwright --version` works (the repository's Playwright is used).

## Each run

1. Forward Stripe's test events, including the renewal event:
   ```bash
   stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid
   ```
2. Start the app with the Apollo stand-in:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.billing --billing --apollo-mock
   ```
3. In a third terminal, with the test-mode key read from the env file (never typed):
   ```bash
   export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/e2e/freeToScout.mjs --skip-my-card --with-pro
   ```
   Add `--headed` to watch it. If Stripe's checkout page changes, the run asks you to pay by hand
   in the window with `4242 4242 4242 4242`.

## What each step checks

| # | Step | Pass |
|---|---|---|
| 1 | Sign up Free | Lands in Contact Hub; the account has no billing fields |
| 2 | My Card | Pending until the Contact Hub team's My Card is merged (`--skip-my-card`) |
| 3 | Add one person, import five from CSV | "5 people added."; 6 people in `users/{uid}/contacts` |
| 4 | Sticker and note on Ana Lopez | Both visible |
| 5 | Scout preview | "Scout can fill in the rest"; **no paid function called and no Apollo call** so far; account snapshot taken |
| 6 | Upgrade to Scout → Scout Starter → Stripe | Paid on Stripe's test page; success page reached |
| 7 | Back in Scout | On `/contact/<Ana>`; the billing checks all pass (one customer, one subscription, 400 credits, one grant); same uid |
| 8 | Enrich Ana | The stand-in was called with the mock key only; credits down; **one** charge in the credit log |
| 9 | Nothing lost | Every person, sticker, note, the card and any other document unchanged; Ana gained values only in empty fields; only billing fields changed on the account |
| 10 | `--with-pro` | Same subscription id, Pro, still one live subscription |

The report (JSON) is written to the system temp directory and printed at the end. Exit 0: all
passed; 2: a step failed; 3: all ran but something was pending (My Card).

## What it does not prove

Real Apollo data and cost (see [REAL_APOLLO_ENRICHMENT_TEST.md](REAL_APOLLO_ENRICHMENT_TEST.md)),
live payments, Netlify's deployed runtime, and email delivery (staging has no email key).
