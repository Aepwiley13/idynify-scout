/**
 * Missing-name resilience — CSV rows with an email and no (or half a) name.
 *
 *   contactDisplayName   first+last / first / last / email / "Unknown contact"
 *   greeting             "Hi {First}," or "Hi," — never "Hi undefined," / "Hi null," /
 *                        "Hi ," / "Hi person@example.com," / "Hi Lopez,"
 *   classifyRows         incomplete ≠ invalid: an email-only row imports, with
 *                        what is missing listed; a malformed email still does not
 *   Barry prompt         no first name → the prompt says "Hi," and forbids
 *                        guessing one
 *   header coverage      which headers map, which are reported as ignored
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: vi.fn() }; } } }));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({ verifyAuthToken: vi.fn() }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn() }));
vi.mock('../firebase/config', () => ({ db: {} }));

import {
  contactDisplayName, contactFirstName, missingNameFields, needsName, cleanNamePart, UNKNOWN_CONTACT,
} from '../utils/contactDisplayName';
import { renderCadenceEmail, greetingFor, firstNameFor, displayContactName } from '../utils/cadenceSend';
import {
  parseContactCsv, classifyRows, incompleteRows, mapHeader, ROW_STATUS,
} from '../utils/csvContactImport';
import { buildPrompt, buildInlinePersonalizePrompt } from '../../netlify/functions/barryBulkPersonalize.js';

const classify = (csv) => {
  const parsed = parseContactCsv(csv);
  return classifyRows(parsed.rows, parsed.mappedHeaders);
};

describe('contactDisplayName — one rule for every screen', () => {
  it.each([
    [{ first_name: 'Ana', last_name: 'Lopez' }, 'Ana Lopez'],
    [{ name: 'chelsie hightower' }, 'Chelsie Hightower'],
    [{ first_name: 'Ana' }, 'Ana'],
    [{ last_name: 'Lopez' }, 'Lopez'],
    [{ firstName: 'Ben', lastName: 'Ito' }, 'Ben Ito'],
    [{ email: 'person@example.com' }, 'person@example.com'],
    // Older imports stored the address as the name: still reads as the email, never as a person's name.
    [{ name: 'sam.ray@x.com', email: 'sam.ray@x.com' }, 'sam.ray@x.com'],
    [{ name: 'undefined', first_name: 'null', email: 'p@x.com' }, 'p@x.com'],
    [{}, UNKNOWN_CONTACT],
    [null, UNKNOWN_CONTACT],
  ])('%j → %s', (contact, expected) => {
    expect(contactDisplayName(contact)).toBe(expected);
  });

  it('says "Unknown contact" where the email is already shown beside the name', () => {
    expect(contactDisplayName({ email: 'person@example.com' }, { email: false })).toBe('Unknown contact');
    expect(contactDisplayName({ first_name: 'Ana', email: 'a@x.com' }, { email: false })).toBe('Ana');
  });

  it('never builds a human name out of an email address', () => {
    const c = { name: 'sam.ray@acme.com', email: 'sam.ray@acme.com' };
    expect(contactDisplayName(c)).not.toMatch(/Sam/);
    expect(contactFirstName(c)).toBe('');
    expect(cleanNamePart('sam@acme.com')).toBe('');
  });

  it('cadence helpers use the same rule', () => {
    expect(displayContactName({ email: 'p@x.com' })).toBe('p@x.com');
    expect(displayContactName({ name: 'MICHAEL ULIBARRI' })).toBe('Michael Ulibarri');
  });
});

describe('greeting — "Hi {First}," or "Hi,", nothing else', () => {
  const BAD = /Hi (undefined|null|,|\S+@\S+|Lopez)/;
  it.each([
    [{ first_name: 'Ana', last_name: 'Lopez' }, 'Hi Ana,'],
    [{ name: 'ana lopez' }, 'Hi Ana,'],
    [{ first_name: 'Ana' }, 'Hi Ana,'],
    [{ last_name: 'Lopez', name: 'Lopez', email: 'l@x.com' }, 'Hi,'],
    [{ name: 'person@example.com', email: 'person@example.com' }, 'Hi,'],
    [{ email: 'person@example.com' }, 'Hi,'],
    [{ first_name: 'undefined', name: 'null' }, 'Hi,'],
    [{ first_name: '   ' }, 'Hi,'],
    [{}, 'Hi,'],
  ])('%j → %s', (contact, expected) => {
    expect(greetingFor(contact)).toBe(expected);
    const { body, subject } = renderCadenceEmail({
      subject: 'For {{first_name}}', body: 'Join us.', contact, openingLine: 'I wanted to make sure this was on your radar.',
    });
    expect(body.startsWith(`${expected}\n\n`)).toBe(true);
    expect(body).not.toMatch(BAD);
    expect(subject).not.toMatch(/undefined|null|@/);
  });

  it('{{first_name}} in the body is empty, not a guess, when there is no first name', () => {
    const { body } = renderCadenceEmail({
      subject: 'S', body: 'Thanks{{first_name}}.', contact: { email: 'p@x.com', name: 'p@x.com' }, personalize: false,
    });
    expect(body).toBe('Hi,\n\nThanks.');
    expect(firstNameFor({ email: 'p@x.com' })).toBe('');
  });
});

describe('classifyRows — incomplete is not invalid', () => {
  const CSV = [
    'First Name,Last Name,Email,Company',
    ',,person@example.com,',          // row 2 — email only
    'Ana,,ana@x.com,Acme',             // row 3 — first only
    ',Lopez,lopez@x.com,',             // row 4 — last only
    'Ben,Ito,ben@x.com,Globex',        // row 5 — complete
    ',,not-an-email,Initech',          // row 6 — invalid email
    ',,,Initech',                      // row 7 — nothing to identify
  ].join('\n');

  it('imports email-only, first-only and last-only rows, listing what is missing', () => {
    const rows = classify(CSV);
    const by = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));

    expect(by[2].status).toBe(ROW_STATUS.READY);
    expect(by[2].missing).toEqual(['first name', 'last name']);
    expect(contactDisplayName(by[2].contact, { email: false })).toBe('Unknown contact');
    expect(by[2].contact.email).toBe('person@example.com');

    expect(by[3].status).toBe(ROW_STATUS.READY);
    expect(by[3].missing).toEqual(['last name']);

    expect(by[4].status).toBe(ROW_STATUS.READY);
    expect(by[4].missing).toEqual(['first name']);
    expect(by[4].contact.name).toBe('Lopez');
    expect(greetingFor(by[4].contact)).toBe('Hi,');

    expect(by[5].missing).toEqual([]);
    expect(incompleteRows(rows).map((r) => r.rowNumber)).toEqual([2, 3, 4]);
  });

  it('still rejects a malformed email and a row with nothing to identify it', () => {
    const rows = classify(CSV);
    const by = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));
    expect(by[6].status).toBe(ROW_STATUS.INVALID);
    expect(by[6].reason).toBe('Invalid email address: not-an-email');
    expect(by[7].status).toBe(ROW_STATUS.MISSING);
    expect(incompleteRows(rows).some((r) => r.rowNumber >= 6)).toBe(false);
  });

  it('does not change how duplicates are detected', () => {
    const rows = classify('Email\nperson@example.com\nPERSON@example.com');
    expect(rows.map((r) => r.status)).toEqual([ROW_STATUS.READY, ROW_STATUS.DUPLICATE_IN_FILE]);
  });

  it('flags a contact with no usable name for the People "Needs Name" filter', () => {
    expect(needsName({ name: 'p@x.com', email: 'p@x.com' })).toBe(true);
    expect(needsName({ last_name: 'Lopez' })).toBe(false);
    expect(missingNameFields({ name: 'Ana Lopez' })).toEqual([]);
  });
});

describe('Barry never assumes a first name', () => {
  const SHARED = 'Join us at People Pitch tomorrow.';

  it('with no first name, the prompt shows "Hi," and forbids guessing one', () => {
    for (const firstName of ['', undefined, 'person@example.com', 'undefined']) {
      const prompt = buildPrompt({ contactId: 'c', firstName }, SHARED, '', null);
      expect(prompt).toContain('already written by the system: "Hi,"');
      expect(prompt).toContain('do not guess one');
      expect(prompt).not.toContain('{first name}');
      expect(prompt).not.toMatch(/First name:/);
      expect(prompt).not.toContain('person@example.com');
      expect(prompt).toContain('Very little is known about this contact');
      expect(buildInlinePersonalizePrompt({ contactId: 'c', firstName }, `Hi. {{personalize}} ${SHARED}`, { sentenceBefore: 'Hi.', sentenceAfter: SHARED, tagCount: 1 }, '', null))
        .not.toMatch(/First name:|person@example\.com/);
    }
  });

  it('with a first name, the prompt is unchanged', () => {
    const prompt = buildPrompt({ contactId: 'c', firstName: 'ana', company: 'Acme' }, SHARED, '', null);
    expect(prompt).toContain('already written by the system: "Hi Ana,"');
    expect(prompt).toContain('First name: Ana');
    expect(prompt).not.toContain('do not guess one');
  });
});

describe('column mapping coverage', () => {
  it.each([
    ['First Name', 'first_name'], ['first_name', 'first_name'], ['FirstName', 'first_name'], ['Given Name', 'first_name'],
    ['Last Name', 'last_name'], ['Surname', 'last_name'],
    ['Full Name', 'name'], ['Name', 'name'], ['Contact Name', 'name'],
    ['Email', 'email'], ['E-mail', 'email'], ['Email Address', 'email'], ['Work Email', 'email'],
    ['Phone', 'phone'], ['Mobile Number', 'phone'], ['Telephone', 'phone'],
    ['Company', 'company'], ['Organization Name', 'company'], ['Account Name', 'company'],
    ['Title', 'title'], ['Job Title', 'title'], ['Job Role', 'title'],
    ['LinkedIn', 'linkedin_url'], ['LinkedIn URL', 'linkedin_url'], ['LinkedIn Link', 'linkedin_url'],
    ['Industry', 'industry'], ['Vertical', 'industry'],
    ['State', 'state'], ['City', 'location'], ['Location', 'location'],
    ['Notes', 'notes'],
  ])('%s → %s', (header, field) => {
    expect(mapHeader(header)).toBe(field);
  });

  it('reports headers it does not import instead of dropping them silently', () => {
    const parsed = parseContactCsv('Email,Website,Favorite Color\np@x.com,x.com,blue');
    expect(parsed.ignoredHeaders).toEqual(['Website', 'Favorite Color']);
  });
});
