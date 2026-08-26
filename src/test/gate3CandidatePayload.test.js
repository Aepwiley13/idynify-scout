/**
 * GATE 3 — CandidatePayload contract (Team C → Team A).
 *
 * The load-bearing test is raw pass-through. Identity resolution is only
 * correct if every caller feeds the resolver the same unmodified input, so a UI
 * that "helpfully" lowercases an email produces a different match result than
 * one that does not — and the disagreement is invisible until two records exist
 * for one human.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCandidatePayload, buildCandidatePayloads, mintClientRef,
  findPayloadViolations, CANDIDATE_FIELDS,
} from '../utils/candidatePayload.js';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults.js';

const DIRTY = {
  name: 'Sarah Chen',
  email: 'S.Chen+Tag@Northwind.COM',                       // caps + plus-tag
  linkedin_url: 'HTTPS://WWW.LinkedIn.com/in/SarahChen/?trk=nav',  // caps, www, slash, query
  phone: '+1 (415) 555-0198 ext. 22',                      // punctuation + extension
  apollo_person_id: 'APL_p_8812',
  apollo_organization_id: 'apl_O_4410',
  company_name: 'Northwind Logistics',
  title: 'VP of Operations',
};

describe('identifiers pass through RAW', () => {
  const p = buildCandidatePayload(DIRTY, { kind: 'person', source: 'test', clientRef: 'ui_x' });

  it.each([
    ['email', DIRTY.email],
    ['linkedin_url', DIRTY.linkedin_url],
    ['phone', DIRTY.phone],
    ['apollo_person_id', DIRTY.apollo_person_id],
    ['apollo_organization_id', DIRTY.apollo_organization_id],
  ])('%s is byte-identical to the input', (field, expected) => {
    expect(p[field]).toBe(expected);
  });

  it('does not lowercase the email', () => {
    expect(p.email).not.toBe(DIRTY.email.toLowerCase());
    expect(p.email).toMatch(/[A-Z]/);
  });

  it('does not strip www, protocol, trailing slash or query from LinkedIn', () => {
    expect(p.linkedin_url).toContain('WWW.');
    expect(p.linkedin_url).toContain('?trk=nav');
    expect(p.linkedin_url.endsWith('/')).toBe(false); // query follows the slash — unchanged
  });

  it('does not reformat the phone number', () => {
    expect(p.phone).toContain('(');
    expect(p.phone).toContain('ext.');
  });

  it('does not trim surrounding whitespace on identifiers', () => {
    const spaced = buildCandidatePayload({ email: '  Jane@Acme.com  ' }, { kind: 'person', source: 't', clientRef: 'ui_y' });
    expect(spaced.email).toBe('  Jane@Acme.com  ');
  });
});

describe('shape', () => {
  it('emits exactly the contract fields, no more', () => {
    const p = buildCandidatePayload(DIRTY, { kind: 'person', source: 'test', clientRef: 'ui_x' });
    expect(Object.keys(p).sort()).toEqual([...CANDIDATE_FIELDS].sort());
  });

  it('absent values are null, not undefined or empty string', () => {
    const p = buildCandidatePayload({ name: 'Nobody' }, { kind: 'person', source: 't', clientRef: 'ui_z' });
    expect(p.email).toBeNull();
    expect(p.linkedin_url).toBeNull();
    expect(p.company_id).toBeNull();
  });

  it('only kind is structurally required', () => {
    const p = buildCandidatePayload({}, { kind: 'company', source: 't', clientRef: 'ui_c' });
    expect(p.kind).toBe('company');
  });

  it('rejects an invalid kind', () => {
    expect(() => buildCandidatePayload({}, { kind: 'lead', source: 't', clientRef: 'ui_a' })).toThrow();
  });
});

describe('clientRef is UI correlation, never identity', () => {
  it('is prefixed ui_ so a leak into an id field is obvious', () => {
    expect(mintClientRef(3)).toMatch(/^ui_/);
  });

  it('is unique per result', () => {
    const refs = new Set(MOCK_PEOPLE.map((_, i) => mintClientRef(i)));
    expect(refs.size).toBe(MOCK_PEOPLE.length);
  });

  it('never appears as contactId, companyId or canonical identity', () => {
    const p = buildCandidatePayload(DIRTY, { kind: 'person', source: 't', clientRef: 'ui_x' });
    expect(p.contactId).toBeUndefined();
    expect(p.companyId).toBeUndefined();
    expect(p.canonicalId).toBeUndefined();
    expect(p.id).toBeUndefined();
  });

  it('violation guard catches a contactId smuggled onto a candidate', () => {
    const bad = { ...buildCandidatePayload(DIRTY, { kind: 'person', source: 't', clientRef: 'ui_x' }), contactId: 'abc123' };
    expect(findPayloadViolations(bad)).toContain('contactId must never be sent on a candidate');
  });

  it('violation guard catches a non-ui_ clientRef', () => {
    const bad = buildCandidatePayload(DIRTY, { kind: 'person', source: 't', clientRef: 'contact_abc' });
    expect(findPayloadViolations(bad).join(' ')).toMatch(/ui_ prefix/);
  });

  it('a clean payload has zero violations', () => {
    const p = buildCandidatePayload(DIRTY, { kind: 'person', source: 't', clientRef: mintClientRef(0) });
    expect(findPayloadViolations(p)).toEqual([]);
  });
});

describe('selection → payload set', () => {
  const results = MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

  it('emits one payload per selected row, in displayed order', () => {
    const picked = [results[3].clientRef, results[0].clientRef];
    const out = buildCandidatePayloads(results, picked, { kind: 'person', source: MOCK_SOURCE });
    expect(out).toHaveLength(2);
    expect(out[0].clientRef).toBe(results[0].clientRef);   // display order, not click order
  });

  it('every payload from the real fixture is contract-clean', () => {
    const all = buildCandidatePayloads(results, results.map(r => r.clientRef), { kind: 'person', source: MOCK_SOURCE });
    for (const p of all) expect(findPayloadViolations(p)).toEqual([]);
  });

  it('carries the source through unchanged', () => {
    const out = buildCandidatePayloads(results, [results[0].clientRef], { kind: 'person', source: MOCK_SOURCE });
    expect(out[0].source).toBe(MOCK_SOURCE);
  });

  it('selecting nothing emits nothing', () => {
    expect(buildCandidatePayloads(results, [], { kind: 'person', source: MOCK_SOURCE })).toEqual([]);
  });
});
