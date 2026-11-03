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
        content: [{ type: 'text', text: JSON.stringify(responseObj) }],
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

  it('processInitialInput reads a reply whose first block is thinking (#699)', async () => {
    // The response shape Sonnet 5.5 can return; content[0].text would be undefined.
    const anthropic = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'end_turn',
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: JSON.stringify({
              understood: { industries: ['Computer Software'], companySizes: [], locations: ['Utah'], targetTitles: [], companyKeywords: ['saas'] },
              mappingExplanation: 'Got it.', needsLookalike: false, lookalikeSuggestions: null,
              needsClarification: false, followUpQuestion: null, followUpType: null,
              searchStrategy: 'industry_only', confidenceScore: 0.9, isAmbiguous: false, ambiguityDetails: null,
            }) },
          ],
        })),
      },
    };

    const result = await processInitialInput(anthropic, 'SaaS companies in Utah', null);
    expect(result.barryResponse.understood.locations).toEqual(['Utah']);
  });

  it('processInitialInput rejects a reply cut off at max_tokens instead of parsing it (#699)', async () => {
    const anthropic = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: '{"understood": {"industries": ["Computer Software"]}}' }],
        })),
      },
    };
    await expect(processInitialInput(anthropic, 'SaaS companies in Utah', null)).rejects.toThrow(/incomplete/);
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

  // #748: the example-company step's schema has no way to say "no example" —
  // the model answers it literally, with a seed named "None provided".
  describe('processFollowup, routed to the example-company step: "no example" is no seed (#748)', () => {
    const askedForExample = [{ role: 'barry', content: 'Do you have an example company in mind?' }];

    it.each([
      ['None provided', 'lookalike'],
      ['none', 'lookalike'],
      ['N/A', 'lookalike'],
      ['No example', 'lookalike'],
      ['  none provided  ', 'lookalike'],   // padded, as a model reply could be
    ])('a seed named %j is treated as no seed, and the strategy stops claiming lookalike', async (placeholderName, modelStrategy) => {
      const anthropic = fakeAnthropic({
        understood: {
          industries: ['Computer Software'], companySizes: null, locations: null,
          targetTitles: null, companyKeywords: null,
          lookalikeSeed: { name: placeholderName, domain: null },
        },
        mappingExplanation: "I'll focus on the industry and the titles you give me.",
        needsMoreInfo: true,
        followUpQuestion: 'Who should I be finding at these companies?',
        followUpType: 'titles',
        searchStrategy: modelStrategy,
        confidenceScore: 0.5,
        readyToConfirm: false,
      });

      const result = await processFollowup(
        anthropic, "I don't have a specific company in mind", 'awaiting_example', askedForExample, {}
      );

      expect(result.barryResponse.understood.lookalikeSeed).toBeNull();
      expect(result.barryResponse.searchStrategy).toBe('industry_only');
    });

    it('a real company name is left exactly as the model reported it', async () => {
      const anthropic = fakeAnthropic({
        understood: {
          industries: ['Computer Software'], companySizes: null, locations: null,
          targetTitles: null, companyKeywords: null,
          lookalikeSeed: { name: 'Lakeshore Grocers', domain: null },
        },
        mappingExplanation: "I'll prioritize companies similar to Lakeshore Grocers.",
        needsMoreInfo: false, followUpQuestion: null, followUpType: null,
        searchStrategy: 'lookalike', confidenceScore: 0.9, readyToConfirm: true,
      });

      const result = await processFollowup(
        anthropic, 'Lakeshore Grocers is a good example', 'awaiting_example', askedForExample, {}
      );

      expect(result.barryResponse.understood.lookalikeSeed).toEqual({ name: 'Lakeshore Grocers', domain: null });
      expect(result.barryResponse.searchStrategy).toBe('lookalike');
    });

    it('a non-lookalike strategy already reported for a placeholder seed is left as the model said', async () => {
      // Only a false "lookalike" claim is corrected; a model that already
      // chose industry_only or hybrid on its own is not second-guessed.
      const anthropic = fakeAnthropic({
        understood: {
          industries: ['Computer Software'], companySizes: null, locations: null,
          targetTitles: null, companyKeywords: null,
          lookalikeSeed: { name: 'none provided', domain: null },
        },
        mappingExplanation: "I'll focus on the industry.",
        needsMoreInfo: false, followUpQuestion: null, followUpType: null,
        searchStrategy: 'hybrid', confidenceScore: 0.8, readyToConfirm: true,
      });

      const result = await processFollowup(
        anthropic, "I don't have a specific company in mind", 'awaiting_example', askedForExample, {}
      );

      expect(result.barryResponse.understood.lookalikeSeed).toBeNull();
      expect(result.barryResponse.searchStrategy).toBe('hybrid');
    });
  });
});
