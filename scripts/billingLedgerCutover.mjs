#!/usr/bin/env node
/**
 * Replaces "guess a timing buffer and hope the deploy finished by then" with a verified cutover:
 * this script will not arm the billing ledger (set BILLING_LEDGER_EPOCH_UNIX in production)
 * unless it has independently confirmed, via the Netlify API, that the expected commit is the
 * live, fully-published production deploy — not "probably live by now."
 *
 * Covers both requirements that depend on this: the ORIGINAL cutover, and every redeploy that
 * follows a rollback (customer.subscription.deleted/updated reconciliation already runs
 * unconditionally and is unaffected by any of this — only credit-granting allocation is gated by
 * the epoch). Use the SAME command for both; there is no separate "rollback cutover" procedure.
 *
 * "Old invocations drained" has no API to query directly — Netlify Functions are Lambda-backed
 * and swap at publish time, but an in-flight old-code invocation at that instant finishes on its
 * own. MIN_DRAIN_WAIT_MS below is a fixed, conservative wait after `published_at` before this
 * script will call the deploy ready — a bounded, honest stand-in for "drained," not a proof.
 *
 * USAGE (dry-run by default; nothing is written to production without --apply)
 *   netlify api listSiteDeploys --data '{"site_id":"<site>","per_page":20}' | \
 *     node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> [--apply]
 *
 * The CLI entrypoint below shells out to `netlify api` itself — you don't need to pipe it in by
 * hand; that invocation is shown above only to make the data source explicit.
 *
 * Exit codes: 0 ready (armed if --apply, or printed what would be armed otherwise);
 * 1 not ready yet, or a usage/API error.
 */

import { execFileSync } from 'node:child_process';

export const DEFAULT_MIN_DRAIN_WAIT_MS = 60_000;

/**
 * Pure decision — no network, no process, fully unit-testable. `deploys` is the raw array
 * Netlify's listSiteDeploys returns; this picks the most recent production-context entry itself
 * rather than trusting a caller to have already filtered correctly.
 */
export function isDeployReadyToArm({ deploys, expectedCommitSha, nowMs = Date.now(), minDrainWaitMs = DEFAULT_MIN_DRAIN_WAIT_MS }) {
  if (!expectedCommitSha) return { ready: false, reason: 'expected_commit_sha_required' };

  const deploy = (deploys ?? []).find((d) => d.context === 'production');
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

  return { ready: true, deployId: deploy.id, publishedAt: deploy.published_at };
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

function armLedger() {
  const epoch = Math.floor(Date.now() / 1000);
  execFileSync('netlify', ['env:set', 'BILLING_LEDGER_EPOCH_UNIX', String(epoch), '--context', 'production'], { stdio: 'inherit' });
  return epoch;
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

  console.log(`Confirmed live: deploy ${verdict.deployId}, published ${verdict.publishedAt}, commit matches, drain wait elapsed.`);
  if (!apply) {
    console.log('Dry run — would set BILLING_LEDGER_EPOCH_UNIX to the current time. Re-run with --apply to actually set it.');
    process.exit(0);
  }

  const epoch = armLedger();
  console.log(`Armed. BILLING_LEDGER_EPOCH_UNIX set to ${epoch} in production.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
