/**
 * Contact Hub — My Card's rules, on their own: what a card holds, what a valid
 * value is, and what another person may ever be shown. Pure functions, no
 * rendering and no storage.
 */
import { describe, it, expect } from 'vitest';
import {
  CARD_FIELDS, NAME_FIELDS, SHAREABLE_FIELDS, DEFAULT_SHARE, CARD_LIMITS,
  CARD_SCHEMA_VERSION, CARD_DOC_SEGMENTS, PUBLIC_VIEW_KEYS,
  normalizeCardField, normalizeShare, normalizeCard, newCard,
  cardDisplayName, cardInitials, publicCardView, publishedCardView,
  isPhotoData, isPhotoPicture, PHOTO_TEXT_MAX_CHARS,
} from '../utils/myCardRules';
import { PHOTO } from '../utils/photoPrep';
import { EXIF, base64Of, fingerprintOf, jpegBytes, photoDataUrl } from './helpers/photoFixtures';
import { encodeBase64 } from '../capture/preparedImage';

const ALL_ON = Object.fromEntries(SHAREABLE_FIELDS.map((field) => [field, true]));

const fullCard = (extra = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  photoUrl: 'https://images.example.com/ada.jpg',
  title: 'Analyst',
  organization: 'Analytical Engines',
  email: 'ada@example.com',
  phone: '+1 (555) 010-2000',
  linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  instagram: 'ada.l',
  website: 'https://ada.example.com/',
  share: { ...ALL_ON },
  sharingEnabled: true,
  ...extra,
});

describe('the card model', () => {
  it('has a switch for every field but the name, and a limit for every field', () => {
    expect([...NAME_FIELDS, ...SHAREABLE_FIELDS].sort()).toEqual([...CARD_FIELDS].sort());
    expect(Object.keys(DEFAULT_SHARE).sort()).toEqual([...SHAREABLE_FIELDS].sort());
    expect(Object.keys(CARD_LIMITS).sort()).toEqual([...CARD_FIELDS].sort());
  });

  it('names where a card will be stored', () => {
    expect(CARD_DOC_SEGMENTS('u1')).toEqual(['users', 'u1', 'card', 'main']);
  });

  it('cannot have its defaults changed by a caller', () => {
    expect(Object.isFrozen(DEFAULT_SHARE)).toBe(true);
    expect(Object.isFrozen(SHAREABLE_FIELDS)).toBe(true);
    expect(Object.isFrozen(CARD_FIELDS)).toBe(true);
  });
});

describe('privacy defaults', () => {
  it('starts email and phone private', () => {
    expect(DEFAULT_SHARE.email).toBe(false);
    expect(DEFAULT_SHARE.phone).toBe(false);
  });

  it('gives a new card the default switches and sharing off', () => {
    const card = newCard();
    expect(card.share).toEqual(DEFAULT_SHARE);
    expect(card.share).not.toBe(DEFAULT_SHARE);
    expect(card.sharingEnabled).toBe(false);
    expect(card.schemaVersion).toBe(CARD_SCHEMA_VERSION);
    for (const field of CARD_FIELDS) expect(card[field]).toBe('');
  });

  it('prefills a new card from suggestions, validated like anything typed', () => {
    const card = newCard({ firstName: '  Ada ', email: 'ADA@Example.com', website: 'javascript:alert(1)', uid: 'u1' });
    expect(card.firstName).toBe('Ada');
    expect(card.email).toBe('ada@example.com');
    expect(card.website).toBe('');
    expect(card).not.toHaveProperty('uid');
  });

  it('does not let suggestions turn on a switch or sharing', () => {
    const card = newCard({ firstName: 'Ada', share: { email: true, phone: true }, sharingEnabled: true });
    expect(card.share).toEqual(DEFAULT_SHARE);
    expect(card.sharingEnabled).toBe(false);
  });

  it('keeps a new card\'s email and phone out of the view, though they are filled in', () => {
    const view = publicCardView(newCard({ firstName: 'Ada', email: 'ada@example.com', phone: '555 010 2000' }));
    expect(view).not.toHaveProperty('email');
    expect(view).not.toHaveProperty('phone');
  });

  it('treats a stored card with no switches as sharing nothing but the name', () => {
    const { share, ...noSwitches } = fullCard();
    expect(share).toBeDefined();
    expect(publicCardView(noSwitches)).toEqual({ name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', initials: 'AL' });
  });
});

describe('the switches', () => {
  it('counts only an exact true as on', () => {
    const share = normalizeShare({ email: 'true', phone: 1, title: 'yes', organization: {}, website: [], photoUrl: true });
    expect(share).toEqual({ ...Object.fromEntries(SHAREABLE_FIELDS.map((f) => [f, false])), photoUrl: true });
  });

  it('is all off for anything that is not a set of switches', () => {
    const allOff = Object.fromEntries(SHAREABLE_FIELDS.map((f) => [f, false]));
    for (const bad of [null, undefined, 'all', 7, true, [], [true, true]]) {
      expect(normalizeShare(bad)).toEqual(allOff);
    }
  });

  it('keeps only known fields, and never a switch for the name', () => {
    const share = normalizeShare({ firstName: true, lastName: true, ssn: true, email: true });
    expect(Object.keys(share).sort()).toEqual([...SHAREABLE_FIELDS].sort());
    expect(share.email).toBe(true);
  });

  it('does not read a switch from the prototype', () => {
    const inherited = Object.create({ email: true, phone: true });
    expect(normalizeShare(inherited).email).toBe(false);
    expect(normalizeShare(inherited).phone).toBe(false);
  });
});

describe('what somebody else may see', () => {
  it('shows every field that is switched on, filled in and valid', () => {
    expect(publicCardView(fullCard())).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      initials: 'AL',
      photoUrl: 'https://images.example.com/ada.jpg',
      title: 'Analyst',
      organization: 'Analytical Engines',
      email: 'ada@example.com',
      phone: '+1 (555) 010-2000',
      linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
      instagram: 'ada.l',
      website: 'https://ada.example.com/',
    });
  });

  it('leaves out each field whose switch is off, one at a time', () => {
    for (const field of SHAREABLE_FIELDS) {
      const view = publicCardView(fullCard({ share: { ...ALL_ON, [field]: false } }));
      expect(view).not.toHaveProperty(field);
      for (const other of SHAREABLE_FIELDS.filter((f) => f !== field)) expect(view).toHaveProperty(other);
    }
  });

  it('leaves out a field that is switched on but empty', () => {
    const view = publicCardView(fullCard({ phone: '', title: '   ' }));
    expect(view).not.toHaveProperty('phone');
    expect(view).not.toHaveProperty('title');
  });

  it('leaves out a field that is switched on but not valid', () => {
    const view = publicCardView(fullCard({
      email: 'not-an-email', phone: '<script>', website: 'javascript:alert(1)',
      photoUrl: 'http://images.example.com/ada.jpg', linkedinUrl: 'https://evil.example.com/in/ada',
    }));
    for (const field of ['email', 'phone', 'website', 'photoUrl', 'linkedinUrl']) expect(view).not.toHaveProperty(field);
  });

  it('never carries the switches, sharing, the version or anything unexpected', () => {
    const view = publicCardView(fullCard({
      uid: 'u1', userId: 'u1', createdAt: 123, updatedAt: 456, notes: 'private', homeAddress: '1 Main St',
      _internal: { token: 'secret' },
    }));
    for (const key of Object.keys(view)) expect(PUBLIC_VIEW_KEYS).toContain(key);
    expect(JSON.stringify(view)).not.toMatch(/secret|private|Main St|u1/);
    for (const key of ['share', 'sharingEnabled', 'schemaVersion']) expect(view).not.toHaveProperty(key);
  });

  it('returns a new frozen object and leaves the card as it was', () => {
    const card = fullCard();
    const before = JSON.parse(JSON.stringify(card));
    const view = publicCardView(card);
    expect(Object.isFrozen(view)).toBe(true);
    expect(view).not.toBe(card);
    expect(card).toEqual(before);
  });

  it('has no view at all without a name', () => {
    expect(publicCardView(fullCard({ firstName: '', lastName: '' }))).toBeNull();
    expect(publicCardView(fullCard({ firstName: '   ', lastName: null }))).toBeNull();
  });

  it('has no view for anything that is not a card', () => {
    for (const bad of [null, undefined, '', 'Ada', 7, true, [], [fullCard()], () => fullCard()]) {
      expect(publicCardView(bad)).toBeNull();
    }
  });

  it('shows a card with only one part of the name', () => {
    expect(publicCardView({ firstName: 'Ada' })).toEqual({ name: 'Ada', firstName: 'Ada', lastName: '', initials: 'AD' });
  });

  it('does not depend on sharing being on: it is also the owner\'s preview', () => {
    expect(publicCardView(fullCard({ sharingEnabled: false }))).toHaveProperty('email', 'ada@example.com');
  });
});

describe('what a public page may show', () => {
  it('is the same view when sharing is on', () => {
    expect(publishedCardView(fullCard())).toEqual(publicCardView(fullCard()));
  });

  it('is nothing unless sharing is exactly true', () => {
    for (const sharingEnabled of [false, undefined, null, 'true', 1, {}, []]) {
      expect(publishedCardView(fullCard({ sharingEnabled }))).toBeNull();
    }
    const { sharingEnabled, ...missing } = fullCard();
    expect(sharingEnabled).toBe(true);
    expect(publishedCardView(missing)).toBeNull();
  });

  it('is nothing for anything that is not a card, or a card with no name', () => {
    expect(publishedCardView(null)).toBeNull();
    expect(publishedCardView([])).toBeNull();
    expect(publishedCardView({ sharingEnabled: true })).toBeNull();
  });
});

describe('a card as it would be stored', () => {
  it('keeps only known fields', () => {
    const { card } = normalizeCard(fullCard({ uid: 'u1', createdAt: 1, notes: 'x' }));
    expect(Object.keys(card).sort()).toEqual([...CARD_FIELDS, 'schemaVersion', 'share', 'sharingEnabled'].sort());
  });

  it('is valid when every value is', () => {
    const { card, errors, valid } = normalizeCard(fullCard());
    expect(valid).toBe(true);
    expect(errors).toEqual({});
    expect(card.sharingEnabled).toBe(true);
  });

  it('gives an empty, invalid card with a name error for anything that is not a card', () => {
    for (const bad of [null, undefined, 'x', 3, [], true]) {
      const { card, errors, valid } = normalizeCard(bad);
      expect(valid).toBe(false);
      expect(errors).toEqual({ name: expect.any(String) });
      for (const field of CARD_FIELDS) expect(card[field]).toBe('');
      expect(card.sharingEnabled).toBe(false);
      expect(Object.values(card.share).every((on) => on === false)).toBe(true);
    }
  });

  it('treats values of the wrong type as missing', () => {
    const { card, valid } = normalizeCard({
      firstName: 'Ada', title: 42, organization: { name: 'x' }, email: ['a@b.co'], phone: 5550102000, website: null,
    });
    expect(valid).toBe(true);
    for (const field of ['title', 'organization', 'email', 'phone', 'website']) expect(card[field]).toBe('');
  });

  it('reports each refused value, stores it as empty, and is not valid', () => {
    const { card, errors, valid } = normalizeCard(fullCard({ email: 'nope', website: 'ftp://example.com' }));
    expect(valid).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(['email', 'website']);
    expect(card.email).toBe('');
    expect(card.website).toBe('');
  });

  it('reports a name that is too long as that, not as missing', () => {
    const { errors } = normalizeCard({ firstName: 'a'.repeat(CARD_LIMITS.firstName + 1) });
    expect(errors).toHaveProperty('firstName');
    expect(errors).not.toHaveProperty('name');
  });

  it('gives the same card when normalized twice', () => {
    const once = normalizeCard(fullCard()).card;
    expect(normalizeCard(once).card).toEqual(once);
  });

  it('ignores fields that are only inherited', () => {
    const inherited = Object.create({ firstName: 'Ada', sharingEnabled: true });
    const { card, valid } = normalizeCard(inherited);
    expect(card.firstName).toBe('');
    expect(card.sharingEnabled).toBe(false);
    expect(valid).toBe(false);
  });
});

describe('one field at a time', () => {
  it('returns empty and no error for a field it does not know', () => {
    expect(normalizeCardField('ssn', '123')).toEqual({ value: '', error: null });
    expect(normalizeCardField('constructor', 'x')).toEqual({ value: '', error: null });
    expect(normalizeCardField('__proto__', 'x')).toEqual({ value: '', error: null });
  });

  it('treats empty and missing as empty, without an error, for every field', () => {
    for (const field of CARD_FIELDS) {
      for (const missing of ['', '   ', null, undefined, 0, false, {}, []]) {
        expect(normalizeCardField(field, missing)).toEqual({ value: '', error: null });
      }
    }
  });

  it('refuses a value over the limit rather than cutting it', () => {
    for (const field of ['firstName', 'lastName', 'title', 'organization']) {
      expect(normalizeCardField(field, 'a'.repeat(CARD_LIMITS[field])).error).toBeNull();
      const over = normalizeCardField(field, 'a'.repeat(CARD_LIMITS[field] + 1));
      expect(over.value).toBe('');
      expect(over.error).toMatch(String(CARD_LIMITS[field]));
    }
  });

  it('tidies a line of text: trims, joins runs of space, drops control and zero-width characters', () => {
    expect(normalizeCardField('title', '  Chief\t\n  Analyst  ').value).toBe('Chief Analyst');
    expect(normalizeCardField('firstName', 'A\u0000d​a﻿').value).toBe('A d a');
    expect(normalizeCardField('organization', '\u0007​').value).toBe('');
  });

  it('keeps names in any script', () => {
    expect(normalizeCardField('firstName', 'José').value).toBe('José');
    expect(normalizeCardField('lastName', '李').value).toBe('李');
    expect(normalizeCardField('lastName', "O'Brien-Smith").value).toBe("O'Brien-Smith");
  });

  describe('email', () => {
    it('lowercases and trims', () => {
      expect(normalizeCardField('email', '  Ada@Example.COM ')).toEqual({ value: 'ada@example.com', error: null });
    });

    it('refuses what is not an address', () => {
      for (const bad of ['ada', 'ada@', '@example.com', 'ada@example', 'ada @example.com', 'a@b@c.com', 'ada@example.com, eve@example.com']) {
        const result = normalizeCardField('email', bad);
        expect(result.value).toBe('');
        expect(result.error).toBeTruthy();
      }
    });

    it('refuses an address over the limit', () => {
      expect(normalizeCardField('email', `${'a'.repeat(250)}@example.com`).error).toBeTruthy();
    });
  });

  describe('phone', () => {
    it('accepts the ways numbers are written, as written', () => {
      for (const good of ['5550102000', '+1 (555) 010-2000', '555.010.2000', '+44 20 7946 0958', '555 010 2000 x123', '555-010-2000 ext. 42']) {
        expect(normalizeCardField('phone', good)).toEqual({ value: good, error: null });
      }
    });

    it('refuses letters, markup and anything else', () => {
      for (const bad of ['call me', '555-CALL-NOW', '<b>5550102000</b>', '5550102000;ext=1', 'tel:5550102000', '555 010 2000 x', '++15550102000']) {
        const result = normalizeCardField('phone', bad);
        expect(result.value).toBe('');
        expect(result.error).toBeTruthy();
      }
    });

    it('refuses too few or too many digits, not counting an extension', () => {
      expect(normalizeCardField('phone', '555-010').error).toBeTruthy();
      expect(normalizeCardField('phone', '1234567890123456').error).toBeTruthy();
      expect(normalizeCardField('phone', '555-01 x123456').error).toBeTruthy();
      expect(normalizeCardField('phone', '1234567').error).toBeNull();
      expect(normalizeCardField('phone', '123456789012345').error).toBeNull();
    });
  });

  describe('website', () => {
    it('adds https when there is no scheme, and keeps http when given', () => {
      expect(normalizeCardField('website', 'example.com').value).toBe('https://example.com/');
      expect(normalizeCardField('website', 'http://example.com/about?x=1').value).toBe('http://example.com/about?x=1');
    });

    it('refuses anything that is not a plain web address', () => {
      for (const bad of [
        'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://example.com',
        'mailto:ada@example.com', 'https://user:pass@example.com', 'https://user@example.com', 'localhost', 'https://', 'not a url',
        'example', 'https://exa mple.com',
      ]) {
        const result = normalizeCardField('website', bad);
        expect(result.value, bad).toBe('');
        expect(result.error, bad).toBeTruthy();
      }
    });
  });

  describe('photo', () => {
    it('accepts an https image link', () => {
      expect(normalizeCardField('photoUrl', 'https://media.licdn.com/dms/image/abc?e=1&v=beta').value)
        .toBe('https://media.licdn.com/dms/image/abc?e=1&v=beta');
    });

    it('refuses http, data and script links', () => {
      for (const bad of ['http://images.example.com/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'blob:https://example.com/1']) {
        const result = normalizeCardField('photoUrl', bad);
        expect(result.value, bad).toBe('');
        expect(result.error, bad).toBeTruthy();
      }
    });
  });

  describe('a photo kept in the card', () => {
    const good = photoDataUrl(320, 20_000);

    it('accepts a finished profile photo: a real, square, metadata-free JPEG data URL', () => {
      expect(normalizeCardField('photoUrl', good)).toEqual({ value: good, error: null });
      expect(normalizeCardField('photoUrl', photoDataUrl(64, 2000)).error).toBeNull();
      expect(isPhotoData(good)).toBe(true);
    });

    it('accepts nothing, and still accepts an https link: the other two kinds of photo are unchanged', () => {
      expect(normalizeCardField('photoUrl', '')).toEqual({ value: '', error: null });
      expect(normalizeCardField('photoUrl', 'https://images.example.com/ada.jpg').value).toBe('https://images.example.com/ada.jpg');
      expect(isPhotoData('https://images.example.com/ada.jpg')).toBe(false);
    });

    it('is not held to the 500 characters a link is held to, and a link still is', () => {
      expect(good.length).toBeGreaterThan(CARD_LIMITS.photoUrl);
      expect(normalizeCardField('photoUrl', good).error).toBeNull();
      expect(normalizeCardField('photoUrl', `https://example.com/${'a'.repeat(CARD_LIMITS.photoUrl)}`).error).toBeTruthy();
    });

    it('refuses anything that only CLAIMS to be a photo, with one plain message that never holds the data', () => {
      const cases = {
        'another image type': `data:image/png;base64,${base64Of(good)}`,
        'an SVG, which can carry script': 'data:image/svg+xml;base64,PHN2Zy8+',
        'an uppercase prefix': good.replace('data:image/jpeg', 'DATA:image/jpeg'),
        'only the prefix': PHOTO.DATA_URL_PREFIX,
        'base64 that is not base64': `${PHOTO.DATA_URL_PREFIX}not base64!!`,
        'base64 of the wrong length': `${PHOTO.DATA_URL_PREFIX}${base64Of(good).slice(0, -1)}`,
        'text that is not a JPEG': `${PHOTO.DATA_URL_PREFIX}${encodeBase64(new TextEncoder().encode('hello world, not a jpeg at all'))}`,
        'a JPEG cut short': photoDataUrl(320, 5000, { end: false }),
        'a JPEG that is not square': photoDataUrl(320, 5000, { width: 320, height: 200 }),
        'a JPEG that is too big': photoDataUrl(400, 5000),
        'a JPEG that is too small': photoDataUrl(63, 2000),
        'a JPEG with EXIF in it': photoDataUrl(320, 5000, { extra: EXIF }),
        'a JPEG over the size cap': photoDataUrl(320, 60_000),
        'a picture with a line break in it': `${good.slice(0, 5000)}\n${good.slice(5000)}`,
        'a picture with a space in it': `${good.slice(0, 5000)} ${good.slice(5000)}`,
      };
      for (const [what, value] of Object.entries(cases)) {
        const result = normalizeCardField('photoUrl', value);
        expect(result.value, what).toBe('');
        expect(result.error, what).toBe('That photo couldn\'t be used. Choose another, or remove it.');
        expect(result.error).not.toContain(base64Of(good).slice(0, 40));
      }
    });

    it('treats bare base64, with no data: prefix, as the bad link it is', () => {
      const result = normalizeCardField('photoUrl', base64Of(good));
      expect(result.value).toBe('');
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain(base64Of(good).slice(0, 40));
    });

    it('cannot be fooled by a different kind of data: script, HTML, or a link dressed as a photo', () => {
      for (const bad of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,/9j/<script>', 'data:,hello', 'data:', `javascript:${good}`, `https://x.example.com/?${good}`.slice(0, 600)]) {
        expect(normalizeCardField('photoUrl', bad).value, bad.slice(0, 40)).toBe('');
      }
    });

    it('checks each picture as it is, not as the last one was: valid, refused, valid, another valid', () => {
      const other = photoDataUrl(320, 20_000, { tag: 7 });
      expect(normalizeCardField('photoUrl', good).value).toBe(good);
      expect(normalizeCardField('photoUrl', photoDataUrl(400, 5000)).value).toBe('');
      expect(normalizeCardField('photoUrl', good).value).toBe(good);
      expect(normalizeCardField('photoUrl', other).value).toBe(other);
      expect(normalizeCardField('photoUrl', good).value).toBe(good);
    });

    it('is kept by a card, and refused by a card: the field is blanked and named', () => {
      const kept = normalizeCard({ firstName: 'Ada', photoUrl: good });
      expect(kept.valid).toBe(true);
      expect(kept.card.photoUrl).toBe(good);
      const refused = normalizeCard({ firstName: 'Ada', photoUrl: photoDataUrl(320, 5000, { extra: EXIF }) });
      expect(refused.card.photoUrl).toBe('');
      expect(Object.keys(refused.errors)).toEqual(['photoUrl']);
      expect(refused.valid).toBe(false);
    });

    it('can be replaced by a link, or by another picture, or removed', () => {
      const other = photoDataUrl(320, 20_000, { tag: 9 });
      expect(normalizeCard({ firstName: 'Ada', photoUrl: other }).card.photoUrl).toBe(other);
      expect(normalizeCard({ firstName: 'Ada', photoUrl: 'https://example.com/a.jpg' }).card.photoUrl).toBe('https://example.com/a.jpg');
      expect(normalizeCard({ firstName: 'Ada', photoUrl: '' }).card.photoUrl).toBe('');
    });

    it('is shown to others only when the Photo switch is on: a private picture is as absent as a private link', () => {
      const card = (share) => ({ firstName: 'Ada', lastName: 'L', photoUrl: good, share, sharingEnabled: false });
      expect(publicCardView(card({ ...ALL_ON })).photoUrl).toBe(good);
      expect(publicCardView(card({ ...ALL_ON, photoUrl: false }))).not.toHaveProperty('photoUrl');
      expect(publicCardView(card({}))).not.toHaveProperty('photoUrl');
      expect(publicCardView(card(null))).not.toHaveProperty('photoUrl');
      expect(publicCardView(card({ ...ALL_ON, photoUrl: 'true' }))).not.toHaveProperty('photoUrl');
      // And nothing of it leaks through any other key.
      const view = publicCardView(card({ ...ALL_ON, photoUrl: false }));
      expect(JSON.stringify(view)).not.toContain(fingerprintOf(good));
    });

    it('is not shown, even when switched on, if it is not a valid photo', () => {
      const bad = photoDataUrl(320, 5000, { extra: EXIF });
      const view = publicCardView({ firstName: 'Ada', photoUrl: bad, share: { ...ALL_ON } });
      expect(view).not.toHaveProperty('photoUrl');
      expect(JSON.stringify(view)).not.toContain('Exif');
    });

    it('tells a picture from text a person typed: a long data URL is a picture, a few characters starting data: are text', () => {
      expect(isPhotoPicture(good)).toBe(true);
      expect(isPhotoPicture(photoDataUrl(320, 5000, { extra: EXIF }))).toBe(true);
      expect(isPhotoPicture(`data:${'a'.repeat(PHOTO_TEXT_MAX_CHARS)}`)).toBe(true);
      for (const text of ['', 'data:', 'data:image/png;base64,AAAA', `data:${'a'.repeat(PHOTO_TEXT_MAX_CHARS - 6)}`, 'https://example.com/a.jpg', 'x'.repeat(2000), 42, null, undefined]) {
        expect(isPhotoPicture(text), String(text).slice(0, 30)).toBe(false);
      }
      expect(PHOTO_TEXT_MAX_CHARS).toBe(512);
    });

    it('is a picture that is only ever one of the three kinds of photo: nothing, a link or a data URL', () => {
      expect(jpegBytes(320, 1000).length).toBe(1000);
      for (const v of ['', 'https://example.com/a.jpg', good]) expect(normalizeCardField('photoUrl', v).error).toBeNull();
    });
  });

  describe('LinkedIn', () => {
    it('stores every form of a profile link the same way', () => {
      for (const good of [
        'linkedin.com/in/ada-lovelace', 'https://www.linkedin.com/in/ada-lovelace/', 'http://linkedin.com/in/ada-lovelace',
        'https://uk.linkedin.com/in/ada-lovelace?trk=abc#top', 'HTTPS://WWW.LINKEDIN.COM/in/ada-lovelace',
      ]) {
        expect(normalizeCardField('linkedinUrl', good), good).toEqual({ value: 'https://www.linkedin.com/in/ada-lovelace', error: null });
      }
    });

    it('refuses other sites, look-alikes and pages that are not a profile', () => {
      for (const bad of [
        'https://example.com/in/ada', 'https://evillinkedin.com/in/ada', 'https://linkedin.com.evil.example/in/ada',
        'https://www.linkedin.com/company/acme', 'https://www.linkedin.com/in/', 'https://www.linkedin.com/in/ada/details/x',
        'https://www.linkedin.com', 'ada-lovelace', 'javascript://linkedin.com/in/ada',
      ]) {
        const result = normalizeCardField('linkedinUrl', bad);
        expect(result.value, bad).toBe('');
        expect(result.error, bad).toBeTruthy();
      }
    });
  });

  describe('Instagram', () => {
    it('stores the name without the @, from a name or a profile link', () => {
      for (const good of ['ada.l', '@ada.l', 'instagram.com/ada.l', 'https://www.instagram.com/ada.l/', 'https://instagram.com/ada.l?hl=en']) {
        expect(normalizeCardField('instagram', good), good).toEqual({ value: 'ada.l', error: null });
      }
    });

    it('refuses other sites, pages that are not a profile, and names that cannot be one', () => {
      for (const bad of [
        'https://example.com/ada', 'https://instagram.com.evil.example/ada', 'https://www.instagram.com/p/abc123',
        'https://www.instagram.com/explore', 'https://www.instagram.com/', 'ada lovelace', 'ada!', '@', 'a'.repeat(31),
        '<script>', 'javascript:alert(1)',
      ]) {
        const result = normalizeCardField('instagram', bad);
        expect(result.value, bad).toBe('');
        expect(result.error, bad).toBeTruthy();
      }
    });
  });
});

describe('name and initials', () => {
  it('joins whichever parts of the name there are', () => {
    expect(cardDisplayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(cardDisplayName({ firstName: ' Ada ' })).toBe('Ada');
    expect(cardDisplayName({ lastName: 'Lovelace' })).toBe('Lovelace');
    expect(cardDisplayName({})).toBe('');
    expect(cardDisplayName(null)).toBe('');
    expect(cardDisplayName({ firstName: 7, lastName: ['x'] })).toBe('');
  });

  it('gives up to two initials, upper case', () => {
    expect(cardInitials({ firstName: 'ada', lastName: 'lovelace' })).toBe('AL');
    expect(cardInitials({ firstName: 'Ada' })).toBe('AD');
    expect(cardInitials({ lastName: 'L' })).toBe('L');
    expect(cardInitials({})).toBe('');
    expect(cardInitials(undefined)).toBe('');
  });

  it('does not split a character that takes two code units', () => {
    expect(cardInitials({ firstName: '😀ada', lastName: '𝒳avier' })).toBe('😀𝒳');
  });
});
