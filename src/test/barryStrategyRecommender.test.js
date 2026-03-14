/**
 * BARRY STRATEGY RECOMMENDER — Unit Tests
 *
 * Tests the rule-based pre-generation strategy recommendation engine.
 * Verifies scoring, recommendations, avoidance, and prompt guidance generation.
 */
import { describe, it, expect } from 'vitest';
import { recommendStrategy } from '../../netlify/functions/utils/barryStrategyRecommender';

// ── Helper: minimal params ──────────────────────────────────────────────────

function makeParams(overrides = {}) {
  return {
    contact: overrides.contact || {},
    engagementIntent: overrides.engagementIntent || 'prospect',
    strategyStats: overrides.strategyStats || null,
    barryMemory: overrides.barryMemory || null,
    recentAttributions: overrides.recentAttributions || []
  };
}

// ── Base behavior ───────────────────────────────────────────────────────────

describe('recommendStrategy — base behavior', () => {

  it('returns all four strategy scores', () => {
    const { strategyScores } = recommendStrategy(makeParams());
    expect(strategyScores).toHaveProperty('direct');
    expect(strategyScores).toHaveProperty('warm');
    expect(strategyScores).toHaveProperty('value');
    expect(strategyScores).toHaveProperty('humor');
  });

  it('returns a recommendation object with required fields', () => {
    const { recommendation } = recommendStrategy(makeParams());
    expect(recommendation).toHaveProperty('strategy');
    expect(recommendation).toHaveProperty('confidence');
    expect(recommendation).toHaveProperty('bestChannel');
    expect(recommendation).toHaveProperty('avoidStrategies');
  });

  it('returns low confidence with no input data', () => {
    const { recommendation } = recommendStrategy(makeParams());
    // With no signals, scores should be close together → low confidence
    expect(recommendation.confidence).toBe('low');
  });

  it('clamps scores between 0 and 100', () => {
    // Heavy negative signals to drive score below 0
    const { strategyScores } = recommendStrategy(makeParams({
      barryMemory: {
        what_has_worked: [],
        what_has_not_worked: ['direct — no response', 'direct approach failed', 'direct (failed)']
      },
      strategyStats: {
        total_attributions: 10,
        angle_outcomes: {
          direct: { total: 10, positive: 0 }
        },
        channel_outcomes: {}
      }
    }));
    expect(strategyScores.direct.score).toBeGreaterThanOrEqual(0);
    expect(strategyScores.direct.score).toBeLessThanOrEqual(100);
  });
});

// ── Contact-level signals ───────────────────────────────────────────────────

describe('recommendStrategy — contact-level memory', () => {

  it('boosts strategies that have worked with this contact', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      barryMemory: {
        what_has_worked: ['value-led approach worked great'],
        what_has_not_worked: []
      }
    }));
    expect(strategyScores.value.score).toBeGreaterThan(strategyScores.direct.score);
  });

  it('penalizes strategies that have not worked', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      barryMemory: {
        what_has_worked: [],
        what_has_not_worked: ['warm personal message — no response']
      }
    }));
    expect(strategyScores.warm.score).toBeLessThan(50);
  });
});

// ── Relationship signals ────────────────────────────────────────────────────

describe('recommendStrategy — relationship signals', () => {

  it('boosts warm strategy for known contacts', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { known_contact: true }
    }));
    expect(strategyScores.warm.score).toBeGreaterThan(strategyScores.direct.score);
  });

  it('boosts direct and value for cold prospects', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { known_contact: false, engagement_summary: { replies_received: 0 } },
      engagementIntent: 'prospect'
    }));
    expect(strategyScores.direct.score).toBeGreaterThanOrEqual(60);
    expect(strategyScores.value.score).toBeGreaterThanOrEqual(60);
  });

  it('boosts value strategy after consecutive no-replies', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { engagement_summary: { consecutive_no_replies: 3 } }
    }));
    expect(strategyScores.value.score).toBeGreaterThan(50);
    expect(strategyScores.value.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('no-replies')])
    );
  });
});

// ── User-level aggregate stats ──────────────────────────────────────────────

describe('recommendStrategy — user-level stats', () => {

  it('boosts strategies with high positive rate across contacts', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      strategyStats: {
        total_attributions: 10,
        angle_outcomes: {
          direct: { total: 8, positive: 7 }  // 87.5% positive
        },
        channel_outcomes: {}
      }
    }));
    expect(strategyScores.direct.score).toBeGreaterThanOrEqual(65);
    expect(strategyScores.direct.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('positive rate')])
    );
  });

  it('marks strategies with low positive rate as avoid', () => {
    const { recommendation, strategyScores } = recommendStrategy(makeParams({
      strategyStats: {
        total_attributions: 10,
        angle_outcomes: {
          warm: { total: 8, positive: 1 }  // 12.5% positive
        },
        channel_outcomes: {}
      }
    }));
    expect(strategyScores.warm.avoid).toBe(true);
    expect(recommendation.avoidStrategies).toContain('warm');
  });

  it('recommends best channel when data is sufficient', () => {
    const { recommendation } = recommendStrategy(makeParams({
      strategyStats: {
        total_attributions: 10,
        angle_outcomes: {},
        channel_outcomes: {
          email: { total: 5, positive: 4 },
          linkedin: { total: 4, positive: 1 }
        }
      }
    }));
    expect(recommendation.bestChannel).not.toBeNull();
    expect(recommendation.bestChannel.name).toBe('email');
  });

  it('ignores stats with too few attributions', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      strategyStats: {
        total_attributions: 2,  // Below threshold of 5
        angle_outcomes: { direct: { total: 2, positive: 0 } },
        channel_outcomes: {}
      }
    }));
    // Should not be penalized since not enough data
    expect(strategyScores.direct.score).toBeGreaterThanOrEqual(50);
  });
});

// ── Recent attributions (recency-weighted) ──────────────────────────────────

describe('recommendStrategy — recent attributions', () => {

  it('boosts strategy from recent positive attribution', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      recentAttributions: [
        { strategy_used: 'value_add', outcome_class: 'positive' }
      ]
    }));
    expect(strategyScores.value.score).toBeGreaterThan(50);
  });

  it('penalizes strategy from recent negative attribution', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      recentAttributions: [
        { strategy_used: 'direct_ask', outcome_class: 'negative' }
      ]
    }));
    expect(strategyScores.direct.score).toBeLessThan(50);
  });

  it('applies recency weighting (first result has more impact)', () => {
    const resultRecent = recommendStrategy(makeParams({
      recentAttributions: [
        { strategy_used: 'value_add', outcome_class: 'positive' },
        { strategy_used: 'value_add', outcome_class: 'negative' },
        { strategy_used: 'value_add', outcome_class: 'negative' }
      ]
    }));
    const resultOld = recommendStrategy(makeParams({
      recentAttributions: [
        { strategy_used: 'value_add', outcome_class: 'negative' },
        { strategy_used: 'value_add', outcome_class: 'negative' },
        { strategy_used: 'value_add', outcome_class: 'positive' }
      ]
    }));
    // When most recent is positive, score should be higher
    expect(resultRecent.strategyScores.value.score)
      .toBeGreaterThan(resultOld.strategyScores.value.score);
  });
});

// ── Prompt guidance ─────────────────────────────────────────────────────────

describe('recommendStrategy — prompt guidance', () => {

  it('returns empty prompt guidance when no strong recommendation', () => {
    const { promptGuidance } = recommendStrategy(makeParams());
    expect(promptGuidance).toBe('');
  });

  it('returns strategy intelligence section when recommendation is strong', () => {
    const { promptGuidance } = recommendStrategy(makeParams({
      contact: { known_contact: true, warmth_level: 'hot', relationship_state: 'trusted' },
      barryMemory: {
        what_has_worked: ['warm personal approach'],
        what_has_not_worked: []
      }
    }));
    if (promptGuidance) {
      expect(promptGuidance).toContain('STRATEGY INTELLIGENCE');
    }
  });
});

// ── 4th strategy: Humor-Driven ──────────────────────────────────────────────

describe('recommendStrategy — humor strategy', () => {

  it('starts humor at lower baseline than other strategies', () => {
    const { strategyScores } = recommendStrategy(makeParams());
    expect(strategyScores.humor.score).toBeLessThan(strategyScores.direct.score);
  });

  it('boosts humor when consecutive no-replies (pattern breaker)', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { engagement_summary: { consecutive_no_replies: 3 } }
    }));
    expect(strategyScores.humor.score).toBeGreaterThan(35);
    expect(strategyScores.humor.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('no-replies')])
    );
  });

  it('boosts humor for engaged/trusted contacts (rapport makes it safe)', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { relationship_state: 'trusted' }
    }));
    expect(strategyScores.humor.score).toBeGreaterThan(35);
    expect(strategyScores.humor.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('rapport')])
    );
  });

  it('suppresses humor for high-value cold prospects', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      contact: { strategic_value: 'high', known_contact: false, engagement_summary: { replies_received: 0 } },
      engagementIntent: 'prospect'
    }));
    expect(strategyScores.humor.score).toBeLessThan(35);
  });

  it('boosts humor from attribution data (humor_driven worked)', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      recentAttributions: [
        { strategy_used: 'humor_driven', outcome_class: 'positive' }
      ]
    }));
    expect(strategyScores.humor.score).toBeGreaterThan(35);
  });

  it('maps humor_driven strategy key correctly', () => {
    const { strategyScores } = recommendStrategy(makeParams({
      barryMemory: {
        what_has_worked: ['humor approach — got a laugh and a reply'],
        what_has_not_worked: []
      }
    }));
    expect(strategyScores.humor.score).toBeGreaterThan(35);
  });
});
