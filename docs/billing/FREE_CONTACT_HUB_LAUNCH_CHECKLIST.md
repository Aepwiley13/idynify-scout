# Free Contact Hub — launch checklist

**For the owner.** Each production step is its own approval. Nothing here changes the billing
ledger epoch (`1794632515`), the Netlify publishing lock, production Stripe settings or
production Firebase rules. Phase 1 needs **no Firestore rules deploy**.

## A. Code, merged in this order (each with approval)

| # | PR | Why | Required for launch? |
|---|---|---|---|
| A1 | Concurrent-checkout test fix (#805) | Removes a one-in-ten CI flake in `billing-emulator`; test-only | Recommended first, so every later PR's CI is trustworthy |
| A2 | Phase 0: Stripe test mode (#801) | Lets A6 be validated in Stripe test mode | Yes, for B |
| A3 | **Phase 1c: paid-API guard** | Free and lapsed accounts can no longer make Idynify pay for Apollo, including by calling the functions directly; the weekday refresh skips them | **Yes — before the Free plan is switched on** |
| A4 | Phase 1a: Free accounts (#802) | No-card signup, free Contact Hub, in-app upgrade screen. Off until the build switch in C1 | Yes |
| A5 | Integration check with Contact Hub / My Card | Rebase onto `main` after the Contact Hub team's My Card merge; re-run CI and the free-route tests | Yes |
| A6 | Phase 1b: authenticated checkout (#803) | Retires Payment Links (duplicate-subscription risk for existing and returning customers) | Strongly recommended; **only after B passes** |

## B. Stripe test-mode validation (before A6 is published)

The exact procedure, including how to create and store the restricted test-mode key without it
ever entering a chat or the repository, is
[CHECKOUT_TEST_MODE_VALIDATION.md](CHECKOUT_TEST_MODE_VALIDATION.md) (in #801). Scenarios S1–S7
must all pass, each confirmed with the read-only `billingAccountSnapshot.mjs`:

1. Successful payment, Starter, then Pro: one customer, one subscription, 400 or 1,250 credits, paid access. The success page waits for the webhook and never shows checkout again.
2. Canceled checkout: still Free; retrying reopens the same session; once it expires, a new one.
3. Declined card: no subscription, no credits, no review record.
4. Resubscription after cancelling: the same customer, a second subscription, credits granted again.
5. An existing subscriber trying to buy again: sent to Billing, nothing offered, still one subscription.
6. A replayed webhook: no second grant.

**If A6 is not ready**, the Free plan can still launch with Payment Links:
- **New Free customers can upgrade safely.** They have no Stripe customer yet, so there is nothing to duplicate.
- **The risk stays for existing and returning customers** (a second subscription they are billed for). With a small, known customer base it can be handled by hand, but that is a risk accepted, not removed.

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
   - Settings → Billing shows Free.
5. Smoke test with a paying account: Scout works, and Settings → Billing shows the plan with no checkout link.
6. Confirm the guard in the function logs: a direct call to an enrichment function as the Free account returns 402, and no Apollo request appears in the admin API activity page.

## E. First week

- **Daily:** `billingAmbiguousAccounts` with `status == pending` (runbook §9.3).
- **Daily:** Apollo credits used (Apollo usage page) against the previous trend.
- **402s:** counts of `paid_plan_required` in the function logs. Many from one account means someone is calling the API directly.
- **Signups:** Free signups and upgrades (signup analytics, Stripe).

## F. Rollback — free customers keep their contacts

**The rule:** once any free account exists, no rollback may send free customers to a purchase
page or hide their contacts. Nothing in any rollback deletes data.

| Situation | Action | Free customers |
|---|---|---|
| Stop new Free signups (a problem with Free signup, abuse, cost) | Set **`VITE_FREE_PLAN=existing`**, rebuild, publish manually | Keep Contact Hub and Settings. New visitors sign up for a paid plan, as before launch |
| A defect in a free page | Fix forward. If urgent, `existing` while the fix is built | Unaffected |
| Paid-API guard (#806) misbehaves for paying customers | Fix forward; it only ever refuses, so it cannot over-spend | Unaffected |
| Checkout misbehaves after A6 | Publish the deploy from before A6; Payment Links return | Unaffected: Free access does not depend on checkout |
| The whole release must go | Publish the previous production deploy (hardened billing, allocation on; never a pre-ledger build, runbook §5) | **Locked out until a fixed build is published:** that build has no Free plan, so it sends them to checkout. Their contacts are intact and come back with the fix. Use only if `existing` cannot help, and tell free customers |

**Never** remove `VITE_FREE_PLAN` or `VITE_CONTACT_HUB` after launch: either one sends free
accounts to checkout at sign-in.
