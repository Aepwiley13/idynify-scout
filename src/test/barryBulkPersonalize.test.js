/**
 * BARRY BULK PERSONALIZE (Phase 1 Workstream A) — Unit Tests
 *
 * Covers the Workstream A QA checklist with the Anthropic SDK mocked:
 *   - unique per-contact opening lines referencing contact specifics
 *   - 400 on >25 contacts
 *   - generic warm line (not an error) for contacts missing title/company
 *   - single-contact Claude failure does not fail the batch
 * Live-key verification (real Haiku output) must be run in an environment
 * with ANTHROPIC_API_KEY — see PR notes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: vi.fn().mockResolvedValue({ tokenUserId: 'user-1' }),
}));

vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

import {
  handler,
  buildPrompt,
  buildInlinePersonalizePrompt,
  buildReconBlock,
  cleanOpeningLine,
  monthsInRole,
  extractTagContext,
  MODES,
  PERSONALIZE_TAG,
} from '../../netlify/functions/barryBulkPersonalize.js';

// Default mock: echo back a line that references the company named in the prompt,
// so uniqueness/specificity assertions exercise real prompt content.
function echoCompanyResponse({ messages }) {
  const prompt = messages[0].content;
  const company = prompt.match(/^Company: (.+)$/m)?.[1] || 'your team';
  const firstName = prompt.match(/^First name: (.+)$/m)?.[1] || 'there';
  return Promise.resolve({
    content: [{ text: `Saw what ${firstName} is building at ${company}. Impressive trajectory. Felt worth reaching out.` }],
  });
}

function makeContact(i, overrides = {}) {
  return {
    contactId: `c${i}`,
    firstName: `Name${i}`,
    lastName: `Last${i}`,
    title: `Title${i}`,
    company: `Company${i}`,
    industry: 'SaaS',
    job_start_date: null,
    barryContext: null,
    ...overrides,
  };
}

function makeEvent(bodyOverrides = {}) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify({
      userId: 'user-1',
      authToken: 'token',
      contacts: [makeContact(1), makeContact(2), makeContact(3)],
      sharedBody: 'We help teams cut onboarding time in half. Worth a quick chat?',
      recon: null,
      userContext: { name: 'Aaron', company: 'Idynify' },
      ...bodyOverrides,
    }),
  };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockCreate.mockReset();
  mockCreate.mockImplementation(echoCompanyResponse);
});

describe('barryBulkPersonalize handler', () => {
  it('returns a unique, contact-specific opening line per contact', async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body);

    expect(results).toHaveLength(3);
    expect(results.map(r => r.contactId)).toEqual(['c1', 'c2', 'c3']);
    for (const [i, r] of results.entries()) {
      expect(r.success).toBe(true);
      expect(r.openingLine).toContain(`Company${i + 1}`);
    }
    // All lines unique
    expect(new Set(results.map(r => r.openingLine)).size).toBe(3);
    // One Claude call per contact
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls.every(([params]) => params.model === 'claude-haiku-4-5-20251001')).toBe(true);
  });

  it('returns 400 when more than 25 contacts are submitted', async () => {
    const contacts = Array.from({ length: 26 }, (_, i) => makeContact(i));
    const res = await handler(makeEvent({ contacts }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/25/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts exactly 25 contacts', async () => {
    const contacts = Array.from({ length: 25 }, (_, i) => makeContact(i));
    const res = await handler(makeEvent({ contacts }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).results).toHaveLength(25);
  });

  it('generates a generic warm line (not an error) when title and company are missing', async () => {
    const bare = { contactId: 'bare', firstName: 'Sam' };
    const res = await handler(makeEvent({ contacts: [bare] }));
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body);
    expect(results[0].success).toBe(true);
    expect(results[0].openingLine).toBeTruthy();

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('warm, genuine, generic opening line');
    expect(prompt).toContain('Do NOT invent details');
  });

  it('isolates a single Claude failure — other contacts in the batch still succeed', async () => {
    mockCreate.mockImplementation((params) => {
      if (params.messages[0].content.includes('Company3')) {
        return Promise.reject(new Error('API overloaded'));
      }
      return echoCompanyResponse(params);
    });

    const contacts = [1, 2, 3, 4, 5].map(i => makeContact(i));
    const res = await handler(makeEvent({ contacts }));
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body);

    const failed = results.find(r => r.contactId === 'c3');
    expect(failed).toEqual({ contactId: 'c3', openingLine: null, success: false, error: 'API overloaded' });
    expect(results.filter(r => r.success)).toHaveLength(4);
  });

  it('rejects non-POST, missing auth, empty contacts, and missing sharedBody', async () => {
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(405);

    const noAuth = makeEvent();
    const parsed = JSON.parse(noAuth.body);
    delete parsed.authToken;
    expect((await handler({ httpMethod: 'POST', body: JSON.stringify(parsed) })).statusCode).toBe(401);

    expect((await handler(makeEvent({ contacts: [] }))).statusCode).toBe(400);
    expect((await handler(makeEvent({ sharedBody: '   ' }))).statusCode).toBe(400);
  });

  it('returns a per-contact failure for entries missing contactId', async () => {
    const res = await handler(makeEvent({ contacts: [makeContact(1), { firstName: 'NoId' }] }));
    const { results } = JSON.parse(res.body);
    expect(results[0].success).toBe(true);
    expect(results[1]).toEqual({ contactId: null, openingLine: null, success: false, error: 'Missing contactId' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('inline_personalize mode (Phase 1.5)', () => {
  const inlineBody = `Hi ${PERSONALIZE_TAG}, I wanted to share our new onboarding guide. The attached PDF covers the details.`;

  it('rejects an unknown mode with 400', async () => {
    const res = await handler(makeEvent({ mode: 'full_email' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid mode/);
  });

  it('rejects inline_personalize when the body has no tag', async () => {
    const res = await handler(makeEvent({ mode: MODES.INLINE_PERSONALIZE, sharedBody: 'No tag here.' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain(PERSONALIZE_TAG);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('uses the inline prompt variant with the tag surroundings as context', async () => {
    const res = await handler(makeEvent({ mode: MODES.INLINE_PERSONALIZE, sharedBody: inlineBody }));
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('replacement text for that marker');
    expect(prompt).toContain('Text before the marker: "Hi"');
    expect(prompt).toContain('Text after the marker: ", I wanted to share our new onboarding guide."');
    expect(prompt).toContain(PERSONALIZE_TAG);
    expect(prompt).toContain('fit grammatically');
    // Still one Haiku call per contact
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('defaults to opening_line mode — existing prompt is unchanged when mode is omitted', async () => {
    await handler(makeEvent());
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('personalized opening line');
    expect(prompt).not.toContain('replacement text for that marker');
  });

  it('extractTagContext pulls sentence context and counts tags', () => {
    const ctx = extractTagContext(`First point made here. Also, ${PERSONALIZE_TAG} which is why I'm writing. More text.`);
    expect(ctx.sentenceBefore).toBe('Also,');
    expect(ctx.sentenceAfter).toBe("which is why I'm writing.");
    expect(ctx.tagCount).toBe(1);

    const multi = extractTagContext(`${PERSONALIZE_TAG} start. Middle. ${PERSONALIZE_TAG} end.`);
    expect(multi.tagCount).toBe(2);
    expect(multi.sentenceBefore).toBe('');

    expect(extractTagContext('no tag')).toBeNull();
    expect(extractTagContext(null)).toBeNull();
  });

  it('inline prompt still switches to the generic variant for bare contacts', () => {
    const ctx = extractTagContext(inlineBody);
    const prompt = buildInlinePersonalizePrompt({ contactId: 'x', firstName: 'Sam' }, inlineBody, ctx, null, null);
    expect(prompt).toContain('Do NOT invent details');
  });
});

describe('prompt construction', () => {
  it('passes contact fields, tenure, persona, RECON, and shared body into the prompt', () => {
    const contact = makeContact(1, {
      job_start_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 95).toISOString(),
      barryContext: { personaSummary: 'Pragmatic operator, hates fluff' },
    });
    const recon = buildReconBlock({
      section5: { userInput: { primaryPain: 'Slow onboarding', painCost: 'Churn' } },
      section9: { userInput: { emailTone: 'Direct', keyMessages: ['Time savings'] } },
    });
    const prompt = buildPrompt(contact, 'Shared body here.', recon, { name: 'Aaron', company: 'Idynify' });

    expect(prompt).toContain('First name: Name1');
    expect(prompt).toContain('Title: Title1');
    expect(prompt).toContain('Company: Company1');
    expect(prompt).toContain('Industry: SaaS');
    expect(prompt).toContain('3 months in role');
    expect(prompt).toContain('Pragmatic operator, hates fluff');
    expect(prompt).toContain('Slow onboarding');
    expect(prompt).toContain('Direct');
    expect(prompt).toContain('Shared body here.');
    expect(prompt).toContain('2-3 sentences maximum');
    expect(prompt).toContain('No subject line');
  });

  it('handles RECON sections in raw ({ userInput }), data, or flattened shapes', () => {
    const flat = buildReconBlock({ section5: { primaryPain: 'X' } });
    const wrapped = buildReconBlock({ section5: { userInput: { primaryPain: 'X' } } });
    const data = buildReconBlock({ section5: { data: { primaryPain: 'X' } } });
    expect(flat).toContain('X');
    expect(wrapped).toContain('X');
    expect(data).toContain('X');
    expect(buildReconBlock(null)).toBeNull();
  });
});

describe('helpers', () => {
  it('monthsInRole formats tenure and rejects bad dates', () => {
    const threeMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 95).toISOString();
    expect(monthsInRole(threeMonthsAgo)).toBe('3 months in role');
    expect(monthsInRole(new Date().toISOString())).toBe('less than 1 month in role');
    expect(monthsInRole('not-a-date')).toBeNull();
    expect(monthsInRole(null)).toBeNull();
    // Future start dates are ignored
    expect(monthsInRole(new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString())).toBeNull();
  });

  it('cleanOpeningLine strips quotes and trailing paragraphs', () => {
    expect(cleanOpeningLine('"Nice line here."')).toBe('Nice line here.');
    expect(cleanOpeningLine('First paragraph.\n\nSecond paragraph.')).toBe('First paragraph.');
    expect(cleanOpeningLine('  padded  ')).toBe('padded');
    expect(cleanOpeningLine('')).toBeNull();
    expect(cleanOpeningLine(null)).toBeNull();
  });
});
