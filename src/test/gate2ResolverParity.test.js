/**
 * GATE 2 PHASE 1 — resolver parity, browser vs server.
 *
 * THIS IS THE PHASE 1 ACCEPTANCE GATE.
 *
 * The whole point of extracting src/utils/identityResolution.js was to avoid a
 * second implementation of "have I already got this person?". Two resolvers
 * means two answers, and the one that is wrong creates the duplicate. The
 * extraction only delivers that guarantee if the two ADAPTERS agree — a
 * `snap.exists` that is a property on one SDK and a method on the other is
 * exactly the kind of difference that produces a silent divergence.
 *
 * So every case below runs the same candidate against the same corpus through
 * BOTH adapters and asserts DEEP EQUALITY of the entire result object — not
 * just contactId. Signal, outcome, requiresReview and the candidate list are
 * all part of the contract, and a divergence in any of them is a bug.
 *
 * Both adapters are driven by fakes over one shared table, so the only thing
 * that can differ is the adapter code itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

// ── One shared table, two fake SDKs ─────────────────────────────────────────

let TABLE = [];
/** Field name → how many equality queries hit it. Proves hierarchy ORDER. */
let WEB_QUERIES = [];
let ADMIN_QUERIES = [];
/** Field to make throw, for the fail-closed assertions. */
let FAIL_FIELD = null;
let FAIL_SCAN = false;

const rowsWhere = (field, value) => TABLE.filter(r => r[field] === value);

// ── Web SDK fake — mirrors src/test/contactIdentityService.test.js ──────────

vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (...path) => ({ __collection: path.slice(1).join('/') }),
  doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: true, n }),
  getDoc: async (ref) => {
    const id = ref.id;
    const row = TABLE.find(r => r.id === id);
    return { exists: () => Boolean(row), id, data: () => ({ ...row }) };
  },
  getDocs: async (q) => {
    const w = q.clauses.find(c => c.__where);
    const l = q.clauses.find(c => c.__limit);
    if (w) {
      WEB_QUERIES.push(w.field);
      if (FAIL_FIELD && w.field === FAIL_FIELD) throw new Error('permission-denied');
      const rows = rowsWhere(w.field, w.value).slice(0, l?.n ?? 5);
      return { empty: rows.length === 0, docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })) };
    }
    // Bare limit() — the scan window.
    if (FAIL_SCAN) throw new Error('scan-failed');
    WEB_QUERIES.push('__scan__');
    const rows = TABLE.slice(0, l?.n ?? TABLE.length);
    return { empty: rows.length === 0, docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })) };
  },
}));

// ── Admin SDK fake — the chained firebase-admin shape ───────────────────────

function makeAdminDb() {
  const snapOf = (rows) => ({
    empty: rows.length === 0,
    docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })),
  });

  const makeQuery = (filters = [], cap = null) => ({
    where(field, _op, value) {
      return makeQuery([...filters, { field, value }], cap);
    },
    limit(n) {
      return makeQuery(filters, n);
    },
    doc(id) {
      return {
        async get() {
          const row = TABLE.find(r => r.id === id);
          return { exists: Boolean(row), id, data: () => ({ ...row }) };
        },
      };
    },
    async get() {
      if (filters.length > 0) {
        const f = filters[0];
        ADMIN_QUERIES.push(f.field);
        if (FAIL_FIELD && f.field === FAIL_FIELD) throw new Error('permission-denied');
        return snapOf(rowsWhere(f.field, f.value).slice(0, cap ?? 5));
      }
      if (FAIL_SCAN) throw new Error('scan-failed');
      ADMIN_QUERIES.push('__scan__');
      return snapOf(TABLE.slice(0, cap ?? TABLE.length));
    },
  });

  return {
    collection: () => ({ doc: () => ({ collection: () => makeQuery() }) }),
  };
}

// Imported after the mocks are registered.
const { resolveContact: resolveWeb, createWebAdapter } = await import('../services/contactIdentityService.js');
const { resolveContact: resolveAdmin, createAdminAdapter } = await import('../../netlify/functions/utils/contactResolver.js');
const { clearResolutionLog, getResolutionLog, RESOLUTION } = await import('../utils/identityResolution.js');

const UID = 'u_test';

/**
 * Run one candidate through both adapters and assert they agree.
 * Returns the (identical) result so a case can make further assertions.
 */
async function bothAgree(candidate, { userId = UID } = {}) {
  WEB_QUERIES = [];
  ADMIN_QUERIES = [];
  clearResolutionLog();
  const web = await resolveWeb(userId, candidate, { source: 'parity.web' });

  WEB_QUERIES = [];
  ADMIN_QUERIES = [];
  clearResolutionLog();
  const admin = await resolveAdmin(makeAdminDb(), userId, candidate, { source: 'parity.admin' });

  expect(admin).toEqual(web);
  return web;
}

// ── The corpus ──────────────────────────────────────────────────────────────

const CORPUS = [
  // Written since the canonical-identity sprint — carries normalized fields.
  { id: 'c_norm', name: 'Dana Whitfield', company_name: 'Acme Roofing',
    email: 'Dana@Acme.com', email_normalized: 'dana@acme.com' },

  // Raw email already lowercase — matched by the second equality rung.
  { id: 'c_lower', name: 'Mo Chen', company_name: 'Northwind', email: 'mo@northwind.com' },

  // Legacy mixed-case email, no normalized field — reachable only by scan.
  { id: 'c_mixed', name: 'Pat Rivera', company_name: 'Globex', email: 'Pat.Rivera@Globex.com' },

  { id: 'c_apollo', name: 'Sam Okafor', company_name: 'Initech', apollo_person_id: 'ap_777' },

  { id: 'c_li_norm', name: 'Jo Kim', company_name: 'Umbrella',
    linkedin_url: 'https://www.linkedin.com/in/jo-kim/', linkedin_url_normalized: 'linkedin.com/in/jo-kim' },

  // Legacy LinkedIn, no normalized field — reachable only by scan.
  { id: 'c_li_raw', name: 'Ali Nasser', company_name: 'Hooli',
    linkedin_url: 'https://www.linkedin.com/in/ali-nasser/?trk=nav' },

  { id: 'c_ph_norm', name: 'Rae Lindqvist', company_name: 'Vandelay',
    phone: '(415) 555-0100', phone_normalized: '4155550100' },

  { id: 'c_ph_raw', name: 'Kit Boateng', company_name: 'Soylent', phone: '4155550199' },

  // Two people, one name, one company — hierarchy step 6's whole reason.
  { id: 'c_twin_a', name: 'Sarah Johnson', company_name: 'Acme Roofing' },
  { id: 'c_twin_b', name: 'sarah  johnson', company_name: 'acme roofing' },
];

beforeEach(() => {
  TABLE = CORPUS.map(r => ({ ...r }));
  WEB_QUERIES = [];
  ADMIN_QUERIES = [];
  FAIL_FIELD = null;
  FAIL_SCAN = false;
  clearResolutionLog();
});

// ── 1. Every hierarchy rung, both runtimes ──────────────────────────────────

describe('1 — the two adapters agree on every hierarchy rung', () => {
  it('step 1 — an existing Firestore id is decisive', async () => {
    const r = await bothAgree({ contactId: 'c_apollo', name: 'Someone Else' });
    expect(r.outcome).toBe(RESOLUTION.MATCHED);
    expect(r.signal).toBe('firestore_id');
    expect(r.contactId).toBe('c_apollo');
  });

  it('step 1 — an id that does not exist falls through rather than matching', async () => {
    const r = await bothAgree({ contactId: 'c_ghost', email: 'dana@acme.com' });
    expect(r.signal).toBe('email');
    expect(r.contactId).toBe('c_norm');
  });

  it('step 2 — email via the normalized field', async () => {
    const r = await bothAgree({ email: 'DANA@ACME.COM' });
    expect(r.signal).toBe('email');
    expect(r.contactId).toBe('c_norm');
  });

  it('step 2 — email via the raw field when it is already lowercase', async () => {
    const r = await bothAgree({ email: '  MO@NORTHWIND.COM ' });
    expect(r.signal).toBe('email');
    expect(r.contactId).toBe('c_lower');
  });

  it('step 2 — legacy mixed-case email, reachable only through the scan', async () => {
    const r = await bothAgree({ email: 'pat.rivera@globex.com' });
    expect(r.signal).toBe('email');
    expect(r.contactId).toBe('c_mixed');
  });

  it('step 3 — Apollo person id', async () => {
    const r = await bothAgree({ apollo_person_id: 'ap_777' });
    expect(r.signal).toBe('apollo_person_id');
    expect(r.contactId).toBe('c_apollo');
  });

  it('step 4 — LinkedIn via the normalized field, across scheme and slash', async () => {
    const r = await bothAgree({ linkedin_url: 'http://linkedin.com/in/jo-kim' });
    expect(r.signal).toBe('linkedin_url');
    expect(r.contactId).toBe('c_li_norm');
  });

  it('step 4 — legacy LinkedIn, reachable only through the scan', async () => {
    const r = await bothAgree({ linkedin_url: 'linkedin.com/in/ali-nasser' });
    expect(r.signal).toBe('linkedin_url');
    expect(r.contactId).toBe('c_li_raw');
  });

  it('step 5 — phone via the normalized field, across three formats', async () => {
    const r = await bothAgree({ phone: '415-555-0100' });
    expect(r.signal).toBe('phone');
    expect(r.contactId).toBe('c_ph_norm');
  });

  it('step 5 — legacy phone, reachable only through the scan', async () => {
    const r = await bothAgree({ phone: '(415) 555-0199' });
    expect(r.signal).toBe('phone');
    expect(r.contactId).toBe('c_ph_raw');
  });

  it('step 6 — name + company FLAGS and returns every candidate, never picks', async () => {
    const r = await bothAgree({ name: 'Sarah Johnson', company_name: 'Acme Roofing' });
    expect(r.outcome).toBe(RESOLUTION.REVIEW);
    expect(r.signal).toBe('name_company');
    expect(r.requiresReview).toBe(true);
    expect(r.contactId).toBeNull();
    expect(r.candidates.map(c => c.id).sort()).toEqual(['c_twin_a', 'c_twin_b']);
  });

  it('a lone name with no company matches nothing', async () => {
    const r = await bothAgree({ name: 'Sarah Johnson' });
    expect(r.outcome).toBe(RESOLUTION.NEW);
  });

  it('nothing matched — new', async () => {
    const r = await bothAgree({ email: 'nobody@elsewhere.com', name: 'Nobody' });
    expect(r.outcome).toBe(RESOLUTION.NEW);
    expect(r.contactId).toBeNull();
    expect(r.signal).toBeNull();
  });

  it('an empty candidate is new, not a crash', async () => {
    const r = await bothAgree({});
    expect(r.outcome).toBe(RESOLUTION.NEW);
  });

  it('no workspace resolves to new, identically on both', async () => {
    const r = await bothAgree({ email: 'dana@acme.com' }, { userId: null });
    expect(r.outcome).toBe(RESOLUTION.NEW);
  });
});

// ── 2. Hierarchy ORDER, not just outcome ────────────────────────────────────

describe('2 — precedence holds, and both runtimes query in the same order', () => {
  it('email outranks Apollo id when a candidate carries both', async () => {
    const r = await bothAgree({ email: 'dana@acme.com', apollo_person_id: 'ap_777' });
    expect(r.signal).toBe('email');
    expect(r.contactId).toBe('c_norm');
  });

  it('Apollo id outranks LinkedIn', async () => {
    const r = await bothAgree({ apollo_person_id: 'ap_777', linkedin_url: 'linkedin.com/in/jo-kim' });
    expect(r.signal).toBe('apollo_person_id');
  });

  it('LinkedIn outranks phone', async () => {
    const r = await bothAgree({ linkedin_url: 'linkedin.com/in/jo-kim', phone: '4155550100' });
    expect(r.signal).toBe('linkedin_url');
  });

  it('any exact signal outranks name + company', async () => {
    const r = await bothAgree({
      name: 'Sarah Johnson', company_name: 'Acme Roofing', apollo_person_id: 'ap_777',
    });
    expect(r.outcome).toBe(RESOLUTION.MATCHED);
    expect(r.requiresReview).toBe(false);
  });

  it('both adapters issue the same queries, in the same order', async () => {
    WEB_QUERIES = [];
    await resolveWeb(UID, { phone: '4155550199' }, { source: 'order.web' });
    const webOrder = [...WEB_QUERIES];

    ADMIN_QUERIES = [];
    await resolveAdmin(makeAdminDb(), UID, { phone: '4155550199' }, { source: 'order.admin' });

    expect(ADMIN_QUERIES).toEqual(webOrder);
  });

  it('an exact hit never pays for the scan window', async () => {
    WEB_QUERIES = [];
    await resolveWeb(UID, { apollo_person_id: 'ap_777' }, { source: 'lazy.web' });
    expect(WEB_QUERIES).not.toContain('__scan__');

    ADMIN_QUERIES = [];
    await resolveAdmin(makeAdminDb(), UID, { apollo_person_id: 'ap_777' }, { source: 'lazy.admin' });
    expect(ADMIN_QUERIES).not.toContain('__scan__');
  });
});

// ── 3. Fail-closed / fail-open, identically ─────────────────────────────────

describe('3 — the failure asymmetry is preserved in both runtimes', () => {
  it('a failed equality query RETHROWS — it must never read as "no duplicate"', async () => {
    FAIL_FIELD = 'apollo_person_id';
    await expect(resolveWeb(UID, { apollo_person_id: 'ap_777' }, { source: 'x' })).rejects.toThrow();
    await expect(
      resolveAdmin(makeAdminDb(), UID, { apollo_person_id: 'ap_777' }, { source: 'x' }),
    ).rejects.toThrow();
  });

  it('a failed scan DEGRADES to no-match rather than blocking the save', async () => {
    FAIL_SCAN = true;
    const web = await resolveWeb(UID, { name: 'Sarah Johnson', company_name: 'Acme Roofing' }, { source: 'x' });
    const admin = await resolveAdmin(
      makeAdminDb(), UID, { name: 'Sarah Johnson', company_name: 'Acme Roofing' }, { source: 'x' },
    );
    expect(web.outcome).toBe(RESOLUTION.NEW);
    expect(admin).toEqual(web);
  });
});

// ── 4. The shared scan cache — the Phase 2a prerequisite ────────────────────

describe('4 — one adapter, one scan window', () => {
  it('web: a shared adapter loads the scan window once across many candidates', async () => {
    const adapter = createWebAdapter(UID);
    WEB_QUERIES = [];
    for (const name of ['A One', 'B Two', 'C Three']) {
      await resolveWeb(UID, { name, company_name: 'Nowhere' }, { source: 'batch', adapter });
    }
    expect(WEB_QUERIES.filter(q => q === '__scan__')).toHaveLength(1);
  });

  it('server: a shared adapter loads the scan window once across many candidates', async () => {
    const db = makeAdminDb();
    const adapter = createAdminAdapter(db, UID);
    ADMIN_QUERIES = [];
    for (const name of ['A One', 'B Two', 'C Three']) {
      await resolveAdmin(db, UID, { name, company_name: 'Nowhere' }, { source: 'batch', adapter });
    }
    expect(ADMIN_QUERIES.filter(q => q === '__scan__')).toHaveLength(1);
  });

  it('without a shared adapter each resolution pays for its own window', async () => {
    // Documents the behaviour Phase 2a exists to fix, so a regression that
    // silently removes the sharing shows up as a failing expectation here.
    WEB_QUERIES = [];
    for (const name of ['A One', 'B Two', 'C Three']) {
      await resolveWeb(UID, { name, company_name: 'Nowhere' }, { source: 'unbatched' });
    }
    expect(WEB_QUERIES.filter(q => q === '__scan__')).toHaveLength(3);
  });

  it('a shared adapter still returns per-candidate answers, not a cached one', async () => {
    const adapter = createWebAdapter(UID);
    const a = await resolveWeb(UID, { name: 'Sarah Johnson', company_name: 'Acme Roofing' }, { source: 'b', adapter });
    const b = await resolveWeb(UID, { name: 'Nobody At All', company_name: 'Nowhere' }, { source: 'b', adapter });
    expect(a.outcome).toBe(RESOLUTION.REVIEW);
    expect(b.outcome).toBe(RESOLUTION.NEW);
  });
});

// ── 5. Logging survives the extraction ──────────────────────────────────────

describe('5 — every decision is still logged', () => {
  it('logs a match, a review and a new the same way from both runtimes', async () => {
    for (const candidate of [
      { apollo_person_id: 'ap_777' },
      { name: 'Sarah Johnson', company_name: 'Acme Roofing' },
      { email: 'nobody@elsewhere.com' },
    ]) {
      clearResolutionLog();
      await resolveWeb(UID, candidate, { source: 'log.web' });
      const web = getResolutionLog().map(e => e.outcome);

      clearResolutionLog();
      await resolveAdmin(makeAdminDb(), UID, candidate, { source: 'log.admin' });
      const admin = getResolutionLog().map(e => e.outcome);

      expect(admin).toEqual(web);
      expect(web).toHaveLength(1);
    }
  });
});

// ── 6. The structural guarantee ─────────────────────────────────────────────

describe('6 — one engine, and it cannot quietly become two', () => {
  it('the decision engine imports no SDK', () => {
    const src = read('../utils/identityResolution.js');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"]firebase/);
    expect(code).not.toMatch(/from\s+['"]firebase-admin/);
    expect(code).not.toMatch(/require\(\s*['"]firebase/);
  });

  it('both adapters delegate to the same module', () => {
    expect(read('../services/contactIdentityService.js')).toContain('identityResolution');
    expect(read('../../netlify/functions/utils/contactResolver.js'))
      .toContain('../../../src/utils/identityResolution.js');
  });

  it('neither adapter contains a match rule of its own', () => {
    // The hierarchy field names must appear in the engine and NOT in the
    // adapters — an adapter that starts naming signals is a second resolver
    // being born.
    for (const rel of ['../services/contactIdentityService.js',
                       '../../netlify/functions/utils/contactResolver.js']) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${rel} must not decide identity`).not.toContain('name_company');
      expect(code, `${rel} must not decide identity`).not.toContain('RESOLUTION.MATCHED');
    }
  });
});
