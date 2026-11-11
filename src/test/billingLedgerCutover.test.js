/**
 * Pure unit tests — no network, no Netlify CLI, no emulator. Runs under plain `npm test`.
 *
 * isDeployReadyToArm() answers only "is the expected commit the live, drained production
 * deploy" — a necessary precondition, not proof that automatic allocation is governed by the
 * current epoch value. isRuntimeActivationVerified() is the actual answer to that: a publish
 * timestamp and a successful env-var write are each necessary but neither is sufficient, because
 * Netlify Functions only see an env var's current value starting from the first deploy BUILT
 * after that value last changed (docs.netlify.com/build/environment-variables/get-started/,
 * verified 2026-11-10) — an already-deployed function never picks up a later write
 * retroactively. Activation requires the live deploy's OWN build (createdAt) to postdate the
 * env var's own last-updated timestamp (updated_at, from Netlify's getSiteEnvVars).
 */
import { describe, it, expect } from 'vitest';
import {
  isDeployReadyToArm, isRuntimeActivationVerified, buildEnvSetArgs,
  DEFAULT_MIN_DRAIN_WAIT_MS, FUNCTION_MAX_EXECUTION_MS, DEPLOY_PROPAGATION_MARGIN_MS, EPOCH_ENV_VAR_KEY,
} from '../../scripts/billingLedgerCutover.mjs';

const SHA = '06bc6f42d10ceb7a297b9c09ef6675667bfe96ec';
const NOW = Date.parse('2026-11-10T12:00:00Z');

function readyDeploy(overrides = {}) {
  const createdAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 2000).toISOString();
  const publishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString();
  return {
    id: 'deploy_1', state: 'ready', context: 'production', commit_ref: SHA,
    created_at: createdAt, published_at: publishedAt,
    ...overrides,
  };
}

function epochEnvVars(valueByContext, updatedAt) {
  return [{
    key: EPOCH_ENV_VAR_KEY,
    updated_at: updatedAt,
    values: Object.entries(valueByContext).map(([context, value]) => ({ context, value: String(value) })),
  }];
}

describe('isDeployReadyToArm — the live-deploy precondition', () => {
  it('is ready when the expected commit is the live production deploy and the drain wait has elapsed', () => {
    const verdict = isDeployReadyToArm({ deploys: [readyDeploy()], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('is not ready with no expected commit given — refuses to arm blind', () => {
    const verdict = isDeployReadyToArm({ deploys: [readyDeploy()], expectedCommitSha: undefined, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('expected_commit_sha_required');
  });

  it('is not ready when no production-context deploy exists at all', () => {
    const verdict = isDeployReadyToArm({
      deploys: [{ ...readyDeploy(), context: 'deploy-preview' }], expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('no_production_deploy_found');
  });

  it('is not ready while the production deploy is still building', () => {
    const verdict = isDeployReadyToArm({
      deploys: [readyDeploy({ state: 'building', published_at: null })], expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('deploy_state_is_building');
  });

  it('is not ready when the live commit does not match what we expect to have deployed', () => {
    const verdict = isDeployReadyToArm({
      deploys: [readyDeploy({ commit_ref: 'some-other-sha' })], expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
    expect(verdict.liveCommit).toBe('some-other-sha');
  });

  it('is not ready immediately after publish — the drain wait has not elapsed yet', () => {
    const verdict = isDeployReadyToArm({
      deploys: [readyDeploy({ published_at: new Date(NOW - 1000).toISOString() })], expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('drain_wait_not_elapsed');
    expect(verdict.remainingMs).toBeGreaterThan(0);
  });

  it('becomes ready exactly once the drain wait has elapsed, all else equal', () => {
    const publishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS).toISOString();
    const verdict = isDeployReadyToArm({ deploys: [readyDeploy({ published_at: publishedAt })], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('ignores non-production deploys entirely, even when they are the only other entry present', () => {
    const deploys = [
      { ...readyDeploy(), context: 'deploy-preview', commit_ref: 'preview-sha' },
      readyDeploy(),
    ];
    const verdict = isDeployReadyToArm({ deploys, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('a production deploy that failed (state: error) is never ready, even with a matching commit', () => {
    const verdict = isDeployReadyToArm({
      deploys: [readyDeploy({ state: 'error' })], expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('deploy_state_is_error');
  });

  it('the drain wait is the documented function execution ceiling plus an explicit, separate margin — not a bare magic number', () => {
    expect(FUNCTION_MAX_EXECUTION_MS).toBe(60_000); // docs.netlify.com/build/functions/configuration/
    expect(DEPLOY_PROPAGATION_MARGIN_MS).toBeGreaterThan(0); // no published SLA exists; this is a deliberate buffer
    expect(DEFAULT_MIN_DRAIN_WAIT_MS).toBe(FUNCTION_MAX_EXECUTION_MS + DEPLOY_PROPAGATION_MARGIN_MS);
  });

  it('picks the most recent production deploy by timestamp even when it is NOT the first production entry in the array', () => {
    const older = readyDeploy({
      id: 'deploy_old', commit_ref: 'old-sha',
      created_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 50_000).toISOString(),
      published_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 50_000).toISOString(),
    });
    const newer = readyDeploy(); // SHA, more recent timestamps
    const verdict = isDeployReadyToArm({ deploys: [older, newer], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
    expect(verdict.deployId).toBe('deploy_1'); // the newer one, not deploy_old
  });
});

describe('isRuntimeActivationVerified — a publish timestamp and an env-var write are each necessary, neither sufficient', () => {
  it('is NOT active when the deploy is ready but the epoch env var is not set at all', () => {
    const verdict = isRuntimeActivationVerified({ deploys: [readyDeploy()], envVars: [], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_set');
  });

  it('is NOT active when the live deploy is not itself ready (commit mismatch) — env var state is irrelevant', () => {
    const envVars = epochEnvVars({ production: 1000 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({
      deploys: [readyDeploy({ commit_ref: 'different-sha' })], envVars, expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
  });

  it('is ACTIVE when the live deploy was built after the env var was last updated', () => {
    // Env var updated well before this deploy's own build started.
    const envUpdatedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 3600_000).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAt);
    const verdict = isRuntimeActivationVerified({ deploys: [readyDeploy()], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(true);
    expect(verdict.liveEpochUnix).toBe(1762776000);
  });

  it('is NOT active — THE decisive case — when the live deploy\'s own build predates the env var\'s last update: a publish timestamp plus a successful write is not proof', () => {
    // The deploy BUILT (created_at) before the env var was written. Even though the deploy is
    // "ready", published, and drained, and the env var IS set — the live function's build could
    // not have packaged a value that didn't exist yet when it was built.
    const deploy = readyDeploy(); // created_at is DEFAULT_MIN_DRAIN_WAIT_MS + 2s before NOW
    const envUpdatedAfterBuild = new Date(Date.parse(deploy.created_at) + 1000).toISOString(); // 1s AFTER the build started
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAfterBuild);

    const verdict = isRuntimeActivationVerified({ deploys: [deploy], envVars, expectedCommitSha: SHA, nowMs: NOW });

    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('live_deploy_predates_env_var_update');
  });

  it('is NOT active when the env var has no production value, even if some other context has one', () => {
    const envVars = epochEnvVars({ 'deploy-preview': 999 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ deploys: [readyDeploy()], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_set_for_production');
  });

  it('is NOT active when the env var\'s updated_at is itself missing — cannot verify ordering at all', () => {
    const envVars = [{ key: EPOCH_ENV_VAR_KEY, values: [{ context: 'production', value: '123' }] }]; // no updated_at
    const verdict = isRuntimeActivationVerified({ deploys: [readyDeploy()], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_updated_at_unknown');
  });

  it('rollback/redeployment before gate activation: a rollback to an earlier commit is never active, regardless of env var state', () => {
    const envVars = epochEnvVars({ production: 1762776000 }, new Date(NOW - 10_000_000).toISOString());
    // Ops rolled back to a different (earlier, or simply not-the-expected) commit.
    const rolledBackDeploy = readyDeploy({ id: 'deploy_rollback', commit_ref: 'rollback-sha' });
    const verdict = isRuntimeActivationVerified({ deploys: [rolledBackDeploy], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
  });

  it('rollback/redeployment before gate activation: a forward redeploy that lands BEFORE a pending env var change is not active until its OWN build postdates that change', () => {
    // Scenario: ops fixes the rollback and redeploys the expected commit — but the env var write
    // (e.g. a fresh epoch chosen for THIS recovery) happens to land after this redeploy's build
    // already started (a plausible ordering if the operator writes the env var "at the same
    // time" as triggering the deploy). The redeploy is live, matching, and drained — but its own
    // build predates the write, so it must NOT be trusted yet.
    const forwardDeploy = readyDeploy({ id: 'deploy_forward_redeploy' });
    const envUpdatedAfterThisBuild = new Date(Date.parse(forwardDeploy.created_at) + 500).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAfterThisBuild);

    const verdict = isRuntimeActivationVerified({ deploys: [forwardDeploy], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('live_deploy_predates_env_var_update');
  });

  it('rollback/redeployment before gate activation: becomes active only once a SUBSEQUENT redeploy is built after the env var update', () => {
    const envUpdatedAt = new Date(NOW - 10_000_000).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAt);

    // A later redeploy, built well after the env var change above.
    const laterDeploy = readyDeploy({
      id: 'deploy_after_recovery',
      created_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString(), // after envUpdatedAt
      published_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS).toISOString(),
    });

    const verdict = isRuntimeActivationVerified({ deploys: [laterDeploy], envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(true);
    expect(verdict.deployId).toBe('deploy_after_recovery');
  });
});

describe('buildEnvSetArgs — the write must target the exact site the readiness check verified', () => {
  it('scopes the env:set call to the given site id, not the CLI\'s ambient linked site', () => {
    const args = buildEnvSetArgs('site_abc123', 1_762_776_000);
    expect(args).toEqual(['env:set', 'BILLING_LEDGER_EPOCH_UNIX', '1762776000', '--context', 'production', '--site', 'site_abc123']);
  });

  it('a different verified site produces a write scoped to THAT site, never a different one', () => {
    const args = buildEnvSetArgs('site_other', 42);
    expect(args).toContain('--site');
    expect(args[args.indexOf('--site') + 1]).toBe('site_other');
    expect(args).not.toContain('site_abc123');
  });
});
