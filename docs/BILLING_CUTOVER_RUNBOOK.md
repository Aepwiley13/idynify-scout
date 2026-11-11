# Billing ledger cutover — executable procedure

Who this is for: the operator deploying this PR to production, or responding to an incident
with it already live. Governs `BILLING_LEDGER_EPOCH_UNIX`, read directly by
`netlify/functions/stripe-webhook.js`. `scripts/billingLedgerCutover.mjs` is the tool used at
every step — it is advisory/read-mostly: it reports whether activation is confirmed, it never
gates what the live webhook does with any given event (see its header for why, and see
`decideAllocationEligibility`'s own consistency guards for what actually protects a rollback
replay regardless of this procedure being followed).

## 0. Precondition: safe default before anything is deployed

`BILLING_LEDGER_EPOCH_UNIX` must be **unset** in the production environment before step 1.
Unset means every unmarked purchase is flagged (`epoch_unset`) into `billingAmbiguousAccounts`
instead of auto-granted — fail-closed by construction, not a special mode. Confirm:

```bash
netlify api getSiteEnvVars --data '{"site_id":"<SITE_ID>","context_name":"production"}' | grep -c BILLING_LEDGER_EPOCH_UNIX
```

Expect `0`. If it's already set from a prior attempt, see §3 before proceeding.

## 1. Initial cutover

1. Merge and deploy the hardened commit to production through the normal pipeline (push to
   `main`; Netlify auto-deploys). Automatic allocation is OFF for the whole time this takes —
   new purchases are flagged for manual review, not lost and not silently mis-granted.
2. Confirm the handler is live and drained, with nothing armed yet:
   ```bash
   node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
   ```
   Expect `NOT RUNTIME-VERIFIED ACTIVE` with `"reason": "epoch_env_var_not_set"` **and** a nested
   `"deploy"` object showing `"ready": true`. `ready: true` here is the actual precondition this
   step exists to confirm (live, matching commit, drained); `epoch_env_var_not_set` just
   confirms nothing is armed yet, which is expected and correct at this point. If `deploy.ready`
   is `false`, wait and re-run — do not proceed to step 3 until it is `true`.
3. Arm:
   ```bash
   node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID> --apply --epoch "$(date +%s)"
   ```
   This writes the value and exits `1` on purpose — writing is never activation (Netlify
   Functions only see a new env var from the first deploy *built after* the write).
4. Trigger a new deploy so the write actually reaches the running function — any mechanism that
   produces a fresh build is fine (an empty commit push, or "Clear cache and deploy site" in the
   Netlify UI). Wait for it to finish.
5. Re-confirm activation against that redeploy:
   ```bash
   node scripts/billingLedgerCutover.mjs --expect-commit <deployed-sha> --site <SITE_ID>
   ```
   Expect `RUNTIME-VERIFIED ACTIVE`. This is the exit criterion — automatic allocation is now
   governed by the value written in step 3.

Ordinary subsequent deploys of newer hardened commits need none of this repeated: the epoch
value is a fixed historical boundary (purchases before it were never meant to auto-grant), not
something that needs to track every deploy. Re-running step 5 after a routine deploy is good
practice, not a requirement.

## 2. Incident response: pre-ledger rollback is prohibited — do this instead

**Never roll back below the commit that introduced `billingAllocations` and the
`decideAllocationEligibility` consistency guards** (`already_shows_completed_payment_no_marker`,
`subscription_dead_no_marker`). Code from before that point can grant credits with no marker at
all, and nothing in this system can detect or undo that after the fact.

- **If a fix-forward is possible** (the normal case): just deploy the fix as a new commit. No
  special procedure. The epoch and the webhook's own guards are untouched throughout; §1 step 5
  confirms activation afterward if you want the confirmation, but it isn't required for safety.
- **If the webhook must stop processing entirely** (even the latest hardened commit is judged
  unsafe to run) — do not roll back code to get there. Make the endpoint fail *retryably*
  instead, so Stripe queues redelivery (verified: live-mode webhooks retry with exponential
  backoff for up to 3 days before Stripe disables the endpoint) rather than dropping events:
  - Route the webhook path to a `503` via a Netlify redirect (this repo's `netlify.toml` already
    uses `[[redirects]]` for unrelated rules — same mechanism), or unpublish just that one
    function from the Netlify dashboard/CLI. Neither touches application code.
  - Stripe retries hold the events. No code — hardened or otherwise — runs against them while
    the endpoint is down.
  - Once a genuinely fixed hardened commit is ready: remove the redirect / republish the
    function, deploy, and let Stripe's queued retries drain in through the intact epoch and
    consistency guards exactly as any other delivery would.
