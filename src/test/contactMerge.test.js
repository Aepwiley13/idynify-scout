import { describe, expect, it } from 'vitest';
import { createContactMerge } from '../../netlify/functions/utils/contactMerge.js';

function fixture(options = {}) {
  let clock = 2_000_000;
  let revision = 0;
  const records = new Map();
  const put = (path, value, v = ++revision) => records.set(path, { value, v });
  const a = 'users/owner/contacts/a';
  const b = 'users/owner/contacts/b';
  put('users/owner', {});
  put(a, { name: 'Jordan Lee', title: 'Director', email: 'jordan@example.test', notes: [{ id: 'one' }] });
  put(b, { name: 'Jordan Lee', title: 'Coordinator', email: 'jordan@example.test', notes: [{ id: 'two' }] });
  put(b + '/timeline/event', { type: 'message_sent' });
  const doc = (path) => ({
    path, id: path.split('/').at(-1), collection: (name) => query(path + '/' + name),
  });
  const query = (path, filters = [], max = Infinity) => ({
    path, filters, max, isQuery: true,
    doc: (id) => doc(path + '/' + id),
    where: (...rule) => query(path, [...filters, rule], max),
    limit: (limit) => query(path, filters, limit),
    orderBy: () => query(path, filters, max),
  });
  const snapshot = (ref) => {
    const entry = records.get(ref.path);
    return { ref, id: ref.id, exists: !!entry, data: () => entry?.value,
      updateTime: entry ? { toDate: () => new Date(entry.v), nanoseconds: entry.v } : null };
  };
  const db = {
    doc, collection: query,
    async runTransaction(work) {
      const mutations = [];
      const result = await work({
        get: async (ref) => {
          if (!ref.isQuery) return snapshot(ref);
          const docs = [...records].filter(([path, { value }]) => path.slice(0, path.lastIndexOf('/')) === ref.path
            && ref.filters.every(([key, op, rule]) => op === 'in' ? rule.includes(value[key]) : value[key] === rule))
            .slice(0, ref.max).map(([path]) => snapshot(doc(path)));
          return { docs, empty: !docs.length };
        },
        set: (ref, data) => mutations.push(() => put(ref.path, data, revision)),
        delete: (ref) => mutations.push(() => records.delete(ref.path)),
        update: (ref, data) => mutations.push(() => put(ref.path, { ...records.get(ref.path).value, ...data }, revision)),
      });
      if (mutations.length) { revision++; mutations.forEach((mutation) => mutation()); }
      return result;
    },
  };
  const handler = createContactMerge({
    db, secret: () => 'a'.repeat(32), enabled: () => true,
    executionEnabled: () => options.execution !== false, timestamp: () => clock, now: () => clock,
    verifyToken: async (token) => token === 'custom' ? { uid: 'owner', firebase: { sign_in_provider: 'custom' } } : { uid: token },
  });
  const operationId = 'ff379c19-3d0e-4416-aa6e-281a820d9000';
  const request = async (action, extra = {}, bearer = 'owner') => {
    const result = await handler({
      httpMethod: 'POST', headers: { authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ uid: 'owner', survivorId: 'a', sourceId: 'b', choices: { title: 1 }, operationId, action, ...extra }),
    });
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  return { a, b, records, put, request, tick: (ms) => { clock += ms; } };
}

describe('trusted Contact Hub merge', () => {
  it('previews with no mutations, commits and redirects, retries, then conditionally rolls back', async () => {
    const { a, b, request, records } = fixture();
    const before = records.size;
    expect((await request('preview', { choices: {} })).token).toBeNull();
    const verified = await request('preview');
    expect(verified).toMatchObject({ status: 200, blockers: [], activityCount: 1, combined: { notes: 2 } });
    expect(records.size).toBe(before);
    const merged = await request('commit', { token: verified.token });
    expect(merged.receipt).toMatchObject({ status: 'merged', survivorId: 'a', sourceId: 'b' });
    expect(records.get(a).value.title).toBe('Coordinator');
    expect(records.get(a + '/timeline/event').value.contact_hub_merge_origin.contact_id).toBe('b');
    expect(records.get(b).value.contact_hub_lifecycle.status).toBe('retired');
    expect((await request('redirect')).survivorId).toBe('a');
    expect(await request('commit', { token: verified.token })).toEqual(merged);
    expect((await request('commit', { choices: { title: 0 }, token: verified.token })).error).toBe('operation_conflict');
    const rollback = await request('preview_rollback');
    expect((await request('rollback', { token: rollback.token })).receipt.status).toBe('rolled_back');
    expect(records.get(a).value.title).toBe('Director');
    expect(records.has(a + '/timeline/event')).toBe(false);
    expect(records.get(b).value.contact_hub_lifecycle).toBeUndefined();
  });

  it('rejects expired and stale previews and denies wrong-account and read-only requests', async () => {
    const { a, request, put, records, tick } = fixture();
    const { token } = await request('preview');
    tick(600_000);
    expect((await request('commit', { token })).error).toBe('preview_changed');
    const next = await request('preview');
    put(a, { ...records.get(a).value, city: 'Ogden' });
    expect((await request('commit', { token: next.token })).error).toBe('preview_changed');
    expect((await request('preview', {}, 'other')).status).toBe(403);
    expect((await request('preview', {}, 'custom')).status).toBe(403);
    put('impersonationSessions/session', { adminUserId: 'owner', status: 'active' });
    expect((await request('preview')).status).toBe(403);
  });

  it('blocks conflicts, opt-outs, private photos, reminders and un-attributed provider operations', async () => {
    const { a, b, request, put, records } = fixture();
    put(a, { ...records.get(a).value, apollo_person_id: 'one', email_opt_out: true });
    put(b, { ...records.get(b).value, apollo_person_id: 'two', next_best_step: { action: 'Call' } });
    put(b + '/private/photo', { kind: 'hidden' });
    put('contact_hub_gmail_limits/owner/attempts/unknown', { status: 'unknown' });
    const plan = await request('preview');
    expect(plan.token).toBeNull();
    expect(plan.blockers).toEqual(expect.arrayContaining(['conflicting_identity', 'email_permission_requires_review',
      'private_photo_requires_transfer', 'reminder_requires_transfer', 'unresolved_gmail_attempt']));
  });

  it('blocks rollback after intervening writes even when values are unchanged, and when the window expires', async () => {
    const { a, request, put, records, tick } = fixture();
    const { token } = await request('preview');
    await request('commit', { token });
    const rollback = await request('preview_rollback');
    put(a, records.get(a).value);
    expect((await request('rollback', { token: rollback.token })).error).toBe('rollback_changed');
    tick(7 * 86400000);
    expect((await request('preview_rollback')).error).toBe('rollback_expired');
  });

  it('keeps execution off and restores owner-scoped dismissals after relevant identity changes', async () => {
    const { a, request, put, records } = fixture({ execution: false });
    const { token } = await request('preview');
    expect((await request('commit', { token })).error).toBe('execution_disabled');
    await request('dismiss');
    expect((await request('dismissals')).pairs).toEqual([['a', 'b']]);
    put(a, { ...records.get(a).value, notes: [] });
    expect((await request('dismissals')).pairs).toEqual([['a', 'b']]);
    put(a, { ...records.get(a).value, email: 'changed@example.test' });
    expect((await request('dismissals')).pairs).toEqual([]);
    await request('dismiss');
    await request('restore');
    expect((await request('dismissals')).pairs).toEqual([]);
  });
});
