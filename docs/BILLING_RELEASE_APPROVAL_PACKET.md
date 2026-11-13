# Billing ledger — release approval packet

**Status: ATTEMPTED, THEN ROLLED BACK — NOT COMPLETE.** PR #769 was merged and a cutover was
attempted on 2026-11-12. Production was then rolled back to a commit that predates this PR. The
hardened billing code is **not** what production currently serves, and the release's completion
criterion (§3 step 10, on the currently published deploy) is **not** met. See §0 for the record.
Everything from §1 onward is the original approval text, kept for reference; where it says
"unmerged" or describes a step as not yet run, §0 is the correction.

## 0. What actually happened, and the current state (recorded 2026-11-13)

Read from Netlify's own deploy and environment-variable records and from git. Times are UTC.

| When (2026-11-12) | Event |
|---|---|
| 00:00 | `e87691d` (PR #785 merge, pre-#769) built and published to production. |
| 18:01 | `STRIPE_PRICE_SCOUT_STARTER_FREE` set for the production context. |
| 18:16 | PR #769 merged (`2f53861f`); Netlify built it. That build predates the epoch write, so it carries **no** `BILLING_LEDGER_EPOCH_UNIX`. |
| 18:26:07 | `BILLING_LEDGER_EPOCH_UNIX=1794507945` (2026-11-12T18:25:45Z) written, production context. |
| 18:28:08 | A rebuild of `2f53861f`, built after that write, published. Automatic allocation was active from here. |
| 18:57:12 | The **first** `2f53861f` build (no epoch) was published again. Automatic allocation off; purchases flagged `epoch_unset`. |
| 19:11:44 | `e87691d` published again and Netlify auto-publishing **locked**. |

**Current state:**

- **Published:** `e87691d`, locked. Its `stripe-webhook.js` is the pre-hardening handler — no
  `billingAllocations`, no event ledger, no consistency guards. This is the pre-ledger rollback
  the runbook's §5 prohibits; it has happened, and the recovery work it implies is still open.
- **`main`:** `2b0c0053` (#769 plus the Contact Hub PR #789). Netlify built it for production on
  2026-11-13 but did not publish it, because of the lock.
- **Epoch:** `BILLING_LEDGER_EPOCH_UNIX` is still set in Netlify, but it is **not active in the
  published runtime** — the published code never reads it. Any production build made after
  18:26:07 on 2026-11-12 (including the existing unpublished `2b0c0053` build) carries the value,
  so publishing such a build turns automatic allocation on immediately, with no separate arming step.
- **Firestore rules (production, `idynify-scout-dev`):** **not verified.** Whether step 5 was run
  has not been confirmed from the Firebase Console. This matters: `main`'s `Signup.jsx` writes
  `credits` as an object, which only this PR's rules accept — publishing `main` over the old rules
  would reject every new signup.
- **The "RUNTIME-VERIFIED ACTIVE" confirmation was never produced by the script.**
  `scripts/billingLedgerCutover.mjs` called `netlify api getSiteEnvVars`, which returns
  `JSONHTTPError: Not Found` for this site, so it could only ever exit at "Failed to query
  Netlify". The script now uses the account-scoped `getEnvVars`. Any earlier report of step 10
  passing rests on something other than this script's output.

**Open before `main` can be published** (none of these are done):

1. Confirm in the Firebase Console that production rules are `main`'s `firestore.rules`, or
   deploy them (step 5) first.
2. Review `billingAmbiguousAccounts` for records created 18:16–19:11 on 2026-11-12 — purchases in
   the two epoch-less windows (18:16–18:28, 18:57–19:11) were flagged, not granted.
3. Purchases since 19:11:44 were handled by pre-ledger code: granted with no
   `billingAllocations` marker and no event-ledger entry. Inventory them (runbook §6) before
   any event from that period is resent.
4. Decide whether the existing epoch value stands or is re-armed, then verify activation with
   the corrected script after publishing (steps 7–10 against the new deployed SHA).

**PR:** [#769](https://github.com/Aepwiley13/idynify-scout/pull/769)
**Branch:** `claude/billing-hardening-pr1`
**Frozen at commit:** `f96f115` ([f96f11548eff38b23e39f06b912c938f0c794e19](https://github.com/Aepwiley13/idynify-scout/commit/f96f11548eff38b23e39f06b912c938f0c794e19))
**CI at this commit:** all three required jobs passing — [run 43127940900](https://github.com/Aepwiley13/idynify-scout/actions/runs/43127940900) (`rules` ✅, `test` ✅, `billing-emulator` ✅)
**`f96f115` is the reviewed PR tip, not the production deploy commit.** Merging produces a new
commit on `main` (a merge or squash commit, per repo convention) — that commit, not `f96f115`,
is what Netlify actually deploys and what §3 step 7 onward verifies. See step 6.
**Full operational detail:** [docs/BILLING_CUTOVER_RUNBOOK.md](BILLING_CUTOVER_RUNBOOK.md) — this
packet is the approval-level summary of that document; the runbook is the copy to actually
follow command-by-command during the deploy.

## 1. Roles

**Confirmed by the account owner.** This assignment confirms ownership only — it does **not**
authorize merging, deployment, production configuration changes, or repair writes. Those remain
separately gated by the sign-off checklist's own "Approved to execute" line and the overall
`NOT EXECUTED` status at the top of this packet.

| Role | Name | Basis |
|---|---|---|
| Deployment operator | **Aaron Wiley** (aaron@idynify.com) | Confirmed by the account owner. |
| Monitoring owner | **Aaron Wiley** (aaron@idynify.com) | Confirmed by the account owner — same person as the deployment operator, by explicit assignment, not a default. |
| Payment-recovery responsibility | **Aaron Wiley** (aaron@idynify.com), using `scripts/manualCreditRecovery.mjs` | Confirmed by the account owner. Owns every `billingAmbiguousAccounts` record this cutover produces, end to end: review, verify, and either run the recovery script with real evidence or leave it flagged pending with a documented reason. |

## 2. Exact environment changes

**Netlify production environment variables** — confirm present, change nothing except the one
row marked below:

| Variable | Action |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | **No change.** Confirm still present (runbook §0.2). |
| `STRIPE_PRICE_SCOUT_STARTER_FREE` | **Previously confirmed UNSET. No production environment change has been authorized yet — do not assume an earlier round of this work applied it.** Re-check at step 2 below; if still absent, **set it to `price_1T3UsqJEdYAFEzC36VCvIZ90`** (the live $0/mo Scout Starter Free price — see `src/test/stripeWebhookScoutStarterFreePrice.test.js`) as part of step 2, before proceeding. Required for this PR's price-recognition logic, or `knownPriceIds()` silently narrows to the two paid prices. |
| `VITE_STRIPE_CHECKOUT_MODE` | **No change.** Leave absent or anything other than `'session'` — flipping the checkout flow is an explicit, separate decision outside this release. |
| `BILLING_LEDGER_EPOCH_UNIX` | **Must be absent going into step 3 below.** This is the one variable this release ever touches, and only in step 5, only after step 4's verification passes. Absent = automatic allocation is OFF — every unmarked purchase is flagged for manual review, not auto-granted and not lost. |

**Firestore:** one rules deployment (step 3). **No data migration and no bulk/direct repair
writes performed by this release process itself** — no backfill script, no manual document
edits as part of deployment. This does **not** mean zero document writes after deployment: once
live, the Stripe webhook handler (`netlify/functions/stripe-webhook.js`) writes real billing
records (`billingAllocations`, `billingAmbiguousAccounts`, `stripeWebhookEvents`,
`stripeWebhookPendingEvents`) for every genuine Stripe event it processes, as normal operation —
that is the release's intended behavior, not an exception to this clause.

**No other environment, infrastructure, or account-level change is in scope for this release.**

## 3. Ordered procedure

Each step names its exact command (full text in the runbook section cited), its expected result,
and the condition that means **stop, do not proceed**.

| # | Step | Command (see runbook §) | Expected result | Stop if |
|---|---|---|---|---|
| 1 | Check out the exact frozen commit (local verification only — steps 2–5 below; this checkout is never what gets deployed, see step 6) | `git checkout f96f115` (§0.1) | `git log -1` shows `f96f115` | Any other commit is checked out |
| 2 | Confirm required variables; set `STRIPE_PRICE_SCOUT_STARTER_FREE` if still absent | `netlify api getEnvVars ...` with `account_id` and `site_id` (§0.2 — the site-scoped `getSiteEnvVars` returns Not Found); if `STRIPE_PRICE_SCOUT_STARTER_FREE` is absent, set it to `price_1T3UsqJEdYAFEzC36VCvIZ90` | Table in §2 above matches exactly, including `STRIPE_PRICE_SCOUT_STARTER_FREE` present with that value | Any pre-existing variable is missing, `STRIPE_PRICE_SCOUT_STARTER_FREE` holds an unexpected value, or `BILLING_LEDGER_EPOCH_UNIX` is already set |
| 3 | Confirm Stripe API compatibility | Dashboard check (§0.3) | Already resolved this session for `2025-10-29.clover` — re-check only if the endpoint's configured version has changed since | The configured version changed AND a field this code reads changed shape for it (see §0.3's field list) |
| 4 | Diff Firestore rules against current `main` | `git diff origin/main -- firestore.rules` (§0.5) | Every removed line is one this branch itself rewrote | Any removed line has no corresponding rewrite — `main` gained something this branch doesn't have |
| 5 | Deploy Firestore rules | `firebase deploy --only firestore:rules --project idynify-scout-dev` (§1) | `✔ Deploy complete!`; Console "Last published" timestamp is fresh | Deploy errors, or the Console timestamp doesn't update |
| 6 | Merge PR #769 via an approved GitHub merge (never a direct push to `main`), then confirm Netlify's resulting deploy | GitHub: merge PR #769 after required reviews/CI are green (§2) | PR #769 shows **Merged**. Record the resulting commit SHA — GitHub's merge-commit SHA, or `git fetch origin main && git rev-parse origin/main` immediately after — this is `<deployed-sha>` for steps 7–9 below, **not** `f96f115`. Netlify build succeeds using the **real production environment** (see §4 below — this is the one build validation this release actually relies on), and Netlify's deploy record shows that same SHA | PR #769 cannot be merged cleanly (conflicts, a failing required check, missing approval) — resolve first, never force-merge. Or the Netlify build fails for any reason, including the client Firebase config gate in `vite.config.js`. Or Netlify's deployed commit does not match the SHA recorded above |
| 7 | Confirm the handler is live, drained, nothing armed | `node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>` (§3), using the SHA recorded in step 6 | `NOT RUNTIME-VERIFIED ACTIVE`, `epoch_env_var_not_set`, nested `deploy.ready: true` | `deploy.ready` is `false` — wait and re-run, do not advance |
| 8 | Arm | same script, same `<deployed-sha>`, `--apply --epoch "$(date +%s)"` (§4) | Exits `1`, "THIS IS NOT YET ACTIVE" | The write itself errors |
| 9 | Force a rebuild | Empty commit push, or "Clear cache and deploy site" (§4) | New Netlify deploy completes | Build fails |
| 10 | Confirm activation | Same script, no flags (§4) | `RUNTIME-VERIFIED ACTIVE` | Still not active — do not treat the release as complete; re-check steps 8–9 |

Step 10's `RUNTIME-VERIFIED ACTIVE` is the release's actual completion criterion. Before it,
automatic allocation is off by construction (step 2's `BILLING_LEDGER_EPOCH_UNIX` absence) —
there is no window in this sequence where allocation is silently on without having been verified.

## 4. Production build/deploy validation — using the actual production configuration

**This session's own build checks used `.env.test`'s fake Firebase client credentials
(`npm run build -- --mode test`), never real production values — this session has no access to
those and has not validated against them.** That gap is closed by step 6 above, not by anything
this session ran: when the operator merges PR #769 into `main`, Netlify's own build runs with the **real**
`VITE_FIREBASE_*` values already configured in its production environment (`mode: production`,
the plain `vite build` Netlify's own pipeline invokes) — that build succeeding or failing *is*
the actual production-configuration validation. The operator must confirm that Netlify build
log shows success before proceeding past step 6; this packet does not consider step 6 satisfied
by anything verified locally in this session.

Everything this session did independently verify (CI, `npm run test:billing-emulator`, the pure
unit suites) exercises the server-side billing code — `stripe-webhook.js`,
`manualCreditRecovery.mjs`, `billingLedgerCutover.mjs` — none of which is reachable from the
Vite client bundle at all, so the `--mode test` gap above does not affect the validity of those
results; it affects only confidence in the *frontend build* succeeding with real secrets, which
only Netlify's own pipeline can actually confirm.

## 5. Incident response reference

Not part of the ordered procedure above — kept here only as a pointer. Full detail (prohibited
rollback, the verified Stripe-disable alternative, retention limits, inventory/reconcile
scripts) is in the runbook §5–§9. Payment-recovery responsibility for anything that surfaces
there is the same owner named in §1.

## Sign-off

- [x] Roles in §1 confirmed — **Aaron Wiley (aaron@idynify.com)**, all three rows. This confirms
      ownership only; it does **not**, by itself, authorize merging, deployment, production
      configuration changes, or repair writes — those require the remaining items below.
- [ ] Environment changes in §2 reviewed, including that `STRIPE_PRICE_SCOUT_STARTER_FREE` is
      still unset and must be set to `price_1T3UsqJEdYAFEzC36VCvIZ90` during step 2 if so
- [ ] Procedure in §3 reviewed, no steps skipped — including that step 6 is an approved GitHub
      merge of PR #769, never a direct push to `main`, and that its resulting commit SHA (not
      `f96f115`) is recorded for steps 7–9
- [ ] §4 understood: step 6's Netlify build, not this session's local build, is the production
      configuration validation
- [ ] Approved to execute

**Status: ATTEMPTED, THEN ROLLED BACK — NOT COMPLETE.** The checklist above was never fully
checked, yet PR #769 was merged and a cutover attempted on 2026-11-12; production was rolled back
the same day and is serving pre-#769 code (§0). Nothing in this packet should be read as approval
to publish `main`. Re-execution needs the open items in §0 closed and a fresh, explicit approval.
