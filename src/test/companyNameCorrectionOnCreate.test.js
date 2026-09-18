/**
 * A guessed company name gets corrected when it is created, not when it is opened.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `ensureCompanyForContact` can create a company whose name it guessed from a
 * work-email domain. `applyCompanyEnrichment` corrects such a name — but the
 * only thing that CALLED it was opening the company's detail page. Until
 * somebody clicked in, the guess was already being read: Saved Companies,
 * exports, and Barry's company context all render the stored name.
 *
 * So creation now fires one un-awaited enrichment for exactly that case. The
 * three properties worth breaking a build over:
 *
 *   1. SCOPE. Only a name this module GUESSED is corrected. A name from Apollo
 *      or typed by a user is authoritative, and a company written before
 *      `name_source` existed carries none at all — enriching those would be a
 *      credit bill with no upside and, for a renamed company, a visible revert.
 *
 *   2. THE WRITE PATH. The correction goes through `applyCompanyEnrichment`,
 *      never a direct `updateDoc` of `name`. That function re-resolves against
 *      newly discovered signals and refuses to write when they reveal a
 *      duplicate; bypassing it re-opens the bug the enrichment PR closed.
 *
 *   3. IT CANNOT BREAK SAVING A CONTACT. The call is not awaited and its
 *      failures are swallowed. If Apollo is down, the contact still saves and
 *      the guess simply stands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let COMPANIES = [];
let WRITES = [];
let FETCH_CALLS = [];

vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { getIdToken: async () => 'token-abc' } },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __collection: path.join('/') }),
  doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  getDoc: async (ref) => {
    const row = COMPANIES.find(r => r.id === ref.id);
    return { exists: () => Boolean(row), id: ref.id, data: () => row };
  },
  getDocs: async (q) => {
    const clause = q.clauses.find(c => c.__where);
    const rows = clause ? COMPANIES.filter(r => r[clause.field] === clause.value) : COMPANIES;
    return { empty: rows.length === 0, docs: rows.map(r => ({ id: r.id, data: () => r })) };
  },
  setDoc: async (ref, data) => {
    WRITES.push({ op: 'set', id: ref.id, data });
    COMPANIES.push({ id: ref.id, ...data });
  },
  updateDoc: async (ref, patch) => {
    WRITES.push({ op: 'update', id: ref.id, data: patch });
    const row = COMPANIES.find(r => r.id === ref.id);
    if (row) Object.assign(row, patch);
  },
}));

const { correctDerivedCompanyName, ensureCompanyForContact } =
  await import('../services/companyIdentityService.js');

const UID = 'user-1';

/** Apollo answers with the organization's real name. */
function apolloReturns(name, extra = {}) {
  return vi.fn(async (_url, init) => {
    FETCH_CALLS.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          snapshot: { name, domain: 'rd-advantage.com', industry: 'Consulting', ...extra },
          _raw: { apolloOrgId: 'apollo-rd', domain: 'rd-advantage.com' },
        },
      }),
    };
  });
}

beforeEach(() => {
  COMPANIES = [];
  WRITES = [];
  FETCH_CALLS = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ─── 1. SCOPE ───────────────────────────────────────────────────────────────
describe('which names get corrected', () => {
  it('corrects a name guessed from a domain', async () => {
    COMPANIES = [{ id: 'c1', name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' }];
    globalThis.fetch = apolloReturns('R&D Advantage');

    await correctDerivedCompanyName(UID, 'c1');

    expect(COMPANIES[0].name).toBe('R&D Advantage');
    expect(COMPANIES[0].name_source).toBe('apollo');
  });

  it('leaves an Apollo-confirmed name alone and spends no call on it', async () => {
    COMPANIES = [{ id: 'c1', name: 'Domo', domain: 'domo.com', name_source: 'apollo' }];
    globalThis.fetch = apolloReturns('Domo Inc');

    await correctDerivedCompanyName(UID, 'c1');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(COMPANIES[0].name).toBe('Domo');
  });

  it('never second-guesses a name the user typed', async () => {
    COMPANIES = [{ id: 'c1', name: 'Acme (Northeast)', domain: 'acme.com', name_source: 'user' }];
    globalThis.fetch = apolloReturns('Acme Corporation');

    await correctDerivedCompanyName(UID, 'c1');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(COMPANIES[0].name).toBe('Acme (Northeast)');
  });

  it('treats an unset name_source as authoritative, not as a guess', async () => {
    // Every company written before the field existed is in this state. Firing
    // on them would be a large, pointless Apollo bill.
    COMPANIES = [{ id: 'c1', name: 'Cotopaxi', domain: 'cotopaxi.com' }];
    globalThis.fetch = apolloReturns('Cotopaxi Inc');

    await correctDerivedCompanyName(UID, 'c1');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('spends no call on a company with neither a domain nor an org id', async () => {
    COMPANIES = [{ id: 'c1', name: 'Some Place', name_source: 'email_domain' }];
    globalThis.fetch = apolloReturns('Some Place LLC');

    await correctDerivedCompanyName(UID, 'c1');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ─── 2. THE WRITE PATH ──────────────────────────────────────────────────────
describe('how the correction is written', () => {
  it('writes the Apollo id under BOTH field names', async () => {
    COMPANIES = [{ id: 'c1', name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' }];
    globalThis.fetch = apolloReturns('R&D Advantage');

    await correctDerivedCompanyName(UID, 'c1');

    expect(COMPANIES[0].apollo_organization_id).toBe('apollo-rd');
    expect(COMPANIES[0].apollo_id).toBe('apollo-rd');
  });

  it('refuses to write when the discovered id reveals an existing duplicate', async () => {
    // The whole reason this may not be a bare updateDoc.
    COMPANIES = [
      { id: 'c1', name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' },
      { id: 'c_existing', name: 'R&D Advantage', apollo_organization_id: 'apollo-rd' },
    ];
    globalThis.fetch = apolloReturns('R&D Advantage');

    const result = await correctDerivedCompanyName(UID, 'c1');

    expect(result.action).toBe('merged');
    expect(result.into).toBe('c_existing');
    expect(COMPANIES.find(r => r.id === 'c1').name).toBe('Rd Advantage');
  });

  it('sends the domain Apollo needs, and an auth token', async () => {
    COMPANIES = [{ id: 'c1', name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' }];
    globalThis.fetch = apolloReturns('R&D Advantage');

    await correctDerivedCompanyName(UID, 'c1');

    expect(FETCH_CALLS[0]).toMatchObject({ userId: UID, authToken: 'token-abc', domain: 'rd-advantage.com' });
  });

  it('caches the enrichment so opening the company does not pay for it again', async () => {
    COMPANIES = [{ id: 'c1', name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' }];
    globalThis.fetch = apolloReturns('R&D Advantage');

    await correctDerivedCompanyName(UID, 'c1');

    expect(COMPANIES[0].apolloEnriched).toBe(true);
    expect(COMPANIES[0].apolloEnrichedAt).toEqual(expect.any(Number));
    expect(COMPANIES[0].apolloEnrichment).toBeTruthy();
  });
});

// ─── 3. IT CANNOT BREAK SAVING A CONTACT ────────────────────────────────────
describe('failure is contained', () => {
  it('still creates the company when the enrichment call fails outright', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });

    const result = await ensureCompanyForContact(UID, {
      email: 'dave@rd-advantage.com', first_name: 'Dave',
    }, { source: 'manual' });

    expect(result.created).toBe(true);
    expect(result.companyId).toBeTruthy();
    // The guess stands — which is exactly where the caller would have been.
    expect(COMPANIES.find(r => r.id === result.companyId).name).toBe('Rd Advantage');
  });

  it('does not reject the contact save when Apollo returns an error status', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));

    await expect(ensureCompanyForContact(UID, {
      email: 'dave@rd-advantage.com', first_name: 'Dave',
    }, { source: 'manual' })).resolves.toMatchObject({ created: true });
  });

  it('fires no correction when the contact brought a real company name', async () => {
    globalThis.fetch = apolloReturns('Should Not Be Called');

    await ensureCompanyForContact(UID, {
      email: 'dave@rd-advantage.com', company_name: 'R&D Advantage',
    }, { source: 'manual', nameSource: 'user' });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
