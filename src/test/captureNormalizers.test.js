/**
 * Capture normalizers: domainKey, nameKey, normalizeCapturePhone.
 *
 * These produce MATCHING keys. Display values are always kept separately, so
 * every test here is about what two things compare as, never what a user sees.
 */
import { describe, it, expect } from 'vitest';
import { nameKey, normalizeCapturePhone } from '../utils/identityNormalization.js';
import { domainKey, domainStem } from '../capture/validators.js';

describe('domainKey — the registrable domain, by the Public Suffix List', () => {
  it.each([
    ['www.acme.com', 'acme.com'],
    ['sales.acme.com', 'acme.com'],
    ['https://www.acme.com/about?x=1#top', 'acme.com'],
    ['ACME.COM.', 'acme.com'],
    ['acme.com:8443', 'acme.com'],
    // Registrable boundary is not "the last two labels".
    ['acme.co.uk', 'acme.co.uk'],
    ['shop.acme.co.uk', 'acme.co.uk'],
    ['shop.acme.com.au', 'acme.com.au'],
    ['district.k12.ca.us', 'district.k12.ca.us'],
    ['acme.io', 'acme.io'],
  ])('%j → %j', (input, expected) => {
    expect(domainKey(input)).toBe(expected);
  });

  it.each([
    ['sarah.chen', 'an email local part: "chen" is not a public suffix'],
    ['acme.corn', 'not a public suffix'],
    ['acme.c0m', 'not a public suffix'],
    ['www.', 'empty label'],
    ['acme..com', 'empty label'],
    ['jane@acme.com', 'an email is not a domain'],
    ['acme .com', 'whitespace'],
    ['192.168.0.1', 'an IP address'],
    ['localhost', 'no registrable part'],
    ['', 'empty'],
    [null, 'not a string'],
  ])('%j → null (%s)', (input) => {
    expect(domainKey(input)).toBeNull();
  });

  it('ignores private PSL entries, so a site-builder subdomain keys to the builder', () => {
    // A shared host is then refused as a company key by safeguards.js.
    expect(domainKey('acme.wixsite.com')).toBe('wixsite.com');
  });

  it('exposes the stem before the suffix for name/domain agreement', () => {
    expect(domainStem('www.acme.co.uk')).toBe('acme');
    expect(domainStem('not a domain')).toBeNull();
  });
});

describe('nameKey — company names for comparison, never display', () => {
  it.each([
    ['Acme, Inc.', 'acme'],
    ['ACME INC', 'acme'],
    ['Acmé Incorporated', 'acme'],
    ['The Acme Group, L.L.C.', 'acme group'],
    ['Acme Pty Ltd', 'acme'],
    ['Smith & Co.', 'smith'],
    ["Macy's", 'macys'],
    ['  Blue   Ridge  Partners ', 'blue ridge partners'],
    ['Müller GmbH', 'muller'],
  ])('%j → %j', (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });

  it.each([['Inc.'], ['The Co.'], [''], ['   '], [null], [42]])('%j → null: nothing distinctive left', (input) => {
    expect(nameKey(input)).toBeNull();
  });

  it('two spellings of one company compare equal', () => {
    expect(nameKey('ACME, INC.')).toBe(nameKey('Acmé Inc'));
  });
});

describe('normalizeCapturePhone', () => {
  const us = { defaultCountry: 'US' };

  it('US number with a US default → E.164 +1', () => {
    expect(normalizeCapturePhone('(415) 555-0142', us)).toMatchObject({
      e164: '+14155550142', national: '4155550142', normalized: '+14155550142', valid: true, issues: [],
    });
  });

  it('Canada number with a CA default → E.164 +1', () => {
    expect(normalizeCapturePhone('604-555-0199', { defaultCountry: 'CA' })).toMatchObject({
      e164: '+16045550199', national: '6045550199', valid: true,
    });
  });

  it('printed +1 is honoured whatever the default country', () => {
    expect(normalizeCapturePhone('+1 415 555 0142', { defaultCountry: 'GB' })).toMatchObject({
      e164: '+14155550142', explicitCountryCode: true, valid: true,
    });
  });

  it('printed +49 keeps its country code', () => {
    expect(normalizeCapturePhone('+49 30 1234 5678', us)).toMatchObject({
      e164: '+493012345678', explicitCountryCode: true, national: null, valid: true,
    });
  });

  it('printed +44 keeps its country code and drops the "(0)" trunk prefix', () => {
    expect(normalizeCapturePhone('+44 (0)20 7946 0018', us).e164).toBe('+442079460018');
    expect(normalizeCapturePhone('+44 20 7946 0018', us).e164).toBe('+442079460018');
  });

  it.each([
    ['(212) 555-0142 x204'],
    ['(212) 555-0142 x 204'],
    ['212.555.0142 ext. 204'],
    ['212-555-0142, Ext 204'],
    ['212 555 0142 extension 204'],
  ])('extension %j is kept separately, out of the number', (input) => {
    expect(normalizeCapturePhone(input, us)).toMatchObject({ extension: '204', e164: '+12125550142' });
  });

  it.each([
    ['M: 415.555.0199', 'mobile'],
    ['Mobile 415.555.0199', 'mobile'],
    ['Cell: 415-555-0199', 'mobile'],
    ['T: (415) 555-0100', 'office'],
    ['Office: (415) 555-0100', 'office'],
    ['Tel. +1 415 555 0100', 'office'],
    ['F: (415) 555-0101', 'fax'],
    ['Fax (415) 555-0101', 'fax'],
    ['D: (415) 555-0102', 'direct'],
  ])('label %j → kind %j', (input, kind) => {
    const phone = normalizeCapturePhone(input, us);
    expect(phone.kind).toBe(kind);
    expect(phone.valid).toBe(true);
  });

  it('an unlabeled number has no kind: it is not guessed from the format', () => {
    expect(normalizeCapturePhone('(415) 555-0142', us).kind).toBeNull();
  });

  it('an ambiguous number is never converted into a country it was not printed for', () => {
    // A UK national number seen with a US default: not NANP, so not +1.
    expect(normalizeCapturePhone('020 7946 0018', us)).toMatchObject({
      e164: null, national: '02079460018', normalized: '02079460018', valid: true, issues: ['country_unresolved'],
    });
    // A 10-digit number whose area code cannot exist in NANP.
    expect(normalizeCapturePhone('123 456 7890', us)).toMatchObject({ e164: null, issues: ['country_unresolved'] });
  });

  it('without a default country, a number without + stays national digits', () => {
    expect(normalizeCapturePhone('(415) 555-0142')).toMatchObject({
      e164: null, national: '4155550142', normalized: '4155550142', issues: ['country_unresolved'],
    });
  });

  it.each([
    ['555-01', 'too_short'],
    ['+49 12', 'too_short'],
    ['1-800-FLOWERS', 'invalid_characters'],
    ['415 555 0142 + 1', 'invalid_characters'],
    ['1234567890123456', 'too_long'],
    ['', 'empty'],
    [null, 'empty'],
  ])('%j is rejected (%s), never repaired', (input, issue) => {
    const phone = normalizeCapturePhone(input, us);
    expect(phone.valid).toBe(false);
    expect(phone.normalized).toBeNull();
    expect(phone.issues).toContain(issue);
  });

  it('never throws, whatever it is given', () => {
    for (const input of [undefined, {}, [], 12, '((((', '+', 'x204']) {
      expect(() => normalizeCapturePhone(input, us)).not.toThrow();
    }
  });
});
