/**
 * Capture safeguards: every example from the architecture's safeguard table
 * (section 9), plus the guarantee that today's production list is untouched
 * and covered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makeField } from '../capture/contract.js';
import {
  SAFEGUARDS, CAPTURE_FREE_EMAIL_DOMAINS, CAPTURE_ISP_EMAIL_DOMAINS, isSharedHost, classifyEmailKind,
  domainSafeguards, emailDomainSafeguards, websiteSafeguards, companyNameSafeguards, assessCompanyEvidence,
  ownDomainKind, ownDomainSafeguards,
} from '../capture/safeguards.js';

const here = dirname(fileURLToPath(import.meta.url));
const printed = (value, level = 'likely') => makeField({ value, raw: value, source: 'card_text', score: 0.9, level });

describe('the production free-mail list is untouched and covered', () => {
  // Read statically: importing companyIdentityService would pull in Firebase.
  const source = readFileSync(resolve(here, '../services/companyIdentityService.js'), 'utf8');
  const block = source.match(/export const FREE_EMAIL_DOMAINS = Object\.freeze\(new Set\(\[([\s\S]*?)\]\)\)/)[1];
  const production = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);

  it('still has exactly the 22 domains it had before capture existed', () => {
    expect(production).toHaveLength(22);
  });

  it('every production entry is blocked by capture too (free-mail or ISP)', () => {
    for (const domain of production) {
      expect(CAPTURE_FREE_EMAIL_DOMAINS.has(domain) || CAPTURE_ISP_EMAIL_DOMAINS.has(domain), domain).toBe(true);
    }
  });
});

describe('section 9 — personal email providers', () => {
  it.each(['sarah@gmail.com', 'sarah@googlemail.com', 'sarah@yahoo.co.uk', 'sarah@outlook.com', 'sarah@icloud.com', 'sarah@proton.me', 'sarah@gmx.de'])(
    '%s is personal and never a company signal',
    (email) => {
      expect(classifyEmailKind(email)).toBe('personal');
      expect(emailDomainSafeguards(email)).toContain(SAFEGUARDS.FREE_EMAIL_DOMAIN);
      expect(assessCompanyEvidence({ emails: [email] })).toMatchObject({
        domain: { usable: false }, name: { display: null }, creationCeiling: 'UNKNOWN',
      });
    },
  );
});

describe('section 9 — ISP and shared-host domains', () => {
  it.each(['bob@comcast.net', 'bob@verizon.net', 'bob@att.net', 'bob@sbcglobal.net', 'bob@btinternet.com'])('%s is ISP mail', (email) => {
    expect(classifyEmailKind(email)).toBe('personal');
    expect(emailDomainSafeguards(email)).toContain(SAFEGUARDS.ISP_EMAIL_DOMAIN);
  });

  it.each([
    'acme.wixsite.com', 'https://acme.squarespace.com', 'acme.business.site', 'acme.github.io',
    'linktr.ee/acme', 'sites.google.com/view/acme', 'facebook.com/acmebakery', 'instagram.com/acme',
    'https://www.youtube.com/@acme', 'medium.com/@acme',
  ])('%s is kept as a website only, never a company key', (website) => {
    expect(isSharedHost(website)).toBe(true);
    expect(websiteSafeguards(website)).toEqual([SAFEGUARDS.SHARED_HOST_DOMAIN]);
    expect(assessCompanyEvidence({ website }).domain.usable).toBe(false);
  });

  it('a shared builder is not confused with a company of a similar name', () => {
    expect(isSharedHost('notwixsite.com')).toBe(false);
    expect(domainSafeguards('acme.com')).toEqual([]);
  });
});

describe('section 9 — malformed domains', () => {
  it.each(['sarah.chen', 'acme.corn', 'www.'])('%j is rejected as a domain', (input) => {
    expect(domainSafeguards(input)).toContain(SAFEGUARDS.INVALID_DOMAIN);
  });

  it('a misread suffix is flagged as OCR as well as invalid', () => {
    expect(domainSafeguards('acme.c0m')).toEqual([SAFEGUARDS.INVALID_DOMAIN, SAFEGUARDS.OCR_SUSPECTED]);
  });
});

describe('section 9 — email local part as website', () => {
  it('jane.smith from jane.smith@acme.com is never a website', () => {
    expect(websiteSafeguards('jane.smith', { emails: ['jane.smith@acme.com'] })).toEqual([SAFEGUARDS.WEBSITE_FROM_EMAIL]);
    expect(websiteSafeguards('jane.smith@acme.com')).toEqual([SAFEGUARDS.WEBSITE_FROM_EMAIL]);
    expect(websiteSafeguards('mailto:jane.smith@acme.com')).toEqual([SAFEGUARDS.WEBSITE_FROM_EMAIL]);
  });

  it('a real printed website alongside the same email is fine', () => {
    expect(websiteSafeguards('www.acme.com', { emails: ['jane.smith@acme.com'] })).toEqual([]);
  });
});

describe('section 9 — role addresses', () => {
  it.each(['info@acme.com', 'sales@acme.com', 'hello+card@acme.com', 'no-reply@acme.com'])('%s is a role address', (email) => {
    expect(classifyEmailKind(email)).toBe('role');
    expect(emailDomainSafeguards(email)).toContain(SAFEGUARDS.ROLE_EMAIL);
  });

  it('a person at the same company is a work address', () => {
    expect(classifyEmailKind('jane.smith@acme.com')).toBe('work');
    expect(emailDomainSafeguards('jane.smith@acme.com')).toEqual([]);
  });
});

describe('section 9 — company names', () => {
  it('an inferred name is never authoritative', () => {
    const inferred = makeField({ value: 'acme.com', source: 'inferred', inferredFrom: 'email_domain', score: 0.6, level: 'possible' });
    expect(companyNameSafeguards(inferred)).toContain(SAFEGUARDS.INFERRED_COMPANY_NAME);
    const result = assessCompanyEvidence({ companyName: inferred, emails: ['jane@acme.com'] });
    expect(result.name.usable).toBe(false);
    expect(result.creationCeiling).toBe('NEW_REQUIRES_CONFIRMATION');
  });

  it('a printed name with no website and no work email needs confirmation', () => {
    const result = assessCompanyEvidence({ companyName: printed('Acme') });
    expect(result.codes).toContain(SAFEGUARDS.MISSING_DOMAIN);
    expect(result.creationCeiling).toBe('NEW_REQUIRES_CONFIRMATION');
  });

  it.each(['Consulting Group', 'Global Solutions', 'The Agency', 'Inc.'])('%j is generic: suggestion only', (name) => {
    expect(companyNameSafeguards(printed(name))).toContain(SAFEGUARDS.GENERIC_COMPANY_NAME);
    expect(assessCompanyEvidence({ companyName: printed(name) }).creationCeiling).toBe('SUGGESTION_ONLY');
  });

  it('"Acme Consulting" passes: it has a distinctive word', () => {
    expect(companyNameSafeguards(printed('Acme Consulting'))).toEqual([]);
  });

  it('the person\'s own name is not a company', () => {
    expect(companyNameSafeguards(printed('JOHN DOE'), { personName: 'John Doe' })).toContain(SAFEGUARDS.PERSON_NAME_AS_COMPANY);
  });

  it.each(['Chief Executive Officer', 'CEO', 'VP of Sales', 'Co-Founder'])('%j is a title, not a company', (name) => {
    expect(companyNameSafeguards(printed(name))).toContain(SAFEGUARDS.TITLE_AS_COMPANY);
  });

  it('a company that merely contains title-like words is not a title', () => {
    expect(companyNameSafeguards(printed('Lead Generation Partners'))).toEqual([]);
    expect(companyNameSafeguards(printed('Sales Engine Labs'))).toEqual([]);
  });

  it('text equal to the printed title is a title', () => {
    expect(companyNameSafeguards(printed('Growth Hacker'), { title: 'Growth Hacker' })).toContain(SAFEGUARDS.TITLE_AS_COMPANY);
  });

  it('a one-character name is blocked unless it is the printed domain stem', () => {
    expect(companyNameSafeguards(printed('A'))).toContain(SAFEGUARDS.COMPANY_NAME_TOO_SHORT);
    expect(companyNameSafeguards(printed('X'), { domain: 'x.com' })).not.toContain(SAFEGUARDS.COMPANY_NAME_TOO_SHORT);
  });

  it('weak OCR text or logo-only text is a suggestion only', () => {
    expect(companyNameSafeguards(printed('Acme', 'possible'))).toContain(SAFEGUARDS.WEAK_COMPANY_TEXT);
    const logo = makeField({ value: 'Acme', source: 'card_logo', score: 0.9, level: 'likely' });
    expect(companyNameSafeguards(logo)).toContain(SAFEGUARDS.WEAK_COMPANY_TEXT);
    expect(assessCompanyEvidence({ companyName: logo }).creationCeiling).toBe('SUGGESTION_ONLY');
  });
});

describe('assessCompanyEvidence — what card evidence alone allows', () => {
  it('a printed name agreeing with a printed website is the only path to NEW_CONFIRMED', () => {
    expect(assessCompanyEvidence({ companyName: printed('Acme, Inc.'), website: 'www.acme.com' })).toMatchObject({
      codes: [], domain: { key: 'acme.com', from: 'website', usable: true },
      name: { key: 'acme', display: 'Acme, Inc.', usable: true }, creationCeiling: 'NEW_CONFIRMED',
    });
  });

  it('agreement tolerates a longer printed name ("Blue Ridge Partners" / blueridge.com)', () => {
    expect(assessCompanyEvidence({ companyName: printed('Blue Ridge Partners'), website: 'blueridge.com' }).creationCeiling).toBe('NEW_CONFIRMED');
  });

  it('a printed name that disagrees with the website needs confirmation', () => {
    expect(assessCompanyEvidence({ companyName: printed('Acme'), website: 'globex.com' }).creationCeiling).toBe('NEW_REQUIRES_CONFIRMATION');
  });

  it('a work-email domain gives a candidate but never a display name', () => {
    expect(assessCompanyEvidence({ emails: ['sarah@acme.com'] })).toEqual({
      codes: [], domain: { key: 'acme.com', from: 'email_domain', usable: true },
      name: { key: null, display: null, usable: false }, creationCeiling: 'NEW_REQUIRES_CONFIRMATION',
    });
  });

  it('a shared-host website falls back to the work email', () => {
    expect(assessCompanyEvidence({ website: 'acme.wixsite.com', emails: ['jane@acme.com'] })).toMatchObject({
      codes: [SAFEGUARDS.SHARED_HOST_DOMAIN], domain: { key: 'acme.com', from: 'email_domain' },
    });
  });

  it('nothing usable means UNKNOWN, and the person is still saveable (no person codes here)', () => {
    expect(assessCompanyEvidence({})).toEqual({
      codes: [], domain: { key: null, from: null, usable: false },
      name: { key: null, display: null, usable: false }, creationCeiling: 'UNKNOWN',
    });
  });
});

describe("a person's own domain is not a company's", () => {
  const CARLA = 'Carla Lifferth';

  it.each([
    ['carlalifferth.com', 'personal'],
    ['carla-lifferth.com', 'personal'],                  // hyphens and dots do not matter
    ['www.carlalifferth.co.uk', 'personal'],
    ['carla.lifferth.com', null],                        // judged on the registrable domain, lifferth.com
    ['https://www.CarlaLifferth.com/about', 'personal'],
    ['clifferth.com', 'personal'],                       // first initial, last name
    ['lifferthcarla.com', 'personal'],                   // last name first
    ['carlalifferthdesign.com', 'name_based'],           // the name plus other words
    ['studiocarlalifferth.com', 'name_based'],
    ['lifferthinteriors.com', null],                     // the last name alone: a family business may use it
    ['lifferth.com', null],
    ['carla.com', null],                                 // the first name alone
    ['brightpath.com', null],
    ['gmail.com', null],
  ])('%s → %s', (domain, kind) => {
    expect(ownDomainKind(domain, CARLA)).toBe(kind);
  });

  it('middle names and initials, honorifics and letters after the name', () => {
    expect(ownDomainKind('carlajanelifferth.com', 'Carla Jane Lifferth')).toBe('personal');
    expect(ownDomainKind('carlajlifferth.com', 'Carla Jane Lifferth')).toBe('personal');
    expect(ownDomainKind('cjlifferth.com', 'Carla Jane Lifferth')).toBe('personal');
    expect(ownDomainKind('carlalifferth.com', 'Dr. Carla Lifferth, PhD')).toBe('personal');
    expect(ownDomainKind('joseobrien.com', "José O'Brien")).toBe('personal');
  });

  it('needs a first and a last name, and a real domain', () => {
    expect(ownDomainKind('cher.com', 'Cher')).toBeNull();
    expect(ownDomainKind('carlalifferth.com', null)).toBeNull();
    expect(ownDomainKind('carlalifferth', CARLA)).toBeNull();
    expect(ownDomainKind(null, CARLA)).toBeNull();
  });

  it('codes: PERSONAL_DOMAIN for the name itself, NAME_IN_DOMAIN for the name with other words', () => {
    expect(ownDomainSafeguards('carlalifferth.com', CARLA)).toEqual([SAFEGUARDS.PERSONAL_DOMAIN]);
    expect(ownDomainSafeguards('carlalifferthdesign.com', CARLA)).toEqual([SAFEGUARDS.NAME_IN_DOMAIN]);
    expect(ownDomainSafeguards('lifferthinteriors.com', CARLA)).toEqual([]);
  });

  it('a website at the person\'s own domain is never the company domain', () => {
    expect(assessCompanyEvidence({ website: 'kristinsokol.com', emails: ['kristin@kristinsokol.com'], personName: 'Kristin Sokol' })).toEqual({
      codes: [SAFEGUARDS.PERSONAL_DOMAIN], domain: { key: null, from: null, usable: false },
      name: { key: null, display: null, usable: false }, creationCeiling: 'UNKNOWN',
    });
  });

  it('nor is a role address at it (hello@)', () => {
    expect(assessCompanyEvidence({ emails: ['hello@kristinsokol.com'], personName: 'Kristin Sokol' })).toMatchObject({
      codes: [SAFEGUARDS.ROLE_EMAIL, SAFEGUARDS.PERSONAL_DOMAIN], domain: { usable: false }, creationCeiling: 'UNKNOWN',
    });
  });

  it('a work email at another domain is still company evidence', () => {
    expect(assessCompanyEvidence({ website: 'kristinsokol.com', emails: ['kristin@sokolstudio.com'], personName: 'Kristin Sokol' })).toMatchObject({
      codes: [SAFEGUARDS.PERSONAL_DOMAIN], domain: { key: 'sokolstudio.com', from: 'email_domain', usable: true },
    });
  });

  it('a business named after the person, at a domain with the name in it, needs confirmation, never NEW_CONFIRMED', () => {
    const evidence = assessCompanyEvidence({
      companyName: printed('Carla Lifferth Design'), website: 'carlalifferthdesign.com', personName: CARLA,
    });
    expect(evidence).toMatchObject({
      codes: [SAFEGUARDS.NAME_IN_DOMAIN, SAFEGUARDS.MISSING_DOMAIN],
      domain: { usable: false }, name: { display: 'Carla Lifferth Design', usable: true },
      creationCeiling: 'NEW_REQUIRES_CONFIRMATION',
    });
  });

  it('a business domain that only shares the last name is unchanged', () => {
    expect(assessCompanyEvidence({
      companyName: printed('Lifferth Interiors'), website: 'lifferthinteriors.com', personName: CARLA,
    })).toMatchObject({ codes: [], domain: { key: 'lifferthinteriors.com', usable: true }, creationCeiling: 'NEW_CONFIRMED' });
  });

  it('without a person name nothing changes', () => {
    expect(assessCompanyEvidence({ website: 'kristinsokol.com' })).toMatchObject({
      codes: [], domain: { key: 'kristinsokol.com', from: 'website', usable: true },
    });
  });
});
