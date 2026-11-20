/**
 * Contact Hub — My People's rules, on their own: who is listed, the order,
 * what a search matches, and the sticker filter. Pure functions, no rendering.
 */
import { describe, it, expect } from 'vitest';
import {
  isListedInMyPeople, listMyPeople, addedAtOf, sortNewestFirst, addedLabel,
  personSubtitle, emailOf, phoneOf, matchesSearch, visiblePeople,
  addedShort, pageOf, PAGE_SIZE, stickersFailedToLoad,
} from '../pages/ContactHub/peopleRules';

const person = (id, extra = {}) => ({ id, name: `Person ${id}`, ...extra });

describe('who is listed in My People', () => {
  it('lists an ordinary contact', () => {
    expect(isListedInMyPeople(person('a'))).toBe(true);
  });

  it('leaves out archived people, by every archive signal People honours', () => {
    expect(isListedInMyPeople(person('a', { is_archived: true }))).toBe(false);
    expect(isListedInMyPeople(person('a', { status: 'archived' }))).toBe(false);
    expect(isListedInMyPeople(person('a', { status: 'people_mode_archived' }))).toBe(false);
    expect(isListedInMyPeople(person('a', { company_archived: true }))).toBe(false);
  });

  it('leaves out a "not today" skip, which is a bookmark and not a person', () => {
    expect(isListedInMyPeople(person('a', { status: 'people_mode_skipped' }))).toBe(false);
  });

  it('leaves out records with no id, and nothing at all', () => {
    expect(isListedInMyPeople({ name: 'No Id' })).toBe(false);
    expect(isListedInMyPeople(null)).toBe(false);
    expect(listMyPeople(undefined)).toEqual([]);
  });

  it('does not care about pipeline state: engaged and unengaged people are both listed', () => {
    expect(isListedInMyPeople(person('a', { hunter_status: 'active_mission' }))).toBe(true);
    expect(isListedInMyPeople(person('b', { contact_status: 'Engaged' }))).toBe(true);
  });
});

describe('when someone was added', () => {
  it('reads the fields People sorts on, and Firestore timestamps', () => {
    expect(addedAtOf({ saved_at: '2026-11-12T10:00:00Z', addedAt: '2026-01-01T00:00:00Z' })).toBe('2026-11-12T10:00:00Z');
    expect(addedAtOf({ addedAt: '2026-11-10T00:00:00Z' })).toBe('2026-11-10T00:00:00Z');
    expect(addedAtOf({ addedAt: { seconds: 1794268800 } })).toBe(new Date(1794268800 * 1000).toISOString());
    expect(addedAtOf({ addedAt: { toDate: () => new Date('2026-11-08T00:00:00Z') } })).toBe('2026-11-08T00:00:00.000Z');
    expect(addedAtOf({})).toBe('');
  });

  it('sorts newest first and keeps undated people at the end', () => {
    const sorted = sortNewestFirst([
      person('old', { addedAt: '2026-11-05T00:00:00Z' }),
      person('none'),
      person('new', { addedAt: '2026-11-12T00:00:00Z' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['new', 'old', 'none']);
  });

  it('labels the date, with the year only when it is not this year', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(addedLabel({ addedAt: '2026-11-12T12:00:00Z' }, now)).toBe('Added Nov 12');
    expect(addedLabel({ addedAt: '2025-03-04T12:00:00Z' }, now)).toBe('Added Mar 4, 2025');
    expect(addedLabel({}, now)).toBe('');
    expect(addedLabel({ addedAt: 'not a date' }, now)).toBe('');
  });
});

describe('what a row shows', () => {
  it('joins title and company, whichever exist', () => {
    expect(personSubtitle({ title: 'Program Director', company_name: 'UAC' })).toBe('Program Director, UAC');
    expect(personSubtitle({ title: 'Community Leader' })).toBe('Community Leader');
    expect(personSubtitle({ company: 'Parks & Rec' })).toBe('Parks & Rec');
    expect(personSubtitle({})).toBe('');
  });

  it('picks the email and the phone a button should use', () => {
    expect(emailOf({ email: 'a@x.test', work_email: 'w@x.test' })).toBe('a@x.test');
    expect(emailOf({ work_email: 'w@x.test' })).toBe('w@x.test');
    expect(emailOf({})).toBe('');
    expect(phoneOf({ phone_mobile: '+1 555 123 4567' })).toBe('+1 555 123 4567');
    expect(phoneOf({})).toBe('');
  });
});

describe('search', () => {
  const wes = { id: 'w', name: 'Wes Clark', title: 'Program Director', company_name: 'UAC', email: 'wes@uac.test', sticker_ids: ['S1'] };
  const stickersById = new Map([['S1', { id: 'S1', name: 'Partner', status: 'active' }], ['S2', { id: 'S2', name: 'Old', status: 'archived' }]]);

  it('an empty search matches everyone', () => {
    expect(matchesSearch(wes, '')).toBe(true);
    expect(matchesSearch(wes, '   ')).toBe(true);
  });

  it('matches name, title, company and email, ignoring case', () => {
    for (const term of ['wes', 'CLARK', 'director', 'uac', 'wes@uac']) expect(matchesSearch(wes, term)).toBe(true);
    expect(matchesSearch(wes, 'nakaiya')).toBe(false);
  });

  it('matches the name of an active sticker the person has, when stickers are available', () => {
    expect(matchesSearch(wes, 'partner', stickersById)).toBe(true);
    expect(matchesSearch(wes, 'partner')).toBe(false);
    expect(matchesSearch({ ...wes, sticker_ids: ['S2'] }, 'old', stickersById)).toBe(false);
  });
});

describe('the list as shown', () => {
  const contacts = [
    person('a', { name: 'Ana Board', addedAt: '2026-11-01T00:00:00Z', sticker_ids: ['S1'] }),
    person('b', { name: 'Ben Gala', addedAt: '2026-11-03T00:00:00Z', sticker_ids: ['S2'] }),
    person('c', { name: 'Cy Archived', addedAt: '2026-11-04T00:00:00Z', is_archived: true, sticker_ids: ['S1'] }),
    person('d', { name: 'Di Both', addedAt: '2026-11-02T00:00:00Z', sticker_ids: ['S1', 'S2'] }),
  ];

  it('with nothing chosen: everyone listed, newest first', () => {
    expect(visiblePeople(contacts).map((c) => c.id)).toEqual(['b', 'd', 'a']);
  });

  it('one sticker narrows to the people who have it, and never brings back an archived person', () => {
    expect(visiblePeople(contacts, { stickerId: 'S1' }).map((c) => c.id)).toEqual(['d', 'a']);
    expect(visiblePeople(contacts, { stickerId: 'S2' }).map((c) => c.id)).toEqual(['b', 'd']);
  });

  it('search and sticker combine', () => {
    expect(visiblePeople(contacts, { stickerId: 'S1', term: 'ana' }).map((c) => c.id)).toEqual(['a']);
    expect(visiblePeople(contacts, { stickerId: 'S2', term: 'ana' })).toEqual([]);
  });
});

describe('the Added column', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  it('is the short date, with the year once it is not this one', () => {
    expect(addedShort({ addedAt: '2026-11-12T18:00:00Z' }, now)).toBe('Nov 12');
    expect(addedShort({ addedAt: '2025-03-04T18:00:00Z' }, now)).toBe('Mar 4, 2025');
  });
  it('is empty when the record has no date or a bad one', () => {
    expect(addedShort({}, now)).toBe('');
    expect(addedShort({ addedAt: 'not a date' }, now)).toBe('');
  });
});

describe('display paging', () => {
  const list = Array.from({ length: 120 }, (_, i) => ({ id: String(i) }));
  it('draws 50 at a time', () => {
    expect(PAGE_SIZE).toBe(50);
    expect(pageOf(list, PAGE_SIZE)).toMatchObject({ total: 120, remaining: 70, next: 50 });
    expect(pageOf(list, PAGE_SIZE).drawn).toHaveLength(50);
  });
  it('the last step is whatever is left, then there is nothing more', () => {
    expect(pageOf(list, 100)).toMatchObject({ remaining: 20, next: 20 });
    expect(pageOf(list, 150)).toMatchObject({ remaining: 0, next: 0 });
    expect(pageOf(list, 150).drawn).toHaveLength(120);
  });
  it('keeps the order it was given and never changes the list', () => {
    const before = [...list];
    expect(pageOf(list, 3).drawn.map((p) => p.id)).toEqual(['0', '1', '2']);
    expect(list).toEqual(before);
  });
  it('copes with nothing', () => {
    expect(pageOf(undefined, PAGE_SIZE)).toMatchObject({ total: 0, remaining: 0, next: 0, drawn: [] });
  });
});

describe('a failed sticker load is not "no stickers"', () => {
  it('is true only when stickers are on for the user and their list could not be read', () => {
    expect(stickersFailedToLoad({ availability: 'available', status: 'error' })).toBe(true);
    expect(stickersFailedToLoad({ availability: 'available', status: 'ready' })).toBe(false);
    expect(stickersFailedToLoad({ availability: 'available', status: 'loading' })).toBe(false);
    expect(stickersFailedToLoad({ availability: 'unavailable', status: 'idle' })).toBe(false);
    expect(stickersFailedToLoad({ availability: 'checking', status: 'idle' })).toBe(false);
    expect(stickersFailedToLoad(undefined)).toBe(false);
  });
});
