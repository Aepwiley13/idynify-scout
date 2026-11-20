/**
 * W6: the parts of the Free → Scout end-to-end test that can be checked without a browser,
 * Stripe or staging: its arguments and refusals, which requests count as paid, the account
 * comparison that proves nothing was lost, the local Apollo stand-in, the loopback-only Apollo
 * override, and stagingDev's --apollo-mock plan. The journey itself runs on the staging machine
 * (scripts/staging/e2e/freeToScout.mjs; docs/billing/STAGING_VALIDATION_RUNBOOK.md Part 9).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseE2eArgs, JourneyRefusal, FIVE_PEOPLE_CSV, isPaidRequest, functionName, compareAccount, summarize, BILLING_FIELDS,
  stickerStepPlan, callsSince, verifyProUpgrade, appRecordsAdded, APP_RECORD_COLLECTIONS,
} from '../../scripts/staging/e2e/journey.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
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

describe('functionName (for the report of functions not served)', () => {
  it('reads the function from its URL', () => {
    expect(functionName('http://localhost:8888/.netlify/functions/change-plan')).toBe('change-plan');
    expect(functionName('http://localhost:8888/.netlify/functions/barryEnrich?x=1')).toBe('barryEnrich');
    expect(functionName('http://localhost:8888/contact-hub')).toBeNull();
    expect(functionName('not a url')).toBeNull();
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

describe('fix 1: the sticker part (step 4b) follows the server\'s own answer', () => {
  it('stickers offered: the sticker is added, and a failure there is a real FAIL', () => {
    expect(stickerStepPlan({ status: 200, body: { enabled: true, mode: 'on', readOnly: false } })).toEqual({ action: 'do' });
  });

  it('stickers not offered on staging: PENDING, never a pass, and the reason names the setting', () => {
    const plan = stickerStepPlan({ status: 200, body: { enabled: false, mode: 'beta', readOnly: false } });
    expect(plan.action).toBe('pending');
    expect(plan.reason).toContain('mode beta');
    expect(plan.reason).toContain('the note was still checked');
  });

  it('no answer, an error, a malformed answer or a read-only answer: FAIL (unknown is not pending)', () => {
    expect(stickerStepPlan(null).action).toBe('fail');
    expect(stickerStepPlan({ status: 500, body: { error: 'internal_error' } })).toEqual({ action: 'fail', reason: 'stickersConfig answered 500.' });
    expect(stickerStepPlan({ status: 200, body: {} }).action).toBe('fail');
    expect(stickerStepPlan({ status: 200, body: null }).action).toBe('fail');
    expect(stickerStepPlan({ status: 200, body: { enabled: true, readOnly: true } }).action).toBe('fail');
  });
});

describe('PASS, FAIL and INCOMPLETE are distinct', () => {
  const pass = (name) => ({ name, status: 'pass' });
  it('PASS only when every step ran and passed', () => {
    const r = summarize([pass('1'), pass('4'), pass('4b'), pass('10'), pass('10b')]);
    expect(r).toMatchObject({ verdict: 'PASS', passed: true, complete: true, failed: 0, pending: [] });
    expect(r.result).toBe('Result: PASS — every step ran and passed.');
  });

  it('a pending sticker part makes the run INCOMPLETE, not a pass, even when everything else passed', () => {
    const r = summarize([pass('1'), pass('4'), { name: '4b. Organize: a sticker on the same person', status: 'pending', detail: 'not offered' }, pass('10'), pass('10b')]);
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.passed).toBe(false);
    expect(r.result).toContain('not a pass');
    expect(r.result).toContain('4b. Organize: a sticker');
    expect(r.lines[2]).toBe('… 4b. Organize: a sticker on the same person — not offered');
  });

  it('a failure wins over pending, and says where the journey stopped', () => {
    const r = summarize([pass('1'), { name: '2. My Card', status: 'pending' }, { name: '9. Nothing lost', status: 'fail', detail: 'contacts/ben: deleted' }]);
    expect(r).toMatchObject({ verdict: 'FAIL', passed: false, failed: 1 });
    expect(r.result).toBe('Result: FAIL — stopped at "9. Nothing lost"; the steps after it did not run.');
  });
});

describe('fix 2: the app\'s own Barry records are expected; everything else stays strict', () => {
  const BEFORE = {
    '': { email: 'a@e2e.example.test' },
    'contacts/ana': { name: 'Ana Lopez', notes: [{ id: 'n1', text: 'Met' }], sticker_ids: ['s1'] },
    'contacts/ben': { name: 'Ben Okafor' },
    'stickers/s1': { name: 'Friends' },
  };
  const after = (extra = {}) => ({ ...structuredClone(BEFORE), ...extra });

  it('a Barry session and conversation created after the upgrade are allowed, and listed for the report', () => {
    const a = after({ 'barry_sessions/7f2c': { module: 'mission-control', messages: [] }, 'barryConversations/missionControl': { mode: 'brief' } });
    expect(compareAccount(BEFORE, a, { enrichedContactPath: 'contacts/ana' })).toEqual([]);
    expect(appRecordsAdded(BEFORE, a)).toEqual(['barryConversations/missionControl', 'barry_sessions/7f2c']);
    expect([...APP_RECORD_COLLECTIONS].sort()).toEqual(['barryConversations', 'barry_sessions']);
  });

  it('still fails on any other new document, any deletion, and any change to customer data', () => {
    const a = after({ 'barry_sessions/7f2c': { m: 1 }, 'contacts/ghost': { name: 'Ghost' }, 'barryNotes/x': { a: 1 } });
    delete a['stickers/s1'];
    a['contacts/ben'] = { name: 'Ben Changed' };
    a['contacts/ana'] = { ...a['contacts/ana'], notes: [] };
    const problems = compareAccount(BEFORE, a, { enrichedContactPath: 'contacts/ana' });
    expect(problems).toEqual(expect.arrayContaining([
      { path: 'contacts/ghost', problem: 'unexpected new document' },
      { path: 'barryNotes/x', problem: 'unexpected new document' },
      { path: 'stickers/s1', problem: 'deleted' },
      { path: 'contacts/ben', field: 'name', problem: 'changed' },
      { path: 'contacts/ana', field: 'notes', problem: 'changed' },
    ]));
    expect(problems).toHaveLength(5);
  });

  it('a Barry record that existed before may not disappear', () => {
    const withSession = { ...BEFORE, 'barry_sessions/old': { m: 1 } };
    const a = structuredClone(withSession);
    delete a['barry_sessions/old'];
    expect(compareAccount(withSession, a)).toEqual([{ path: 'barry_sessions/old', problem: 'deleted' }]);
  });
});

describe('fix 3: the Pro upgrade is checked in full', () => {
  const SUB = 'sub_1', STARTER = 'price_starter', PRO = 'price_pro';
  const starter = { subscriptionId: SUB, price: STARTER, creditsTotal: 400 };
  const good = () => ({
    plan: 'pro',
    account: { subscriptionTier: 'pro', subscriptionStatus: 'active', stripeSubscriptionId: SUB, credits: { total: 1250, used: 0, remaining: 1250 } },
    grants: [
      { subscription: SUB, kind: 'checkout', priceId: STARTER, credits: null },
      { subscription: `${SUB}__plan__${PRO}__1`, kind: 'plan_change', priceId: PRO, credits: 850 },
    ],
    stripe: { subscriptions: [{ id: SUB, status: 'active', price: PRO }] },
    checks: [{ id: 'one-live-subscription', ok: true }, { id: 'plan-credits', ok: true }, { id: 'granted-once', ok: true }],
  });
  const broken = (fn) => { const s = good(); fn(s); return verifyProUpgrade({ starter, summary: s }); };

  it('same subscription, active on Pro, 1,250 credits, one 400 checkout grant, one 850 plan-change grant, all checks: no problems', () => {
    expect(verifyProUpgrade({ starter, summary: good() })).toEqual([]);
  });

  it.each([
    ['a second subscription on the account', (s) => { s.account.stripeSubscriptionId = 'sub_2'; }, 'a second subscription'],
    ['two live subscriptions in Stripe', (s) => { s.stripe.subscriptions.push({ id: 'sub_2', status: 'active', price: PRO }); }, 'not exactly one'],
    ['the subscription not active', (s) => { s.stripe.subscriptions[0].status = 'past_due'; }, 'not active'],
    ['still on the Starter price', (s) => { s.stripe.subscriptions[0].price = STARTER; }, 'still on the Starter price'],
    ['the account not on Pro', (s) => { s.plan = 'starter'; s.account.subscriptionTier = 'starter'; }, 'not pro'],
    ['credits other than 1,250', (s) => { s.account.credits.total = 1249; }, 'Credits total 1249'],
    ['no plan-change grant', (s) => { s.grants.pop(); }, '0 plan-change grants'],
    ['two plan-change grants', (s) => { s.grants.push({ ...s.grants[1], subscription: 'x' }); }, '2 plan-change grants'],
    ['a plan-change grant of the wrong size', (s) => { s.grants[1].credits = 800; }, 'not 850'],
    ['a plan-change grant for another price', (s) => { s.grants[1].priceId = 'price_other'; }, 'not for the Pro price'],
    ['no checkout grant', (s) => { s.grants.shift(); }, '0 checkout grants'],
    ['a checkout grant for another price', (s) => { s.grants[0].priceId = 'price_other'; }, 'not the 400-credit Starter grant'],
    ['an extra grant', (s) => { s.grants.push({ subscription: 'r', kind: 'renewal', credits: 1250 }); }, 'Unexpected grants: renewal'],
    ['a failing billing check', (s) => { s.checks[1].ok = false; }, 'Billing checks failing: plan-credits'],
  ])('%s is a problem', (_, change, message) => {
    expect(broken(change).join(' ')).toContain(message);
  });

  it('Starter must have shown 400 credits before the upgrade', () => {
    expect(verifyProUpgrade({ starter: { ...starter, creditsTotal: 399 }, summary: good() }).join(' ')).toContain('not 400');
  });
});

describe('the shared Apollo stand-in log is never cleared', () => {
  it('callsSince keeps only the calls after the journey started', () => {
    const calls = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
    expect(callsSince(calls, 2)).toEqual([{ path: 'c' }]);
    expect(callsSince(calls, 3)).toEqual([]);
    expect(callsSince(calls, 0)).toEqual(calls);
    expect(callsSince(calls, -1)).toEqual(calls);
  });

  it('the journey reads the log and never resets it; steps 4b and 10b are wired to the checks above', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/staging/e2e/freeToScout.mjs'), 'utf8');
    expect(source).not.toContain('__reset');
    expect(source).toContain('stickerStepPlan(stickerAnswer)');
    expect(source).toContain('verifyProUpgrade({ starter, summary })');
    expect(source).toContain("step('10b. Nothing the customer made was lost or changed, after Pro'");
    expect(source).toContain('summary.result');
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
