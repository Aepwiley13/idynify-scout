/**
 * Pure unit tests — no network, no Netlify CLI, no emulator. Runs under plain `npm test`.
 *
 * isDeployReadyToArm() is the enforceable precondition that replaces a guessed timing buffer:
 * the billing ledger (BILLING_LEDGER_EPOCH_UNIX) must never be armed until the expected commit
 * is confirmed as the live, fully-published production deploy, with a minimum wait elapsed since
 * publish as a bounded stand-in for "old invocations drained" (no stronger signal is available).
 */
import { describe, it, expect } from 'vitest';
import { isDeployReadyToArm, DEFAULT_MIN_DRAIN_WAIT_MS } from '../../scripts/billingLedgerCutover.mjs';

const SHA = '06bc6f42d10ceb7a297b9c09ef6675667bfe96ec';
const NOW = Date.parse('2026-11-10T12:00:00Z');

function readyDeploy(overrides = {}) {
  return {
    id: 'deploy_1', state: 'ready', context: 'production', commit_ref: SHA,
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

  it('picks the most recent production-context deploy when multiple deploys are present (previews included)', () => {
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
});
