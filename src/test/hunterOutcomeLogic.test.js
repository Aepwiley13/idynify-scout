/**
 * HUNTER OUTCOME LOGIC — QA Unit Tests
 *
 * Tests the relationship_state transition engine.
 * These transitions fire immediately after a user logs an outcome
 * and drive Barry's next recommendation on the card.
 *
 * Core principle: conservative. Advance state only on clear positive signals.
 * Never penalize state from a single negative outcome.
 * Barry can always correct — but wrong state transitions create wrong messages.
 */

import { describe, it, expect } from 'vitest';
import { getStateTransition } from '../utils/hunterOutcomeLogic';

// ── Positive reply transitions ─────────────────────────────────────────────

describe('getStateTransition — positive_reply', () => {

  it('advances unaware → aware (they responded: they know the user now)', () => {
    expect(getStateTransition('positive_reply', 'unaware')).toBe('aware');
  });

  it('advances aware → engaged (positive exchange = conversation is alive)', () => {
    expect(getStateTransition('positive_reply', 'aware')).toBe('engaged');
  });

  it('advances dormant → aware (dormant + positive = relationship reactivating)', () => {
    expect(getStateTransition('positive_reply', 'dormant')).toBe('aware');
  });

  it('returns null for engaged (already in active exchange — positive reply does not advance further)', () => {
    // One positive reply doesn't make a relationship 'warm' — that requires demonstrated trust
    expect(getStateTransition('positive_reply', 'engaged')).toBeNull();
  });

  it('returns null for warm (already has trust — positive reply does not advance to trusted)', () => {
    expect(getStateTransition('positive_reply', 'warm')).toBeNull();
  });

  it('returns null for trusted (already at high trust level)', () => {
    expect(getStateTransition('positive_reply', 'trusted')).toBeNull();
  });

  it('returns null for advocate (at the top of the positive arc)', () => {
    expect(getStateTransition('positive_reply', 'advocate')).toBeNull();
  });

  it('returns null for strategic_partner (formal partnership — positive reply is expected)', () => {
    expect(getStateTransition('positive_reply', 'strategic_partner')).toBeNull();
  });

  it('returns null for strained (positive reply from strained contact is promising but not sufficient to advance)', () => {
    // Strained → requires deliberate trust rebuilding, not automatic advancement
    expect(getStateTransition('positive_reply', 'strained')).toBeNull();
  });
});

// ── Scheduled transitions ──────────────────────────────────────────────────

describe('getStateTransition — scheduled', () => {

  it('advances unaware → engaged (agreed to meet = minimum engaged)', () => {
    expect(getStateTransition('scheduled', 'unaware')).toBe('engaged');
  });

  it('advances aware → engaged', () => {
    expect(getStateTransition('scheduled', 'aware')).toBe('engaged');
  });

  it('advances dormant → engaged (rescheduled = back in active conversation)', () => {
    expect(getStateTransition('scheduled', 'dormant')).toBe('engaged');
  });

  it('advances strained → engaged (they agreed to meet despite tension = real signal)', () => {
    expect(getStateTransition('scheduled', 'strained')).toBe('engaged');
  });

  it('returns null for engaged (already at engaged or better — scheduling is expected)', () => {
    expect(getStateTransition('scheduled', 'engaged')).toBeNull();
  });

  it('returns null for warm', () => {
    expect(getStateTransition('scheduled', 'warm')).toBeNull();
  });

  it('returns null for trusted', () => {
    expect(getStateTransition('scheduled', 'trusted')).toBeNull();
  });

  it('returns null for advocate', () => {
    expect(getStateTransition('scheduled', 'advocate')).toBeNull();
  });

  it('returns null for strategic_partner', () => {
    expect(getStateTransition('scheduled', 'strategic_partner')).toBeNull();
  });
});

// ── No-change outcomes ─────────────────────────────────────────────────────
// These outcomes must NEVER change relationship_state
// (one interaction is not enough evidence to penalize or advance the relationship)

describe('getStateTransition — outcomes that never change state', () => {

  const noChangeOutcomes = ['no_reply', 'neutral_reply', 'negative_reply', 'not_interested'];
  const allStates = ['unaware', 'aware', 'engaged', 'warm', 'trusted', 'advocate', 'dormant', 'strained', 'strategic_partner'];

  noChangeOutcomes.forEach(outcome => {
    allStates.forEach(state => {
      it(`${outcome} + ${state} → null (no state change)`, () => {
        expect(getStateTransition(outcome, state)).toBeNull();
      });
    });
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe('getStateTransition — edge cases', () => {

  it('returns null for an unknown outcome (safe fallback)', () => {
    expect(getStateTransition('unknown_outcome', 'unaware')).toBeNull();
  });

  it('returns null for undefined outcome', () => {
    expect(getStateTransition(undefined, 'unaware')).toBeNull();
  });

  it('returns null for null outcome', () => {
    expect(getStateTransition(null, 'unaware')).toBeNull();
  });

  it('never returns undefined — always null or a valid state string', () => {
    const outcomes = ['no_reply', 'positive_reply', 'neutral_reply', 'negative_reply', 'scheduled', 'not_interested', null, undefined];
    const states = ['unaware', 'aware', 'engaged', 'warm', 'trusted', 'advocate', 'dormant', 'strained', null, undefined];
    outcomes.forEach(o => {
      states.forEach(s => {
        const result = getStateTransition(o, s);
        expect(result === null || typeof result === 'string').toBe(true);
      });
    });
  });
});
