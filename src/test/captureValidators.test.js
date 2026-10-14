/**
 * Capture validators: they reject or doubt, and never repair.
 */
import { describe, it, expect } from 'vitest';
import {
  CHECKS, FAILING_CHECKS, DOUBT_CHECKS, hostOf, emailHost, ocrSuspectedHost, validateHost,
  validateEmail, validateUrl, validateLinkedInPerson, validateLinkedInCompany, validatePhone, personNameKey,
} from '../capture/validators.js';

describe('email syntax', () => {
  it.each([
    ['jane.smith@acme.com', 'jane.smith@acme.com'],
    ['  Jane.Smith@ACME.com ', 'jane.smith@acme.com'],
    ['dana+events@acme.com', 'dana+events@acme.com'],
    ["o'brien@acme.co.uk", "o'brien@acme.co.uk"],
  ])('%j is valid → %j', (input, normalized) => {
    expect(validateEmail(input)).toEqual({ ok: true, normalized, checks: [CHECKS.EMAIL_SYNTAX_OK] });
  });

  it.each([
    ['jane.smith'], ['jane@'], ['@acme.com'], ['jane@@acme.com'], ['jane@acme@x.com'],
    ['.jane@acme.com'], ['jane..smith@acme.com'], ['jane smith@acme.com'], ['jane@sarah.chen'],
    [''], [null],
  ])('%j is invalid', (input) => {
    expect(validateEmail(input)).toEqual({ ok: false, normalized: null, checks: [CHECKS.EMAIL_SYNTAX_INVALID] });
  });

  it('a misread suffix is flagged, not rewritten', () => {
    expect(validateEmail('jane@acme.c0m')).toEqual({
      ok: false, normalized: 'jane@acme.c0m', checks: [CHECKS.OCR_SUSPECTED],
    });
    expect(validateEmail('jane@acme.corn').normalized).toBe('jane@acme.corn');
  });
});

describe('hosts and domains', () => {
  it('extracts a bare host from printed forms', () => {
    expect(hostOf('HTTPS://WWW.Acme.com:443/a?b#c')).toBe('www.acme.com');
    expect(hostOf('jane@acme.com')).toBeNull();
    expect(emailHost('Jane@Sales.Acme.com')).toBe('sales.acme.com');
  });

  it('validateHost returns the registrable domain or a reason', () => {
    expect(validateHost('sales.acme.co.uk')).toEqual({ ok: true, domainKey: 'acme.co.uk', checks: [CHECKS.HOST_OK] });
    expect(validateHost('acme.c0m')).toEqual({ ok: false, domainKey: null, checks: [CHECKS.OCR_SUSPECTED] });
    expect(validateHost('sarah.chen')).toEqual({ ok: false, domainKey: null, checks: [CHECKS.HOST_INVALID] });
  });

  it.each([['acme.c0m', true], ['acme.n3t', true], ['acme.corn', true], ['acme.com', false], ['acme.cm', false], ['acme.om', false]])(
    'ocrSuspectedHost(%j) → %j (real ccTLDs are never flagged)',
    (host, expected) => { expect(ocrSuspectedHost(host)).toBe(expected); },
  );
});

describe('URLs', () => {
  it.each([
    ['https://www.acme.com/', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['acme.com/team', 'acme.com/team'],
    ['http://Acme.co.uk/About?ref=card#x', 'acme.co.uk/About'],
  ])('%j → %j', (input, normalized) => {
    const result = validateUrl(input);
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe(normalized);
    expect(result.checks).toEqual([CHECKS.URL_OK]);
  });

  it.each([['jane.smith'], ['jane@acme.com'], ['mailto:jane@acme.com'], ['ftp://acme.com'], ['acme'], [''], [null], ['https://user:pw@acme.com']])(
    '%j is not a website',
    (input) => { expect(validateUrl(input)).toMatchObject({ ok: false, checks: [CHECKS.URL_INVALID] }); },
  );

  it('a misread suffix is flagged with the value kept as printed', () => {
    expect(validateUrl('www.acme.c0m')).toMatchObject({ ok: false, normalized: 'acme.c0m', checks: [CHECKS.OCR_SUSPECTED] });
  });
});

describe('LinkedIn', () => {
  it.each([
    ['https://www.linkedin.com/in/Jane-Doe/', 'linkedin.com/in/jane-doe'],
    ['linkedin.com/in/jane-doe?trk=card', 'linkedin.com/in/jane-doe'],
    ['https://uk.linkedin.com/in/jane-doe', 'linkedin.com/in/jane-doe'],
  ])('person %j → %j', (input, normalized) => {
    expect(validateLinkedInPerson(input)).toEqual({ ok: true, normalized, checks: [CHECKS.LINKEDIN_PERSON_OK] });
  });

  it('company page → linkedin.com/company/<slug>', () => {
    expect(validateLinkedInCompany('https://www.linkedin.com/company/acme-inc/about/')).toEqual({
      ok: true, normalized: 'linkedin.com/company/acme-inc', checks: [CHECKS.LINKEDIN_COMPANY_OK],
    });
  });

  it.each([
    ['https://linkedin.com/company/acme', 'person'],
    ['https://linkedin.com/in/', 'person'],
    ['https://notlinkedin.com/in/jane', 'person'],
    ['https://linkedin.com.evil.io/in/jane', 'person'],
    ['https://linkedin.com/in/jane', 'company'],
  ])('%j is not a valid %s URL', (input, kind) => {
    const validate = kind === 'person' ? validateLinkedInPerson : validateLinkedInCompany;
    expect(validate(input)).toEqual({ ok: false, normalized: null, checks: [CHECKS.LINKEDIN_INVALID] });
  });
});

describe('phone checks', () => {
  it('a readable number with an unresolved country is valid; the country note is informational', () => {
    const result = validatePhone('020 7946 0018', { defaultCountry: 'US' });
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([CHECKS.PHONE_OK, CHECKS.PHONE_COUNTRY_UNRESOLVED]);
    expect(FAILING_CHECKS.has(CHECKS.PHONE_COUNTRY_UNRESOLVED)).toBe(false);
    expect(DOUBT_CHECKS.has(CHECKS.PHONE_COUNTRY_UNRESOLVED)).toBe(false);
  });

  it.each([
    ['555-01', CHECKS.PHONE_TOO_SHORT],
    ['1234567890123456', CHECKS.PHONE_TOO_LONG],
    ['1-800-FLOWERS', CHECKS.PHONE_INVALID_CHARACTERS],
  ])('%j → %j, a failing check', (input, check) => {
    const result = validatePhone(input, { defaultCountry: 'US' });
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual([check]);
    expect(FAILING_CHECKS.has(check)).toBe(true);
  });
});

describe('personNameKey', () => {
  it('folds for comparison only', () => {
    expect(personNameKey('José O’Brien')).toBe('jose obrien');
    expect(personNameKey("JOSE O'BRIEN")).toBe('jose obrien');
    expect(personNameKey('  ')).toBeNull();
  });
});
