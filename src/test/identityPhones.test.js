/**
 * Phones in identity matching: only a person's own number may merge people.
 *
 * A record with a typed phone list (`phones[]`) is identified by its mobile,
 * direct or home number only. A main, work, fax, other or unknown line may be
 * shared by everyone at a company, so two coworkers who share one must stay two
 * people. Records without the list (untyped) match as they did before, until
 * their numbers are typed. Merges keep a record's `phone` and its identity key
 * on the same number.
 */
import { describe, it, expect } from 'vitest';
import { extractIdentifiers } from '../utils/identityNormalization';
import { resolveContactCore, mergeIdentifiers, identityFields, RESOLUTION } from '../utils/identityResolution';
import { buildPhoneWrite } from '../utils/contactPhones';

/** An in-memory workspace: the three calls the resolver makes, as the real adapters behave. */
function workspace(rows) {
  const copy = r => ({ ...r });
  return {
    userId: 'u1',
    async getById(id) { const r = rows.find(x => x.id === id); return r ? copy(r) : null; },
    async findByField(field, value) { return rows.filter(r => r[field] === value).slice(0, 5).map(copy); },
    async loadScanWindow() { return rows.slice(0, 200).map(copy); },
  };
}

const phone = (value, label) => ({ value, label, labelSource: 'card' });

/** A stored contact whose numbers were saved through the canonical model. */
const stored = (id, name, email, phones) => ({
  id, name, company_name: 'Acme', email, email_normalized: email, ...buildPhoneWrite(phones),
});

const resolve = (rows, candidate) => resolveContactCore(workspace(rows), candidate, { source: 'test' });

// ─── What identifies a typed record ─────────────────────────────────────────

describe('a typed record is identified only by a mobile, direct or home number', () => {
  it('mobile, then direct, then home', () => {
    expect(extractIdentifiers({ phones: [phone('801-555-1000', 'main'), phone('801-555-2000', 'work'), phone('801-555-5678', 'mobile')] }).phone).toBe('8015555678');
    expect(extractIdentifiers({ phones: [phone('801-555-9999', 'home'), phone('801-555-1234', 'direct')] }).phone).toBe('8015551234');
    expect(extractIdentifiers({ phones: [phone('801-555-9999', 'home')] }).phone).toBe('8015559999');
  });

  it('main, work, fax, other and unknown never identify, and nothing falls back to `phone`', () => {
    const record = {
      phones: ['main', 'work', 'fax', 'other', 'unknown'].map((label, i) => phone(`801-555-100${i}`, label)),
      phone: '801-555-1000', phone_normalized: '8015551000', phone_mobile: '801-555-7777', phone_numbers: [{ sanitized_number: '+18015557777' }],
    };
    expect(extractIdentifiers(record).phone).toBeNull();
    expect(extractIdentifiers({ phones: [] , phone: '801-555-1000' }).phone).toBeNull();
  });

  it('reads the profile editor\'s older list shape, and ignores an extension', () => {
    expect(extractIdentifiers({ phones: [{ id: '1', value: '801-555-2000', label: 'work' }, { id: '2', value: '801-555-5678', label: 'mobile' }] }).phone).toBe('8015555678');
    expect(extractIdentifiers({ phones: [phone('801-555-1234 x12', 'direct')] }).phone).toBe('8015551234');
  });

  it('agrees with the phone_normalized the canonical model writes', () => {
    const lists = [
      [phone('801-555-1000', 'main'), phone('801-555-1234', 'direct'), phone('801-555-5678', 'mobile')],
      [phone('801-555-1000', 'main'), phone('801-555-2000', 'work')],
      [phone('+1 801 555 9999', 'home'), phone('801-555-1001', 'fax')],
      [phone('801-555-1234 x7', 'direct')],
      [],
    ];
    for (const list of lists) {
      const write = buildPhoneWrite(list);
      expect(extractIdentifiers(write).phone).toBe(write.phone_normalized);
    }
  });

  it('a typed candidate carries only its person-level number into the record it creates', () => {
    expect(identityFields({ phones: [phone('801-555-1000', 'main')] })).toEqual({});
    expect(identityFields({ phones: [phone('801-555-1000', 'main'), phone('801-555-5678', 'mobile')] })).toEqual({ phone_normalized: '8015555678' });
  });

  it('an untyped record reads the older fields exactly as before', () => {
    expect(extractIdentifiers({ phone: '801-555-1000' }).phone).toBe('8015551000');
    expect(extractIdentifiers({ phone_normalized: '8015551000', phone: '801-555-9999' }).phone).toBe('8015551000');
    expect(extractIdentifiers({ phone_mobile: '801-555-5678' }).phone).toBe('8015555678');
    expect(extractIdentifiers({ phone_numbers: [{ sanitized_number: '+18015551000' }] }).phone).toBe('+18015551000');
  });
});

// ─── Coworkers: the regression this exists for ──────────────────────────────

describe('two coworkers who share a main or work number stay two people', () => {
  // As a save path builds a candidate: the list, plus the single fields derived
  // from it. When the shared line is a person's only number, it is also their
  // `phone` (the number to call), which is exactly what used to be matched on.
  const candidate = (name, email, phones) => ({ name, company_name: 'Acme', email, ...buildPhoneWrite(phones) });

  it.each(['main', 'work'])('the same %s line: a second coworker is created, not merged into the first', async (label) => {
    const avery = stored('a', 'Avery Quinn', 'avery@acme.example', [phone('801-555-1000', label)]);
    expect(avery).toMatchObject({ phone: '801-555-1000', phone_normalized: null });

    const blakeShared = candidate('Blake Rivera', 'blake@acme.example', [phone('(801) 555-1000', label)]);
    expect(await resolve([avery], blakeShared)).toMatchObject({ outcome: RESOLUTION.NEW, contactId: null });

    const blakeWithDirect = candidate('Blake Rivera', 'blake@acme.example', [phone('801-555-1000', label), phone('801-555-2222', 'direct')]);
    expect(await resolve([avery], blakeWithDirect)).toMatchObject({ outcome: RESOLUTION.NEW, contactId: null });
  });

  it('either side may hold the shared line with a person-level number too', async () => {
    const avery = stored('a', 'Avery Quinn', 'avery@acme.example', [phone('801-555-1000', 'main'), phone('801-555-1111', 'mobile')]);
    const blake = candidate('Blake Rivera', 'blake@acme.example', [phone('801-555-1000', 'main')]);
    expect(await resolve([avery], blake)).toMatchObject({ outcome: RESOLUTION.NEW });
  });

  it('two coworkers already saved with the same main line: a third is created, not refused as a conflict', async () => {
    const rows = [
      stored('a', 'Avery Quinn', 'avery@acme.example', [phone('801-555-1000', 'main')]),
      stored('c', 'Casey Moss', 'casey@acme.example', [phone('801-555-1000', 'main')]),
    ];
    const blake = candidate('Blake Rivera', 'blake@acme.example', [phone('801-555-1000', 'main')]);
    expect(await resolve(rows, blake)).toMatchObject({ outcome: RESOLUTION.NEW });
  });

  it('a typed record does not answer to its shared line even when `phone` holds it as bare digits', async () => {
    // No mobile, direct or home: `phone` is the main line, stored here exactly
    // as digits so the raw `phone` query finds it. It must not match.
    const avery = stored('a', 'Avery Quinn', null, [phone('8015551000', 'main')]);
    expect(avery.phone).toBe('8015551000');
    const result = await resolve([avery], { name: 'Blake Rivera', phone: '801-555-1000' });
    expect(result.outcome).toBe(RESOLUTION.NEW);
  });
});

// ─── What still matches ─────────────────────────────────────────────────────

describe('a person\'s own number still matches', () => {
  it('a mobile, direct or home number on a typed record merges as before', async () => {
    const avery = stored('a', 'Avery Quinn', 'avery@acme.example', [phone('801-555-1000', 'main'), phone('801-555-1111', 'mobile')]);
    const byUntyped = await resolve([avery], { name: 'A. Quinn', phone: '801-555-1111' });
    expect(byUntyped).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'a', signal: 'phone' });
    const byTyped = await resolve([avery], { name: 'A. Quinn', phones: [phone('801-555-1111', 'mobile')] });
    expect(byTyped).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'a', signal: 'phone' });
  });

  it('untyped records keep today\'s phone matching until their numbers are typed', async () => {
    const legacy = { id: 'l', name: 'Lee Park', phone: '801-555-1000', phone_normalized: '8015551000' };
    expect(await resolve([legacy], { phone: '(801) 555-1000' })).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'l' });
  });
});

// ─── Merging ────────────────────────────────────────────────────────────────

describe('a merge keeps a record\'s phone and its identity key on the same number', () => {
  it('a record that already has a number keeps it as its key; the incoming one does not take over', () => {
    const patch = mergeIdentifiers({ id: 'x', phone: '801-555-1111' }, { email: 'a@acme.example', phone: '801-555-1000' });
    expect(patch).not.toHaveProperty('phone');
    expect(patch.phone_normalized).toBe('8015551111');                 // used to become 8015551000
  });

  it('a key already set is left alone', () => {
    const patch = mergeIdentifiers({ id: 'x', phone: '801-555-1111', phone_normalized: '8015551111' }, { phone: '801-555-1000' });
    expect(patch).not.toHaveProperty('phone');
    expect(patch).not.toHaveProperty('phone_normalized');
  });

  it('a record with no number gets the incoming one, and its key with it', () => {
    expect(mergeIdentifiers({ id: 'x' }, { phone: '801-555-1000' })).toMatchObject({ phone: '801-555-1000', phone_normalized: '8015551000' });
  });

  it('a typed record\'s list owns its numbers: a merge writes no phone field, even into a gap', () => {
    const typed = { id: 'x', ...buildPhoneWrite([phone('801-555-1000', 'main')]) };
    expect(typed).toMatchObject({ phone_mobile: null, phone_normalized: null });
    const patch = mergeIdentifiers(typed, { email: 'a@acme.example', phone: '801-555-3333', phone_mobile: '801-555-3333' });
    expect(Object.keys(patch).filter(k => k.startsWith('phone'))).toEqual([]);
    expect(patch.email).toBe('a@acme.example');                         // other identifiers still merge
  });
});
