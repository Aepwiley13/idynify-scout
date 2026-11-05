/**
 * generate-engagement-message (Barry's draft generator) previously built its
 * company context from two bare strings already sitting on the CONTACT doc
 * (`company_name`/`company_industry`) — it never read the company
 * collection, never saw founding year or HQ, and never received any
 * ICP-specific messaging. That's the root cause of a draft stating a
 * founding year nobody gave it.
 *
 * These run the real handler, stub everything around the model call, and
 * assert on the exact prompt text — no live model output involved. The
 * things this PR did not touch (Barry memory, the relationship guardrail,
 * strategy recommendation) are mocked out so a failure here is never about
 * one of them.
 */
import { describe, it, expect, vi } from 'vitest';

const CALLS = [];

// Only createMessageWithRetry is mocked for the actual call, but the handler
// still constructs `new Anthropic(...)` first — the real SDK refuses to
// construct in a browser-like (jsdom) environment, so it needs a stand-in too.
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() {} } }));

vi.mock('../../netlify/functions/utils/anthropicRetry.js', () => ({
  createMessageWithRetry: async (_anthropic, params) => {
    CALLS.push(params);
    return {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ messages: [
        { strategy: 'direct', subject: 's', body: 'b', reasoning: 'r' },
        { strategy: 'warm', subject: 's', body: 'b', reasoning: 'r' },
        { strategy: 'value', subject: 's', body: 'b', reasoning: 'r' },
      ] }) }],
      usage: {},
    };
  },
}));
vi.mock('../../netlify/functions/utils/barryContextAssembler.js', () => ({
  assembleBarryContext: async () => ({ promptContext: '', context: null, status: 'ok' }),
}));
vi.mock('../../netlify/functions/utils/barryGuardrail.js', () => ({
  checkRelationshipGuardrail: () => null,
  getGuardrailPromptModifier: () => '',
}));
vi.mock('../../netlify/functions/utils/barryStrategyRecommender.js', () => ({
  recommendStrategy: () => ({ recommendation: null, promptGuidance: '' }),
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));
vi.mock('firebase-admin/app', () => ({ initializeApp: () => {}, getApps: () => [1], cert: () => ({}) }));

globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) }));
globalThis.process.env.ANTHROPIC_API_KEY = 'test';
globalThis.process.env.FIREBASE_API_KEY = 'test';

const NOT_FOUND = { exists: false, empty: true, docs: [], data: () => undefined };

/** A tiny routing fake: path segments joined by "/" select a canned doc. */
function fakeDb(routes) {
  function node(path) {
    return {
      collection: (seg) => node(path ? `${path}/${seg}` : seg),
      doc: (seg) => node(`${path}/${seg}`),
      where: () => node(path),
      orderBy: () => node(path),
      limit: () => node(path),
      async get() { return routes[path] ?? NOT_FOUND; },
    };
  }
  return node('');
}

const CONTACT = {
  id: 'contact1', firstName: 'Chris', lastName: 'Example', title: 'VP Ops',
  company_name: 'Blip', company_id: 'comp1',
};

async function promptFor(routes, contactOverride = {}) {
  vi.doMock('firebase-admin/firestore', () => ({ getFirestore: () => fakeDb(routes), FieldValue: {} }));
  vi.resetModules();
  const { handler } = await import('../../netlify/functions/generate-engagement-message.js');
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', userIntent: 'say hello', contact: { ...CONTACT, ...contactOverride } }),
  });
  expect(res.statusCode).toBe(200);
  expect(CALLS.length).toBe(1);
  return CALLS[0].messages[0].content;
}

describe('generate-engagement-message: company facts and the deciding ICP actually reach the prompt', () => {
  it('no company document at all: falls back to the contact-level fields, never invents a founding year or HQ', async () => {
    // No verified record exists, so there's nothing to say "Unknown" to in a
    // dedicated block (that block doesn't even render) — the safe fallback
    // is the contact's own cached company_name/company_industry, and
    // nothing anywhere states a founding year or a headquarters, because
    // neither ever had a contact-level source to fall back to.
    const prompt = await promptFor(
      { 'users/u1/companies/comp1': NOT_FOUND },
      { company_industry: 'Software' },
    );
    expect(prompt).toContain('Company: Blip'); // the contact's own cached name
    expect(prompt).toContain('Industry: Software');
    expect(prompt).not.toMatch(/Founded:/);
    expect(prompt).not.toMatch(/Headquarters:/);
  });

  it('company found but industry unverified (missing/conflicting): a stale contact-level industry must not leak in anyway', async () => {
    // The exact bug: CONTACT INFORMATION used to read contact.company_industry
    // FIRST, so a stale cached value there could state a fact the dedicated
    // COMPANY CONTEXT block, two paragraphs below, correctly calls Unknown —
    // one prompt contradicting itself.
    const prompt = await promptFor(
      {
        'users/u1/companies/comp1': {
          exists: true,
          data: () => ({ name: 'Blip' }), // no industry anywhere — genuinely unverified
        },
      },
      { company_industry: 'Retail (stale, cached on the contact long ago)' },
    );
    expect(prompt).not.toContain('Retail');
    expect(prompt).toMatch(/Industry: Not specified/); // CONTACT INFORMATION's own phrasing for "no verified value"
    expect(prompt).toMatch(/Industry: Unknown — do not state or guess/); // the dedicated block's phrasing — consistent, not contradictory
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
    expect(prompt).not.toMatch(/Founded: Unknown/);
    expect(prompt).not.toMatch(/Headquarters: Unknown/);
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

  it('missing ICP (no swipedForICPId): Section 9 falls back to the generic dashboard aggregate, not a guessed ICP', async () => {
    const prompt = await promptFor({
      'users/u1/companies/comp1': { exists: true, data: () => ({ name: 'Blip' }) },
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

  it('a real deciding ICP with NO dashboard document at all: the ICP messaging still reaches the prompt', async () => {
    // Unlike barryGenerateContext.js, this file already set reconLoaded=true
    // independently whenever icpMessaging is truthy — confirming that fix
    // isn't needed here too, not just assuming it from reading the code.
    const prompt = await promptFor({
      'users/u1/companies/comp1': { exists: true, data: () => ({ name: 'Blip', swipedForICPId: 'icp_sales' }) },
      'users/u1/icpProfiles/icp_sales': { exists: true, data: () => ({ messaging: { emailTone: 'ICP_SPECIFIC_TONE' } }) },
      'dashboards/u1': NOT_FOUND,
    });
    expect(prompt).toContain('ICP_SPECIFIC_TONE');
  });
});
