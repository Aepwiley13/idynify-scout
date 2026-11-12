# Billing ledger — release approval packet

**Status: NOT EXECUTED.** This is an approval document, not a log of actions taken. No
production environment variable, Firestore rule, or deploy has been changed. PR #769 is frozen
at the commit below and remains unmerged until this packet is signed off.

**PR:** [#769](https://github.com/Aepwiley13/idynify-scout/pull/769)
**Branch:** `claude/billing-hardening-pr1`
**Frozen at commit:** `f96f115` ([f96f11548eff38b23e39f06b912c938f0c794e19](https://github.com/Aepwiley13/idynify-scout/commit/f96f11548eff38b23e39f06b912c938f0c794e19))
**CI at this commit:** all three required jobs passing — [run 43127940900](https://github.com/Aepwiley13/idynify-scout/actions/runs/43127940900) (`rules` ✅, `test` ✅, `billing-emulator` ✅)
**Full operational detail:** [docs/BILLING_CUTOVER_RUNBOOK.md](BILLING_CUTOVER_RUNBOOK.md) — this
packet is the approval-level summary of that document; the runbook is the copy to actually
follow command-by-command during the deploy.

## 1. Roles

| Role | Name | Basis |
|---|---|---|
| Deployment operator | **Aaron** (aaron@idynify.com) | Default assignment — the account owner who has driven this entire engagement. **Confirm or reassign before executing**; this is not an organizational fact this session can independently verify. |
| Monitoring owner | **Aaron** (aaron@idynify.com) | Same default and same caveat. May be the same person as the operator or a separate on-call assignment — team's call. |
| Payment-recovery responsibility | **Aaron**, using `scripts/manualCreditRecovery.mjs` | Owns every `billingAmbiguousAccounts` record this cutover produces, end to end: review, verify, and either run the recovery script with real evidence or leave it flagged pending with a documented reason. No one else is assumed to have write access to the production Firebase project for this. |

If any of these three should actually be different people, update this table before treating the
packet as approved — the procedure below assumes one accountable person per row, not a diffusion
of responsibility across whoever happens to be online during the deploy.

## 2. Exact environment changes

**Netlify production environment variables** — confirm present, change nothing except the one
row marked below:

| Variable | Action |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | **No change.** Confirm still present (runbook §0.2). |
| `STRIPE_PRICE_SCOUT_STARTER_FREE` | **No change if already set from the earlier round of this work; confirm it is.** New to this PR's price-recognition logic — must be present or `knownPriceIds()` silently narrows to the two paid prices. |
| `VITE_STRIPE_CHECKOUT_MODE` | **No change.** Leave absent or anything other than `'session'` — flipping the checkout flow is an explicit, separate decision outside this release. |
| `BILLING_LEDGER_EPOCH_UNIX` | **Must be absent going into step 3 below.** This is the one variable this release ever touches, and only in step 5, only after step 4's verification passes. Absent = automatic allocation is OFF — every unmarked purchase is flagged for manual review, not auto-granted and not lost. |

**Firestore:** one rules deployment (step 3), no data migration, no document writes of any kind
by this release itself.

**No other environment, infrastructure, or account-level change is in scope for this release.**

## 3. Ordered procedure

Each step names its exact command (full text in the runbook section cited), its expected result,
and the condition that means **stop, do not proceed**.

| # | Step | Command (see runbook §) | Expected result | Stop if |
|---|---|---|---|---|
| 1 | Check out the exact frozen commit | `git checkout f96f115` (§0.1) | `git log -1` shows `f96f115` | Any other commit is checked out |
| 2 | Confirm required variables | `netlify api getSiteEnvVars ...` (§0.2) | Table in §2 above matches exactly | Any pre-existing variable is missing, or `BILLING_LEDGER_EPOCH_UNIX` is already set |
| 3 | Confirm Stripe API compatibility | Dashboard check (§0.3) | Already resolved this session for `2025-10-29.clover` — re-check only if the endpoint's configured version has changed since | The configured version changed AND a field this code reads changed shape for it (see §0.3's field list) |
| 4 | Diff Firestore rules against current `main` | `git diff origin/main -- firestore.rules` (§0.5) | Every removed line is one this branch itself rewrote | Any removed line has no corresponding rewrite — `main` gained something this branch doesn't have |
| 5 | Deploy Firestore rules | `firebase deploy --only firestore:rules --project idynify-scout-dev` (§1) | `✔ Deploy complete!`; Console "Last published" timestamp is fresh | Deploy errors, or the Console timestamp doesn't update |
| 6 | Deploy the application code | `git push origin main` (normal pipeline) (§2) | Netlify build succeeds using the **real production environment** (see §5 below — this is the one build validation this release actually relies on) | The Netlify build fails for any reason, including the client Firebase config gate in `vite.config.js` |
| 7 | Confirm the handler is live, drained, nothing armed | `node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <SITE_ID>` (§3) | `NOT RUNTIME-VERIFIED ACTIVE`, `epoch_env_var_not_set`, nested `deploy.ready: true` | `deploy.ready` is `false` — wait and re-run, do not advance |
| 8 | Arm | same script `--apply --epoch "$(date +%s)"` (§4) | Exits `1`, "THIS IS NOT YET ACTIVE" | The write itself errors |
| 9 | Force a rebuild | Empty commit push, or "Clear cache and deploy site" (§4) | New Netlify deploy completes | Build fails |
| 10 | Confirm activation | Same script, no flags (§4) | `RUNTIME-VERIFIED ACTIVE` | Still not active — do not treat the release as complete; re-check steps 8–9 |

Step 10's `RUNTIME-VERIFIED ACTIVE` is the release's actual completion criterion. Before it,
automatic allocation is off by construction (step 2's `BILLING_LEDGER_EPOCH_UNIX` absence) —
there is no window in this sequence where allocation is silently on without having been verified.

## 4. Production build/deploy validation — using the actual production configuration

**This session's own build checks used `.env.test`'s fake Firebase client credentials
(`npm run build -- --mode test`), never real production values — this session has no access to
those and has not validated against them.** That gap is closed by step 6 above, not by anything
this session ran: when the operator pushes to `main`, Netlify's own build runs with the **real**
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

- [ ] Roles in §1 confirmed or reassigned
- [ ] Environment changes in §2 reviewed
- [ ] Procedure in §3 reviewed, no steps skipped
- [ ] §4 understood: step 6's Netlify build, not this session's local build, is the production
      configuration validation
- [ ] Approved to execute

No step above has been executed. Execution begins only after this packet is signed off.
