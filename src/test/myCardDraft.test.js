/**
 * The My Card editor's draft, on its own: what the form holds, what has been
 * touched, what the preview may show, and what is private. Pure functions.
 */
import { describe, it, expect } from 'vitest';
import {
  EDITOR_SECTIONS, FIELD_META, cardDraftReducer, createDraft, isDirty, isValid, previewOf,
  readableLink, unsharedFields, visibleErrors,
} from '../pages/ContactHub/myCard/cardDraft';
import {
  CARD_FIELDS, DEFAULT_SHARE, SHAREABLE_FIELDS, newCard, publicCardView,
} from '../utils/myCardRules';
import { buildCardSuggestions } from '../utils/myCardSuggestions';

const start = (extra = {}) => createDraft({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', ...extra });
const step = (state, ...actions) => actions.reduce(cardDraftReducer, state);
const edit = (field, value) => ({ type: 'edit', field, value });

describe('the form', () => {
  it('has a place for every field of the card, once, and a label for each', () => {
    const placed = EDITOR_SECTIONS.flatMap((section) => section.fields);
    expect([...placed].sort()).toEqual([...CARD_FIELDS].sort());
    for (const field of CARD_FIELDS) expect(FIELD_META[field].label).toBeTruthy();
  });
});

describe('starting a draft', () => {
  it('holds every field as text, with the switches complete and sharing off', () => {
    const { card } = createDraft(null);
    for (const field of CARD_FIELDS) expect(card[field]).toBe('');
    expect(card.share).toEqual(DEFAULT_SHARE);
    expect(card.sharingEnabled).toBe(false);
  });

  it('starts from a card, and shows sharing off whatever it says', () => {
    const { card } = createDraft({ ...newCard(), firstName: 'Ada', email: 'ada@example.com', sharingEnabled: true });
    expect(card.firstName).toBe('Ada');
    expect(card.email).toBe('ada@example.com');
    expect(card.sharingEnabled).toBe(false);
  });

  it('copes with values that are not text, and switches that are not a set of switches', () => {
    const { card } = createDraft({ firstName: 7, lastName: ['x'], email: { a: 1 }, share: 'everything' });
    for (const field of CARD_FIELDS) expect(card[field]).toBe('');
    expect(Object.values(card.share).every((on) => on === false)).toBe(true);
  });

  it('is not changed, touched or in error to begin with', () => {
    const state = start();
    expect(isDirty(state)).toBe(false);
    expect(state.touched).toEqual({});
    expect(visibleErrors(state)).toEqual({});
    expect(isValid(state)).toBe(true);
  });
});

describe('editing', () => {
  it('changes one field', () => {
    const state = step(start(), edit('title', 'Founder'));
    expect(state.card.title).toBe('Founder');
    expect(state.card.firstName).toBe('Ada');
  });

  it('keeps what is typed as typed, even when it is not valid yet', () => {
    expect(step(start(), edit('email', 'ada@')).card.email).toBe('ada@');
  });

  it('ignores fields the form does not have', () => {
    const state = start();
    for (const field of ['uid', 'share', 'sharingEnabled', '__proto__', 'constructor', 'schemaVersion']) {
      expect(step(state, edit(field, 'x')), field).toBe(state);
    }
  });

  it('treats a value that is not text as empty', () => {
    expect(step(start({ title: 'Founder' }), edit('title', null)).card.title).toBe('');
  });

  it('does nothing when the value is the same', () => {
    const state = start();
    expect(step(state, edit('firstName', 'Ada'))).toBe(state);
  });

  it('ignores unknown actions', () => {
    const state = start();
    expect(step(state, { type: 'nope' })).toBe(state);
    expect(cardDraftReducer(state, null)).toBe(state);
  });
});

describe('leaving a field', () => {
  it('marks it touched', () => {
    expect(step(start(), { type: 'blur', field: 'email' }).touched.email).toBe(true);
  });

  it('shows a valid value as it will be kept', () => {
    const state = step(
      start(),
      edit('email', '  ADA@Example.com '), { type: 'blur', field: 'email' },
      edit('linkedinUrl', 'linkedin.com/in/ada/'), { type: 'blur', field: 'linkedinUrl' },
      edit('instagram', '@ada.l'), { type: 'blur', field: 'instagram' },
      edit('website', 'ada.example.com'), { type: 'blur', field: 'website' },
    );
    expect(state.card.email).toBe('ada@example.com');
    expect(state.card.linkedinUrl).toBe('https://www.linkedin.com/in/ada');
    expect(state.card.instagram).toBe('ada.l');
    expect(state.card.website).toBe('https://ada.example.com/');
  });

  it('leaves a value that is not valid exactly as typed, so it can be fixed', () => {
    const state = step(start(), edit('email', 'ada@'), { type: 'blur', field: 'email' });
    expect(state.card.email).toBe('ada@');
  });

  it('does not invent a value for an empty field', () => {
    expect(step(start(), { type: 'blur', field: 'phone' }).card.phone).toBe('');
  });

  it('ignores fields the form does not have', () => {
    const state = start();
    expect(step(state, { type: 'blur', field: 'uid' })).toBe(state);
  });
});

describe('the Shared / Private switches', () => {
  it('turns one field on or off', () => {
    const on = step(start(), { type: 'share', field: 'email', value: true });
    expect(on.card.share.email).toBe(true);
    expect(on.card.share.phone).toBe(false);
    expect(step(on, { type: 'share', field: 'email', value: false }).card.share.email).toBe(false);
  });

  it('starts email, phone, Instagram and website private, and photo, title, organization and LinkedIn shared', () => {
    const { share } = start().card;
    for (const field of ['email', 'phone', 'instagram', 'website']) expect(share[field], field).toBe(false);
    for (const field of ['photoUrl', 'title', 'organization', 'linkedinUrl']) expect(share[field], field).toBe(true);
  });

  it('has no switch for the name, or for anything that is not a field', () => {
    const state = start();
    for (const field of ['firstName', 'lastName', 'sharingEnabled', 'uid', '__proto__']) {
      expect(step(state, { type: 'share', field, value: true }), field).toBe(state);
    }
  });

  it('takes only a real on or off', () => {
    const state = start();
    for (const value of ['true', 1, null, undefined, {}]) {
      expect(step(state, { type: 'share', field: 'email', value })).toBe(state);
    }
  });

  it('never turns sharing on', () => {
    let state = start();
    for (const field of SHAREABLE_FIELDS) state = step(state, { type: 'share', field, value: true });
    expect(state.card.sharingEnabled).toBe(false);
  });
});

describe('using a suggestion', () => {
  const suggestions = buildCardSuggestions({
    account: { displayName: 'Grace Hopper', email: 'grace@example.com' },
    linkedin: { status: 'connected', pictureUrl: 'https://media.example.com/grace.jpg' },
    recon: { role: 'Rear Admiral', companyName: 'US Navy' },
  });

  it('fills an empty field, and marks it touched', () => {
    const state = step(start(), { type: 'useSuggestion', field: 'photoUrl', suggestion: suggestions.photoUrl });
    expect(state.card.photoUrl).toBe('https://media.example.com/grace.jpg');
    expect(state.touched.photoUrl).toBe(true);
  });

  it('never overwrites a field that has text', () => {
    const state = start({ title: 'Founder' });
    expect(step(state, { type: 'useSuggestion', field: 'title', suggestion: suggestions.title })).toBe(state);
    expect(step(state, { type: 'useSuggestion', field: 'firstName', suggestion: suggestions.firstName })).toBe(state);
  });

  it('changes nothing else: not the other fields, not the switches', () => {
    const before = start();
    const after = step(before, { type: 'useSuggestion', field: 'email', suggestion: suggestions.email });
    expect({ ...after.card, email: '' }).toEqual(before.card);
    expect(after.card.share.email).toBe(false);
  });

  it('ignores a suggestion that is not valid, or for a field that has no source', () => {
    const state = start();
    expect(step(state, { type: 'useSuggestion', field: 'email', suggestion: { value: 'nope' } })).toBe(state);
    expect(step(state, { type: 'useSuggestion', field: 'phone', suggestion: { value: '555 010 2000' } })).toBe(state);
    expect(step(state, { type: 'useSuggestion', field: 'title' })).toBe(state);
  });

  it('counts as a change, so it can be saved', () => {
    const state = step(start(), { type: 'useSuggestion', field: 'title', suggestion: suggestions.title });
    expect(isDirty(state)).toBe(true);
  });
});

describe('what is wrong, and when to say so', () => {
  it('says nothing until a field has been left', () => {
    const state = step(start(), edit('email', 'nope'));
    expect(visibleErrors(state)).toEqual({});
    expect(isValid(state)).toBe(false);
  });

  it('says it once the field has been left, and stops when it is fixed', () => {
    const wrong = step(start(), edit('email', 'nope'), { type: 'blur', field: 'email' });
    expect(Object.keys(visibleErrors(wrong))).toEqual(['email']);
    const fixed = step(wrong, edit('email', 'ada@example.com'));
    expect(visibleErrors(fixed)).toEqual({});
    expect(isValid(fixed)).toBe(true);
  });

  it('says everything once a save was tried', () => {
    const state = step(start(), edit('email', 'nope'), edit('website', 'javascript:alert(1)'), { type: 'showAllErrors' });
    expect(Object.keys(visibleErrors(state)).sort()).toEqual(['email', 'website']);
  });

  it('asks for a name after either name field has been left', () => {
    const empty = createDraft(newCard());
    expect(visibleErrors(empty)).toEqual({});
    expect(isValid(empty)).toBe(false);
    expect(visibleErrors(step(empty, { type: 'blur', field: 'lastName' })).name).toBeTruthy();
    expect(visibleErrors(step(empty, { type: 'showAllErrors' })).name).toBeTruthy();
  });

  it('does not ask for a name that is there', () => {
    expect(visibleErrors(step(start(), { type: 'showAllErrors' }))).toEqual({});
  });

  it('says a value is too long, in words', () => {
    const state = step(start(), edit('title', 't'.repeat(101)), { type: 'blur', field: 'title' });
    expect(visibleErrors(state).title).toMatch(/100 characters/);
  });
});

describe('whether anything changed', () => {
  it('is false for the card it started from, and for spaces that will not be kept', () => {
    expect(isDirty(step(start(), edit('firstName', '  Ada  ')))).toBe(false);
    expect(isDirty(step(start(), edit('title', '   ')))).toBe(false);
  });

  it('is true for a changed value or switch, and false again when put back', () => {
    const changed = step(start(), edit('title', 'Founder'));
    expect(isDirty(changed)).toBe(true);
    expect(isDirty(step(changed, edit('title', '')))).toBe(false);
    const flipped = step(start(), { type: 'share', field: 'phone', value: true });
    expect(isDirty(flipped)).toBe(true);
    expect(isDirty(step(flipped, { type: 'share', field: 'phone', value: false }))).toBe(false);
  });

  it('is true for text that is not valid yet, so it is not lost quietly', () => {
    expect(isDirty(step(start(), edit('email', 'ada@')))).toBe(true);
  });

  it('starts again from a new card on reset', () => {
    const changed = step(start(), edit('title', 'Founder'));
    const saved = step(changed, { type: 'reset', card: changed.card });
    expect(isDirty(saved)).toBe(false);
    expect(saved.touched).toEqual({});
    expect(saved.card.title).toBe('Founder');
  });
});

describe('what the preview shows', () => {
  const full = (extra = {}) => start({
    title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com', phone: '+1 (555) 010-2000',
    linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace', instagram: 'ada.l', website: 'https://ada.example.com/',
    photoUrl: 'https://media.example.com/ada.jpg', ...extra,
  });

  it('is the card\'s own privacy rule, applied to the draft', () => {
    const { card } = full();
    expect(previewOf(card)).toEqual(publicCardView(card));
  });

  it('shows shared fields, and leaves out private ones even though they are filled in', () => {
    const view = previewOf(full().card);
    for (const field of ['photoUrl', 'title', 'organization', 'linkedinUrl']) expect(view, field).toHaveProperty(field);
    for (const field of ['email', 'phone', 'instagram', 'website']) expect(view, field).not.toHaveProperty(field);
  });

  it('includes changes that are not saved: typing, and the switches', () => {
    let state = full();
    state = step(state, edit('title', 'Director'), { type: 'share', field: 'email', value: true });
    const view = previewOf(state.card);
    expect(view.title).toBe('Director');
    expect(view.email).toBe('ada@example.com');
    state = step(state, { type: 'share', field: 'email', value: false });
    expect(previewOf(state.card)).not.toHaveProperty('email');
  });

  it('shows a value as it will be kept, and never one the rules refuse', () => {
    const view = previewOf(step(full(), { type: 'share', field: 'website', value: true }, edit('website', 'javascript:alert(1)'), edit('title', '  Head   of Things ')).card);
    expect(view).not.toHaveProperty('website');
    expect(view.title).toBe('Head of Things');
  });

  it('has nothing for a draft with no name', () => {
    expect(previewOf(step(full(), edit('firstName', ''), edit('lastName', '')).card)).toBeNull();
  });

  it('never carries the switches, sharing or anything but what a card may show', () => {
    const view = previewOf(full().card);
    for (const key of ['share', 'sharingEnabled', 'schemaVersion', 'revision', 'start']) expect(view).not.toHaveProperty(key);
  });

  it('lists what is filled in and kept private, in the form\'s order', () => {
    expect(unsharedFields(full().card).map((item) => item.label)).toEqual(['Email', 'Phone', 'Instagram', 'Website']);
    expect(unsharedFields(start().card)).toEqual([]);
    const all = step(full(), ...SHAREABLE_FIELDS.map((field) => ({ type: 'share', field, value: true })));
    expect(unsharedFields(all.card)).toEqual([]);
  });

  it('does not list a private field that is empty or not valid', () => {
    const state = step(start(), edit('email', 'nope'), edit('phone', ''));
    expect(unsharedFields(state.card)).toEqual([]);
  });
});

describe('reading a link', () => {
  it('drops the scheme, www and a trailing slash', () => {
    expect(readableLink('https://www.linkedin.com/in/ada')).toBe('linkedin.com/in/ada');
    expect(readableLink('https://ada.example.com/')).toBe('ada.example.com');
    expect(readableLink('http://example.com/a/b/')).toBe('example.com/a/b');
    expect(readableLink(null)).toBe('');
  });
});
