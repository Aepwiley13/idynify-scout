/**
 * Hotfix — Mission Control Barry said Idynify can't find companies.
 *
 * In production, a new account asked Mission Control Barry to find companies
 * and was told Idynify is not a prospecting platform and to use Apollo,
 * ZoomInfo, Hunter.io or LinkedIn Sales Navigator. The system prompt carried
 * no description of the product at all, so in an empty workspace the model
 * invented one.
 *
 * These tests are deterministic: they run the real handler with the Anthropic
 * SDK stubbed, capture the exact `system` prompt Barry receives, and assert on
 * it. No live model output is involved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const CALLS = [];

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: async (req) => {
          CALLS.push(req);
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
        },
      };
    }
  },
}));

// Empty workspace: every query returns nothing, the dashboard doc is absent.
const EMPTY_SNAP = { exists: false, empty: true, size: 0, docs: [], forEach() {}, data: () => undefined };
function query() {
  const q = {
    collection: () => query(),
    doc: () => query(),
    where: () => q,
    orderBy: () => q,
    limit: () => q,
    get: async () => EMPTY_SNAP,
    set: async () => {},
    update: async () => {},
    add: async () => ({ id: 'x' }),
  };
  return q;
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: () => query() },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

globalThis.fetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ users: [{ localId: 'u1' }] }),
}));

globalThis.process.env.ANTHROPIC_API_KEY = 'test';
globalThis.process.env.FIREBASE_API_KEY = 'test';

const { handler, buildProductCapabilityBlock, hasSavedTargeting } =
  await import('../../netlify/functions/barryMissionChat.js');

const EMPTY_STACK = { contacts: [], missions: [], recon: {}, icpProfile: null };
const SAVED_ICP = { industries: ['Hospital & Health Care'], companySizes: ['51-200'], locations: ['Texas'] };

async function systemPromptFor(body) {
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', ...body }),
  });
  expect(res.statusCode).toBe(200);
  expect(CALLS).toHaveLength(1);
  return CALLS[0].system;
}

const COMPETITORS = /apollo|zoominfo|hunter\.io|sales navigator|clearbit|lusha|seamless/i;

/** Lines of the prompt that are not the explicit "NEVER recommend …" guardrail. */
function nonGuardrailLines(prompt) {
  return prompt.split('\n').filter(l => !/^\s*NEVER recommend another product/.test(l));
}

beforeEach(() => { CALLS.length = 0; });

describe('Mission Control Barry — conversation turn, new account, no targeting', () => {
  let prompt;
  beforeEach(async () => {
    prompt = await systemPromptFor({
      message: 'Can you find companies for me?',
      barryMode: 'GROWTH',
      contextStack: EMPTY_STACK,
    });
  });

  it('receives a ground-truth description of what Idynify does', () => {
    expect(prompt).toContain('WHAT IDYNIFY DOES');
    expect(prompt).toContain('Idynify DOES find companies');
    expect(prompt).toMatch(/Define who to target/);
    expect(prompt).toMatch(/Discover matching companies/);
    expect(prompt).toMatch(/Find the right people/);
    expect(prompt).toMatch(/Write and send outreach/);
    expect(prompt).toMatch(/Track follow-up/);
  });

  it('is told targeting is not set and to send the user to the /barry targeting flow', () => {
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/find matching companies as soon as you know who they want to reach/);
    expect(prompt).toMatch(/send them to Barry at \/barry to define their target/);
  });

  it('is forbidden from saying Idynify cannot find companies', () => {
    expect(prompt).toMatch(/NEVER say or imply that Idynify is not a prospecting platform, cannot find companies/);
    expect(prompt).toMatch(/Never tell the user Idynify can't find companies/);
  });

  it('is forbidden from pointing to a competitor', () => {
    expect(prompt).toMatch(/NEVER recommend another product or data provider/);
    expect(prompt).toMatch(/never point them to a competitor/);
  });

  it('names no competitor anywhere except inside the prohibition itself', () => {
    for (const line of nonGuardrailLines(prompt)) {
      expect(line).not.toMatch(COMPETITORS);
    }
  });

  it('does not route a no-targeting request through ICP_CHANGE, which renders an empty reply', () => {
    expect(prompt).toMatch(/do not use the ICP_CHANGE intent for this/);
    expect(prompt).toMatch(/ICP_CHANGE: \(only when TARGETING STATUS is Saved\)/);
  });
});

describe('Mission Control Barry — opening brief, new account', () => {
  it('receives the same product truth and no-targeting direction', async () => {
    const prompt = await systemPromptFor({ message: '__OPENING_BRIEF__', contextStack: EMPTY_STACK });
    expect(prompt).toContain('Idynify DOES find companies');
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/NEVER recommend another product or data provider/);
  });
});

describe('Mission Control Barry — module drawer chat with no client context stack', () => {
  it('still receives the product truth', async () => {
    const prompt = await systemPromptFor({ message: 'find me some leads', module: 'scout' });
    expect(prompt).toContain('Idynify DOES find companies');
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
  });
});

describe('Mission Control Barry — account with saved targeting', () => {
  it('is told discovery runs against saved targeting and results are in Scout', async () => {
    const prompt = await systemPromptFor({
      message: 'Can you find companies for me?',
      contextStack: { ...EMPTY_STACK, icpProfile: SAVED_ICP },
    });
    expect(prompt).toContain('TARGETING STATUS: Saved');
    expect(prompt).toMatch(/matching companies appear in Scout/);
    expect(prompt).not.toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/NEVER recommend another product or data provider/);
  });
});

describe('product capability block — pure', () => {
  it('treats an empty or absent profile as no targeting', () => {
    expect(hasSavedTargeting(null)).toBe(false);
    expect(hasSavedTargeting({})).toBe(false);
    expect(hasSavedTargeting({ industries: [], locations: [] })).toBe(false);
  });

  it('treats any saved filter or lookalike anchor as targeting', () => {
    expect(hasSavedTargeting({ industries: ['Retail'] })).toBe(true);
    expect(hasSavedTargeting({ isNationwide: true })).toBe(true);
    expect(hasSavedTargeting({ lookalikeSeed: { name: 'Acme' } })).toBe(true);
  });

  it('describes nothing the product does not ship', () => {
    const block = buildProductCapabilityBlock(null);
    const numbered = block.split('\n').filter(l => /^\d\. /.test(l));
    expect(numbered).toHaveLength(5);
  });
});
