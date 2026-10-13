/**
 * Step 1 of the Mission Control targeting handoff — export the existing
 * create-from-scratch ICP extraction functions so a second caller (Mission
 * Control) can invoke them in-process, without changing what they do or how
 * BarryOnboarding.jsx already calls them (still via HTTP, unchanged).
 *
 * These are pure reasoning functions — no Firestore access, an injected
 * Anthropic client — so testing them here needs no Firebase/admin mocking.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: () => ({ doc: () => ({}) }) },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

const { processInitialInput, processFollowup } = await import('../../netlify/functions/barryICPConversation.js');

function fakeAnthropic(responseObj) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ text: JSON.stringify(responseObj) }],
      })),
    },
  };
}

describe('barryICPConversation extraction functions are exported and reusable', () => {
  it('processInitialInput is an exported function', () => {
    expect(typeof processInitialInput).toBe('function');
  });

  it('processFollowup is an exported function', () => {
    expect(typeof processFollowup).toBe('function');
  });

  it('processInitialInput still returns the existing barryResponse/step contract', async () => {
    const anthropic = fakeAnthropic({
      understood: {
        industries: ['Computer Software'],
        companySizes: ['51-200'],
        locations: ['Utah'],
        targetTitles: ['CEO'],
        companyKeywords: [],
        rawInput: 'SaaS companies in Utah',
      },
      mappingExplanation: 'Got it.',
      needsLookalike: false,
      lookalikeSuggestions: null,
      needsClarification: false,
      followUpQuestion: null,
      followUpType: null,
      searchStrategy: 'industry_only',
      confidenceScore: 0.9,
      isAmbiguous: false,
      ambiguityDetails: null,
    });

    const result = await processInitialInput(anthropic, 'SaaS companies in Utah', null);

    expect(result).toHaveProperty('barryResponse');
    expect(result).toHaveProperty('step');
    expect(result.barryResponse.understood.industries).toEqual(['Computer Software']);
    expect(result.barryResponse.understood.locations).toEqual(['Utah']);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it('processFollowup still returns the existing barryResponse/step contract', async () => {
    const anthropic = fakeAnthropic({
      understood: {
        industries: ['Computer Software'],
        companySizes: ['51-200'],
        locations: ['Utah'],
        targetTitles: ['CEO', 'Founder'],
        companyKeywords: [],
      },
      mappingExplanation: 'Got it.',
      needsLookalike: false,
      lookalikeSuggestions: null,
      needsMoreInfo: false,
      followUpQuestion: null,
      followUpType: null,
      searchStrategy: 'industry_only',
      confidenceScore: 0.95,
      readyToConfirm: true,
      isAmbiguous: false,
      ambiguityDetails: null,
    });

    const result = await processFollowup(
      anthropic,
      'CEO and founders too',
      'clarifying',
      [{ role: 'user', content: 'SaaS companies in Utah' }],
      { industries: ['Computer Software'], locations: ['Utah'] }
    );

    expect(result).toHaveProperty('barryResponse');
    expect(result.step).toBe('confirming');
    expect(result.barryResponse.understood.targetTitles).toEqual(['CEO', 'Founder']);
  });
});
