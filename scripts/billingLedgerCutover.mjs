#!/usr/bin/env node
/**
 * An ADVISORY check for operators, not an enforcement mechanism. It answers "has runtime
 * activation been independently confirmed" — it cannot and does not gate what the live webhook
 * actually does with any given event; the webhook enforces its own correctness at runtime (see
 * netlify/functions/stripe-webhook.js's decideAllocationEligibility — the
 * already_shows_completed_payment_no_marker check closes the gap this script, being external and
 * optional, structurally cannot: a purchase that unhardened or rolled-back code already granted
 * directly, then replayed into hardened code before anyone re-runs this script, must not grant
 * again regardless of whether this script ever ran). Nothing here substitutes for that.
 *
 * ── Why a publish timestamp and an env-var write are not proof ───────────────────────────────
 *
 * Verified 2026-11-10 against docs.netlify.com/build/environment-variables/get-started/:
 * "Environment variable changes require a build and deploy to take effect." Netlify Functions
 * are Lambda-backed and get environment variables packaged in AT BUILD TIME — an
 * ALREADY-DEPLOYED function never picks up a later `env:set` retroactively. It keeps running
 * with whatever value was baked in at ITS OWN build, until the NEXT deploy repackages it.
 *
 * isRuntimeActivationVerified() closes this the only way that's actually checkable: Netlify's
 * env-var API returns `updated_at` per variable (verified 2026-11-10 against
 * open-api.netlify.com's env_vars schema). Activation requires the live, matching, drained
 * deploy's own `created_at` (when ITS build started) to be AFTER the env var's `updated_at`. A
 * deploy that started building before the value changed could not have packaged it, no matter
 * how long ago it published or how long it's been running since.
 *
 * ── Round-11: use the site's actual published deploy, not "newest production-context entry" ──
 *
 * The previous version picked the most-recent-by-timestamp entry from listSiteDeploys whose
 * context was "production" — a heuristic over a list, not a query for what is actually live.
 * Verified 2026-11-11 against open-api.netlify.com's Site schema: GET /sites/{site_id} returns
 * `published_deploy`, the site's own authoritative pointer to what currently serves production
 * traffic. This version reads that field directly instead of inferring it by sorting.
 *
 * ── Round-11: validate the effective value and its function scope, not only timestamps ───────
 *
 * Two more silent-failure modes this script now checks instead of assuming:
 *   - SCOPE: an env var's `scopes` array (verified against open-api.netlify.com's env_vars
 *     schema: "builds" | "functions" | "runtime" | "post-processing") controls which surfaces
 *     ever see it. A value scoped only to "builds" would never reach a Netlify Function's
 *     process.env at all, no matter how the deploy and update timestamps line up. Activation
 *     requires "functions" to be present in scopes.
 *   - VALUE: the stored value itself must parse to a finite, positive number — a blank, missing,
 *     or non-numeric value is caught explicitly rather than surfacing later as a silent
 *     `Number(...)` → NaN inside the webhook's own epoch comparison.
 *
 * ── Rollback recovery ──────────────────────────────────────────────────────────────────────────
 *
 * A rollback deploy, or any deploy whose build predates the current env-var value, fails the
 * ordinary createdAt-vs-updated_at ordering check above — no rollback-specific branch needed for
 * THIS script's own job (confirming activation). What a rollback can still do that this script
 * cannot see or prevent: unhardened/rolled-back code processing a purchase during the rollback
 * window with no ledger marker, then that event being replayed once hardened code resumes. That
 * is a restriction on rollback strategy, made explicit here: never roll back to pre-ledger code
 * as an incident response for this webhook, and never trust automatic allocation for anything
 * that may have happened during ANY rollback until it's been through the webhook's own
 * already_shows_completed_payment_no_marker check (always on, regardless of this script) and a
 * human has cleared the account's flagged record if one was raised. Re-running this script after
 * a rollback is necessary for ADVISORY confirmation, but the actual stop against a double grant
 * is enforced in stripe-webhook.js, not here.
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
 *      reference publishes no SLA for edge/lambda propagation time after `published_at`. Absent
 *      a published number, this margin is conservative, not measured.
 *
 * USAGE
 *   node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id>
 *     → reports whether automatic allocation is currently RUNTIME-VERIFIED active. Read-only.
 *   node scripts/billingLedgerCutover.mjs --expect-commit <sha> --site <site-id> --apply --epoch <unix-seconds>
 *     → writes BILLING_LEDGER_EPOCH_UNIX. Exits non-zero and says so explicitly: writing is never
 *       activation. Trigger a new production deploy yourself, then re-run WITHOUT --apply to
 *       verify activation. This script never triggers a deploy itself — that is a bigger
 *       production action than writing one env var, and stays the operator's own, explicit step.
 *
 * Exit codes: 0 verified active; 1 not active yet (including immediately after --apply), or a
 * usage/API error.
 */

import { execFileSync } from 'node:child_process';

export const EPOCH_ENV_VAR_KEY = 'BILLING_LEDGER_EPOCH_UNIX';
export const REQUIRED_SCOPE = 'functions';

// Verified 2026-11-10 against https://docs.netlify.com/build/functions/configuration/ — the
// documented, non-configurable synchronous-function execution ceiling. See file header.
export const FUNCTION_MAX_EXECUTION_MS = 60_000;

// Deliberate, labeled buffer on top of the verified ceiling above — Netlify publishes no deploy-
// propagation SLA to size this from. See file header.
export const DEPLOY_PROPAGATION_MARGIN_MS = 30_000;

export const DEFAULT_MIN_DRAIN_WAIT_MS = FUNCTION_MAX_EXECUTION_MS + DEPLOY_PROPAGATION_MARGIN_MS;

/**
 * Pure decision — no network, no process, fully unit-testable. `site` is the raw object
 * Netlify's getSite returns; this reads `site.published_deploy` directly — the site's own
 * authoritative pointer to what is actually live — rather than inferring it by sorting
 * listSiteDeploys. Answers only "is the expected commit the live, drained production deploy" —
 * NOT "is automatic allocation governed by the current epoch value" (see
 * isRuntimeActivationVerified for that).
 */
export function isDeployReadyToArm({ site, expectedCommitSha, nowMs = Date.now(), minDrainWaitMs = DEFAULT_MIN_DRAIN_WAIT_MS }) {
  if (!expectedCommitSha) return { ready: false, reason: 'expected_commit_sha_required' };

  const deploy = site?.published_deploy;
  if (!deploy) return { ready: false, reason: 'no_published_deploy_found' };

  if (deploy.context && deploy.context !== 'production') {
    return { ready: false, reason: 'published_deploy_not_production', deployId: deploy.id, context: deploy.context };
  }

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
 * THE decisive check: a publish timestamp and an env-var write are each necessary but neither
 * alone is sufficient. Automatic allocation is considered runtime-verified active only when:
 *   - the site's actual published deploy matches the expected commit, is ready, and is drained;
 *   - the epoch env var is scoped to reach Netlify Functions at all;
 *   - its stored value parses to a real, usable epoch; and
 *   - that published deploy's OWN build started after the env var's last update.
 * Pure and fully unit-testable: `envVars` is the raw array Netlify's getSiteEnvVars returns.
 */
export function isRuntimeActivationVerified({ site, envVars, expectedCommitSha, nowMs = Date.now(), minDrainWaitMs = DEFAULT_MIN_DRAIN_WAIT_MS }) {
  const deployVerdict = isDeployReadyToArm({ site, expectedCommitSha, nowMs, minDrainWaitMs });
  if (!deployVerdict.ready) return { active: false, reason: deployVerdict.reason, deploy: deployVerdict };

  const epochVar = (envVars ?? []).find((v) => v.key === EPOCH_ENV_VAR_KEY);
  if (!epochVar) return { active: false, reason: 'epoch_env_var_not_set', deploy: deployVerdict };

  const scopes = epochVar.scopes ?? [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    return { active: false, reason: 'epoch_env_var_not_scoped_to_functions', scopes, deploy: deployVerdict };
  }

  const prodValue = (epochVar.values ?? []).find((v) => v.context === 'production');
  if (!prodValue || prodValue.value == null || prodValue.value === '') {
    return { active: false, reason: 'epoch_env_var_not_set_for_production', deploy: deployVerdict };
  }

  const liveEpochUnix = Number(prodValue.value);
  if (!Number.isFinite(liveEpochUnix) || liveEpochUnix <= 0) {
    return { active: false, reason: 'epoch_env_var_value_invalid', rawValue: prodValue.value, deploy: deployVerdict };
  }

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
    active: true, deployId: deployVerdict.deployId, liveEpochUnix, envUpdatedAt: epochVar.updated_at,
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

function fetchSite(siteId) {
  const out = execFileSync('netlify', ['api', 'getSite', '--data', JSON.stringify({ site_id: siteId })], { encoding: 'utf8' });
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

  let site, envVars;
  try {
    site = fetchSite(siteId);
    envVars = fetchSiteEnvVars(siteId, 'production');
  } catch (err) {
    console.error('Failed to query Netlify:', err.message);
    process.exit(1);
  }

  const activation = isRuntimeActivationVerified({ site, envVars, expectedCommitSha: expectCommitSha });

  if (activation.active) {
    console.log(
      `RUNTIME-VERIFIED ACTIVE: ${EPOCH_ENV_VAR_KEY}=${activation.liveEpochUnix} on site ${siteId}, deploy ${activation.deployId} ` +
      `(built after the env var's last update at ${activation.envUpdatedAt}). This is advisory confirmation only — the webhook ` +
      `enforces its own correctness at runtime regardless of whether this script has ever been run (see stripe-webhook.js).`
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
    're-run this script WITHOUT --apply to verify activation. Remember: this script is advisory only — the webhook\'s ' +
    'own already_shows_completed_payment_no_marker check is what actually stops a rollback-window purchase from being ' +
    'granted twice, whether or not this script is ever re-run.'
  );
  process.exit(1); // deliberately non-zero: writing is never success for activation purposes
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
