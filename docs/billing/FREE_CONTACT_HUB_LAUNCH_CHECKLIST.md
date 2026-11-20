# Free Contact Hub — launch checklist

**For the owner.** Each production step is its own approval. Nothing here changes the billing
ledger epoch (`1794632515`) or the Netlify publishing lock. Production Stripe settings and
Firestore rules change only in section C, each with its own approval.

## A. Code, merged in this order (each with approval)

Merged into `main` with merge commits (never squash: later PRs contain earlier ones' commits):
- Batch 1: #805 → #801 → W6 #816.
- Batch 2: #806 → #809 → #823 (paid Google APIs, from the #822 cost audit).

Remaining, in this order: #802 → (#807) → W2 #811 → #803 → W1 #812 → W3 #813 → W4a #814 → W4b #815 →
#804. Then the Contact Hub team's #817, which resolves its three conflicts with this stack inside
#817 (`firestore.rules` takes the combined file; `HubPeople.jsx` and `HubPerson.jsx` keep both sides).

- #808 and #818 are CI-only integration checks and are never merged.
- #803 (authenticated checkout) is the launch path; #810 (upgrade hold) is a fallback only if #803
  cannot pass validation.

## B. Validation in staging (before anything is published)

Every test step, from the environment check to the browser journey, is in
[STAGING_VALIDATION_RUNBOOK.md](STAGING_VALIDATION_RUNBOOK.md), the single source of truth. All of
Parts 0–10 must pass, with metering off. Part 11 (credits in staging) runs only once approved.

## Launch blockers (must be cleared, each with approval)

| Blocker | Clears when |
|---|---|
| After paying, the contact page can stay on "Loading contact profile..." until a refresh (#819, platform) | #819's acceptance test passes, then one approved staging purchase paid by hand returns to the contact |
| Starter → Pro not yet run live in staging (only previewed) | An approved upgrade of a test account; the read-only snapshot shows 1,250 credits, one 850-credit `plan_change` grant and one subscription |
| My Card not yet integrated (#817) | #817's conflicts are resolved and both teams' suites pass |
| **Paid Apollo spending has no per-account limit while `CREDIT_METERING` is off** (any paying account or admin can make unlimited paid lookups; details in `CREDIT_METERING.md`) | Approved rates with metering and renewal on together, or an approved interim daily ceiling, before broad paid enrichment |
| **Production: any signed-in account can call the paid functions directly** (Apollo, Claude, Google) | #806, #809 and #823 published, before the Free plan is switched on (they are merged; publishing is a separate approval) |
| Welcome email delivery not yet checked (#821) | One delivery check with a test key outside production, or an accepted risk |
| Spend alerts and Free-signup abuse controls (#822) | Spend alerts set (Apollo, Anthropic, Google Cloud, Resend); a decision on App Check, signup limits or a contact cap |

## C. Production configuration (owner, each approved separately)

| # | Change | Where | Undo |
|---|---|---|---|
| C1 | **Firestore rules:** the combined ruleset (My Card + server-only credit records; live in staging as `98b7ad88`, sha256 `9bd463b1…d766`), before #814 or #817 is published | `firebase deploy --only firestore:rules` to production | Redeploy the previous production ruleset (record its id first) |
| C2 | **Authenticated checkout (#803):** the live key may create customers and Checkout Sessions; `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO` hold the live prices; `STRIPE_WEBHOOK_SECRET` is the live endpoint's. With `VITE_STRIPE_ENABLED=true`, publishing #803 moves every purchase from the Payment Links to the authenticated Checkout | Stripe dashboard and Netlify environment variables | Publish the deploy from before #803; the Payment Links return |
| C3 | **Customer portal (#813):** a live portal configuration with the test settings (payment methods, invoices, billing details, cancel at period end; plan switching off); its id in `STRIPE_PORTAL_CONFIGURATION_ID` | Stripe dashboard, Netlify | Remove the variable: Manage billing says it is not available yet |
| C4 | **Renewals (#815):** add `invoice.paid` to the live webhook endpoint's events, before or with turning metering on | Stripe dashboard | Remove the event: renewals are not granted |
| C5 | Retire the Payment Links once C2 is live and verified | Stripe dashboard | Re-enable the links |
| C6 | `VITE_CONTACT_HUB=on` and `VITE_FREE_PLAN=on`, production build context, **last** | Netlify environment variables, then a new build | **Set `VITE_FREE_PLAN=existing`** and rebuild (section F). Never remove either variable once free accounts exist |
| C7 | Sticker rollout mode allows every account (`feature_flags/stickers`) | Owned by the Contact Hub team | Their documented rollback |

`CREDIT_METERING` stays off; turning it on is a separate approval (rates, Part 11, and C4 together).

## D. Publish and verify (owner)

**First, with the Free plan still off:**
1. Build `main` with C1–C5 in place; the lock keeps it unpublished. Check its commit.
2. **Publish that deploy manually.** The lock stays on.
3. Confirm the billing webhook is unaffected (packet §0D): `node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site 071d2992-0d26-4f8a-a84e-5022a3e2fd8d` reports `RUNTIME-VERIFIED ACTIVE`.
4. Smoke test with a paying account: Scout works, Barry opens and answers, and Settings → Billing
   shows the plan, with Manage billing opening the portal.
5. Confirm the guards in the function logs: as an account without paid access, a direct call to an
   enrichment function, a Barry function (for example `barryMissionChat`) and `retryLinkedInPhoto`
   each return 402, with no Apollo request in the admin API activity page and a
   `paid_ai_access.denied` line naming the Barry function.

**Then switch the Free plan on (C6), rebuild and publish manually:**

6. Smoke test with a new email address, no card:
   - sign up, land in Contact Hub;
   - add a person, add a sticker, write a note;
   - open Scout and see "This is part of Scout", with Upgrade to Scout;
   - no Barry control in the sidebar or the More sheet;
   - Settings → Billing shows Free.

## E. First week

- **Daily:** `billingAmbiguousAccounts` with `status == pending` (runbook §9.3).
- **Daily:** Apollo credits used (Apollo usage page) against the previous trend.
- **402s:** counts of `paid_plan_required` (Apollo) and `paid_ai_access.denied` (Claude) in the function logs. Many from one account means someone is calling the API directly. A paying customer among them is a defect: fix forward.
- **Inbox queue:** entries with status `skipped_not_paid` belong to accounts without paid access; they can be set back to `pending` after an upgrade if wanted.
- **Signups:** Free signups and upgrades (signup analytics, Stripe).

## F. Rollback — free customers keep their contacts

**The rule:** once any free account exists, no rollback may send free customers to a purchase
page or hide their contacts. Nothing in any rollback deletes data.

| Situation | Action | Free customers |
|---|---|---|
| Stop new Free signups (a problem with Free signup, abuse, cost) | Set **`VITE_FREE_PLAN=existing`**, rebuild, publish manually | Keep Contact Hub and Settings. New visitors sign up for a paid plan, as before launch |
| A defect in a free page | Fix forward. If urgent, `existing` while the fix is built | Unaffected |
| Paid-API guard (#806) misbehaves for paying customers | Fix forward; it only ever refuses, so it cannot over-spend | Unaffected |
| Paid-AI guard (#809) refuses a paying customer | Fix forward; it only ever refuses. Reverting it re-opens Claude to Free accounts, so do that only together with `existing` | Unaffected |
| Checkout misbehaves after #803 is published | Publish the deploy from before #803; Payment Links return | Unaffected: Free access does not depend on checkout |
| The whole release must go | Publish the previous production deploy (hardened billing, allocation on; never a pre-ledger build, runbook §5) | **Locked out until a fixed build is published:** that build has no Free plan, so it sends them to checkout. Their contacts are intact and come back with the fix. Use only if `existing` cannot help, and tell free customers |

**Never** remove `VITE_FREE_PLAN` or `VITE_CONTACT_HUB` after launch: either one sends free
accounts to checkout at sign-in.
