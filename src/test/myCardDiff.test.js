/**
 * What differs between two My Cards, by name: how a conflict tells the person
 * which fields to think about.
 */
import { describe, it, expect } from 'vitest';
import { cardsDiffer, describeChanges, diffCards } from '../pages/ContactHub/myCard/state/myCardDiff';
import { DEFAULT_SHARE, newCard } from '../utils/myCardRules';

const base = (extra = {}) => ({
  ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', organization: 'Analytical Engines',
  email: 'ada@example.com', phone: '+1 (555) 010-2000', linkedinUrl: 'https://www.linkedin.com/in/ada',
  instagram: 'ada.l', website: 'https://ada.example.com/', photoUrl: 'https://images.example.com/ada.jpg',
  ...extra,
});

describe('cards that are the same', () => {
  it('differ in nothing', () => {
    expect(diffCards(base(), base()).changes).toEqual([]);
    expect(cardsDiffer(base(), base())).toBe(false);
  });

  it('are the same when only formatting differs: case, spaces, link forms the card would normalise', () => {
    const typed = base({
      email: '  ADA@Example.com ', firstName: ' Ada  ', title: 'Analyst  ', website: 'ada.example.com',
      linkedinUrl: 'linkedin.com/in/ada/', instagram: '@ada.l',
    });
    expect(diffCards(typed, base()).changes).toEqual([]);
  });

  it('are the same when nothing is given on either side, or both are not cards', () => {
    expect(diffCards(null, undefined).changes).toEqual([]);
    expect(diffCards({}, {}).changes).toEqual([]);
    expect(diffCards('card', 7).changes).toEqual([]);
    // A blank card is not a card with nothing: the new card starts with four switches on.
    expect(diffCards({}, newCard()).changes.map((change) => change.kind)).toEqual(['switch', 'switch', 'switch', 'switch']);
  });
});

describe('cards that differ', () => {
  it('names each field whose value differs, in the form\'s order', () => {
    const { changes } = diffCards(base({ phone: '555 010 3000', title: 'Director', firstName: 'Countess' }), base());
    expect(changes).toEqual([
      { kind: 'value', field: 'firstName', label: 'First name' },
      { kind: 'value', field: 'title', label: 'Title' },
      { kind: 'value', field: 'phone', label: 'Phone' },
    ]);
  });

  it('names a switch that differs, after the values', () => {
    const mine = base({ share: { ...DEFAULT_SHARE, email: true, title: false } });
    const { changes } = diffCards({ ...mine, organization: 'Other' }, base({ share: { ...DEFAULT_SHARE } }));
    expect(changes).toEqual([
      { kind: 'value', field: 'organization', label: 'Organization' },
      { kind: 'switch', field: 'title', label: 'Title' },
      { kind: 'switch', field: 'email', label: 'Email' },
    ]);
  });

  it('names the photo by what a person calls it', () => {
    const { changes } = diffCards(base({ photoUrl: 'https://images.example.com/new.jpg', share: { ...DEFAULT_SHARE, photoUrl: false } }), base());
    expect(changes).toEqual([
      { kind: 'value', field: 'photoUrl', label: 'Photo link' },
      { kind: 'switch', field: 'photoUrl', label: 'Photo' },
    ]);
  });

  it('lists a field twice when both its value and its switch differ', () => {
    const { changes } = diffCards(base({ email: 'new@example.com', share: { ...DEFAULT_SHARE, email: true } }), base());
    expect(changes.filter((change) => change.field === 'email').map((change) => change.kind)).toEqual(['value', 'switch']);
  });

  it('tells a value that was added or removed', () => {
    expect(diffCards(base({ website: '' }), base()).changes.map((change) => change.field)).toEqual(['website']);
    expect(diffCards(base(), base({ website: '' })).changes.map((change) => change.field)).toEqual(['website']);
  });

  it('compares text the card would refuse as typed, so a draft with a typo differs', () => {
    expect(diffCards(base({ email: 'ada@' }), base()).changes.map((change) => change.field)).toEqual(['email']);
    expect(diffCards(base({ email: 'ada@' }), base({ email: 'ada@' })).changes).toEqual([]);
  });

  it('is the same both ways round', () => {
    const a = base({ title: 'One' });
    const b = base({ title: 'Two', phone: '' });
    expect(diffCards(a, b).changes.map((change) => change.field)).toEqual(diffCards(b, a).changes.map((change) => change.field));
  });

  it('reads a switch as on only when it is exactly true', () => {
    const odd = { ...base(), share: { ...DEFAULT_SHARE, email: 'true', phone: 1 } };
    expect(diffCards(odd, base()).changes).toEqual([]);
    const { changes } = diffCards({ ...base(), share: { ...DEFAULT_SHARE, email: true } }, odd);
    expect(changes.map((change) => change.field)).toEqual(['email']);
  });

  it('says whether two cards differ at all', () => {
    expect(cardsDiffer(base({ title: 'Other' }), base())).toBe(true);
  });
});

describe('only names come out, never what is in the fields', () => {
  it('carries no values, not even private ones', () => {
    const mine = base({ email: 'secret-email@example.com', phone: '+1 555 999 0000', title: 'Secret Title' });
    const text = JSON.stringify(diffCards(mine, base()));
    expect(text).not.toMatch(/secret-email|555 999|Secret Title|example\.com/);
  });

  it('describes the changes in words for a person', () => {
    const { changes } = diffCards(base({ title: 'Other', share: { ...DEFAULT_SHARE, email: true, photoUrl: false } }), base());
    expect(describeChanges(changes)).toEqual(['Title', 'Photo switch', 'Email switch']);
    expect(describeChanges([])).toEqual([]);
  });
});
