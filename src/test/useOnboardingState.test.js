/**
 * useOnboardingState (Mission Control 2.0 Sprint 2, Workstream A2) — Unit Tests
 *
 * Exercises the pure derivation helpers that drive the onboarding flow:
 * step derivation, the new-user check, the Gmail live-connection derivation,
 * and the 7-day staleness fallback for stuck returning users.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveOnboardingState,
  deriveGmailConnected,
  isStaleOnboarding,
  ONBOARDING_FLAGS,
} from '../hooks/useOnboardingState.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── deriveGmailConnected ─────────────────────────────────────────────────────

describe('deriveGmailConnected', () => {
  it('is false with no integration doc', () => {
    expect(deriveGmailConnected(null)).toBe(false);
    expect(deriveGmailConnected(undefined)).toBe(false);
  });
  it('is true with a connected doc carrying a refresh token', () => {
    expect(deriveGmailConnected({ status: 'connected', refreshToken: 'r' })).toBe(true);
  });
  it('is true with an access token even if status is unset', () => {
    expect(deriveGmailConnected({ accessToken: 'a' })).toBe(true);
  });
  it('is false when explicitly disconnected', () => {
    expect(deriveGmailConnected({ status: 'disconnected', refreshToken: 'r' })).toBe(false);
  });
  it('is false with no token present', () => {
    expect(deriveGmailConnected({ status: 'connected' })).toBe(false);
  });
});

// ─── isStaleOnboarding ────────────────────────────────────────────────────────

describe('isStaleOnboarding', () => {
  const now = Date.now();
  it('is true for a started, incomplete user older than 7 days', () => {
    expect(isStaleOnboarding({ started: true }, new Date(now - 8 * DAY_MS), now)).toBe(true);
  });
  it('is false within the 7-day window', () => {
    expect(isStaleOnboarding({ started: true }, new Date(now - 3 * DAY_MS), now)).toBe(false);
  });
  it('is false if never started', () => {
    expect(isStaleOnboarding({}, new Date(now - 30 * DAY_MS), now)).toBe(false);
  });
  it('is false if already completed', () => {
    expect(isStaleOnboarding({ started: true, completed: true }, new Date(now - 30 * DAY_MS), now)).toBe(false);
  });
  it('handles Firestore Timestamp-like objects', () => {
    const ts = { toMillis: () => now - 10 * DAY_MS };
    expect(isStaleOnboarding({ started: true }, ts, now)).toBe(true);
  });
  it('is false when createdAt is missing', () => {
    expect(isStaleOnboarding({ started: true }, null, now)).toBe(false);
  });
});

// ─── deriveOnboardingState: step derivation ───────────────────────────────────

describe('deriveOnboardingState step derivation', () => {
  it('step 1 (Meet Barry) for a brand-new user', () => {
    const s = deriveOnboardingState(undefined, false, null);
    expect(s.currentStep).toBe(1);
    expect(s.isNewUser).toBe(true);
    expect(s.isComplete).toBe(false);
  });

  it('step 2 after started', () => {
    expect(deriveOnboardingState({ started: true }, false).currentStep).toBe(2);
  });

  it('step 3 after website analyzed', () => {
    expect(
      deriveOnboardingState({ started: true, websiteAnalyzed: true }, false).currentStep
    ).toBe(3);
  });

  it('step 4 (Connect Gmail) after smart questions', () => {
    expect(
      deriveOnboardingState(
        { started: true, websiteAnalyzed: true, smartQuestionsAnswered: true },
        false
      ).currentStep
    ).toBe(4);
  });

  it('step 5 (Scout Builds List) once Gmail is connected', () => {
    expect(
      deriveOnboardingState(
        { started: true, websiteAnalyzed: true, smartQuestionsAnswered: true },
        true
      ).currentStep
    ).toBe(5);
  });

  it('step 6 when completed', () => {
    const s = deriveOnboardingState({ started: true, completed: true }, true);
    expect(s.currentStep).toBe(6);
    expect(s.isComplete).toBe(true);
    expect(s.isNewUser).toBe(false);
  });
});

// ─── deriveOnboardingState: flags + fallbacks ─────────────────────────────────

describe('deriveOnboardingState flags', () => {
  it('reflects raw flags plus the live gmail connection', () => {
    const s = deriveOnboardingState(
      { started: true, websiteAnalyzed: true, smartQuestionsAnswered: false, skipped: false },
      true
    );
    expect(s.flags).toEqual({
      started: true,
      websiteAnalyzed: true,
      smartQuestionsAnswered: false,
      gmailConnected: true,
      completed: false,
    });
    expect(s.isSkipped).toBe(false);
  });

  it('treats a stale started-but-incomplete user as complete', () => {
    const oldCreatedAt = new Date(Date.now() - 10 * DAY_MS);
    const s = deriveOnboardingState({ started: true }, false, oldCreatedAt);
    expect(s.isComplete).toBe(true);
    expect(s.currentStep).toBe(6);
    expect(s.flags.completed).toBe(true);
  });

  it('surfaces the skipped flag', () => {
    expect(deriveOnboardingState({ started: true, skipped: true }, false).isSkipped).toBe(true);
  });
});

// ─── flag registry ────────────────────────────────────────────────────────────

describe('ONBOARDING_FLAGS', () => {
  it('exposes exactly the writable onboarding flags', () => {
    expect(Object.keys(ONBOARDING_FLAGS).sort()).toEqual(
      ['completed', 'skipped', 'smartQuestionsAnswered', 'started', 'websiteAnalyzed'].sort()
    );
  });
});
