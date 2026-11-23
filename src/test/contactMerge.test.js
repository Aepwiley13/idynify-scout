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
  put(a, { name: 'Jordan Lee', title: 'Director', email: 'jordan@example.test', notes: [{ id: 'one' }], ...(options.left ?? {}) });
  put(b, { name: 'Jordan Lee', title: 'Coordinator', email: 'jordan@example.test', notes: [{ id: 'two' }], ...(options.right ?? {}) });
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
      body: JSON.stringify({ uid: 'owner', survivorId: 'a', sourceId: 'b', choices: {}, operationId, action, ...extra }),
    });
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  return { a, b, records, put, request, tick: (ms) => { clock += ms; } };
}

describe('trusted Contact Hub merge', () => {
  it('previews with no mutations, commits and redirects, retries, then conditionally rolls back', async () => {
    const { a, b, request, records } = fixture();
    const before = records.size;
    expect((await request('preview', { choices: {} })).token).toBeTruthy();
    const verified = await request('preview');
    expect(verified).toMatchObject({ status: 200, blockers: [], activityCount: 1,
      combined: { notes: expect.arrayContaining([expect.objectContaining({ id: 'one' }), expect.objectContaining({ id: 'two' })]) } });
    expect(records.size).toBe(before);
    const merged = await request('commit', { token: verified.token });
    expect(merged.receipt).toMatchObject({ status: 'merged', survivorId: 'a', sourceId: 'b' });
    expect(records.get(a).value.title).toBe('Director');
    expect(records.get(a).value.contact_affiliations.map((item) => [item.title, item.organization_name])).toEqual([
      ['Director', null], ['Coordinator', null],
    ]);
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

  it('previews, commits and conditionally restores additive relationship facts and two affiliations', async () => {
    const left = {
      emails: [{ id: 'work', value: 'casey@tmobile.test', label: 'work', labelSource: 'card' }],
      email: 'casey@tmobile.test',
      phones: [{ id: 'mobile', value: '801-555-0101', label: 'mobile', labelSource: 'user' }],
      phone: '801-555-0101', sticker_ids: ['S01', 'S02'],
      sticker_assignments: { S01: { assigned_by: 'user', assigned_at: 'now-1' }, S02: { assigned_by: 'user', assigned_at: 'now-2' } },
      contact_affiliations: [{ id: 'director', organization_name: 'T-Mobile', company_id: 'company-tmo', title: 'Director', type: 'Employment', status: 'current', primary: true, provenance: [{ source: 'business_card', contact_id: 'a' }] }],
      identity_sources: ['business_card'], source: 'business_card', notes: [{ id: 'n-left', content: 'Met at conference' }],
      linkedin_url: 'https://www.linkedin.com/in/casey-example',
    };
    const right = {
      emails: [{ id: 'personal', value: 'casey.personal@example.test', label: 'personal', labelSource: 'user' }],
      email: 'casey.personal@example.test',
      phones: [{ id: 'home', value: '801-555-0102', label: 'home', labelSource: 'user', observedLabel: 'Personal' }],
      phone: '801-555-0102', sticker_ids: ['S03', 'S04'],
      sticker_assignments: { S03: { assigned_by: 'csv_import', assigned_at: 'now-3' }, S04: { assigned_by: 'user', assigned_at: 'now-4' } },
      contact_affiliations: [{ id: 'coach', organization_name: 'Salt Lake Youth League', company_id: null, title: 'Basketball Coach', type: 'Volunteer', status: 'current', primary: false, provenance: [{ source: 'community_import', contact_id: 'b' }] }],
      identity_sources: ['community_import'], source: 'community_import', notes: [{ id: 'n-right', content: 'Coaches on Saturdays' }],
      linkedin_url: 'https://www.linkedin.com/in/casey-example',
    };
    const { a, b, request, records } = fixture({ left, right });
    records.set('users/owner/contacts/a/timeline/call', { value: { type: 'outreach_logged', preview: 'Conference call' }, v: 10 });
    records.set('users/owner/contacts/b/timeline/meeting', { value: { type: 'outreach_logged', preview: 'League meeting' }, v: 11 });
    const preview = await request('preview');
    expect(preview.combined).toMatchObject({
      emails: expect.arrayContaining([
        expect.objectContaining({ value: 'casey@tmobile.test', label: 'work' }),
        expect.objectContaining({ value: 'casey.personal@example.test', label: 'personal' }),
      ]),
      phones: expect.arrayContaining([expect.objectContaining({ value: '801-555-0101', label: 'mobile' }), expect.objectContaining({ value: '801-555-0102', label: 'home' })]),
      stickers: expect.arrayContaining([{ id: 'S01', assignment: left.sticker_assignments.S01 }, { id: 'S02', assignment: left.sticker_assignments.S02 }, { id: 'S03', assignment: right.sticker_assignments.S03 }, { id: 'S04', assignment: right.sticker_assignments.S04 }]),
      affiliations: expect.arrayContaining([expect.objectContaining({ id: 'director', title: 'Director', organization_name: 'T-Mobile', primary: true }), expect.objectContaining({ id: 'coach', title: 'Basketball Coach', organization_name: 'Salt Lake Youth League' })]),
      notes: expect.arrayContaining([expect.objectContaining({ id: 'n-left' }), expect.objectContaining({ id: 'n-right' })]),
      sourceHistory: expect.arrayContaining([expect.objectContaining({ contact_id: 'a', source: 'business_card' }), expect.objectContaining({ contact_id: 'b', source: 'community_import' })]),
    });
    const tokenized = await request('preview', { choices: { primary_email: 1, primary_phone: 1 } });
    expect(tokenized.token).toBeTruthy();
    await request('commit', { choices: { primary_email: 1, primary_phone: 1 }, token: tokenized.token });
    const stored = records.get(a).value;
    expect(stored.emails.map((item) => item.value)).toEqual(['casey.personal@example.test', 'casey@tmobile.test']);
    expect(stored.email).toBe('casey.personal@example.test');
    expect(stored.phones).toHaveLength(2);
    expect(stored.phone).toBe('801-555-0102');
    expect(stored.sticker_ids).toEqual(['S01', 'S02', 'S03', 'S04']);
    expect(Object.keys(stored.sticker_assignments)).toHaveLength(4);
    expect(stored.contact_affiliations.map(({ title, organization_name }) => [title, organization_name])).toEqual([
      ['Director', 'T-Mobile'], ['Basketball Coach', 'Salt Lake Youth League'],
    ]);
    expect([stored.title, stored.company_name, stored.company_id]).toEqual(['Director', 'T-Mobile', 'company-tmo']);
    expect(stored.identity_sources).toEqual(expect.arrayContaining(['business_card', 'community_import']));
    expect(stored.contact_hub_merge_origin.source_provenance).toHaveLength(2);
    expect(records.has(a + '/timeline/meeting')).toBe(true);
    const rollback = await request('preview_rollback');
    expect((await request('rollback', { token: rollback.token })).receipt.status).toBe('rolled_back');
    expect(records.get(a).value.contact_affiliations).toEqual(left.contact_affiliations);
    expect(records.get(b).value.contact_affiliations).toEqual(right.contact_affiliations);
    expect(records.has(a + '/timeline/meeting')).toBe(false);
    expect(records.has(b + '/timeline/meeting')).toBe(true);
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

  it('allows an owner-confirmed incomplete identity only when the signed preview and operation id agree', async () => {
    const { a, b, request, put, records } = fixture({ left: { email: 'first@example.test', company_name: 'First Org' }, right: { email: 'second@example.test', company_name: 'Second Org' } });
    put(a, { ...records.get(a).value, email: 'first@example.test', company_name: 'First Org' });
    put(b, { ...records.get(b).value, email: 'second@example.test', company_name: 'Second Org' });
    const blocked = await request('preview');
    expect(blocked.blockers).toContain('identity_not_verified');
    expect(blocked.token).toBeNull();
    const choices = { primary_email: 0 };
    const attested = await request('preview', { identityConfirmed: true, choices });
    expect(attested.blockers).not.toContain('identity_not_verified');
    expect(attested.token).toBeTruthy();
    expect((await request('commit', { identityConfirmed: true, choices, operationId: '11111111-1111-4111-8111-111111111111', token: attested.token })).error).toBe('preview_changed');
    const bound = await request('preview', { identityConfirmed: true, choices, operationId: 'ff379c19-3d0e-4416-aa6e-281a820d9000' });
    expect((await request('commit', { identityConfirmed: true, choices, token: bound.token })).receipt.status).toBe('merged');
    const operation = records.get('contact_hub_merges/owner/operations/ff379c19-3d0e-4416-aa6e-281a820d9000').value;
    expect(operation.identityConfirmation).toMatchObject({ actorUid: 'owner', contactIds: ['a', 'b'] });
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

  it('refuses rollback after new canceled outreach or a recorded send and retains the resulting history', async () => {
    const { request, put, records } = fixture();
    const { token } = await request('preview');
    await request('commit', { token });
    const rollback = await request('preview_rollback');
    const outreach = 'users/owner/scheduledEngagements/canceled';
    put(outreach, { status: 'canceled', contactId: 'a' });
    expect((await request('rollback', { token: rollback.token })).error).toBe('rollback_changed');
    expect(records.get(outreach).value.status).toBe('canceled');
    records.delete(outreach);
    const send = 'contact_hub_gmail_limits/owner/attempts/sent-post-merge';
    put(send, { contactId: 'a', status: 'sent', createdAt: { toMillis: () => 2_000_001 } });
    expect((await request('rollback', { token: rollback.token })).error).toBe('rollback_changed');
    expect(records.get(send).value).toMatchObject({ status: 'sent', contactId: 'a' });
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
