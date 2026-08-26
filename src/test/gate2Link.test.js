/**
 * GATE 2 PHASE 4 — LINK, and the end-to-end sentence.
 *
 * THE HEADLINE ACCEPTANCE:
 *
 *     "Put these 20 into Scout"
 *       → RESOLVE_SAVE → 20 canonical contactIds
 *       → LINK(ids, 'scout')
 *       → 20 contacts at stage 'scout', 20 stage_moved events,
 *         zero new Person records, zero Scout records,
 *         zero sniper_contacts records, and repeating it changes nothing.
 *
 * The last clause is the one worth testing hardest. `users/{uid}/sniper_contacts`
 * is a live parallel person collection in this repo — the exact anti-pattern
 * this gate exists to avoid — so "does not create another representation of the
 * human" is asserted against it directly, including when the target stage IS
 * sniper.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let TABLE = [];
let TIMELINE = [];
let OTHER_COLLECTIONS = {};   // anything written outside `contacts`
let WRITES = [];

function makeCollection(name, filters = [], cap = null) {
  const rows = () => (name === 'contacts' ? TABLE : (OTHER_COLLECTIONS[name] ??= []));
  const selected = () => {
    let out = rows();
    // A no-op `where` made every query return the whole collection, so the
    // resolver saw ten records behind one email and correctly refused. The fake
    // has to filter for the test to be about LINK rather than about the fake.
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
      if (name === 'timeline') TIMELINE.push(data);
      else (OTHER_COLLECTIONS[name] ??= []).push(data);
      return { id: `new_${Math.random().toString(36).slice(2, 8)}` };
    },
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: (n) => makeCollection(n === 'users' ? 'users' : n) },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: async () => ({ tokenUserId: 'u1' }),
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

const { handler: link } = await import('../../netlify/functions/barryLink.js');
const { handler: resolveSave } = await import('../../netlify/functions/barryResolveSave.js');

const base = { userId: 'u1', authToken: 't', actor: 'barry' };

async function callLink(body) {
  const res = await link({ httpMethod: 'POST', body: JSON.stringify({ ...base, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function callResolve(body) {
  const res = await resolveSave({ httpMethod: 'POST', body: JSON.stringify({ ...base, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => { TABLE = []; TIMELINE = []; OTHER_COLLECTIONS = {}; WRITES = []; });

// ── 1. The headline sentence ────────────────────────────────────────────────

describe('1 — "Put these 20 into Scout", end to end', () => {
  it('resolves 20 people then places them, creating no second representation', async () => {
    // Ten already canonical (Scout's own People Mode made them), ten new.
    TABLE = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`, name: `Known ${i}`, email_normalized: `known${i}@acme.com`, stage: 'hunter',
    }));

    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: 'person', clientRef: `ui_k${i}`, source: 'first_experience.person_search',
        email: `Known${i}@Acme.com`,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: 'person', clientRef: `ui_n${i}`, source: 'first_experience.person_search',
        email: `new${i}@acme.com`, name: `New ${i}`, company_name: 'Acme',
      })),
    ];

    const resolved = await callResolve({ operationId: 'op_1', commit: true, candidates });
    expect(resolved.body.summary).toMatchObject({ total: 20, matched: 10, created: 10, refused: 0 });

    const ids = resolved.body.results.map(r => r.contactId);
    expect(ids.filter(Boolean)).toHaveLength(20);
    expect(TABLE).toHaveLength(20);            // 10 existing + 10 created, no more

    TIMELINE = [];
    const linked = await callLink({ operationId: 'op_1', contactIds: ids, targetStage: 'scout' });

    // Ten were at 'hunter' and move; ten were CREATED at stage 'scout' by
    // RESOLVE_SAVE and are already where they need to be. LINK reports that
    // honestly rather than writing twenty times — and emits an event only for a
    // real change, so the timeline never records a move that did not happen.
    expect(linked.body.summary).toMatchObject({ total: 20, moved: 10, alreadyThere: 10, notFound: 0 });
    expect(TIMELINE).toHaveLength(10);
    expect(TIMELINE.every(e => e.type === 'stage_moved')).toBe(true);

    // What the sentence actually promised: all twenty are in Scout.
    expect(TABLE.filter(c => c.stage === 'scout')).toHaveLength(20);

    // The anti-pattern guard: one human, one record.
    expect(TABLE).toHaveLength(20);
    expect(OTHER_COLLECTIONS.sniper_contacts ?? []).toHaveLength(0);
    expect(Object.keys(OTHER_COLLECTIONS).filter(k => k !== 'timeline')).toEqual([]);
  });

  it('repeating the whole operation changes nothing', async () => {
    TABLE = [{ id: 'c1', email_normalized: 'a@x.com', stage: 'hunter' }];
    const candidates = [{ kind: 'person', clientRef: 'ui_1', source: 's', email: 'a@x.com' }];

    const first = await callResolve({ operationId: 'op_1', commit: true, candidates });
    const ids = first.body.results.map(r => r.contactId);
    await callLink({ operationId: 'op_1', contactIds: ids, targetStage: 'scout' });

    const before = JSON.stringify(TABLE);
    TIMELINE = []; WRITES = [];

    await callResolve({ operationId: 'op_1', commit: true, candidates });
    const again = await callLink({ operationId: 'op_1', contactIds: ids, targetStage: 'scout' });

    expect(again.body.summary).toMatchObject({ moved: 0, alreadyThere: 1 });
    expect(TIMELINE).toHaveLength(0);
    expect(TABLE).toHaveLength(1);
    expect(JSON.stringify(TABLE)).toBe(before);
  });
});

// ── 2. LINK creates nothing, ever ───────────────────────────────────────────

describe('2 — LINK mutates placement and nothing else', () => {
  it('writes stage on an existing contact and logs one event', async () => {
    TABLE = [{ id: 'c1', name: 'Dana', stage: 'scout' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'hunter' });

    expect(r.body.results[0]).toMatchObject({ contactId: 'c1', from: 'scout', to: 'hunter', changed: true });
    expect(TABLE[0].stage).toBe('hunter');
    expect(TIMELINE).toHaveLength(1);
    expect(TIMELINE[0]).toMatchObject({ type: 'stage_moved', actor: 'barry' });
  });

  it('creates NO sniper_contacts record even when the target stage is sniper', async () => {
    // The cautionary case this gate exists to avoid, asserted directly.
    TABLE = [{ id: 'c1', name: 'Dana', stage: 'hunter' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'sniper' });

    expect(TABLE).toHaveLength(1);
    expect(TABLE[0].stage).toBe('sniper');
    expect(OTHER_COLLECTIONS.sniper_contacts ?? []).toHaveLength(0);
  });

  it('never creates a contact for an id that is not there', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c_ghost'], targetStage: 'hunter' });

    expect(r.body.results[0]).toMatchObject({ contactId: 'c_ghost', changed: false, reason: 'not_found' });
    expect(r.body.summary.notFound).toBe(1);
    expect(TABLE).toHaveLength(1);
    expect(WRITES).toHaveLength(0);
  });

  it('coerces contact_status on arrival, matching barryPipelineAction', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'sniper' });
    expect(TABLE[0].contact_status).toBe('In Conversation');
  });

  it('forces no status change when moving back to Scout', async () => {
    TABLE = [{ id: 'c1', stage: 'hunter', contact_status: 'Engaged' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'scout' });
    expect(TABLE[0].contact_status).toBe('Engaged');
  });

  it('stamps provenance without inventing a new field', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    await callLink({ operationId: 'op_xyz', contactIds: ['c1'], targetStage: 'hunter' });
    expect(TABLE[0]).toMatchObject({
      identity_operation_id: 'op_xyz', identity_actor: 'barry', stage_source: 'barry_link',
    });
    expect(TABLE[0].identity_client_ref).toBeUndefined();
  });
});

// ── 3. Idempotency ──────────────────────────────────────────────────────────

describe('3 — idempotent, and its own inverse', () => {
  it('a contact already at the target is a no-op with no event', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'scout' });

    expect(r.body.results[0].changed).toBe(false);
    expect(WRITES).toHaveLength(0);
    expect(TIMELINE).toHaveLength(0);
  });

  it('the same id named twice is one move, not two events', async () => {
    TABLE = [{ id: 'c1', stage: 'hunter' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c1', 'c1'], targetStage: 'scout' });

    expect(r.body.summary.moved).toBe(1);
    expect(TIMELINE).toHaveLength(1);
  });

  it('LINK back undoes a LINK, and both moves are honestly recorded', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'hunter' });
    await callLink({ operationId: 'op2', contactIds: ['c1'], targetStage: 'scout' });

    expect(TABLE[0].stage).toBe('scout');
    expect(TIMELINE).toHaveLength(2);
    expect(TIMELINE.map(e => e.metadata.to)).toEqual(['hunter', 'scout']);
  });
});

// ── 4. Guards ───────────────────────────────────────────────────────────────

describe('4 — the request is bounded and validated', () => {
  it('rejects an unknown stage rather than writing it', async () => {
    TABLE = [{ id: 'c1', stage: 'scout' }];
    const r = await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: 'archive' });
    expect(r.status).toBe(400);
    expect(WRITES).toHaveLength(0);
  });

  it('accepts every real stage', async () => {
    for (const stage of ['scout', 'hunter', 'sniper', 'basecamp', 'reinforcements', 'fallback']) {
      TABLE = [{ id: 'c1', stage: 'scout' }];
      const r = await callLink({ operationId: 'op1', contactIds: ['c1'], targetStage: stage });
      expect(r.status, stage).toBe(200);
    }
  });

  it('requires an operationId', async () => {
    const r = await callLink({ contactIds: ['c1'], targetStage: 'scout' });
    expect(r.status).toBe(400);
  });

  it('caps the batch', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const r = await callLink({ operationId: 'op1', contactIds: ids, targetStage: 'scout' });
    expect(r.status).toBe(400);
    expect(WRITES).toHaveLength(0);
  });

  it('rejects a non-string id rather than coercing it', async () => {
    const r = await callLink({ operationId: 'op1', contactIds: [null], targetStage: 'scout' });
    expect(r.status).toBe(400);
  });
});
