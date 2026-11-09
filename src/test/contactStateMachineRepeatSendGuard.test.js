/**
 * Repeat-send no-op guard: a second real Gmail send to a contact already at
 * Awaiting Reply used to write `contact_status: 'Awaiting Reply'` again and
 * log a `contact_status_changed` timeline entry reading "Awaiting Reply ->
 * Awaiting Reply" — a confusing event implying something happened when
 * nothing did. This was found during the first production smoke test after
 * a bounced send was manually corrected and resent.
 *
 * MESSAGE_SENT must still remain an "always apply" trigger — a real send
 * legitimately resets the waiting clock from any prior status (including
 * from a reply, moving back to Awaiting Reply) — this guard only blocks the
 * exact case where the resolved status is identical to the status already
 * on the document.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map() }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const doc = (_db, ...segments) => ({ path: segments.join('/') });
  const snapOf = (ref) => {
    const data = store.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const getDoc = async (ref) => snapOf(ref);
  const updateDoc = async (ref, data) => {
    const current = store.docs.get(ref.path) ?? {};
    store.docs.set(ref.path, { ...current, ...data });
  };
  const runTransaction = async (_db, fn) => {
    const tx = {
      get: async (ref) => snapOf(ref),
      update: (ref, data) => {
        const current = store.docs.get(ref.path) ?? {};
        store.docs.set(ref.path, { ...current, ...data });
      },
    };
    return fn(tx);
  };
  return { ...real, doc, getDoc, updateDoc, runTransaction };
});
vi.mock('../firebase/config', () => ({ db: {} }));

const loggedEvents = [];
vi.mock('../utils/timelineLogger', () => ({
  logTimelineEvent: (event) => { loggedEvents.push(event); return Promise.resolve({ ok: true, id: 'evt' }); },
  ACTORS: { USER: 'user', BARRY: 'barry', SYSTEM: 'system', CONTACT: 'contact' },
}));

const {
  updateContactStatus, STATUS_TRIGGERS, CONTACT_STATUSES, resetEngagementGuards,
} = await import('../utils/contactStateMachine');

const UID = 'u1';
const path = (id) => `users/${UID}/contacts/${id}`;
const put = (id, data) => store.docs.set(path(id), { id, ...data });
const get = (id) => store.docs.get(path(id));

beforeEach(() => {
  store.docs.clear();
  loggedEvents.length = 0;
  resetEngagementGuards();
});

describe('Repeat MESSAGE_SENT to an already-Awaiting-Reply contact', () => {
  it('writes no contact_status_changed event and leaves contact_status unchanged — the exact "Awaiting Reply -> Awaiting Reply" symptom', async () => {
    put('c1', { contact_status: CONTACT_STATUSES.AWAITING_REPLY });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT,
    });
    expect(result).toBeNull();
    expect(get('c1').contact_status).toBe(CONTACT_STATUSES.AWAITING_REPLY);
    expect(loggedEvents.filter((e) => e.type === 'contact_status_changed')).toHaveLength(0);
  });

  it('still refreshes contact_status_updated_at on the no-op path — it is a genuine resend, and recommendationEngine.js\'s Stalled Engagement Alerts orders Awaiting Reply contacts by this field to decide who is overdue for a follow-up', async () => {
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    put('c1', { contact_status: CONTACT_STATUSES.AWAITING_REPLY, contact_status_updated_at: stale });
    const before = Date.now();
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT,
    });
    expect(result).toBeNull(); // still no status TRANSITION — this assertion is unaffected
    const updatedAt = new Date(get('c1').contact_status_updated_at).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(get('c1').contact_status_updated_at).not.toBe(stale);
  });

  it('a real first send from New still advances to Awaiting Reply and logs exactly one event — the guard only blocks the same-to-same case', async () => {
    put('c1', { contact_status: CONTACT_STATUSES.NEW });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT,
    });
    expect(result).toBe(CONTACT_STATUSES.AWAITING_REPLY);
    expect(get('c1').contact_status).toBe(CONTACT_STATUSES.AWAITING_REPLY);
    expect(loggedEvents.filter((e) => e.type === 'contact_status_changed')).toHaveLength(1);
  });

  it('a send that reaches a contact already past Awaiting Reply (In Conversation) still legitimately resets the waiting clock — not blocked by this guard', async () => {
    put('c1', { contact_status: CONTACT_STATUSES.IN_CONVERSATION });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT,
    });
    expect(result).toBe(CONTACT_STATUSES.AWAITING_REPLY);
    expect(loggedEvents.filter((e) => e.type === 'contact_status_changed')).toHaveLength(1);
  });
});
