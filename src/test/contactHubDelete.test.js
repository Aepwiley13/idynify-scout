import { describe, expect, it, vi } from 'vitest';
import { createContactHubDelete } from '../../netlify/functions/utils/contactHubDelete';

const contact = 'users/owner/contacts/a';
const queue = 'users/owner/nbs_queue/q';

function fixture() {
  const data = new Map([
    ['users/owner', {}], [contact, { notes: ['hello'], sticker_ids: ['s'] }],
    [contact + '/private/photo', {}], [contact + '/timeline/event', {}],
    [queue, { contact_id: 'a' }],
    ['users/owner/companies/company', {}], ['users/owner/stickers/s', {}],
    ['users/owner/contacts/b', {}], ['users/other/contacts/a', {}],
    ['contact_hub_gmail_limits/owner/attempts/key', {}],
  ]);
  const query = (path, predicate = () => true, max = Infinity) => ({
    query: true, path, predicate, max,
    doc: (id) => doc(path + '/' + id),
    where: (field, _, value) => query(path, (row) => predicate(row) && row[field] === value, max),
    limit: (limit) => query(path, predicate, limit),
  });
  const doc = (path) => ({ path, collection: (name) => query(path + '/' + name) });
  const db = {
    doc, collection: query,
    runTransaction: vi.fn(async (work) => {
      const removed = [];
      const result = await work({
        get: async (ref) => ref.query ? { docs: [...data].filter(([path, row]) => {
          const parent = path.slice(0, path.lastIndexOf('/'));
          return parent === ref.path && ref.predicate(row);
        }).slice(0, ref.max).map(([path, row]) => ({ ref: doc(path), data: () => row })) }
          : { exists: data.has(ref.path) },
        delete: (ref) => removed.push(ref.path),
      });
      removed.forEach((path) => data.delete(path));
      return result;
    }),
  };
  const handler = createContactHubDelete({
    db, now: () => 100,
    verifyToken: async (token) => token === 'custom' ? { uid: 'owner', firebase: { sign_in_provider: 'custom' } } : { uid: token },
  });
  const remove = async (contactIds, token = 'owner') => {
    const result = await handler({
      httpMethod: 'POST', headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid: 'owner', contactIds }),
    });
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  return { remove, data, db };
}

describe('Contact Hub trusted deletion', () => {
  it('removes the contact, private photo, timeline and queue while retaining shared and send records', async () => {
    const { remove, data } = fixture();
    expect((await remove(['a'])).results).toEqual([{ id: 'a', status: 'deleted' }]);
    expect(data.has(contact)).toBe(false);
    expect(data.has(contact + '/private/photo')).toBe(false);
    expect(data.has(contact + '/timeline/event')).toBe(false);
    expect(data.has(queue)).toBe(false);
    expect([...data.keys()]).toEqual([
      'users/owner', 'users/owner/companies/company', 'users/owner/stickers/s', 'users/owner/contacts/b',
      'users/other/contacts/a', 'contact_hub_gmail_limits/owner/attempts/key',
    ]);
    expect((await remove(['a'])).results[0].status).toBe('already_deleted');
  });

  it('rejects another viewer, custom auth, active impersonation and invalid selection', async () => {
    const { remove, data } = fixture();
    expect((await remove(['a'], 'other')).status).toBe(403);
    expect((await remove(['a'], 'custom')).status).toBe(403);
    expect((await remove(['a', 'a'])).status).toBe(400);
    expect((await remove(['a/b'])).status).toBe(400);
    data.set('impersonationSessions/session', { adminUserId: 'owner', status: 'active' });
    expect((await remove(['a'])).results[0].status).toBe('read_only');
    expect(data.has(contact)).toBe(true);
  });

  it('reports per-contact failure and lets the failed item be retried', async () => {
    const { remove, data, db } = fixture();
    db.runTransaction.mockRejectedValueOnce(new Error('contention'));
    expect((await remove(['a', 'b'])).results).toEqual([{ id: 'a', status: 'retry' }, { id: 'b', status: 'deleted' }]);
    expect(data.has(contact)).toBe(true);
    expect((await remove(['a'])).results[0].status).toBe('deleted');
  });

  it('leaves a contact with oversized history intact', async () => {
    const { remove, data } = fixture();
    for (let index = 0; index < 400; index += 1) data.set(contact + '/timeline/' + index, {});
    expect((await remove(['a'])).results[0].status).toBe('too_many_related_records');
    expect(data.has(contact + '/private/photo')).toBe(true);
    expect(data.has(contact)).toBe(true);
  });
});
