/**
 * A confirmed Gmail reply must reach a surface the user actually looks at.
 *
 * ─── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 *
 * `conversationState` is a WORKFLOW vocabulary — twelve values in
 * src/types/conversationState.js, describing where a conversation sits in the
 * outreach lifecycle. `relationship.state` is a RELATIONSHIP vocabulary — three
 * values, describing who owes whom a message.
 *
 * The compatibility mirror wrote the second into the first. Nothing threw,
 * because Firestore does not police value domains and every consumer compares
 * with `===`. The chain simply went quiet:
 *
 *   mirror writes conversationState = "in_conversation"
 *     → process-barry-inbox-queue gates on === "response_received"   ✗ never true
 *       → so it never sets "user_action_required"
 *         → usePendingReplies queries "user_action_required"          ✗ no rows
 *         → barryOrientationBrief queries the same                    ✗ no rows
 *         → HunterContactDrawer gates on the same                     ✗ no card
 *
 * So a reply could resolve identity, create a canonical event, materialize
 * relationship state, queue Barry, be analysed and be drafted — and still never
 * appear to the user. Every stage reported success.
 *
 * These tests assert the HANDOFFS rather than any single stage, because each
 * stage was individually correct. Only the seams were wrong, which is exactly
 * the class of defect a per-module suite cannot see.
 *
 * The mirror builder stays private to the writer (ADR-006 makes that a
 * guarantee rather than a convention), so this drives the real
 * `recordInboundEvent` path and reads what actually landed on the contact.
 */

import { describe, it, expect } from 'vitest';
import { CONVERSATION_STATES } from '../types/conversationState';
import {
  recordInboundEvent,
  CONVERSATION_STATE_FOR_INBOUND_REPLY,
} from '../../netlify/functions/utils/relationshipEventWriter.js';
import { RELATIONSHIP_STATES } from '../utils/relationshipMaterialization';
import { awaitsUserAction, getConversationState } from '../utils/relationshipRead';

/** The value each downstream consumer actually compares against. */
const QUEUE_GATE_EXPECTS = CONVERSATION_STATES.RESPONSE_RECEIVED;   // process-barry-inbox-queue.js:204
const PENDING_REPLIES_QUERIES = 'user_action_required';             // usePendingReplies.js:184
const ORIENTATION_BRIEF_QUERIES = 'user_action_required';           // barryOrientationBrief.js:130
const DRAWER_GATE_EXPECTS = 'user_action_required';                 // HunterContactDrawer.jsx:142

const USER = 'user_fixture_reply';
const CONTACT = 'contact_fixture_reply';
const contactPath = `users/${USER}/contacts/${CONTACT}`;

function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const doc = (path) => ({
    path,
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    async set(data, opts) { store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data); },
  });
  return {
    store,
    collection: (name) => ({
      doc: (id) => ({
        ...doc(`${name}/${id}`),
        collection: (sub) => ({ doc: (subId) => doc(`${name}/${id}/${sub}/${subId}`) }),
      }),
    }),
    async runTransaction(fn) {
      return fn({
        async get(ref) { return ref.get(); },
        create(ref, data) {
          if (store.has(ref.path)) throw new Error('ALREADY_EXISTS');
          store.set(ref.path, data);
        },
        update(ref, data) { store.set(ref.path, { ...(store.get(ref.path) || {}), ...data }); },
      });
    },
  };
}

const MESSAGE = {
  idynifyUserId: USER,
  gmailMessageId: 'msg_fixture_reply',
  gmailThreadId: 'thread_fixture_reply',
  receivedAt: '2020-06-01T10:00:00.000Z',
  subject: 'Re: fixture',
};

/** Run the real writer against a contact mid-outreach, and return the contact. */
async function recordReply(seedContact = { contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' }) {
  const db = createFakeDb({ [contactPath]: seedContact });
  const result = await recordInboundEvent({
    db,
    message: MESSAGE,
    contactId: CONTACT,
    identity: { signal: 'email', outcome: 'matched' },
    source: 'gmail_sync',
    threadHasPriorOutbound: true,
    env: { GMAIL_IDENTITY_MODE: 'live' },
  });
  return { db, result, contact: db.store.get(contactPath) };
}

describe('the mirror speaks the vocabulary its consumers read', () => {
  it('writes a value that exists in CONVERSATION_STATES at all', async () => {
    const { contact } = await recordReply();
    expect(Object.values(CONVERSATION_STATES)).toContain(contact.conversationState);
  });

  it('never leaks a relationship-vocabulary value into the workflow field', async () => {
    const { contact } = await recordReply();
    expect(Object.values(RELATIONSHIP_STATES)).not.toContain(contact.conversationState);
  });

  it('still materializes the relationship vocabulary in its own field', async () => {
    const { contact } = await recordReply();
    expect(contact['relationship.state']).toBe(RELATIONSHIP_STATES.IN_CONVERSATION);
  });
});

describe('handoff 1 — mirror to the Barry queue', () => {
  it('writes exactly the value process-barry-inbox-queue gates on', async () => {
    const { contact } = await recordReply();
    expect(contact.conversationState).toBe(QUEUE_GATE_EXPECTS);
  });

  it('exports that value as a named constant so the two cannot drift apart', () => {
    expect(CONVERSATION_STATE_FOR_INBOUND_REPLY).toBe(QUEUE_GATE_EXPECTS);
  });
});

describe('handoff 2 — the queue to every user-visible surface', () => {
  /** What process-barry-inbox-queue Step 8 does once its gate is satisfied. */
  const afterQueueTransition = (contact) =>
    contact.conversationState === QUEUE_GATE_EXPECTS
      ? { ...contact, conversationState: CONVERSATION_STATES.USER_ACTION_REQUIRED }
      : contact;

  it.each([
    ['usePendingReplies', PENDING_REPLIES_QUERIES],
    ['barryOrientationBrief', ORIENTATION_BRIEF_QUERIES],
    ['HunterContactDrawer', DRAWER_GATE_EXPECTS],
  ])('is visible to %s', async (_surface, expectedValue) => {
    const { contact } = await recordReply();
    expect(afterQueueTransition(contact).conversationState).toBe(expectedValue);
  });
});

describe('the canonical accessor, so consumers can stop reading the mirror', () => {
  it('reports a contact awaiting the user', () => {
    expect(awaitsUserAction({ conversationState: CONVERSATION_STATES.USER_ACTION_REQUIRED }))
      .toBe(true);
  });

  it('does not report one that is merely mid-conversation', async () => {
    const { contact } = await recordReply();
    expect(awaitsUserAction(contact)).toBe(false);
  });

  it('reads the workflow state without confusing it for relationship state', () => {
    const contact = {
      conversationState: CONVERSATION_STATES.USER_ACTION_REQUIRED,
      relationship: { state: RELATIONSHIP_STATES.IN_CONVERSATION },
    };
    expect(getConversationState(contact)).toBe(CONVERSATION_STATES.USER_ACTION_REQUIRED);
  });
});

describe('the end-to-end path a Gmail reply travels', () => {
  it('carries a confirmed reply all the way to a user-visible surface', async () => {
    const { result, contact } = await recordReply();

    // 1. the canonical event exists and materialized relationship state
    expect(result.created).toBe(true);
    expect(contact['relationship.reply_count']).toBe(1);
    expect(contact['relationship.state']).toBe(RELATIONSHIP_STATES.IN_CONVERSATION);

    // 2. the two approved workflow transitions fired
    expect(contact.contact_status).toBe('In Conversation');
    expect(contact.hunter_status).toBe('in_conversation');

    // 3. Barry's queue accepts it and advances it
    expect(contact.conversationState).toBe(QUEUE_GATE_EXPECTS);
    const advanced = { ...contact, conversationState: CONVERSATION_STATES.USER_ACTION_REQUIRED };

    // 4. and the user can now see it
    expect(awaitsUserAction(advanced)).toBe(true);
    expect(advanced.conversationState).toBe(PENDING_REPLIES_QUERIES);
  });
});
