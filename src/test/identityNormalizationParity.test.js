/**
 * The existing identity normalizers did not move.
 *
 * Relationship Capture added nameKey and normalizeCapturePhone to
 * identityNormalization.js. Today's contact matching runs on the four helpers
 * that were already there, so their output is frozen here, quirks included.
 * `normalizePhone` folding an extension into the number, and keeping a UK
 * "(0)", are known and deliberate. Changing either would change which
 * existing contacts match, which is a decision for its own PR, not a side
 * effect of this one.
 *
 * The expected values were recorded from main before the capture helpers were
 * added.
 */
import { describe, it, expect } from 'vitest';
import identityNormalization, {
  normalizeEmail, normalizeLinkedInUrl, normalizePhone, normalizeLoose, extractIdentifiers,
} from '../utils/identityNormalization.js';

describe('existing identity normalizers are behaviourally unchanged', () => {
  it.each([
    ['Jane.Smith@Acme.com', 'jane.smith@acme.com'],
    ['  dana+events@acme.com ', 'dana+events@acme.com'],
    ['not-an-email', null],
    ['', null],
    [null, null],
    [42, null],
    ['a@b', 'a@b'],
  ])('normalizeEmail(%j) → %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    ['https://www.linkedin.com/in/Jane-Doe/', 'linkedin.com/in/jane-doe'],
    ['http://linkedin.com/in/jane-doe?trk=abc#x', 'linkedin.com/in/jane-doe'],
    ['linkedin.com/company/acme/', 'linkedin.com/company/acme'],
    ['', null],
    [null, null],
  ])('normalizeLinkedInUrl(%j) → %j', (input, expected) => {
    expect(normalizeLinkedInUrl(input)).toBe(expected);
  });

  it.each([
    ['(415) 555-0100', '4155550100'],
    ['+1 415 555 0100', '+14155550100'],
    ['415-555-0100 x204', '4155550100204'],
    ['555-01', null],
    ['+44 (0)20 7946 0018', '+4402079460018'],
    [4155550100, '4155550100'],
    ['', null],
    [null, null],
  ])('normalizePhone(%j) → %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['  Acme   Inc ', 'acme inc'],
    ['José O’Brien', 'josé o’brien'],
    ['', null],
    [null, null],
    [7, null],
  ])('normalizeLoose(%j) → %j', (input, expected) => {
    expect(normalizeLoose(input)).toBe(expected);
  });

  it('extractIdentifiers returns the same shape and values', () => {
    expect(extractIdentifiers({
      email: 'Jane@Acme.com', phone_mobile: '(415) 555-0100', linkedin_url: 'https://linkedin.com/in/jane/',
      first_name: 'Jane', last_name: 'Doe', organization_name: 'Acme Inc', apollo_person_id: 'ap1', company_id: 'c9',
    })).toEqual({
      contactId: null,
      email: 'jane@acme.com',
      apolloPersonId: 'ap1',
      linkedinUrl: 'linkedin.com/in/jane',
      phone: '4155550100',
      name: 'jane doe',
      company: 'acme inc',
      companyId: 'c9',
    });
  });

  it('the default export still carries exactly the original five helpers', () => {
    expect(Object.keys(identityNormalization)).toEqual([
      'normalizeEmail', 'normalizeLinkedInUrl', 'normalizePhone', 'normalizeLoose', 'extractIdentifiers',
    ]);
  });
});
