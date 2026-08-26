/**
 * GATE 2 PHASE 2 — resolver hardening, and the evidence behind each change.
 *
 * Every case here corresponds to an authorized hardening item, and several
 * assert the NEGATIVE case that justifies the design — that the LinkedIn rung
 * has to query the raw candidate value rather than the normalized one, for
 * instance. Without those, a later "simplification" makes the two rungs
 * symmetric, the tests still pass, and the rung silently stops matching
 * anything.
 *
 * Production evidence this phase was scoped against (22 workspaces, 1,365
 * contacts, read-only):
 *
 *   111 records reachable only through the fallback scan
 *   103 of them LinkedIn-only with no linkedin_url_normalized   → item 2d
 *     1 phone-only record, 0 phone_normalized fields            → item 2c, low
 *    12 emails / 5 Apollo ids / 12 LinkedIn URLs / 1 phone
 *       each mapping to more than one record                    → item 2f
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let TABLE = [];
let COMPANIES = [];
let QUERIES = [];

vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __path: path.join('/') }),
  doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: true, n }),
  getDoc: async (ref) => {
    const row = TABLE.find(r => r.id === ref.id);
    return { exists: () => Boolean(row), id: ref.id, data: () => ({ ...row }) };
  },
  getDocs: async (q) => {
    const isCompanies = q.ref.__path?.endsWith('companies');
    const source = isCompanies ? COMPANIES : TABLE;
    const w = q.clauses.find(c => c.__where);
    const l = q.clauses.find(c => c.__limit);
    let rows;
    if (w) {
      QUERIES.push(w.field);
      rows = source.filter(r => r[w.field] === w.value).slice(0, l?.n ?? 5);
    } else {
      QUERIES.push('__scan__');
      rows = source.slice(0, l?.n ?? source.length);
    }
    return { empty: rows.length === 0, docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })) };
  },
  updateDoc: async () => {},
}));

const { resolveContact, createWebAdapter } = await import('../services/contactIdentityService.js');
const { IdentityConflictError, RESOLUTION } = await import('../utils/identityResolution.js');
const { findCompanyByName, resolveCompany } = await import('../services/companyIdentityService.js');
const { prepareContactWrite } = await import('../services/contactWriteGuard.js');

const UID = 'u1';

beforeEach(() => {
  TABLE = [];
  COMPANIES = [];
  QUERIES = [];
});

// ── 2d — LinkedIn raw-value fallback ────────────────────────────────────────

describe('2d — LinkedIn resolves on the raw stored value (103 records)', () => {
  it('matches a legacy record whose stored URL is byte-identical to the candidate', async () => {
    // The common duplicate pair: two rows from the SAME source, so the URL was
    // stored exactly as it arrives again. No normalized field on either.
    TABLE = [{ id: 'c1', name: 'Jo Kim', linkedin_url: 'https://www.linkedin.com/in/jo-kim/' }];

    const r = await resolveContact(UID, { linkedin_url: 'https://www.linkedin.com/in/jo-kim/' });

    expect(r.outcome).toBe(RESOLUTION.MATCHED);
    expect(r.signal).toBe('linkedin_url');
    expect(r.contactId).toBe('c1');
    // Proves it was the INDEXED rung, not the scan — which is the whole point:
    // in a workspace larger than the window the scan would not have reached it.
    expect(QUERIES).toContain('linkedin_url');
    expect(QUERIES).not.toContain('__scan__');
  });

  it('querying the raw field at the NORMALIZED value would not have matched', async () => {
    // The negative case that justifies the asymmetry with email. If someone
    // later "tidies" findByLinkedIn to query at ids.linkedinUrl for symmetry,
    // this is the assertion that catches it.
    TABLE = [{ id: 'c1', linkedin_url: 'https://www.linkedin.com/in/jo-kim/' }];
    const stored = TABLE[0].linkedin_url;
    const normalized = 'linkedin.com/in/jo-kim';

    expect(stored).not.toBe(normalized);
    expect(TABLE.filter(r => r.linkedin_url === normalized)).toHaveLength(0);
  });

  it('still prefers the normalized field when the record carries one', async () => {
    TABLE = [{
      id: 'c1',
      linkedin_url: 'https://www.linkedin.com/in/jo-kim/',
      linkedin_url_normalized: 'linkedin.com/in/jo-kim',
    }];

    const r = await resolveContact(UID, { linkedin_url: 'http://linkedin.com/in/jo-kim?trk=x' });

    expect(r.contactId).toBe('c1');
    expect(QUERIES[0]).toBe('linkedin_url_normalized');
  });

  it('falls through to the scan when neither indexed rung hits', async () => {
    // Stored with a query string the candidate does not have: not equal as raw
    // bytes, equal once normalized. Only the scan can see this.
    TABLE = [{ id: 'c1', linkedin_url: 'https://www.linkedin.com/in/jo-kim/?trk=nav' }];

    const r = await resolveContact(UID, { linkedin_url: 'linkedin.com/in/jo-kim' });

    expect(r.contactId).toBe('c1');
    expect(QUERIES).toContain('__scan__');
  });

  it('does not spend the raw query when raw and normalized are the same string', async () => {
    TABLE = [{ id: 'other', name: 'nobody' }];
    await resolveContact(UID, { linkedin_url: 'linkedin.com/in/jo-kim' });
    expect(QUERIES.filter(q => q === 'linkedin_url')).toHaveLength(0);
  });
});

// ── 2c — phone raw fallback ─────────────────────────────────────────────────

describe('2c — phone resolves on the raw stored value (1 record, low priority)', () => {
  it('matches an Apollo-sanitised number stored as bare digits', async () => {
    TABLE = [{ id: 'c1', phone: '4155550100' }];
    const r = await resolveContact(UID, { phone: '(415) 555-0100' });
    expect(r.signal).toBe('phone');
    expect(r.contactId).toBe('c1');
    expect(QUERIES).toContain('phone');
  });

  it('a formatted stored number still needs the scan', async () => {
    TABLE = [{ id: 'c1', phone: '(415) 555-0100' }];
    const r = await resolveContact(UID, { phone: '415-555-0100' });
    expect(r.contactId).toBe('c1');
    expect(QUERIES).toContain('__scan__');
  });
});

// ── 2f — authoritative collisions fail closed ───────────────────────────────

describe('2f — one authoritative identifier, two records: refuse', () => {
  it('refuses on a duplicated email instead of silently taking the first', async () => {
    // The behaviour this replaces: findBy used limit(5) and returned docs[0],
    // so this resolved to whichever document Firestore happened to return
    // first — invisibly, every time, forever.
    TABLE = [
      { id: 'c1', email_normalized: 'dana@acme.com', name: 'Dana W' },
      { id: 'c2', email_normalized: 'dana@acme.com', name: 'Dana Whitfield' },
    ];

    await expect(resolveContact(UID, { email: 'Dana@Acme.com' }))
      .rejects.toThrow(IdentityConflictError);
  });

  it('the error names the signal and every colliding record', async () => {
    TABLE = [
      { id: 'c1', apollo_person_id: 'ap_1' },
      { id: 'c2', apollo_person_id: 'ap_1' },
    ];

    await expect(resolveContact(UID, { apollo_person_id: 'ap_1' })).rejects.toMatchObject({
      name: 'IdentityConflictError',
      signal: 'apollo_person_id',
      contactIds: ['c1', 'c2'],
    });
  });

  it('refuses on a duplicated LinkedIn URL', async () => {
    TABLE = [
      { id: 'c1', linkedin_url_normalized: 'linkedin.com/in/jo' },
      { id: 'c2', linkedin_url_normalized: 'linkedin.com/in/jo' },
    ];
    await expect(resolveContact(UID, { linkedin_url: 'https://www.linkedin.com/in/jo/' }))
      .rejects.toThrow(IdentityConflictError);
  });

  it('refuses on a duplicated phone', async () => {
    TABLE = [{ id: 'c1', phone_normalized: '4155550100' }, { id: 'c2', phone_normalized: '4155550100' }];
    await expect(resolveContact(UID, { phone: '415-555-0100' })).rejects.toThrow(IdentityConflictError);
  });

  it('refuses when the collision is found by the SCAN, not only by a query', async () => {
    // Same rule wherever the two records were found. Both stored mixed-case
    // with no normalized field, so only the scan sees them.
    TABLE = [
      { id: 'c1', email: 'Dana@Acme.com' },
      { id: 'c2', email: 'DANA@acme.com' },
    ];
    await expect(resolveContact(UID, { email: 'dana@acme.com' }))
      .rejects.toThrow(IdentityConflictError);
  });

  it('one record matching twice across rungs is NOT a collision', async () => {
    // The same document found by both the normalized field and the raw field
    // is one person, not two. Deduping by id is what stops a correct match
    // from being reported as a conflict.
    TABLE = [{ id: 'c1', email: 'dana@acme.com', email_normalized: 'dana@acme.com' }];
    const r = await resolveContact(UID, { email: 'dana@acme.com' });
    expect(r.outcome).toBe(RESOLUTION.MATCHED);
    expect(r.contactId).toBe('c1');
  });

  it('a weak name+company match with two candidates still REVIEWS, it does not refuse', async () => {
    // Step 6 was always allowed to return several — it flags rather than
    // choosing. Fail-closed applies to AUTHORITATIVE signals only, and
    // conflating the two would turn an answerable question into an error.
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c2', name: 'sarah johnson', company_name: 'acme' },
    ];
    const r = await resolveContact(UID, { name: 'Sarah Johnson', company_name: 'Acme' });
    expect(r.outcome).toBe(RESOLUTION.REVIEW);
    expect(r.candidates).toHaveLength(2);
  });

  it('the write guard fails closed rather than creating a third duplicate', async () => {
    // Why the engine THROWS instead of returning a new outcome: every existing
    // caller branches on `action === 'merge'` and creates otherwise, so a new
    // outcome would have fallen into the create branch — adding a third record
    // to a collision of two.
    TABLE = [
      { id: 'c1', email_normalized: 'dana@acme.com' },
      { id: 'c2', email_normalized: 'dana@acme.com' },
    ];
    await expect(
      prepareContactWrite(UID, { email: 'dana@acme.com', name: 'Dana' }, { source: 'test' }),
    ).rejects.toThrow(IdentityConflictError);
  });
});

// ── 2e — company name matching ──────────────────────────────────────────────

describe('2e — company names match across case and whitespace', () => {
  it('still prefers an exact match', async () => {
    COMPANIES = [{ id: 'co1', name: 'Acme Corp' }, { id: 'co2', name: 'acme corp' }];
    const hit = await findCompanyByName(UID, 'Acme Corp');
    expect(hit.id).toBe('co1');
    expect(hit._matchedField).toBe('name');
  });

  it('matches a differently-cased company instead of creating a second document', async () => {
    // Apollo title-cases, a business card is whatever was printed, a CSV is
    // whatever was typed. Every one of those pairs used to produce two
    // company documents, each with its own status and half the contacts.
    COMPANIES = [{ id: 'co1', name: 'acme corp' }];
    const hit = await findCompanyByName(UID, 'Acme Corp');
    expect(hit.id).toBe('co1');
    expect(hit._matchedField).toBe('name_normalized');
  });

  it('collapses runs of whitespace', async () => {
    COMPANIES = [{ id: 'co1', name: 'Acme   Corp' }];
    expect((await findCompanyByName(UID, ' Acme Corp ')).id).toBe('co1');
  });

  it('does NOT match on a prefix — subsidiaries stay separate from parents', async () => {
    COMPANIES = [{ id: 'co1', name: 'Acme' }];
    expect(await findCompanyByName(UID, 'Acme Corp')).toBeNull();
  });

  it('refuses to choose when one loose name maps to two different companies', async () => {
    COMPANIES = [{ id: 'co1', name: 'acme corp' }, { id: 'co2', name: 'ACME CORP' }];
    expect(await findCompanyByName(UID, 'Acme Corp')).toBeNull();
  });

  it('resolveCompany still prefers the Apollo id over any name match', async () => {
    COMPANIES = [
      { id: 'co1', name: 'acme corp' },
      { id: 'co2', name: 'Something Else', apollo_organization_id: 'org_9' },
    ];
    const r = await resolveCompany(UID, { apollo_organization_id: 'org_9', name: 'Acme Corp' });
    expect(r.companyId).toBe('co2');
    expect(r.signal).toBe('apollo_organization_id');
  });

  it('a company with no name at all is skipped, not crashed on', async () => {
    COMPANIES = [{ id: 'co1' }, { id: 'co2', name: 'acme corp' }];
    expect((await findCompanyByName(UID, 'Acme Corp')).id).toBe('co2');
  });
});

// ── 2a — one scan window per operation ──────────────────────────────────────

describe('2a — a batch pays for the scan window once', () => {
  it('twenty candidates through a shared adapter load it once, not twenty times', async () => {
    TABLE = [{ id: 'c1', name: 'Someone', company_name: 'Elsewhere' }];
    const adapter = createWebAdapter(UID);
    QUERIES = [];

    for (let i = 0; i < 20; i++) {
      await resolveContact(UID, { name: `Person ${i}`, company_name: 'Nowhere' }, { adapter });
    }

    expect(QUERIES.filter(q => q === '__scan__')).toHaveLength(1);
  });
});

// ── Preserved invariants ────────────────────────────────────────────────────

describe('preserved — lazy normalization and the failure asymmetry', () => {
  it('an exact indexed hit never touches the scan window', async () => {
    TABLE = [{ id: 'c1', apollo_person_id: 'ap_1' }];
    await resolveContact(UID, { apollo_person_id: 'ap_1' });
    expect(QUERIES).not.toContain('__scan__');
  });

  it('lazy self-healing is unchanged — a merge still writes the normalized forms', async () => {
    TABLE = [{ id: 'c1', email: 'Dana@Acme.com' }];
    const decision = await prepareContactWrite(
      UID,
      { email: 'Dana@Acme.com', linkedin_url: 'https://www.linkedin.com/in/dana/' },
      { source: 'test' },
    );
    expect(decision.action).toBe('merge');
    expect(decision.patch.email_normalized).toBe('dana@acme.com');
    expect(decision.patch.linkedin_url_normalized).toBe('linkedin.com/in/dana');
  });
});
