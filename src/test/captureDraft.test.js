/**
 * Review drafts: what the person checks after a card is read.
 *
 * Pins that a capture becomes a LIST of people (one today), that nothing is
 * invented (a field not printed is empty), and that every phone keeps the
 * type the card printed, mapped with the approved table, and is "Type not
 * set" whenever the card does not say: never a guess.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  draftsFromExtraction, emptyDraft, phoneFromExtraction, printedPhoneLabel, newSocialRow, socialProblems,
  NOT_A_COMPANY, companyIsUnconfirmed,
} from '../components/capture/captureDraft.js';
import { SAFEGUARDS } from '../capture/safeguards.js';
import { assembleExtraction } from '../../netlify/functions/utils/capture/assembleExtraction.js';
import { emptyReading } from '../../netlify/functions/utils/capture/cardReading.js';
import { encodeBase64 } from '../capture/preparedImage.js';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';

const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const JPEG = new Uint8Array([0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xC0, [8, 0x04, 0x77, 0x07, 0xD0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x5A, 0xFF, 0xD9]);
const image = () => ({
  version: 'card-image/v1', mimeType: 'image/jpeg', data: encodeBase64(JPEG), bytes: JPEG.length, widthPx: 2000, heightPx: 1143,
  preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false },
});

async function read(scenario) {
  const result = await runExtraction({
    extractor: createFakeExtractor(scenario ? { CAPTURE_FAKE_SCENARIO: scenario } : {}),
    image: image(), operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', startedAt: Date.now(),
  });
  return result.extraction;
}

/** An extracted phone as the assembler shapes it: the printed text, the number, its kind and extension. */
const extracted = (raw, { value = raw.replace(/^[a-z][a-z ./&'-]{0,24}?\s*:?\s*(?=[+(\d])/i, ''), kind = null, extension = null } = {}) => ({
  raw, value, extension, kind: { value: kind },
});

let card;
beforeAll(async () => { card = await read(); });

describe('a capture is a list of people', () => {
  it('the fictional card: one person, every printed detail, nothing more', () => {
    const people = draftsFromExtraction(card);
    expect(people).toHaveLength(1);
    const [person] = people;
    expect(person).toMatchObject({
      key: 'person-1',
      name: 'Avery Quinn',
      title: 'Director of Partnerships',
      company: 'Example Robotics',
      email: 'avery.quinn@example.com',
      otherEmails: [],
      linkedinUrl: 'linkedin.com/in/avery-quinn-example',
      website: 'www.example.com',
      toCheck: [],
    });
    expect(person.phones.map(p => [p.label, p.value, p.extension, p.labelSource, p.observedLabel])).toEqual([
      ['mobile', '+1 (415) 555-0142', null, 'card', null],        // the extractor's own "mobile", no printed word
      ['unknown', '+1 (415) 555-0100', '12', null, 'T'],         // "T:" says phone, not whose: Type not set
    ]);
    expect(person.phones[0].normalized).toBe('+14155550142');
  });

  it('company details only (partial): the person fields are empty, not guessed', async () => {
    const [person] = draftsFromExtraction(await read('partial'));
    expect(person).toMatchObject({ name: '', title: '', email: '', linkedinUrl: '', company: 'Example Robotics', website: 'www.example.com' });
    expect(person.phones).toEqual([]);
  });

  it('low confidence: the fields the reader was unsure of are marked to check', async () => {
    const [person] = draftsFromExtraction(await read('low_confidence'));
    expect(person.name).toBe('Avery Quinn');
    expect(person.toCheck.length).toBeGreaterThan(0);
    expect(person.toCheck.every(key => ['name', 'title', 'company', 'email', 'linkedinUrl', 'website', 'phones'].includes(key))).toBe(true);
  });

  it('a name read only in parts is joined; other emails are kept beside the first', () => {
    const [person] = draftsFromExtraction({
      ...card,
      person: {
        ...card.person,
        fullName: { ...card.person.fullName, value: null },
        emails: [card.person.emails[0], { ...card.person.emails[0], value: 'avery@personal.example' }],
      },
    });
    expect(person.name).toBe('Avery Quinn');
    expect(person.email).toBe('avery.quinn@example.com');
    expect(person.otherEmails).toEqual(['avery@personal.example']);
  });

  it('no extraction is no people; by hand starts from an empty person', () => {
    expect(draftsFromExtraction(null)).toEqual([]);
    expect(emptyDraft()).toMatchObject({ name: '', company: '', companySuggestion: null, email: '', phones: [], socials: [], toCheck: [] });
  });
});

describe('social handles are what the card printed', () => {
  /** A card with a name and the given socials, through the real assembler. */
  function withSocials(socials) {
    const base = emptyReading('read');
    const reading = { ...base, person: { ...base.person, fullName: { raw: 'Kristin Sokol', score: 0.97 }, socials } };
    const result = assembleExtraction(reading, {
      operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', extractedAt: '2026-10-27T22:00:00.000Z', image: image(),
      provider: { id: 'fake', adapterVersion: '1', modelId: 'fake-v1', promptVersion: 'fake-v1' },
    });
    expect(result.ok).toBe(true);
    return draftsFromExtraction(result.extraction)[0];
  }

  it('the fictional card has none', () => {
    expect(draftsFromExtraction(card)[0].socials).toEqual([]);
  });

  it('a bare @handle keeps its printed text and waits for the user to choose its network', () => {
    const draft = withSocials([{ raw: '@KRISTINSOKOL', score: 0.95, platform: null }]);
    expect(draft.socials).toEqual([{
      id: 'social-1', platform: null, text: '@KRISTINSOKOL', observed: '@KRISTINSOKOL', fromCard: true, confirmed: false, unsure: false,
    }]);
    expect(socialProblems(draft)).toEqual([{ id: 'social-1', problem: 'platform_required' }]);
  });

  it('a network the card shows is kept, not confirmed: the user has not touched it', () => {
    const draft = withSocials([{ raw: 'instagram.com/kristinsokol', score: 0.95, platform: null }, { raw: '@studio.sokol', score: 0.6, platform: 'facebook' }]);
    expect(draft.socials.map(r => [r.platform, r.text, r.confirmed, r.unsure])).toEqual([
      ['instagram', 'instagram.com/kristinsokol', false, false],
      ['facebook', '@studio.sokol', false, true],
    ]);
    expect(socialProblems(draft)).toEqual([]);
  });

  it('a row whose text is not a handle for its network cannot be saved as it is', () => {
    const draft = { socials: [{ id: 'social-1', platform: 'instagram', text: 'facebook.com/kristin.sokol' }, { id: 'social-2', platform: 'facebook', text: '' }] };
    expect(socialProblems(draft)).toEqual([{ id: 'social-1', problem: 'unreadable' }, { id: 'social-2', problem: 'unreadable' }]);
  });

  it('a row the user adds is theirs from the start, with an id no other row has', () => {
    expect(newSocialRow([{ id: 'social-1' }, { id: 'social-3' }])).toEqual({
      id: 'social-4', platform: null, text: '', observed: '', fromCard: false, confirmed: true, unsure: false,
    });
  });
});

describe('phone types are what the card printed (approved table)', () => {
  it.each([
    ['Main: 801-555-1000', 'main', 'Main'],
    ['Main Line: 801-555-1000', 'main', 'Main Line'],
    ['Main Office 801-555-1000', 'main', 'Main Office'],
    ['Switchboard: 801-555-1000', 'main', 'Switchboard'],
    ['Direct: 801-555-1234', 'direct', 'Direct'],
    ['D 801-555-1234', 'direct', 'D'],
    ['DD: 801-555-1234', 'direct', 'DD'],
    ['Direct Line 801-555-1234', 'direct', 'Direct Line'],
    ['Mobile: 801-555-5678', 'mobile', 'Mobile'],
    ['M. 801-555-5678', 'mobile', 'M.'],
    ['Cell 801-555-5678', 'mobile', 'Cell'],
    ['C: 801-555-5678', 'mobile', 'C'],
    ['Office: 801-555-2000', 'work', 'Office'],
    ['O 801-555-2000', 'work', 'O'],
    ['Work: 801-555-2000', 'work', 'Work'],
    ['W: 801-555-2000', 'work', 'W'],
    ['Fax: 801-555-1001', 'fax', 'Fax'],
    ['F 801-555-1001', 'fax', 'F'],
  ])('%s → %s', (raw, label, observed) => {
    const phone = phoneFromExtraction(extracted(raw, { kind: 'office' }), 0);
    expect(phone).toMatchObject({ label, labelSource: 'card', observedLabel: observed });
    expect(phone.value).toMatch(/^801-555-\d{4}$/);
  });

  it.each(['Tel: 801-555-1000', 'T 801-555-1000', 'Phone: 801-555-1000', 'P. 801-555-1000', 'Ph: 801-555-1000', 'Toll Free: 801-555-1000'])(
    '%s → Type not set, with the printed word kept',
    (raw) => {
      const phone = phoneFromExtraction(extracted(raw, { kind: 'office' }), 0);
      expect(phone).toMatchObject({ label: 'unknown', labelSource: null, value: '801-555-1000' });
      expect(phone.observedLabel).toBe(printedPhoneLabel(raw));
    },
  );

  it('with no printed word, only an exact kind is kept: office and none are Type not set', () => {
    const kinds = ['mobile', 'direct', 'fax', 'office', 'unknown', null];
    expect(kinds.map(kind => phoneFromExtraction(extracted('801-555-1000', { kind }), 0).label))
      .toEqual(['mobile', 'direct', 'fax', 'unknown', 'unknown', 'unknown']);
  });

  it('a printed word wins over the extractor: "Tel" stays Type not set even if read as mobile', () => {
    expect(phoneFromExtraction(extracted('Tel: 801-555-1000', { kind: 'mobile' }), 0).label).toBe('unknown');
  });

  it('keeps the extension apart; an unreadable number keeps its text without the label word', () => {
    expect(phoneFromExtraction(extracted('D: 801-555-1234 x204', { value: '801-555-1234', extension: '204' }), 0))
      .toMatchObject({ label: 'direct', value: '801-555-1234', extension: '204', normalized: '8015551234' });
    expect(phoneFromExtraction(extracted('C: 555-AB12', { value: 'C: 555-AB12' }), 0))
      .toMatchObject({ label: 'mobile', value: '555-AB12', normalized: null });
  });

  it('never home: a card cannot say a number is someone\'s home line', () => {
    expect(phoneFromExtraction(extracted('Home: 801-555-3000'), 0).label).toBe('unknown');
  });
});

describe('a company is not a name, a title or a brand (independent professionals)', () => {
  /** A card through the real assembler: the given person and company text. */
  function card({ name = 'Kristin Sokol', title = null, company = null, fromLogo = false, website = null, email = null } = {}) {
    const base = emptyReading('read');
    const t = (raw, score = 0.95) => (raw ? { raw, score } : { raw: null, score: 0 });
    const reading = {
      ...base,
      person: { ...base.person, fullName: t(name), title: t(title), emails: email ? [t(email)] : [] },
      company: { ...base.company, name: { ...t(company, 0.9), fromLogo }, website: t(website) },
    };
    const result = assembleExtraction(reading, {
      operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', extractedAt: '2026-10-27T22:00:00.000Z', image: image(),
      provider: { id: 'fake', adapterVersion: '1', modelId: 'fake-v1', promptVersion: 'fake-v1' },
    });
    expect(result.ok).toBe(true);
    return { extraction: result.extraction, draft: draftsFromExtraction(result.extraction)[0] };
  }

  it('a personal-brand card (the name as a wordmark, a service line, a personal domain): no company, the name kept as a suggestion', () => {
    const { extraction, draft } = card({
      company: 'Kristin Sokol', fromLogo: true, title: 'Dating Strategy & Matchmaking',
      website: 'kristinsokol.com', email: 'kristin@kristinsokol.com',
    });
    // The server already said so: the text is the person's name, read from a logo.
    expect(extraction.company.safeguards).toEqual(expect.arrayContaining(['PERSON_NAME_AS_COMPANY', 'WEAK_COMPANY_TEXT']));
    expect(draft).toMatchObject({
      name: 'Kristin Sokol', title: 'Dating Strategy & Matchmaking', company: '', website: 'kristinsokol.com',
      companySuggestion: { name: 'Kristin Sokol', reason: 'PERSON_NAME_AS_COMPANY' },
    });
    expect(draft.toCheck).not.toContain('company');
    expect(companyIsUnconfirmed(draft)).toBe(false);
  });

  it('the same in printed text, and in another case: still the person\'s name, still no company', () => {
    const { draft } = card({ company: 'KRISTIN SOKOL' });
    expect(draft.company).toBe('');
    expect(draft.companySuggestion).toEqual({ name: 'KRISTIN SOKOL', reason: 'PERSON_NAME_AS_COMPANY' });
  });

  it('the service line read as both title and company is not a company either', () => {
    const { draft } = card({ title: 'Dating Strategy & Matchmaking', company: 'Dating Strategy & Matchmaking' });
    expect(draft).toMatchObject({ title: 'Dating Strategy & Matchmaking', company: '' });
    expect(draft.companySuggestion).toEqual({ name: 'Dating Strategy & Matchmaking', reason: 'TITLE_AS_COMPANY' });
  });

  it('a real company only in a logo stays filled, marked Check, and counts as unconfirmed until the user touches it', () => {
    const { draft } = card({ name: 'Avery Quinn', company: 'Example Robotics', fromLogo: true, website: 'www.example.com' });
    expect(draft).toMatchObject({ company: 'Example Robotics', companySuggestion: null });
    expect(draft.toCheck).toContain('company');
    expect(companyIsUnconfirmed(draft)).toBe(true);
    // Editing or confirming the field clears its Check (CaptureReview's set()).
    expect(companyIsUnconfirmed({ ...draft, toCheck: draft.toCheck.filter(k => k !== 'company') })).toBe(false);
  });

  it('a printed company that is clearly a company is unchanged', () => {
    const { draft } = card({ name: 'Avery Quinn', company: 'Example Robotics', website: 'www.example.com' });
    expect(draft).toMatchObject({ company: 'Example Robotics', companySuggestion: null, toCheck: [] });
    expect(companyIsUnconfirmed(draft)).toBe(false);
  });

  it('no company text at all: no company and nothing to suggest', () => {
    const { draft } = card({ website: 'kristinsokol.com' });
    expect(draft).toMatchObject({ company: '', companySuggestion: null });
  });

  it('NOT_A_COMPANY names real safeguard codes, and not WEAK_COMPANY_TEXT (a weak read, not something else)', () => {
    for (const code of NOT_A_COMPANY) expect(Object.values(SAFEGUARDS)).toContain(code);
    expect(NOT_A_COMPANY).not.toContain('WEAK_COMPANY_TEXT');
  });
});
