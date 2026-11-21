/**
 * My Card suggestions, on their own: who supplies each field and in what
 * order, what is refused, and the only ways a suggestion enters a card.
 * Pure functions: no Firebase and no rendering.
 */
import { describe, it, expect } from 'vitest';
import {
  SUGGESTION_SOURCES as SRC, SUGGESTIBLE_FIELDS, buildCardSuggestions, acceptSuggestion,
  openSuggestions, prefilledNewCard,
} from '../utils/myCardSuggestions';
import {
  CARD_FIELDS, CARD_LIMITS, DEFAULT_SHARE, newCard, normalizeCard, publicCardView,
} from '../utils/myCardRules';

const linkedin = (extra = {}) => ({
  status: 'connected',
  givenName: 'Ada',
  familyName: 'Lovelace',
  email: 'ada@linkedin.example.com',
  emailVerified: true,
  pictureUrl: 'https://media.example.com/ada.jpg',
  ...extra,
});

const values = (suggestions) => Object.fromEntries(Object.entries(suggestions).map(([f, s]) => [f, s.value]));
const sources = (suggestions) => Object.fromEntries(Object.entries(suggestions).map(([f, s]) => [f, s.source]));

describe('what has no source', () => {
  it('never suggests phone, Instagram, website or the LinkedIn address', () => {
    const result = buildCardSuggestions({
      account: { displayName: 'Ada Lovelace', email: 'a@example.com', phone: '555 010 2000', website: 'https://example.com', instagram: 'ada' },
      linkedin: linkedin({ profileUrl: 'https://www.linkedin.com/in/ada', vanityName: 'ada', phone: '555 010 2000' }),
      recon: { role: 'Analyst', companyName: 'Engines', website: 'https://example.com' },
    });
    for (const field of ['phone', 'instagram', 'website', 'linkedinUrl']) expect(result).not.toHaveProperty(field);
    expect(Object.keys(result).every((field) => SUGGESTIBLE_FIELDS.includes(field))).toBe(true);
  });

  it('makes every suggestible field a real card field', () => {
    for (const field of SUGGESTIBLE_FIELDS) expect(CARD_FIELDS).toContain(field);
  });
});

describe('the name', () => {
  it('prefers the display name chosen in Settings', () => {
    const result = buildCardSuggestions({
      account: { displayName: 'Countess Ada', firstName: 'A', lastName: 'L' },
      linkedin: linkedin(),
    });
    expect(values(result)).toMatchObject({ firstName: 'Countess', lastName: 'Ada' });
    expect(sources(result)).toMatchObject({ firstName: SRC.SETTINGS, lastName: SRC.SETTINGS });
  });

  it('falls back to LinkedIn when there is no display name', () => {
    const result = buildCardSuggestions({ account: { firstName: 'A', lastName: 'L' }, linkedin: linkedin() });
    expect(values(result)).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(sources(result)).toMatchObject({ firstName: SRC.LINKEDIN, lastName: SRC.LINKEDIN });
  });

  it('then falls back to the account\'s own first and last name', () => {
    const result = buildCardSuggestions({ account: { firstName: 'Grace', lastName: 'Hopper', name: 'Legacy Name' } });
    expect(values(result)).toMatchObject({ firstName: 'Grace', lastName: 'Hopper' });
    expect(sources(result).firstName).toBe(SRC.ACCOUNT);
  });

  it('then to the legacy name field', () => {
    const result = buildCardSuggestions({ account: { name: 'Grace Brewster Hopper' } });
    expect(values(result)).toMatchObject({ firstName: 'Grace Brewster', lastName: 'Hopper' });
    expect(sources(result).firstName).toBe(SRC.ACCOUNT);
  });

  it('never makes a name from an email address', () => {
    const result = buildCardSuggestions({ account: { email: 'aaron.wiley@example.com' }, linkedin: linkedin({ givenName: null, familyName: null, email: 'ada.l@example.com' }) });
    expect(result).not.toHaveProperty('firstName');
    expect(result).not.toHaveProperty('lastName');
  });

  it('splits a display name at its last word, and one word is a first name only', () => {
    expect(values(buildCardSuggestions({ account: { displayName: '  Mary   Ann  Smith ' } }))).toMatchObject({ firstName: 'Mary Ann', lastName: 'Smith' });
    const single = buildCardSuggestions({ account: { displayName: 'Cher' } });
    expect(values(single)).toEqual({ firstName: 'Cher' });
    expect(single).not.toHaveProperty('lastName');
  });

  it('takes both parts from one source, never a mix', () => {
    // The chosen display name has no last name; LinkedIn's last name is not borrowed.
    const result = buildCardSuggestions({ account: { displayName: 'Cher' }, linkedin: linkedin() });
    expect(values(result)).toMatchObject({ firstName: 'Cher' });
    expect(result).not.toHaveProperty('lastName');
  });

  it('skips a source with a refused part and uses the next', () => {
    const tooLong = 'a'.repeat(CARD_LIMITS.firstName + 1);
    const result = buildCardSuggestions({ account: { displayName: `${tooLong} Smith` }, linkedin: linkedin() });
    expect(values(result)).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(sources(result).firstName).toBe(SRC.LINKEDIN);
  });

  it('skips empty, blank and wrongly typed names', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, [], ['Ada Lovelace'], true]) {
      const result = buildCardSuggestions({ account: { displayName: bad, firstName: bad, lastName: bad, name: bad } });
      expect(result).not.toHaveProperty('firstName');
      expect(result).not.toHaveProperty('lastName');
    }
  });

  it('keeps names in any script', () => {
    expect(values(buildCardSuggestions({ account: { displayName: 'José 李' } }))).toMatchObject({ firstName: 'José', lastName: '李' });
  });

  it('ignores LinkedIn names unless LinkedIn is connected', () => {
    for (const status of ['disconnected', 'error', undefined, null, 'CONNECTED']) {
      expect(buildCardSuggestions({ linkedin: linkedin({ status }) })).toEqual({});
    }
  });
});

describe('the email', () => {
  it('prefers the account email', () => {
    const result = buildCardSuggestions({ account: { email: ' Ada@Example.com ' }, linkedin: linkedin() });
    expect(result.email).toEqual({ value: 'ada@example.com', source: SRC.ACCOUNT });
  });

  it('uses LinkedIn\'s email, when verified, if the account has none', () => {
    expect(buildCardSuggestions({ linkedin: linkedin() }).email).toEqual({ value: 'ada@linkedin.example.com', source: SRC.LINKEDIN });
  });

  it('never uses an email LinkedIn has not verified', () => {
    for (const emailVerified of [false, undefined, null, 'true', 1, 'yes', {}, []]) {
      expect(buildCardSuggestions({ linkedin: linkedin({ emailVerified }) })).not.toHaveProperty('email');
    }
  });

  it('uses LinkedIn\'s verified email when the account\'s is not a valid address', () => {
    const result = buildCardSuggestions({ account: { email: 'not-an-email' }, linkedin: linkedin() });
    expect(result.email.source).toBe(SRC.LINKEDIN);
  });

  it('refuses an invalid address from either source', () => {
    const result = buildCardSuggestions({ account: { email: 'nope' }, linkedin: linkedin({ email: 'also nope' }) });
    expect(result).not.toHaveProperty('email');
  });

  it('does not use LinkedIn\'s email when LinkedIn is not connected', () => {
    expect(buildCardSuggestions({ linkedin: linkedin({ status: 'disconnected' }) })).not.toHaveProperty('email');
  });
});

describe('the photo', () => {
  it('suggests LinkedIn\'s picture when it is an https link', () => {
    expect(buildCardSuggestions({ linkedin: linkedin() }).photoUrl).toEqual({ value: 'https://media.example.com/ada.jpg', source: SRC.LINKEDIN });
  });

  it('refuses anything that is not a secure web link', () => {
    for (const pictureUrl of [
      'http://media.example.com/ada.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
      'blob:https://example.com/1', 'ftp://example.com/a.jpg', 'not a url', '', null, 7, {},
    ]) {
      expect(buildCardSuggestions({ linkedin: linkedin({ pictureUrl }) }), String(pictureUrl)).not.toHaveProperty('photoUrl');
    }
  });

  it('only ever suggests an https link, even when the card\'s rules tidy a link with no scheme', () => {
    const photo = buildCardSuggestions({ linkedin: linkedin({ pictureUrl: '//media.example.com/a.jpg' }) }).photoUrl;
    expect(photo.value).toBe('https://media.example.com/a.jpg');
  });

  it('refuses a link with a password in it', () => {
    expect(buildCardSuggestions({ linkedin: linkedin({ pictureUrl: 'https://user:pass@media.example.com/a.jpg' }) })).not.toHaveProperty('photoUrl');
  });

  it('has no photo from the account or Recon', () => {
    expect(buildCardSuggestions({ account: { photoUrl: 'https://x.example.com/a.jpg', photoURL: 'https://x.example.com/a.jpg' }, recon: { photoUrl: 'https://x.example.com/a.jpg' } })).toEqual({});
  });
});

describe('title and organization', () => {
  it('come from what the person told Recon', () => {
    const result = buildCardSuggestions({ recon: { role: '  VP of   Sales ', companyName: 'Analytical Engines' } });
    expect(result.title).toEqual({ value: 'VP of Sales', source: SRC.RECON });
    expect(result.organization).toEqual({ value: 'Analytical Engines', source: SRC.RECON });
  });

  it('are dropped, not cut, when too long for a card', () => {
    const result = buildCardSuggestions({ recon: { role: 'r'.repeat(CARD_LIMITS.title + 1), companyName: 'c'.repeat(CARD_LIMITS.organization + 1) } });
    expect(result).toEqual({});
  });

  it('are skipped when missing or not text', () => {
    for (const bad of ['', '   ', null, undefined, 5, {}, []]) {
      expect(buildCardSuggestions({ recon: { role: bad, companyName: bad } })).toEqual({});
    }
  });
});

describe('inputs that are not what they should be', () => {
  it('gives nothing for nothing, or for things that are not objects', () => {
    expect(buildCardSuggestions()).toEqual({});
    expect(buildCardSuggestions({})).toEqual({});
    for (const bad of [null, undefined, 'x', 7, true, [], () => 1]) {
      expect(buildCardSuggestions({ account: bad, linkedin: bad, recon: bad })).toEqual({});
    }
  });

  it('does not read inherited properties', () => {
    const inherited = Object.create({ displayName: 'Inherited Name', email: 'i@example.com', role: 'Boss' });
    expect(buildCardSuggestions({ account: inherited, recon: inherited })).toEqual({});
  });

  it('returns a frozen result, and does not change what it was given', () => {
    const input = { account: { displayName: 'Ada Lovelace' }, linkedin: linkedin(), recon: { role: 'Analyst' } };
    const before = JSON.parse(JSON.stringify(input));
    const result = buildCardSuggestions(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.firstName)).toBe(true);
    expect(input).toEqual(before);
  });

  it('suggests every field it can from a complete account', () => {
    const result = buildCardSuggestions({
      account: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
      linkedin: linkedin(),
      recon: { role: 'Analyst', companyName: 'Analytical Engines' },
    });
    expect(Object.keys(result).sort()).toEqual([...SUGGESTIBLE_FIELDS].sort());
  });
});

describe('accepting a suggestion', () => {
  const suggestions = buildCardSuggestions({
    account: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
    linkedin: linkedin(),
    recon: { role: 'Analyst', companyName: 'Analytical Engines' },
  });

  it('fills one empty field and nothing else', () => {
    const card = newCard();
    const next = acceptSuggestion(card, 'title', suggestions.title);
    expect(next).not.toBe(card);
    expect(next.title).toBe('Analyst');
    expect({ ...next, title: '' }).toEqual(card);
    expect(card.title).toBe('');
  });

  it('never overwrites a field that already has text', () => {
    const card = { ...newCard(), title: 'Founder', firstName: 'Countess' };
    expect(acceptSuggestion(card, 'title', suggestions.title)).toBe(card);
    expect(acceptSuggestion(card, 'firstName', suggestions.firstName)).toBe(card);
  });

  it('treats a field of only spaces as empty', () => {
    const next = acceptSuggestion({ ...newCard(), title: '   ' }, 'title', suggestions.title);
    expect(next.title).toBe('Analyst');
  });

  it('leaves the switches and the master sharing setting alone', () => {
    const card = { ...newCard(), share: { ...DEFAULT_SHARE, email: false, phone: true }, sharingEnabled: false };
    const next = acceptSuggestion(card, 'email', suggestions.email);
    expect(next.email).toBe('ada@example.com');
    expect(next.share).toEqual(card.share);
    expect(next.share.email).toBe(false);
    expect(next.sharingEnabled).toBe(false);
  });

  it('does not turn sharing on, even if a suggestion says to', () => {
    const next = acceptSuggestion(newCard(), 'title', { value: 'Analyst', source: SRC.RECON, sharingEnabled: true, share: { title: true } });
    expect(next.sharingEnabled).toBe(false);
    expect(next.share).toEqual(DEFAULT_SHARE);
  });

  it('accepts only fields that have a source', () => {
    for (const field of ['phone', 'instagram', 'website', 'linkedinUrl', 'share', 'sharingEnabled', 'schemaVersion', 'uid', '__proto__', 'constructor']) {
      const card = newCard();
      expect(acceptSuggestion(card, field, { value: 'https://www.linkedin.com/in/ada', source: 'x' }), field).toBe(card);
    }
  });

  it('re-checks the value, so a suggestion made by hand cannot slip a bad one in', () => {
    const card = newCard();
    for (const [field, value] of [
      ['email', 'nope'], ['photoUrl', 'http://x.example.com/a.jpg'], ['photoUrl', 'javascript:alert(1)'],
      ['title', 't'.repeat(CARD_LIMITS.title + 1)], ['firstName', ''], ['organization', null], ['title', 42], ['title', { toString: () => 'x' }],
    ]) {
      expect(acceptSuggestion(card, field, { value, source: SRC.RECON }), `${field}:${String(value)}`).toBe(card);
    }
  });

  it('tidies the value it accepts, as the editor would', () => {
    expect(acceptSuggestion(newCard(), 'email', { value: '  ADA@Example.com ' }).email).toBe('ada@example.com');
    expect(acceptSuggestion(newCard(), 'title', { value: ' Head \n of  Things ' }).title).toBe('Head of Things');
  });

  it('does nothing without a suggestion, or without a card', () => {
    const card = newCard();
    for (const bad of [undefined, null, '', 'Analyst', 5, [], {}]) expect(acceptSuggestion(card, 'title', bad)).toBe(card);
    for (const bad of [null, undefined, 'card', 3, []]) expect(acceptSuggestion(bad, 'title', suggestions.title)).toBe(bad);
  });

  it('keeps the result a valid card', () => {
    let card = newCard();
    for (const field of SUGGESTIBLE_FIELDS) card = acceptSuggestion(card, field, suggestions[field]);
    expect(normalizeCard(card).card).toEqual({ ...card, share: DEFAULT_SHARE });
    expect(normalizeCard(card).valid).toBe(true);
  });
});

describe('what is still open to use on a card', () => {
  const suggestions = buildCardSuggestions({
    account: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
    linkedin: linkedin(),
    recon: { role: 'Analyst', companyName: 'Analytical Engines' },
  });

  it('is every suggestion for an empty card', () => {
    expect(Object.keys(openSuggestions(newCard(), suggestions)).sort()).toEqual([...SUGGESTIBLE_FIELDS].sort());
  });

  it('leaves out each field the card already holds', () => {
    const card = { ...newCard(), firstName: 'Countess', title: 'Founder' };
    const open = openSuggestions(card, suggestions);
    expect(open).not.toHaveProperty('firstName');
    expect(open).not.toHaveProperty('title');
    expect(open).toHaveProperty('lastName');
  });

  it('is nothing for a full card, and nothing without suggestions', () => {
    let card = newCard();
    for (const field of SUGGESTIBLE_FIELDS) card = acceptSuggestion(card, field, suggestions[field]);
    expect(openSuggestions(card, suggestions)).toEqual({});
    expect(openSuggestions(newCard(), {})).toEqual({});
    expect(openSuggestions(newCard(), null)).toEqual({});
  });

  it('drops a suggestion that is not valid', () => {
    expect(openSuggestions(newCard(), { email: { value: 'nope' }, phone: { value: '555 010 2000' } })).toEqual({});
  });

  it('treats a missing or odd card as empty', () => {
    expect(Object.keys(openSuggestions(null, suggestions))).toHaveLength(SUGGESTIBLE_FIELDS.length);
  });
});

describe('a new card, pre-filled', () => {
  const suggestions = buildCardSuggestions({
    account: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
    linkedin: linkedin(),
    recon: { role: 'Analyst', companyName: 'Analytical Engines' },
  });

  it('holds every valid suggestion, the default switches, and sharing off', () => {
    const card = prefilledNewCard(suggestions);
    expect(card).toMatchObject({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', title: 'Analyst',
      organization: 'Analytical Engines', photoUrl: 'https://media.example.com/ada.jpg',
      phone: '', instagram: '', website: '', linkedinUrl: '',
    });
    expect(card.share).toEqual(DEFAULT_SHARE);
    expect(card.sharingEnabled).toBe(false);
  });

  it('keeps a suggested email private: it is not in what others would see', () => {
    const view = publicCardView(prefilledNewCard(suggestions));
    expect(view).not.toHaveProperty('email');
    expect(view).toMatchObject({ name: 'Ada Lovelace', title: 'Analyst', organization: 'Analytical Engines' });
  });

  it('is an ordinary new card when there is nothing to suggest, or nonsense', () => {
    for (const nothing of [{}, null, undefined, 'x', 5, []]) expect(prefilledNewCard(nothing)).toEqual(newCard());
  });

  it('re-checks every value, so hand-made suggestions cannot slip a bad one in', () => {
    const card = prefilledNewCard({
      firstName: { value: 'Ada' }, email: { value: 'nope' }, photoUrl: { value: 'http://x.example.com/a.jpg' },
      phone: { value: '555 010 2000' }, website: { value: 'https://example.com' }, sharingEnabled: { value: true },
    });
    expect(card.firstName).toBe('Ada');
    for (const field of ['email', 'photoUrl', 'phone', 'website']) expect(card[field]).toBe('');
    expect(card.sharingEnabled).toBe(false);
  });
});
