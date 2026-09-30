/**
 * Mission Control Barry's targeting handoff — the deterministic gate.
 *
 * Deterministic part: the classifier is consulted only when no targeting is
 * saved (or a pendingICP already says extraction is under way). Model-
 * classified part: PROSPECTING vs everything else. These tests stub the
 * Anthropic client to return a configurable classification and a
 * configurable extraction response, and assert on ROUTING — did the handler
 * enter the extraction path or fall through to normal Mission Control
 * generation — not on live model behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const CALLS = [];
let classifierReply = { intent: 'UNCLEAR', confidence: 0, restatement: null, clarifyingQuestion: 'What would help?', subject: null };
let extractionReply = {
  understood: { industries: [], companySizes: [], locations: [], targetTitles: [], companyKeywords: [] },
  mappingExplanation: 'Tell me more about who you are looking for.',
  needsLookalike: false, lookalikeSuggestions: null,
  needsClarification: true, followUpQuestion: 'What industry?', followUpType: 'industry',
  searchStrategy: 'industry_only', confidenceScore: 0.5, isAmbiguous: false, ambiguityDetails: null,
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: vi.fn(async (req) => {
          CALLS.push(req);
          // The classifier call always carries a `system` prompt of its own.
          if (req.system && req.system.includes('You classify one sentence into exactly one of nine categories')) {
            return { content: [{ text: JSON.stringify(classifierReply) }] };
          }
          // Extraction calls (processInitialInput/processFollowup) carry no
          // `system` field — the whole prompt is the one user message. Both
          // functions' prompts mention "Ideal Customer Profile" ("...define..."
          // vs "...refine..."), so match on that common phrase.
          if (!req.system && req.messages?.[0]?.content?.includes('Ideal Customer Profile')) {
            return { content: [{ text: JSON.stringify(extractionReply) }] };
          }
          // Everything else is the normal Mission Control conversation call.
          return {
            usage: null,
            content: [{
              text: JSON.stringify({
                intent: 'CUSTOM', barry_mode: 'GROWTH', step: 'execute',
                response_text: 'ok', contact_id: null, has_message_angles: false,
                angles: [], actions: [], clarifying_question: null, suggested_prompts: [],
              }),
            }],
          };
        }),
      };
    }
  },
}));

const EMPTY_SNAP = { exists: false, empty: true, size: 0, docs: [], forEach() {}, data: () => undefined };
function query() {
  const q = {
    collection: () => query(), doc: () => query(), where: () => q, orderBy: () => q, limit: () => q,
    get: async () => EMPTY_SNAP, set: async () => {}, update: async () => {}, add: async () => ({ id: 'x' }),
  };
  return q;
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: { collection: () => query() }, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) }));
globalThis.process.env.ANTHROPIC_API_KEY = 'test';
globalThis.process.env.FIREBASE_API_KEY = 'test';

const { handler } = await import('../../netlify/functions/barryMissionChat.js');

const NO_TARGETING = { contacts: [], missions: [], recon: {}, icpProfile: null };
const SAVED_TARGETING = { contacts: [], missions: [], recon: {}, icpProfile: { industries: ['Retail'] } };

async function send(body) {
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', barryMode: 'GROWTH', ...body }),
  });
  return { res, data: JSON.parse(res.body), callCount: CALLS.length };
}

beforeEach(() => {
  CALLS.length = 0;
  classifierReply = { intent: 'UNCLEAR', confidence: 0, restatement: null, clarifyingQuestion: 'What would help?', subject: null };
  extractionReply = {
    understood: { industries: [], companySizes: [], locations: [], targetTitles: [], companyKeywords: [] },
    mappingExplanation: 'Tell me more about who you are looking for.',
    needsLookalike: false, lookalikeSuggestions: null,
    needsClarification: true, followUpQuestion: 'What industry?', followUpType: 'industry',
    searchStrategy: 'industry_only', confidenceScore: 0.5, isAmbiguous: false, ambiguityDetails: null,
  };
});

describe('CASE A — confident PROSPECTING with no targeting enters extraction', () => {
  it('classifies, then transitions into the extractor instead of normal generation', async () => {
    classifierReply = {
      intent: 'PROSPECTING', confidence: 0.95,
      restatement: 'You want to find companies in Utah for a Jordan River partnership.',
      clarifyingQuestion: null, subject: null,
    };
    extractionReply = {
      understood: { industries: [], companySizes: [], locations: ['Utah'], targetTitles: [], companyKeywords: [] },
      mappingExplanation: 'Got it — companies in Utah.', needsLookalike: false, lookalikeSuggestions: null,
      needsClarification: true, followUpQuestion: 'How big are the companies you want to reach?',
      followUpType: 'size', searchStrategy: 'industry_only', confidenceScore: 0.6, isAmbiguous: false, ambiguityDetails: null,
    };

    const { res, data, callCount } = await send({
      message: 'Find companies in Utah I can approach for a Jordan River partnership.',
      contextStack: NO_TARGETING,
    });

    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(2); // classifier, then extractor — never the normal chat call
    expect(data.pendingICP).toBeTruthy();
    expect(data.pendingICP.locations).toEqual(['Utah']);
    expect(data.response_text).toMatch(/how big/i);
    expect(data.readyToConfirm).toBe(false);
  });
});

describe('CASE B — EXPLORATION with no targeting does not enter extraction', () => {
  it('falls through to normal Mission Control generation', async () => {
    classifierReply = {
      intent: 'EXPLORATION', confidence: 0.9,
      restatement: 'You want to understand what Idynify does.', clarifyingQuestion: null, subject: null,
    };

    const { res, data, callCount } = await send({
      message: 'How does Idynify work?',
      contextStack: NO_TARGETING,
    });

    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(2); // classifier, then the normal chat call
    expect(data.pendingICP).toBeUndefined();
    expect(data.intent).toBe('CUSTOM');
  });
});

describe('CASE C — vague request with no targeting does not enter extraction', () => {
  it('UNCLEAR classification falls through to normal generation', async () => {
    classifierReply = {
      intent: 'UNCLEAR', confidence: 0.2,
      restatement: null, clarifyingQuestion: 'What are you trying to get done?', subject: null,
    };

    const { data, callCount } = await send({
      message: 'Help me write an email.',
      contextStack: NO_TARGETING,
    });

    expect(callCount).toBe(2);
    expect(data.pendingICP).toBeUndefined();
  });
});

describe('CASE D — existing targeting never consults the classifier', () => {
  it('ICP_CHANGE behavior is reached directly, gate skipped entirely', async () => {
    const { data, callCount } = await send({
      message: 'Change my ICP to healthcare companies.',
      contextStack: SAVED_TARGETING,
    });

    // Only the one normal Mission Control call — the classifier is never
    // consulted when targeting already exists.
    expect(callCount).toBe(1);
    expect(data.pendingICP).toBeUndefined();
  });
});

describe('CASE E — existing targeting, "find more companies" does not restart targeting', () => {
  it('gate skipped, existing discovery path continues untouched', async () => {
    const { data, callCount } = await send({
      message: 'Find more companies.',
      contextStack: SAVED_TARGETING,
    });

    expect(callCount).toBe(1);
    expect(data.pendingICP).toBeUndefined();
  });
});

describe('CASE F — confident PROSPECTING from a vaguer targeting statement', () => {
  it('"I want to target SaaS companies" with no targeting still enters extraction', async () => {
    classifierReply = {
      intent: 'PROSPECTING', confidence: 0.85,
      restatement: 'You want to target SaaS companies.', clarifyingQuestion: null, subject: null,
    };

    const { data, callCount } = await send({
      message: 'I want to target SaaS companies.',
      contextStack: NO_TARGETING,
    });

    expect(callCount).toBe(2);
    expect(data.pendingICP).toBeTruthy();
  });
});

describe('continuation — a pendingICP already present skips the classifier entirely', () => {
  it('goes straight to the follow-up extractor, no reclassification', async () => {
    extractionReply = {
      understood: { industries: [], companySizes: ['501-1,000'], locations: ['Utah'], targetTitles: ['CEO'], companyKeywords: [] },
      mappingExplanation: 'Got it.', needsLookalike: false, lookalikeSuggestions: null,
      needsMoreInfo: false, followUpQuestion: null, followUpType: null,
      searchStrategy: 'industry_only', confidenceScore: 0.9, readyToConfirm: true,
      isAmbiguous: false, ambiguityDetails: null,
    };

    const { data, callCount } = await send({
      message: 'CEOs, 500 plus employees',
      contextStack: NO_TARGETING,
      pendingICP: { locations: ['Utah'] },
      icpExtractionStep: 'clarifying',
    });

    // Exactly one call — the follow-up extractor. No classifier call at all.
    expect(callCount).toBe(1);
    expect(data.readyToConfirm).toBe(true);
    expect(data.pendingICP.targetTitles).toEqual(['CEO']);
  });
});

describe('extraction failure falls back to normal generation rather than a dead end', () => {
  it('recovers when the extractor throws', async () => {
    classifierReply = { intent: 'PROSPECTING', confidence: 0.95, restatement: null, clarifyingQuestion: null, subject: null };
    // Non-JSON text makes extractJson return null inside processInitialInput,
    // which throws "Failed to parse Barry response" — caught by the handoff's
    // own try/catch, falling through to normal generation.
    extractionReply = 'not-json-and-not-an-object';

    const { res, data, callCount } = await send({
      message: 'Find companies for me.',
      contextStack: NO_TARGETING,
    });

    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(3); // classifier, failed extraction attempt, then normal generation
    expect(data.pendingICP).toBeUndefined();
    expect(data.intent).toBe('CUSTOM');
  });
});
