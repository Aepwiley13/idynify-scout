/**
 * GATE 2 PHASE 3 — barryPipelineAction obeys the same identity rule.
 *
 * This path predates Gate 2 and shipped with the exact failure Gate 0 forbids:
 * `contact_id` is emitted by the LLM copying an id out of prompt context — the
 * system prompt says "the contact's id from the context above" — and the server
 * validated only that the document EXISTED. With two Sarah Johnsons in context
 * the model picked one, the server accepted it, and the confirmation bubble
 * asked the user to approve a choice they were never shown.
 *
 * The correction is deliberately minimal: the seven action verbs are untouched,
 * every unambiguous action behaves exactly as before, and the guard reuses
 * hierarchy step 6 from the one identity engine rather than forming a second
 * opinion about who is who.
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
      // Action verbs reach into subcollections (timeline, missions); the guard
      // under test runs before any of that, but the happy-path cases must be
      // able to complete for their 200 to mean anything.
      collection: () => contactsQuery(),
      async get() {
        const row = TABLE.find(r => r.id === id);
        return { exists: Boolean(row), id, data: () => ({ ...row }) };
      },
      async update(data) { WRITES.push({ id, data }); },
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

// The handler verifies auth against Identity Toolkit over fetch.
globalThis.fetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ users: [{ localId: 'u1' }] }),
}));

const { handler } = await import('../../netlify/functions/barryPipelineAction.js');

async function act(contactId, action_type = 'move_stage', params = { to_stage: 'sniper' }) {
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', action_type, contactId, params }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

beforeEach(() => {
  TABLE = [];
  WRITES = [];
  // verifyAuth reads this at call time; the fetch above supplies the response.
  vi.stubEnv('FIREBASE_API_KEY', 'test-key');
});

describe('the model no longer decides which Sarah Johnson', () => {
  it('refuses with 409 and the candidates when two contacts are indistinguishable', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme', stage: 'hunter' },
      { id: 'c2', name: 'sarah johnson', company_name: 'acme', stage: 'hunter' },
    ];

    const r = await act('c1');

    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ambiguous_contact');
    expect(r.body.candidates.map(c => c.contactId).sort()).toEqual(['c1', 'c2']);
    // Nothing moved. A guess must not mutate.
    expect(WRITES).toHaveLength(0);
  });

  it('409, not 500 — nothing failed, Barry needs an answer', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c2', name: 'Sarah Johnson', company_name: 'Acme' },
    ];
    expect((await act('c1')).status).toBe(409);
  });

  it('lets an unambiguous action through untouched', async () => {
    TABLE = [
      { id: 'c1', name: 'Dana Whitfield', company_name: 'Acme', stage: 'hunter' },
      { id: 'c2', name: 'Mo Chen', company_name: 'Acme', stage: 'hunter' },
    ];
    const r = await act('c1');
    expect(r.status).toBe(200);
    expect(WRITES.length).toBeGreaterThan(0);
  });

  it('same name at DIFFERENT companies is not ambiguous', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme', stage: 'hunter' },
      { id: 'c2', name: 'Sarah Johnson', company_name: 'Northwind', stage: 'hunter' },
    ];
    expect((await act('c1')).status).toBe(200);
  });

  it('a contact with no name is not ambiguous — there is nothing to confuse', async () => {
    TABLE = [{ id: 'c1', company_name: 'Acme', stage: 'hunter' }];
    expect((await act('c1')).status).toBe(200);
  });

  it('a contact id that does not exist is still not found, not ambiguous', async () => {
    TABLE = [{ id: 'c1', name: 'Dana' }];
    const r = await act('c_ghost');
    expect(r.status).toBe(404);
  });

  it('applies to every contact-scoped verb, not just move_stage', async () => {
    TABLE = [
      { id: 'c1', name: 'Sarah Johnson', company_name: 'Acme' },
      { id: 'c2', name: 'sarah johnson', company_name: 'acme' },
    ];
    for (const verb of ['engage_contact', 'archive_contact', 'add_note', 'update_status']) {
      const r = await act('c1', verb, { note: 'x', contact_status: 'Engaged' });
      expect(r.status, `${verb} must refuse an ambiguous pick`).toBe(409);
    }
    expect(WRITES).toHaveLength(0);
  });
});
