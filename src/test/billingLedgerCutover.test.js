/**
 * Pure unit tests — no network, no Netlify CLI, no emulator. Runs under plain `npm test`.
 *
 * isDeployReadyToArm() answers only "is the SITE'S ACTUAL PUBLISHED DEPLOY (site.published_deploy
 * — the authoritative pointer Netlify's own getSite returns, not an inference over
 * listSiteDeploys) the expected commit, ready, and drained" — a necessary precondition, not proof
 * that automatic allocation is governed by the current epoch value. isRuntimeActivationVerified()
 * is the actual answer to that: a publish timestamp and a successful env-var write are each
 * necessary but neither is sufficient — Netlify Functions only see an env var's current value
 * starting from the first deploy BUILT after that value last changed
 * (docs.netlify.com/build/environment-variables/get-started/, verified 2026-11-10), and a value
 * not scoped to "functions" is never visible to a Function at all regardless of timing. Note:
 * this whole module is ADVISORY — it reports whether activation can be confirmed, it does not and
 * cannot gate the live webhook. The actual enforcement against a rollback-window double grant is
 * in netlify/functions/stripe-webhook.js (see stripeWebhookRollbackReplayNoDoubleGrant.test.js).
 */
import { describe, it, expect } from 'vitest';
import {
  isDeployReadyToArm, isRuntimeActivationVerified, buildEnvSetArgs,
  buildGetSiteArgs, buildGetEnvVarsArgs, accountIdOfSite, fetchSite, fetchSiteEnvVars,
  DEFAULT_MIN_DRAIN_WAIT_MS, FUNCTION_MAX_EXECUTION_MS, DEPLOY_PROPAGATION_MARGIN_MS, EPOCH_ENV_VAR_KEY,
} from '../../scripts/billingLedgerCutover.mjs';

const SHA = '06bc6f42d10ceb7a297b9c09ef6675667bfe96ec';
const NOW = Date.parse('2026-11-10T12:00:00Z');

function publishedDeploy(overrides = {}) {
  const createdAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 2000).toISOString();
  const publishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString();
  return {
    id: 'deploy_1', state: 'ready', context: 'production', commit_ref: SHA,
    created_at: createdAt, published_at: publishedAt,
    ...overrides,
  };
}

function siteWith(deployOverrides = {}) {
  return { published_deploy: deployOverrides === null ? null : publishedDeploy(deployOverrides) };
}

function epochEnvVars(valueByContext, updatedAt, scopes = ['functions']) {
  return [{
    key: EPOCH_ENV_VAR_KEY,
    scopes,
    updated_at: updatedAt,
    values: Object.entries(valueByContext).map(([context, value]) => ({ context, value: String(value) })),
  }];
}

describe('isDeployReadyToArm — reads the site\'s ACTUAL published deploy, not an inference over listSiteDeploys', () => {
  it('is ready when the site\'s published deploy matches the expected commit and the drain wait has elapsed', () => {
    const verdict = isDeployReadyToArm({ site: siteWith(), expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('is not ready with no expected commit given — refuses to arm blind', () => {
    const verdict = isDeployReadyToArm({ site: siteWith(), expectedCommitSha: undefined, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('expected_commit_sha_required');
  });

  it('is not ready when the site has no published_deploy at all', () => {
    const verdict = isDeployReadyToArm({ site: siteWith(null), expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('no_published_deploy_found');
  });

  it('is not ready when the site object itself is missing/undefined', () => {
    const verdict = isDeployReadyToArm({ site: undefined, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('no_published_deploy_found');
  });

  it('is not ready when the published deploy\'s own context is somehow not production', () => {
    const verdict = isDeployReadyToArm({ site: siteWith({ context: 'deploy-preview' }), expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('published_deploy_not_production');
  });

  it('is not ready while the published deploy is still building', () => {
    const verdict = isDeployReadyToArm({
      site: siteWith({ state: 'building', published_at: null }), expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('deploy_state_is_building');
  });

  it('is not ready when the live commit does not match what we expect to have deployed', () => {
    const verdict = isDeployReadyToArm({
      site: siteWith({ commit_ref: 'some-other-sha' }), expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
    expect(verdict.liveCommit).toBe('some-other-sha');
  });

  it('is not ready immediately after publish — the drain wait has not elapsed yet', () => {
    const verdict = isDeployReadyToArm({
      site: siteWith({ published_at: new Date(NOW - 1000).toISOString() }), expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('drain_wait_not_elapsed');
    expect(verdict.remainingMs).toBeGreaterThan(0);
  });

  it('becomes ready exactly once the drain wait has elapsed, all else equal', () => {
    const publishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS).toISOString();
    const verdict = isDeployReadyToArm({ site: siteWith({ published_at: publishedAt }), expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('a published deploy that failed (state: error) is never ready, even with a matching commit', () => {
    const verdict = isDeployReadyToArm({ site: siteWith({ state: 'error' }), expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('deploy_state_is_error');
  });

  it('the drain wait is the documented function execution ceiling plus an explicit, separate margin — not a bare magic number', () => {
    expect(FUNCTION_MAX_EXECUTION_MS).toBe(60_000); // docs.netlify.com/build/functions/configuration/
    expect(DEPLOY_PROPAGATION_MARGIN_MS).toBeGreaterThan(0); // no published SLA exists; this is a deliberate buffer
    expect(DEFAULT_MIN_DRAIN_WAIT_MS).toBe(FUNCTION_MAX_EXECUTION_MS + DEPLOY_PROPAGATION_MARGIN_MS);
  });
});

describe('isRuntimeActivationVerified — a publish timestamp and an env-var write are each necessary, neither sufficient', () => {
  it('is NOT active when the deploy is ready but the epoch env var is not set at all', () => {
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars: [], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_set');
  });

  it('is NOT active when the site\'s published deploy does not itself match (commit mismatch) — env var state is irrelevant', () => {
    const envVars = epochEnvVars({ production: 1000 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({
      site: siteWith({ commit_ref: 'different-sha' }), envVars, expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
  });

  it('is ACTIVE when the published deploy was built after the env var was last updated, scoped to functions, with a valid value', () => {
    const envUpdatedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 3600_000).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAt);
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(true);
    expect(verdict.liveEpochUnix).toBe(1762776000);
  });

  it('is NOT active — THE decisive case — when the published deploy\'s own build predates the env var\'s last update', () => {
    const deploy = publishedDeploy();
    const envUpdatedAfterBuild = new Date(Date.parse(deploy.created_at) + 1000).toISOString(); // 1s AFTER the build started
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAfterBuild);

    const verdict = isRuntimeActivationVerified({ site: { published_deploy: deploy }, envVars, expectedCommitSha: SHA, nowMs: NOW });

    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('live_deploy_predates_env_var_update');
  });

  it('is NOT active when the env var has no production value, even if some other context has one', () => {
    const envVars = epochEnvVars({ 'deploy-preview': 999 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_set_for_production');
  });

  it('is NOT active when the env var\'s updated_at is itself missing — cannot verify ordering at all', () => {
    const envVars = [{ key: EPOCH_ENV_VAR_KEY, scopes: ['functions'], values: [{ context: 'production', value: '123' }] }];
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_updated_at_unknown');
  });

  // ── Round-11: validate function scope, not only timestamps ───────────────────────────────────

  it('is NOT active when the env var is set but not scoped to reach Netlify Functions at all (e.g. "builds" only)', () => {
    const envVars = epochEnvVars({ production: 1762776000 }, new Date(NOW - 10_000_000).toISOString(), ['builds']);
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_scoped_to_functions');
    expect(verdict.scopes).toEqual(['builds']);
  });

  it('is ACTIVE when "functions" is one of several scopes, not the only one', () => {
    const envVars = epochEnvVars({ production: 1762776000 }, new Date(NOW - 10_000_000).toISOString(), ['builds', 'functions', 'runtime']);
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(true);
  });

  // ── Round-11: validate the effective value, not only its presence ────────────────────────────

  it('is NOT active when the stored production value is empty', () => {
    const envVars = epochEnvVars({ production: '' }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_not_set_for_production');
  });

  it('is NOT active when the stored production value is not a usable number', () => {
    const envVars = epochEnvVars({ production: 'not-a-number' }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_value_invalid');
  });

  it('is NOT active when the stored production value is zero or negative', () => {
    const envVars = epochEnvVars({ production: 0 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ site: siteWith(), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('epoch_env_var_value_invalid');
  });

  // ── Rollback / redeployment ────────────────────────────────────────────────────────────────────

  it('rollback: the site\'s published deploy pointing at a rolled-back commit is never active, regardless of env var state', () => {
    const envVars = epochEnvVars({ production: 1762776000 }, new Date(NOW - 10_000_000).toISOString());
    const verdict = isRuntimeActivationVerified({ site: siteWith({ id: 'deploy_rollback', commit_ref: 'rollback-sha' }), envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('commit_mismatch');
  });

  it('redeployment: a forward redeploy whose own build predates a pending env var change is not active until a LATER build postdates it', () => {
    const forwardDeploy = publishedDeploy({ id: 'deploy_forward_redeploy' });
    const envUpdatedAfterThisBuild = new Date(Date.parse(forwardDeploy.created_at) + 500).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAfterThisBuild);

    const verdict = isRuntimeActivationVerified({ site: { published_deploy: forwardDeploy }, envVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.active).toBe(false);
    expect(verdict.reason).toBe('live_deploy_predates_env_var_update');
  });

  it('redeployment: becomes active once the site\'s published deploy is a build that postdates the env var update', () => {
    const envUpdatedAt = new Date(NOW - 10_000_000).toISOString();
    const envVars = epochEnvVars({ production: 1762776000 }, envUpdatedAt);

    const laterDeploy = publishedDeploy({
      id: 'deploy_after_recovery',
      created_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString(), // after envUpdatedAt
      published_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS).toISOString(),
    });

    const verdict = isRuntimeActivationVerified({ site: { published_deploy: laterDeploy }, envVars, expectedCommitSha: SHA, nowMs: NOW });
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

/**
 * Regression for the env-var read (2026-11-13). The script used to call the site-scoped
 * `netlify api getSiteEnvVars`, which returns `JSONHTTPError: Not Found` against the real
 * production site — so main() could never get past "Failed to query Netlify". The pure decision
 * tests above all passed anyway, because they hand isRuntimeActivationVerified a fixture and
 * never exercise the call that produces it. These tests pin the call itself.
 */
describe('Netlify env-var read — account-scoped getEnvVars, never the site-scoped call that 404s', () => {
  const SITE_ID = 'site_abc';
  const ACCOUNT_ID = 'acct_123';

  // Mirrors what the real API does: the site-scoped operation is Not Found; the account-scoped
  // one answers only when given BOTH ids.
  function fakeNetlify({ site, envVars }) {
    const calls = [];
    const run = (args) => {
      calls.push(args);
      const [, operation, flag, data] = args;
      expect(args[0]).toBe('api');
      expect(flag).toBe('--data');
      const payload = JSON.parse(data);
      if (operation === 'getSite') return JSON.stringify(site);
      if (operation === 'getEnvVars' && payload.account_id === ACCOUNT_ID && payload.site_id === SITE_ID) {
        return JSON.stringify(envVars);
      }
      throw new Error('JSONHTTPError: Not Found');
    };
    return { run, calls };
  }

  it('builds an account-scoped getEnvVars call carrying both account_id and site_id', () => {
    const args = buildGetEnvVarsArgs({ accountId: ACCOUNT_ID, siteId: SITE_ID });
    expect(args.slice(0, 3)).toEqual(['api', 'getEnvVars', '--data']);
    expect(JSON.parse(args[3])).toEqual({ account_id: ACCOUNT_ID, site_id: SITE_ID });
  });

  it('never issues the site-scoped getSiteEnvVars operation', () => {
    expect(buildGetEnvVarsArgs({ accountId: ACCOUNT_ID, siteId: SITE_ID })).not.toContain('getSiteEnvVars');
  });

  it('refuses to build the call without an account id or without a site id', () => {
    expect(() => buildGetEnvVarsArgs({ siteId: SITE_ID })).toThrow(/accountId is required/);
    expect(() => buildGetEnvVarsArgs({ accountId: ACCOUNT_ID })).toThrow(/siteId is required/);
  });

  it('reads the site by site_id', () => {
    const args = buildGetSiteArgs(SITE_ID);
    expect(args.slice(0, 3)).toEqual(['api', 'getSite', '--data']);
    expect(JSON.parse(args[3])).toEqual({ site_id: SITE_ID });
  });

  it('takes the account id from the getSite response, and fails loudly when it is absent', () => {
    expect(accountIdOfSite({ account_id: ACCOUNT_ID })).toBe(ACCOUNT_ID);
    expect(() => accountIdOfSite({})).toThrow(/no account_id/);
    expect(() => accountIdOfSite(undefined)).toThrow(/no account_id/);
  });

  it('end to end: site then env vars are fetched with calls the API actually answers, and feed a verdict', () => {
    const site = { ...siteWith(), account_id: ACCOUNT_ID };
    const afterEnvUpdate = new Date(Date.parse(site.published_deploy.created_at) - 60_000).toISOString();
    // Shaped like the real account-scoped response: several scopes, a production-context value.
    const envVars = epochEnvVars({ production: 1794507945 }, afterEnvUpdate, ['builds', 'functions', 'post_processing', 'runtime']);
    const { run, calls } = fakeNetlify({ site, envVars });

    const fetchedSite = fetchSite(SITE_ID, run);
    const fetchedEnvVars = fetchSiteEnvVars(fetchedSite, SITE_ID, run);

    expect(calls.map((c) => c[1])).toEqual(['getSite', 'getEnvVars']);
    expect(fetchedEnvVars).toEqual(envVars);
    const verdict = isRuntimeActivationVerified({ site: fetchedSite, envVars: fetchedEnvVars, expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict).toMatchObject({ active: true, liveEpochUnix: 1794507945 });
  });

  it('the original call shape fails against the same fake API — this is the failure the fix removes', () => {
    const { run } = fakeNetlify({ site: { account_id: ACCOUNT_ID }, envVars: [] });
    const original = ['api', 'getSiteEnvVars', '--data', JSON.stringify({ site_id: SITE_ID, context_name: 'production' })];
    expect(() => run(original)).toThrow(/Not Found/);
  });

  it('a getSite response with no account_id stops before any env-var call is attempted', () => {
    const { run, calls } = fakeNetlify({ site: siteWith(), envVars: [] });
    const fetchedSite = fetchSite(SITE_ID, run);
    expect(() => fetchSiteEnvVars(fetchedSite, SITE_ID, run)).toThrow(/no account_id/);
    expect(calls.map((c) => c[1])).toEqual(['getSite']);
  });
});
