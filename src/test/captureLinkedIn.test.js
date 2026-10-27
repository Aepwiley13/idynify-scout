/**
 * Find LinkedIn, the server half: captureLinkedIn, its ranking, and the
 * Google search it shares with Barry's enrichment.
 *
 * Pins that only profiles carrying the person's whole name are offered, ranked
 * by the evidence beside it (company or website, then title or location), with
 * a name-only profile dropped when a strong one exists; that Apollo's person
 * record and Google's index are merged per profile; that the search pairs the
 * name with the strongest signals and runs the name alone only when there are
 * none; that the endpoint is the token's own user, behind the capture mode;
 * that one failing source does not stop the other; and that no name, email,
 * company, title or URL reaches a log line or the usage record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import { format } from 'node:util';

const verifyIdToken = vi.hoisted(() => vi.fn());
const checkAdminAccess = vi.hoisted(() => vi.fn());
const checkSuperAdminAccess = vi.hoisted(() => vi.fn());
const logApiUsage = vi.hoisted(() => vi.fn());

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) },
}));
vi.mock('../../netlify/functions/utils/adminAuth.js', () => ({ checkAdminAccess }));
vi.mock('../../netlify/functions/utils/superAdminAuth.js', () => ({ checkSuperAdminAccess }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));

import { handler } from '../../netlify/functions/captureLinkedIn.js';
import { rankLinkedInCandidates, canonicalProfileUrl, evidence } from '../../netlify/functions/utils/capture/linkedinCandidates.js';
import { searchLinkedInCandidates, describeSearchResult } from '../../netlify/functions/utils/linkedinSearch.js';

const ADMIN = 'uid_admin_7g5g';
const MEMBER = 'uid_member_2k';
const TOKENS = { tok_admin: ADMIN, tok_member: MEMBER };

const KRISTIN = { name: 'Kristin Sokol', company: 'Bright Path Learning', title: 'Instructional Matchmaker', domain: 'brightpathlearning.com', email: 'kristin@brightpathlearning.com', location: null };
const PERSON_VALUES = ['Kristin', 'Sokol', 'Bright Path', 'brightpath', 'Instructional', 'Matchmaker', 'kristin@', 'linkedin.com/in'];

// ─── Google and Apollo, as the endpoint sees them ───────────────────────────

const googleItem = (slug, title, snippet = '', image = null) => ({
  link: `https://www.linkedin.com/in/${slug}`,
  title,
  snippet,
  pagemap: image ? { cse_thumbnail: [{ src: image }] } : {},
});

const KRISTIN_RESULT = googleItem('kristin-sokol', 'Kristin Sokol - Instructional Matchmaker - Bright Path Learning | LinkedIn', 'Location: Utah · Instructional Matchmaker at Bright Path Learning', 'https://media.licdn.com/dms/image/kristin.jpg');
const NAMESAKE = googleItem('kristin-sokol-42', 'Kristin Sokol - Nurse - St. Mark Hospital | LinkedIn', 'Location: Ohio');
const COMPANY_PAGE = { link: 'https://www.linkedin.com/company/bright-path-learning', title: 'Bright Path Learning | LinkedIn', snippet: '' };

const APOLLO_KRISTIN = {
  person: {
    name: 'Kristin Sokol', title: 'Instructional Matchmaker', headline: 'Instructional Matchmaker at Bright Path Learning',
    linkedin_url: 'http://www.linkedin.com/in/kristin-sokol', photo_url: 'https://apollo.example/photo.jpg',
    city: 'Salt Lake City', state: 'Utah', organization: { name: 'Bright Path Learning', primary_domain: 'brightpathlearning.com' },
  },
};

/** Stub fetch: Google answers `google` (array of item lists, one per query); Apollo answers `apollo`. */
function network({ google = [[KRISTIN_RESULT, NAMESAKE, COMPANY_PAGE]], googleStatus = 200, apollo = APOLLO_KRISTIN, apolloStatus = 200 } = {}) {
  const calls = { google: [], apollo: [] };
  vi.stubGlobal('fetch', async (url, init = {}) => {
    if (String(url).startsWith('https://www.googleapis.com/customsearch/v1')) {
      const q = new URL(url).searchParams.get('q');
      calls.google.push(q);
      const items = google[Math.min(calls.google.length - 1, google.length - 1)] ?? [];
      return { ok: googleStatus === 200, status: googleStatus, json: async () => ({ items }) };
    }
    if (String(url).includes('apollo.io')) {
      calls.apollo.push(JSON.parse(init.body));
      return { ok: apolloStatus === 200, status: apolloStatus, json: async () => apollo };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

function request({ token = 'tok_admin', method = 'POST', body } = {}) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? JSON.stringify({ userId: TOKENS[token] ?? ADMIN, person: KRISTIN }) : JSON.stringify(body),
  };
}

let logs;
const ENV = { CAPTURE_MODE: 'internal', APOLLO_API_KEY: 'apollo_SECRET', GOOGLE_SEARCH_API_KEY: 'google_SECRET', GOOGLE_SEARCH_ENGINE_ID: 'cx_123' };
const saved = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  verifyIdToken.mockReset().mockImplementation(async (token) => {
    if (!TOKENS[token]) throw new Error('bad token');
    return { uid: TOKENS[token] };
  });
  checkAdminAccess.mockReset().mockImplementation(async uid => uid === ADMIN);
  checkSuperAdminAccess.mockReset().mockResolvedValue(false);
  logApiUsage.mockReset();
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const parse = response => JSON.parse(response.body);

// ─── Ranking ────────────────────────────────────────────────────────────────

describe('which profiles are offered, and why', () => {
  const search = (over = {}) => ({ source: 'search', linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol', name: 'Kristin Sokol', headline: 'Instructional Matchmaker · Bright Path Learning', text: '', ...over });

  it('name + company is strong; name + title is good; the name alone is possible', () => {
    expect(rankLinkedInCandidates(KRISTIN, [search()])[0]).toMatchObject({ strength: 'strong', reasons: ['name', 'company', 'title'] });
    expect(rankLinkedInCandidates({ ...KRISTIN, company: null, domain: null }, [search({ headline: 'Instructional Matchmaker' })])[0])
      .toMatchObject({ strength: 'good', reasons: ['name', 'title'] });
    expect(rankLinkedInCandidates({ name: 'Kristin Sokol' }, [search({ headline: 'Nurse' })])[0])
      .toMatchObject({ strength: 'possible', reasons: ['name'] });
  });

  it('a profile without the whole name is never offered', () => {
    expect(rankLinkedInCandidates(KRISTIN, [search({ name: 'Kristin Smith' }), search({ linkedinUrl: 'https://www.linkedin.com/in/k', name: 'Sokol' })])).toEqual([]);
  });

  it('when the card says more than the name, a profile matching only the name is not offered; at most three are', () => {
    const namesake = search({ linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol-42', headline: 'Nurse · St. Mark Hospital' });
    expect(rankLinkedInCandidates(KRISTIN, [namesake, search()]).map(c => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/kristin-sokol']);
    expect(rankLinkedInCandidates(KRISTIN, [namesake])).toEqual([]);

    const many = ['a', 'b', 'c', 'd'].map(s => search({ linkedinUrl: `https://www.linkedin.com/in/kristin-${s}` }));
    expect(rankLinkedInCandidates(KRISTIN, many)).toHaveLength(3);
  });

  it('Apollo and Google pointing at one profile are one candidate; Apollo\'s verified details win', () => {
    const [only] = rankLinkedInCandidates(KRISTIN, [
      search({ photoUrl: 'https://google.example/thumb.jpg', location: 'Utah' }),
      { source: 'apollo', linkedinUrl: 'http://www.linkedin.com/in/kristin-sokol/', name: 'Kristin Sokol', headline: 'Instructional Matchmaker at Bright Path Learning', company: 'Bright Path Learning', companyDomain: 'brightpathlearning.com', location: 'Salt Lake City, Utah', photoUrl: 'https://apollo.example/photo.jpg', text: '' },
    ]);
    expect(only).toMatchObject({
      linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol',
      company: 'Bright Path Learning', location: 'Salt Lake City, Utah', photoUrl: 'https://apollo.example/photo.jpg',
      sources: ['search', 'apollo'], strength: 'strong',
    });
  });

  it('only a person\'s profile address counts; every form of it is one address', () => {
    expect(canonicalProfileUrl('https://uk.linkedin.com/in/Kristin-Sokol/?trk=x')).toBe('https://www.linkedin.com/in/kristin-sokol');
    expect(canonicalProfileUrl('https://www.linkedin.com/company/bright-path')).toBeNull();
    expect(canonicalProfileUrl('https://www.linkedin.com/posts/kristin-123')).toBeNull();
  });

  it('a website matches by its name, a free-mail address never stands in for a company', () => {
    expect(evidence({ name: 'Kristin Sokol', domain: 'www.brightpathlearning.com' }, { name: 'Kristin Sokol', text: 'brightpathlearning' }).domain).toBe(true);
    expect(evidence({ name: 'Kristin Sokol', company: 'Inc.' }, { name: 'Kristin Sokol', text: 'Inc' }).company).toBe(false);
  });
});

// ─── The Google search ──────────────────────────────────────────────────────

describe('searchLinkedInCandidates', () => {
  it('pairs the name with the company, then the domain; never the name alone when there is more', async () => {
    const calls = network({ google: [[KRISTIN_RESULT], [NAMESAKE]] });
    const result = await searchLinkedInCandidates({ ...KRISTIN, env: ENV });
    expect(calls.google).toEqual([
      '"Kristin Sokol" "Bright Path Learning" site:linkedin.com/in/',
      '"Kristin Sokol" brightpathlearning.com site:linkedin.com/in/',
    ]);
    expect(result.results.map(r => r.linkedinUrl)).toEqual(['https://www.linkedin.com/in/kristin-sokol', 'https://www.linkedin.com/in/kristin-sokol-42']);
  });

  it('the name alone only when there is nothing else', async () => {
    const calls = network();
    await searchLinkedInCandidates({ name: 'Kristin Sokol', env: ENV });
    expect(calls.google).toEqual(['"Kristin Sokol" site:linkedin.com/in/']);
  });

  it('reads name, headline, location and photo from a result, and skips company pages', async () => {
    network();
    const { results } = await searchLinkedInCandidates({ name: 'Kristin Sokol', company: 'Bright Path Learning', env: ENV, maxQueries: 1 });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      name: 'Kristin Sokol', headline: 'Instructional Matchmaker · Bright Path Learning', location: 'Utah',
      photoUrl: 'https://media.licdn.com/dms/image/kristin.jpg',
    });
    expect(describeSearchResult({ title: 'Ann Lee | LinkedIn', snippet: '' }, 'u')).toMatchObject({ name: 'Ann Lee', headline: null, location: null });
  });

  it('not configured, or every search failed, is said so; it logs nothing either way', async () => {
    expect(await searchLinkedInCandidates({ name: 'Kristin Sokol', env: {} })).toEqual({ configured: false, failed: false, results: [] });
    network({ googleStatus: 500 });
    expect(await searchLinkedInCandidates({ ...KRISTIN, env: ENV })).toMatchObject({ configured: true, failed: true, results: [] });
    expect(logs).toEqual([]);
  });
});

// ─── The endpoint ───────────────────────────────────────────────────────────

describe('captureLinkedIn', () => {
  it('returns the likely profiles, best first, with what was found and why', async () => {
    const calls = network();
    const response = await handler(request());
    expect(response.statusCode).toBe(200);
    const { candidates } = parse(response);
    expect(candidates).toEqual([{
      linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol',
      name: 'Kristin Sokol',
      headline: 'Instructional Matchmaker at Bright Path Learning',
      company: 'Bright Path Learning',
      location: 'Salt Lake City, Utah',
      photoUrl: 'https://apollo.example/photo.jpg',
      sources: ['apollo', 'search'],
      strength: 'strong',
      reasons: ['name', 'company', 'domain', 'title'],
    }]);
    // Apollo was asked with the name split, the email, the company and the domain.
    expect(calls.apollo).toEqual([{ first_name: 'Kristin', last_name: 'Sokol', email: 'kristin@brightpathlearning.com', organization_name: 'Bright Path Learning', domain: 'brightpathlearning.com' }]);
    expect(calls.google).toHaveLength(2);
  });

  it('nothing likely: an empty list, not an error', async () => {
    network({ google: [[NAMESAKE]], apollo: { person: null } });
    const response = await handler(request({ body: { userId: ADMIN, person: { ...KRISTIN, company: 'Other Co', domain: null, title: null, email: null } } }));
    expect(response.statusCode).toBe(200);
    expect(parse(response).candidates).toEqual([]);
  });

  it('one source failing does not stop the other; both failing is unavailable', async () => {
    network({ apolloStatus: 500 });
    expect(parse(await handler(request())).candidates).toHaveLength(1);

    network({ googleStatus: 500, apollo: APOLLO_KRISTIN });
    expect(parse(await handler(request())).candidates).toHaveLength(1);

    network({ googleStatus: 500, apolloStatus: 500 });
    const failed = await handler(request());
    expect(failed.statusCode).toBe(503);
    expect(parse(failed)).toEqual({ error: 'unavailable', reason: 'sources_failed' });
  });

  it('with no source configured it says so', async () => {
    delete process.env.APOLLO_API_KEY;
    delete process.env.GOOGLE_SEARCH_API_KEY;
    const response = await handler(request());
    expect(response.statusCode).toBe(503);
    expect(parse(response)).toEqual({ error: 'unavailable', reason: 'not_configured' });
  });

  it.each([
    ['no token', { token: null }, 401, 'unauthorized'],
    ['an unknown token', { token: 'tok_forged' }, 401, 'unauthorized'],
    ['someone else\'s id', { body: { userId: MEMBER, person: KRISTIN } }, 403, 'forbidden'],
    ['no name', { body: { userId: ADMIN, person: { company: 'Bright Path Learning' } } }, 400, 'invalid_request'],
    ['a field that is not text', { body: { userId: ADMIN, person: { name: 'Kristin Sokol', company: { $gt: '' } } } }, 400, 'invalid_request'],
    ['a field too long', { body: { userId: ADMIN, person: { name: 'x'.repeat(301) } } }, 400, 'invalid_request'],
    ['GET', { method: 'GET' }, 405, 'method_not_allowed'],
  ])('%s: %i', async (_, req, status, error) => {
    const calls = network();
    const response = await handler(request(req));
    expect(response.statusCode).toBe(status);
    expect(parse(response).error).toBe(error);
    expect(calls.google).toEqual([]);
    expect(calls.apollo).toEqual([]);
  });

  it('only where the capture mode covers the user: a member in internal mode, anyone in off', async () => {
    const calls = network();
    const member = await handler(request({ token: 'tok_member' }));
    expect(member.statusCode).toBe(404);
    expect(parse(member)).toEqual({ error: 'capture_disabled' });

    process.env.CAPTURE_MODE = 'off';
    expect((await handler(request())).statusCode).toBe(404);
    expect(calls.google).toEqual([]);
    expect(calls.apollo).toEqual([]);
  });

  it('logs and records no name, email, company, title or URL: only codes, counts and source names', async () => {
    network();
    await handler(request());
    network({ googleStatus: 500, apolloStatus: 500 });
    await handler(request());

    const recorded = [...logs, ...logApiUsage.mock.calls.map(c => JSON.stringify(c))];
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.filter(line => PERSON_VALUES.some(v => line.toLowerCase().includes(v.toLowerCase())))).toEqual([]);
    expect(recorded.filter(line => /SECRET/.test(line))).toEqual([]);
    expect(JSON.parse(logs.find(l => l.includes('"outcome":"ok"')))).toMatchObject({ evt: 'capture', stage: 'linkedin', candidates: 1, sources: ['apollo', 'search'] });
  });
});
