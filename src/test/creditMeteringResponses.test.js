/* global process */
/**
 * W4: with metering on, each credit-bearing function is charged from ITS OWN real response.
 *
 * The real wrapped handlers run against the Phase 1c harness (fake Firestore with transactions,
 * fake network), with Apollo answering with a match. The charge is read off the account's
 * balance, so a change to a function's response shape that would stop it being charged (or
 * charge it wrongly) fails here. Transactions against a real Firestore are covered by
 * creditTrackingMetering.test.js (emulator).
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

// ── Apollo, answering with matches ─────────────────────────────────────────────────────────────
let apolloCalls;
let apolloMatches = true;
const PERSON = (id) => ({
  id, first_name: 'Ada', last_name: 'Lovelace', name: 'Ada Lovelace', title: 'CEO', email: `${id}@acme.test`,
  linkedin_url: 'https://www.linkedin.com/in/ada-lovelace', organization: { id: 'org_1', name: 'Acme', primary_domain: 'acme.test' },
});
function fakeFetch(url, init = {}) {
  const u = String(url);
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes('api.apollo.io')) {
    apolloCalls.push(u);
    if (!apolloMatches) return json({ person: null, people: [], organizations: [], organization: null, pagination: { total_pages: 1 } });
    if (u.includes('people/match')) {
      const id = JSON.parse(init.body || '{}').id ?? 'p_match';
      return json({ person: PERSON(id) });
    }
    if (u.includes('organizations/enrich')) return json({ organization: { id: 'org_1', name: 'Acme', primary_domain: 'acme.test', estimated_num_employees: 40 } });
    if (u.includes('mixed_people')) return json({ people: [PERSON('c1'), PERSON('c2'), PERSON('c3'), PERSON('c4'), PERSON('c5'), PERSON('c6'), PERSON('c7')], pagination: { total_entries: 7 } });
    return json({ organizations: [{ id: 'org_1', name: 'Acme', primary_domain: 'acme.test' }], accounts: [], pagination: { total_pages: 1 } });
  }
  if (u.includes('accounts:lookup')) {
    const { idToken } = JSON.parse(init.body || '{}');
    if (!String(idToken).startsWith('tok:')) return json({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
    return json({ users: [{ localId: String(idToken).replace(/^tok:/, '') }] });
  }
  return json({});
}

const PAID = 'u_paid';
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://idynify.test', ...headers }, body: JSON.stringify(body) });
const bodyAuth = (uid) => ({ userId: uid, authToken: `tok:${uid}` });

beforeEach(() => {
  state.docs = new Map();
  state.failUserReads = false;
  state.customTokens = [];
  apolloCalls = [];
  apolloMatches = true;
  for (const [k, v] of Object.entries({
    APOLLO_API_KEY: 'apollo-test-key', FIREBASE_API_KEY: 'web-key', FIREBASE_PROJECT_ID: 'demo-credits',
    URL: 'https://idynify.test', CAPTURE_MODE: 'on', ADMIN_USER_IDS: '', SUPER_ADMIN_USER_IDS: '', CREDIT_METERING: 'on',
  })) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  for (const level of ['log', 'warn', 'error', 'info']) vi.spyOn(console, level).mockImplementation(() => {});
  state.docs.set(`users/${PAID}`, {
    email: 'paid@example.test', hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active',
    credits: { total: 100, used: 0, remaining: 100, resetDate: null },
  });
  state.docs.set(`users/${PAID}/contacts/k1`, { name: 'Ada Lovelace', company_name: 'Acme', apollo_person_id: 'p1' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function call(name, event) {
  const mod = await import(`../../netlify/functions/${name}.js`);
  return mod.handler(event, {});
}
const remaining = () => state.docs.get(`users/${PAID}`).credits.remaining;
const ledger = () => [...state.docs.entries()].filter(([p]) => p.startsWith(`users/${PAID}/creditTransactions/`)).map(([, d]) => d);

const CHARGED = [
  ['enrichContact', post({ ...bodyAuth(PAID), contactId: 'apollo_person_1' }), 1],
  ['barryEnrich', post({ ...bodyAuth(PAID), contact: { id: 'k1', name: 'Ada Lovelace', company: 'Acme', apollo_person_id: 'p1' } }), 1],
  ['findContactByLinkedInUrl', post({ ...bodyAuth(PAID), linkedin_url: 'https://www.linkedin.com/in/ada-lovelace' }), 1],
  ['find-contact-by-email', post({ ...bodyAuth(PAID), email: 'ada@acme.test' }), 1],
  ['searchPeople', post({ ...bodyAuth(PAID), organizationId: 'org_1', titles: ['CEO'], maxResults: 50 }), 5],
  // The company (1) and each decision maker it reveals, at most three (3).
  ['enrichCompany', post({ ...bodyAuth(PAID), domain: 'acme.test' }), 4],
  ['captureLinkedIn', post({ userId: PAID, person: { name: 'Ada Lovelace', company: 'Acme' } }, { authorization: `Bearer tok:${PAID}` }), 1],
];

describe.each(CHARGED)('%s, Apollo returns a match', (name, event, credits) => {
  it(`charges ${credits} credit(s), once, from the real response`, async () => {
    const res = await call(name, event);
    expect(res.statusCode).toBe(200);
    expect(100 - remaining()).toBe(credits);
    expect(ledger()).toEqual([expect.objectContaining({ action: name, cost: credits })]);
  });

  it('the same request again within the retry window: the same answer, no Apollo call, no charge', async () => {
    const first = await call(name, event);
    const callsAfterFirst = apolloCalls.length;
    const second = await call(name, event);
    expect(second.body).toBe(first.body);
    expect(apolloCalls.length).toBe(callsAfterFirst);
    expect(100 - remaining()).toBe(credits);
  });
});

describe.each(CHARGED)('%s, Apollo finds nothing', (name, event) => {
  it('charges nothing', async () => {
    apolloMatches = false;
    await call(name, event);
    expect(remaining()).toBe(100);
  });
});

describe('the cap and the limits', () => {
  it('searchPeople never asks Apollo to enrich more than five people, whatever the browser sends', async () => {
    await call('searchPeople', post({ ...bodyAuth(PAID), organizationId: 'org_1', titles: ['CEO'], maxResults: 50 }));
    expect(apolloCalls.filter((u) => u.includes('people/match')).length).toBeLessThanOrEqual(5);
  });

  it('not enough credits: 402 before any Apollo call', async () => {
    state.docs.get(`users/${PAID}`).credits = { total: 100, used: 100, remaining: 0, resetDate: null };
    const res = await call('enrichContact', post({ ...bodyAuth(PAID), contactId: 'apollo_person_1' }));
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'insufficient_credits', remaining: 0, required: 1 });
    expect(apolloCalls).toEqual([]);
  });

  it.each(['findContact', 'search-companies-manual'])('%s costs no credits and counts toward the daily limit', async (name) => {
    vi.stubEnv('CREDIT_DAILY_SEARCH_LIMIT', '2');
    const body = name === 'findContact' ? { searchParams: { name: 'Ada Lovelace', company: 'Acme' } } : { companyName: 'Acme' };
    const req = (n) => post({ ...bodyAuth(PAID), ...body, n });
    expect((await call(name, req(1))).statusCode).toBe(200);
    expect((await call(name, req(2))).statusCode).toBe(200);
    const third = await call(name, req(3));
    expect(third.statusCode).toBe(429);
    expect(JSON.parse(third.body).error).toBe('daily_limit_reached');
    expect(remaining()).toBe(100);
  });

  it('metering off: nothing is charged or recorded (today\'s behaviour)', async () => {
    vi.stubEnv('CREDIT_METERING', '');
    await call('enrichContact', post({ ...bodyAuth(PAID), contactId: 'apollo_person_1' }));
    expect(remaining()).toBe(100);
    expect(ledger()).toEqual([]);
  });

  it('configured rates are used', async () => {
    vi.stubEnv('CREDIT_RATES', JSON.stringify({ person: 3, company: 2 }));
    await call('enrichContact', post({ ...bodyAuth(PAID), contactId: 'apollo_person_1' }));
    expect(100 - remaining()).toBe(3);
  });
});

describe('coverage: every Apollo function is metered', () => {
  it('each netlify function that calls Apollo exports its handler through withCreditMetering', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'netlify/functions');
    const callsApollo = readdirSync(dir).filter((f) => f.endsWith('.js'))
      .filter((f) => /APOLLO_ENDPOINTS\.|api\.apollo\.io/.test(readFileSync(resolve(dir, f), 'utf8')));
    for (const f of callsApollo) {
      const name = f.slice(0, -3);
      expect(readFileSync(resolve(dir, f), 'utf8'), f).toMatch(new RegExp(`^export const handler = withCreditMetering\\(unmeteredHandler, \\{ action: '${name}' \\}\\);$`, 'm'));
    }
    expect(callsApollo.length).toBe(10);
  });
});
