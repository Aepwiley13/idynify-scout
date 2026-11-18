# Staging validation: step by step

**This is the single source of truth for validating the Free → Scout experience.** Other billing
documents point here for every test step; where they differ, this one is right.

**For the owner, on the staging machine.** Everything here uses only the **`idynify-staging`**
Firebase project, **Stripe test mode** and a **local mocked Apollo**. No live key, no production
project, no deploy. Every tool refuses a live Stripe key, the production project and a non-local
app address.

**Credit metering stays off** for the whole validation (Parts 0–10). It is tested only in Part 11,
and only once you approve it. Production metering stays off until the Apollo rates are approved.

Work through the parts in order. Each step says what to do and what you should see. If anything
differs from **Pass**, stop, copy the output, and send it to me; do not carry on past a failure.

Terminals: **T1** Stripe event forwarding (left running), **T2** the app (left running),
**T3** commands and checks.

---

## Part 0 — Check the machine (read-only)

Nothing in this part signs in to Stripe, writes to Firebase, or changes any setting. It only
looks. Run each command in T3 and send me the output (none of it is secret).

1. Tools:
   ```bash
   node --version
   ```
   ```bash
   npm --version
   ```
   ```bash
   git --version
   ```
   ```bash
   stripe --version
   ```
   ```bash
   gcloud --version | head -1
   ```
   **Pass:** Node `v22.x`; any recent npm, git and gcloud; Stripe CLI `1.x`. Do **not** run
   `stripe login` yet (Part 2).

2. No billing or integration secret is set in this shell (names only, never values):
   ```bash
   env | cut -d= -f1 | grep -E '^(STRIPE_|APOLLO_|ANTHROPIC_|STAGING_SERVICE_ACCOUNT_KEY|FIREBASE_|VITE_|CREDIT_)' || echo "none set"
   ```
   **Pass:** `none set`. If any name appears, open a new terminal or `unset` it.

3. The staging credential from sticker QA (short-lived, impersonating the staging service account;
   `docs/contact-hub/STICKERS_STAGING_SETUP.md` A5):
   ```bash
   export CLOUDSDK_CONFIG=$HOME/idynify-staging/gcloud
   ```
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=$HOME/idynify-staging/gcloud/application_default_credentials.json
   ```
   ```bash
   test -f "$GOOGLE_APPLICATION_CREDENTIALS" && echo "credential file present" || echo "missing"
   ```
   ```bash
   gcloud config get-value project
   ```
   **Pass:** `credential file present` and `idynify-staging`. If the credential has expired, the
   sign-in is `gcloud auth login` in that same folder (A5); nothing else.

4. The staging env file from sticker QA exists, outside any repository, readable only by you:
   ```bash
   ls -l ~/idynify-staging/.env.staging
   ```
   **Pass:** the file is listed, starting `-rw-------` (if not: `chmod 600 ~/idynify-staging/.env.staging`).

5. In the clone you use for staging work (not linked to Netlify), the checks the tools make
   themselves, still contacting nothing:
   ```bash
   git status --short | head -5
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.staging
   ```
   **Pass:** a clean working tree (no lines) and **Preflight passed.** The preflight reads only the
   env file and the credential file: it confirms the project is `idynify-staging`, the credential
   is a staging one, no integration key is present, and git would not commit the env file.

Send me the five outputs. We go on to Part 1 only when all five pass.

---

## Part 1 — The code

In the staging clone:

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

This is the CI-only integration branch (#808): every PR the journey needs, nothing merged. Run
Part 0 step 5 again on it: **Preflight passed.**

---

## Part 2 — The restricted Stripe test-mode key (once)

1. `stripe login`, and choose the Idynify account. The CLI works in test mode.
2. In the Stripe Dashboard, switch on **Test mode** (the banner shows). Everything below with the
   banner showing.
3. **Developers → API keys → Create restricted key**, named `idynify-staging-validation (test)`:

   | Resource | Access |
   |---|---|
   | Customers | Write |
   | Checkout Sessions | Write |
   | Subscriptions | Write |
   | Invoices | Read |
   | Products, Prices | Write |
   | Customer portal | Write |
   | Everything else | None |

4. The key starts `rk_test_`. **If it starts `rk_live_`, stop:** delete it and start again.
5. Create the billing env file from the sticker one, then store the key at a hidden prompt (it is
   never shown, pasted into chat, or saved in a repository):
   ```bash
   umask 077
   ```
   ```bash
   cp ~/idynify-staging/.env.staging ~/idynify-staging/.env.billing
   ```
   ```bash
   read -rs STRIPE_TEST_KEY
   ```
   (Paste the key at the hidden prompt, press Enter.)
   ```bash
   printf 'STRIPE_SECRET_KEY=%s\n' "$STRIPE_TEST_KEY" >> ~/idynify-staging/.env.billing && unset STRIPE_TEST_KEY
   ```

---

## Part 3 — The test catalog and portal (once)

```bash
export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
```
```bash
node scripts/staging/stripeTestModeSetup.mjs
```
```bash
node scripts/staging/stripeTestModeSetup.mjs --apply
```

It creates Scout Starter (test, $20/month), Scout Pro (test, $50/month) and a portal
configuration (payment methods, invoices, billing details, cancel at period end; **plan switching
off**). Copy the `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PORTAL_CONFIGURATION_ID`
lines it prints into `~/idynify-staging/.env.billing`. They are ids, not secrets.

---

## Part 4 — The billing env file

Add these to `~/idynify-staging/.env.billing` (after the copied staging values and the key):

```
STRIPE_WEBHOOK_SECRET=whsec_…          (Part 5, step 1)
STRIPE_PRICE_STARTER=price_…           (Part 3)
STRIPE_PRICE_PRO=price_…               (Part 3)
STRIPE_PORTAL_CONFIGURATION_ID=bpc_…   (Part 3)
BILLING_LEDGER_EPOCH_UNIX=…            (Part 5, step 2)
VITE_STRIPE_ENABLED=true
VITE_CONTACT_HUB=on
VITE_FREE_PLAN=on
```

**Not** `CREDIT_METERING` (Part 11 only). **No** `APOLLO_API_KEY`: the tools refuse one; Apollo is
the local stand-in. Check it:

```bash
PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.billing --billing
```

**Pass (for now):** every check ✓ except `stripe-webhook-secret` and `billing-epoch`, which come in
Part 5. After Part 5 steps 1–2 it says **Preflight passed for a billing run (Stripe test mode).**

---

## Part 5 — Each session: start

1. **T1** — forward Stripe's test events to the local webhook, and leave it running:
   ```bash
   stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid
   ```
   The first time, put the `whsec_…` it prints into the env file as `STRIPE_WEBHOOK_SECRET`.
2. **T3** — this session's ledger epoch; put the number in the env file as
   `BILLING_LEDGER_EPOCH_UNIX`:
   ```bash
   date +%s
   ```
3. **T2** — with Part 0 step 3's two exports, check and start the app with the Apollo stand-in:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.billing --billing
   ```
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.billing --billing --apollo-mock
   ```
   **Pass:** "Preflight passed … Stripe in test mode, Apollo stand-in at http://127.0.0.1:8899". The
   app is at http://localhost:8888.
4. **T3** — the checking shortcut (with Part 0 step 3's two exports):
   ```bash
   export PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev
   ```
   ```bash
   export STRIPE_SECRET_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' ~/idynify-staging/.env.billing)"
   ```
   ```bash
   snap() { node scripts/staging/billingAccountSnapshot.mjs --email="$1"; }
   ```
   `snap <address>` prints the plan, the account's billing fields, its grants (with their kind:
   `checkout`, `plan_change`, `renewal`), its Stripe subscriptions and ✓/✗ checks. Read-only.

Use a new address per scenario, for example `qa+s1-1118@example.test`. Test cards: `4242 4242 4242
4242` succeeds; `4000 0000 0000 0002` declined; `4000 0000 0000 9995` insufficient funds;
`4000 0027 6000 3184` asks for authentication; `4000 0000 0000 0341` attaches but every charge
fails. Any future date, any CVC.

---

## Part 6 — Free accounts and checkout (#802, #803, W1)

| # | Do | Pass |
|---|---|---|
| S1 | Sign up `qa+s1…`, no card | Contact Hub, with **Add Your First Person** and **Import Contacts**. No Barry in the sidebar. Settings → Billing: Free, $0 |
| S2 | As `qa+s1…`: Settings → Billing → **Upgrade to Starter** → pay `4242…` | "Setting up", then **back on Contact Hub** (not Barry, not onboarding). Barry appears in the sidebar. T1: `checkout.session.completed` 200. `snap`: `starter`, 1 live subscription, 400 credits, grant `checkout`, all ✓. Sign out and in again: Contact Hub again |
| S3 | New `qa+s3…`: import the CSV `docs/staging/synthetic-contacts.csv` from the first screen; open a person → **Upgrade to Scout** → **Scout Starter** → pay `4242…` | Back on **the same person in Scout** with **Enrich contact**. Press it: details fill in (mocked Apollo); nothing already on the person changed. `snap`: `starter`, 400 credits (metering off) |
| S4 | New `qa+s4…`: Upgrade to Starter → on Stripe's page press back | The cancel page says nothing was charged. `snap`: `free`, no subscription. Upgrade again → the same Stripe page (same URL). Then `stripe checkout sessions expire cs_…` (id in `snap`) and upgrade again → a new page, no error |
| S5 | New `qa+s5…`: Upgrade → card `…0002`, then `…9995` | Stripe shows each decline. `snap`: `free`, no live subscription, no grant, no review. Then pay `4242…` → as S2 |
| S6 | The S2 account: `stripe subscriptions cancel sub_…` (id from `snap qa+s1…`) | `snap`: `free`, subscription canceled, all ✓; Contact Hub shows every person, sticker and note; Barry gone. Upgrade to Starter again → pay → `snap`: `starter`, same customer, one canceled + one active subscription, 2 `checkout` grants, all ✓ |
| S7 | New Pro account `qa+s7…` (Upgrade to Pro). Then Settings → Billing, and open `http://localhost:8888/checkout?tier=starter` | Billing: Pro, **Manage billing**, no checkout or Upgrade button. The link lands on Billing. `snap`: 1 live subscription, 1,250 credits |
| S8 | In T1 find S2's `checkout.session.completed` (`evt_…`) → `stripe events resend evt_…` | `snap qa+s1…` unchanged |
| S9 | A Free account opens `http://localhost:8888/scout`, then a person's page | "This is part of Scout" with plan choices; the person page shows the Scout preview. The Apollo stand-in saw nothing: `curl -s http://127.0.0.1:8899/__calls` shows `{"calls":[]}` |

---

## Part 7 — Starter → Pro and payment confirmation (W3)

| # | Do | Pass |
|---|---|---|
| P1 | A Starter account (S2's) → Settings → Billing → **Upgrade to Pro** | Today's prorated price and the 850 extra credits are shown. **Confirm upgrade** → "Upgrading to Pro…" → "You are on Scout Pro". `snap`: `pro`, credits total 1,250, grant `plan_change (+850)`, **same subscription id**, 1 live subscription. `stripe invoices list --customer cus_… --limit 1`: that amount, paid |
| P2 | New `qa+p2…`: Upgrade to Starter paying with `…3184` (approve the test authentication). Then Upgrade to Pro → Confirm | "Your bank needs you to confirm this payment. You are still on Starter…" with **Confirm the payment**. `snap`: still `starter`. Open the link, approve; within a minute Billing says "You are on Scout Pro"; `snap`: `pro` |
| P3 | New Starter `qa+p3…` (paid with `4242…`) → **Manage billing** → replace the card with `…0341` → back → Upgrade to Pro → Confirm | The same "still on Starter… nothing changes until it is paid" message; Stripe's invoice page shows the decline. `snap`: still `starter`, 400 credits, no `plan_change` grant |
| P4 | In T1 find P1's `customer.subscription.updated` with the Pro price (`evt_…`) → `stripe events resend evt_…` | `snap` unchanged: one `plan_change` grant |
| P5 | Any paid account → **Manage billing** | The portal shows payment methods, invoices and cancel, and **no plan switching**. Cancel at period end → back on Billing: no Upgrade to Pro; `snap`: `cancelAtPeriodEnd: true`. If the portal offers to keep the plan, do it → `cancelAtPeriodEnd: false` (record whether it offers this) |
| P6 | A Starter account opens `http://localhost:8888/checkout?tier=pro` | Lands on Billing with the Pro price already shown. `snap`: 1 live subscription |

---

## Part 8 — Monthly renewal (W4b), with a Stripe test clock

A test clock moves time for one customer, and only for a customer created on it, so the account is
given a clock customer before it subscribes. **Step 3 is the only manual write to a billing field
in this runbook,** on a staging test account; I will ask before you do it.

1. Sign up `qa+r1…` (no card). `snap qa+r1…`; note the uid on its first line.
2. ```bash
   NOW=$(date +%s)
   ```
   ```bash
   stripe test_helpers test_clocks create -d frozen_time=$NOW -d name="idynify renewal R1"
   ```
   ```bash
   stripe customers create -d email="qa+r1…@example.test" -d test_clock=clock_… -d "metadata[firebaseUID]=<uid>"
   ```
3. Firebase console → **idynify-staging** → Firestore → `users` → `<uid>` → add field
   `stripeCustomerId` (string) = the `cus_…` from step 2.
4. As `qa+r1…`: Settings → Billing → **Upgrade to Starter** → pay `4242…`. `snap`: `starter`,
   400 credits, the customer from step 2, all ✓. If Stripe refuses checkout for this customer,
   stop and send me the message.
5. ```bash
   stripe test_helpers test_clocks advance clock_… -d frozen_time=$((NOW + 33*24*3600))
   ```
   (Or Dashboard, test mode → Billing → Test clocks → Advance.) Wait in T1 for `invoice.paid` 200.
6. `snap qa+r1…`: credits 400 / 0 / 400 with `resetDate` about a month later; a grant
   `renewal (+400)`; all ✓.
7. `stripe events resend evt_…` (that `invoice.paid`): `snap` unchanged, one `renewal` grant.

With metering off the balance is already 400; the renewal shows in the grant and the date. Part 11
repeats this with a credit spent first.

---

## Part 9 — The whole journey in a browser, metering off (W6)

With T1 and T2 running, in T3 (with Part 0 step 3's exports and Part 5 step 4's):

```bash
node scripts/staging/e2e/freeToScout.mjs --skip-my-card --with-pro
```

Add `--headed` to watch. It creates a new account each run:

| # | Step | Pass |
|---|---|---|
| 1 | Sign up Free | Contact Hub; no billing fields |
| 2 | My Card | **Pending** until the Contact Hub team's My Card is in (`--skip-my-card`) |
| 3 | Import 5 contacts from the empty first screen, then add one person | "5 people added."; 6 people |
| 4 | Sticker and note on one person | Visible |
| 5 | Scout preview | "Scout can fill in the rest"; **no paid request and no Apollo call**; account snapshot taken |
| 6 | Upgrade to Scout → Starter → Stripe | Paid on Stripe's test page |
| 7 | Back on the same person in Scout | One customer, one subscription, 400 credits, one grant; same uid |
| 7b | No second signup, import or onboarding | `/` lands on Contact Hub; Scout opens without the upgrade screen |
| 8 | Enrich the person (mocked Apollo) | Works; **metering off: nothing charged, nothing logged** |
| 9 | Nothing lost (Part 10) | Every person, sticker, note and other document unchanged; only empty fields filled; only billing fields changed |
| 10 | Starter → Pro | Same subscription id, Pro, one live subscription |

**Pass:** every line ✓ except step 2 (pending), exit code 3, and a report path. Send me the report.

---

## Part 10 — Contacts and account data unchanged

Journey step 9 reads every document under the account before the upgrade and after enrichment, and
fails on anything deleted, any value enrichment overwrote (only empty fields may be filled), and any
account change outside the billing fields. For S2, S3, S6 and P1, also look in Contact Hub: the same
people, stickers and notes as before.

---

## Part 11 — Only after you approve it: credits in staging

Not part of the first validation. When you approve testing the deduction and the renewal together,
in staging only (mocked Apollo, provisional rate of 1 credit per person):

1. Add `CREDIT_METERING=on` to `~/idynify-staging/.env.billing`; restart T2.
2. ```bash
   node scripts/staging/e2e/freeToScout.mjs --skip-my-card --with-pro --expect-metering
   ```
   **Pass:** step 8 says one charge, and a repeat within the retry window charged nothing.
3. Repeat Part 8 with `qa+r2…`; before step 5, enrich one of its people once (remaining 399).
   After the clock advance: back to 400, one `renewal` grant.
4. Remove `CREDIT_METERING=on` from the env file; restart T2.

---

## Part 12 — Finish

Ctrl+C in T1 and T2. When validation is complete: delete the restricted key (Dashboard, test mode →
Developers → API keys) and its line in the env file. Test data can stay in Stripe test mode and in
staging. Record for each step: date and time (UTC), pass or fail, and the output (ids only).

## When My Card arrives

When the Contact Hub team's My Card branch is integrated into #808: Part 1 again, then Part 9
without `--skip-my-card`. Step 2 must then pass too.
