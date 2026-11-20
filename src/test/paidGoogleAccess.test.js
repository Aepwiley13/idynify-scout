/* global process */
/**
 * #822: an account without paid access cannot make Idynify pay for Google's paid APIs.
 *
 * Three functions call Google directly or through utils/linkedinSearch.js and were not covered
 * by Phase 1c/1d: extractBusinessCard (Vision), retryLinkedInPhoto (Custom Search) and the search
 * half of captureLinkedIn (Custom Search). Each is called DIRECTLY with its real handler, the way
 * anyone with a valid sign-in could call it. The network is a fake that records every request,
 * so "no Google call" is observed, not assumed. Accounts are read from a fake Firestore holding
 * what the server holds; nothing the request body says about payment is trusted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { docs: new Map(), failUserReads: false } }));

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
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete(), create: (r, d) => r.set(d) }); },
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: makeFakeDb(),
  admin: {
    auth: () => ({
      verifyIdToken: async (token) => {
        if (!String(token).startsWith('tok:')) throw new Error('bad token');
        return { uid: String(token).replace(/^tok:/, '') };
      },
    }),
  },
}));

// ── The network. Identity lookups answer for the token's own uid; Google and Apollo are recorded.
let googleCalls;
let apolloCalls;
function fakeFetch(url, init = {}) {
  const u = String(url);
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
  if (/vision\.googleapis\.com|googleapis\.com\/customsearch|maps\.googleapis\.com/.test(u)) {
    googleCalls.push(u.split('?')[0]);
    return json({ items: [], responses: [{}] });
  }
  if (u.includes('api.apollo.io')) {
    apolloCalls.push(u);
    return json({ person: null });
  }
  if (u.includes('accounts:lookup')) {
    const { idToken } = JSON.parse(init.body || '{}');
    if (!String(idToken).startsWith('tok:')) return json({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
    return json({ users: [{ localId: String(idToken).replace(/^tok:/, '') }] });
  }
  return json({});
}

const ENV = {
  APOLLO_API_KEY: 'apollo-test-key', FIREBASE_API_KEY: 'web-key', FIREBASE_PROJECT_ID: 'demo-paid-google',
  URL: 'https://idynify.test', CAPTURE_MODE: 'on', ADMIN_USER_IDS: '', SUPER_ADMIN_USER_IDS: '',
  GOOGLE_VISION_API_KEY: 'vision-test-key', GOOGLE_CUSTOM_SEARCH_API_KEY: 'search-test-key', GOOGLE_CUSTOM_SEARCH_ENGINE_ID: 'cx-test',
};

beforeEach(() => {
  state.docs = new Map();
  state.failUserReads = false;
  googleCalls = [];
  apolloCalls = [];
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
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

/** Each function, with a request it would accept from that user, and the error code its refusal carries. */
const ENDPOINTS = [
  ['extractBusinessCard', (uid) => post({ userId: uid, imageBase64: 'aGVsbG8=' }, { authorization: `Bearer tok:${uid}` }), { 402: 'PAID_PLAN_REQUIRED', 503: 'ENTITLEMENT_UNAVAILABLE' }],
  ['retryLinkedInPhoto', (uid) => post({ userId: uid, authToken: `tok:${uid}`, contactId: 'c1', contactName: 'Ada Lovelace', companyName: 'Acme' }), { 402: 'paid_plan_required', 503: 'entitlement_unavailable' }],
  ['captureLinkedIn', (uid) => post({ userId: uid, person: { name: 'Ada Lovelace', company: 'Acme' } }, { authorization: `Bearer tok:${uid}` }), { 402: 'paid_plan_required', 503: 'unavailable' }],
];

async function call(name, event) {
  const mod = await import(`../../netlify/functions/${name}.js`);
  return mod.handler(event, {});
}
const errorOf = (res) => {
  const body = JSON.parse(res.body);
  return body.code ?? body.error;
};

describe.each(ENDPOINTS)('%s', (name, request, codes) => {
  beforeEach(seedAccounts);

  it('a Free account is refused with 402, and Google is never called', async () => {
    const res = await call(name, request(FREE));
    expect(res.statusCode).toBe(402);
    expect(errorOf(res)).toBe(codes[402]);
    expect(googleCalls).toEqual([]);
    expect(apolloCalls).toEqual([]);
  });

  it('a lapsed customer (paid access ended) is refused the same way', async () => {
    const res = await call(name, request(LAPSED));
    expect(res.statusCode).toBe(402);
    expect(googleCalls).toEqual([]);
  });

  it('claims in the request body change nothing: payment is read from the server', async () => {
    const event = request(FREE);
    event.body = JSON.stringify({ ...JSON.parse(event.body), hasCompletedPayment: true, subscriptionTier: 'pro', role: 'admin', paid: true });
    const res = await call(name, event);
    expect(res.statusCode).toBe(402);
    expect(googleCalls).toEqual([]);
  });

  it('an account that cannot be read is refused with 503, and Google is never called', async () => {
    state.failUserReads = true;
    const res = await call(name, request(PAID));
    expect(res.statusCode).toBe(503);
    expect(errorOf(res)).toBe(codes[503]);
    expect(googleCalls).toEqual([]);
  });

  it('a paid account still reaches Google', async () => {
    await call(name, request(PAID));
    expect(googleCalls.length).toBeGreaterThan(0);
  });

  it('an admin still reaches Google', async () => {
    await call(name, request(ADMIN));
    expect(googleCalls.length).toBeGreaterThan(0);
  });
});

describe('captureLinkedIn: a paid account gets both lookups', () => {
  beforeEach(seedAccounts);
  it('the Apollo match and the Google search both run', async () => {
    await call('captureLinkedIn', ENDPOINTS.find(([n]) => n === 'captureLinkedIn')[1](PAID));
    expect(apolloCalls.length).toBe(1);
    expect(googleCalls.length).toBeGreaterThan(0);
  });
});

describe('coverage: every function that reaches a paid Google API checks paid access', () => {
  it('each netlify function calling Vision, Custom Search or Places, directly or through a helper, has the check', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'netlify/functions');
    const GOOGLE_PAID = /vision\.googleapis\.com|customsearch|maps\.googleapis\.com|GOOGLE_PLACES_API_KEY|GOOGLE_VISION_API_KEY|utils\/linkedinSearch\.js|utils\/googleBusinessLookup\.js/;
    const callsGoogle = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => GOOGLE_PAID.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(callsGoogle.sort()).toEqual(['barryEnrich.js', 'captureLinkedIn.js', 'extractBusinessCard.js', 'retryLinkedInPhoto.js']);
    for (const f of callsGoogle) {
      expect(readFileSync(resolve(dir, f), 'utf8'), f).toMatch(/checkPaidApiAccess\(/);
    }
  });
});
