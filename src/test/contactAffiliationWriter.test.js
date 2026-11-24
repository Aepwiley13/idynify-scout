import { describe, expect, it, vi } from 'vitest';
import { createContactAffiliationWriter } from '../../netlify/functions/utils/contactAffiliationWriter.js';

function harness({ owner = true, impersonated = false } = {}) {
  const rows = new Map();
  let revision = 1;
  const put = (path, value) => rows.set(path, { value, version: revision++ });
  put('users/owner', {});
  put('users/owner/contacts/person', { title: 'Director', company_name: 'T-Mobile', company_id: 'tmobile' });
  if (impersonated) put('impersonationSessions/session', { adminUserId: 'owner', status: 'active', expiresAt: { toMillis: () => Date.now() + 60_000 } });
  if (!owner) rows.delete('users/owner');
  const doc = (path) => ({ path, id: path.split('/').at(-1), collection: (name) => query(`${path}/${name}`) });
  const query = (path, filters = []) => ({ path, filters, isQuery: true,
    where: (...filter) => query(path, [...filters, filter]), doc: (id) => doc(`${path}/${id}`) });
  const snap = (ref) => {
    const row = rows.get(ref.path);
    const v = row?.version;
    return { ref, id: ref.id, exists: Boolean(row), data: () => row?.value,
      updateTime: v == null ? null : { seconds: v, nanoseconds: 0 } };
  };
  const db = { doc, collection: query, async runTransaction(work) {
    const writes = [];
    const result = await work({ get: async (ref) => {
      if (!ref.isQuery) return snap(ref);
      const docs = [...rows.keys()].filter((path) => path.startsWith(ref.path + '/') && !path.slice(ref.path.length + 1).includes('/')
        && ref.filters.every(([key, , value]) => rows.get(path).value[key] === value)).map((path) => snap(doc(path)));
      return { docs, empty: !docs.length };
    }, update: (ref, patch) => writes.push([ref.path, patch]) });
    for (const [path, patch] of writes) put(path, { ...rows.get(path).value, ...patch });
    return result;
  } };
  const handler = createContactAffiliationWriter({ db, enabled: () => true, timestamp: () => 'now',
    verifyToken: async (token) => token === 'custom'
      ? { uid: 'owner', firebase: { sign_in_provider: 'custom' } } : { uid: token } });
  const request = (affiliations, version = '2:0', bearer = 'owner') => handler({ httpMethod: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ uid: 'owner', contactId: 'person', expectedVersion: version, affiliations }) });
  return { request, rows };
}

const affiliation = { id: 'role-1', organization_name: 'T-Mobile', company_id: 'tmobile', title: 'Director', type: null,
  status: 'current', primary: true, provenance: [] };

describe('trusted affiliation writes', () => {
  it('keeps token failures generic to callers and logs only a safe SDK error code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createContactAffiliationWriter({ db: {}, enabled: () => true,
      timestamp: () => 'now', verifyToken: async () => { throw Object.assign(new Error('secret token and private details'), { code: 'auth/id-token-revoked' }); } });
    const response = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer token-not-logged' }, body: '{}' });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'sign_in' });
    expect(warn).toHaveBeenCalledWith('contactHubAffiliations', { outcome: 'token_verification_failed', errorCode: 'auth/id-token-revoked' });
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/secret token|private details|token-not-logged/);
    warn.mockRestore();
  });

  it('derives legacy affiliation provenance and atomically projects all primary fields', async () => {
    const { request, rows } = harness();
    const result = await request([affiliation]);
    expect(result.statusCode).toBe(200);
    const saved = rows.get('users/owner/contacts/person').value;
    expect(saved.contact_affiliations[0].provenance).toEqual([{ source: 'user', contact_id: 'person' }]);
    expect(saved).toMatchObject({ title: 'Director', company_name: 'T-Mobile', company_id: 'tmobile' });
  });

  it('rejects account mismatch, custom/read-only sessions, stale versions, missing owners and malformed data', async () => {
    const account = harness();
    expect((await account.request([affiliation], '2:0', 'other')).statusCode).toBe(403);
    expect((await account.request([affiliation], '2:0', 'custom')).statusCode).toBe(403);
    expect((await account.request([affiliation], '99:0')).statusCode).toBe(409);
    expect((await account.request([{ ...affiliation, company_id: 'bad/path' }])).statusCode).toBe(400);
    const readOnly = harness({ impersonated: true });
    expect((await readOnly.request([affiliation])).statusCode).toBe(403);
    const noOwner = harness({ owner: false });
    expect((await noOwner.request([affiliation])).statusCode).toBe(403);
  });
});
