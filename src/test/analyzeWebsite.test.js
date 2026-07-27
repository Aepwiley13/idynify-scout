/**
 * analyze-website (Mission Control 2.0 Sprint 2, Workstream A1) — Unit Tests
 *
 * Covers the pure extraction/mapping helpers plus the handler's failure and
 * success paths with node-fetch, the Anthropic SDK, and Firestore mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockDashboardGet = vi.hoisted(() => vi.fn());
const mockDashboardUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUserSet = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('node-fetch', () => ({ default: mockFetch }));

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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}));

// Minimal Firestore admin mock: dashboards/{uid} + users/{uid}.
vi.mock('../../netlify/functions/firebase-admin.js', () => {
  const db = {
    collection: (name) => ({
      doc: () => {
        if (name === 'dashboards') {
          return { get: mockDashboardGet, update: mockDashboardUpdate };
        }
        return { set: mockUserSet };
      },
    }),
  };
  return { db, admin: { auth: () => ({}) } };
});

import {
  handler,
  normalizeUrl,
  stripHtml,
  buildAnalysisPrompt,
  parseBarryJson,
  normalizeConfidence,
  normalizeExtraction,
  mapDataToReconSections,
  recomputeReconModule,
  RECON_FIELD_MAP,
  EXTRACTION_FIELDS,
} from '../../netlify/functions/analyze-website.js';

const FULL_PROFILE = {
  companyName: 'Acme Corp',
  description: 'Acme builds developer tools.',
  whatTheySell: 'A CI/CD platform',
  whoTheyServeTo: 'Engineering teams',
  targetIndustry: 'Software',
  targetCompanySize: 'Mid-market',
  valueProposition: 'Ship faster with confidence',
  icpSummary: '50-500 person software companies with 15+ engineers',
  confidence: 88,
};

function anthropicJsonResponse(obj) {
  return Promise.resolve({
    content: [{ text: JSON.stringify(obj) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

function makeReconSections(overrides = {}) {
  const base = [1, 2, 3, 9].map((sectionId) => ({
    sectionId,
    status: 'not_started',
    unlocked: sectionId === 1,
    data: null,
  }));
  return base.map((s) => ({ ...s, ...(overrides[s.sectionId] || {}) }));
}

function makeDashboardSnap(sections) {
  return {
    exists: true,
    data: () => ({
      modules: [
        { id: 'recon', sections, completedSections: 0, progressPercentage: 0, totalSections: sections.length },
      ],
      progressTracking: { moduleProgress: {} },
    }),
  };
}

function invoke(body) {
  return handler({ httpMethod: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockCreate.mockImplementation(() => anthropicJsonResponse(FULL_PROFILE));
  mockDashboardGet.mockResolvedValue(makeDashboardSnap(makeReconSections()));
});

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('adds https:// when no protocol is present', () => {
    expect(normalizeUrl('idynify.com')).toBe('https://idynify.com/');
  });
  it('preserves an existing protocol', () => {
    expect(normalizeUrl('http://example.com/path')).toBe('http://example.com/path');
  });
  it('rejects empty and non-http protocols', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('ftp://example.com')).toBeNull();
  });
});

// ─── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes scripts, styles, and tags, keeping visible text', () => {
    const html = `<html><head><title>x</title><style>.a{color:red}</style></head>
      <body><script>alert('hi')</script><h1>Acme</h1><p>We build&nbsp;tools.</p></body></html>`;
    const text = stripHtml(html);
    expect(text).toContain('Acme');
    expect(text).toContain('We build tools.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });
  it('caps output at maxChars', () => {
    const html = `<p>${'a'.repeat(20000)}</p>`;
    expect(stripHtml(html, 8000).length).toBe(8000);
  });
  it('handles empty / non-string input', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
  });
});

// ─── parseBarryJson ───────────────────────────────────────────────────────────

describe('parseBarryJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseBarryJson('{"companyName":"Acme"}')).toEqual({ companyName: 'Acme' });
  });
  it('parses JSON inside code fences', () => {
    expect(parseBarryJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses JSON surrounded by prose', () => {
    expect(parseBarryJson('Here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });
  it('returns null on invalid JSON', () => {
    expect(parseBarryJson('not json at all')).toBeNull();
    expect(parseBarryJson('{broken')).toBeNull();
    expect(parseBarryJson('')).toBeNull();
  });
  it('rejects JSON arrays (must be an object)', () => {
    expect(parseBarryJson('[1,2,3]')).toBeNull();
  });
});

// ─── normalizeConfidence / normalizeExtraction ────────────────────────────────

describe('normalizeConfidence', () => {
  it('clamps to 0-100 integers', () => {
    expect(normalizeConfidence(150)).toBe(100);
    expect(normalizeConfidence(-5)).toBe(0);
    expect(normalizeConfidence(87.6)).toBe(88);
    expect(normalizeConfidence('not a number')).toBe(0);
  });
});

describe('normalizeExtraction', () => {
  it('produces every expected string field plus clamped confidence', () => {
    const out = normalizeExtraction({ companyName: '  Acme  ', confidence: '95' });
    for (const f of EXTRACTION_FIELDS) expect(f in out).toBe(true);
    expect(out.companyName).toBe('Acme');
    expect(out.description).toBe('');
    expect(out.confidence).toBe(95);
  });
});

// ─── mapDataToReconSections ───────────────────────────────────────────────────

describe('mapDataToReconSections', () => {
  it('maps each extracted field to its configured section + key', () => {
    const extracted = normalizeExtraction(FULL_PROFILE);
    const { sections, writtenFields } = mapDataToReconSections(makeReconSections(), extracted);

    const s1 = sections.find((s) => s.sectionId === 1);
    expect(s1.data.companyName).toBe('Acme Corp');
    expect(s1.data.whatYouDo).toBe('Acme builds developer tools.');
    expect(s1.data.mainProduct).toBe('A CI/CD platform');
    expect(s1.data.currentCustomers).toBe('Engineering teams');

    const s3 = sections.find((s) => s.sectionId === 3);
    expect(s3.data.targetIndustry).toBe('Software');
    expect(s3.data.targetCompanySize).toBe('Mid-market');
    expect(s3.data.icpSummary).toContain('software companies');

    const s9 = sections.find((s) => s.sectionId === 9);
    expect(s9.data.valueProposition).toBe('Ship faster with confidence');

    // Every mapped field should be recorded as written.
    expect(writtenFields.length).toBe(Object.keys(RECON_FIELD_MAP).length);
  });

  it('marks Section 1 completed when all its fields are populated', () => {
    const extracted = normalizeExtraction(FULL_PROFILE);
    const { sections } = mapDataToReconSections(makeReconSections(), extracted);
    const s1 = sections.find((s) => s.sectionId === 1);
    expect(s1.status).toBe('completed');
    expect(s1.completedAt).toBeTruthy();
  });

  it('leaves structured sections in_progress, never falsely completed', () => {
    const extracted = normalizeExtraction(FULL_PROFILE);
    const { sections } = mapDataToReconSections(makeReconSections(), extracted);
    const s3 = sections.find((s) => s.sectionId === 3);
    const s9 = sections.find((s) => s.sectionId === 9);
    expect(s3.status).toBe('in_progress');
    expect(s9.status).toBe('in_progress');
  });

  it('does not overwrite fields the user already filled in', () => {
    const sections = makeReconSections({
      1: { status: 'in_progress', data: { companyName: 'User Typed Name' } },
    });
    const extracted = normalizeExtraction(FULL_PROFILE);
    const { sections: out, writtenFields } = mapDataToReconSections(sections, extracted);
    const s1 = out.find((s) => s.sectionId === 1);
    expect(s1.data.companyName).toBe('User Typed Name'); // preserved
    expect(s1.data.whatYouDo).toBe('Acme builds developer tools.'); // filled
    expect(writtenFields.find((w) => w.field === 'companyName')).toBeUndefined();
  });

  it('does not clobber existing non-empty array values', () => {
    const sections = makeReconSections({
      3: { status: 'in_progress', data: { companySize: ['smb'], targetIndustry: 'Fintech' } },
    });
    const extracted = normalizeExtraction(FULL_PROFILE);
    const { sections: out } = mapDataToReconSections(sections, extracted);
    const s3 = out.find((s) => s.sectionId === 3);
    expect(s3.data.companySize).toEqual(['smb']);
    expect(s3.data.targetIndustry).toBe('Fintech'); // user value preserved
    expect(s3.data.targetCompanySize).toBe('Mid-market'); // still filled
  });

  it('does not mutate the input sections array', () => {
    const input = makeReconSections();
    const snapshot = JSON.stringify(input);
    mapDataToReconSections(input, normalizeExtraction(FULL_PROFILE));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('skips fields with empty values', () => {
    const partial = normalizeExtraction({ companyName: 'Acme', confidence: 40 });
    const { writtenFields } = mapDataToReconSections(makeReconSections(), partial);
    expect(writtenFields).toEqual([{ field: 'companyName', sectionId: 1, key: 'companyName' }]);
  });
});

// ─── recomputeReconModule ─────────────────────────────────────────────────────

describe('recomputeReconModule', () => {
  it('recounts progress and unlocks the section after a completed one', () => {
    const sections = makeReconSections();
    sections[0].status = 'completed';
    const mod = recomputeReconModule({ id: 'recon', sections });
    expect(mod.completedSections).toBe(1);
    expect(mod.progressPercentage).toBe(25);
    expect(mod.status).toBe('in-progress');
    expect(sections[1].unlocked).toBe(true);
  });
});

// ─── buildAnalysisPrompt ──────────────────────────────────────────────────────

describe('buildAnalysisPrompt', () => {
  it('embeds the text and requests all extraction keys', () => {
    const prompt = buildAnalysisPrompt('Some site copy', 'https://acme.com/');
    expect(prompt).toContain('Some site copy');
    expect(prompt).toContain('https://acme.com/');
    for (const f of EXTRACTION_FIELDS) expect(prompt).toContain(f);
    expect(prompt).toContain('confidence');
  });
});

// ─── handler ──────────────────────────────────────────────────────────────────

describe('handler', () => {
  it('rejects non-POST methods', async () => {
    const res = await handler({ httpMethod: 'GET', body: '' });
    expect(res.statusCode).toBe(405);
  });

  it('400s on missing fields', async () => {
    const res = await invoke({ url: 'idynify.com' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('happy path: fetches, extracts, writes RECON, returns data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<h1>Acme</h1><p>${'We build tools. '.repeat(30)}</p>`),
    });

    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.companyName).toBe('Acme Corp');
    expect(body.data.confidence).toBe(88);
    expect(mockDashboardUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserSet).toHaveBeenCalledTimes(1); // websiteAnalyzed flag
  });

  it('returns a friendly message when the site blocks us (403)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('') });
    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/blocking automated/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns low-confidence message for JavaScript-rendered pages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<div id="root"></div>'),
    });
    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.lowConfidence).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('handles fetch timeout (AbortError) gracefully', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/too long/i);
  });

  it('retries once on invalid JSON, then fails friendly', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<p>${'Real content here. '.repeat(30)}</p>`),
    });
    mockCreate.mockResolvedValue({ content: [{ text: 'sorry, no json' }], usage: {} });

    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(2); // one retry
    expect(mockDashboardUpdate).not.toHaveBeenCalled();
  });

  it('recovers when the first JSON parse fails but the retry succeeds', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<p>${'Real content here. '.repeat(30)}</p>`),
    });
    mockCreate
      .mockResolvedValueOnce({ content: [{ text: 'garbage' }], usage: {} })
      .mockResolvedValueOnce(anthropicJsonResponse(FULL_PROFILE));

    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('401s when auth verification fails', async () => {
    const { verifyAuthToken } = await import('../../netlify/functions/utils/verifyAuthToken.js');
    verifyAuthToken.mockRejectedValueOnce(new Error('Invalid authentication token'));
    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 'bad' });
    expect(res.statusCode).toBe(401);
  });

  it('still returns extracted data if the RECON write throws', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<p>${'Real content here. '.repeat(30)}</p>`),
    });
    mockDashboardGet.mockRejectedValue(new Error('firestore down'));

    const res = await invoke({ url: 'idynify.com', userId: 'user-1', authToken: 't' });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.companyName).toBe('Acme Corp');
  });
});
