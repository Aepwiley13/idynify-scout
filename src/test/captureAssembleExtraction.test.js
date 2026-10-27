/**
 * CardReading → CardExtraction: the shared step every extractor's output goes
 * through on the server.
 *
 * Pins that the result always passes validateCardExtraction, that PR 2's
 * validators, safeguards and confidence rules decide each level (not the
 * extractor), that nothing is invented (no domain from a free-mail address,
 * no website from an email, no name part that is not in the printed name),
 * and that a photo kept through "Use anyway" never yields a field above
 * likely. Every card here is fictional.
 */
import { describe, it, expect } from 'vitest';
import { assembleExtraction } from '../../netlify/functions/utils/capture/assembleExtraction.js';
import {
  CARD_READING_VERSION, PHONE_LABELS, emptyReading, notPrinted, validateCardReading,
} from '../../netlify/functions/utils/capture/cardReading.js';
import { fakeCardReading } from '../../netlify/functions/utils/capture/fakeExtractor.js';
import { validateCardExtraction } from '../capture/contract.js';

const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const PROVIDER = { id: 'fake', adapterVersion: '1', modelId: 'fake-v1', promptVersion: 'fake-v1' };
const preflight = (over = {}) => ({ blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false, ...over });
const IMAGE = { version: 'card-image/v1', mimeType: 'image/jpeg', data: 'AAAA', bytes: 412311, widthPx: 2000, heightPx: 1143, preflight: preflight() };
const OVERRIDDEN = { ...IMAGE, preflight: preflight({ warnings: ['blurry'], userOverrode: true }) };

const t = (raw, score = 0.97) => ({ raw, score });

function assemble(reading, { image = IMAGE, provider = PROVIDER } = {}) {
  const result = assembleExtraction(reading, {
    operationId: OP, extractedAt: '2026-10-16T09:00:00.000Z', image, provider,
    timing: { providerMs: 2810, validateMs: 4, totalMs: 3460 }, usage: { inputTokens: 1840, outputTokens: 412 },
  });
  return result;
}

function extract(reading, options) {
  const result = assemble(reading, options);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  expect(validateCardExtraction(result.extraction)).toEqual({ ok: true, errors: [] });
  return result.extraction;
}

/** A reading with only the given person/company fields printed. */
function reading({ person = {}, company = {}, status = 'read' } = {}) {
  const base = emptyReading(status);
  return { status, person: { ...base.person, ...person }, company: { ...base.company, ...company } };
}

const levelOf = f => f.extraction.level;

// ─── The reading contract ───────────────────────────────────────────────────

describe('validateCardReading (card-reading/v2)', () => {
  it('pins the version and the phone labels', () => {
    expect(CARD_READING_VERSION).toBe('card-reading/v2');
    expect(PHONE_LABELS).toEqual(['mobile', 'office', 'direct', 'fax']);
  });

  it('accepts empty readings and the fake card', () => {
    expect(validateCardReading(emptyReading('no_text'))).toEqual({ ok: true });
    expect(validateCardReading(emptyReading('read'))).toEqual({ ok: true });
    expect(validateCardReading(fakeCardReading())).toEqual({ ok: true });
  });

  const cases = [
    ['not an object', () => null, 'reading'],
    ['an extra top-level key', r => ({ ...r, notes: 'x' }), 'reading'],
    ['an unknown status', r => ({ ...r, status: 'ok' }), 'status'],
    ['an extra person key', r => ({ ...r, person: { ...r.person, nickname: t('Ave') } }), 'person'],
    ['a missing field', r => { const { title: _title, ...person } = r.person; return { ...r, person }; }, 'person'],
    ['a value that is not a string', r => ({ ...r, person: { ...r.person, title: { raw: 42, score: 0.9 } } }), 'person.title'],
    ['an over-long value', r => ({ ...r, person: { ...r.person, title: t('x'.repeat(301)) } }), 'person.title'],
    ['a score above 1', r => ({ ...r, person: { ...r.person, fullName: t('Avery Quinn', 1.2) } }), 'person.fullName'],
    ['a NaN score', r => ({ ...r, person: { ...r.person, fullName: t('Avery Quinn', NaN) } }), 'person.fullName'],
    ['an extra key on a field', r => ({ ...r, person: { ...r.person, title: { ...t('CTO'), level: 'confirmed' } } }), 'person.title'],
    ['six emails', r => ({ ...r, person: { ...r.person, emails: new Array(6).fill(t('a@example.com')) } }), 'person.emails'],
    ['a bad email entry', r => ({ ...r, person: { ...r.person, emails: [{ raw: 'a@example.com' }] } }), 'person.emails[0]'],
    ['a phone without a label key', r => ({ ...r, person: { ...r.person, phones: [t('+1 415 555 0142')] } }), 'person.phones[0]'],
    ['an unknown phone label', r => ({ ...r, person: { ...r.person, phones: [{ ...t('+1 415 555 0142'), label: 'pager' }] } }), 'person.phones[0]'],
    ['a company name without fromLogo', r => ({ ...r, company: { ...r.company, name: t('Example Robotics') } }), 'company.name'],
    ['a non-boolean fromLogo', r => ({ ...r, company: { ...r.company, name: { ...t('Example Robotics'), fromLogo: 'yes' } } }), 'company.name'],
    ['an extra company key', r => ({ ...r, company: { ...r.company, domain: t('example.com') } }), 'company'],
    ['no_text with something read', r => ({ ...r, status: 'no_text' }), 'status'],
  ];
  it.each(cases)('rejects %s, naming the path only', (_, mutate, path) => {
    const result = validateCardReading(mutate(fakeCardReading()));
    expect(result).toEqual({ ok: false, path });
    expect(JSON.stringify(result)).not.toMatch(/Avery|Quinn|example\.com|555/);
  });
});

// ─── Assembly ───────────────────────────────────────────────────────────────

describe('assembleExtraction: the fake card', () => {
  const e = extract(fakeCardReading());

  it('is a complete, valid CardExtraction with the provider meta and counts', () => {
    expect(e.version).toBe('card-extraction/v2');
    expect(e.capture).toEqual({
      operationId: OP,
      extractedAt: '2026-10-16T09:00:00.000Z',
      status: 'ok',
      provider: PROVIDER,
      witness: { enabled: false, providerId: null, status: 'skipped' },
      image: { sides: 1, widthPx: 2000, heightPx: 1143, bytes: 412311, mimeType: 'image/jpeg', preflight: preflight() },
      timing: { providerMs: 2810, witnessMs: null, validateMs: 4, totalMs: 3460 },
      usage: { inputTokens: 1840, outputTokens: 412 },
      counts: { fields: 12, confirmed: 4, likely: 8, possible: 0 },
    });
  });

  it('survives JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it('keeps raw, value and normalized apart', () => {
    expect(e.person.fullName).toMatchObject({ raw: 'Avery Quinn', value: 'Avery Quinn', normalized: 'avery quinn', source: 'card_text' });
    expect(e.company.name).toMatchObject({ value: 'Example Robotics', normalized: 'example robotics', source: 'card_text' });
    expect(e.company.website).toMatchObject({ value: 'www.example.com', normalized: 'example.com' });
    expect(e.company.address).toMatchObject({ value: '100 Example Way, Springfield', normalized: null });
  });

  it('confirms only unwitnessed text; identifiers stop at likely with no witness', () => {
    expect([e.person.fullName, e.person.givenName, e.person.familyName, e.company.name].map(levelOf)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
    for (const f of [...e.person.emails, ...e.person.phones, e.person.linkedinUrl, e.company.website, e.company.domain]) {
      expect(levelOf(f)).toBe('likely');
      expect(f.witness).toBe('skipped');
    }
    expect(e.person.title.witness).toBeNull();
  });

  it('splits a phone into number, kind and extension; a printed label wins', () => {
    const [mobile, office] = e.person.phones;
    expect(mobile).toMatchObject({ value: '+1 (415) 555-0142', normalized: '+14155550142', extension: null });
    expect(mobile.kind).toMatchObject({ raw: null, value: 'mobile', normalized: 'mobile', witness: null, extraction: { level: 'likely' } });
    expect(office).toMatchObject({ raw: 'T: +1 (415) 555-0100 x12', value: '+1 (415) 555-0100', normalized: '+14155550100', extension: '12' });
    expect(office.kind.value).toBe('office');
  });

  it('derives the domain from the printed website, never above it', () => {
    expect(e.company.domain).toMatchObject({
      raw: null, value: 'example.com', normalized: 'example.com', source: 'card_text', inferredFrom: 'website',
    });
    expect(e.company.domain.extraction.checks).toEqual(['host_ok']);
    expect(e.company.safeguards).toEqual([]);
    expect(e.person.emails[0].kind).toBe('work');
  });
});

describe('assembleExtraction: "Use anyway"', () => {
  it('caps every field at likely and records the override', () => {
    const e = extract(fakeCardReading(), { image: OVERRIDDEN });
    const fields = [
      ...Object.values(e.person).flat(), ...['name', 'domain', 'website', 'address', 'linkedinUrl'].map(k => e.company[k]),
    ].filter(f => f.value !== null);
    expect(fields.length).toBe(12);
    for (const f of fields) expect(['likely', 'possible', 'unknown']).toContain(levelOf(f));
    expect(e.capture.counts.confirmed).toBe(0);
    expect(e.capture.image.preflight).toEqual({ ...OVERRIDDEN.preflight });
    expect(e.capture.image.preflight.warnings).not.toBe(OVERRIDDEN.preflight.warnings);
  });

  it('a warning without the flag is treated as overridden: never more certain, only less', () => {
    const e = extract(fakeCardReading(), { image: { ...IMAGE, preflight: preflight({ warnings: ['glare'] }) } });
    expect(e.capture.counts.confirmed).toBe(0);
  });
});

describe('assembleExtraction: regression — identifier levels come from their own checks', () => {
  // Caught in the first end-to-end run: emails and phones were built from an
  // already-built field and fell back to makeField's defaults (unknown, no checks).
  it('a well-read email and phone are likely with their check codes, not unknown', () => {
    const e = extract(fakeCardReading());
    const [email] = e.person.emails;
    expect(email.extraction).toEqual({ score: 0.97, level: 'likely', checks: ['email_syntax_ok'] });
    for (const phone of e.person.phones) {
      expect(phone.extraction.level).toBe('likely');
      expect(phone.extraction.checks).toEqual(['phone_ok']);
    }
    expect(e.person.phones.map(p => p.extraction.score)).toEqual([0.95, 0.9]);
  });

  it('a phone kind printed on the card can be confirmed; one only the extractor names stops at likely', () => {
    const e = extract(reading({
      person: {
        fullName: t('Avery Quinn'),
        phones: [{ ...t('M: +1 415 555 0142', 0.99), label: null }, { ...t('+1 415 555 0100', 0.99), label: 'office' }],
      },
    }));
    expect(e.person.phones.map(p => [p.kind.value, levelOf(p.kind)])).toEqual([['mobile', 'confirmed'], ['office', 'likely']]);
    expect(e.person.phones[0].value).toBe('+1 415 555 0142');
  });
});

describe('assembleExtraction: nothing is invented', () => {
  it('a field not printed is null and unknown: no email, phone, title, company or domain is made up', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn') } }));
    expect(e.person.emails).toEqual([]);
    expect(e.person.phones).toEqual([]);
    for (const f of [e.person.title, e.company.name, e.company.domain, e.company.website]) {
      expect(f).toMatchObject({ raw: null, value: null, normalized: null, source: null, extraction: { level: 'unknown' } });
    }
  });

  it('a work email gives a domain candidate, never a company name', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), emails: [t('avery.quinn@example.com')] } }));
    expect(e.company.domain).toMatchObject({ value: 'example.com', inferredFrom: 'email_domain', extraction: { level: 'likely' } });
    expect(e.company.name.value).toBeNull();
  });

  it('a website that is an email local part is dropped; the domain comes from the work email', () => {
    const e = extract(reading({
      person: { fullName: t('Avery Quinn'), emails: [t('avery.quinn@example.com')] },
      company: { website: t('avery.quinn') },
    }));
    expect(e.company.website.value).toBeNull();
    expect(e.company.domain).toMatchObject({ value: 'example.com', inferredFrom: 'email_domain' });
  });

  it('an email address read as a website is dropped', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn') }, company: { website: t('avery@example.com') } }));
    expect(e.company.website.value).toBeNull();
    expect(e.company.domain.value).toBeNull();
  });

  it('a free-mail address gives no domain and no company', () => {
    const e = extract(reading({ person: { fullName: t('Sam Rivera'), emails: [t('sam.rivera@gmail.com')] } }));
    expect(e.person.emails[0].kind).toBe('personal');
    expect(e.company.domain.value).toBeNull();
    expect(e.company.name.value).toBeNull();
    expect(e.company.safeguards).toContain('FREE_EMAIL_DOMAIN');
  });

  it('a role address is the person\'s email but not company evidence', () => {
    const e = extract(reading({ person: { fullName: t('Sam Rivera'), emails: [t('info@example.org')] } }));
    expect(e.person.emails[0]).toMatchObject({ value: 'info@example.org', kind: 'role' });
    expect(e.company.domain.value).toBeNull();
    expect(e.company.safeguards).toContain('ROLE_EMAIL');
  });

  it('a name part that is not in the printed full name is dropped', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), givenName: t('J.'), familyName: t('Quinn') } }));
    expect(e.person.givenName.value).toBeNull();
    expect(e.person.familyName.value).toBe('Quinn');
  });

  it('a name part is never more certain than the full name', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn', 0.85), givenName: t('Avery', 0.99), familyName: t('Quinn', 0.6) } }));
    expect([e.person.fullName, e.person.givenName, e.person.familyName].map(levelOf)).toEqual(['likely', 'likely', 'possible']);
  });

  it('name parts stand alone when no full name is printed', () => {
    const e = extract(reading({ person: { givenName: t('Avery'), familyName: t('Quinn') } }));
    expect([e.person.givenName, e.person.familyName].map(levelOf)).toEqual(['confirmed', 'confirmed']);
    expect(e.capture.status).toBe('ok');
  });

  it('keeps a low-confidence reading but marks it unknown', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), title: t('Dlrector', 0.3) } }));
    expect(e.person.title).toMatchObject({ value: 'Dlrector', extraction: { level: 'unknown' } });
  });
});

describe('assembleExtraction: validators decide, never repair', () => {
  it('a malformed email is unknown, kept as printed, with no normalized form', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), emails: [t('avery@@example')] } }));
    expect(e.person.emails[0]).toMatchObject({ value: 'avery@@example', normalized: null, kind: 'unknown' });
    expect(e.person.emails[0].extraction).toMatchObject({ level: 'unknown', checks: ['email_syntax_invalid'] });
  });

  it('an OCR-suspect email is doubted, not corrected', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), emails: [t('avery@example.c0m')] } }));
    expect(e.person.emails[0]).toMatchObject({ value: 'avery@example.c0m', normalized: null });
    expect(e.person.emails[0].extraction).toMatchObject({ level: 'possible', checks: ['ocr_suspected'] });
    expect(e.company.domain.value).toBeNull();
  });

  it('duplicates are read once', () => {
    const e = extract(reading({
      person: {
        fullName: t('Avery Quinn'),
        emails: [t('Avery.Quinn@Example.com'), t('avery.quinn@example.com')],
        phones: [{ ...t('+1 415 555 0142'), label: null }, { ...t('+1 (415) 555-0142'), label: 'mobile' }],
      },
    }));
    expect(e.person.emails).toHaveLength(1);
    expect(e.person.emails[0]).toMatchObject({ value: 'Avery.Quinn@Example.com', normalized: 'avery.quinn@example.com' });
    expect(e.person.phones).toHaveLength(1);
  });

  it('an unusable phone is unknown with no extension; its kind still shows', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), phones: [{ ...t('call 555-OFFICE'), label: 'office' }] } }));
    const [phone] = e.person.phones;
    expect(phone).toMatchObject({ value: 'call 555-OFFICE', normalized: null, extension: null });
    expect(levelOf(phone)).toBe('unknown');
    expect(phone.kind.value).toBe('office');
  });

  it('an unlabelled number has an unknown kind', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), phones: [{ ...t('+44 20 7946 0958'), label: null }] } }));
    expect(e.person.phones[0].kind).toMatchObject({ value: null, extraction: { level: 'unknown' } });
  });

  it('a LinkedIn URL in the wrong section is unknown', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), linkedinUrl: t('linkedin.com/company/example') } }));
    expect(e.person.linkedinUrl.extraction).toMatchObject({ level: 'unknown', checks: ['linkedin_invalid'] });
  });
});

describe('assembleExtraction: social handles', () => {
  const social = (raw, platform = null, score = 0.97) => ({ ...t(raw, score), platform });
  const withSocials = socials => extract(reading({ person: { fullName: t('Kristin Sokol'), socials } }));

  it('a bare @handle keeps its printed text and has no platform: the network is never guessed', () => {
    const [s] = withSocials([social('@KRISTINSOKOL')]).person.socials;
    expect(s).toMatchObject({ raw: '@KRISTINSOKOL', value: '@KRISTINSOKOL', normalized: 'kristinsokol', source: 'card_text', witness: 'skipped' });
    expect(s.extraction).toMatchObject({ level: 'likely', checks: ['social_ok'] });
    expect(s.platform).toMatchObject({ value: null, extraction: { level: 'unknown' } });
  });

  it('a printed address names its platform for certain', () => {
    const [s] = withSocials([social('instagram.com/KristinSokol')]).person.socials;
    expect(s).toMatchObject({ value: 'instagram.com/KristinSokol', normalized: 'kristinsokol' });
    expect(s.platform).toMatchObject({ value: 'instagram', extraction: { level: 'confirmed' } });
  });

  it('a platform only the extractor saw beside a handle stops at likely; the address wins over it', () => {
    const [seen, address] = withSocials([social('@kristinsokol', 'instagram'), social('facebook.com/kristin.sokol', 'instagram')]).person.socials;
    expect(seen.platform).toMatchObject({ value: 'instagram', extraction: { level: 'likely' } });
    expect(address.platform).toMatchObject({ value: 'facebook', extraction: { level: 'confirmed' } });
  });

  it('leaves out LinkedIn (its own field) and networks not supported yet', () => {
    const e = withSocials([social('linkedin.com/in/kristin'), social('@kristin', 'linkedin'), social('x.com/kristin', 'other'), social('@kristin', 'other')]);
    expect(e.person.socials).toEqual([]);
  });

  it('the same handle on the same platform is read once; a different platform is kept', () => {
    const e = withSocials([social('@KristinSokol', 'instagram'), social('instagram.com/kristinsokol'), social('@kristinsokol', 'facebook')]);
    expect(e.person.socials.map(s => [s.platform.value, s.normalized])).toEqual([['instagram', 'kristinsokol'], ['facebook', 'kristinsokol']]);
  });

  it('text that is not a handle is unknown, kept as printed', () => {
    const [s] = withSocials([social('www.acme.com')]).person.socials;
    expect(s).toMatchObject({ value: 'www.acme.com', normalized: null, extraction: { level: 'unknown', checks: ['social_invalid'] } });
  });

  it('a card with only a handle is partial, and counts it', () => {
    const e = extract(reading({ person: { socials: [social('@kristinsokol', 'instagram')] } }));
    expect(e.capture.status).toBe('partial');
    expect(e.capture.counts.fields).toBe(1);
  });
});

describe('assembleExtraction: company name safeguards', () => {
  it('a title read as the company is doubted', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn'), title: t('Vice President') }, company: { name: { ...t('Vice President'), fromLogo: false } } }));
    expect(e.company.name.extraction.checks).toContain('TITLE_AS_COMPANY');
    expect(levelOf(e.company.name)).toBe('possible');
  });

  it('the person\'s name read as the company is doubted', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn') }, company: { name: { ...t('Avery Quinn'), fromLogo: false } } }));
    expect(e.company.name.extraction.checks).toContain('PERSON_NAME_AS_COMPANY');
    expect(levelOf(e.company.name)).toBe('possible');
  });

  it('a name only in the logo is weak text from card_logo', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn') }, company: { name: { ...t('Example Robotics'), fromLogo: true } } }));
    expect(e.company.name).toMatchObject({ source: 'card_logo' });
    expect(e.company.name.extraction.checks).toContain('WEAK_COMPANY_TEXT');
    expect(levelOf(e.company.name)).toBe('possible');
  });

  it('a domain is never above the website it came from', () => {
    const e = extract(reading({ person: { fullName: t('Avery Quinn') }, company: { website: t('example.com', 0.6) } }));
    expect([e.company.website, e.company.domain].map(levelOf)).toEqual(['possible', 'possible']);
  });
});

describe('assembleExtraction: status', () => {
  it('no_text when nothing was read', () => {
    const e = extract(emptyReading('no_text'));
    expect(e.capture.status).toBe('no_text');
    expect(e.capture.counts).toEqual({ fields: 0, confirmed: 0, likely: 0, possible: 0 });
  });

  it('partial when only company details were read', () => {
    expect(extract(reading({ company: { name: { ...t('Example Robotics'), fromLogo: false } } })).capture.status).toBe('partial');
  });

  it('unreadable when text was read but none of it is usable', () => {
    expect(extract(reading({ person: { emails: [t('avery@@example')] } })).capture.status).toBe('unreadable');
    expect(extract(emptyReading('read')).capture.status).toBe('unreadable');
  });

  it('ok on an identifier alone', () => {
    expect(extract(reading({ person: { phones: [{ ...t('+1 415 555 0142'), label: 'mobile' }] } })).capture.status).toBe('ok');
  });
});

describe('assembleExtraction: failure', () => {
  it('returns path:code errors, never values, when the result would not be a valid CardExtraction', () => {
    const result = assemble(fakeCardReading(), { provider: { ...PROVIDER, adapterVersion: 1 } });
    expect(result).toEqual({ ok: false, errors: ['capture.provider.adapterVersion:bad_type'] });
  });

  it('notPrinted is the unknown reading', () => {
    expect(notPrinted()).toEqual({ raw: null, score: 0 });
  });
});
