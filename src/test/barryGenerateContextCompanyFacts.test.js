/**
 * barryGenerateContext (the Meet-panel backend) previously built its company
 * context from a `companyData` parameter the frontend always passed as
 * `null` — a dead guardrail feeding a prompt with zero company grounding,
 * which is how a draft stated a founding year and an HQ nobody gave it.
 *
 * These run the real handler with Anthropic stubbed, capture the exact
 * prompt it sends, and assert on it directly — no live model output
 * involved. Firestore is a minimal routing fake scoped to exactly the paths
 * this handler reads.
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
            content: [{
              type: 'text',
              text: JSON.stringify({
                whoYoureMeeting: 'ok', whatRoleCaresAbout: ['ok'], whatCompanyFocusedOn: ['ok'],
                conversationStarters: ['ok'], calmReframe: 'ok',
              }),
            }],
          };
        },
      };
    }
  },
}));

const NOT_FOUND = { exists: false, data: () => undefined };

/** A tiny routing fake: path segments joined by "/" select a canned doc. */
function fakeDb(routes) {
  function node(path) {
    return {
      collection: (seg) => node(path ? `${path}/${seg}` : seg),
      doc: (seg) => node(`${path}/${seg}`),
      async get() { return routes[path] ?? NOT_FOUND; },
    };
  }
  return node('');
}

vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) }));
globalThis.process.env.ANTHROPIC_API_KEY = 'test';
globalThis.process.env.FIREBASE_API_KEY = 'test';

const CONTACT = { id: 'contact1', name: 'Chris Example', title: 'VP Ops', company_name: 'Blip', company_id: 'comp1' };

async function promptFor(routes) {
  vi.doMock('../../netlify/functions/firebase-admin.js', () => ({ db: fakeDb(routes), admin: {} }));
  vi.resetModules();
  const { handler } = await import('../../netlify/functions/barryGenerateContext.js');
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', contact: CONTACT }),
  });
  expect(res.statusCode).toBe(200);
  expect(CALLS.length).toBe(1);
  return CALLS[0].messages[0].content;
}

describe('barryGenerateContext: company facts actually reach the prompt', () => {
  beforeEach(() => { vi.restoreAllMocks?.(); });

  it('no company document at all: every company fact line says Unknown, never a guess', async () => {
    const prompt = await promptFor({ 'users/u1/companies/comp1': NOT_FOUND });
    expect(prompt).toMatch(/Founded: Unknown — do not reference company age or founding year/);
    expect(prompt).toMatch(/Headquarters: Unknown — do not state or guess/);
  });

  it('a company with real, agreeing facts: the prompt states them, not a placeholder', async () => {
    const prompt = await promptFor({
      'users/u1/companies/comp1': {
        exists: true,
        data: () => ({ name: 'Blip', industry: 'Software', location: 'Utah, US', founded_year: 2015 }),
      },
    });
    expect(prompt).toContain('Founded: 2015');
    expect(prompt).toContain('Headquarters: Utah, US');
    // The framing sentence around the block legitimately mentions the word
    // "Unknown" as an instruction; no individual FIELD VALUE should be one.
    expect(prompt).not.toMatch(/Founded: Unknown/);
    expect(prompt).not.toMatch(/Headquarters: Unknown/);
    expect(prompt).not.toMatch(/Industry: Unknown/);
  });

  it('conflicting sources for founding year/HQ: the prompt states Unknown for both, never picks a side', async () => {
    const prompt = await promptFor({
      'users/u1/companies/comp1': {
        exists: true,
        data: () => ({
          name: 'Blip', founded_year: 2015, location: 'Utah, US',
          apolloEnrichment: { snapshot: { founded_year: 2011, location: { full: 'London, UK' } } },
        }),
      },
    });
    expect(prompt).toMatch(/Founded: Unknown — do not reference company age or founding year/);
    expect(prompt).toMatch(/Headquarters: Unknown — do not state or guess/);
    expect(prompt).not.toContain('2011');
    expect(prompt).not.toContain('2015');
    expect(prompt).not.toContain('London');
    expect(prompt).not.toContain('Utah');
  });

  it('missing ICP (no swipedForICPId): RECON compiles without ICP messaging, not a guessed association', async () => {
    const prompt = await promptFor({
      'users/u1/companies/comp1': { exists: true, data: () => ({ name: 'Blip' }) }, // no swipedForICPId
      'dashboards/u1': {
        exists: true,
        data: () => ({ modules: [{ id: 'recon', sections: [
          { sectionId: 9, status: 'completed', data: { emailTone: 'GENERIC_DASHBOARD_TONE' } },
        ] }] }),
      },
    });
    expect(prompt).toContain('GENERIC_DASHBOARD_TONE');
  });

  it('a real deciding ICP with its own messaging: that messaging reaches the prompt, replacing the generic aggregate', async () => {
    const prompt = await promptFor({
      'users/u1/companies/comp1': { exists: true, data: () => ({ name: 'Blip', swipedForICPId: 'icp_sales' }) },
      'users/u1/icpProfiles/icp_sales': { exists: true, data: () => ({ messaging: { emailTone: 'ICP_SPECIFIC_TONE' } }) },
      'dashboards/u1': {
        exists: true,
        data: () => ({ modules: [{ id: 'recon', sections: [
          { sectionId: 9, status: 'completed', data: { emailTone: 'GENERIC_DASHBOARD_TONE' } },
        ] }] }),
      },
    });
    expect(prompt).toContain('ICP_SPECIFIC_TONE');
    expect(prompt).not.toContain('GENERIC_DASHBOARD_TONE');
  });
});
