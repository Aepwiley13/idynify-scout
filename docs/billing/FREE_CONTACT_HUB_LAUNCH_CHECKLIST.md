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

Using [STRIPE_TEST_MODE.md](STRIPE_TEST_MODE.md) on `idynify-staging`, with the owner's
**test-mode** key:

1. A Free account upgrades to Starter: one customer, one subscription, 400 credits, paid access.
2. The same with Pro: 1,250 credits.
3. A paying account opening `/checkout`: sent to Billing, nothing offered.
4. A customer who cancelled buys again: a new subscription on the same customer, credits granted.
5. An abandoned checkout, then a second attempt: a new session, no error.
6. A declined card (`4000 0000 0000 0341`): no access, no credits.
7. The success page: waits for the webhook, then continues; never shows checkout again.
8. Every `billingAmbiguousAccounts` record created during the run explained.

**If A6 is not ready**, the Free plan can still launch with Payment Links:
- **New Free customers can upgrade safely.** They have no Stripe customer yet, so there is nothing to duplicate.
- **The risk stays for existing and returning customers** (a second subscription they are billed for). With a small, known customer base it can be handled by hand, but that is a risk accepted, not removed.

## C. Production configuration (owner, each approved separately)

| # | Change | Where | Undo |
|---|---|---|---|
| C1 | `VITE_CONTACT_HUB=on` and `VITE_FREE_PLAN=on`, production build context | Netlify environment variables, then a new build | Remove them and rebuild: signup and the gates behave exactly as before; Free accounts keep all their data |
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

## F. Rollback

| Situation | Action |
|---|---|
| Free signup or the free gate misbehaves | Remove `VITE_FREE_PLAN`, rebuild, publish. No data changes. |
| Anything else in the release | Publish the previous production deploy (hardened billing, allocation on). Never a pre-ledger build (runbook §5). |
| Checkout misbehaves after A6 | Publish the deploy from before A6. Payment Links return. |
