# Free Contact Hub — launch checklist

**For the owner.** Each production step is its own approval. Nothing here changes the billing
ledger epoch (`1794632515`), the Netlify publishing lock, production Stripe settings or
production Firebase rules. Phase 1 needs **no Firestore rules deploy**.

## A. Code, merged in this order (each with approval)

The current PR list and merge order are kept in one place: the description of the CI-only
integration PR, https://github.com/Aepwiley13/idynify-scout/pull/808. In short: #805 → #801 → #806 →
#809 → #802 → (#807) → W2 #811 → #803 → W1 #812 → W3 #813 → W4a #814 → W4b #815 → W6 #816 → #804.
#803 (authenticated checkout) is the intended launch path; #810 (upgrade hold) is a fallback only
if #803 cannot pass validation, and is not part of the primary launch.

## B. Validation in staging (before anything is published)

Every test step, from the environment check to the browser journey, is in
[STAGING_VALIDATION_RUNBOOK.md](STAGING_VALIDATION_RUNBOOK.md), the single source of truth. All of
Parts 0–10 must pass, with metering off. Part 11 (credits in staging) runs only once approved.

## Launch blockers (must be cleared, each with approval)

| Blocker | Clears when |
|---|---|
| Staging validation not yet run | Runbook Parts 0–10 pass |
| My Card not yet integrated | The Contact Hub team's branch is in #808 and the journey passes without `--skip-my-card` |
| **Paid Apollo spending has no per-account limit while `CREDIT_METERING` is off** (any paying account or admin can make unlimited paid lookups; details in `CREDIT_METERING.md`) | Approved rates with metering and renewal on together, or an approved interim daily ceiling, before broad paid enrichment |
| **Today, any signed-in account can call the Apollo functions directly** | #806 published (before the Free plan is switched on) |

## C. Production configuration (owner, each approved separately)

| # | Change | Where | Undo |
|---|---|---|---|
| C1 | `VITE_CONTACT_HUB=on` and `VITE_FREE_PLAN=on`, production build context | Netlify environment variables, then a new build | **Set `VITE_FREE_PLAN=existing`** and rebuild (section F). Never remove either variable once free accounts exist |
| C2 | Sticker rollout mode allows every account (`feature_flags/stickers`) | Owned by the Contact Hub team | Their documented rollback |

No Stripe setting changes for this launch. `VITE_STRIPE_ENABLED` stays as it is.

## D. Publish and verify (owner)

1. Build `main` with C1 in place; the lock keeps it unpublished. Check its commit.
2. **Publish that deploy manually.** The lock stays on.
3. Confirm the billing webhook is unaffected (packet §0D): `node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site 071d2992-0d26-4f8a-a84e-5022a3e2fd8d` reports `RUNTIME-VERIFIED ACTIVE`.
4. Smoke test with a new email address, no card:
   - sign up, land in Contact Hub;
   - add a person, add a sticker, write a note;
   - open Scout and see "This is part of Scout";
   - no Barry control in the sidebar or the More sheet;
   - Settings → Billing shows Free (with A6-alt: "Contact us to start Scout", no upgrade buttons).
5. Smoke test with a paying account: Scout works, Barry opens and answers, and Settings → Billing shows the plan with no checkout link.
6. Confirm both guards in the function logs: a direct call to an enrichment function and to a Barry
   function (for example `barryMissionChat`) as the Free account each return 402, with no Apollo
   request in the admin API activity page and a `paid_ai_access.denied` line naming the function.

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
| Checkout misbehaves after A6 | Publish the deploy from before A6; Payment Links return | Unaffected: Free access does not depend on checkout |
| The whole release must go | Publish the previous production deploy (hardened billing, allocation on; never a pre-ledger build, runbook §5) | **Locked out until a fixed build is published:** that build has no Free plan, so it sends them to checkout. Their contacts are intact and come back with the fix. Use only if `existing` cannot help, and tell free customers |

**Never** remove `VITE_FREE_PLAN` or `VITE_CONTACT_HUB` after launch: either one sends free
accounts to checkout at sign-in.
