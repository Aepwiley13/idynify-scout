/**
 * Pure unit tests — no network, no Netlify CLI, no emulator. Runs under plain `npm test`.
 *
 * isDeployReadyToArm() is the enforceable precondition that replaces a guessed timing buffer:
 * the billing ledger (BILLING_LEDGER_EPOCH_UNIX) must never be armed until the expected commit
 * is confirmed as the live, fully-published production deploy, with a minimum wait elapsed since
 * publish as a bounded stand-in for "old invocations drained" (no stronger signal is available).
 *
 * Round-10 review findings fixed here, each with its own regression test below:
 *   1. The write must target the exact site the readiness check verified, and the armed epoch
 *      must be deterministic (tied to the deploy's own publish time) so a rollback-then-redeploy
 *      and an idempotent re-run both behave correctly with no separate procedure.
 *   2. (manual recovery — see manualCreditRecovery*.test.js)
 *   3. (manual recovery — see manualCreditRecovery*.test.js)
 */
import { describe, it, expect } from 'vitest';
import {
  isDeployReadyToArm, buildEnvSetArgs, DEFAULT_MIN_DRAIN_WAIT_MS,
  FUNCTION_MAX_EXECUTION_MS, DEPLOY_PROPAGATION_MARGIN_MS,
} from '../../scripts/billingLedgerCutover.mjs';

const SHA = '06bc6f42d10ceb7a297b9c09ef6675667bfe96ec';
const NOW = Date.parse('2026-11-10T12:00:00Z');

function readyDeploy(overrides = {}) {
  return {
    id: 'deploy_1', state: 'ready', context: 'production', commit_ref: SHA,
    created_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString(),
    published_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString(),
    ...overrides,
  };
}

describe('isDeployReadyToArm — the verified-cutover precondition', () => {
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

  // ── Round-10 finding: platform timing assumptions, verified not guessed ──────────────────────

  it('the drain wait is the documented function execution ceiling plus an explicit, separate margin — not a bare magic number', () => {
    expect(FUNCTION_MAX_EXECUTION_MS).toBe(60_000); // docs.netlify.com/build/functions/configuration/
    expect(DEPLOY_PROPAGATION_MARGIN_MS).toBeGreaterThan(0); // no published SLA exists; this is a deliberate buffer
    expect(DEFAULT_MIN_DRAIN_WAIT_MS).toBe(FUNCTION_MAX_EXECUTION_MS + DEPLOY_PROPAGATION_MARGIN_MS);
  });

  // ── Round-10 finding: selection must never trust array order (Netlify documents none) ────────

  it('picks the most recent production deploy by timestamp even when it is NOT the first production entry in the array', () => {
    const older = readyDeploy({
      id: 'deploy_old', commit_ref: 'old-sha',
      created_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 50_000).toISOString(),
      published_at: new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 50_000).toISOString(),
    });
    const newer = readyDeploy(); // SHA, more recent timestamps
    // Older listed FIRST — if array position were ever trusted, this would resolve to the wrong
    // deploy and either falsely refuse (commit mismatch against SHA) or falsely approve a stale one.
    const verdict = isDeployReadyToArm({ deploys: [older, newer], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.ready).toBe(true);
    expect(verdict.deployId).toBe('deploy_1'); // the newer one, not deploy_old
  });

  // ── Round-10 finding: the armed epoch must be deterministic, not wall-clock-at-invocation ────

  it('computes the identical epoch on repeated invocations for the same still-live deploy — idempotent re-runs never creep the epoch forward', () => {
    const v1 = isDeployReadyToArm({ deploys: [readyDeploy()], expectedCommitSha: SHA, nowMs: NOW });
    const v2 = isDeployReadyToArm({ deploys: [readyDeploy()], expectedCommitSha: SHA, nowMs: NOW + 45_000 }); // run again, later
    expect(v1.ready).toBe(true);
    expect(v2.ready).toBe(true);
    expect(v2.computedEpochUnix).toBe(v1.computedEpochUnix);
  });

  it('the computed epoch is tied to the deploy\'s own published_at, not to nowMs at invocation', () => {
    const publishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString();
    const verdict = isDeployReadyToArm({ deploys: [readyDeploy({ published_at: publishedAt })], expectedCommitSha: SHA, nowMs: NOW });
    expect(verdict.computedEpochUnix).toBe(Math.floor(Date.parse(publishedAt) / 1000));
  });

  it('a rollback followed by a forward redeploy computes a fresh epoch anchored to the NEW deploy, independent of the previous arm', () => {
    const rollbackCommit = 'rollback-sha';
    const forwardCommit = 'forward-sha';

    // Original cutover.
    const firstPublishedAt = new Date(NOW - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString();
    const first = isDeployReadyToArm({
      deploys: [readyDeploy({ commit_ref: SHA, published_at: firstPublishedAt, created_at: firstPublishedAt })],
      expectedCommitSha: SHA, nowMs: NOW,
    });
    expect(first.ready).toBe(true);

    // Incident: Netlify rolls back to an earlier deploy. Nothing from this PR is live; arming
    // against it is simply never attempted (ops wouldn't pass --expect-commit for this one).

    // Recovery: a forward redeploy, hours later, to a fixed commit. Same command, new timestamps.
    const laterNow = NOW + 3 * 60 * 60 * 1000;
    const secondPublishedAt = new Date(laterNow - DEFAULT_MIN_DRAIN_WAIT_MS - 1000).toISOString();
    const second = isDeployReadyToArm({
      deploys: [
        readyDeploy({ commit_ref: rollbackCommit, published_at: firstPublishedAt, created_at: firstPublishedAt }),
        readyDeploy({ id: 'deploy_forward', commit_ref: forwardCommit, published_at: secondPublishedAt, created_at: secondPublishedAt }),
      ],
      expectedCommitSha: forwardCommit, nowMs: laterNow,
    });

    expect(second.ready).toBe(true);
    expect(second.deployId).toBe('deploy_forward');
    expect(second.computedEpochUnix).not.toBe(first.computedEpochUnix);
    expect(second.computedEpochUnix).toBeGreaterThan(first.computedEpochUnix);
    expect(second.computedEpochUnix).toBe(Math.floor(Date.parse(secondPublishedAt) / 1000));
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
