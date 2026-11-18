# Staging validation: step by step

**For the owner, on the staging machine.** Everything here uses only the **`idynify-staging`**
Firebase project, **Stripe test mode**, and a **local mocked Apollo**. No live key, no production
project, no deploy. Every tool refuses a live Stripe key, the production project and a non-local
app address.

Work through the parts in order. Each scenario says what to do and what you should see. If anything
differs from **Pass**, stop, copy the output, and send it to me; do not carry on past a failure.

Terminals used throughout:

- **T1** — Stripe event forwarding (left running)
- **T2** — the app (left running)
- **T3** — commands and checks

---

## Part 0 — Once: what the machine needs

- Node 22 and `npm`, Git, the **Stripe CLI** (`stripe --version`), and access to `idynify-staging`
  through `gcloud` (as for sticker QA).
- The staging env file at `~/idynify-staging/.env.billing`, outside any repository, with the
  staging Firebase web values (`VITE_FIREBASE_*`) as for sticker QA.
- The production Firebase project id, used only so the tools can refuse it by name.

```bash
stripe login
```
(Choose the Idynify account; the CLI works in test mode unless told otherwise.)

---

## Part 1 — Once: the code

In the clone you use for staging work (not linked to Netlify):

```bash
git fetch origin claude/charming-maxwell-459ykf-phase1-integration
```
```bash
git checkout --detach FETCH_HEAD
```
```bash
npm ci
```
```bash
npx playwright --version
```

This is the CI-only integration branch (#808): every PR the journey needs, nothing merged.

---

## Part 2 — Once: the restricted Stripe test-mode key

Follow [CHECKOUT_TEST_MODE_VALIDATION.md](CHECKOUT_TEST_MODE_VALIDATION.md) §1 exactly. The key must
start `rk_test_`. Permissions: Customers Write; Checkout Sessions Write; **Subscriptions Write**;
**Invoices Read**; Products and Prices Write; **Customer portal Write**; everything else None. It is
typed at a hidden prompt into the env file and never pasted anywhere else.

---

## Part 3 — Once: the test catalog and portal

In T3:

```bash
export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
```
```bash
node scripts/staging/stripeTestModeSetup.mjs
```
```bash
node scripts/staging/stripeTestModeSetup.mjs --apply
```

Copy the `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PORTAL_CONFIGURATION_ID` lines it
prints into the env file. They are ids, not secrets.

---

## Part 4 — The env file

`~/idynify-staging/.env.billing` holds, besides the staging Firebase values:

```
STRIPE_SECRET_KEY=rk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…          (Part 5, step 1)
STRIPE_PRICE_STARTER=price_…
STRIPE_PRICE_PRO=price_…
STRIPE_PORTAL_CONFIGURATION_ID=bpc_…
BILLING_LEDGER_EPOCH_UNIX=…            (Part 5, step 2)
VITE_STRIPE_ENABLED=true
VITE_CONTACT_HUB=on
VITE_FREE_PLAN=on
```

**Not** `CREDIT_METERING`: metering stays off until you approve it (Part 11). No `APOLLO_API_KEY`:
the tools refuse one; Apollo is the local stand-in.

---

## Part 5 — Each session: start

1. **T1** — forward Stripe's test events to the local webhook, and leave it running:
   ```bash
   stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid
   ```
   The first time, put the `whsec_…` it prints into the env file as `STRIPE_WEBHOOK_SECRET`.
2. **T3** — set this session's ledger epoch (prints a number; put it in the env file as
   `BILLING_LEDGER_EPOCH_UNIX`):
   ```bash
   date +%s
   ```
3. **T2** — check, then start the app with the Apollo stand-in:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.billing --billing
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.billing --billing --apollo-mock
   ```
   Pass: "Preflight passed … Stripe in test mode, Apollo stand-in at http://127.0.0.1:8899". The app
   is at http://localhost:8888.
4. **T3** — the checking shortcut for this terminal:
   ```bash
   export PRODUCTION_FIREBASE_PROJECT_ID=<production id>
   ```
   ```bash
   export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
   ```
   ```bash
   snap() { node scripts/staging/billingAccountSnapshot.mjs --email="$1"; }
   ```
   `snap <address>` prints the plan, the account's billing fields, its grants (with their kind),
   its Stripe subscriptions and ✓/✗ checks. Exit 0 means every check passed.

Use a new address per scenario, for example `qa+s1-1118@example.test`. Test cards: `4242 4242 4242
4242` succeeds; `4000 0000 0000 0002` declined; `4000 0000 0000 9995` insufficient funds;
`4000 0027 6000 3184` asks for authentication; any future date, any CVC.

---

## Part 6 — Checkout (authenticated checkout, #803)

| # | Do | Pass |
|---|---|---|
| S1 | Sign up `qa+s1…` (no card) → Contact Hub. Settings → Billing → **Upgrade to Starter** → pay `4242…`. Then `snap qa+s1…` | Back in the app without seeing checkout again. Snap: plan `starter`, 1 live subscription, 400 credits, grant `checkout`, all ✓. T1: `checkout.session.completed` answered 200 |
| S2 | As S1 with `qa+s2…` and **Upgrade to Pro** | Snap: `pro`, 1,250 credits, all ✓ |
| S3 | New `qa+s3…` → Upgrade to Starter → on Stripe's page press back | The cancel page says nothing was charged. Snap: `free`, no subscription. Upgrade again → the same Stripe page (same URL). Then expire it: `stripe checkout sessions expire cs_…` (the id is in the snap) and upgrade again → a new page, no error |
| S4 | New `qa+s4…` → Upgrade → card `…0002`, then `…9995` | Stripe shows the decline; snap: `free`, no live subscription, no grant, no review. Then pay `4242…` → passes as S1 |
| S5 | The S1 account: `stripe subscriptions cancel sub_…` (id from `snap qa+s1…`) | Snap: `free`, subscription canceled, all ✓; Contact Hub still shows everything. Then Upgrade to Starter → pay → snap: `starter`, same customer, one canceled + one active subscription, 2 `checkout` grants, all ✓ |
| S6 | The S2 (Pro) account: Settings → Billing; open `http://localhost:8888/checkout?tier=starter` | Billing shows **Manage billing**, no checkout; the link lands on Billing; snap still 1 live subscription |
| S7 | In T1 find S1's `checkout.session.completed` event id (`evt_…`), then `stripe events resend evt_…` | Snap unchanged: 400 credits, one grant |
| S8 | A Free account opens `/scout` | "This is part of Scout"; no Barry in the sidebar; nothing calls Apollo |

---

## Part 7 — Starter → Pro and payment confirmation (W3)

| # | Do | Pass |
|---|---|---|
| P1 | A Starter account (S1's, or a new one) → Settings → Billing → **Upgrade to Pro** | A price for today appears (the rest of this period). **Confirm upgrade** → "You are on Scout Pro". Snap: `pro`, credits total 1,250, grant `plan_change (+850)`, **the same subscription id**, 1 live subscription. `stripe invoices list --customer cus_… --limit 1` shows that amount paid |
| P2 | New `qa+p2…`: Upgrade to Starter paying with `4000 0027 6000 3184` (approve the test authentication). Then Upgrade to Pro → Confirm | "Your bank needs you to confirm this payment" with **Confirm the payment**. Before confirming, snap: still `starter`. Open the link, approve; back on Billing within a minute: "You are on Scout Pro"; snap `pro` |
| P3 | New Starter account `qa+p3…` (paid with `4242…`) → **Manage billing** → replace the card with `4000 0000 0000 0341` → back → Upgrade to Pro → Confirm | A clear message that nothing changed (declined or payment needed). Snap: still `starter`, 400 credits, no `plan_change` grant |
| P4 | In T1 find P1's `customer.subscription.updated` (`evt_…`), `stripe events resend evt_…` | Snap unchanged: one `plan_change` grant |
| P5 | Any paid account → **Manage billing** | Stripe's portal shows payment methods, invoices and cancel; **no plan switching**. Cancel at period end → back on Billing, no Upgrade to Pro offered; snap shows `cancelAtPeriodEnd: true`. In the portal, renew the plan again → snap `cancelAtPeriodEnd: false` |
| P6 | A Starter account opens `http://localhost:8888/checkout?tier=pro` | Lands on Billing with the Pro price already shown; snap still 1 live subscription |

---

## Part 8 — Monthly renewal (W4b), with a Stripe test clock

Renewal needs a month to pass. A Stripe test clock moves time for one customer, and only for a
customer created on it, so the account is given a clock customer before it subscribes.

1. Sign up `qa+r1…` in the app (no card). In T3: `snap qa+r1…` and note the uid from its first line
   (`Account <uid> on idynify-staging`).
2. Create the clock and a customer on it, owned by that account:
   ```bash
   NOW=$(date +%s)
   ```
   ```bash
   stripe test_helpers test_clocks create -d frozen_time=$NOW -d name="idynify renewal R1"
   ```
   ```bash
   stripe customers create -d email="qa+r1…@example.test" -d test_clock=clock_… -d "metadata[firebaseUID]=<uid>"
   ```
3. In the Firebase console, project **idynify-staging** → Firestore → `users` → `<uid>` → add a
   field `stripeCustomerId` (string) = the `cus_…` from step 2. (A staging test account only.)
4. In the app, still as `qa+r1…`: Settings → Billing → **Upgrade to Starter** → pay `4242…`.
   `snap qa+r1…`: `starter`, 400 credits, customer `cus_…` from step 2, all ✓.
   If Stripe refuses to open checkout for this customer, stop and send me the message.
5. Move the clock past the renewal (33 days), so Stripe creates and pays the next invoice:
   ```bash
   stripe test_helpers test_clocks advance clock_… -d frozen_time=$((NOW + 33*24*3600))
   ```
   (Or Dashboard, test mode → Billing → Test clocks → the clock → Advance time.) In T1, wait for
   `invoice.paid` answered 200.
6. `snap qa+r1…`: credits total 400, used 0, remaining 400, with `resetDate` about a month later
   than before; a grant `renewal (+400)`; all ✓.
7. Resend that `invoice.paid` (`stripe events resend evt_…`): snap unchanged, still one `renewal`
   grant.

With metering off, the balance is already 400 before the renewal; the renewal shows in the grant
and the dates. Part 11 repeats this with a credit spent first, so the reset itself is visible.

---

## Part 9 — The whole journey in a browser, with mocked Apollo (W6)

With T1 and T2 running, in T3:

```bash
node scripts/staging/e2e/freeToScout.mjs --skip-my-card --with-pro
```

Add `--headed` to watch it. It creates a new account, signs up Free, imports five people from the
empty first screen and adds one, puts a sticker and a note on one person, checks the Scout preview
made **no paid request and no Apollo call**, upgrades through Stripe's test page, lands back on the
same person in Scout, checks that `/` goes to Contact Hub (no onboarding) and Scout opens, enriches
the person through the stand-in (metering off: nothing charged), compares the whole account before
and after (Part 10), and upgrades Starter → Pro on the same subscription.

**Pass:** every line ✓ except `2. Create, edit and share My Card` (pending until the Contact Hub
team's My Card is in), exit code 3, and a report path. Send me the report.

---

## Part 10 — Contacts and account data unchanged

Step 9 of the journey does this automatically: it reads every document under the account before the
upgrade and after the enrichment and fails on any person, sticker, note, card or other document
deleted or changed, on any value the enrichment overwrote (only empty fields may be filled), and on
any change to the account other than billing fields.

For the manual scenarios, check by eye after S1, P1 and R1: Contact Hub shows the same people, the
same stickers and the same notes as before the upgrade.

---

## Part 11 — Only with your approval: credits in staging

Metering stays off everywhere until you approve the rates. When you want the deduction and the
renewal validated together **in staging only** (mocked Apollo, provisional rate of 1 credit a
person):

1. Add `CREDIT_METERING=on` to `~/idynify-staging/.env.billing` and restart T2.
2. Run the journey with charging expected:
   ```bash
   node scripts/staging/e2e/freeToScout.mjs --skip-my-card --with-pro --expect-metering
   ```
   Pass: step 8 says one charge, and a repeat within the retry window charged nothing.
3. Repeat Part 8 with a new `qa+r2…` account, and before step 5 enrich one of its contacts once
   (remaining 399). After the clock advance: remaining back to 400, one `renewal` grant.
4. Remove `CREDIT_METERING=on` from the env file again.

Production is not affected by any of this.

---

## Part 12 — Finish

Stop T1 and T2 with Ctrl+C. Keep the restricted key until validation is complete, then delete it
(Dashboard, test mode → Developers → API keys) and remove its line from the env file. Test data can
stay in Stripe test mode and in staging.

Record for each scenario: date and time (UTC), pass or fail, and the snap output (ids only, no
secrets).
