/**
 * relationshipEventWriter — ADR-006 writer behaviour.
 *
 * The pure rules are covered by relationshipMaterialization.test.js. What is
 * asserted here is the part that needed a database to be wrong about: that
 * dry_run writes no relationship state at all, that the safety gate fails safe,
 * that replay is inert, and that the two approved workflow transitions fire
 * only from their stated current value.
 *
 * The Firestore fake is deliberately small. It models exactly the three things
 * the writer depends on — document identity, transactional read-then-create,
 * and dotted update paths — because a richer fake would start asserting the
 * emulator's behaviour instead of ours.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordInboundEvent,
  resolveIdentityMode,
  buildInboundEvent,
  IDENTITY_MODES,
  EVENTS_COLLECTION,
  PROBE_COLLECTION,
  CONVERSATION_STATE_FOR_INBOUND_REPLY,
} from '../../netlify/functions/utils/relationshipEventWriter.js';
import { EVENT_TYPES, RELATIONSHIP_STATES } from '../utils/relationshipMaterialization';

// ── Minimal Firestore fake ──────────────────────────────────────────────────

function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];

  const docHandle = (path) => ({
    path,
    async get() {
      return { exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path) };
    },
    async set(data, opts) {
      writes.push({ op: 'set', path, data });
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
    },
  });

  const collectionHandle = (name) => ({
    doc: (id) => docHandle(`${name}/${id}`),
    where() { return this; },
  });

  const db = {
    store, writes,
    collection: (name) => ({
      ...collectionHandle(name),
      doc: (id) => ({
        ...docHandle(`${name}/${id}`),
        collection: (sub) => ({
          doc: (subId) => docHandle(`${name}/${id}/${sub}/${subId}`),
        }),
      }),
    }),
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return ref.get(); },
        create(ref, data) {
          if (store.has(ref.path)) throw new Error('ALREADY_EXISTS');
          writes.push({ op: 'create', path: ref.path, data });
          store.set(ref.path, data);
        },
        update(ref, data) {
          writes.push({ op: 'update', path: ref.path, data });
          store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
        },
      };
      return fn(tx);
    },
  };
  return db;
}

const USER = 'user_fixture_0002';
const CONTACT = 'contact_fixture_0002';
const contactPath = `users/${USER}/contacts/${CONTACT}`;

const MESSAGE = {
  idynifyUserId: USER,
  gmailMessageId: 'msg_fixture_a',
  gmailThreadId: 'thread_fixture_a',
  receivedAt: '2020-03-01T10:00:00.000Z',
  subject: 'Re: fixture subject',
  fromEmail: 'someone@example.test',
};

const IDENTITY = { signal: 'email', outcome: 'matched' };

function record(db, overrides = {}) {
  return recordInboundEvent({
    db,
    message: MESSAGE,
    contactId: CONTACT,
    identity: IDENTITY,
    source: 'gmail_sync',
    threadHasPriorOutbound: true,
    env: { GMAIL_IDENTITY_MODE: 'live' },
    ...overrides,
  });
}

// ── The safety gate ─────────────────────────────────────────────────────────

describe('GMAIL_IDENTITY_MODE fails safe', () => {
  it('only the exact string "live" enables writes', () => {
    expect(resolveIdentityMode({ GMAIL_IDENTITY_MODE: 'live' })).toBe(IDENTITY_MODES.LIVE);
  });

  it.each([
    ['unset', {}],
    ['empty', { GMAIL_IDENTITY_MODE: '' }],
    ['dry_run', { GMAIL_IDENTITY_MODE: 'dry_run' }],
    ['misspelled', { GMAIL_IDENTITY_MODE: 'LIVE' }],
    ['typo', { GMAIL_IDENTITY_MODE: 'liv' }],
    ['nonsense', { GMAIL_IDENTITY_MODE: 'yes' }],
  ])('resolves %s to dry_run', (_label, env) => {
    expect(resolveIdentityMode(env)).toBe(IDENTITY_MODES.DRY_RUN);
  });
});

describe('dry_run mutates no relationship state', () => {
  let db;
  beforeEach(() => { db = createFakeDb({ [contactPath]: { contact_status: 'Awaiting Reply' } }); });

  it('creates no canonical event', async () => {
    const result = await record(db, { env: { GMAIL_IDENTITY_MODE: 'dry_run' } });
    expect(result.mode).toBe(IDENTITY_MODES.DRY_RUN);
    expect(result.created).toBe(false);
    expect(result.reason).toBe('dry_run');
    expect([...db.store.keys()].some(k => k.startsWith(EVENTS_COLLECTION))).toBe(false);
  });

  it('never touches the contact document', async () => {
    await record(db, { env: { GMAIL_IDENTITY_MODE: 'dry_run' } });
    expect(db.writes.some(w => w.path === contactPath)).toBe(false);
    expect(db.store.get(contactPath)).toEqual({ contact_status: 'Awaiting Reply' });
  });

  it('records a probe so the validation window is measurable', async () => {
    await record(db, { env: { GMAIL_IDENTITY_MODE: 'dry_run' } });
    const probe = db.store.get(`${PROBE_COLLECTION}/${USER}__${MESSAGE.gmailMessageId}`);
    expect(probe).toBeTruthy();
    expect(probe.wouldCreate).toBe(true);
    expect(probe.contactId).toBe(CONTACT);
  });

  it('reports no downstream effects, so nothing is queued', async () => {
    const result = await record(db, { env: { GMAIL_IDENTITY_MODE: 'dry_run' } });
    expect(result.effects).toEqual([]);
  });
});

describe('live records the event and materializes state', () => {
  let db;
  beforeEach(() => { db = createFakeDb({ [contactPath]: { contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' } }); });

  it('creates the canonical event under the deterministic key', async () => {
    const result = await record(db);
    expect(result.created).toBe(true);
    expect(result.eventId).toBe(`${USER}__${MESSAGE.gmailMessageId}`);
    expect(db.store.has(`${EVENTS_COLLECTION}/${USER}__${MESSAGE.gmailMessageId}`)).toBe(true);
  });

  it('materializes relationship.* via dotted paths', async () => {
    await record(db);
    const contact = db.store.get(contactPath);
    expect(contact['relationship.last_inbound_at']).toBe(MESSAGE.receivedAt);
    expect(contact['relationship.last_inbound_message_id']).toBe(MESSAGE.gmailMessageId);
    expect(contact['relationship.reply_count']).toBe(1);
    expect(contact['relationship.state']).toBe(RELATIONSHIP_STATES.IN_CONVERSATION);
  });

  it('writes the legacy mirrors', async () => {
    await record(db);
    const contact = db.store.get(contactPath);
    expect(contact.last_reply_at).toBe(MESSAGE.receivedAt);
    expect(contact.last_replied_at).toBe(MESSAGE.receivedAt);
    expect(contact['engagement_summary.replies_received']).toBe(1);
    // The WORKFLOW value, not the relationship value. This assertion used to
    // expect RELATIONSHIP_STATES.IN_CONVERSATION and so encoded the defect it
    // was meant to guard: conversationState and relationship.state are
    // different vocabularies, and writing one into the other strands the reply
    // before process-barry-inbox-queue. See replyReachesUser.test.js.
    expect(contact.conversationState).toBe(CONVERSATION_STATE_FOR_INBOUND_REPLY);
  });

  it('does not mirror the two fields that have no readers', async () => {
    await record(db);
    const contact = db.store.get(contactPath);
    expect(contact.lastInboundAt).toBeUndefined();
    expect(contact.replyCount).toBeUndefined();
  });
});

describe('the two approved workflow transitions, and only those', () => {
  it('moves Awaiting Reply → In Conversation', async () => {
    const db = createFakeDb({ [contactPath]: { contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' } });
    await record(db);
    const contact = db.store.get(contactPath);
    expect(contact.contact_status).toBe('In Conversation');
    expect(contact.hunter_status).toBe('in_conversation');
  });

  it.each(['New', 'Engaged', 'Dormant', 'converted', 'Active Customer'])(
    'leaves contact_status "%s" untouched',
    async (status) => {
      const db = createFakeDb({ [contactPath]: { contact_status: status } });
      await record(db);
      const write = db.writes.find(w => w.path === contactPath);
      expect(write.data.contact_status).toBeUndefined();
      expect(db.store.get(contactPath).contact_status).toBe(status);
    }
  );
});

describe('replay is inert', () => {
  it('creates no second event and writes nothing', async () => {
    const db = createFakeDb({ [contactPath]: { contact_status: 'Awaiting Reply' } });

    const first = await record(db);
    expect(first.created).toBe(true);
    const writesAfterFirst = db.writes.length;

    const replay = await record(db);
    expect(replay.created).toBe(false);
    expect(replay.reason).toBe('already_recorded');
    expect(replay.effects).toEqual([]);
    expect(db.writes.length).toBe(writesAfterFirst);
    expect(db.store.get(contactPath)['relationship.reply_count']).toBe(1);
  });
});

describe('event shape', () => {
  it('freezes eventType at creation from thread position', () => {
    const reply = buildInboundEvent({
      message: MESSAGE, contactId: CONTACT, identity: IDENTITY,
      source: 'gmail_sync', threadHasPriorOutbound: true,
    });
    const first = buildInboundEvent({
      message: MESSAGE, contactId: CONTACT, identity: IDENTITY,
      source: 'gmail_sync', threadHasPriorOutbound: false,
    });
    expect(reply.eventType).toBe(EVENT_TYPES.INBOUND_REPLY);
    expect(first.eventType).toBe(EVENT_TYPES.INBOUND_MESSAGE);
  });

  it('carries the Gmail event time, never a processing time', () => {
    const event = buildInboundEvent({
      message: MESSAGE, contactId: CONTACT, identity: IDENTITY,
      source: 'backfill', threadHasPriorOutbound: true,
    });
    expect(event.occurredAt).toBe(MESSAGE.receivedAt);
    expect(event.source).toBe('backfill');
  });

  it('refuses to key an event with no message id', async () => {
    const db = createFakeDb({ [contactPath]: {} });
    const result = await record(db, { message: { ...MESSAGE, gmailMessageId: null } });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('unkeyable_event');
  });
});
