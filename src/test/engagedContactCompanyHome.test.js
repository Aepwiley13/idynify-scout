/**
 * Every contact from an outside source gets a company — or is deliberately
 * left without one.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * Scout has two headline people counters, and they measure different things:
 *
 *   Saved Companies "Total Contacts"  sums per-company counts, iterating only
 *                                     ACCEPTED companies. A contact with no
 *                                     company_id is skipped outright.
 *   People "Total Leads"              counts contacts that are neither
 *                                     archived nor engaged. Scout mode is the
 *                                     unengaged queue by design.
 *
 * So an ENGAGED contact with NO company is structurally homeless: the first
 * counter has no company to count it under, and the second excludes it for
 * being engaged. It is still reachable — Hunter mode returns engaged contacts —
 * but neither KPI reconciles to the workspace total, and the contact has no
 * home in the Scout surfaces.
 *
 * A production audit found 12 such contacts. They came from three distinct
 * causes, and this file pins all three:
 *
 *   A. LinkedInLinkSearch refused to create a company when Apollo returned a
 *      person with no organization_name — even when the person had a work
 *      email whose domain identified the company perfectly well.
 *   B. mergeIdentifiers listed company_id as CANONICAL and so never wrote it
 *      on a merge, dropping a correctly-resolved company id on the floor
 *      whenever the contact turned out to already exist.
 *   C. ManualContactForm collected the company as free text and wrote no
 *      company_id at all — a 100% leak rate on that path.
 *
 * Plus the fourth case, which is not a leak but a promotion gap: a contact
 * engaged at a company still sitting 'pending' in the discovery queue.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────────
// An in-memory companies table. The service reads with where-equality and an
// unfiltered bounded scan, and writes with setDoc/updateDoc — that is all this
// needs to implement.

let COMPANIES = [];
let WRITES = [];

vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __collection: path.join('/') }),
  doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  getDocs: async (q) => {
    const clause = q.clauses.find(c => c.__where);
    const rows = clause
      ? COMPANIES.filter(r => r[clause.field] === clause.value)
      : COMPANIES;
    return {
      empty: rows.length === 0,
      docs: rows.map(r => ({ id: r.id, data: () => r })),
    };
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

import {
  normalizeDomain,
  workDomainFromEmail,
  companyNameFromDomain,
  findCompanyByDomain,
  ensureCompanyForContact,
} from '../services/companyIdentityService';
import { mergeIdentifiers } from '../utils/identityResolution';

const UID = 'user-1';

beforeEach(() => {
  COMPANIES = [];
  WRITES = [];
});

// ─────────────────────────────────────────────────────────────────────────────
describe('domain normalization', () => {
  it('reduces every shape a stored domain takes to the same host', () => {
    for (const input of [
      'acme.com', 'ACME.com', '  acme.com  ', 'www.acme.com',
      'http://acme.com', 'https://www.acme.com', 'https://www.acme.com/about',
      'https://acme.com/a?b=c#d', 'acme.com.',
    ]) {
      expect(normalizeDomain(input)).toBe('acme.com');
    }
  });

  it('rejects values that are not domains', () => {
    for (const input of [null, undefined, '', 'localhost', 'not a domain']) {
      expect(normalizeDomain(input)).toBeNull();
    }
  });

  it('takes the work domain off an email but never a mailbox provider', () => {
    expect(workDomainFromEmail('patrick@blackdesertresort.com')).toBe('blackdesertresort.com');
    expect(workDomainFromEmail('Todd@ESSLYO.com')).toBe('esslyo.com');
    // The exact case the audit turned up: a real engaged contact whose only
    // email is personal. There is no company to infer, and inferring one from
    // 'gmail.com' would be worse than leaving the contact unlinked.
    expect(workDomainFromEmail('maryparry73@gmail.com')).toBeNull();
    expect(workDomainFromEmail('someone@outlook.com')).toBeNull();
    expect(workDomainFromEmail('')).toBeNull();
    expect(workDomainFromEmail('not-an-email')).toBeNull();
  });

  it('derives a provisional company name from a domain label', () => {
    expect(companyNameFromDomain('esslyo.com')).toBe('Esslyo');
    expect(companyNameFromDomain('rd-advantage.com')).toBe('Rd Advantage');
    expect(companyNameFromDomain('blackdesertresort.com')).toBe('Blackdesertresort');
    expect(companyNameFromDomain(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('findCompanyByDomain', () => {
  it('matches across the three fields a domain has been stored under', async () => {
    COMPANIES = [{ id: 'c1', name: 'Acme', website_url: 'http://www.acme.com' }];
    expect((await findCompanyByDomain(UID, 'acme.com'))?.id).toBe('c1');

    COMPANIES = [{ id: 'c2', name: 'Acme', primary_domain: 'ACME.com' }];
    expect((await findCompanyByDomain(UID, 'https://acme.com/x'))?.id).toBe('c2');

    COMPANIES = [{ id: 'c3', name: 'Acme', domain: 'acme.com' }];
    expect((await findCompanyByDomain(UID, 'www.acme.com'))?.id).toBe('c3');
  });

  it('refuses to choose when a domain maps to several companies', async () => {
    COMPANIES = [
      { id: 'c1', name: 'Acme', domain: 'acme.com' },
      { id: 'c2', name: 'Acme Holdings', website_url: 'https://acme.com' },
    ];
    expect(await findCompanyByDomain(UID, 'acme.com')).toBeNull();
  });

  it('ignores companies with no domain at all', async () => {
    COMPANIES = [{ id: 'c1', name: 'Acme' }];
    expect(await findCompanyByDomain(UID, 'acme.com')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ensureCompanyForContact — cause A: Apollo returns no organization', () => {
  it('links to an existing company on the work-email domain alone', async () => {
    // Brandy Price, from the audit: no company_name, no Apollo org, and
    // brandyp@rd-advantage.com — while "R&D Advantage" was already an accepted
    // company with a matching domain and zero contacts.
    COMPANIES = [{ id: 'rda', name: 'R&D Advantage', domain: 'rd-advantage.com', status: 'accepted' }];

    const result = await ensureCompanyForContact(UID, { email: 'brandyp@rd-advantage.com' }, { source: 'manual' });

    expect(result.companyId).toBe('rda');
    expect(result.signal).toBe('domain');
    expect(result.created).toBe(false);
    expect(WRITES).toHaveLength(0);
  });

  it('creates a company from the domain when none exists, and marks the name as derived', async () => {
    const result = await ensureCompanyForContact(UID, { email: 'todd@esslyo.com' }, { source: 'LinkedIn Link' });

    expect(result.companyId).toBeTruthy();
    expect(result.created).toBe(true);
    const written = WRITES.find(w => w.op === 'set').data;
    expect(written.name).toBe('Esslyo');
    expect(written.domain).toBe('esslyo.com');
    expect(written.status).toBe('accepted');
    // The name is a guess off a domain label. It must say so, or a later
    // enrichment has no way to know it may overwrite it.
    expect(written.name_source).toBe('email_domain');
  });

  it('leaves a contact unlinked when there is genuinely no company signal', async () => {
    // The one contact in the audit that is legitimately homeless: a personal
    // Gmail address and no company name anywhere. Hunter mode is its home.
    const result = await ensureCompanyForContact(UID, {
      email: 'maryparry73@gmail.com', name: '',
    }, { source: 'manual' });

    expect(result.companyId).toBeNull();
    expect(result.created).toBe(false);
    expect(WRITES).toHaveLength(0);
  });

  it('prefers a reported name over a derived one', async () => {
    await ensureCompanyForContact(UID, {
      name: 'Sunny Street App', email: 'holden.millett@sunnystreet.com',
    }, { source: 'LinkedIn Link' });

    const written = WRITES.find(w => w.op === 'set').data;
    expect(written.name).toBe('Sunny Street App');
    expect(written.name_source).toBeUndefined();
  });

  it('does not let the domain rung override a name match', async () => {
    COMPANIES = [
      { id: 'byname', name: 'Domo', status: 'accepted' },
      { id: 'bydomain', name: 'Something Else', domain: 'domo.com', status: 'accepted' },
    ];
    const result = await ensureCompanyForContact(UID, {
      name: 'Domo', email: 'macy.jessee@domo.com',
    }, { source: 'LinkedIn Link' });

    expect(result.companyId).toBe('byname');
    expect(result.signal).toBe('name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ensureCompanyForContact — the pending-company promotion', () => {
  it('promotes a pending discovery card the contact is engaged at', async () => {
    // Sarah Allan at Trü Frü: the company was an un-swiped Apollo ICP card,
    // so Saved Companies never counted her. Engaging someone at a company is
    // an acceptance of that company — this path already assumed as much when
    // it created NEW companies as 'accepted'; it just never promoted one that
    // already existed.
    COMPANIES = [{
      id: 'trufru', name: 'Trü Frü', status: 'pending',
      apollo_organization_id: 'trufru', found_at: '2026-08-01T00:00:00.000Z',
    }];

    const result = await ensureCompanyForContact(UID, {
      apollo_organization_id: 'trufru', name: 'Trü Frü',
    }, { source: 'LinkedIn Link' });

    expect(result.companyId).toBe('trufru');
    expect(result.promoted).toBe(true);

    const patch = WRITES.find(w => w.op === 'update').data;
    expect(patch.status).toBe('accepted');
    // SavedCompanies orders on saved_at || created_at || swipedAt. A discovery
    // card has only found_at, so promoting without saved_at would sort the
    // company to the bottom of the list forever.
    expect(patch.saved_at).toBeTruthy();
    expect(patch.accepted_via).toBe('LinkedIn Link');
  });

  it('leaves a decision the user already made standing', async () => {
    for (const status of ['rejected', 'archived']) {
      COMPANIES = [{ id: 'c1', name: 'Kajae', status, apollo_organization_id: 'k1' }];
      WRITES = [];

      const result = await ensureCompanyForContact(UID, {
        apollo_organization_id: 'k1', name: 'Kajae',
      }, { source: 'LinkedIn Link' });

      expect(result.companyId).toBe('c1');
      expect(result.promoted).toBe(false);
      expect(WRITES).toHaveLength(0);
    }
  });

  it('does not rewrite a company that is already accepted', async () => {
    COMPANIES = [{ id: 'c1', name: 'Domo', status: 'accepted' }];
    const result = await ensureCompanyForContact(UID, { name: 'Domo' }, { source: 'LinkedIn Link' });

    expect(result.companyId).toBe('c1');
    expect(result.promoted).toBe(false);
    expect(WRITES).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mergeIdentifiers — cause B: a merge dropped the company id', () => {
  it('fills company_id when the existing record has none', () => {
    // Macy Jessee and Holden Millett, from the audit. Both had their company
    // resolved correctly at import time; both were then matched to an existing
    // contact record, and the merge silently discarded the id because
    // company_id is a CANONICAL field.
    const patch = mergeIdentifiers(
      { name: 'Macy Jessee', email: 'macy.jessee@domo.com' },
      { company_id: 'domo-123', company_name: 'Domo' },
    );

    expect(patch.company_id).toBe('domo-123');
    expect(patch.company_name).toBe('Domo');
  });

  it('never overwrites a company the record already names', () => {
    const patch = mergeIdentifiers(
      { name: 'Macy Jessee', company_id: 'the-real-one', company_name: 'Domo' },
      { company_id: 'a-guess', company_name: 'Domo Inc' },
    );

    expect(patch.company_id).toBeUndefined();
    expect(patch.company_name).toBeUndefined();
  });

  it('still refuses every other canonical field', () => {
    const patch = mergeIdentifiers(
      {},
      { name: 'Renamed', title: 'New Title', stage: 'hunter', is_archived: true },
    );

    expect(patch.name).toBeUndefined();
    expect(patch.title).toBeUndefined();
    expect(patch.stage).toBeUndefined();
    expect(patch.is_archived).toBeUndefined();
  });

  it('does not write a company_id the incoming source does not have', () => {
    const patch = mergeIdentifiers({ name: 'Someone' }, { email: 'a@b.com' });
    expect('company_id' in patch).toBe(false);
  });
});
