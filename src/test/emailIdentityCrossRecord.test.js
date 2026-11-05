/**
 * B-R1: what a profile email edit means for OTHER contacts.
 *
 * Runs the real identity engine (resolveContactCore) over stored contacts
 * written the way the app writes them: profile edits through
 * applyEmailEdit + buildEmailWrite, new contacts with identityFields. Each
 * case runs twice: in a workspace larger than the fallback scan window (only
 * the indexed queries can find a match) and in a small one (the scan sees
 * every contact).
 *
 * It pins two limitations that B-R1 does NOT change, and tracks them in a
 * follow-up issue:
 *   1. Only the PRIMARY address is an identity. An import of a contact's
 *      secondary address creates a second contact.
 *   2. A profile save does not look at other contacts. Making an address
 *      primary that another contact already has leaves two contacts with one
 *      identity, and the next import of it is refused as ambiguous
 *      (IdentityConflictError). It is never merged onto the wrong contact.
 * And it shows what the fix changes: a stale identity key used to merge an
 * import onto a contact that had given that address up.
 */
import { describe, it, expect } from 'vitest';
import { resolveContactCore, identityFields, IdentityConflictError, RESOLUTION } from '../utils/identityResolution.js';
import { readContactEmails, applyEmailEdit, buildEmailWrite } from '../utils/contactEmails.js';

const entry = (id, value, label = 'work') => ({ id, value, label });

/** Stored contacts, keyed by id, behind the adapter shape resolveContactCore reads. */
function workspace(docs, { smallEnoughToScan }) {
  return {
    userId: 'u1',
    getById: async (id) => docs.find((d) => d.id === id) ?? null,
    findByField: async (field, value) => docs.filter((d) => d[field] === value),
    loadScanWindow: async () => (smallEnoughToScan ? docs : []),
  };
}

/** A contact as a create path stores it. */
const created = (id, name, email) => ({ id, name, email, ...identityFields({ email }) });

/** A contact after a profile edit, as contactEmailService stores it. */
const edited = (contact, edit) => ({ ...contact, ...buildEmailWrite(applyEmailEdit(readContactEmails(contact), edit)) });

/** The same edit the old way: emails and email written, email_normalized left behind. */
const editedTheOldWay = (contact, edit) => {
  const { emails, email } = buildEmailWrite(applyEmailEdit(readContactEmails(contact), edit));
  return { ...contact, emails, email };
};

describe.each([
  ['a workspace larger than the scan window', false],
  ['a workspace the scan covers', true],
])('cross-record duplicate risk, in %s', (_label, smallEnoughToScan) => {
  const resolve = (docs, email) => resolveContactCore(workspace(docs, { smallEnoughToScan }), { email }, { source: 'test' });

  describe('limitation 1: a secondary address is not an identity', () => {
    const jane = edited(created('A', 'Jane Doe', 'jane@acme.test'), { type: 'upsert', entry: entry('1', 'Jane@Home.test', 'personal') });

    it('stores both addresses, with only the primary as the key', () => {
      expect(jane.emails.map((e) => e.value)).toEqual(['jane@acme.test', 'Jane@Home.test']);
      expect(jane.email_normalized).toBe('jane@acme.test');
    });

    it('an import of the secondary address finds nothing, so a second contact is created', async () => {
      expect((await resolve([jane], 'jane@home.test')).outcome).toBe(RESOLUTION.NEW);
    });

    it('that second contact is then the stable match for the address, with no conflict', async () => {
      const duplicate = created('B', 'J. Doe', 'jane@home.test');
      expect(await resolve([jane, duplicate], 'jane@home.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'B' });
      expect(await resolve([jane, duplicate], 'jane@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'A' });
    });

    it("a contact's secondary that is another contact's primary resolves to that other contact", async () => {
      const pat = created('B', 'Pat Lee', 'pat@acme.test');
      const withPat = edited(created('A', 'Jane Doe', 'jane@acme.test'), { type: 'upsert', entry: entry('1', 'pat@acme.test', 'other') });
      expect(await resolve([withPat, pat], 'pat@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'B' });
    });
  });

  describe('limitation 2: a profile save does not look at other contacts', () => {
    it('making an address primary that another contact has: the next import is refused, never merged', async () => {
      const pat = created('B', 'Pat Lee', 'pat@acme.test');
      const jane = edited(created('A', 'Jane Doe', 'jane@acme.test'), { type: 'upsert', entry: entry('0', 'Pat@Acme.test') });
      expect(jane.email_normalized).toBe('pat@acme.test');
      const refused = resolve([jane, pat], 'pat@acme.test');
      await expect(refused).rejects.toBeInstanceOf(IdentityConflictError);
      await expect(refused).rejects.toMatchObject({ signal: 'email', contactIds: ['A', 'B'] });
    });

    it('promoting a secondary that a duplicate already holds does the same', async () => {
      const jane = edited(created('A', 'Jane Doe', 'jane@acme.test'), { type: 'upsert', entry: entry('1', 'jane@home.test', 'personal') });
      const duplicate = created('B', 'J. Doe', 'jane@home.test');
      const promoted = edited(jane, { type: 'remove', id: '0' });
      expect(promoted).toMatchObject({ email: 'jane@home.test', email_normalized: 'jane@home.test' });
      await expect(resolve([promoted, duplicate], 'jane@home.test')).rejects.toBeInstanceOf(IdentityConflictError);
    });

    it('promoting a secondary that no one else holds makes it the match', async () => {
      const jane = edited(created('A', 'Jane Doe', 'jane@acme.test'), { type: 'upsert', entry: entry('1', 'jane@home.test', 'personal') });
      const promoted = edited(jane, { type: 'remove', id: '0' });
      expect(await resolve([promoted], 'jane@home.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'A' });
      expect((await resolve([promoted], 'jane@acme.test')).outcome).toBe(RESOLUTION.NEW);
    });
  });

  describe('what the fix changes: a stale key no longer claims an address the contact gave up', () => {
    // Jane's address was mistyped, and corrected. The mistyped address belongs to someone else.
    const typo = created('A', 'Jane Doe', 'jdoe@acme.test');
    const correction = { type: 'upsert', entry: entry('0', 'jane.doe@acme.test') };

    it('before: an import of the old address merged onto Jane', async () => {
      const stale = editedTheOldWay(typo, correction);
      expect(stale).toMatchObject({ email: 'jane.doe@acme.test', email_normalized: 'jdoe@acme.test' });
      expect(await resolve([stale], 'jdoe@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'A' });
    });

    it('after: the old address is free, and the new one is Jane', async () => {
      const fixed = edited(typo, correction);
      expect((await resolve([fixed], 'jdoe@acme.test')).outcome).toBe(RESOLUTION.NEW);
      expect(await resolve([fixed], 'jane.doe@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'A' });
    });

    it('before: once the real owner was added, every import of their address was refused as ambiguous', async () => {
      const stale = editedTheOldWay(typo, correction);
      const owner = created('B', 'John Doe', 'jdoe@acme.test');
      await expect(resolve([stale, owner], 'jdoe@acme.test')).rejects.toBeInstanceOf(IdentityConflictError);
    });

    it('after: it matches the real owner', async () => {
      const owner = created('B', 'John Doe', 'jdoe@acme.test');
      expect(await resolve([edited(typo, correction), owner], 'jdoe@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'B' });
    });

    it('after clearing every address, the contact claims none of them', async () => {
      const cleared = edited(typo, { type: 'remove', id: '0' });
      expect(cleared).toMatchObject({ emails: [], email: null, email_normalized: null });
      const owner = created('B', 'John Doe', 'jdoe@acme.test');
      expect(await resolve([cleared, owner], 'jdoe@acme.test')).toMatchObject({ outcome: RESOLUTION.MATCHED, contactId: 'B' });
    });
  });
});
