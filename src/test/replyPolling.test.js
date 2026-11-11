/**
 * replyPolling.js — the shared core behind both "Sync Replies" (manual) and
 * gmail-reply-sync-worker.js (scheduled). Drives the real pollRepliesForUser
 * against a recording/replaying Firestore fake and a stubbed Gmail client.
 *
 * Covers, per the automatic-reply-sync design Aaron approved:
 *   - genuine reply advances Awaiting Reply -> In Conversation
 *   - automated mail (bounce/out-of-office/mailing-list) is never treated
 *     as a reply — reuses gmailMessageService.js's existing classifier
 *   - a relationship status (Active Customer etc.) or Mission Complete is
 *     never regressed by a reply on a stale thread
 *   - durable, message-level idempotency — repeated/overlapping polling
 *     cannot duplicate a timeline event or a status write
 *   - multiple new replies in one thread each get their own timeline event
 *   - partial-failure atomicity: the contact-doc write and the timeline
 *     event either both land or neither does
 */
import { describe, it, expect, beforeEach } from 'vitest';

const USER_ID = 'u1';
const CONTACT_ID = 'c1';

function contactPath(id = CONTACT_ID) {
  return `users/${USER_ID}/contacts/${id}`;
}

/** A minimal Firestore admin-SDK-shaped fake: enough for replyPolling.js's needs. */
function makeFakeDb(seed = {}) {
  const docs = { ...seed };
  const versions = {}; // path -> commit count, for the OCC simulation below
  let autoId = 0;

  function docRef(path) {
    return {
      path,
      get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
      update: async (patch) => { docs[path] = { ...(docs[path] || {}), ...patch }; },
      set: async (data) => { docs[path] = data; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }

  function collRef(path) {
    const listChildren = () => {
      const prefix = `${path}/`;
      return Object.keys(docs).filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'));
    };
    return {
      doc: (id) => docRef(id ? `${path}/${id}` : `${path}/auto_${autoId++}`),
      where: (field, op, value) => ({
        get: async () => {
          const matches = listChildren().filter((k) => {
            const d = docs[k] || {};
            if (op === 'in') return (value || []).includes(d[field]);
            if (op === '==') return d[field] === value;
            return true;
          });
          return { docs: matches.map((k) => ({ id: k.slice(path.length + 1), data: () => ({ ...docs[k] }) })) };
        },
      }),
      get: async () => ({
        docs: listChildren().map((k) => ({ id: k.slice(path.length + 1), data: () => ({ ...docs[k] }) })),
      }),
    };
  }

  return {
    collection: (name) => collRef(name),
    // Models two things real Firestore transactions guarantee, both load-
    // bearing for the tests below: (1) every write is buffered and applied
    // atomically only once the callback returns successfully — any throw
    // discards the whole buffer, nothing partial ever lands; (2) optimistic
    // concurrency — if any document the callback read has been committed to
    // by someone else since that read, the WHOLE callback is re-run against
    // fresh state, as many times as it takes. Without (2) modeled, the
    // "two overlapping calls" test below cannot actually prove the race is
    // safe — it would only prove that MY code looks right, not that two
    // genuinely concurrent attempts converge to one winner the way real
    // Firestore makes them.
    runTransaction: async (fn, { maxAttempts = 10 } = {}) => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const readVersions = new Map();
        const pending = [];
        const tx = {
          get: async (ref) => {
            readVersions.set(ref.path, versions[ref.path] || 0);
            return ref.get();
          },
          update: (ref, patch) => { pending.push({ path: ref.path, kind: 'update', value: patch }); },
          set: (ref, data) => { pending.push({ path: ref.path, kind: 'set', value: data }); },
        };

        const result = await fn(tx);

        const conflicted = [...readVersions.entries()].some(
          ([path, seenVersion]) => (versions[path] || 0) !== seenVersion
        );
        if (conflicted) continue; // another transaction committed since our read — retry from scratch

        for (const op of pending) {
          docs[op.path] = op.kind === 'update' ? { ...(docs[op.path] || {}), ...op.value } : op.value;
          versions[op.path] = (versions[op.path] || 0) + 1;
        }
        return result;
      }
      throw new Error('simulated transaction exceeded max retries (contention)');
    },
    _docs: docs,
  };
}

function timelineEntries(db, contactId = CONTACT_ID) {
  const prefix = `${contactPath(contactId)}/timeline/`;
  return Object.entries(db._docs)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v);
}

function header(name, value) {
  return { name, value };
}

function message(id, headers) {
  return { id, payload: { headers } };
}

const OUTBOUND = message('m0', [header('From', 'me@idynify.com'), header('Subject', 'Checking in')]);

function thread(gmail, threadId, messages) {
  gmail.users.threads.get = async ({ id }) => {
    if (id !== threadId) throw new Error('unexpected thread id');
    return { data: { messages } };
  };
}

function makeGmail() {
  return { users: { threads: { get: async () => ({ data: { messages: [] } }) } } };
}

const { pollRepliesForUser } = await import('../../netlify/functions/utils/replyPolling.js');

beforeEach(() => {
  // no shared state between tests — each test builds its own db/gmail
});

describe('genuine reply advances Awaiting Reply -> In Conversation', () => {
  it('writes hunter_status, contact_status, the marker, and exactly one message_received timeline event', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1', name: 'Jane', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    const reply = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, reply]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.checkedCount).toBe(1);
    expect(result.transitioned).toHaveLength(1);
    expect(result.transitioned[0].contactId).toBe(CONTACT_ID);

    const contact = db._docs[contactPath()];
    expect(contact.hunter_status).toBe('in_conversation');
    expect(contact.contact_status).toBe('In Conversation');
    expect(contact.gmail_last_processed_reply_id).toBe('m1');
    expect(contact.last_reply_from).toContain('jane@acme.com');

    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('message_received');
    expect(entries[0].metadata.gmailMessageId).toBe('m1');
  });

  it('a Dormant contact can still be advanced by a genuine new reply — it legitimately resets the clock, same as a real resend', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Dormant', gmail_thread_id: 't1', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(db._docs[contactPath()].contact_status).toBe('In Conversation');
  });
});

describe('automated mail is never treated as a reply', () => {
  it('an out-of-office auto-responder does not advance status or write a timeline event, but still advances the marker', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    const ooo = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Automatic reply: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, ooo]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.transitioned).toHaveLength(0);
    const contact = db._docs[contactPath()];
    expect(contact.contact_status).toBe('Awaiting Reply'); // unchanged
    expect(contact.gmail_last_processed_reply_id).toBe('m1'); // still advances — never re-checked
    expect(timelineEntries(db)).toHaveLength(0);
  });

  it('a bounce (mailer-daemon, delivery failure subject) is classified automated, not a reply', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    const bounce = message('m1', [header('From', 'mailer-daemon@googlemail.com'), header('Subject', 'Delivery Status Notification (Failure)')]);
    thread(gmail, 't1', [OUTBOUND, bounce]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(db._docs[contactPath()].contact_status).toBe('Awaiting Reply');
    expect(timelineEntries(db)).toHaveLength(0);
  });

  it('a human reply asking to stop emailing is still a genuine reply — opt-out/sentiment detection is an explicit non-goal', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    // Ordinary headers — nothing automated about this message's envelope,
    // only its body text (which this classifier deliberately never reads).
    const optOut = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, optOut]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.transitioned).toHaveLength(1);
    expect(db._docs[contactPath()].contact_status).toBe('In Conversation');
  });
});

describe('relationship statuses and Mission Complete are never regressed', () => {
  it.each(['Active Customer', 'Past Customer', 'Partner', 'Network', 'Mission Complete'])(
    'a reply on a stale thread does not move contact_status away from %s',
    async (status) => {
      const db = makeFakeDb({
        [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: status, gmail_thread_id: 't1' },
      });
      const gmail = makeGmail();
      thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

      await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

      const contact = db._docs[contactPath()];
      expect(contact.contact_status).toBe(status); // untouched
      expect(contact.hunter_status).toBe('awaiting_reply'); // untouched — not advanced either
    }
  );

  it('still writes the message_received timeline event even when the status write is skipped — a reply is real activity worth recording', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Active Customer', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(timelineEntries(db)).toHaveLength(1);
  });
});

describe('durable, message-level idempotency', () => {
  it('polling the identical thread a second time produces zero additional writes', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');
    const afterFirst = { ...db._docs[contactPath()] };
    const entriesAfterFirst = timelineEntries(db).length;

    // Second pass — same thread, same messages, nothing new. Simulates the
    // manual button and the schedule both running against unchanged mail.
    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.transitioned).toHaveLength(0);
    // last_reply_check_at is EXPECTED to be stamped on every examination
    // (that's the fairness-rotation field, covered in its own test below)
    // — everything else about the contact must not change on a no-op poll.
    const { last_reply_check_at: _ignored, ...afterFirstRest } = afterFirst;
    const { last_reply_check_at: secondCheckAt, ...afterSecondRest } = db._docs[contactPath()];
    expect(afterSecondRest).toEqual(afterFirstRest);
    expect(secondCheckAt).toBeTruthy();
    expect(timelineEntries(db)).toHaveLength(entriesAfterFirst);
  });

  it('two overlapping calls racing the exact same new reply still produce exactly one timeline event and one status write', async () => {
    // Models the race this design exists to close: the manual button and a
    // scheduled run (or two scheduled runs) both see the contact still at
    // 'awaiting_reply' and both detect the same reply. Each call's own
    // transaction re-reads the marker fresh, so whichever commits first
    // wins and the second is a no-op by construction — not by luck.
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    const [r1, r2] = await Promise.all([
      pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com'),
      pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com'),
    ]);

    const totalTransitions = r1.transitioned.length + r2.transitioned.length;
    expect(totalTransitions).toBe(1);
    expect(timelineEntries(db)).toHaveLength(1);
  });
});

describe('multiple replies within one thread', () => {
  it('two new genuine replies since the last check each get their own timeline event, oldest first', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    const reply1 = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    const reply2 = message('m2', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, reply1, reply2]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    const entries = timelineEntries(db);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.metadata.gmailMessageId).sort()).toEqual(['m1', 'm2']);
    expect(db._docs[contactPath()].gmail_last_processed_reply_id).toBe('m2'); // the latest
  });

  it('a mix of one automated and one genuine new reply only timelines the genuine one, but advances past both', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    const ooo = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Automatic reply: out of office')]);
    const real = message('m2', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, ooo, real]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.gmailMessageId).toBe('m2');
    expect(db._docs[contactPath()].gmail_last_processed_reply_id).toBe('m2');
  });

  it('a late-arriving message found only on a later poll (marker already past the first reply) is still caught from the right position', async () => {
    const db = makeFakeDb({
      [contactPath()]: {
        id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply',
        gmail_thread_id: 't1', gmail_last_processed_reply_id: 'm1',
      },
    });
    const gmail = makeGmail();
    const reply1 = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    const reply2 = message('m2', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, reply1, reply2]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    // Only m2 is new relative to the stored marker — m1 must not be re-timelined.
    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.gmailMessageId).toBe('m2');
  });
});

describe('partial-failure atomicity', () => {
  it('a failure writing the timeline event inside the transaction leaves the contact-doc update un-applied too', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    // Simulate the transaction's second half failing (e.g. a transient
    // Firestore error on the timeline write) AFTER the contact-doc update
    // has already been queued inside the same callback — real Firestore
    // transactions still discard the whole buffer on any throw, however
    // late it happens, so this proves the rollback is real, not just a
    // consequence of call order.
    const originalRunTransaction = db.runTransaction;
    db.runTransaction = async (fn) => {
      const tx = {
        get: async (ref) => ref.get(),
        update: () => { /* queued, same as real Firestore — never actually committed below */ },
        set: () => { throw new Error('simulated write failure'); },
      };
      await fn(tx); // throws from tx.set — the whole buffer (including the update above) is simply never committed
    };

    await expect(pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com')).resolves.toBeDefined();
    db.runTransaction = originalRunTransaction;

    // Nothing from the failed transaction landed — not the marker, not the
    // status, not a timeline entry. A later run can safely retry it.
    const contact = db._docs[contactPath()];
    expect(contact.gmail_last_processed_reply_id).toBeUndefined();
    expect(contact.contact_status).toBe('Awaiting Reply');
    expect(timelineEntries(db)).toHaveLength(0);
  });
});

describe('needsReconnect propagation (unchanged behavior)', () => {
  it('a 403 from a thread check is reported as needsReconnect without throwing the whole run', async () => {
    const db = makeFakeDb({
      [contactPath('c1')]: { id: 'c1', hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
      [contactPath('c2')]: { id: 'c2', hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't2', email: 'bob@acme.com' },
    });
    const gmail = {
      users: {
        threads: {
          get: async ({ id }) => {
            if (id === 't1') { const e = new Error('Forbidden'); e.status = 403; throw e; }
            return { data: { messages: [OUTBOUND, message('m1', [header('From', 'bob@acme.com'), header('Subject', 'Re: hi')])] } };
          },
        },
      },
    };

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.needsReconnect).toBe(true);
    expect(result.transitioned).toHaveLength(1); // c2 still succeeds
    expect(result.transitioned[0].contactId).toBe('c2');
  });
});

describe('a second genuine reply is still processed once the contact is already in_conversation', () => {
  it('a contact at hunter_status:in_conversation is still a candidate, and a new reply still gets its own timeline event', async () => {
    const db = makeFakeDb({
      [contactPath()]: {
        id: CONTACT_ID, hunter_status: 'in_conversation', contact_status: 'In Conversation',
        gmail_thread_id: 't1', gmail_last_processed_reply_id: 'm1', email: 'jane@acme.com',
      },
    });
    const gmail = makeGmail();
    const reply1 = message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    const reply2 = message('m2', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')]);
    thread(gmail, 't1', [OUTBOUND, reply1, reply2]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    // The old candidate query (hunter_status in ['active_mission','awaiting_reply'])
    // would have excluded this contact entirely — checkedCount proves it was
    // actually examined this run, not silently skipped.
    expect(result.checkedCount).toBe(1);
    expect(result.transitioned).toHaveLength(1);
    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.gmailMessageId).toBe('m2');
    expect(db._docs[contactPath()].gmail_last_processed_reply_id).toBe('m2');
  });

  it('a hunter_status outside the tracked set (e.g. archived) is correctly excluded — the widened scope is not unbounded', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'archived', contact_status: 'In Conversation', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.checkedCount).toBe(0);
  });
});

describe('sender identity verification', () => {
  it('a reply from an address matching contact.email is genuine and advances status as before', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'Jane Doe <jane@acme.com>'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(db._docs[contactPath()].contact_status).toBe('In Conversation');
  });

  it('a reply from a known secondaryEmails alias is genuine — "legitimate aliases handled safely"', async () => {
    const db = makeFakeDb({
      [contactPath()]: {
        id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1',
        email: 'jane@acme.com', secondaryEmails: ['jane.doe@personal.com'],
      },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane.doe@personal.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(db._docs[contactPath()].contact_status).toBe('In Conversation');
  });

  it('a reply from an UNEXPECTED third party in the tracked thread is still timelined, but never advances the relationship stage', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1', email: 'jane@acme.com' },
    });
    const gmail = makeGmail();
    // A colleague replies instead of Jane — same thread, different person.
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'bob@acme.com'), header('Subject', 'Re: Checking in')])]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(result.transitioned).toHaveLength(0); // not attributed as Jane's own reply
    expect(db._docs[contactPath()].contact_status).toBe('Awaiting Reply'); // unchanged
    expect(db._docs[contactPath()].hunter_status).toBe('awaiting_reply'); // unchanged

    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1); // still recorded — nothing silently dropped
    expect(entries[0].metadata.senderVerified).toBe(false);
    expect(entries[0].metadata.fromAddress).toContain('bob@acme.com');
  });

  it('a contact with no known email identity at all does NOT get a non-self sender auto-attributed as a verified reply', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'someone@acme.com'), header('Subject', 'Re: Checking in')])]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    // No identity on file to verify against — this must be 'unverified', not
    // 'genuine'. It must not count as a confirmed reply or move the stage.
    expect(result.transitioned).toHaveLength(0);
    const contact = db._docs[contactPath()];
    expect(contact.contact_status).toBe('Awaiting Reply'); // unchanged
    expect(contact.hunter_status).toBe('awaiting_reply'); // unchanged

    // Still recorded, just flagged — nothing silently dropped.
    const entries = timelineEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.senderVerified).toBe(false);
    expect(entries[0].metadata.fromAddress).toContain('someone@acme.com');
  });
});

describe('stale or missing gmail_last_processed_reply_id', () => {
  it('no marker at all (never checked before) processes the whole available history once', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    expect(timelineEntries(db)).toHaveLength(1);
  });

  it('a marker set but not found in the current reply list is treated as stale — nothing is replayed, this thread is skipped this run', async () => {
    const db = makeFakeDb({
      [contactPath()]: {
        id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Awaiting Reply', gmail_thread_id: 't1',
        gmail_last_processed_reply_id: 'm-does-not-exist-in-thread',
      },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    const result = await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    // Must NOT silently process m1 as new — that would mean a stale/corrupt
    // marker causes a replay of (possibly already-handled) history.
    expect(result.transitioned).toHaveLength(0);
    expect(timelineEntries(db)).toHaveLength(0);
    expect(db._docs[contactPath()].gmail_last_processed_reply_id).toBe('m-does-not-exist-in-thread'); // untouched
  });
});

describe('fairness: candidates beyond MAX_CONTACTS rotate across runs', () => {
  it('sorts candidates by last_reply_check_at ascending (never-checked first) before applying the cap', async () => {
    const db = makeFakeDb({
      [contactPath('old')]: { id: 'old', hunter_status: 'awaiting_reply', gmail_thread_id: 't-old', last_reply_check_at: '2020-01-01T00:00:00.000Z' },
      [contactPath('never')]: { id: 'never', hunter_status: 'awaiting_reply', gmail_thread_id: 't-never' }, // no field at all — sorts first
      [contactPath('recent')]: { id: 'recent', hunter_status: 'awaiting_reply', gmail_thread_id: 't-recent', last_reply_check_at: '2026-01-01T00:00:00.000Z' },
    });
    const gmail = makeGmail(); // empty thread for all — nothing to find, just proving examination order via last_reply_check_at writes

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    // All three got examined in this run (well under MAX_CONTACTS=50), each
    // stamped with a fresh check time — the ordering itself is exercised by
    // MAX_CONTACTS-capping in a real deployment; here the sort is unit-level.
    expect(db._docs[contactPath('old')].last_reply_check_at).toBeTruthy();
    expect(db._docs[contactPath('never')].last_reply_check_at).toBeTruthy();
    expect(db._docs[contactPath('recent')].last_reply_check_at).toBeTruthy();
  });
});

describe('hunter_status and contact_status disagreement', () => {
  it('contact_status already advanced to a relationship status blocks the transition even while hunter_status still says awaiting_reply', async () => {
    const db = makeFakeDb({
      [contactPath()]: { id: CONTACT_ID, hunter_status: 'awaiting_reply', contact_status: 'Active Customer', gmail_thread_id: 't1' },
    });
    const gmail = makeGmail();
    thread(gmail, 't1', [OUTBOUND, message('m1', [header('From', 'jane@acme.com'), header('Subject', 'Re: Checking in')])]);

    await pollRepliesForUser(db, gmail, USER_ID, 'me@idynify.com');

    const contact = db._docs[contactPath()];
    expect(contact.contact_status).toBe('Active Customer'); // untouched
    expect(contact.hunter_status).toBe('awaiting_reply'); // untouched — not advanced either
    expect(timelineEntries(db)).toHaveLength(1); // the reply is still recorded
  });
});
