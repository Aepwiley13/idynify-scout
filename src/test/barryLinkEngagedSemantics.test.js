/**
 * barryLink's STAGE_STATUS_MAP mirrors barryPipelineAction.moveStage — see
 * that file's own test for the full rationale. This covers the same
 * correction from barryLink.js's side: arriving in Hunter via a Gate-2
 * link/resolve-save action is workflow intent, not a confirmed interaction,
 * so it must no longer coerce contact_status to Engaged.
 *
 * Reuses gate2Link.test.js's own Firestore-fake harness.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let TABLE = [];
let OTHER_COLLECTIONS = {};
let WRITES = [];

function makeCollection(name, filters = [], cap = null) {
  const rows = () => (name === 'contacts' ? TABLE : (OTHER_COLLECTIONS[name] ??= []));
  const selected = () => {
    let out = rows();
    for (const f of filters) out = out.filter(r => r[f.field] === f.value);
    return cap ? out.slice(0, cap) : out;
  };
  return {
    doc: (id) => {
      const docId = id ?? `auto_${Math.random().toString(36).slice(2, 8)}`;
      return {
        id: docId,
        collection: (sub) => makeCollection(sub),
        async get() {
          const row = rows().find(r => r.id === docId);
          return { exists: Boolean(row), id: docId, data: () => ({ ...row }) };
        },
        async update(data) {
          WRITES.push({ collection: name, id: docId, op: 'update', data });
          const i = rows().findIndex(r => r.id === docId);
          if (i >= 0) rows()[i] = { ...rows()[i], ...data };
        },
        async set(data) {
          WRITES.push({ collection: name, id: docId, op: 'set', data });
          rows().push({ ...data, id: docId });
        },
      };
    },
    where: (field, _op, value) => makeCollection(name, [...filters, { field, value }], cap),
    limit: (n) => makeCollection(name, filters, n),
    async get() {
      const out = selected();
      return { empty: out.length === 0, docs: out.map(r => ({ id: r.id, data: () => ({ ...r }) })) };
    },
    async add(data) {
      WRITES.push({ collection: name, op: 'add', data });
      (OTHER_COLLECTIONS[name] ??= []).push(data);
      return { id: `new_${Math.random().toString(36).slice(2, 8)}` };
    },
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: (n) => makeCollection(n) },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: async () => ({ tokenUserId: 'u1' }),
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

const { handler: link } = await import('../../netlify/functions/barryLink.js');

const base = { userId: 'u1', authToken: 't', actor: 'barry' };
async function callLink(body) {
  const res = await link({ httpMethod: 'POST', body: JSON.stringify({ ...base, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
  TABLE = [];
  OTHER_COLLECTIONS = {};
  WRITES = [];
});

describe('barryLink: arriving in Hunter is workflow intent, not a confirmed interaction', () => {
  it('moving to hunter changes stage but no longer coerces contact_status to Engaged', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'hunter' });
    expect(r.status).toBe(200);
    expect(TABLE[0].stage).toBe('hunter');
    expect(TABLE[0].contact_status).toBeUndefined();
  });

  it('moving to sniper/basecamp/fallback still coerces contact_status — unaffected, regression-tested', async () => {
    TABLE = [
      { id: 'c1', stage: 'scout' },
      { id: 'c2', stage: 'scout' },
      { id: 'c3', stage: 'scout' },
    ];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'sniper' });
    await callLink({ operationId: 'op2', contactIds: ['c2'], targetStage: 'basecamp' });
    await callLink({ operationId: 'op3', contactIds: ['c3'], targetStage: 'fallback' });
    expect(TABLE[0].contact_status).toBe('In Conversation');
    expect(TABLE[1].contact_status).toBe('Active Customer');
    expect(TABLE[2].contact_status).toBe('Dormant');
  });

  it('moving back to scout still forces no status change, even from an already-Engaged contact', async () => {
    TABLE = [{ id: 'c1', stage: 'hunter', contact_status: 'Engaged' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'scout' });
    expect(TABLE[0].contact_status).toBe('Engaged'); // untouched, not cleared either
  });

  it('a contact already at a real status moving to hunter is left alone — hunter forces nothing in either direction', async () => {
    TABLE = [{ id: 'c1', stage: 'scout', contact_status: 'In Conversation' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'hunter' });
    expect(TABLE[0].contact_status).toBe('In Conversation');
  });
});
