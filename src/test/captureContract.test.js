/**
 * CardExtraction v1: the shape, its rules, and that it survives the network.
 *
 * Later endpoints pass this object between browser and server as JSON, so a
 * valid extraction must come back from JSON.stringify → JSON.parse identical
 * and still valid, keeping every value, normalized form, source, confidence,
 * phone kind, extension, witness result and safeguard code.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTRACT_VERSION, makeField, makeEmailField, makePhoneField, emptyCardExtraction, validateCardExtraction,
} from '../capture/contract.js';

/** A fully populated, valid extraction exercising every kind of metadata. */
function richExtraction() {
  const extraction = emptyCardExtraction({ operationId: 'cap_3f2a9c71', extractedAt: '2026-10-14T18:03:11Z' });
  const { person, company } = extraction;

  person.fullName = makeField({ raw: 'José O’Brien', value: 'José O’Brien', normalized: 'jose obrien', source: 'card_text', score: 0.97, level: 'confirmed' });
  person.givenName = makeField({ raw: 'José', value: 'José', normalized: 'jose', source: 'inferred', inferredFrom: 'full_name', score: 0.9, level: 'possible' });
  person.familyName = makeField({ raw: 'O’Brien', value: 'O’Brien', normalized: 'obrien', source: 'inferred', inferredFrom: 'full_name', score: 0.9, level: 'possible' });
  person.middleName = makeField({ raw: null, value: 'Luis', normalized: 'luis', source: 'user', score: 1, level: 'confirmed', userEdited: true });
  person.title = makeField({ raw: 'VP of Sales', value: 'VP of Sales', normalized: 'vp of sales', source: 'card_text', score: 0.93, level: 'likely' });
  person.emails = [
    makeEmailField({
      raw: 'dana+events@acme.com', value: 'dana+events@acme.com', normalized: 'dana+events@acme.com',
      source: 'card_text', score: 0.98, level: 'confirmed', checks: ['email_syntax_ok'], witness: 'agree',
    }, 'work'),
    makeEmailField({
      raw: 'jose@gmail.com', value: 'jose@gmail.com', normalized: 'jose@gmail.com',
      source: 'card_text', score: 0.96, level: 'likely', checks: ['email_syntax_ok'], witness: 'skipped',
    }, 'personal'),
  ];
  person.phones = [
    makePhoneField({
      raw: 'M: +49 30 1234 5678', value: '+49 30 1234 5678', normalized: '+493012345678',
      source: 'card_text', score: 0.96, level: 'confirmed', checks: ['phone_ok'], witness: 'agree',
    }, { kind: { raw: 'M', value: 'mobile', normalized: 'mobile', source: 'card_text', score: 0.99, level: 'confirmed' }, extension: null }),
    makePhoneField({
      raw: 'F: (212) 555-0142 x204', value: '(212) 555-0142', normalized: '+12125550142',
      source: 'card_text', score: 0.9, level: 'possible', checks: ['phone_ok'], witness: 'minor_mismatch',
    }, { kind: { raw: 'F', value: 'fax', normalized: 'fax', source: 'card_text', score: 0.97, level: 'confirmed' }, extension: '204' }),
  ];
  person.linkedinUrl = makeField({
    raw: 'linkedin.com/in/jose-obrien', value: 'https://www.linkedin.com/in/jose-obrien', normalized: 'linkedin.com/in/jose-obrien',
    source: 'card_text', score: 0.9, level: 'likely', checks: ['linkedin_person_ok'], witness: 'absent',
  });

  company.name = makeField({ raw: 'ACME ROCKETS INC', value: 'Acme Rockets Inc', normalized: 'acme rockets', source: 'card_text', score: 0.95, level: 'confirmed' });
  company.website = makeField({
    raw: 'www.acmerockets.com', value: 'www.acmerockets.com', normalized: 'acmerockets.com',
    source: 'card_text', score: 0.97, level: 'confirmed', checks: ['url_ok'], witness: 'agree',
  });
  company.domain = makeField({
    raw: null, value: 'acmerockets.com', normalized: 'acmerockets.com', source: 'card_text', inferredFrom: 'website',
    score: 0.97, level: 'confirmed', checks: ['host_ok'], witness: 'agree',
  });
  company.address = makeField({
    raw: '123 Market St, San Francisco, CA 94105', value: '123 Market St, San Francisco, CA 94105', normalized: null,
    source: 'card_text', score: 0.7, level: 'confirmed', userConfirmed: true,
  });
  company.safeguards = ['FREE_EMAIL_DOMAIN'];

  extraction.capture = {
    operationId: 'cap_3f2a9c71',
    extractedAt: '2026-10-14T18:03:11Z',
    status: 'ok',
    provider: { id: 'fake-provider', adapterVersion: '1', modelId: null, promptVersion: 'card-v1' },
    witness: { enabled: true, providerId: 'google-vision', status: 'ok' },
    image: {
      sides: 1, widthPx: 2000, heightPx: 1143, bytes: 412311, mimeType: 'image/jpeg',
      preflight: { blur: 142.5, brightness: 131, glareRatio: 0.004, warnings: [], userOverrode: false },
    },
    timing: { providerMs: 2810, witnessMs: 640, validateMs: 4, totalMs: 3460 },
    usage: { inputTokens: 1840, outputTokens: 412 },
    counts: { fields: 13, confirmed: 8, likely: 3, possible: 2 },
  };
  return extraction;
}

describe('a valid CardExtraction v1', () => {
  it('an empty extraction is valid: every field unknown, nothing guessed', () => {
    const empty = emptyCardExtraction();
    expect(validateCardExtraction(empty)).toEqual({ ok: true, errors: [] });
    expect(empty.version).toBe(CONTRACT_VERSION);
    expect(empty.company.name).toEqual({
      raw: null, value: null, normalized: null, source: null, inferredFrom: null,
      extraction: { score: 0, level: 'unknown', checks: [] }, witness: null, userEdited: false, userConfirmed: false,
    });
  });

  it('a fully populated extraction is valid', () => {
    expect(validateCardExtraction(richExtraction())).toEqual({ ok: true, errors: [] });
  });
});

describe('JSON round trip: create → validate → serialize → deserialize → validate', () => {
  const original = richExtraction();
  const wire = JSON.stringify(original);
  const received = JSON.parse(wire);

  it('both sides validate', () => {
    expect(validateCardExtraction(original).ok).toBe(true);
    expect(validateCardExtraction(received).ok).toBe(true);
  });

  it('nothing is lost or altered', () => {
    expect(received).toEqual(original);
    expect(JSON.stringify(received)).toBe(wire);
  });

  it('keeps values, normalized forms, provenance and confidence apart', () => {
    expect(received.person.fullName).toMatchObject({
      raw: 'José O’Brien', value: 'José O’Brien', normalized: 'jose obrien',
      source: 'card_text', extraction: { score: 0.97, level: 'confirmed' },
    });
    expect(received.person.givenName).toMatchObject({ source: 'inferred', inferredFrom: 'full_name', extraction: { level: 'possible' } });
    expect(received.company.domain).toMatchObject({ source: 'card_text', inferredFrom: 'website' });
  });

  it('keeps phone kinds, extensions, witness results and safeguards', () => {
    expect(received.person.phones.map(p => [p.normalized, p.kind.value, p.extension, p.witness])).toEqual([
      ['+493012345678', 'mobile', null, 'agree'],
      ['+12125550142', 'fax', '204', 'minor_mismatch'],
    ]);
    expect(received.person.emails.map(e => [e.normalized, e.kind, e.witness])).toEqual([
      ['dana+events@acme.com', 'work', 'agree'],
      ['jose@gmail.com', 'personal', 'skipped'],
    ]);
    expect(received.company.safeguards).toEqual(['FREE_EMAIL_DOMAIN']);
  });

  it('keeps user state', () => {
    expect(received.person.middleName).toMatchObject({ source: 'user', userEdited: true, extraction: { level: 'confirmed' } });
    expect(received.company.address).toMatchObject({ userConfirmed: true, extraction: { level: 'confirmed' } });
  });

  it('constructors copy arrays, so later mutation of an input cannot reach in', () => {
    const checks = ['email_syntax_ok'];
    const field = makeField({ value: 'a@acme.com', source: 'card_text', score: 0.9, level: 'likely', checks });
    checks.push('ocr_suspected');
    expect(field.extraction.checks).toEqual(['email_syntax_ok']);
  });
});

describe('the contract rules', () => {
  /** Apply a mutation to a fresh valid extraction and return the error codes. */
  const errorsAfter = (mutate) => {
    const extraction = richExtraction();
    mutate(extraction);
    return validateCardExtraction(extraction).errors;
  };
  const expectError = (mutate, path, code) => {
    expect(errorsAfter(mutate)).toContainEqual({ path, code });
  };

  it('not printed means unknown: a null value cannot carry a level', () => {
    expectError(x => { x.person.suffix.extraction.level = 'likely'; }, 'person.suffix', 'null_value_not_unknown');
  });

  it('a null value has no normalized form, and a value has a source', () => {
    expectError(x => { x.person.suffix.normalized = 'jr'; }, 'person.suffix.normalized', 'normalized_without_value');
    expectError(x => { x.person.title.source = null; }, 'person.title.source', 'value_without_source');
  });

  it('inference is labelled with its origin, and never above possible', () => {
    expectError(x => { x.person.givenName.inferredFrom = null; }, 'person.givenName.inferredFrom', 'inferred_without_origin');
    expectError(x => { x.person.title.inferredFrom = 'full_name'; }, 'person.title.inferredFrom', 'origin_without_inferred');
    expectError(x => { x.person.givenName.extraction.level = 'likely'; }, 'person.givenName.extraction.level', 'inferred_above_possible');
  });

  it('only company.domain may name the printed text it was read from without being inferred', () => {
    expect(errorsAfter(x => {
      Object.assign(x.company.domain, { value: 'acme.com', normalized: 'acme.com', inferredFrom: 'email_domain' });
    })).toEqual([]);
    expectError(x => { x.company.domain.inferredFrom = 'full_name'; }, 'company.domain.inferredFrom', 'domain_bad_origin');
  });

  it('a user edit is the user\'s value and is confirmed', () => {
    expectError(x => { x.person.middleName.source = 'card_text'; }, 'person.middleName.source', 'user_edit_without_user_source');
    expectError(x => { x.company.address.extraction.level = 'likely'; }, 'company.address.extraction.level', 'user_action_not_confirmed');
  });

  it('a witness result appears only on identifier fields', () => {
    expectError(x => { x.person.title.witness = 'agree'; }, 'person.title.witness', 'witness_on_unwitnessed_field');
    expectError(x => { x.person.phones[0].kind.witness = 'agree'; }, 'person.phones[0].kind.witness', 'witness_on_unwitnessed_field');
  });

  it('a website is never derived from an email', () => {
    expectError(x => {
      x.person.emails[0] = makeEmailField({ value: 'jane.smith@acme.com', normalized: 'jane.smith@acme.com', source: 'card_text', score: 0.98, level: 'confirmed', witness: 'agree' }, 'work');
      x.company.website.value = 'jane.smith';
    }, 'company.website.value', 'website_from_email');
    expectError(x => { x.company.website.source = 'inferred'; x.company.website.inferredFrom = 'email_domain'; x.company.website.extraction.level = 'possible'; },
      'company.website.source', 'website_inferred');
  });

  it('a company domain is registrable and never a mailbox provider', () => {
    expectError(x => { x.company.domain.value = 'www.acmerockets.com'; x.company.domain.normalized = 'www.acmerockets.com'; },
      'company.domain.normalized', 'domain_not_registrable');
    expectError(x => { x.company.domain.value = 'gmail.com'; x.company.domain.normalized = 'gmail.com'; },
      'company.domain.value', 'domain_from_mailbox_provider');
    // A value with no registrable domain fails even when it claims no normalized form.
    expectError(x => { x.company.domain.value = 'acmerockets'; x.company.domain.normalized = null; },
      'company.domain.normalized', 'domain_not_registrable');
    expectError(x => { x.company.domain.value = 'wixsite.com'; x.company.domain.normalized = 'wixsite.com'; },
      'company.domain.value', 'domain_shared_host');
  });

  it('a company domain comes from usable printed text on this card', () => {
    // From a role address: still the person's email, never company evidence.
    expectError(x => {
      x.person.emails[0] = makeEmailField({ value: 'info@acme.com', normalized: 'info@acme.com', source: 'card_text', score: 0.98, level: 'confirmed', witness: 'agree' }, 'role');
      Object.assign(x.company.domain, { value: 'acme.com', normalized: 'acme.com', inferredFrom: 'email_domain' });
    }, 'company.domain.inferredFrom', 'domain_origin_not_on_card');
    // From a website that is not the one printed.
    expectError(x => { x.company.website.value = 'www.beta.io'; x.company.website.normalized = 'beta.io'; },
      'company.domain.inferredFrom', 'domain_origin_not_on_card');
    // From a website when none was printed.
    expectError(x => { x.company.website = makeField(); }, 'company.domain.inferredFrom', 'domain_origin_not_on_card');
    // Read from the card but not saying from what.
    expectError(x => { x.company.domain.inferredFrom = null; }, 'company.domain.inferredFrom', 'domain_bad_origin');
    // Typed by the user: their word, no printed origin needed.
    expect(errorsAfter(x => {
      Object.assign(x.company.domain, { source: 'user', inferredFrom: null, witness: null, userEdited: true });
    })).toEqual([]);
  });

  it('a company name is never manufactured from a mailbox provider', () => {
    expectError(x => {
      x.company.name = makeField({ value: 'Gmail', normalized: 'gmail', source: 'inferred', inferredFrom: 'email_domain', score: 0.6, level: 'possible' });
    }, 'company.name', 'company_name_from_mailbox_provider');
  });

  it('a personal address beside a work one does not taint a name inferred from the work domain', () => {
    // The fixture prints dana+events@acme.com and jose@gmail.com.
    expect(errorsAfter(x => {
      x.company.name = makeField({ value: 'Acme', normalized: 'acme', source: 'inferred', inferredFrom: 'email_domain', score: 0.6, level: 'possible' });
    })).toEqual([]);
  });

  it.each([
    [x => { x.person.title.source = 'ocr'; }, 'person.title.source', 'bad_enum'],
    [x => { x.person.title.extraction.level = 'high'; }, 'person.title.extraction.level', 'bad_enum'],
    [x => { x.person.emails[0].witness = 'yes'; }, 'person.emails[0].witness', 'bad_enum'],
    [x => { x.person.emails[0].kind = 'business'; }, 'person.emails[0].kind', 'bad_enum'],
    [x => { x.person.phones[0].kind.value = 'pager'; }, 'person.phones[0].kind.value', 'bad_enum'],
    [x => { x.person.title.extraction.checks.push('looks_fine'); }, 'person.title.extraction.checks[0]', 'bad_enum'],
    [x => { x.company.safeguards.push('NOT_A_CODE'); }, 'company.safeguards[1]', 'bad_enum'],
    [x => { x.person.phones[1].extension = 'x204'; }, 'person.phones[1].extension', 'bad_type'],
    [x => { x.person.title.extraction.score = 1.5; }, 'person.title.extraction.score', 'bad_score'],
    [x => { x.person.title.extraction.score = NaN; }, 'person.title.extraction.score', 'bad_score'],
    [x => { x.person.title.value = new Date(); }, 'person.title.value', 'bad_type'],
    [x => { x.capture.status = 'great'; }, 'capture.status', 'bad_enum'],
    [x => { x.capture.operationId = 'op-1'; }, 'capture.operationId', 'bad_operation_id'],
    [x => { x.capture.extractedAt = 'yesterday'; }, 'capture.extractedAt', 'bad_timestamp'],
    [x => { x.capture.timing.totalMs = Infinity; }, 'capture.timing.totalMs', 'bad_type'],
    [x => { x.version = 'card-extraction/v2'; }, 'extraction.version', 'bad_version'],
  ])('rejects a bad value at %#', (mutate, path, code) => {
    expectError(mutate, path, code);
  });

  it('rejects unknown, missing and undefined keys, so nothing personal can ride along', () => {
    expectError(x => { x.capture.personName = 'José'; }, 'capture.personName', 'unknown_key');
    expectError(x => { x.person.nickname = makeField(); }, 'person.nickname', 'unknown_key');
    expectError(x => { x.company.name.confidence = 0.9; }, 'company.name.confidence', 'unknown_key');
    expectError(x => { delete x.company.website; }, 'company.website', 'missing_key');
    expectError(x => { x.person.title.raw = undefined; }, 'person.title.raw', 'undefined_value');
  });

  it('never throws, whatever it is given', () => {
    for (const input of [null, undefined, 'x', 42, [], {}, { version: CONTRACT_VERSION, person: null, company: [], capture: 'x' }]) {
      expect(() => validateCardExtraction(input)).not.toThrow();
      expect(validateCardExtraction(input).ok).toBe(false);
    }
  });
});
