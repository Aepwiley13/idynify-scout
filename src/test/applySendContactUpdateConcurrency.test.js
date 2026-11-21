/**
 * applySendContactUpdate — the shared transactional guard behind every
 * confirmed-send contact write (gmail-send-quick.js, gmail-send-wave.js,
 * both scheduled-engagement paths). Before this guard, each call site did
 * a plain get()-then-update(): read the contact, decide whether to mark it
 * awaiting_reply from that snapshot, then write — two separate round
 * trips, with a real gap between them (network time to Gmail's send API,
 * on the scheduled paths). replyPolling.js's own transaction landing a
 * genuine reply inside that gap would advance the contact (e.g. to
 * In Conversation), and the send path would then commit its now-stale
 * decision on top, regressing exactly the status PR A's forward-safety
 * guard exists to protect.
 *
 * Deterministic proof, not a hopeful Promise.all: the fake below can pause
 * the FIRST read of a given document, capturing what it would have seen at
 * that moment, and only release it once told to. That lets a test force
 * the exact interleaving a hand-wavy "run both concurrently" cannot
 * guarantee — simulateGenuineReply is driven to full completion WHILE the
 * send's read is parked, so the send's decision is provably made from
 * stale (pre-reply) data, exactly like the real race. The real
 * applySendContactUpdate (unmodified) is what's under test; only the fake
 * Firestore is instrumented.
 *
 * Confirmed load-bearing: reverting applySendContactUpdate.js to the old
 * plain get()-then-update() shape makes every "never regressed" assertion
 * below fail with the predicted result (hunter_status back to
 * 'awaiting_reply', contact_status not updated) before restoring the fix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { applySendContactUpdate } from '../../netlify/functions/utils/applySendContactUpdate.js';
import { ADVANCED_RELATIONSHIP_STATUSES } from '../constants/contactStatuses.js';
import { CONTACT_STATUSES } from '../constants/contactStatuses.js';

const USER_ID = 'u1';
const CONTACT_ID = 'c1';
const contactPath = `users/${USER_ID}/contacts/${CONTACT_ID}`;

/** Same dotted-path/increment semantics proven in replyPolling.test.js. */
function applyPatch(current, patch) {
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split('.');
    let node = next;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      node[segment] = { ...(node[segment] || {}) };
      node = node[segment];
    }
    const leaf = path[path.length - 1];
    const isIncrement = value && typeof value === 'object' && typeof value.operand === 'number'
      && value.constructor?.name === 'NumericIncrementTransform';
    node[leaf] = isIncrement ? (node[leaf] || 0) + value.operand : value;
  }
  return next;
}

/**
 * A Firestore admin-SDK-shaped fake with real optimistic-concurrency
 * semantics (a transaction retries if anything it read has since been
 * committed by someone else — see replyPolling.test.js's own version of
 * this), PLUS a one-shot pause on a single document's next read, armed
 * explicitly by a test via `armPause(path)`. The paused read resolves with
 * whatever the document looked like the MOMENT armPause was called —
 * capturing genuine staleness — not whatever it looks like when released.
 */
function makeFakeDb(seed = {}) {
  const docs = { ...seed };
  const versions = {};
  let pause = null; // { path, capturedSnap, release: () => void, gate: Promise }

  function armPause(path) {
    // Frozen at arm time, not a live reference — data() must keep returning
    // what the document looked like right now, however long the read stays
    // parked and whatever commits to this path in the meantime.
    const snapshotValue = docs[path] !== undefined ? { ...docs[path] } : undefined;
    const capturedSnap = { exists: snapshotValue !== undefined, data: () => snapshotValue };
    let resolveGate;
    const gate = new Promise((r) => { resolveGate = r; });
    pause = { path, capturedSnap, gate, used: false };
    return { release: () => resolveGate() };
  }

  function docRef(path) {
    const ref = {
      path,
      get: async () => {
        if (pause && pause.path === path && !pause.used) {
          pause.used = true;
          const { capturedSnap, gate } = pause;
          await gate;
          return capturedSnap;
        }
        return { exists: docs[path] !== undefined, data: () => docs[path] };
      },
      update: async (patch) => {
        if (docs[path] === undefined) {
          const err = new Error(`NOT_FOUND: No document to update: ${path}`);
          err.code = 5;
          throw err;
        }
        docs[path] = applyPatch(docs[path], patch);
        versions[path] = (versions[path] || 0) + 1;
      },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
    ref.firestore = db; // what applySendContactUpdate calls runTransaction on
    return ref;
  }

  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`) };
  }

  const db = {
    collection: (name) => collRef(name),
    armPause,
    runTransaction: async (fn, { maxAttempts = 10 } = {}) => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const readVersions = new Map();
        const pending = [];
        const tx = {
          get: async (ref) => {
            readVersions.set(ref.path, versions[ref.path] || 0);
            return ref.get();
          },
          update: (ref, patch) => { pending.push({ path: ref.path, value: patch }); },
        };

        const result = await fn(tx);

        const conflicted = [...readVersions.entries()].some(
          ([path, seenVersion]) => (versions[path] || 0) !== seenVersion
        );
        if (conflicted) continue; // someone else committed since our read — retry from scratch

        // Real Firestore: "The update will fail if applied to a document
        // that does not exist" (@google-cloud/firestore's own Transaction
        // .update() docs) — true for tx.update() exactly as for the plain
        // docRef.update() below. NOT_FOUND is a terminal commit failure,
        // never retried — modeled here as a synchronous throw rather than
        // silently materializing a document that was never there.
        for (const op of pending) {
          if (docs[op.path] === undefined) {
            const err = new Error(`NOT_FOUND: No document to update: ${op.path}`);
            err.code = 5;
            throw err;
          }
        }

        for (const op of pending) {
          docs[op.path] = applyPatch(docs[op.path], op.value);
          versions[op.path] = (versions[op.path] || 0) + 1;
        }
        return result;
      }
      throw new Error('simulated transaction exceeded max retries (contention)');
    },
    _docs: docs,
  };
  return db;
}

/**
 * Shaped exactly like replyPolling.js's own transactional write for a
 * genuine reply — not a re-import of that file (too heavy, and it needs a
 * Gmail-message-shaped input this test isn't exercising), just the same
 * write contract: a fresh tx.get(), the same ADVANCED_RELATIONSHIP_STATUSES
 * guard, and the same canonical+legacy reply_count increment.
 */
async function simulateGenuineReply(contactRef) {
  await contactRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(contactRef);
    const fresh = snap.exists ? snap.data() : {};
    const patch = {
      last_reply_at: new Date().toISOString(),
      'relationship.reply_count': FieldValue.increment(1),
      'engagement_summary.replies_received': FieldValue.increment(1),
    };
    if (!ADVANCED_RELATIONSHIP_STATUSES.has(fresh.contact_status)) {
      patch.hunter_status = 'in_conversation';
      patch.contact_status = CONTACT_STATUSES.IN_CONVERSATION;
    }
    tx.update(contactRef, patch);
  });
}

let db;
beforeEach(() => {
  db = makeFakeDb({
    [contactPath]: { contact_status: 'New' },
  });
});

function contactRef() {
  return db.collection('users').doc(USER_ID).collection('contacts').doc(CONTACT_ID);
}

describe('applySendContactUpdate concurrency: a genuine reply landing strictly inside the send\'s read-decide-write window', () => {
  it('is never regressed to awaiting_reply — the send retries and converges on the reply\'s result', async () => {
    const ref = contactRef();
    const gate = db.armPause(contactPath); // captures 'New' now; the send's first read will see exactly this, however long it's parked

    const sendPromise = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    // Drive the reply to full completion while the send is parked on its paused read.
    await simulateGenuineReply(ref);
    gate.release();
    const { markedAwaitingReply } = await sendPromise;

    const final = db._docs[contactPath];
    expect(final.contact_status).toBe('In Conversation');
    expect(final.hunter_status).toBe('in_conversation');
    // The retry correctly saw the reply and did NOT mark awaiting_reply.
    expect(markedAwaitingReply).toBe(false);
  });

  it('still applies the send-time fields (gmail_last_message_id, last_sent_at, thread id) despite the forced retry', async () => {
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    const sendPromise = applySendContactUpdate(
      ref, { gmail_last_message_id: 'm1', last_sent_at: 't1', gmail_thread_id: 'th1' }, 'gmail_send_quick',
    );
    await simulateGenuineReply(ref);
    gate.release();
    await sendPromise;

    const final = db._docs[contactPath];
    expect(final.gmail_last_message_id).toBe('m1');
    expect(final.last_sent_at).toBe('t1');
    expect(final.gmail_thread_id).toBe('th1');
  });

  it('reply_count is incremented exactly once — the send\'s retry does not touch it, and the forced retry does not double the reply\'s own write', async () => {
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    const sendPromise = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    await simulateGenuineReply(ref);
    gate.release();
    await sendPromise;

    expect(db._docs[contactPath].relationship.reply_count).toBe(1);
  });

  it('a send racing a reply on a contact already holding an advanced relationship status never regresses it either', async () => {
    db = makeFakeDb({ [contactPath]: { contact_status: 'Active Customer', hunter_status: 'active_customer' } });
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    const sendPromise = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    await simulateGenuineReply(ref); // a no-op status-wise — ADVANCED_RELATIONSHIP_STATUSES guards it too
    gate.release();
    await sendPromise;

    const final = db._docs[contactPath];
    expect(final.contact_status).toBe('Active Customer');
    expect(final.gmail_last_message_id).toBe('m1'); // non-status field still applied
  });
});

describe('applySendContactUpdate: the ordinary, non-racing case is unaffected', () => {
  it('a fresh contact with no concurrent activity is still marked awaiting_reply', async () => {
    const ref = contactRef();
    const { markedAwaitingReply } = await applySendContactUpdate(
      ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick',
    );
    expect(markedAwaitingReply).toBe(true);
    expect(db._docs[contactPath].hunter_status).toBe('awaiting_reply');
  });
});

describe('applySendContactUpdate: deleted contact — Gmail already sent, nothing to write to', () => {
  it('rejects with the same NOT_FOUND shape a plain update() would — no document is phantom-created', async () => {
    db = makeFakeDb({}); // never existed / already deleted — no seed at all
    const ref = contactRef();

    await expect(
      applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick')
    ).rejects.toMatchObject({ code: 5 });

    // The failed commit must not have materialized a partial document —
    // real Firestore's NOT_FOUND on update() never creates one either.
    expect(db._docs[contactPath]).toBeUndefined();
  });

  it('a contact deleted strictly between the send-time read and the retry still rejects cleanly, not silently', async () => {
    // Seeded, then deleted by something else while the send's first read
    // is parked — same mechanism as the reply race above, but the
    // concurrent writer removes the document instead of advancing it.
    db = makeFakeDb({ [contactPath]: { contact_status: 'New' } });
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    const sendPromise = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    delete db._docs[contactPath]; // simulates a delete landing in the gap
    gate.release();

    await expect(sendPromise).rejects.toMatchObject({ code: 5 });
  });
});

describe('applySendContactUpdate: no duplicate writes from a forced retry', () => {
  it('a retried attempt\'s buffered write is fully discarded, not merged with the winning attempt\'s — reply_count reflects only the reply\'s own single write', async () => {
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    // The send's first (discarded) attempt would have written hunter_status;
    // its retry correctly does not. Confirms the FAILED attempt's buffered
    // ops never land alongside the retry's — not even partially.
    const sendPromise = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    await simulateGenuineReply(ref);
    gate.release();
    await sendPromise;

    const final = db._docs[contactPath];
    expect(final.relationship.reply_count).toBe(1); // not 2 — the discarded attempt wrote nothing at all
    expect(final.hunter_status).toBe('in_conversation'); // not overwritten back by the discarded attempt
  });

  it('two sends racing each other (no reply involved) still converge on a single, consistent write — not two independent applications', async () => {
    const ref = contactRef();
    const gate = db.armPause(contactPath);

    const firstSend = applySendContactUpdate(ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick');
    // A second send (e.g. a wave recipient sharing this contact) commits
    // normally while the first is parked on its paused read.
    await applySendContactUpdate(ref, { gmail_last_message_id: 'm2', last_sent_at: 't2' }, 'gmail_send_wave');
    gate.release();
    await firstSend;

    // The retried first send overwrites with its own (later-released, but
    // logically "first requested") values — deterministic last-writer-
    // wins, not a merge of both, and not applied twice.
    const final = db._docs[contactPath];
    expect(final.gmail_last_message_id).toBe('m1');
    expect(final.last_sent_at).toBe('t1');
    expect(final.hunter_status).toBe('awaiting_reply');
  });
});

describe('applySendContactUpdate: a transaction failure never blocks on, or undoes, an already-accepted Gmail send', () => {
  it('propagates a non-NOT_FOUND transaction failure (e.g. persistent contention) rather than swallowing it — callers decide how to handle it', async () => {
    const ref = contactRef();
    const failingFirestore = {
      runTransaction: async () => {
        throw new Error('simulated transaction exceeded max retries (contention)');
      },
    };
    const refWithFailingFirestore = { ...ref, firestore: failingFirestore };

    // applySendContactUpdate itself does not catch — by design, so every
    // call site's own try/catch (gmail-send-quick.js, gmail-send-wave.js)
    // or .catch(() => {}) (process-scheduled-engagements.js) remains the
    // single place deciding that a contact-update failure must never be
    // reported as a failed send. See those handler-level tests for the
    // "Gmail already sent, HTTP response still succeeds" half of this.
    await expect(
      applySendContactUpdate(refWithFailingFirestore, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick')
    ).rejects.toThrow('simulated transaction exceeded max retries');

    // Nothing was written — a failed commit must not leave a partial trace.
    expect(db._docs[contactPath]).toEqual({ contact_status: 'New' });
  });
});

describe('applySendContactUpdate: promotion-field computation never blocks the base/status write', () => {
  it('still writes send-time fields and the status decision, and promotes status:"suggested" -> "active" from the same fresh read', async () => {
    db = makeFakeDb({ [contactPath]: { contact_status: 'New', status: 'suggested' } });
    const ref = contactRef();
    const { markedAwaitingReply } = await applySendContactUpdate(
      ref, { gmail_last_message_id: 'm1', last_sent_at: 't1' }, 'gmail_send_quick',
    );

    expect(markedAwaitingReply).toBe(true);
    const final = db._docs[contactPath];
    expect(final.gmail_last_message_id).toBe('m1');
    expect(final.hunter_status).toBe('awaiting_reply');
    expect(final.status).toBe('active');
  });
});
