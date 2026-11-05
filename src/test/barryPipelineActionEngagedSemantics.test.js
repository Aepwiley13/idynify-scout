/**
 * barryPipelineAction's two write paths into Engaged — engage_contact
 * (creating a mission) and move_stage (moving into Hunter) — both used to
 * set contact_status: 'Engaged' on intent alone: a mission whose own first
 * step is still unsent, or a bare stage move. Neither is a confirmed
 * interaction.
 *
 * Reuses the exact Firestore-fake harness gate2PipelineAmbiguity.test.js
 * already proved for this handler (TABLE/WRITES), so a failure here is
 * about Engaged semantics specifically, not about the harness.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let TABLE = [];
let WRITES = [];

function contactsQuery(filters = [], cap = null) {
  const snapOf = (rows) => ({
    empty: rows.length === 0,
    docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })),
  });
  return {
    where: (field, _op, value) => contactsQuery([...filters, { field, value }], cap),
    limit: (n) => contactsQuery(filters, n),
    doc: (id) => ({
      id,
      collection: () => contactsQuery(),
      async get() {
        const row = TABLE.find(r => r.id === id);
        return { exists: Boolean(row), id, data: () => ({ ...row }) };
      },
      async update(data) {
        WRITES.push({ id, data });
        const row = TABLE.find(r => r.id === id);
        if (row) Object.assign(row, data);
      },
      async set(data) { WRITES.push({ id, data }); },
    }),
    async get() {
      if (filters.length > 0) {
        const f = filters[0];
        return snapOf(TABLE.filter(r => r[f.field] === f.value).slice(0, cap ?? 5));
      }
      return snapOf(TABLE.slice(0, cap ?? TABLE.length));
    },
    async add(data) { WRITES.push({ id: 'new', data }); return { id: 'new' }; },
  };
}

const userDoc = {
  collection: () => contactsQuery(),
  async update(data) { WRITES.push({ id: 'user', data }); },
};

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: () => ({ doc: () => userDoc }) },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

globalThis.fetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ users: [{ localId: 'u1' }] }),
}));

const { handler } = await import('../../netlify/functions/barryPipelineAction.js');

async function act(contactId, action_type, params = {}) {
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', action_type, contactId, params }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

function writeFor(contactId) {
  // The write(s) targeting this specific contact doc, merged in order —
  // engage_contact/move_stage each issue exactly one `update` to it.
  return WRITES.filter((w) => w.id === contactId).reduce((acc, w) => ({ ...acc, ...w.data }), {});
}

beforeEach(() => {
  TABLE = [];
  WRITES = [];
  vi.stubEnv('FIREBASE_API_KEY', 'test-key');
});

describe('engage_contact: creating a mission is planning outreach, not a confirmed interaction', () => {
  it('moves the contact into Hunter and creates a mission, but never writes contact_status', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', stage: 'scout', status: 'active' }];
    const r = await act('c1', 'engage_contact');
    expect(r.status).toBe(200);

    const write = writeFor('c1');
    expect(write.stage).toBe('hunter');
    expect(write.hunter_status).toBe('active_mission');
    expect(write.contact_status).toBeUndefined();
    expect(write.contact_status_updated_at).toBeUndefined();
    expect(r.body.updated_fields.contact_status).toBeUndefined();

    // A mission really was created.
    expect(WRITES.some((w) => w.id === 'new')).toBe(true);
  });

  it('record_status promotion still fires — this dimension is deliberately unaffected by the contact_status change', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', stage: 'scout', status: 'suggested', record_status: 'suggested' }];
    await act('c1', 'engage_contact');
    const write = writeFor('c1');
    expect(write.record_status).toBe('active');
  });

  it('a contact already at a real status (e.g. already replied) is untouched by this — engage_contact never claims a status it has no basis for', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', stage: 'scout', contact_status: 'In Conversation' }];
    await act('c1', 'engage_contact');
    const write = writeFor('c1');
    expect(write.contact_status).toBeUndefined(); // never touched, in either direction
  });
});

describe('move_stage: arriving in Hunter is workflow intent, not a confirmed interaction', () => {
  it('moving to hunter changes stage but never writes contact_status', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', stage: 'scout' }];
    const r = await act('c1', 'move_stage', { to_stage: 'hunter' });
    expect(r.status).toBe(200);
    const write = writeFor('c1');
    expect(write.stage).toBe('hunter');
    expect(write.contact_status).toBeUndefined();
    expect(r.body.updated_fields.contact_status).toBeUndefined();
  });

  it('moving to sniper/basecamp/fallback still coerces contact_status — unaffected, regression-tested', async () => {
    TABLE = [
      { id: 'c1', name: 'A', stage: 'hunter' },
      { id: 'c2', name: 'B', stage: 'hunter' },
      { id: 'c3', name: 'C', stage: 'hunter' },
    ];
    await act('c1', 'move_stage', { to_stage: 'sniper' });
    await act('c2', 'move_stage', { to_stage: 'basecamp' });
    await act('c3', 'move_stage', { to_stage: 'fallback' });
    expect(writeFor('c1').contact_status).toBe('In Conversation');
    expect(writeFor('c2').contact_status).toBe('Active Customer');
    expect(writeFor('c3').contact_status).toBe('Dormant');
  });

  it('moving back to scout still forces no status change', async () => {
    TABLE = [{ id: 'c1', name: 'A', stage: 'hunter', contact_status: 'Engaged' }];
    await act('c1', 'move_stage', { to_stage: 'scout' });
    expect(writeFor('c1').contact_status).toBeUndefined();
  });
});
