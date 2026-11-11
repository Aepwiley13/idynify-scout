#!/usr/bin/env node
/**
 * Replaces "guess a timing buffer and hope the deploy finished by then" with a verified cutover —
 * and, as of this round, replaces a second, deeper guess this script itself used to make: that a
 * published deploy plus a successful `netlify env:set` call means automatic allocation is now
 * governed by the new value. It doesn't, on this platform, and this script no longer claims it
 * does. See "Why a publish timestamp and an env-var write are not proof" below.
 *
 * ── Why a publish timestamp and an env-var write are not proof ───────────────────────────────
 *
 * Verified 2026-11-10 against docs.netlify.com/build/environment-variables/get-started/:
 * "Environment variable changes require a build and deploy to take effect." Netlify Functions
 * are Lambda-backed and get environment variables packaged in AT BUILD TIME — an
 * ALREADY-DEPLOYED function never picks up a later `env:set` retroactively. It keeps running
 * with whatever value was baked in at ITS OWN build, until the NEXT deploy repackages it.
 *
 * The previous version of this script conflated two independent facts: "the expected commit is
 * the live, drained production deploy" (isDeployReadyToArm, still correct and still necessary)
 * and "that live deploy's packaged function sees the epoch value I just wrote" (false in
 * general — the write and the live deploy's own build are not ordered with respect to each
 * other just because the write succeeded). Writing the env var and reporting "Armed" was
 * therefore not evidence that automatic grants were actually governed by the new value — it was
 * evidence only that Netlify's config store accepted the write.
 *
 * isRuntimeActivationVerified() below closes this gap the only way that's actually checkable:
 * Netlify's env-var API returns `updated_at` per variable (verified 2026-11-10 against
 * open-api.netlify.com's env_vars schema). Activation requires BOTH facts, with an explicit
 * ORDER between them: the live, matching, drained deploy's own `created_at` (when ITS build
 * started) must be AFTER the env var's `updated_at`. A deploy that started building before the
 * value changed could not have packaged the new value, no matter how long ago it published or
 * how long it's been running since.
 *
 * This also makes rollback recovery automatic rather than a separate case: after a rollback (or
 * any deploy that predates the current env-var value), this function reports NOT active — not
 * because of anything rollback-specific, but because the ordinary ordering check fails. The same
 * check that protects the original cutover protects every redeploy after a rollback, with no
 * special-cased logic.
 *
 * ── Platform timing assumptions, verified (not guessed) ───────────────────────────────────────
 *
 * "Old invocations drained" has no API to query directly — an in-flight old-code invocation at
 * deploy-swap finishes on its own. MIN_DRAIN_WAIT_MS is a fixed wait after `published_at` before
 * this script will call the deploy ready, derived from two separately-verified platform facts:
 *
 *   1. FUNCTION_MAX_EXECUTION_MS: Netlify's documented, non-configurable synchronous function
 *      execution limit is 60 seconds (docs.netlify.com/build/functions/configuration/, verified
 *      2026-11-10). stripe-webhook.js carries no per-function `timeout` override in netlify.toml,
 *      so it is bound by this platform default.
 *   2. DEPLOY_PROPAGATION_MARGIN_MS: a deliberate buffer on top of (1) — Netlify's own API
 *      reference (open-api.netlify.com) publishes no SLA for edge/lambda propagation time after
 *      `published_at`. Absent a published number, this margin is conservative, not measured.
 *
 * ── Site selection, verified (not guessed) ────────────────────────────────────────────────────
 *
 * Netlify's own API reference documents no ordering guarantee for listSiteDeploys. This script
 * always picks the most recent production-context deploy by comparing timestamps explicitly,
 * never by array position. The write (when --apply is used) is scoped with the SAME --site the
 * read was verified against — never the CLI's ambient linked site (this repo checks in no
 * .netlify/state.json).
 *
 * USAGE
 *   node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id>
 *     → reports whether automatic allocation is currently RUNTIME-VERIFIED active. Read-only.
 *   node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> --apply --epoch <unix-seconds>
 *     → writes BILLING_LEDGER_EPOCH_UNIX. Exits non-zero and says so explicitly: writing is never
 *       activation. Trigger a new production deploy yourself, then re-run WITHOUT --apply to
 *       verify activation before trusting automatic allocation. This script never triggers a
 *       deploy itself — that is a bigger production action than writing one env var, and stays
 *       the operator's own, explicit step.
 *
 * Exit codes: 0 verified active; 1 not active yet (including immediately after --apply), or a
 * usage/API error.
 */

import { execFileSync } from 'node:child_process';

export const EPOCH_ENV_VAR_KEY = 'BILLING_LEDGER_EPOCH_UNIX';

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
 * Pure decision — no network, no process, fully unit-testable. Answers only "is the expected
 * commit the live, drained production deploy" — NOT "is automatic allocation governed by the
 * current epoch value" (see isRuntimeActivationVerified for that; a deploy being ready here says
 * nothing about what environment variables its packaged functions were actually built with).
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

  if (!deploy.created_at) return { ready: false, reason: 'no_created_at_timestamp', deployId: deploy.id };

  return { ready: true, deployId: deploy.id, publishedAt: deploy.published_at, createdAt: deploy.created_at };
}

/**
 * THE decisive check this round's review finding named: a publish timestamp and an env-var
 * write are each necessary but neither alone is sufficient. Automatic allocation is considered
 * runtime-verified active only when the live, matching, drained deploy's OWN build (createdAt)
 * started AFTER the epoch env var's last update (envVars[].updated_at) — proof the live
 * function's build could actually have packaged the current value, not merely that both facts
 * exist somewhere. Pure and fully unit-testable: `envVars` is the raw array Netlify's
 * getSiteEnvVars returns.
 */
export function isRuntimeActivationVerified({ deploys, envVars, expectedCommitSha, nowMs = Date.now(), minDrainWaitMs = DEFAULT_MIN_DRAIN_WAIT_MS }) {
  const deployVerdict = isDeployReadyToArm({ deploys, expectedCommitSha, nowMs, minDrainWaitMs });
  if (!deployVerdict.ready) return { active: false, reason: deployVerdict.reason, deploy: deployVerdict };

  const epochVar = (envVars ?? []).find((v) => v.key === EPOCH_ENV_VAR_KEY);
  if (!epochVar) return { active: false, reason: 'epoch_env_var_not_set', deploy: deployVerdict };

  const prodValue = (epochVar.values ?? []).find((v) => v.context === 'production');
  if (!prodValue || prodValue.value == null) return { active: false, reason: 'epoch_env_var_not_set_for_production', deploy: deployVerdict };

  if (!epochVar.updated_at) return { active: false, reason: 'epoch_env_var_updated_at_unknown', deploy: deployVerdict };

  const envUpdatedAtMs = Date.parse(epochVar.updated_at);
  const deployCreatedAtMs = Date.parse(deployVerdict.createdAt);

  if (deployCreatedAtMs < envUpdatedAtMs) {
    return {
      active: false, reason: 'live_deploy_predates_env_var_update',
      deployCreatedAtMs, envUpdatedAtMs, deployId: deployVerdict.deployId, deploy: deployVerdict,
    };
  }

  return {
    active: true, deployId: deployVerdict.deployId, liveEpochUnix: Number(prodValue.value), envUpdatedAt: epochVar.updated_at,
  };
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; continue; }
    if (a === '--expect-commit') { args.expectCommitSha = argv[++i]; continue; }
    if (a === '--site') { args.siteId = argv[++i]; continue; }
    if (a === '--epoch') { args.epochUnix = argv[++i]; continue; }
  }
  return args;
}

function fetchProductionDeploys(siteId) {
  const out = execFileSync('netlify', ['api', 'listSiteDeploys', '--data', JSON.stringify({ site_id: siteId, per_page: 20 })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function fetchSiteEnvVars(siteId, contextName) {
  const out = execFileSync('netlify', ['api', 'getSiteEnvVars', '--data', JSON.stringify({ site_id: siteId, context_name: contextName })], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * Pure — the exact argv `netlify env:set` will receive. Exported so "the write must target the
 * same site the readiness check verified" is directly unit-testable without shelling out.
 */
export function buildEnvSetArgs(siteId, epochUnix) {
  return ['env:set', EPOCH_ENV_VAR_KEY, String(epochUnix), '--context', 'production', '--site', siteId];
}

function writeEpochEnvVar(siteId, epochUnix) {
  execFileSync('netlify', buildEnvSetArgs(siteId, epochUnix), { stdio: 'inherit' });
}

function main() {
  const { apply, expectCommitSha, siteId, epochUnix } = parseArgs(process.argv.slice(2));
  if (!expectCommitSha || !siteId) {
    console.error('Usage: node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> [--apply --epoch <unix-seconds>]');
    process.exit(1);
  }

  let deploys, envVars;
  try {
    deploys = fetchProductionDeploys(siteId);
    envVars = fetchSiteEnvVars(siteId, 'production');
  } catch (err) {
    console.error('Failed to query Netlify:', err.message);
    process.exit(1);
  }

  const activation = isRuntimeActivationVerified({ deploys, envVars, expectedCommitSha: expectCommitSha });

  if (activation.active) {
    console.log(
      `RUNTIME-VERIFIED ACTIVE: ${EPOCH_ENV_VAR_KEY}=${activation.liveEpochUnix} on site ${siteId}, deploy ${activation.deployId} ` +
      `(built after the env var's last update at ${activation.envUpdatedAt}). Automatic allocation is governed by this value now.`
    );
    process.exit(0);
  }

  console.log('NOT RUNTIME-VERIFIED ACTIVE:', JSON.stringify(activation, null, 2));

  if (!apply) {
    console.log('To change the armed value, re-run with --apply --epoch <unix-seconds>. Writing alone never activates it — see below.');
    process.exit(1);
  }

  if (!epochUnix) {
    console.error('--apply requires --epoch <unix-seconds> — the boundary you are choosing, not inferred from any timestamp.');
    process.exit(1);
  }

  writeEpochEnvVar(siteId, epochUnix);
  console.log(
    `Wrote ${EPOCH_ENV_VAR_KEY}=${epochUnix} to site ${siteId}, context production. THIS IS NOT YET ACTIVE: ` +
    'Netlify Functions only see an env var\'s current value starting from the first deploy BUILT after this write — ' +
    'an already-deployed function never picks it up retroactively. Trigger a new production deploy yourself, then ' +
    're-run this script WITHOUT --apply to verify activation before trusting automatic allocation.'
  );
  process.exit(1); // deliberately non-zero: writing is never success for activation purposes
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
