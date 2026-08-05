/**
 * contactIdentityService — the resolver that stops duplicates being created.
 *
 * Firestore is mocked at the module boundary rather than emulated: what these
 * tests are about is the HIERARCHY — which signal wins, which one only flags,
 * and what happens when a signal is absent — and that is decided in this file,
 * not in the database. The mock records which fields were queried, so the order
 * of the hierarchy is directly assertable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────────
// A tiny in-memory contacts table. `where(field, '==', value)` is the only
// query shape the service uses, so that is all this implements.

let TABLE = [];
let QUERIES = [];
let FAIL_ON = null;

vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('firebase/firestore', () => {
  return {
    collection: (...path) => ({ __collection: path.slice(1).join('/') }),
    doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
    query: (ref, ...clauses) => ({ ref, clauses }),
    where: (field, op, value) => ({ __where: true, field, op, value }),
    limit: (n) => ({ __limit: n }),
    getDocs: async (q) => {
      const clause = q.clauses.find(c => c.__where);
      if (!clause) {
        return { empty: TABLE.length === 0, docs: TABLE.map(toDoc) };
      }
      QUERIES.push(clause.field);
      if (FAIL_ON === clause.field) {
        const err = new Error('permission denied');
        err.code = 'permission-denied';
        throw err;
      }
      const hits = TABLE.filter(r => r[clause.field] === clause.value);
      return { empty: hits.length === 0, docs: hits.map(toDoc) };
    },
    getDoc: async (ref) => {
      const id = ref.id;
      const hit = TABLE.find(r => r.id === id);
      return { exists: () => Boolean(hit), id, data: () => hit };
    },
    updateDoc: vi.fn(async () => {}),
  };
});

function toDoc(record) {
  return { id: record.id, data: () => record };
}

import {
  resolveContact,
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  extractIdentifiers,
  getResolutionLog,
  clearResolutionLog,
  RESOLUTION,
} from '../services/contactIdentityService';

beforeEach(() => {
  TABLE = [];
  QUERIES = [];
  FAIL_ON = null;
  clearResolutionLog();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── Normalization ───────────────────────────────────────────────────────────

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Gentry.Moyes@Acme.COM ')).toBe('gentry.moyes@acme.com');
  });

  it('returns null for anything that is not an address', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it('does NOT strip dots or plus-tags', () => {
    // Deliberate. Over-normalizing merges two different people; the resulting
    // duplicate from under-normalizing is visible and fixable. See the service.
    expect(normalizeEmail('a.b@gmail.com')).toBe('a.b@gmail.com');
    expect(normalizeEmail('user+acme@example.com')).toBe('user+acme@example.com');
  });
});

describe('normalizeLinkedInUrl', () => {
  it('collapses the shapes of the same profile to one string', () => {
    const expected = 'linkedin.com/in/jane-doe';
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/jane-doe/')).toBe(expected);
    expect(normalizeLinkedInUrl('http://linkedin.com/in/jane-doe')).toBe(expected);
    expect(normalizeLinkedInUrl('LinkedIn.com/in/Jane-Doe?trk=nav')).toBe(expected);
  });

  it('returns null for empties', () => {
    expect(normalizeLinkedInUrl('')).toBeNull();
    expect(normalizeLinkedInUrl(null)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('reduces formatting to digits', () => {
    expect(normalizePhone('(415) 555-0100')).toBe('4155550100');
    expect(normalizePhone('415-555-0100')).toBe('4155550100');
  });

  it('keeps a leading + and does not invent a country code', () => {
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
    // Not equal to the bare form — inferring +1 would merge unrelated people
    // in workspaces selling outside North America.
    expect(normalizePhone('+1 415 555 0100')).not.toBe(normalizePhone('415-555-0100'));
  });

  it('rejects strings too short to identify anyone', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('ext 42')).toBeNull();
  });
});

describe('extractIdentifiers', () => {
  it('reads the same identifiers out of differently shaped payloads', () => {
    const apollo = extractIdentifiers({
      name: 'Gentry Moyes',
      email: 'G@Acme.com',
      linkedin_url: 'https://www.linkedin.com/in/gentry/',
      phone_numbers: [{ sanitized_number: '+14155550100' }],
      organization: { name: 'Acme Corp' },
      apollo_person_id: 'p_1',
    });
    const form = extractIdentifiers({
      first_name: 'Gentry', last_name: 'Moyes',
      email: 'g@acme.com',
      linkedin_url: 'linkedin.com/in/gentry',
      phone: '+1 (415) 555-0100',
      company: 'Acme Corp',
    });

    expect(apollo.email).toBe(form.email);
    expect(apollo.linkedinUrl).toBe(form.linkedinUrl);
    expect(apollo.phone).toBe(form.phone);
    expect(apollo.name).toBe(form.name);
    expect(apollo.company).toBe(form.company);
  });
});

// ── The hierarchy ───────────────────────────────────────────────────────────

describe('resolveContact — the locked hierarchy', () => {
  it('1. an existing Firestore contact id is decisive and queries nothing', async () => {
    TABLE = [{ id: 'c_1', name: 'Gentry Moyes' }];

    const result = await resolveContact('u1', { contactId: 'c_1' }, { source: 't' });

    expect(result.outcome).toBe(RESOLUTION.MATCHED);
    expect(result.contactId).toBe('c_1');
    expect(result.signal).toBe('firestore_id');
    expect(QUERIES).toEqual([]); // the id IS the identity — no lookup needed
  });

  it('2. matches on normalized email regardless of the case it was stored in', async () => {
    TABLE = [{ id: 'c_1', email: 'Gentry.Moyes@Acme.com' }];

    const result = await resolveContact('u1', { email: '  GENTRY.MOYES@acme.COM ' }, { source: 't' });

    expect(result.outcome).toBe(RESOLUTION.MATCHED);
    expect(result.contactId).toBe('c_1');
    expect(result.signal).toBe('email');
  });

  it('2. prefers email over every weaker signal', async () => {
    TABLE = [
      { id: 'by_email', email: 'g@acme.com' },
      { id: 'by_apollo', apollo_person_id: 'p_1' },
      { id: 'by_linkedin', linkedin_url_normalized: 'linkedin.com/in/gentry' },
    ];

    const result = await resolveContact('u1', {
      email: 'g@acme.com',
      apollo_person_id: 'p_1',
      linkedin_url: 'linkedin.com/in/gentry',
    }, { source: 't' });

    expect(result.contactId).toBe('by_email');
    expect(result.signal).toBe('email');
  });

  it('3. falls through to Apollo person id when there is no email', async () => {
    TABLE = [{ id: 'c_2', apollo_person_id: 'p_9' }];

    const result = await resolveContact('u1', { apollo_person_id: 'p_9' }, { source: 't' });

    expect(result.contactId).toBe('c_2');
    expect(result.signal).toBe('apollo_person_id');
  });

  it('4. falls through to LinkedIn URL, normalized on both sides', async () => {
    TABLE = [{ id: 'c_3', linkedin_url: 'https://www.linkedin.com/in/gentry/' }];

    const result = await resolveContact('u1', {
      linkedin_url: 'LINKEDIN.com/in/gentry?trk=x',
    }, { source: 't' });

    // The stored record's raw URL is matched by the raw-URL fallback query,
    // which is why the historical backlog resolves without a migration.
    expect(result.signal).toBe('linkedin_url');
  });

  it('5. falls through to phone', async () => {
    TABLE = [{ id: 'c_4', phone_normalized: '4155550100' }];

    const result = await resolveContact('u1', { phone: '(415) 555-0100' }, { source: 't' });

    expect(result.contactId).toBe('c_4');
    expect(result.signal).toBe('phone');
  });

  it('6. name + company FLAGS for review and never merges', async () => {
    TABLE = [{ id: 'c_5', name: 'John Smith', company_name: 'Acme Corp' }];

    const result = await resolveContact('u1', {
      name: 'john  smith',
      company_name: 'ACME CORP',
    }, { source: 't' });

    expect(result.outcome).toBe(RESOLUTION.REVIEW);
    expect(result.requiresReview).toBe(true);
    // The whole point: no id is returned, so the caller creates the record.
    expect(result.contactId).toBeNull();
    expect(result.candidates.map(c => c.id)).toEqual(['c_5']);
  });

  it('returns NEW when nothing matches', async () => {
    TABLE = [{ id: 'someone_else', email: 'other@example.com' }];

    const result = await resolveContact('u1', { email: 'new@example.com' }, { source: 't' });

    expect(result.outcome).toBe(RESOLUTION.NEW);
    expect(result.contactId).toBeNull();
    expect(result.requiresReview).toBe(false);
  });
});

describe('resolveContact — contacts without an email', () => {
  it('creates rather than blocking when there is no email at all', async () => {
    const result = await resolveContact('u1', {
      name: 'No Email Person',
      phone: '(415) 555-9999',
    }, { source: 't' });

    expect(result.outcome).toBe(RESOLUTION.NEW);
    // No email query was attempted — a missing email is not a failed match.
    expect(QUERIES).not.toContain('email_normalized');
  });

  it('still matches such a contact on the provider ids it does have', async () => {
    TABLE = [{ id: 'c_6', apollo_person_id: 'p_no_email' }];

    const result = await resolveContact('u1', {
      name: 'No Email Person',
      apollo_person_id: 'p_no_email',
    }, { source: 't' });

    expect(result.contactId).toBe('c_6');
  });
});

describe('resolveContact — failures are never silent', () => {
  it('rethrows a Firestore failure rather than reporting "no duplicate"', async () => {
    FAIL_ON = 'email_normalized';

    await expect(
      resolveContact('u1', { email: 'g@acme.com' }, { source: 't' })
    ).rejects.toThrow(/permission denied/);
  });

  it('logs every decision it makes', async () => {
    TABLE = [{ id: 'c_1', email: 'g@acme.com' }];

    await resolveContact('u1', { email: 'g@acme.com' }, { source: 'DailyLeads' });
    await resolveContact('u1', { email: 'nobody@acme.com' }, { source: 'DailyLeads' });

    const log = getResolutionLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ outcome: RESOLUTION.MATCHED, signal: 'email', source: 'DailyLeads' });
    expect(log[1]).toMatchObject({ outcome: RESOLUTION.NEW, source: 'DailyLeads' });
  });
});

// ── Merging ─────────────────────────────────────────────────────────────────

describe('mergeIdentifiers', () => {
  it('attaches identifiers the record does not have', () => {
    const existing = { id: 'c_1', name: 'Gentry Moyes', email: 'g@acme.com' };
    const patch = mergeIdentifiers(existing, {
      apollo_person_id: 'p_1',
      linkedin_url: 'https://www.linkedin.com/in/gentry/',
    });

    expect(patch.apollo_person_id).toBe('p_1');
    expect(patch.linkedin_url).toBe('https://www.linkedin.com/in/gentry/');
    expect(patch.linkedin_url_normalized).toBe('linkedin.com/in/gentry');
  });

  it('never overwrites a canonical field', () => {
    const existing = {
      id: 'c_1',
      name: 'Gentry Moyes',
      company_name: 'Acme Corp',
      stage: 'hunter',
      barry_memory: { who_they_are: 'a real relationship' },
    };
    const patch = mergeIdentifiers(existing, {
      name: 'g.moyes',
      company_name: 'ACME',
      stage: 'scout',
      barry_memory: {},
    });

    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('company_name');
    expect(patch).not.toHaveProperty('stage');
    expect(patch).not.toHaveProperty('barry_memory');
  });

  it('never clobbers an identifier the record already has', () => {
    const existing = { id: 'c_1', email: 'g@acme.com', apollo_person_id: 'p_original' };
    const patch = mergeIdentifiers(existing, { apollo_person_id: 'p_different' });

    expect(patch).not.toHaveProperty('apollo_person_id');
  });

  it('backfills email_normalized onto a record that predates it', () => {
    const existing = { id: 'c_1', email: 'Gentry@Acme.com' };
    const patch = mergeIdentifiers(existing, { email: 'gentry@acme.com' });

    expect(patch.email_normalized).toBe('gentry@acme.com');
    expect(patch).not.toHaveProperty('email'); // the stored address is untouched
  });

  it('appends the source without duplicating it', () => {
    const existing = { id: 'c_1', identity_sources: ['manual'] };
    expect(mergeIdentifiers(existing, { source: 'LinkedIn Link' }).identity_sources)
      .toEqual(['manual', 'LinkedIn Link']);
    expect(mergeIdentifiers(existing, { source: 'manual' }))
      .not.toHaveProperty('identity_sources');
  });

  it('returns an empty patch when the new source adds nothing', () => {
    const existing = { id: 'c_1', email: 'g@acme.com', email_normalized: 'g@acme.com' };
    expect(mergeIdentifiers(existing, { email: 'g@acme.com' })).toEqual({});
  });
});

describe('identityFields', () => {
  it('emits only the normalized forms that exist', () => {
    expect(identityFields({ email: ' G@Acme.com ' })).toEqual({ email_normalized: 'g@acme.com' });
    expect(identityFields({})).toEqual({});
  });
});

describe('reviewFields', () => {
  it('is empty unless review is required', () => {
    expect(reviewFields({ requiresReview: false })).toEqual({});
    expect(reviewFields(null)).toEqual({});
  });

  it('records the candidates that triggered the flag', () => {
    const fields = reviewFields({
      requiresReview: true,
      signal: 'name_company',
      candidates: [{ id: 'c_5' }, { id: 'c_6' }],
    });

    expect(fields.identity_review_required).toBe(true);
    expect(fields.identity_review_candidates).toEqual(['c_5', 'c_6']);
  });
});
