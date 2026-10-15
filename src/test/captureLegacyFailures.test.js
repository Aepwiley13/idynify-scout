/**
 * The legacy scanner's known failures, replayed against the new primitives.
 *
 * This does NOT fix the legacy parser. It stays deprecated and byte-for-byte
 * unchanged (see legacyBusinessCardEndpoint.test.js). Each case below is an
 * outcome the old parser really produced (confirmed by running it), and each
 * test shows the new capture primitives make that outcome impossible or
 * visibly unsafe.
 *
 * One failure is not reachable at this layer: case 7, a company line read as
 * a title, is a field-ASSIGNMENT error made by the reader, not a value a
 * normalizer could catch. It is recorded here as a fixture for the extraction
 * benchmark (PR 8), not tested.
 */
import { describe, it, expect } from 'vitest';
import { normalizeCapturePhone } from '../utils/identityNormalization.js';
import { validateEmail, validateUrl, personNameKey } from '../capture/validators.js';
import { SAFEGUARDS, classifyEmailKind, websiteSafeguards, companyNameSafeguards, assessCompanyEvidence } from '../capture/safeguards.js';
import { makeField, makeEmailField, emptyCardExtraction, validateCardExtraction } from '../capture/contract.js';

/** What the legacy parser produced for each card, for the record. */
const LEGACY_FAILURES = Object.freeze([
  { id: 1, card: 'JANE SMITH\nVP Sales\nACME INC\njane.smith@acme.com', legacy: { website: 'jane.smith' } },
  { id: 2, card: 'Dana Lee\ndana+events@acme.com', legacy: { email: 'events@acme.com', company: 'Acme' } },
  { id: 3, card: 'Sam Ray\nF: (415) 555-0100\nM: (415) 555-0199', legacy: { phone: '(415) 555-0100' } },
  { id: 4, card: 'Lena Vogel\n+49 30 1234 5678', legacy: { phone: '1234 5678' } },
  { id: 5, card: 'Ana Ruiz\n(212) 555-0142 x204', legacy: { phone: '(212) 555-0142' } },
  { id: 6, card: 'Tom Hall\ntom.hall@gmail.com', legacy: { company: 'Gmail', website: 'tom.hall' } },
  { id: 7, card: 'Kim Park\nLead Generation Partners\nkim@lgp.io', legacy: { title: 'Lead Generation Partners' }, benchmarkOnly: true },
  { id: 8, card: 'José O’Brien\nCEO', legacy: { name: 'Jos OBrien', company: 'CEO' } },
]);

const printed = value => makeField({ value, raw: value, source: 'card_text', score: 0.9, level: 'likely' });

describe('1 — an email local part taken for a website', () => {
  it('is not a valid website and is caught as coming from the email', () => {
    expect(validateUrl('jane.smith').ok).toBe(false);
    expect(websiteSafeguards('jane.smith', { emails: ['jane.smith@acme.com'] })).toEqual([SAFEGUARDS.WEBSITE_FROM_EMAIL]);
  });

  it('cannot pass the contract', () => {
    const extraction = emptyCardExtraction();
    extraction.person.emails = [makeEmailField({ value: 'jane.smith@acme.com', source: 'card_text', score: 0.98, level: 'confirmed', witness: 'agree' }, 'work')];
    extraction.company.website = makeField({ value: 'jane.smith', source: 'card_text', score: 0.9, level: 'likely', witness: 'skipped' });
    expect(validateCardExtraction(extraction).errors).toContainEqual({ path: 'company.website.value', code: 'website_from_email' });
  });
});

describe('2 — a plus-address cut to someone else\'s address', () => {
  it('is kept whole, and is a work address', () => {
    expect(validateEmail('dana+events@acme.com').normalized).toBe('dana+events@acme.com');
    expect(classifyEmailKind('dana+events@acme.com')).toBe('work');
  });

  it('gives a domain candidate, not a manufactured "Acme"', () => {
    expect(assessCompanyEvidence({ emails: ['dana+events@acme.com'] }).name.display).toBeNull();
  });
});

describe('3 — the fax number taken as the phone', () => {
  it('each number keeps its printed kind, so a fax is never mistaken for the mobile', () => {
    expect(normalizeCapturePhone('F: (415) 555-0100', { defaultCountry: 'US' }).kind).toBe('fax');
    expect(normalizeCapturePhone('M: (415) 555-0199', { defaultCountry: 'US' }).kind).toBe('mobile');
  });
});

describe('4 — an international number destroyed', () => {
  it('+49 keeps its country code in E.164', () => {
    expect(normalizeCapturePhone('+49 30 1234 5678', { defaultCountry: 'US' }).e164).toBe('+493012345678');
  });
});

describe('5 — the extension lost', () => {
  it('is kept, separately from the number', () => {
    expect(normalizeCapturePhone('(212) 555-0142 x204', { defaultCountry: 'US' })).toMatchObject({ extension: '204', e164: '+12125550142' });
  });
});

describe('6 — Gmail turned into a company', () => {
  it('a free-mail address is personal and yields no company at all', () => {
    expect(classifyEmailKind('tom.hall@gmail.com')).toBe('personal');
    expect(assessCompanyEvidence({ emails: ['tom.hall@gmail.com'] })).toMatchObject({
      codes: [SAFEGUARDS.FREE_EMAIL_DOMAIN], name: { display: null }, creationCeiling: 'UNKNOWN',
    });
  });

  it('a "Gmail" company cannot pass the contract', () => {
    const extraction = emptyCardExtraction();
    extraction.person.emails = [makeEmailField({ value: 'tom.hall@gmail.com', source: 'card_text', score: 0.98, level: 'confirmed', witness: 'agree' }, 'personal')];
    extraction.company.name = makeField({ value: 'Gmail', source: 'inferred', inferredFrom: 'email_domain', score: 0.6, level: 'possible' });
    expect(validateCardExtraction(extraction).errors).toContainEqual({ path: 'company.name', code: 'company_name_from_mailbox_provider' });
  });
});

describe('8 — an accented name damaged, and a title stored as the company', () => {
  it('the printed name survives for display; only the comparison key is folded', () => {
    const field = makeField({ raw: 'José O’Brien', value: 'José O’Brien', normalized: personNameKey('José O’Brien'), source: 'card_text', score: 0.97, level: 'confirmed' });
    expect(field.value).toBe('José O’Brien');
    expect(field.normalized).toBe('jose obrien');
    expect(JSON.parse(JSON.stringify(field)).value).toBe('José O’Brien');
  });

  it('"CEO" as a company is caught as a title', () => {
    expect(companyNameSafeguards(printed('CEO'))).toContain(SAFEGUARDS.TITLE_AS_COMPANY);
    expect(assessCompanyEvidence({ companyName: printed('CEO') }).name.usable).toBe(false);
  });
});

describe('7 — a company line read as a title', () => {
  it('is recorded for the extraction benchmark, not claimed as solved here', () => {
    const benchmarkOnly = LEGACY_FAILURES.filter(failure => failure.benchmarkOnly).map(failure => failure.id);
    expect(benchmarkOnly).toEqual([7]);
  });
});
