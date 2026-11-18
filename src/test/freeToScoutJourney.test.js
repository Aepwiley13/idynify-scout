/**
 * W6: the parts of the Free → Scout end-to-end test that can be checked without a browser,
 * Stripe or staging: its arguments and refusals, which requests count as paid, the account
 * comparison that proves nothing was lost, the local Apollo stand-in, the loopback-only Apollo
 * override, and stagingDev's --apollo-mock plan. The journey itself runs on the staging machine
 * (scripts/staging/e2e/freeToScout.mjs; docs/billing/STAGING_VALIDATION_RUNBOOK.md Part 9).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseE2eArgs, JourneyRefusal, FIVE_PEOPLE_CSV, isPaidRequest, compareAccount, summarize, BILLING_FIELDS,
} from '../../scripts/staging/e2e/journey.mjs';
import { startApolloMock, answer, mockPerson, APOLLO_MOCK_KEY } from '../../scripts/staging/apolloMock.mjs';
import { apolloBaseUrl, APOLLO_LIVE_BASE } from '../../netlify/functions/utils/apolloConstants.js';
import { planDevRun } from '../../scripts/staging/stagingDev.mjs';

afterEach(() => { vi.restoreAllMocks(); });

describe('arguments', () => {
  it('defaults to the local app, a fresh address and a report outside the repository', () => {
    const a = parseE2eArgs([], { now: 123, tmp: '/tmp/x' });
    expect(a).toMatchObject({ base: 'http://localhost:8888', email: 'idynify-e2e-123@e2e.example.test', out: '/tmp/x/idynify-e2e-123.json', headed: false, withPro: false, expectMetering: false });
    expect(parseE2eArgs(['--expect-metering']).expectMetering).toBe(true);
    expect(a.password).toMatch(/^E2e-.+!9$/);
  });

  it('refuses any deployed site: it signs up and pays', () => {
    expect(() => parseE2eArgs(['--base=https://idynify.com'])).toThrow(JourneyRefusal);
    expect(() => parseE2eArgs(['--base=https://deploy-preview-1--idynify.netlify.app'])).toThrow(/localhost/);
    expect(() => parseE2eArgs(['--base=not a url'])).toThrow(JourneyRefusal);
    expect(parseE2eArgs(['--base=http://127.0.0.1:8888/x']).base).toBe('http://127.0.0.1:8888');
  });

  it('refuses unknown flags', () => {
    expect(() => parseE2eArgs(['--live'])).toThrow(/Unknown argument/);
  });

  it('the CSV has five valid people', () => {
    expect(FIVE_PEOPLE_CSV.split('\n')).toHaveLength(6);
  });
});

describe('paid requests', () => {
  it.each([
    '/.netlify/functions/enrichContact', '/.netlify/functions/barryEnrich', '/.netlify/functions/barryMissionChat',
    '/.netlify/functions/search-companies', '/.netlify/functions/generate-section-3', '/.netlify/functions/captureExtract',
  ])('%s costs money', (path) => {
    expect(isPaidRequest(`http://localhost:8888${path}`)).toBe(true);
  });
  it.each([
    '/.netlify/functions/send-welcome-email', '/.netlify/functions/create-checkout-session', '/.netlify/functions/stickers-config',
    '/.netlify/functions/searchPeopleLater', 'not a url',
  ])('%s does not', (path) => {
    expect(isPaidRequest(path.startsWith('/') ? `http://localhost:8888${path}` : path)).toBe(false);
  });
});

describe('compareAccount: nothing the customer made is lost or changed', () => {
  const BEFORE = {
    '': { email: 'a@e2e.example.test', createdAt: 1 },
    'contacts/ana': { name: 'Ana Lopez', email: 'ana@x', phone: '801', title: 'CEO', notes: [{ id: 'n1', text: 'Met' }], sticker_ids: ['s1'], linkedin_url: null },
    'contacts/ben': { name: 'Ben Okafor', email: 'ben@x' },
    'stickers/s1': { name: 'Friends' },
    'myCard/main': { headline: 'Builder' },
  };
  const upgraded = (patch = {}) => ({
    ...structuredClone(BEFORE),
    '': { ...BEFORE[''], hasCompletedPayment: true, subscriptionTier: 'starter', credits: { remaining: 399 }, stripeCustomerId: 'cus_1' },
    'contacts/ana': { ...BEFORE['contacts/ana'], linkedin_url: 'https://linkedin.com/in/ana', enriched_at: 'now' },
    'creditTransactions/t1': { cost: 1 },
    'creditCharges/k1': { status: 'settled' },
    ...patch,
  });
  const check = (after) => compareAccount(BEFORE, after, { enrichedContactPath: 'contacts/ana' });

  it('a clean upgrade and enrichment: no problems', () => {
    expect(check(upgraded())).toEqual([]);
  });

  it('a deleted person, sticker or card is a problem', () => {
    const after = upgraded();
    delete after['contacts/ben'];
    delete after['myCard/main'];
    expect(check(after)).toEqual(expect.arrayContaining([{ path: 'contacts/ben', problem: 'deleted' }, { path: 'myCard/main', problem: 'deleted' }]));
  });

  it("enrichment overwriting a value the customer had (title, notes, stickers) is a problem", () => {
    const after = upgraded({ 'contacts/ana': { ...upgraded()['contacts/ana'], title: 'Intern', notes: [], sticker_ids: [] } });
    expect(check(after).map((p) => p.field).sort()).toEqual(['notes', 'sticker_ids', 'title']);
  });

  it('any change to another person, a sticker or the card is a problem', () => {
    const after = upgraded({ 'contacts/ben': { name: 'Ben Okafor', email: 'ben@other' }, 'stickers/s1': { name: 'Renamed' }, 'myCard/main': { headline: 'Changed' } });
    expect(check(after)).toHaveLength(3);
  });

  it('a non-billing change to the account, or an unexpected new document, is reported', () => {
    const after = upgraded({ '': { ...upgraded()[''], displayName: 'Changed' }, 'contacts/new': { name: 'Ghost' } });
    expect(check(after)).toEqual(expect.arrayContaining([
      { path: '(account)', field: 'displayName', problem: 'added outside enrichment' },
      { path: 'contacts/new', problem: 'unexpected new document' },
    ]));
    expect(BILLING_FIELDS.has('credits')).toBe(true);
  });

  it('summarize: pass only with no failure and nothing pending', () => {
    expect(summarize([{ name: 'a', status: 'pass' }]).passed).toBe(true);
    expect(summarize([{ name: 'a', status: 'pass' }, { name: 'b', status: 'pending', detail: 'My Card' }])).toMatchObject({ passed: false, complete: false, failed: 0 });
    expect(summarize([{ name: 'a', status: 'fail' }]).lines[0]).toBe('✗ a');
  });
});

describe('the Apollo stand-in', () => {
  it('answers the four endpoints with made-up records, and nothing else', () => {
    expect(answer('/v1/people/match', { email: 'ana.lopez@e2e.example.test' }).body.person).toMatchObject({ name: 'Ana Lopez', email: 'ana.lopez@e2e.example.test' });
    expect(answer('/v1/mixed_people/api_search', {}).body.people).toHaveLength(3);
    expect(answer('/v1/organizations/enrich', { domain: 'acme.test' }).body.organization.primary_domain).toBe('acme.test');
    expect(answer('/v1/mixed_companies/search', {}).body.organizations).toHaveLength(2);
    expect(answer('/v1/anything', {}).status).toBe(404);
    expect(mockPerson({}).email).toMatch(/example\.test$/);
  });

  it('listens on loopback, records calls, and refuses any key but the mock key', async () => {
    const mock = await startApolloMock({ port: 0 });
    try {
      expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const ok = await fetch(`${mock.url}/v1/people/match`, { method: 'POST', headers: { 'X-Api-Key': APOLLO_MOCK_KEY }, body: JSON.stringify({ first_name: 'Ana', last_name: 'Lopez' }) });
      expect(ok.status).toBe(200);
      const real = await fetch(`${mock.url}/v1/people/match`, { method: 'POST', headers: { 'X-Api-Key': 'a-real-key' }, body: '{}' });
      expect(real.status).toBe(401);
      const { calls } = await (await fetch(`${mock.url}/__calls`)).json();
      expect(calls.map((c) => [c.path, c.mockKey])).toEqual([['/v1/people/match', true], ['/v1/people/match', false]]);
      await fetch(`${mock.url}/__reset`, { method: 'POST' });
      expect((await (await fetch(`${mock.url}/__calls`)).json()).calls).toEqual([]);
    } finally {
      await mock.close();
    }
  });
});

describe('the Apollo override is loopback only', () => {
  it.each([
    ['http://127.0.0.1:8899', 'http://127.0.0.1:8899'],
    ['http://localhost:8899/', 'http://localhost:8899'],
  ])('%s is used', (raw, base) => {
    expect(apolloBaseUrl({ APOLLO_MOCK_URL: raw })).toBe(base);
  });

  it.each(['https://127.0.0.1:8899', 'http://evil.example:80', 'http://127.0.0.1.evil.example', 'http://127.0.0.1:8899/v1', 'garbage'])('%s is ignored: the live API', (raw) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(apolloBaseUrl({ APOLLO_MOCK_URL: raw })).toBe(APOLLO_LIVE_BASE);
  });

  it('unset: the live API, exactly as before', () => {
    expect(apolloBaseUrl({})).toBe('https://api.apollo.io');
  });
});

describe('stagingDev --apollo-mock', () => {
  const credential = { kind: 'key', projectId: 'p', clientEmail: 'c@p.iam.gserviceaccount.com', privateKey: 'k', source: 'test' };
  it('gives the app only the mock key and the loopback URL, never a key from the shell', () => {
    const plan = planDevRun({
      fileEnv: { VITE_FIREBASE_PROJECT_ID: 'p' }, credential, checks: [],
      shellEnv: { APOLLO_API_KEY: 'a-real-key-in-my-shell', PATH: '/bin' }, apolloMockUrl: 'http://127.0.0.1:8899',
    });
    expect(plan.ok).toBe(true);
    expect(plan.childEnv.APOLLO_API_KEY).toBe(APOLLO_MOCK_KEY);
    expect(plan.childEnv.APOLLO_MOCK_URL).toBe('http://127.0.0.1:8899');
  });

  it('without it, no Apollo key reaches the app', () => {
    const plan = planDevRun({ fileEnv: {}, credential, checks: [], shellEnv: { APOLLO_API_KEY: 'a-real-key-in-my-shell' } });
    expect(plan.childEnv.APOLLO_API_KEY).toBeUndefined();
    expect(plan.childEnv.APOLLO_MOCK_URL).toBeUndefined();
  });
});
