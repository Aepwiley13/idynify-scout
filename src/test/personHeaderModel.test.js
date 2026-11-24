/* global process */
/**
 * The person header's display model and contract (components/contacts/personHeader).
 *
 * What is held here: the model is derived from the contact and nothing else (the contact is
 * never changed, and the model cannot be); it follows the names, photo, phone, social and
 * sticker rules the application already has; it tolerates missing, malformed, imported, very
 * long and international values; every link it offers is safe; the contract draws a control
 * only when there is a real action for it; and both files are pure (no React, Firebase,
 * services, routes, plans, Scout or Contact Hub).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVE_WINDOW_MS, LIMITS, buildPersonHeaderModel, initialsOf, locationText, safeEmail, safeTelHref,
} from '../components/contacts/personHeader/personHeaderModel';
import { PERSON_HEADER_ACTIONS, availableControls, headerParts } from '../components/contacts/personHeader/personHeaderContract';
import { personName } from '../pages/ContactHub/peopleRules';
import { contactDisplayName as cardsName } from '../utils/contactPhoto';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const model = (contact, options = {}) => buildPersonHeaderModel(contact, { now: NOW, ...options });

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

const registry = (...stickers) => new Map(stickers.map((s) => [s.id, { status: 'active', ...s }]));

// ─── Name and initials ───────────────────────────────────────────────────────

describe('the name', () => {
  it.each([
    [{ name: 'Jordan Lee' }, 'Jordan Lee'],
    [{ first_name: 'Jordan', last_name: 'Lee' }, 'Jordan Lee'],
    [{ firstName: 'Jordan', lastName: 'Lee' }, 'Jordan Lee'],
    [{ first_name: 'Jordan' }, 'Jordan'],
    [{ last_name: 'Lee' }, 'Lee'],
    [{ name: 'Jordan Lee', first_name: 'J', last_name: 'L' }, 'Jordan Lee'],
    [{ name: '  Jordan   Lee  ' }, 'Jordan Lee'],
  ])('%j is called %s', (contact, expected) => {
    expect(model(contact).name).toBe(expected);
    expect(model(contact).hasName).toBe(true);
  });

  it('follows the application\'s own rule for what to call a person, which is what Contact Hub shows', () => {
    for (const contact of [
      { name: 'JORDAN LEE' }, { first_name: 'ana', last_name: 'LOPEZ' }, { name: 'Lopez', last_name: 'Lopez' },
      { name: 'sam.ray@x.com', email: 'sam.ray@x.com' }, { first_name: 'undefined', last_name: 'null' },
    ]) {
      const expected = personName(contact);
      const got = model(contact).name;
      // The same, except that the header never uses the email address as a name (it has its own pill).
      expect(got, JSON.stringify(contact)).toBe(contact.email && expected === contact.email ? 'Unknown contact' : expected);
    }
  });

  it('shows a CSV-imported contact: first and last in separate columns, an all-capitals name, and an email in the name column', () => {
    expect(model({ first_name: 'ANA', last_name: 'LOPEZ' }).name).toBe('Ana Lopez');
    const emailOnly = model({ name: 'sam.ray@x.com', email: 'sam.ray@x.com' });
    expect(emailOnly.name).toBe('Unknown contact');
    expect(emailOnly.hasName).toBe(false);
    expect(emailOnly.email).toEqual({ address: 'sam.ray@x.com', href: 'mailto:sam.ray@x.com' });
  });

  it('reads only names that are text: an object, a number or a list in a name field is no name', () => {
    expect(model({ name: { first: 'x' }, first_name: 5, last_name: [] }).name).toBe('Unknown contact');
    expect(model({ name: { first: 'x' }, first_name: 'Ana', last_name: 'Lopez' }).name).toBe('Ana Lopez');
  });

  it('says "Unknown contact", never "undefined", and never the email address, when there is no name', () => {
    for (const contact of [{}, null, undefined, 'a string', 42, [], { name: '   ' }, { name: null }, { first_name: 'undefined' }]) {
      const m = model(contact);
      expect(m.name, String(contact)).toBe('Unknown contact');
      expect(m.hasName).toBe(false);
      expect(m.avatar.initials).toBe('?');
    }
    expect(model({ email: 'a@b.co' }).name).toBe('Unknown contact');
  });

  it('differs from the older contact-card helper only where that helper is wrong for a header (all capitals, an address as a name)', () => {
    expect(cardsName({ name: 'JORDAN LEE' })).toBe('JORDAN LEE');
    expect(model({ name: 'JORDAN LEE' }).name).toBe('Jordan Lee');
    expect(cardsName({ name: 'Jordan Lee' })).toBe(model({ name: 'Jordan Lee' }).name);
  });
});

describe('initials', () => {
  it.each([
    ['Jordan Lee', 'JL'],
    ['Jordan', 'J'],
    ['Mary Ann Smith', 'MS'],
    ['jordan lee', 'JL'],
    ['José Ünal', 'JÜ'],
    ['Åsa', 'Å'],
    ['李小龍', '李'],
    ['田中 太郎', '田太'],
    ['Мария Иванова', 'МИ'],
    ['محمد علي', 'مع'],
    ['Dr. Ana Lopez Jr.', 'DJ'],
    ['(Ana) Lopez', 'AL'],
    ['  ', '?'],
    ['!!! ???', '?'],
    ['', '?'],
  ])('%j is %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it('never splits a character: an accent stays on its letter, an emoji stays whole', () => {
    expect(initialsOf('émile Zola')).toBe('ÉZ');
    expect([...initialsOf('😀 Smile')].length).toBeLessThanOrEqual(2);
    expect(initialsOf('𠮷野 家')).toBe('𠮷家');
    for (const out of [initialsOf('𠮷野 家'), initialsOf('émile Zola')]) {
      // No lone surrogate halves.
      expect(out).toBe(out.normalize('NFC') === out ? out : out.normalize('NFC') && out);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    }
  });

  it('is drawn for the person even when there is a photo (the fallback is always available)', () => {
    const m = model({ name: 'Jordan Lee', photo_url: 'https://images.example.com/jl.jpg' });
    expect(m.avatar).toEqual({ initials: 'JL', photoUrl: 'https://images.example.com/jl.jpg', fullPhotoUrl: 'https://images.example.com/jl.jpg' });
  });
});

// ─── Photo ───────────────────────────────────────────────────────────────────

describe('the photo', () => {
  it('is a real photo or nothing: placeholders, non-http values and junk are not photos', () => {
    for (const photo_url of [
      undefined, null, '', '   ', 42, {}, 'not a url', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/y.jpg',
      'https://static.licdn.com/sc/h/9c8pery4andzj6ohjkjp54ma2', 'https://x.test/ghost-person.png', 'https://x.test/default-avatar.png',
      'https://media.licdn.com/dms/image/company-logo_100_100/x',
    ]) {
      const m = model({ name: 'Ana', photo_url });
      expect(m.avatar.photoUrl, String(photo_url)).toBeNull();
      expect(m.avatar.fullPhotoUrl, String(photo_url)).toBeNull();
      expect(m.avatar.initials).toBe('A');
    }
  });

  it('uses the contact\'s own photo address, trimmed, for both sizes', () => {
    const m = model({ name: 'Ana', photo_url: '  https://images.example.com/a.jpg  ' });
    expect(m.avatar.photoUrl).toBe('https://images.example.com/a.jpg');
    expect(m.avatar.fullPhotoUrl).toBe('https://images.example.com/a.jpg');
  });
});

// ─── Title, organization, location ───────────────────────────────────────────

describe('title, organization and location', () => {
  it('reads title, and company_name else company, and leaves out what is missing or not text', () => {
    expect(model({ title: 'Program Director', company_name: 'UAC' })).toMatchObject({ title: 'Program Director', organization: 'UAC' });
    expect(model({ title: 'Director', company: 'Old Co' }).organization).toBe('Old Co');
    expect(model({ company_name: 'New Co', company: 'Old Co' }).organization).toBe('New Co');
    expect(model({ company_name: '   ', company: 'Old Co' }).organization).toBe('Old Co');
    for (const bad of [undefined, null, '', '  ', 0, 7, {}, [], true]) {
      expect(model({ title: bad, company_name: bad, company: bad })).toMatchObject({ title: null, organization: null });
    }
  });

  it('tidies whitespace and control characters in a line', () => {
    expect(model({ title: '  VP \n of\tSales\u0000 ' }).title).toBe('VP of Sales');
  });

  it.each([
    [{ location: 'Salt Lake City' }, 'Salt Lake City'],
    [{ location: ' Salt Lake City, UT ', city: 'Provo' }, 'Salt Lake City, UT'],
    [{ city: 'Salt Lake City', state: 'UT', country: 'United States' }, 'Salt Lake City, UT, United States'],
    [{ city: 'Salt Lake City', state: 'UT' }, 'Salt Lake City, UT'],
    [{ state: 'UT' }, 'UT'],
    [{ city: 'Singapore', country: 'Singapore' }, 'Singapore'],
    [{ city: 'São Paulo', country: 'Brasil' }, 'São Paulo, Brasil'],
    [{ city: '東京', country: '日本' }, '東京, 日本'],
    [{ location: '', city: '', state: null }, null],
    [{ location: 5, city: {}, state: [], country: undefined }, null],
    [{}, null],
  ])('location from %j is %j', (contact, expected) => {
    expect(locationText(contact)).toBe(expected);
    expect(model(contact).location).toBe(expected);
  });
});

// ─── Phone and email ─────────────────────────────────────────────────────────

describe('the primary phone', () => {
  it('is the number to call: a mobile before a main line, never a fax, and carries its extension in the text', () => {
    const m = model({ phones: [
      { id: '1', value: '801-555-0100', label: 'main' },
      { id: '2', value: '801-555-0199', label: 'mobile' },
      { id: '3', value: '801-555-0111', label: 'fax' },
    ] });
    expect(m.phone).toEqual({ text: '801-555-0199', href: 'tel:8015550199', label: 'mobile' });
    expect(model({ phones: [{ id: '1', value: '801-555-0100 x204', label: 'work' }] }).phone).toEqual({ text: '801-555-0100 x204', href: 'tel:8015550100', label: 'work' });
    expect(model({ phones: [{ id: '3', value: '801-555-0111', label: 'fax' }] }).phone).toBeNull();
  });

  it('reads the older single fields and the provider\'s object the way the rest of the app does', () => {
    expect(model({ phone: '(801) 555-0123' }).phone).toMatchObject({ text: '(801) 555-0123', href: 'tel:8015550123' });
    expect(model({ phone_mobile: '+1 801 555 0123', phone_work: '801 555 0000' }).phone).toMatchObject({ href: 'tel:+18015550123', label: 'mobile' });
    expect(model({ phone: { sanitized_number: '+18015550123', type: 'mobile' } }).phone).toMatchObject({ href: 'tel:+18015550123' });
  });

  it('is left out when there is no number, or none that can be dialled', () => {
    for (const contact of [{}, { phone: '' }, { phone: '   ' }, { phone: 'call me' }, { phone: '12345' }, { phone: '1'.repeat(16) }, { phones: [] }, { phone: {} }, { phone: [] }]) {
      expect(model(contact).phone, JSON.stringify(contact)).toBeNull();
    }
  });

  it('makes tel: links of digits and a leading + only', () => {
    expect(safeTelHref('+1 (801) 555-0123')).toBe('tel:+18015550123');
    expect(safeTelHref('801.555.0123')).toBe('tel:8015550123');
    expect(safeTelHref(8015550123)).toBe('tel:8015550123');
    for (const bad of [null, undefined, '', 'abc', '123456', '1'.repeat(16), {}, [], true]) expect(safeTelHref(bad), String(bad)).toBeNull();
    // Whatever surrounds the digits is dropped: nothing else can reach the link.
    expect(safeTelHref('801 555 0123;ext=1<script>')).toBe('tel:80155501231');
    expect(safeTelHref('javascript:801555012345')).toBe('tel:801555012345');
    for (const out of [safeTelHref('+1 (801) 555-0123'), safeTelHref('801 555 0123;x=<b>')]) expect(out).toMatch(/^tel:\+?\d+$/);
  });
});

describe('the primary email', () => {
  it('is the first usable address, in the order the contact card reads them', () => {
    expect(model({ emails: [{ value: 'a@x.co' }, { value: 'b@x.co' }], email: 'c@x.co' }).email?.address).toBe('a@x.co');
    expect(model({ email: 'c@x.co', work_email: 'd@x.co' }).email?.address).toBe('c@x.co');
    expect(model({ work_email: 'd@x.co' }).email?.address).toBe('d@x.co');
    expect(model({ emails: ['plain@x.co'] }).email?.address).toBe('plain@x.co');
  });

  it('skips an address that is not usable rather than showing nothing when a good one follows', () => {
    expect(model({ emails: [{ value: 'not an email' }, { value: 'good@x.co' }] }).email?.address).toBe('good@x.co');
    expect(model({ email: 'bad', work_email: 'ok@x.co' }).email?.address).toBe('ok@x.co');
  });

  it('is left out when there is none, or none that is safe', () => {
    for (const contact of [{}, { email: '' }, { email: 5 }, { emails: [] }, { emails: [null, {}, { value: 5 }] }, { email: 'a b@x.co' }, { email: 'nobody@' }]) {
      expect(model(contact).email, JSON.stringify(contact)).toBeNull();
    }
  });

  it('makes a mailto: link that cannot carry a second recipient, a subject, a body or a header', () => {
    expect(safeEmail('jordan@communityslc.org')).toEqual({ address: 'jordan@communityslc.org', href: 'mailto:jordan@communityslc.org' });
    expect(safeEmail(' jordan+tag@sub.example.co.uk ')).toMatchObject({ address: 'jordan+tag@sub.example.co.uk' });
    for (const bad of [
      'a@x.co,b@y.co', 'a@x.co;b@y.co', 'a@x.co,b', 'a@x.co;b', 'a,b@x.co', 'a;b@x.co', 'a@x.co?subject=hi', 'a@x.co&cc=b@y.co', 'a@x.co#frag', 'a@x.co%0d%0abcc:evil@y.co',
      'a@x.co\r\nbcc:evil@y.co', '"a b"@x.co', '<a@x.co>', 'a@x.co>', "o'brien@x.co", 'a@@x.co', '@x.co', 'a@x', 'a@x.c', '', '   ', null, undefined, 7, {},
      `${'a'.repeat(250)}@x.co`,
    ]) {
      expect(safeEmail(bad), String(bad)).toBeNull();
    }
    expect(safeEmail('josé@exämple.com')?.href).toBe('mailto:jos%C3%A9@ex%C3%A4mple.com');
  });
});

// ─── Social ──────────────────────────────────────────────────────────────────

describe('social links', () => {
  it('offers LinkedIn, Instagram and Facebook, as links rebuilt from the platform\'s own rule', () => {
    const m = model({
      linkedin_url: 'https://www.linkedin.com/in/Jordan-Lee/?trk=abc',
      social_profiles: [{ platform: 'instagram', handle: 'jordan.lee', url: 'https://instagram.com/jordan.lee', status: 'user_confirmed' }],
      facebook_url: 'https://fb.com/jordan.lee.7',
    });
    expect(m.social).toEqual([
      { platform: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/jordan-lee', handle: 'jordan-lee' },
      { platform: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/jordan.lee', handle: 'jordan.lee' },
      { platform: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/jordan.lee.7', handle: 'jordan.lee.7' },
    ]);
  });

  it('never offers a link that is not a profile on that platform', () => {
    for (const linkedin_url of [
      'javascript:alert(1)', 'https://evil.example/in/jordan', 'https://linkedin.com.evil.example/in/jordan', 'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/in/', 'http://[::1', 'linkedin', '   ', 5, {}, 'data:text/html,<script>', 'https://www.linkedin.com/in/a b',
    ]) {
      expect(model({ linkedin_url }).social, String(linkedin_url)).toEqual([]);
    }
    expect(model({ social_profiles: [{ platform: 'instagram', url: 'javascript:alert(1)', handle: 'x' }, null, 'junk', { platform: 'nope' }] }).social).toEqual([]);
    for (const link of model({ linkedin_url: 'https://www.linkedin.com/in/jordan?next=//evil' }).social) expect(link.url).toMatch(/^https:\/\/www\.(linkedin|instagram|facebook)\.com\//);
  });

  it('lists a profile once, however many places it is stored', () => {
    const m = model({ linkedin_url: 'https://www.linkedin.com/in/jordan', social_profiles: [{ platform: 'linkedin', handle: 'jordan', url: 'https://www.linkedin.com/in/jordan' }] });
    expect(m.social).toHaveLength(1);
  });
});

// ─── Stickers ────────────────────────────────────────────────────────────────

describe('stickers', () => {
  const partner = { id: 's1', name: 'Partner', color: 'purple', emoji: '🤝' };
  const community = { id: 's2', name: 'Community', color: 'green' };
  const archived = { id: 's3', name: 'Old', color: 'gray', status: 'archived' };

  it('are null where stickers are not available (no registry), and a list where they are', () => {
    expect(model({ sticker_ids: ['s1'] }).stickers).toBeNull();
    expect(model({ sticker_ids: ['s1'] }, { stickersById: null }).stickers).toBeNull();
    expect(model({ sticker_ids: ['s1'] }, { stickersById: [] }).stickers).toBeNull();
    expect(model({}, { stickersById: registry() }).stickers).toEqual([]);
  });

  it('show the contact\'s own active stickers in display order, with colour and emoji when there is one', () => {
    const m = model({ sticker_ids: ['s2', 's1', 's3', 'gone'] }, { stickersById: registry(partner, community, archived) });
    expect(m.stickers).toEqual([
      { id: 's2', name: 'Community', color: 'green', emoji: null },
      { id: 's1', name: 'Partner', color: 'purple', emoji: '🤝' },
    ]);
  });

  it('copes with a sticker with no emoji, an unknown colour, a blank name or an over-long emoji', () => {
    const m = model({ sticker_ids: ['a', 'b', 'c', 'd'] }, { stickersById: registry(
      { id: 'a', name: 'Plain', color: 'teal' },
      { id: 'b', name: 'Odd colour', color: 'magenta', emoji: '  ' },
      { id: 'c', name: '   ', color: 'blue' },
      { id: 'd', name: 'Long', color: 'coral', emoji: '🙂'.repeat(40) },
    ) });
    expect(m.stickers.map((s) => s.name)).toEqual(['Long', 'Odd colour', 'Plain']);
    expect(m.stickers.find((s) => s.name === 'Odd colour')).toMatchObject({ color: 'gray', emoji: null });
    expect([...m.stickers.find((s) => s.name === 'Long').emoji].length).toBeLessThanOrEqual(LIMITS.emoji);
  });

  it('keeps international sticker names whole', () => {
    const m = model({ sticker_ids: ['j'] }, { stickersById: registry({ id: 'j', name: '友達 · Amigos 🌎', color: 'amber' }) });
    expect(m.stickers[0].name).toBe('友達 · Amigos 🌎');
  });

  it('are not mistaken for tags: the contact\'s tags are not stickers', () => {
    expect(model({ tags: ['vip'], sticker_ids: [] }, { stickersById: registry(partner) }).stickers).toEqual([]);
  });
});

// ─── Activity ────────────────────────────────────────────────────────────────

describe('the activity indicator', () => {
  const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

  it('is active for a message or contact in the last 30 days, and not otherwise', () => {
    expect(model({ last_message_at: daysAgo(3) }).activity).toEqual({ active: true, lastActivityAt: daysAgo(3) });
    expect(model({ last_contacted_at: daysAgo(29) }).activity.active).toBe(true);
    expect(model({ last_contacted_at: daysAgo(31) }).activity.active).toBe(false);
    expect(model({ last_message_at: daysAgo(30) }).activity.active).toBe(false);
    expect(ACTIVE_WINDOW_MS).toBe(30 * 86_400_000);
  });

  it('uses the last message, else the last contact, as the contact card does', () => {
    expect(model({ last_message_at: daysAgo(40), last_contacted_at: daysAgo(2) }).activity.active).toBe(false);
    expect(model({ last_message_at: 'not a date', last_contacted_at: daysAgo(2) }).activity.active).toBe(true);
  });

  it('is quiet, never an error, when there is no date or it is not one', () => {
    for (const bad of [undefined, null, '', 'yesterday', {}, [], NaN, true]) {
      expect(model({ last_message_at: bad }).activity).toEqual({ active: false, lastActivityAt: null });
    }
  });

  it('reads a date, a time in milliseconds and a Firestore-style timestamp', () => {
    expect(model({ last_message_at: new Date(NOW - 86_400_000) }).activity.active).toBe(true);
    expect(model({ last_message_at: NOW - 86_400_000 }).activity.active).toBe(true);
    expect(model({ last_message_at: { toDate: () => new Date(NOW - 86_400_000) } }).activity.active).toBe(true);
    expect(model({ last_message_at: { toDate: () => { throw new Error('x'); } } }).activity.active).toBe(false);
  });
});

// ─── Tolerance ───────────────────────────────────────────────────────────────

describe('missing, malformed, long and international values', () => {
  it('builds a complete model from a contact with nothing, and from things that are not contacts', () => {
    for (const contact of [{}, null, undefined, 'x', 1, true, [], () => {}, Symbol.iterator.toString()]) {
      const m = model(contact);
      expect(m).toMatchObject({
        name: 'Unknown contact', hasName: false, title: null, organization: null, location: null,
        avatar: { initials: '?', photoUrl: null, fullPhotoUrl: null }, phone: null, email: null, social: [], stickers: null,
        activity: { active: false, lastActivityAt: null },
      });
    }
  });

  it('survives wrongly-typed values in every field', () => {
    const junk = {
      name: { first: 'x' }, first_name: 5, last_name: [], title: {}, company_name: 7, company: [], location: 9, city: {}, state: true,
      country: () => {}, photo_url: 5, phones: 'x', phone: 7, emails: 'x', email: {}, work_email: [], linkedin_url: 3, social_profiles: 'x',
      facebook_url: {}, sticker_ids: 'x', last_message_at: {}, last_contacted_at: [],
    };
    expect(() => model(junk, { stickersById: registry() })).not.toThrow();
    const m = model(junk, { stickersById: registry() });
    expect(m.name).toBe('Unknown contact');
    expect(JSON.stringify(m)).not.toMatch(/undefined|\[object Object\]|NaN/);
  });

  it('keeps complete values, however long: the model never shortens what the contact holds', () => {
    const long = 'Ünïcødé '.repeat(500).trim();
    const m = model({ name: long, title: long, company_name: long, location: long, phone: `801-555-0100 x${'1'.repeat(6)}` });
    for (const field of ['name', 'title', 'organization', 'location']) {
      expect(m[field], field).toBe(long);
      expect(m[field].endsWith('…'), field).toBe(false);
    }
    // A name of 5,000 characters, a title of 10,000, in international scripts and with emoji: whole.
    const huge = `${'李小龍 '.repeat(1700)}${'👩🏽‍💻'.repeat(500)}`.trim();
    expect(model({ name: huge, title: huge }).name).toBe(huge);
    expect(model({ name: huge, title: huge }).title).toBe(huge);
    expect(model({ title: 'x'.repeat(LIMITS.emoji + 5000) }).title).toHaveLength(LIMITS.emoji + 5000);
    expect(model({ location: 'a, '.repeat(1000).replace(/, $/, '') }).location).toHaveLength(2998);
  });

  it('keeps a long sticker name whole, and keeps only a sticker\'s emoji to one small mark', () => {
    const name = 'Community partner and supporter of the annual school fundraiser '.repeat(3).trim();
    const m = model({ sticker_ids: ['a'] }, { stickersById: registry({ id: 'a', name, color: 'teal', emoji: '🙂'.repeat(60) }) });
    expect(m.stickers[0].name).toBe(name);
    expect([...m.stickers[0].emoji].length).toBeLessThanOrEqual(LIMITS.emoji);
  });

  it('tidies a long value without losing any of it: control characters and runs of spaces go, words stay', () => {
    const messy = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' \n\t ');
    expect(model({ title: messy }).title).toBe(Array.from({ length: 300 }, (_, i) => `word${i}`).join(' '));
  });

  it('keeps international text whole', () => {
    const m = model({ name: '李小龍', title: '創辦人兼執行長', company_name: 'Café Ünïcode 株式会社', city: '東京', country: '日本' });
    expect(m).toMatchObject({ name: '李小龍', title: '創辦人兼執行長', organization: 'Café Ünïcode 株式会社', location: '東京, 日本' });
    expect(model({ name: 'محمد علي', title: 'مدير' })).toMatchObject({ name: 'محمد علي', title: 'مدير' });
    expect(model({ name: 'Ñandú Öztürk' }).name).toBe('Ñandú Öztürk');
  });

  it('does not mistake an HTML-looking value for markup: it is only text', () => {
    // (A name in all lower case or all capitals is cased by the application's own name rule; this one is mixed.)
    const m = model({ name: '<IMG src=x onError=alert(1)>', title: '<b>CEO</b>' });
    expect(m.name).toBe('<IMG src=x onError=alert(1)>');
    expect(m.title).toBe('<b>CEO</b>');
  });
});

// ─── No mutation ─────────────────────────────────────────────────────────────

describe('the contact is never changed, and the model cannot be', () => {
  const contact = () => ({
    id: 'c1', name: 'Jordan Lee', title: 'Partner', company_name: 'Community Partners', city: 'Salt Lake City', state: 'UT',
    photo_url: 'https://images.example.com/jl.jpg', phones: [{ id: '1', value: '801-555-0199', label: 'mobile' }],
    emails: [{ id: '0', value: 'jordan@communityslc.org', label: 'work' }], linkedin_url: 'https://www.linkedin.com/in/jordan-lee',
    social_profiles: [{ platform: 'instagram', handle: 'jordan.lee', url: 'https://www.instagram.com/jordan.lee' }],
    sticker_ids: ['s1', 's2'], last_message_at: '2026-11-10T00:00:00Z', tags: ['vip'],
  });

  it('leaves a frozen contact (and its nested lists) exactly as it was', () => {
    const frozen = deepFreeze(contact());
    const before = JSON.stringify(frozen);
    expect(() => model(frozen, { stickersById: registry({ id: 's1', name: 'A', color: 'blue' }, { id: 's2', name: 'B', color: 'teal' }) })).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('shares nothing with the contact: changing the contact afterwards does not change a model already built', () => {
    const c = contact();
    const m = model(c);
    c.name = 'Someone Else';
    c.phones[0].value = '000';
    c.social_profiles.push({ platform: 'facebook', handle: 'x', url: 'https://www.facebook.com/x' });
    expect(m.name).toBe('Jordan Lee');
    expect(m.phone.text).toBe('801-555-0199');
    expect(m.social.map((s) => s.platform)).toEqual(['linkedin', 'instagram']);
  });

  it('is deeply frozen, so a component cannot edit it, and is the same for the same contact', () => {
    const m = model(contact(), { stickersById: registry({ id: 's1', name: 'A', color: 'blue' }) });
    expect(Object.isFrozen(m)).toBe(true);
    for (const part of [m.avatar, m.phone, m.email, m.social, m.social[0], m.stickers, m.stickers[0], m.activity]) expect(Object.isFrozen(part)).toBe(true);
    expect(() => { 'use strict'; m.name = 'x'; }).toThrow();
    expect(() => { m.stickers.push({}); }).toThrow();
    expect(model(contact())).toEqual(model(contact()));
  });

  it('carries no contact id and no field that could be written back as a contact', () => {
    const keys = Object.keys(model(contact()));
    expect(keys.sort()).toEqual(['activity', 'avatar', 'email', 'hasName', 'location', 'name', 'organization', 'phone', 'social', 'stickers', 'title']);
    expect(JSON.stringify(model(contact()))).not.toMatch(/"id":"c1"|tags|vip/);
  });
});

// ─── The contract ────────────────────────────────────────────────────────────

describe('the component contract', () => {
  const noop = () => {};

  it('names the five callbacks a parent may supply', () => {
    expect(PERSON_HEADER_ACTIONS).toEqual(['onEdit', 'onPhotoClick', 'onAddSticker', 'onRemoveSticker', 'onContactAction']);
    expect(Object.isFrozen(PERSON_HEADER_ACTIONS)).toBe(true);
  });

  it('allows a control only when it is given a real function for it', () => {
    expect(availableControls(undefined)).toEqual({ edit: false, photo: false, addSticker: false, removeSticker: false, contactAction: false });
    expect(availableControls(null)).toEqual(availableControls({}));
    expect(availableControls({ onEdit: noop, onAddSticker: noop })).toEqual({ edit: true, photo: false, addSticker: true, removeSticker: false, contactAction: false });
    expect(availableControls(Object.fromEntries(PERSON_HEADER_ACTIONS.map((n) => [n, noop])))).toEqual({ edit: true, photo: true, addSticker: true, removeSticker: true, contactAction: true });
    for (const notAFunction of [true, 1, 'onEdit', {}, [], null, undefined]) {
      expect(Object.values(availableControls({ onEdit: notAFunction, onPhotoClick: notAFunction, onAddSticker: notAFunction, onRemoveSticker: notAFunction })).some(Boolean), String(notAFunction)).toBe(false);
    }
    expect(availableControls('actions')).toEqual(availableControls({}));
    expect(Object.isFrozen(availableControls({}))).toBe(true);
  });

  it('works out which parts to draw from the model alone: a part with nothing to show is left out', () => {
    const empty = headerParts(model({ name: 'Ana' }));
    expect(empty).toMatchObject({ subtitle: false, location: false, phone: false, email: false, social: false, stickers: false, addSticker: false });
    const full = headerParts(model({
      name: 'Jordan Lee', title: 'Partner', city: 'SLC', phone: '801-555-0199', email: 'j@x.co', linkedin_url: 'https://www.linkedin.com/in/jordan',
    }));
    expect(full).toMatchObject({ subtitle: true, location: true, phone: true, email: true, social: true });
    expect(headerParts(model({ name: 'Ana', company: 'Acme' })).subtitle).toBe(true);
  });

  it('draws the sticker area only where stickers are available, and an add control only with an action for it', () => {
    const none = model({ name: 'Ana' });
    const available = model({ name: 'Ana' }, { stickersById: registry() });
    const withStickers = model({ name: 'Ana', sticker_ids: ['s1'] }, { stickersById: registry({ id: 's1', name: 'A', color: 'blue' }) });
    // Not available: nothing, even with an action.
    expect(headerParts(none, { onAddSticker: noop })).toMatchObject({ stickers: false, addSticker: false });
    // Available but empty: nothing without an action (no dead control), the add control with one.
    expect(headerParts(available)).toMatchObject({ stickers: false, addSticker: false });
    expect(headerParts(available, { onAddSticker: noop })).toMatchObject({ stickers: true, addSticker: true });
    // Pills to show: the area is there, and the add control follows the action.
    expect(headerParts(withStickers)).toMatchObject({ stickers: true, addSticker: false });
    expect(headerParts(withStickers, { onAddSticker: noop })).toMatchObject({ stickers: true, addSticker: true });
  });

  it('tolerates being handed nothing', () => {
    expect(() => headerParts(undefined)).not.toThrow();
    expect(headerParts(null)).toMatchObject({ subtitle: false, phone: false, stickers: false });
  });
});

// ─── Purity ──────────────────────────────────────────────────────────────────

describe('the files stand alone', () => {
  const dir = resolve(process.cwd(), 'src/components/contacts/personHeader');
  const files = ['personHeaderModel.js', 'personHeaderContract.js'];
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const importsOf = (text) => [...strip(text).matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('import only pure helpers: no React, Firebase, router, service, context, plan, billing, Scout or Contact Hub', () => {
    const allowed = [
      /^\.\/personHeader\w+\.js$/,
      /^\.\.\/\.\.\/\.\.\/utils\/(contactDisplayName|contactPhoto|contactPhones|socialProfiles|savedContactEmail)\.js$/,
      /^\.\.\/\.\.\/\.\.\/services\/stickers\/stickerCore\.js$/,
    ];
    for (const file of files) {
      const imports = importsOf(readFileSync(resolve(dir, file), 'utf8'));
      for (const from of imports) {
        expect(allowed.some((re) => re.test(from)), `${file} imports ${from}`).toBe(true);
        expect(from).not.toMatch(/react|firebase|router|\/services\/(?!stickers\/stickerCore)|context|billing|plan|scout|ContactHub|axios/i);
      }
    }
  });

  it('read nothing from the page, the network, storage or the clock except the time they are told to judge by', () => {
    for (const file of files) {
      const source = strip(readFileSync(resolve(dir, file), 'utf8'));
      expect(source, file).not.toMatch(/\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|console)\b/);
    }
    // Date.now() is the one clock read, as a default for `now`.
    expect(strip(readFileSync(resolve(dir, 'personHeaderModel.js'), 'utf8')).match(/Date\.now\(\)/g)).toHaveLength(1);
    expect(strip(readFileSync(resolve(dir, 'personHeaderContract.js'), 'utf8'))).not.toMatch(/Date\./);
  });

  it('write no data: nothing named like a save, an update or a write', () => {
    for (const file of files) {
      expect(strip(readFileSync(resolve(dir, file), 'utf8')), file).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction|\.save\(|\.write\(/);
    }
  });
});
