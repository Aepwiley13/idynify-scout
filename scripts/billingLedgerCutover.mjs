#!/usr/bin/env node
/**
 * Replaces "guess a timing buffer and hope the deploy finished by then" with a verified cutover:
 * this script will not arm the billing ledger (set BILLING_LEDGER_EPOCH_UNIX in production)
 * unless it has independently confirmed, via the Netlify API, that the expected commit is the
 * live, fully-published production deploy on the EXACT site named by --site — not "probably
 * live by now," and not "live on whichever site the local `netlify` CLI happens to be linked to."
 *
 * Covers both requirements that depend on this: the ORIGINAL cutover, and every redeploy that
 * follows a rollback (customer.subscription.deleted/updated reconciliation already runs
 * unconditionally and is unaffected by any of this — only credit-granting allocation is gated by
 * the epoch). Use the SAME command for both; there is no separate "rollback cutover" procedure —
 * see "Why the epoch is deterministic, not wall-clock" below for why that's actually safe.
 *
 * ── Platform timing assumptions, verified (not guessed) ───────────────────────────────────────
 *
 * "Old invocations drained" has no API to query directly — Netlify Functions are Lambda-backed
 * and swap at publish time, but an in-flight old-code invocation at that instant finishes on its
 * own. MIN_DRAIN_WAIT_MS is a fixed wait after `published_at` before this script will call the
 * deploy ready — a bounded, honest stand-in for "drained," not a proof. It is derived from two
 * separately-verified platform facts, not picked arbitrarily:
 *
 *   1. FUNCTION_MAX_EXECUTION_MS: Netlify's documented, non-configurable synchronous function
 *      execution limit is 60 seconds (https://docs.netlify.com/build/functions/configuration/,
 *      verified 2026-11-10). stripe-webhook.js carries no per-function `timeout` override in
 *      netlify.toml (unlike several other functions in this repo that do), so it is bound by this
 *      platform default — an in-flight old invocation can run for up to 60s after it started,
 *      and it could have started an instant before the swap.
 *   2. DEPLOY_PROPAGATION_MARGIN_MS: a deliberate buffer on top of (1), because Netlify's own API
 *      reference (open-api.netlify.com) documents no SLA for how long it takes between a deploy
 *      being marked `published_at` and every edge/lambda route actually pointing at the new
 *      function version. Absent a published number, this margin is conservative, not measured.
 *
 * Previously this constant was a flat, undocumented 60_000ms — exactly equal to the function's
 * own worst-case lifetime, with zero margin for propagation on top of it. That was a guess
 * wearing the clothes of a verified number; this is the corrected, cited version.
 *
 * ── Why the epoch is deterministic, not wall-clock ────────────────────────────────────────────
 *
 * The armed epoch is derived from the verified deploy's own `published_at` — never from
 * `Date.now()` at the moment this script happens to run. Two consequences, both load-bearing:
 *
 *   - Re-running this script again for the SAME still-live deploy (a safety re-check, a second
 *     operator running it, a retry after a transient Netlify API error) computes the IDENTICAL
 *     epoch every time. A wall-clock-at-invocation epoch would instead creep forward on every
 *     re-run, retroactively flagging already-legitimate in-window purchases as "pre-epoch" for no
 *     reason connected to anything that actually changed.
 *   - A rollback followed by a forward redeploy needs no separate procedure: the new deploy has
 *     its own, later `published_at`, so running this same command against it computes a fresh
 *     epoch anchored to when hardened processing actually resumed on THAT deploy — never to
 *     whenever ops happened to type the command.
 *
 * ── Site selection, verified (not guessed) ────────────────────────────────────────────────────
 *
 * Netlify's own API reference documents no ordering guarantee for listSiteDeploys (verified
 * 2026-11-10: open-api.netlify.com describes the response shape, not its order). The previous
 * version picked the first array entry whose context was "production" — silently correct only if
 * the API happens to return newest-first, which is nowhere documented. This version always picks
 * the most recent production-context deploy by comparing timestamps explicitly, regardless of
 * array order.
 *
 * USAGE (dry-run by default; nothing is written to production without --apply)
 *   netlify api listSiteDeploys --data '{"site_id":"<site>","per_page":20}' | \
 *     node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> [--apply]
 *
 * The CLI entrypoint below shells out to `netlify api` itself — you don't need to pipe it in by
 * hand; that invocation is shown above only to make the data source explicit. The write
 * (`netlify env:set`) is scoped with the SAME `--site <site-id>` that readiness was verified
 * against — never the CLI's ambient linked site, which this repo doesn't even configure
 * (no .netlify/state.json is checked in).
 *
 * Exit codes: 0 ready (armed if --apply, or printed what would be armed otherwise);
 * 1 not ready yet, or a usage/API error.
 */

import { execFileSync } from 'node:child_process';

// Verified 2026-11-10 against https://docs.netlify.com/build/functions/configuration/ — the
// documented, non-configurable synchronous-function execution ceiling. See file header.
export const FUNCTION_MAX_EXECUTION_MS = 60_000;

// Deliberate, labeled buffer on top of the verified ceiling above — Netlify publishes no deploy-
// propagation SLA to size this from. See file header.
export const DEPLOY_PROPAGATION_MARGIN_MS = 30_000;

export const DEFAULT_MIN_DRAIN_WAIT_MS = FUNCTION_MAX_EXECUTION_MS + DEPLOY_PROPAGATION_MARGIN_MS;

/**
 * Picks the most recent production-context deploy by comparing timestamps explicitly — never by
 * trusting array position (see file header: Netlify documents no ordering guarantee).
 */
function mostRecentProductionDeploy(deploys) {
  const candidates = (deploys ?? []).filter((d) => d.context === 'production');
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, d) => {
    const dTime = Date.parse(d.created_at ?? d.published_at ?? 0) || 0;
    const latestTime = Date.parse(latest.created_at ?? latest.published_at ?? 0) || 0;
    return dTime > latestTime ? d : latest;
  });
}

/**
 * Pure decision — no network, no process, fully unit-testable. `deploys` is the raw array
 * Netlify's listSiteDeploys returns; this picks the most recent production-context entry itself
 * by timestamp, rather than trusting either a caller's pre-filtering or the API's array order.
 */
export function isDeployReadyToArm({ deploys, expectedCommitSha, nowMs = Date.now(), minDrainWaitMs = DEFAULT_MIN_DRAIN_WAIT_MS }) {
  if (!expectedCommitSha) return { ready: false, reason: 'expected_commit_sha_required' };

  const deploy = mostRecentProductionDeploy(deploys);
  if (!deploy) return { ready: false, reason: 'no_production_deploy_found' };

  if (deploy.state !== 'ready') return { ready: false, reason: `deploy_state_is_${deploy.state}`, deployId: deploy.id };

  if (deploy.commit_ref !== expectedCommitSha) {
    return { ready: false, reason: 'commit_mismatch', liveCommit: deploy.commit_ref, expectedCommitSha, deployId: deploy.id };
  }

  const publishedAtMs = deploy.published_at ? Date.parse(deploy.published_at) : null;
  if (publishedAtMs == null) return { ready: false, reason: 'no_published_at_timestamp', deployId: deploy.id };

  const elapsedMs = nowMs - publishedAtMs;
  if (elapsedMs < minDrainWaitMs) {
    return {
      ready: false, reason: 'drain_wait_not_elapsed', deployId: deploy.id,
      elapsedMs, minDrainWaitMs, remainingMs: minDrainWaitMs - elapsedMs,
    };
  }

  // Deterministic, tied to THIS deploy's own publish time — never to nowMs. See file header
  // ("Why the epoch is deterministic, not wall-clock") for why that's what makes idempotent
  // re-runs and rollback-recovery both correct with no separate procedure.
  const computedEpochUnix = Math.floor(publishedAtMs / 1000);

  return { ready: true, deployId: deploy.id, publishedAt: deploy.published_at, computedEpochUnix };
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; continue; }
    if (a === '--expect-commit') { args.expectCommitSha = argv[++i]; continue; }
    if (a === '--site') { args.siteId = argv[++i]; continue; }
  }
  return args;
}

function fetchProductionDeploys(siteId) {
  const out = execFileSync('netlify', ['api', 'listSiteDeploys', '--data', JSON.stringify({ site_id: siteId, per_page: 20 })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * Pure — the exact argv `netlify env:set` will receive. Exported so the fix for "the write must
 * target the same site the readiness check verified" is directly unit-testable without shelling
 * out: `--site` here must always equal the `--site` passed to fetchProductionDeploys above.
 */
export function buildEnvSetArgs(siteId, epochUnix) {
  return ['env:set', 'BILLING_LEDGER_EPOCH_UNIX', String(epochUnix), '--context', 'production', '--site', siteId];
}

function armLedger(siteId, epochUnix) {
  execFileSync('netlify', buildEnvSetArgs(siteId, epochUnix), { stdio: 'inherit' });
  return epochUnix;
}

function main() {
  const { apply, expectCommitSha, siteId } = parseArgs(process.argv.slice(2));
  if (!expectCommitSha || !siteId) {
    console.error('Usage: node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> [--apply]');
    process.exit(1);
  }

  let deploys;
  try {
    deploys = fetchProductionDeploys(siteId);
  } catch (err) {
    console.error('Failed to query Netlify for the current production deploy:', err.message);
    process.exit(1);
  }

  const verdict = isDeployReadyToArm({ deploys, expectedCommitSha: expectCommitSha });
  if (!verdict.ready) {
    console.error('NOT READY to arm the billing ledger:', JSON.stringify(verdict, null, 2));
    process.exit(1);
  }

  console.log(
    `Confirmed live on site ${siteId}: deploy ${verdict.deployId}, published ${verdict.publishedAt}, commit matches, ` +
    `drain wait elapsed. Computed epoch: ${verdict.computedEpochUnix} (deterministic — tied to this deploy's own publish time).`
  );
  if (!apply) {
    console.log(`Dry run — would set BILLING_LEDGER_EPOCH_UNIX to ${verdict.computedEpochUnix} on site ${siteId}. Re-run with --apply to actually set it.`);
    process.exit(0);
  }

  armLedger(siteId, verdict.computedEpochUnix);
  console.log(`Armed. BILLING_LEDGER_EPOCH_UNIX set to ${verdict.computedEpochUnix} in production on site ${siteId}.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
