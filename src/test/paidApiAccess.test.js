/* global process */
/**
 * Billing Phase 1c: a Free (or lapsed, or unverifiable) account cannot make Idynify pay for Apollo.
 *
 * Every Apollo-backed function is called DIRECTLY, the way anyone with a valid sign-in could call
 * it, with the real handler. The network is a fake that records every request, so "no Apollo
 * call" is observed, not assumed. Accounts are read from a fake Firestore holding what the server
 * holds; nothing the request body says about payment is trusted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: { docs: new Map(), failUserReads: false, customTokens: [] },
}));

// ── A permissive fake Firestore: real reads for seeded documents, writes kept, everything else empty.
function makeFakeDb() {
  let auto = 0;
  const snap = (path) => {
    const data = state.docs.get(path);
    return { exists: data !== undefined, id: path.split('/').at(-1), data: () => data, get: (f) => data?.[f], ref: docRef(path) };
  };
  function docRef(path) {
    return {
      path,
      id: path.split('/').at(-1),
      async get() {
        if (state.failUserReads && /^users\/[^/]+$/.test(path)) throw new Error('firestore unavailable');
        return snap(path);
      },
      async set(data, opts) { state.docs.set(path, opts?.merge ? { ...(state.docs.get(path) ?? {}), ...data } : { ...data }); },
      async update(data) { state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data }); },
      async delete() { state.docs.delete(path); },
      collection: (name) => coll(`${path}/${name}`),
    };
  }
  function coll(path) {
    const depth = path.split('/').length + 1;
    const q = {
      where: () => q, orderBy: () => q, limit: () => q, select: () => q, startAfter: () => q, offset: () => q,
      async get() {
        const docs = [...state.docs.keys()].filter((p) => p.startsWith(`${path}/`) && p.split('/').length === depth).map(snap);
        return { empty: docs.length === 0, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
      },
      doc: (id) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      async add(data) { const ref = docRef(`${path}/auto${++auto}`); await ref.set(data); return ref; },
      async count() { return { get: async () => ({ data: () => ({ count: 0 }) }) }; },
    };
    return q;
  }
  return {
    collection: coll,
    doc: (path) => docRef(path),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete() }); },
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => {
  const tokenUid = (token) => String(token).replace(/^tok:/, '');
  return {
    db: makeFakeDb(),
    admin: {
      auth: () => ({
        verifyIdToken: async (token) => {
          if (!String(token).startsWith('tok:')) throw new Error('bad token');
          return { uid: tokenUid(token) };
        },
        createCustomToken: async (uid) => { state.customTokens.push(uid); return `custom:${uid}`; },
      }),
    },
  };
});

// ── The network. Identity lookups answer for the token's own uid; Apollo is recorded.
let apolloCalls;
let otherCalls;
function fakeFetch(url, init = {}) {
  const u = String(url);
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes('api.apollo.io')) {
    apolloCalls.push(u);
    return json({ people: [], organizations: [], accounts: [], organization: null, person: null, pagination: { total_pages: 1 } });
  }
  otherCalls.push(u);
  if (u.includes('accounts:lookup')) {
    const { idToken } = JSON.parse(init.body || '{}');
    if (!String(idToken).startsWith('tok:')) return json({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
    return json({ users: [{ localId: String(idToken).replace(/^tok:/, '') }] });
  }
  if (u.includes('signInWithCustomToken')) return json({ idToken: 'tok:minted' });
  return json({});
}

const ENV = {
  APOLLO_API_KEY: 'apollo-test-key', FIREBASE_API_KEY: 'web-key', FIREBASE_PROJECT_ID: 'demo-paid-api',
  URL: 'https://idynify.test', CAPTURE_MODE: 'on', ADMIN_USER_IDS: '', SUPER_ADMIN_USER_IDS: '',
};

beforeEach(() => {
  state.docs = new Map();
  state.failUserReads = false;
  state.customTokens = [];
  apolloCalls = [];
  otherCalls = [];
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FREE = 'u_free';
const LAPSED = 'u_lapsed';
const PAID = 'u_paid';
const ADMIN = 'u_admin';
function seedAccounts() {
  state.docs.set(`users/${FREE}`, { email: 'free@example.test', createdAt: 'x' });
  state.docs.set(`users/${LAPSED}`, { email: 'lapsed@example.test', hasCompletedPayment: false, subscriptionStatus: 'canceled', subscriptionTier: 'pro' });
  state.docs.set(`users/${PAID}`, { email: 'paid@example.test', hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active' });
  state.docs.set(`users/${ADMIN}`, { email: 'admin@example.test', role: 'admin' });
}

const post = (body, headers = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://idynify.test', ...headers }, body: JSON.stringify(body) });
const bodyAuth = (uid) => ({ userId: uid, authToken: `tok:${uid}` });

/** Every Apollo-backed endpoint from the Phase 3 audit, with a request each would accept. */
const ENDPOINTS = [
  ['enrichContact', (uid) => post({ ...bodyAuth(uid), contactId: 'apollo_person_1' })],
  ['enrichCompany', (uid) => post({ ...bodyAuth(uid), domain: 'acme.test' })],
  ['searchPeople', (uid) => post({ ...bodyAuth(uid), organizationId: 'org_1', titles: ['CEO'], maxResults: 3 })],
  ['barryEnrich', (uid) => post({ ...bodyAuth(uid), contact: { name: 'Ada Lovelace', company: 'Acme', apollo_person_id: 'p1' } })],
  ['findContact', (uid) => post({ ...bodyAuth(uid), searchParams: { name: 'Ada Lovelace', company: 'Acme' } })],
  ['findContactByLinkedInUrl', (uid) => post({ ...bodyAuth(uid), linkedin_url: 'https://www.linkedin.com/in/ada-lovelace' })],
  ['find-contact-by-email', (uid) => post({ ...bodyAuth(uid), email: 'ada@acme.test' })],
  ['search-companies', (uid) => post({ ...bodyAuth(uid), companyProfile: { industries: ['Computer Software'], companySizes: ['11-50'], locations: ['United States'] }, icpId: 'icp1' })],
  ['search-companies-manual', (uid) => post({ ...bodyAuth(uid), companyName: 'Acme' })],
];

async function call(name, event) {
  const mod = await import(`../../netlify/functions/${name}.js`);
  return mod.handler(event, {});
}

describe.each(ENDPOINTS)('%s', (name, request) => {
  beforeEach(seedAccounts);

  it('a Free account is refused with 402, and Apollo is never called', async () => {
    const res = await call(name, request(FREE));
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('paid_plan_required');
    expect(apolloCalls).toEqual([]);
  });

  it('a lapsed customer (paid access ended) is refused the same way', async () => {
    const res = await call(name, request(LAPSED));
    expect(res.statusCode).toBe(402);
    expect(apolloCalls).toEqual([]);
  });

  it('claims in the request body change nothing: payment is read from the server', async () => {
    const event = request(FREE);
    const body = JSON.parse(event.body);
    event.body = JSON.stringify({ ...body, hasCompletedPayment: true, subscriptionTier: 'pro', role: 'admin', paid: true });
    const res = await call(name, event);
    expect(res.statusCode).toBe(402);
    expect(apolloCalls).toEqual([]);
  });

  it('an account that cannot be read is refused with 503, and Apollo is never called', async () => {
    state.failUserReads = true;
    const res = await call(name, request(PAID));
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe('entitlement_unavailable');
    expect(apolloCalls).toEqual([]);
  });

  it('a token for someone else is refused before any entitlement or Apollo work', async () => {
    const event = request(FREE);
    const body = JSON.parse(event.body);
    event.body = JSON.stringify({ ...body, userId: PAID }); // a free user's token, a paid user's id
    const res = await call(name, event);
    expect(res.statusCode).not.toBe(200);
    expect(apolloCalls).toEqual([]);
  });

  it('a paid account still reaches Apollo', async () => {
    await call(name, request(PAID));
    expect(apolloCalls.length).toBeGreaterThan(0);
  });

  it('an admin working on their own account still reaches Apollo', async () => {
    await call(name, request(ADMIN));
    expect(apolloCalls.length).toBeGreaterThan(0);
  });
});

describe('admin impersonation is preserved (functions that support it)', () => {
  beforeEach(seedAccounts);

  it.each(['enrichContact', 'enrichCompany', 'searchPeople'])('%s: an admin acting for a Free user reaches Apollo', async (name) => {
    const request = ENDPOINTS.find(([n]) => n === name)[1];
    const event = request(FREE);
    event.body = JSON.stringify({ ...JSON.parse(event.body), authToken: `tok:${ADMIN}` });
    await call(name, event);
    expect(apolloCalls.length).toBeGreaterThan(0);
  });

  it('an admin listed in ADMIN_USER_IDS (no role on the document) is an admin too', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'u_envadmin');
    state.docs.set('users/u_envadmin', { email: 'ops@example.test' });
    await call('enrichCompany', ENDPOINTS.find(([n]) => n === 'enrichCompany')[1]('u_envadmin'));
    expect(apolloCalls.length).toBeGreaterThan(0);
  });
});

describe('captureLinkedIn (Relationship Capture)', () => {
  beforeEach(seedAccounts);
  const capture = (uid) => post({ userId: uid, person: { name: 'Ada Lovelace', company: 'Acme' } }, { authorization: `Bearer tok:${uid}` });

  // #822: the Google search is a paid service too, so capture now refuses outright
  // (paidGoogleAccess.test.js checks that no search is made either).
  it('a Free account is refused with 402, and the Apollo lookup is never attempted', async () => {
    const res = await call('captureLinkedIn', capture(FREE));
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('paid_plan_required');
    expect(apolloCalls).toEqual([]);
  });

  it('an unreadable account is refused with 503, and nothing is looked up', async () => {
    state.failUserReads = true;
    const res = await call('captureLinkedIn', capture(PAID));
    expect(res.statusCode).toBe(503);
    expect(apolloCalls).toEqual([]);
  });

  it('a paid account: the Apollo lookup runs', async () => {
    await call('captureLinkedIn', capture(PAID));
    expect(apolloCalls.length).toBe(1);
  });
});

describe('daily-leads-refresh (scheduled)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('DISCOVERY_CRON_ENABLED', 'true');
    seedAccounts();
    for (const uid of [FREE, LAPSED, PAID, ADMIN]) {
      state.docs.set(`users/${uid}/companyProfile/current`, { industries: ['Computer Software'], companySizes: ['11-50'], locations: ['United States'] });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only for accounts with paid access (and admins): Free and lapsed accounts are skipped as not_paid', async () => {
    vi.setSystemTime(new Date(2026, 0, 5, 12)); // Monday in the runner's local timezone
    const { refreshDailyLeads } = await import('../../netlify/functions/daily-leads-refresh.js');
    const res = await refreshDailyLeads({});
    const body = JSON.parse(res.body);

    // Tokens are minted (the first step of a refresh) only for the paid account and the admin.
    expect([...state.customTokens].sort()).toEqual([ADMIN, PAID].sort());
    expect(body.skippedReasons?.not_paid ?? body.results?.skippedReasons?.not_paid).toBe(2);
    // Nothing was requested on behalf of the free or lapsed account: no token, so no ICP read and no search.
    expect(state.customTokens).not.toContain(FREE);
    expect(state.customTokens).not.toContain(LAPSED);
    expect(apolloCalls).toEqual([]); // the refresh itself never calls Apollo; search-companies does, behind its own guard
  });

  it.each([['Saturday', 10], ['Sunday', 11]])('skips the refresh on %s', async (_day, date) => {
    vi.setSystemTime(new Date(2026, 0, date, 12));
    const { refreshDailyLeads } = await import('../../netlify/functions/daily-leads-refresh.js');
    const res = await refreshDailyLeads({});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ success: true, message: 'Weekend - no refresh needed', processedUsers: 0 });
    expect(state.customTokens).toEqual([]);
    expect(apolloCalls).toEqual([]);
    expect(otherCalls).toEqual([]);
  });
});

describe('the decision itself', () => {
  it('uses only server-written fields: paid access, the server-written role, or the server admin lists', async () => {
    const { isPaidApiEligible, isAdminAccount } = await import('../../netlify/functions/utils/paidApiAccess.js');
    const env = { ADMIN_USER_IDS: 'a1', SUPER_ADMIN_USER_IDS: 's1' };
    expect(isPaidApiEligible('u', { hasCompletedPayment: true }, env)).toBe(true);
    expect(isPaidApiEligible('u', { hasCompletedPayment: false, subscriptionStatus: 'active' }, env)).toBe(false);
    expect(isPaidApiEligible('u', null, env)).toBe(false);
    expect(isPaidApiEligible('u', { role: 'super_admin' }, env)).toBe(true);
    expect(isPaidApiEligible('u', { role: 'user' }, env)).toBe(false);
    expect(isAdminAccount('a1', {}, env)).toBe(true);
    expect(isAdminAccount('s1', {}, env)).toBe(true);
    expect(isAdminAccount('', { role: 'admin' }, env)).toBe(false);
  });
});

describe('coverage: every function that calls Apollo is guarded', () => {
  it('each netlify function referencing an Apollo endpoint checks paid access first', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'netlify/functions');
    const callsApollo = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /APOLLO_ENDPOINTS\.|api\.apollo\.io/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(callsApollo.sort()).toEqual(ENDPOINTS.map(([n]) => `${n}.js`).concat('captureLinkedIn.js').sort());
    for (const f of callsApollo) {
      expect(readFileSync(resolve(dir, f), 'utf8'), f).toMatch(/checkPaidApiAccess\(/);
    }
  });

  it('the scheduled refresh filters on paid access before minting a token', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'netlify/functions/daily-leads-refresh.js'), 'utf8');
    expect(src).toMatch(/if \(!user\.paidApi\) \{[\s\S]{0,200}continue;[\s\S]{0,200}mintUserIdToken\(user\.userId\)/);
  });
});
