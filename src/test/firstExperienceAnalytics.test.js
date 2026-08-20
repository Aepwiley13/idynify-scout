/**
 * B11 — First Experience analytics instrumentation.
 *
 * Source-reading assertions, same shape as the B8 enrichment tests. They
 * prove the contract without rendering anything, so they are fast, stable,
 * and do not require jsdom.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');

const analytics = read('../services/analytics.js');
const firstExp = read('../pages/Onboarding/FirstExperience.jsx');
const barryOnb = read('../pages/Onboarding/BarryOnboarding.jsx');
const relFV = read('../components/onboarding/RelationshipFirstValue.jsx');

// ── 1. Event constants exist ───────────────────────────────────────────────

describe('1 — B11 event constants are declared in analytics.js', () => {
  const required = [
    'FIRST_EXPERIENCE_STARTED',
    'WHO_RESOLVED',
    'WHO_ASKED',
    'WHO_PROVIDED',
    'INTENT_CLASSIFICATION_ATTEMPTED',
    'INTENT_CLASSIFIED',
    'INTENT_CLARIFICATION_REQUESTED',
    'FIRST_VALUE_BRANCH_SELECTED',
    'FIRST_VALUE_ATTEMPTED',
    'FIRST_VALUE_DELIVERED',
    'FIRST_VALUE_BLOCKED',
    'TARGETING_PROPOSAL_CREATED',
    'TARGETING_CONFIRMATION_REQUESTED',
    'TARGETING_CONFIRMED',
    'TARGETING_CLARIFICATION_REQUESTED',
    'FIRST_DISCOVERY_STARTED',
    'FIRST_DISCOVERY_COMPLETED',
    'WEBSITE_ANALYSIS_ATTEMPTED',
    'WEBSITE_ANALYSIS_SUCCEEDED',
    'WEBSITE_ANALYSIS_FAILED',
    'WEBSITE_TARGETING_NORMALIZED',
  ];

  for (const name of required) {
    it(`${name} exists`, () => {
      expect(analytics).toContain(name);
    });
  }
});

// ── 2. Entry / WHO events ──────────────────────────────────────────────────

describe('2 — Entry and WHO events are emitted by FirstExperience', () => {
  it('first_experience_started on mount', () => {
    expect(firstExp).toContain('EVENTS.FIRST_EXPERIENCE_STARTED');
  });

  it('who_resolved on mount', () => {
    expect(firstExp).toContain('EVENTS.WHO_RESOLVED');
  });

  it('who_asked when the question is shown', () => {
    expect(firstExp).toContain('EVENTS.WHO_ASKED');
  });

  it('who_provided when a name is given', () => {
    expect(firstExp).toContain('EVENTS.WHO_PROVIDED');
  });

  it('who_asked fires only on presentation, not on skip', () => {
    expect(firstExp).toContain('EVENTS.WHO_ASKED');
    const matches = firstExp.match(/EVENTS\.WHO_ASKED/g);
    expect(matches).toHaveLength(1);
    const surrounding = firstExp.slice(
      Math.max(0, firstExp.indexOf('EVENTS.WHO_ASKED') - 30),
      firstExp.indexOf('EVENTS.WHO_ASKED') + 40
    );
    expect(surrounding).toContain('wantsName');
    expect(surrounding).not.toContain('skipped');
  });

  it('who_resolved records source, not the name', () => {
    const calls = [...firstExp.matchAll(/logEvent\(EVENTS\.WHO_RESOLVED[^;]+\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      expect(m[0]).toContain('source');
      expect(m[0]).not.toMatch(/\.name|firstName|displayName/);
    }
  });
});

// ── 3. Intent events ──────────────────────────────────────────────────────

describe('3 — Intent events are emitted by FirstExperience', () => {
  it('intent_classification_attempted before the fetch', () => {
    expect(firstExp).toContain('EVENTS.INTENT_CLASSIFICATION_ATTEMPTED');
  });

  it('intent_classified after classification', () => {
    expect(firstExp).toContain('EVENTS.INTENT_CLASSIFIED');
  });

  it('intent_clarification_requested on ROUTE_CLARIFY', () => {
    expect(firstExp).toContain('EVENTS.INTENT_CLARIFICATION_REQUESTED');
  });

  it('first_value_branch_selected on routing', () => {
    expect(firstExp).toContain('EVENTS.FIRST_VALUE_BRANCH_SELECTED');
  });

  it('classified event carries intent class but not raw text', () => {
    const calls = [...firstExp.matchAll(/logEvent\(EVENTS\.INTENT_CLASSIFIED[^;]+\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      expect(m[0]).toContain('intent');
      expect(m[0]).not.toMatch(/said|turn|message|text|raw/);
    }
  });
});

// ── 4. Prospecting / targeting events ──────────────────────────────────────

describe('4 — Prospecting events are emitted by BarryOnboarding', () => {
  it('targeting_proposal_created when constraints are met', () => {
    expect(barryOnb).toContain('EVENTS.TARGETING_PROPOSAL_CREATED');
  });

  it('targeting_confirmation_requested', () => {
    expect(barryOnb).toContain('EVENTS.TARGETING_CONFIRMATION_REQUESTED');
  });

  it('targeting_confirmed in handleConfirm', () => {
    expect(barryOnb).toContain('EVENTS.TARGETING_CONFIRMED');
  });

  it('targeting_clarification_requested on clarify', () => {
    expect(barryOnb).toContain('EVENTS.TARGETING_CLARIFICATION_REQUESTED');
  });

  it('first_discovery_started before search', () => {
    expect(barryOnb).toContain('EVENTS.FIRST_DISCOVERY_STARTED');
  });

  it('first_discovery_completed after search', () => {
    expect(barryOnb).toContain('EVENTS.FIRST_DISCOVERY_COMPLETED');
  });

  it('first_value_delivered for Prospecting', () => {
    expect(barryOnb).toContain('EVENTS.FIRST_VALUE_DELIVERED');
  });

  it('first_value_delivered fires only after discovery completes', () => {
    const deliveredIdx = barryOnb.indexOf('EVENTS.FIRST_VALUE_DELIVERED');
    const completedIdx = barryOnb.indexOf('EVENTS.FIRST_DISCOVERY_COMPLETED');
    expect(deliveredIdx).toBeGreaterThan(completedIdx);
  });

  it('first_value_delivered fires exactly once in Prospecting', () => {
    const matches = barryOnb.match(/EVENTS\.FIRST_VALUE_DELIVERED/g);
    expect(matches).toHaveLength(1);
  });

  it('first_discovery_completed carries result_band', () => {
    const calls = [...barryOnb.matchAll(/logEvent\(EVENTS\.FIRST_DISCOVERY_COMPLETED[^;]+\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      expect(m[0]).toContain('result_band');
    }
  });

  it('proposal carries constraint count and types, not ICP text', () => {
    const calls = [...barryOnb.matchAll(/logEvent\(EVENTS\.TARGETING_PROPOSAL_CREATED[^;]+\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      expect(m[0]).toContain('constraint_count');
      expect(m[0]).toContain('constraint_types');
      expect(m[0]).not.toMatch(/industries\[|companySizes\[|locations\[|targetTitles/);
    }
  });
});

// ── 5. Website accelerator events ──────────────────────────────────────────

describe('5 — Website accelerator events are emitted by BarryOnboarding', () => {
  it('website_analysis_attempted', () => {
    expect(barryOnb).toContain('EVENTS.WEBSITE_ANALYSIS_ATTEMPTED');
  });

  it('website_analysis_succeeded', () => {
    expect(barryOnb).toContain('EVENTS.WEBSITE_ANALYSIS_SUCCEEDED');
  });

  it('website_analysis_failed', () => {
    expect(barryOnb).toContain('EVENTS.WEBSITE_ANALYSIS_FAILED');
  });

  it('website_targeting_normalized', () => {
    expect(barryOnb).toContain('EVENTS.WEBSITE_TARGETING_NORMALIZED');
  });
});

// ── 6. Engagement / Preparation events ─────────────────────────────────────

describe('6 — Relationship First Value events', () => {
  it('first_value_attempted on match resolution', () => {
    expect(relFV).toContain('EVENTS.FIRST_VALUE_ATTEMPTED');
  });

  it('first_value_delivered on successful match', () => {
    expect(relFV).toContain('EVENTS.FIRST_VALUE_DELIVERED');
  });

  it('first_value_blocked when person not found', () => {
    expect(relFV).toContain('EVENTS.FIRST_VALUE_BLOCKED');
  });

  it('B8 enrichment events are preserved', () => {
    expect(relFV).toContain('EVENTS.ENRICHMENT_ATTEMPTED');
    expect(relFV).toContain('EVENTS.ENRICHMENT_SUCCEEDED');
    expect(relFV).toContain('EVENTS.ENRICHMENT_FAILED');
  });
});

// ── 7. Privacy boundary ───────────────────────────────────────────────────

describe('7 — No raw PII or free text enters analytics', () => {
  const allSources = [firstExp, barryOnb, relFV];
  const PII_PATTERN = /\.name\b|\.email|\.phone|\.linkedin|company_name|\.company\b|contact\.id|\.website|\.url\b|siteUrl|\.domain/;

  for (const [label, src] of [
    ['FirstExperience', firstExp],
    ['BarryOnboarding', barryOnb],
    ['RelationshipFirstValue', relFV],
  ]) {
    it(`${label}: no logEvent call carries PII fields`, () => {
      const calls = [...src.matchAll(/logEvent\(EVENTS\.\w+,\s*\{([^}]+)\}/g)];
      for (const m of calls) {
        const params = m[1];
        expect(params, `PII in logEvent: ${m[0]}`).not.toMatch(PII_PATTERN);
      }
    });
  }

  it('no event carries raw intent text, conversation content, or ICP values', () => {
    for (const src of allSources) {
      const calls = [...src.matchAll(/logEvent\(EVENTS\.\w+,\s*\{([^}]+)\}/g)];
      for (const m of calls) {
        const params = m[1];
        expect(params).not.toMatch(/\bsaid\b|: turn\b|: message\b|transcript|conversationHistory|extractedICP\b|barryResponse\b/);
      }
    }
  });
});

// ── 8. Analytics cannot block the First Experience ────────────────────────

describe('8 — analytics is fire-and-forget', () => {
  it('logEvent returns void, not a Promise', () => {
    expect(analytics).toMatch(/returns\s*\{void\}/);
  });

  it('no await on logEvent in FirstExperience', () => {
    expect(firstExp).not.toMatch(/await\s+logEvent/);
  });

  it('no await on logEvent in BarryOnboarding', () => {
    expect(barryOnb).not.toMatch(/await\s+logEvent/);
  });

  it('no await on logEvent in RelationshipFirstValue', () => {
    expect(relFV).not.toMatch(/await\s+logEvent/);
  });
});

// ── 9. No new completion state ────────────────────────────────────────────

describe('9 — no new completion flag or permanent state', () => {
  it('no firstValueComplete flag anywhere', () => {
    for (const src of [firstExp, barryOnb, relFV, analytics]) {
      expect(src).not.toContain('firstValueComplete');
      expect(src).not.toContain('firstExperienceComplete');
    }
  });

  it('first_value_delivered is an event, not a stored field', () => {
    expect(analytics).toContain("FIRST_VALUE_DELIVERED: 'first_value_delivered'");
    expect(firstExp).not.toMatch(/setDoc.*first_value_delivered/);
    expect(barryOnb).not.toMatch(/setDoc.*first_value_delivered/);
    expect(relFV).not.toMatch(/setDoc.*first_value_delivered/);
  });
});

// ── 10. No entitlement/credit behavior ────────────────────────────────────

describe('10 — no entitlement or credit behavior introduced', () => {
  it('no deductCredits reference in any instrumented file', () => {
    for (const src of [firstExp, barryOnb, relFV]) {
      expect(src).not.toContain('deductCredits');
    }
  });

  it('no entitlement or pricing logic', () => {
    for (const src of [firstExp, barryOnb, relFV]) {
      expect(src).not.toMatch(/entitlement|freemium|credit|pricing|plan_level/);
    }
  });
});
