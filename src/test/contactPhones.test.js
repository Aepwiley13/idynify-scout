/**
 * The canonical phone model: labels (src/utils/phoneLabels.js) and the
 * read/write helpers (src/utils/contactPhones.js).
 *
 * Pins the approved printed-label table exactly, that a number's type is never
 * guessed, how every older record shape reads, that a deleted number stays
 * deleted, and that only a mobile, direct or home number identifies a person.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTACT_PHONE_LABELS, PERSON_PHONE_LABELS, labelFromPrinted, labelFromProviderType,
} from '../utils/phoneLabels';
import {
  makePhone, splitExtension, readContactPhones, buildPhoneWrite, primaryPhone, textablePhone, identityPhone,
  sortPhonesForDisplay, phoneDisplay,
} from '../utils/contactPhones';

const labels = list => list.map(p => `${p.label} ${p.value}`);

// ─── Labels ─────────────────────────────────────────────────────────────────

describe('phone labels', () => {
  it('one vocabulary; only mobile, direct and home identify a person', () => {
    expect(CONTACT_PHONE_LABELS).toEqual(['mobile', 'direct', 'main', 'work', 'fax', 'home', 'other', 'unknown']);
    expect(PERSON_PHONE_LABELS).toEqual(['mobile', 'direct', 'home']);
  });

  it.each([
    ['Main', 'main'], ['Main Line', 'main'], ['Main Office', 'main'], ['Switchboard', 'main'],
    ['Direct', 'direct'], ['D', 'direct'], ['DD', 'direct'], ['Direct Line', 'direct'],
    ['Mobile', 'mobile'], ['M', 'mobile'], ['Cell', 'mobile'], ['C', 'mobile'],
    ['Office', 'work'], ['O', 'work'], ['Work', 'work'], ['W', 'work'],
    ['Fax', 'fax'], ['F', 'fax'],
    ['Tel', 'unknown'], ['T', 'unknown'], ['Phone', 'unknown'], ['P', 'unknown'], ['Ph', 'unknown'],
  ])('printed %s → %s (the approved table)', (printed, label) => {
    expect(labelFromPrinted(printed)).toBe(label);
  });

  it('reads a printed label the way it is printed: case, colons, dots and spacing', () => {
    expect(['MAIN:', 'main line:', ' Main  Office ', 'D.', 'd:', 'C:', 'Tel.:'].map(labelFromPrinted))
      .toEqual(['main', 'main', 'main', 'direct', 'direct', 'mobile', 'unknown']);
  });

  it('infers nothing beyond the table: no label, or one not listed, is unknown', () => {
    for (const printed of [null, undefined, '', 'Mob', 'Cellular', 'Telephone', 'Toll Free', 'Tel/Fax', 'Hotline', 'HQ', 'Dir', 'Home']) {
      expect(labelFromPrinted(printed), String(printed)).toBe('unknown');
    }
  });

  it('a provider type counts only when it is one the enrichment code already uses', () => {
    expect(['mobile', 'Direct', 'work', 'home', 'fax', 'other'].map(labelFromProviderType)).toEqual(['mobile', 'direct', 'work', 'home', 'fax', 'other']);
    expect(['work_hq', 'hq', 'main', '', null, undefined].map(labelFromProviderType)).toEqual(Array(6).fill('unknown'));
  });
});

// ─── One entry ──────────────────────────────────────────────────────────────

describe('a canonical entry', () => {
  it('keeps value, extension, label, its source, the observed label and the matching form', () => {
    expect(makePhone({ id: 'a', value: '801-555-1000', label: 'main', labelSource: 'card', observedLabel: 'Main' })).toEqual({
      id: 'a', value: '801-555-1000', extension: null, label: 'main', labelSource: 'card', observedLabel: 'Main', normalized: '8015551000',
    });
  });

  it('splits an extension off the number', () => {
    expect(splitExtension('+1 801 555 1000 x204')).toEqual({ value: '+1 801 555 1000', extension: '204' });
    expect(splitExtension('801-555-1000 ext. 12')).toEqual({ value: '801-555-1000', extension: '12' });
    expect(makePhone({ value: '801-555-1000 x204', label: 'work', labelSource: 'user' })).toMatchObject({ value: '801-555-1000', extension: '204', normalized: '8015551000' });
  });

  it('an unrecognised label is unknown, and an unknown label claims no source', () => {
    expect(makePhone({ value: '801-555-1000', label: 'office', labelSource: 'card' })).toMatchObject({ label: 'unknown', labelSource: null });
    expect(makePhone({ value: '801-555-1000', label: 'unknown', labelSource: 'user' })).toMatchObject({ label: 'unknown', labelSource: null });
    expect(makePhone({ value: '801-555-1000', label: 'mobile', labelSource: 'guess' })).toMatchObject({ label: 'mobile', labelSource: null });
  });

  it('no number, no entry', () => {
    expect(makePhone({ value: '' })).toBeNull();
    expect(makePhone({ value: { sanitized_number: '+18015551000' } })).toBeNull();
    expect(makePhone()).toBeNull();
  });
});

// ─── Reading a contact ──────────────────────────────────────────────────────

describe('reading a contact\'s numbers', () => {
  it('an enriched record without phones[]: typed by the field each number sits in', () => {
    const list = readContactPhones({
      phone: '+18015555678', phone_mobile: '+18015555678', phone_direct: '+18015551234', phone_work: '+18015551000', phone_home: '+18015559999',
    });
    expect(labels(list)).toEqual(['mobile +18015555678', 'direct +18015551234', 'work +18015551000', 'home +18015559999']);
    expect(list.every(p => p.labelSource === 'legacy')).toBe(true);
  });

  it('a bare `phone` is unknown: it is no longer shown as "mobile"', () => {
    expect(readContactPhones({ phone: '801-555-1000' })).toEqual([
      { id: 'phone', value: '801-555-1000', extension: null, label: 'unknown', labelSource: null, observedLabel: null, normalized: '8015551000' },
    ]);
  });

  it('a provider\'s numbers carry its own type as the observed label', () => {
    const list = readContactPhones({ phone_numbers: [{ sanitized_number: '+18015551000', type: 'work_hq' }, { raw_number: '801 555 5678', type: 'mobile' }] });
    expect(list.map(p => [p.label, p.labelSource, p.observedLabel])).toEqual([['unknown', null, 'work_hq'], ['mobile', 'enrichment', 'mobile']]);
  });

  it('a number already listed is not listed again', () => {
    const list = readContactPhones({ phone: '+18015555678', phone_mobile: '+18015555678', phone_numbers: [{ sanitized_number: '+18015555678', type: 'mobile' }] });
    expect(labels(list)).toEqual(['mobile +18015555678']);
  });

  it('a provider object stored in `phone` is read for its number, never shown as [object Object]', () => {
    expect(labels(readContactPhones({ phone: { sanitized_number: '+18015551234', type: 'direct' } }))).toEqual(['direct +18015551234']);
    expect(readContactPhones({ phone: { nothing: true } })).toEqual([]);
  });

  it('phones[] from the profile editor is the list, labels kept as the user\'s', () => {
    const list = readContactPhones({
      phones: [{ id: 1726000000000, value: '801-555-5678', label: 'mobile' }, { id: '2', value: '801-555-1000', label: 'work' }],
      phone_mobile: '+18019990000',                                       // an old field the editor never cleared
    });
    expect(labels(list)).toEqual(['mobile 801-555-5678', 'work 801-555-1000']);
    expect(list.map(p => [p.id, p.labelSource])).toEqual([['1726000000000', 'user'], ['2', 'user']]);
  });

  it('an emptied phones[] stays empty: a deleted number does not come back from an old field', () => {
    expect(readContactPhones({ phones: [], phone_mobile: '+18015555678', phone_numbers: [{ sanitized_number: '+18015555678', type: 'mobile' }] })).toEqual([]);
  });

  it('a new-shape list reads back exactly, provenance included', () => {
    const entry = { id: 'x', value: '801-555-1000', extension: '12', label: 'main', labelSource: 'card', observedLabel: 'Main Line', normalized: '8015551000' };
    expect(readContactPhones({ phones: [entry] })).toEqual([entry]);
  });

  it('nothing at all', () => {
    expect(readContactPhones({})).toEqual([]);
    expect(readContactPhones(null)).toEqual([]);
  });
});

// ─── Which number for what ──────────────────────────────────────────────────

describe('choosing a number', () => {
  const card = [
    makePhone({ id: '1', value: '801-555-1000', label: 'main', labelSource: 'card' }),
    makePhone({ id: '2', value: '801-555-1234', label: 'direct', labelSource: 'card' }),
    makePhone({ id: '3', value: '801-555-5678', label: 'mobile', labelSource: 'card' }),
    makePhone({ id: '4', value: '801-555-1001', label: 'fax', labelSource: 'card' }),
  ];

  it('call: mobile first; text: mobile; identity: mobile, direct or home', () => {
    expect(primaryPhone(card).value).toBe('801-555-5678');
    expect(textablePhone(card).value).toBe('801-555-5678');
    expect(identityPhone(card).value).toBe('801-555-5678');
    const noMobile = card.filter(p => p.label !== 'mobile');
    expect(primaryPhone(noMobile).value).toBe('801-555-1234');
    expect(textablePhone(noMobile)).toBeNull();
    expect(identityPhone(noMobile).value).toBe('801-555-1234');
  });

  it('text goes to a mobile, else a number whose type isn\'t set; never main, work, direct, home or fax', () => {
    const unset = makePhone({ id: '5', value: '801-555-4444' });
    expect(textablePhone([unset, card[2]]).value).toBe('801-555-5678');               // mobile first
    expect(textablePhone([card[0], unset]).value).toBe('801-555-4444');
    for (const label of ['main', 'work', 'direct', 'home', 'fax', 'other']) {
      expect(textablePhone([makePhone({ value: '801-555-1000', label, labelSource: 'user' })]), label).toBeNull();
    }
  });

  it('a main, work, fax, other or unknown number never identifies the person', () => {
    for (const label of ['main', 'work', 'fax', 'other', 'unknown']) {
      expect(identityPhone([makePhone({ value: '801-555-1000', label, labelSource: 'card' })]), label).toBeNull();
    }
    expect(identityPhone([makePhone({ value: '801-555-9999', label: 'home', labelSource: 'user' })]).value).toBe('801-555-9999');
  });

  it('a fax is never the number to call', () => {
    expect(primaryPhone([card[3]])).toBeNull();
    expect(primaryPhone([card[3], card[0]]).value).toBe('801-555-1000');
  });

  it('lists mobile, direct, main, work, home, other, unknown, then fax', () => {
    const mixed = ['fax', 'unknown', 'work', 'main', 'home', 'mobile', 'other', 'direct']
      .map((label, i) => makePhone({ id: String(i), value: `801-555-10${10 + i}`, label, labelSource: 'user' }));
    expect(sortPhonesForDisplay(mixed).map(p => p.label)).toEqual(['mobile', 'direct', 'main', 'work', 'home', 'other', 'unknown', 'fax']);
  });
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe('writing a contact\'s numbers', () => {
  it('the list, plus the single fields derived from it', () => {
    const write = buildPhoneWrite([
      { id: '1', value: '801-555-1000', label: 'main', labelSource: 'card', observedLabel: 'Main' },
      { id: '2', value: '801-555-1234 x12', label: 'direct', labelSource: 'card', observedLabel: 'D' },
      { id: '3', value: '801-555-5678', label: 'mobile', labelSource: 'card', observedLabel: 'C' },
    ]);
    expect(write).toMatchObject({
      phone: '801-555-5678', phone_mobile: '801-555-5678', phone_direct: '801-555-1234 x12', phone_work: null, phone_home: null,
      phone_normalized: '8015555678',
    });
    expect(write.phones.map(p => [p.label, p.observedLabel, p.extension])).toEqual([['main', 'Main', null], ['direct', 'D', '12'], ['mobile', 'C', null]]);
  });

  it('a type the list no longer has clears its single field', () => {
    expect(buildPhoneWrite([])).toEqual({ phones: [], phone: null, phone_mobile: null, phone_direct: null, phone_work: null, phone_home: null, phone_normalized: null });
  });

  it('a person with only a main or work line has no identity number', () => {
    const write = buildPhoneWrite([{ value: '801-555-1000', label: 'main', labelSource: 'card' }, { value: '801-555-2000', label: 'work', labelSource: 'user' }]);
    expect(write.phone).toBe('801-555-1000');                                           // still callable
    expect(write.phone_normalized).toBeNull();                                          // never an identity
  });

  it('two coworkers sharing a main line get no shared identity number', () => {
    const a = buildPhoneWrite([{ value: '801-555-1000', label: 'main', labelSource: 'card' }, { value: '801-555-1111', label: 'mobile', labelSource: 'card' }]);
    const b = buildPhoneWrite([{ value: '(801) 555-1000', label: 'main', labelSource: 'card' }, { value: '801-555-2222', label: 'direct', labelSource: 'card' }]);
    expect(a.phone_normalized).toBe('8015551111');
    expect(b.phone_normalized).toBe('8015552222');
  });

  it('round trip: what is written reads back as the same list', () => {
    const list = [
      makePhone({ id: 'a', value: '+1 801 555 1000', extension: '204', label: 'work', labelSource: 'user', observedLabel: 'Office' }),
      makePhone({ id: 'b', value: '801-555-5678', label: 'unknown' }),
    ];
    expect(readContactPhones(buildPhoneWrite(list))).toEqual(list);
  });

  it('is Firestore-safe: no undefined anywhere', () => {
    const write = buildPhoneWrite(readContactPhones({ phone: '801-555-1000', phone_mobile: '801-555-5678' }));
    expect(JSON.stringify(write)).not.toContain('undefined');
    const walk = v => (v === undefined ? false : v && typeof v === 'object' ? Object.values(v).every(walk) : true);
    expect(walk(write)).toBe(true);
  });

  it('display form', () => {
    expect(phoneDisplay(makePhone({ value: '801-555-1000 x9' }))).toBe('801-555-1000 x9');
    expect(phoneDisplay(null)).toBeNull();
  });
});
