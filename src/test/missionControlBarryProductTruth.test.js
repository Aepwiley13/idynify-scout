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
    expect(prompt).toContain('Idynify DOES find companies and people for any of these goals');
    expect(prompt).toMatch(/Define the goal and who matters for it/);
    expect(prompt).toMatch(/Discover matching companies/);
    expect(prompt).toMatch(/Find the right people/);
    expect(prompt).toMatch(/Write and send outreach/);
    expect(prompt).toMatch(/Track follow-up/);
  });

  it('defines Idynify as relationship intelligence, not a sales-only platform', () => {
    expect(prompt).toMatch(/Idynify is relationship intelligence/);
    expect(prompt).toMatch(/partnership, sponsorship, referral, fundraising\/donor development, community engagement, introductions/);
    expect(prompt).not.toMatch(/B2B prospecting and outreach platform/);
  });

  it('is told targeting is not set and to send the user to the /barry targeting flow', () => {
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/say plainly that Idynify can find them, and that it needs to know who they're looking for first/);
    expect(prompt).toMatch(/Do not offer to search now/);
    expect(prompt).toMatch(/no search can run until their targeting is defined/);
    expect(prompt).toMatch(/send them to Barry at \/barry to define their target/);
    expect(prompt).not.toMatch(/who they sell to/);
  });

  it('is forbidden from saying Idynify cannot find companies', () => {
    expect(prompt).toMatch(/NEVER say or imply that Idynify cannot find companies/);
    expect(prompt).toMatch(/Never tell the user Idynify lacks company or person discovery/);
  });

  it('is forbidden from pointing to a competitor or CRM', () => {
    expect(prompt).toMatch(/NEVER recommend another product, data provider, or CRM/);
    expect(prompt).toMatch(/never point them to a competitor/);
  });

  it('is told not to gate on whether the goal is a traditional sales motion', () => {
    expect(prompt).toMatch(/NEVER decide whether a user's goal "counts" before helping/);
    expect(prompt).toMatch(/sales, partnership, sponsorship, referral, fundraising, and other relationship goals are all in scope/);
    expect(prompt).toMatch(/including when their relationship goal isn't a traditional sales motion/);
  });

  it('is told not to invent specialized data it does not have', () => {
    expect(prompt).toMatch(/does not have a specialized database for any one relationship category/);
    expect(prompt).toMatch(/do not claim specialized historical or curated data the product does not have/);
  });

  it('identifies as a relationship intelligence assistant, not a sales-only one', () => {
    expect(prompt).toMatch(/You are Barry, Idynify's relationship intelligence assistant/);
    expect(prompt).not.toMatch(/AI sales intelligence assistant/);
  });

  it('does not assume the user is a seller when framing reschedule messages', () => {
    expect(prompt).toMatch(/the user showed up; they are not the one who needs to apologize/);
    expect(prompt).not.toMatch(/the user is the seller/);
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
    expect(prompt).toMatch(/NEVER recommend another product, data provider, or CRM/);
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
    expect(prompt).toMatch(/NEVER recommend another product, data provider, or CRM/);
  });
});

describe('Mission Control Barry — relationship goals beyond traditional sales', () => {
  const NON_SALES_MESSAGES = [
    'I need companies that might sponsor a river restoration project.',
    'I want organizations that could partner with us.',
    'I need potential organizations or people to approach about supporting our nonprofit.',
    'I need people who could introduce me to companies in this market.',
  ];

  for (const message of NON_SALES_MESSAGES) {
    it(`does not gate "${message}" on being a traditional sales motion`, async () => {
      const prompt = await systemPromptFor({ message, contextStack: EMPTY_STACK });
      expect(prompt).toMatch(/NEVER decide whether a user's goal "counts" before helping/);
      expect(prompt).toMatch(/partnership, sponsorship, referral, fundraising\/donor development, community engagement, introductions/);
      expect(prompt).not.toMatch(/B2B prospecting and outreach platform/);
      expect(prompt).not.toMatch(/AI sales intelligence assistant/);
    });
  }

  it('insufficient context ("Find people for me.") still gets the capability truth, not a capability denial', async () => {
    const prompt = await systemPromptFor({ message: 'Find people for me.', contextStack: EMPTY_STACK });
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/NEVER say or imply that Idynify cannot find companies/);
  });

  it('is told not to invent specialized data for an unsupported ask (e.g. companies that sponsored river projects last year)', async () => {
    const prompt = await systemPromptFor({
      message: 'Show me every company that sponsored river projects last year.',
      contextStack: EMPTY_STACK,
    });
    expect(prompt).toMatch(/does not have a specialized database for any one relationship category/);
    expect(prompt).toMatch(/Translate the user's goal into targeting criteria/);
  });

  it('replays the original river-sponsorship production failure: the corrected prompt gives Barry no basis to call it "not a sales play"', async () => {
    const priorBadTurn = {
      intent: 'CUSTOM', barry_mode: 'GROWTH', step: 'execute',
      response_text: "That's community impact work, not a sales play. Idynify is built for B2B sales — finding prospects, drafting pitches, closing deals. What you're doing is partnership development and community outreach, which is a different motion. You might be better served by a CRM like HubSpot or Salesforce to track outreach and commitments.",
      contact_id: null, has_message_angles: false, angles: [], actions: [], clarifying_question: null,
    };
    const conversationHistory = [
      { role: 'user', content: "Basically it's like they get to have their name on a part of the river and would be responsible for picking it up, I'm not selling anything to them" },
      { role: 'assistant', content: JSON.stringify(priorBadTurn) },
    ];

    const prompt = await systemPromptFor({
      message: 'no i need you to find me companies',
      conversationHistory,
      contextStack: EMPTY_STACK,
    });

    // The corrected system prompt no longer contains the sales-only framing
    // and explicitly forbids the exact failure observed in production
    // (declaring the goal out of scope, naming a CRM instead of Idynify).
    expect(prompt).not.toMatch(/B2B prospecting and outreach platform/);
    expect(prompt).not.toMatch(/AI sales intelligence assistant/);
    expect(prompt).toMatch(/NEVER decide whether a user's goal "counts" before helping/);
    expect(prompt).toMatch(/NEVER recommend another product, data provider, or CRM/);

    // NOTE: this proves the system prompt no longer instructs or permits the
    // failure. It does NOT prove a live model call won't still echo its own
    // prior turn (visible above in conversationHistory) verbatim — that is
    // the separate history-replay risk, explicitly out of scope for this
    // change and not fixed by it.
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
