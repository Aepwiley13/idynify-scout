/**
 * Hotfix — Mission Control Barry had no instruction for handling a user
 * pushback/correction.
 *
 * Reproduced in production: Barry told a user "I can't build the list — use
 * Apollo or ZoomInfo." The user replied "No, I need you to find me
 * companies." Barry defended its prior claim instead of re-checking current
 * product truth, even after the product-definition prompt (see
 * missionControlBarryProductTruth.test.js) was already corrected — because
 * nothing in the prompt told Barry that a user correction should trigger
 * re-evaluation rather than defense of its own prior turn.
 *
 * IMPORTANT — these are deterministic prompt-contract tests: they run the
 * real handler with the Anthropic SDK stubbed and assert on the exact
 * `system` prompt text Barry receives. They prove the model is now
 * explicitly instructed to re-evaluate prior claims under pushback. They do
 * NOT prove — and must not be read as proving — that a live model call
 * always complies. That requires separate production/live-model
 * verification.
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

const { handler } = await import('../../netlify/functions/barryMissionChat.js');

async function systemPromptFor(body) {
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', ...body }),
  });
  expect(res.statusCode).toBe(200);
  expect(CALLS.length).toBeGreaterThanOrEqual(1);
  // The prospecting handoff gate (barryMissionChat.js) may issue a preceding
  // classifier call when no targeting is saved, before the real Mission
  // Control call — the mocked classifier response never classifies as
  // PROSPECTING, so these tests always fall through to it. The system prompt
  // under test is always the last call, whether there were one or two.
  return CALLS[CALLS.length - 1].system;
}

const PUSHBACK_HISTORY = [
  { role: 'user', content: 'I need large SLC companies for a Jordan River adoption program.' },
  { role: 'assistant', content: "I can't build the list for you — that's outside what Idynify does. You need a tool like Apollo, ZoomInfo, or LinkedIn to do that part." },
];

const COMPETITORS = /apollo|zoominfo|hunter\.io|sales navigator|clearbit|lusha|seamless/i;
function nonGuardrailLines(prompt) {
  return prompt.split('\n').filter(l => !/^\s*NEVER recommend another product/.test(l) && !/^\s*11\./.test(l));
}

beforeEach(() => { CALLS.length = 0; });

describe('Mission Control Barry — pushback/correction reasoning principle', () => {
  it('the assembled system prompt contains the reasoning-hierarchy principle as Critical Rule 11', async () => {
    const prompt = await systemPromptFor({
      message: 'no i need you to find me companies',
      conversationHistory: PUSHBACK_HISTORY,
      barryMode: 'GROWTH',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });

    expect(prompt).toMatch(/11\. When the user challenges, rejects, or corrects a claim you made earlier in this conversation/);
    expect(prompt).toMatch(/do not defend it or assume it was correct/);
    expect(prompt).toMatch(/re-evaluate against current product truth and current application state above/);
    expect(prompt).toMatch(/Your own prior response is conversation context, not authoritative truth/);
    // Sits immediately after the existing capability rule (10), not replacing or reordering it.
    expect(prompt).toMatch(/10\. Never tell the user Idynify lacks company or person discovery[\s\S]*?\n11\. When the user challenges/);
  });

  it('CASE 1 — reproduced failure: the corrected contract co-locates the pushback rule with the capability truth needed to resolve it', async () => {
    const prompt = await systemPromptFor({
      message: 'no i need you to find me companies',
      conversationHistory: PUSHBACK_HISTORY,
      barryMode: 'GROWTH',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });

    // The re-evaluation rule exists...
    expect(prompt).toMatch(/re-evaluate against current product truth and current application state/);
    // ...and the truth it should re-evaluate against is present and correct.
    expect(prompt).toMatch(/Idynify DOES find companies and people for any of these goals/);
    expect(prompt).toContain('TARGETING STATUS: Not set yet');
    expect(prompt).toMatch(/NEVER recommend another product, data provider, or CRM/);
    // Prompt-contract only: this proves the instruction and the truth are both
    // present together, not that a live model call will comply.
    for (const line of nonGuardrailLines(prompt)) {
      expect(line).not.toMatch(COMPETITORS);
    }
  });

  it('CASE 2 — ordinary clarification is explicitly carved out of the pushback rule', async () => {
    const prompt = await systemPromptFor({
      message: 'no, more like 100+',
      conversationHistory: [
        { role: 'user', content: 'I want SaaS companies' },
        { role: 'assistant', content: 'Are you thinking 500+ employees?' },
      ],
      barryMode: 'GROWTH',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });

    expect(prompt).toMatch(/This does not apply to ordinary clarification \(the user refining a guess or answering your question\) — handle those normally/);
  });

  it('CASE 3 — application state Mission Control actually receives (contact status) is present alongside the pushback rule', async () => {
    const prompt = await systemPromptFor({
      message: 'no they are not dormant, I talked to them yesterday',
      conversationHistory: [
        { role: 'assistant', content: 'Looks like Jamie Rivera has gone dormant — no contact in 45 days.' },
      ],
      barryMode: 'SUGGEST',
      contextStack: {
        contacts: [{
          id: 'c1', name: 'Jamie Rivera', title: 'VP Sales', company: 'Acme',
          contact_status: 'Dormant', stage: 'hunter', strategic_value: 'high',
        }],
        missions: [], recon: {}, icpProfile: null,
      },
    });

    expect(prompt).toMatch(/re-evaluate against current product truth and current application state/);
    // The actual authoritative state (from contextStack, not from the user's claim) is in context.
    expect(prompt).toMatch(/Jamie Rivera.*status:Dormant/);
  });

  it('CASE 4 — targeting-insufficient instruction is unchanged and still present alongside the pushback rule', async () => {
    const prompt = await systemPromptFor({
      message: 'no, just find them',
      conversationHistory: [
        { role: 'assistant', content: "Idynify can find companies once we know enough about who you're looking for." },
      ],
      barryMode: 'GROWTH',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });

    expect(prompt).toMatch(/re-evaluate against current product truth and current application state/);
    expect(prompt).toMatch(/no search can run until their targeting is defined/);
    expect(prompt).toMatch(/Do not offer to search now/);
  });

  it('CASE 5 — normal continuity: the three-step loop and intent taxonomy are untouched', async () => {
    const prompt = await systemPromptFor({
      message: 'sales leaders',
      conversationHistory: [
        { role: 'assistant', content: 'Do you want founders or sales leaders?' },
      ],
      barryMode: 'GROWTH',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });

    expect(prompt).toMatch(/1\. INTAKE — understand what the user wants/);
    expect(prompt).toMatch(/2\. CONFIRM — briefly restate what you understand/);
    expect(prompt).toMatch(/3\. EXECUTE — deliver output with clear options/);
    expect(prompt).toMatch(/- CUSTOM: anything else/);
  });

  it('reaches the model on the opening-brief path too (same prompt builder)', async () => {
    const prompt = await systemPromptFor({
      message: '__OPENING_BRIEF__',
      contextStack: { contacts: [], missions: [], recon: {}, icpProfile: null },
    });
    expect(prompt).toMatch(/11\. When the user challenges, rejects, or corrects a claim you made earlier in this conversation/);
  });
});
