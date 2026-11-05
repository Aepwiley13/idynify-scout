/**
 * contactEmails (src/utils/contactEmails.js): email, emails[] and
 * email_normalized written together, so the identity engine matches the
 * address a contact actually has.
 *
 * The identity cases at the bottom run the real resolver: before this fix a
 * profile edit left email_normalized on the OLD address, so the contact kept
 * matching an address it no longer had and missed the one it did.
 */
import { describe, it, expect } from 'vitest';
import {
  readContactEmails,
  applyEmailEdit,
  buildEmailWrite,
  pickEmailFields,
  hasAnyEmail,
  emailIdentityDrift,
  EMAIL_DRIFT,
} from '../utils/contactEmails.js';
import { resolveContactCore, RESOLUTION } from '../utils/identityResolution.js';

const entry = (id, value, label = 'work') => ({ id, value, label });

describe('readContactEmails', () => {
  it('reads emails[] when it has entries, giving each an id', () => {
    expect(readContactEmails({ email: 'a@x.test', emails: [{ value: 'a@x.test', label: 'work' }, { id: 'p', value: 'b@x.test', label: 'personal' }] }))
      .toEqual([entry('0', 'a@x.test'), entry('p', 'b@x.test', 'personal')]);
  });

  it('falls back to email, then work_email, as one work entry', () => {
    expect(readContactEmails({ email: ' a@x.test ' })).toEqual([entry('0', 'a@x.test')]);
    expect(readContactEmails({ work_email: 'w@x.test' })).toEqual([entry('0', 'w@x.test')]);
    expect(readContactEmails({ emails: [] })).toEqual([]);
    expect(readContactEmails({})).toEqual([]);
  });

  it('turns an unknown label into work', () => {
    expect(readContactEmails({ emails: [{ id: '1', value: 'a@x.test', label: 'fax' }] })[0].label).toBe('work');
  });
});

describe('applyEmailEdit', () => {
  const list = [entry('1', 'a@x.test'), entry('2', 'b@x.test', 'personal')];

  it('changes an entry by id, or adds one at the end', () => {
    expect(applyEmailEdit(list, { type: 'upsert', entry: entry('2', 'c@x.test', 'other') })).toEqual([entry('1', 'a@x.test'), entry('2', 'c@x.test', 'other')]);
    expect(applyEmailEdit(list, { type: 'upsert', entry: entry('3', 'd@x.test') })).toHaveLength(3);
  });

  it('removes an entry by id', () => {
    expect(applyEmailEdit(list, { type: 'remove', id: '1' })).toEqual([entry('2', 'b@x.test', 'personal')]);
    expect(applyEmailEdit(list, { type: 'remove', id: 'nope' })).toEqual(list);
  });

  it('refuses an edit it does not know', () => {
    expect(() => applyEmailEdit(list, { type: 'replace_all', entries: [] })).toThrow();
    expect(() => applyEmailEdit(list, { type: 'upsert', entry: { value: 'x@x.test' } })).toThrow();
  });
});

describe('buildEmailWrite', () => {
  it('writes the list, the primary and its identity key together', () => {
    expect(buildEmailWrite([entry('1', ' Jane.Doe@Acme.COM '), entry('2', 'jane@home.test', 'personal')])).toEqual({
      emails: [entry('1', 'Jane.Doe@Acme.COM'), entry('2', 'jane@home.test', 'personal')],
      email: 'Jane.Doe@Acme.COM',
      email_normalized: 'jane.doe@acme.com',
    });
  });

  it('clearing every address clears email and email_normalized too', () => {
    expect(buildEmailWrite([])).toEqual({ emails: [], email: null, email_normalized: null });
    expect(buildEmailWrite([entry('1', '   ')])).toEqual({ emails: [], email: null, email_normalized: null });
  });

  it('replacing the primary moves the identity key with it', () => {
    const before = buildEmailWrite([entry('1', 'old@acme.test')]);
    const after = buildEmailWrite(applyEmailEdit(before.emails, { type: 'upsert', entry: entry('1', 'New@Acme.test') }));
    expect(after).toMatchObject({ email: 'New@Acme.test', email_normalized: 'new@acme.test' });
  });

  it('removing the primary promotes the next address', () => {
    const write = buildEmailWrite(applyEmailEdit([entry('1', 'a@x.test'), entry('2', 'b@x.test')], { type: 'remove', id: '1' }));
    expect(write).toMatchObject({ email: 'b@x.test', email_normalized: 'b@x.test' });
  });

  it('keeps an address once, ignoring case, the first entry winning', () => {
    expect(buildEmailWrite([entry('1', 'a@x.test'), entry('2', 'A@X.TEST', 'personal'), entry('3', 'b@x.test')]).emails)
      .toEqual([entry('1', 'a@x.test'), entry('3', 'b@x.test')]);
  });

  it('keeps a value that is not an address, but it identifies nobody', () => {
    expect(buildEmailWrite([entry('1', 'not an address')])).toEqual({ emails: [entry('1', 'not an address')], email: 'not an address', email_normalized: null });
  });

  it('a secondary address never becomes the identity key', () => {
    expect(buildEmailWrite([entry('1', 'primary@x.test'), entry('2', 'Second@x.test')]).email_normalized).toBe('primary@x.test');
  });
});

describe('pickEmailFields', () => {
  it('returns the three email fields of a saved contact, and nothing else', () => {
    const saved = { id: 'c1', name: 'Jane', engagement_summary: { total_messages_sent: 0 }, ...buildEmailWrite([entry('1', 'Jane@Acme.test')]) };
    expect(pickEmailFields(saved)).toEqual({ emails: [entry('1', 'Jane@Acme.test')], email: 'Jane@Acme.test', email_normalized: 'jane@acme.test' });
    expect(pickEmailFields({})).toEqual({ emails: [], email: null, email_normalized: null });
  });
});

describe('hasAnyEmail', () => {
  it('counts email, work_email or any non-blank entry', () => {
    expect(hasAnyEmail({ email: 'a@x.test' })).toBe(true);
    expect(hasAnyEmail({ work_email: 'a@x.test' })).toBe(true);
    expect(hasAnyEmail({ emails: [{ value: 'a@x.test' }] })).toBe(true);
    expect(hasAnyEmail({ email: ' ', emails: [{ value: '' }] })).toBe(false);
    expect(hasAnyEmail({})).toBe(false);
  });
});

describe('emailIdentityDrift', () => {
  it.each([
    ['a consistent contact', { email: 'A@x.test', email_normalized: 'a@x.test', emails: [entry('1', 'A@x.test')] }, []],
    ['a legacy contact with no emails[]', { email: 'a@x.test', email_normalized: 'a@x.test' }, []],
    ['no address at all', {}, []],
    ['an address without its key', { email: 'a@x.test' }, [EMAIL_DRIFT.NORMALIZED_MISSING]],
    ['a key for another address (the profile-edit defect)', { email: 'new@x.test', email_normalized: 'old@x.test', emails: [entry('1', 'new@x.test')] }, [EMAIL_DRIFT.NORMALIZED_STALE]],
    ['a key with the address cleared', { email: null, email_normalized: 'old@x.test', emails: [] }, [EMAIL_DRIFT.NORMALIZED_WITHOUT_EMAIL]],
    ['emails[] without email (the ContactInfo defect)', { emails: [entry('1', 'a@x.test')] }, [EMAIL_DRIFT.PRIMARY_MISMATCH]],
    ['a blank and a repeated entry', { email: 'a@x.test', email_normalized: 'a@x.test', emails: [entry('1', 'a@x.test'), entry('2', ''), entry('3', 'A@x.test')] }, [EMAIL_DRIFT.BLANK_ENTRIES, EMAIL_DRIFT.DUPLICATE_ENTRIES]],
  ])('%s', (_label, contact, codes) => {
    expect(emailIdentityDrift(contact)).toEqual(codes);
  });

  it('a contact written by buildEmailWrite never drifts', () => {
    for (const list of [[], [entry('1', 'X@Y.test')], [entry('1', 'a@x.test'), entry('2', 'A@X.test'), entry('3', '')]]) {
      expect(emailIdentityDrift(buildEmailWrite(list))).toEqual([]);
    }
  });
});

describe('the identity engine finds the address the contact has', () => {
  /** An adapter over stored contacts, with no fallback scan: a workspace larger than the window. */
  const adapterOver = (docs) => ({
    userId: 'u1',
    getById: async () => null,
    findByField: async (field, value) => docs.filter((d) => d[field] === value),
    loadScanWindow: async () => [],
  });
  const resolve = (docs, email) => resolveContactCore(adapterOver(docs), { email }, { source: 'test' });
  const original = { id: 'c1', name: 'Jane Doe', email: 'old@acme.test', email_normalized: 'old@acme.test' };

  it('before: an edit that left email_normalized behind is missed under its new address', async () => {
    const editedTheOldWay = { ...original, email: 'Jane@Acme.test', emails: [entry('1', 'Jane@Acme.test')] };
    expect((await resolve([editedTheOldWay], 'jane@acme.test')).outcome).toBe(RESOLUTION.NEW);
    expect((await resolve([editedTheOldWay], 'old@acme.test')).outcome).toBe(RESOLUTION.MATCHED);
  });

  it('after: the contact matches its new address, and no longer the old one', async () => {
    const edited = { ...original, ...buildEmailWrite([entry('1', 'Jane@Acme.test')]) };
    expect(await resolve([edited], 'jane@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'c1' });
    expect((await resolve([edited], 'old@acme.test')).outcome).toBe(RESOLUTION.NEW);
  });

  it('after clearing, the contact matches no address', async () => {
    const cleared = { ...original, ...buildEmailWrite([]) };
    expect((await resolve([cleared], 'old@acme.test')).outcome).toBe(RESOLUTION.NEW);
  });

  it('a secondary address does not match (only the primary is an identity today)', async () => {
    const withSecond = { ...original, ...buildEmailWrite([entry('1', 'old@acme.test'), entry('2', 'jane@home.test', 'personal')]) };
    expect((await resolve([withSecond], 'jane@home.test')).outcome).toBe(RESOLUTION.NEW);
    expect((await resolve([withSecond], 'old@acme.test')).outcome).toBe(RESOLUTION.MATCHED);
  });
});
