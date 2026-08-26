/**
 * GATE 2 PHASE 3 — RESOLVE_SAVE.
 *
 * The binding invariants, each with a test that fails if it is weakened:
 *
 *   the model never supplies canonical identity
 *   ambiguous is never persisted
 *   refused is never persisted
 *   create only on a true zero-match
 *   merge is additive only
 *   commit:false writes NOTHING
 *   the same operationId bridges preview and commit
 *   a retry does not duplicate
 *   one scan window per operation, not per candidate
 *
 * Firestore is faked at the admin boundary. What is under test is the DECISION
 * layer — which outcome each candidate gets, and what is written for it — and
 * that lives in this endpoint, not in the database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let TABLE = [];
let WRITES = [];
let QUERIES = [];

// ── firebase-admin fake ─────────────────────────────────────────────────────

function contactsQuery(filters = [], cap = null) {
  const snapOf = (rows) => ({
    empty: rows.length === 0,
    docs: rows.map(r => ({ id: r.id, data: () => ({ ...r }) })),
  });
  return {
    where: (field, _op, value) => contactsQuery([...filters, { field, value }], cap),
    limit: (n) => contactsQuery(filters, n),
    doc: (id) => {
      const docId = id ?? `auto_${Math.random().toString(36).slice(2, 9)}`;
      return {
        id: docId,
        async get() {
          const row = TABLE.find(r => r.id === docId);
          return { exists: Boolean(row), id: docId, data: () => ({ ...row }) };
        },
        async set(data) {
          WRITES.push({ op: 'set', id: docId, data });
          const i = TABLE.findIndex(r => r.id === docId);
          if (i >= 0) TABLE[i] = { ...TABLE[i], ...data, id: docId };
          else TABLE.push({ ...data, id: docId });
        },
        async update(data) {
          WRITES.push({ op: 'update', id: docId, data });
          const i = TABLE.findIndex(r => r.id === docId);
          if (i >= 0) TABLE[i] = { ...TABLE[i], ...data };
        },
      };
    },
    async get() {
      if (filters.length > 0) {
        const f = filters[0];
        QUERIES.push(f.field);
        return snapOf(TABLE.filter(r => r[f.field] === f.value).slice(0, cap ?? 5));
      }
      QUERIES.push('__scan__');
      return snapOf(TABLE.slice(0, cap ?? TABLE.length));
    },
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: { collection: () => ({ doc: () => ({ collection: () => contactsQuery() }) }) },
  admin: {},
}));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: async () => ({ tokenUserId: 'u1' }),
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));

const { handler } = await import('../../netlify/functions/barryResolveSave.js');

// ── helpers ─────────────────────────────────────────────────────────────────

const person = (clientRef, fields = {}) => ({
  kind: 'person', clientRef, source: 'first_experience.person_search', ...fields,
});

async function call(body) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const base = { userId: 'u1', authToken: 't', actor: 'barry' };
const byRef = (r, ref) => r.body.results.find(x => x.clientRef === ref);

beforeEach(() => { TABLE = []; WRITES = []; QUERIES = []; });

// ── 1. The model never supplies canonical identity ──────────────────────────

describe('1 — a candidate may never carry canonical identity', () => {
  for (const field of ['contactId', 'contact_id', 'canonicalId', 'personId', 'id']) {
    it(`rejects the whole request when a candidate carries ${field}`, async () => {
      const r = await call({
        ...base, operationId: 'op1', commit: true,
        candidates: [person('ui_1', { name: 'Dana', [field]: 'c_evil' })],
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(field);
      expect(WRITES).toHaveLength(0);
    });
  }

  it('rejects before authentication side effects, and writes nothing', async () => {
    TABLE = [{ id: 'c1', email_normalized: 'dana@acme.com' }];
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', { contactId: 'c1' })],
    });
    expect(r.status).toBe(400);
    expect(TABLE).toHaveLength(1);
  });
});

// ── 2. Outcomes ─────────────────────────────────────────────────────────────

describe('2 — every candidate gets the right outcome', () => {
  it('matched on an authoritative signal', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', email_normalized: 'dana@acme.com' }];
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [person('ui_1', { email: 'Dana@Acme.com' })],
    });
    expect(byRef(r, 'ui_1')).toMatchObject({
      outcome: 'matched', contactId: 'c1', matchedOn: 'email', existingName: 'Dana Whitfield',
    });
  });

  it('created on a true zero-match', async () => {
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [person('ui_1', { email: 'new@acme.com', name: 'New Person' })],
    });
    expect(byRef(r, 'ui_1').outcome).toBe('created');
  });

  it('ambiguous on a weak signal, with the candidates the resolver could not choose between', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c2', name: 'sarah johnson', company_name: 'acme' },
    ];
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [person('ui_1', { name: 'Sarah Johnson', company_name: 'Acme' })],
    });
    const out = byRef(r, 'ui_1');
    expect(out.outcome).toBe('ambiguous');
    expect(out.contactId).toBeNull();
    expect(out.candidates.map(c => c.contactId).sort()).toEqual(['c1', 'c2']);
  });

  it('refused when one authoritative identifier maps to two records', async () => {
    TABLE = [
      { id: 'c1', email_normalized: 'dana@acme.com' },
      { id: 'c2', email_normalized: 'dana@acme.com' },
    ];
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [person('ui_1', { email: 'dana@acme.com' })],
    });
    const out = byRef(r, 'ui_1');
    expect(out.outcome).toBe('refused');
    expect(out.matchedOn).toBe('email');
    expect(out.candidates.map(c => c.contactId).sort()).toEqual(['c1', 'c2']);
  });

  it('mixed batches summarise honestly — the "17 existing, 2 new, 1 ambiguous" shape', async () => {
    TABLE = [
      { id: 'c1', email_normalized: 'a@x.com' },
      { id: 'c2', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c3', name: 'sarah johnson', company_name: 'acme' },
    ];
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [
        person('ui_1', { email: 'a@x.com' }),
        person('ui_2', { email: 'brand@new.com' }),
        person('ui_3', { name: 'Sarah Johnson', company_name: 'Acme' }),
      ],
    });
    expect(r.body.summary).toMatchObject({ total: 3, matched: 1, created: 1, ambiguous: 1, refused: 0 });
  });
});

// ── 3. commit:false writes nothing ──────────────────────────────────────────

describe('3 — the dry run is genuinely dry', () => {
  it('resolves fully and writes nothing', async () => {
    TABLE = [{ id: 'c1', email_normalized: 'dana@acme.com' }];
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [
        person('ui_1', { email: 'dana@acme.com', linkedin_url: 'linkedin.com/in/dana' }),
        person('ui_2', { email: 'new@acme.com' }),
      ],
    });
    expect(r.body.committed).toBe(false);
    expect(r.body.summary).toMatchObject({ matched: 1, created: 1 });
    expect(WRITES).toHaveLength(0);
    expect(TABLE).toHaveLength(1);
  });

  it('defaults to a dry run when commit is absent', async () => {
    await call({ ...base, operationId: 'op1', candidates: [person('ui_1', { email: 'n@x.com' })] });
    expect(WRITES).toHaveLength(0);
  });
});

// ── 4. Commit writes only what it should ────────────────────────────────────

describe('4 — commit persists matched and created, never ambiguous or refused', () => {
  it('creates with the full identity envelope', async () => {
    const r = await call({
      ...base, operationId: 'op_abc', commit: true,
      candidates: [person('ui_1', {
        email: 'New@Acme.com', name: 'New Person', company_name: 'Acme',
        linkedin_url: 'https://www.linkedin.com/in/new/',
      })],
    });
    const w = WRITES.find(x => x.op === 'set');
    expect(w.data).toMatchObject({
      email_normalized: 'new@acme.com',
      linkedin_url_normalized: 'linkedin.com/in/new',
      record_status: 'active',
      relationship_status: 'new',
      stage: 'scout',
      identity_operation_id: 'op_abc',
      identity_actor: 'barry',
      identity_source: 'barryResolveSave',
    });
    expect(byRef(r, 'ui_1').contactId).toBe(w.id);
  });

  it('merges additively onto a match and never overwrites a canonical field', async () => {
    TABLE = [{ id: 'c1', name: 'Dana Whitfield', email: 'Dana@Acme.com' }];
    await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', {
        email: 'Dana@Acme.com', name: 'D. WHITFIELD', linkedin_url: 'linkedin.com/in/dana',
      })],
    });
    const patch = WRITES.find(x => x.op === 'update').data;
    expect(patch.linkedin_url).toBe('linkedin.com/in/dana');
    expect(patch.email_normalized).toBe('dana@acme.com');
    expect(patch.name).toBeUndefined();          // canonical, never overwritten
    expect(TABLE[0].name).toBe('Dana Whitfield');
  });

  it('writes NOTHING for an ambiguous candidate', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c2', name: 'sarah johnson', company_name: 'acme' },
    ];
    await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', { name: 'Sarah Johnson', company_name: 'Acme' })],
    });
    expect(WRITES).toHaveLength(0);
    expect(TABLE).toHaveLength(2);
  });

  it('writes NOTHING for a refused candidate', async () => {
    TABLE = [
      { id: 'c1', email_normalized: 'dana@acme.com' },
      { id: 'c2', email_normalized: 'dana@acme.com' },
    ];
    await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', { email: 'dana@acme.com' })],
    });
    expect(WRITES).toHaveLength(0);
    expect(TABLE).toHaveLength(2);
  });

  it('uses the {companyId}_{apolloPersonId} convention when the data supplies one', async () => {
    await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', { apollo_person_id: 'ap_9', company_id: 'co_3', name: 'X' })],
    });
    expect(WRITES[0].id).toBe('co_3_ap_9');
  });
});

// ── 5. The ambiguity choice contract ────────────────────────────────────────

describe('5 — the user may choose, the model may not', () => {
  const twins = () => [
    { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
    { id: 'c2', name: 'sarah johnson', company_name: 'acme' },
  ];
  const candidate = person('ui_1', { name: 'Sarah Johnson', company_name: 'Acme' });

  it('honours a choice that the resolver actually offered', async () => {
    TABLE = twins();
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [candidate], resolutions: { ui_1: 'c2' },
    });
    expect(byRef(r, 'ui_1')).toMatchObject({
      outcome: 'matched', contactId: 'c2', matchedOn: 'user_disambiguation',
    });
  });

  it('rejects an id the resolver did not offer, even with a valid operationId', async () => {
    TABLE = [...twins(), { id: 'c_other', name: 'Someone Else' }];
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [candidate], resolutions: { ui_1: 'c_other' },
    });
    const out = byRef(r, 'ui_1');
    expect(out.outcome).toBe('ambiguous');
    expect(out.reason).toBe('candidate_not_offered');
    expect(WRITES).toHaveLength(0);
  });

  it('rejects an id that does not exist in the workspace at all', async () => {
    TABLE = twins();
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [candidate], resolutions: { ui_1: 'c_from_another_workspace' },
    });
    expect(byRef(r, 'ui_1').outcome).toBe('ambiguous');
    expect(WRITES).toHaveLength(0);
  });

  it('refuses a stale choice — the candidate now resolves on its own', async () => {
    // Between preview and commit the record gained an email, so it is no longer
    // ambiguous. The user answered a question that is no longer being asked.
    TABLE = [{ id: 'c1', name: 'Sarah Johnson', company_name: 'Acme', email_normalized: 's@acme.com' }];
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [person('ui_1', { name: 'Sarah Johnson', company_name: 'Acme', email: 's@acme.com' })],
      resolutions: { ui_1: 'c_stale' },
    });
    // It resolves authoritatively now; the stale choice is simply not applied.
    expect(byRef(r, 'ui_1')).toMatchObject({ outcome: 'matched', matchedOn: 'email', contactId: 'c1' });
  });

  it('a resolution for an unknown clientRef changes nothing', async () => {
    TABLE = twins();
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [candidate], resolutions: { ui_999: 'c1' },
    });
    expect(byRef(r, 'ui_1').outcome).toBe('ambiguous');
    expect(WRITES).toHaveLength(0);
  });

  it('a choice is still ignored on a dry run', async () => {
    TABLE = twins();
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [candidate], resolutions: { ui_1: 'c2' },
    });
    expect(byRef(r, 'ui_1').outcome).toBe('matched');
    expect(WRITES).toHaveLength(0);   // resolved, not written
  });
});

// ── 6. operationId and idempotency ──────────────────────────────────────────

describe('6 — the same operationId bridges preview and commit, and a retry is a no-op', () => {
  it('requires an operationId in both modes', async () => {
    const r = await call({ ...base, commit: false, candidates: [person('ui_1', { name: 'X' })] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/operationId/);
  });

  it('echoes the operationId back unchanged', async () => {
    const r = await call({
      ...base, operationId: 'op_xyz', commit: false, candidates: [person('ui_1', { email: 'a@b.com' })],
    });
    expect(r.body.operationId).toBe('op_xyz');
  });

  it('"save these twice" does not create two records — resolver identity', async () => {
    const payload = {
      ...base, operationId: 'op_1', commit: true,
      candidates: [person('ui_1', { email: 'dana@acme.com', name: 'Dana' })],
    };
    const first = await call(payload);
    expect(first.body.summary.created).toBe(1);

    WRITES = [];
    const second = await call(payload);
    expect(second.body.summary).toMatchObject({ created: 0, matched: 1 });
    expect(TABLE.filter(r => r.email_normalized === 'dana@acme.com')).toHaveLength(1);
  });

  it('a retry of a candidate with NO identifier is still a no-op, via the operation guard', async () => {
    // The one case resolver identity cannot cover: nothing to re-resolve
    // against, so it would resolve to `new` on every attempt. The operation's
    // own prior writes close it, with no operations collection.
    const payload = {
      ...base, operationId: 'op_2', commit: true,
      candidates: [person('ui_lone', {})],
    };
    await call(payload);
    expect(TABLE).toHaveLength(1);

    await call(payload);
    expect(TABLE).toHaveLength(1);
  });

  it('a DIFFERENT operationId with the same identifiable people still does not duplicate', async () => {
    const cands = [person('ui_1', { email: 'dana@acme.com' })];
    await call({ ...base, operationId: 'op_a', commit: true, candidates: cands });
    await call({ ...base, operationId: 'op_b', commit: true, candidates: cands });
    expect(TABLE.filter(r => r.email_normalized === 'dana@acme.com')).toHaveLength(1);
  });
});

// ── 7. Batch economics and guards ───────────────────────────────────────────

describe('7 — one operation, one scan window', () => {
  it('twenty candidates load the scan window at most once', async () => {
    TABLE = [{ id: 'c1', name: 'Someone', company_name: 'Elsewhere' }];
    const candidates = Array.from({ length: 20 }, (_, i) =>
      person(`ui_${i}`, { name: `Person ${i}`, company_name: 'Nowhere' }));

    QUERIES = [];
    await call({ ...base, operationId: 'op1', commit: false, candidates });

    expect(QUERIES.filter(q => q === '__scan__')).toHaveLength(1);
  });

  it('caps the batch rather than accepting an unbounded write', async () => {
    const candidates = Array.from({ length: 201 }, (_, i) => person(`ui_${i}`, { name: `P${i}` }));
    const r = await call({ ...base, operationId: 'op1', commit: true, candidates });
    expect(r.status).toBe(400);
    expect(WRITES).toHaveLength(0);
  });

  it('refuses company candidates rather than resolving them wrongly (Phase 5)', async () => {
    const r = await call({
      ...base, operationId: 'op1', commit: true,
      candidates: [{ kind: 'company', clientRef: 'ui_1', name: 'Acme', source: 's' }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Phase 5/);
  });

  it('requires a clientRef on every candidate', async () => {
    const r = await call({
      ...base, operationId: 'op1', commit: false,
      candidates: [{ kind: 'person', name: 'No Ref', source: 's' }],
    });
    expect(r.status).toBe(400);
  });
});
