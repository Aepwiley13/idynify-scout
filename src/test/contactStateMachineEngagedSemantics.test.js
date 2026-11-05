/**
 * Engaged semantics correction: opening an engagement composer, creating a
 * mission, planning outreach, or moving a workflow stage must never mark a
 * contact Engaged. Engaged requires a confirmed outbound/inbound
 * interaction, or one explicitly logged after the fact.
 *
 * This file covers the core state-machine changes directly:
 *   - ENGAGE_CLICKED no longer exists as a trigger at all
 *   - MANUAL_INTERACTION_LOGGED -> Engaged, priority-respecting (can't
 *     regress a contact already further along)
 *   - MESSAGE_SENT / POSITIVE_REPLY are unaffected — still always apply
 *   - the new idempotency guard, including the deterministic repro for
 *     the exact "fired twice" symptom this correction exists to prevent
 *   - record_status promotion still fires for an Engaged-producing
 *     transition, unaffected by which trigger produces it
 *
 * Per-surface coverage (InlineEngagementSection, HunterContactDrawer,
 * FollowUpCard, PersistentEngageBar, barryPipelineAction, barryLink) is in
 * their own files — this one is the shared machinery all of them call into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map() }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const doc = (_db, ...segments) => ({ path: segments.join('/') });
  const getDoc = async (ref) => {
    const data = store.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const updateDoc = async (ref, data) => {
    const current = store.docs.get(ref.path) ?? {};
    store.docs.set(ref.path, { ...current, ...data });
  };
  return { ...real, doc, getDoc, updateDoc };
});
vi.mock('../firebase/config', () => ({ db: {} }));

const loggedEvents = [];
vi.mock('../utils/timelineLogger', () => ({
  logTimelineEvent: (event) => { loggedEvents.push(event); return Promise.resolve({ ok: true, id: 'evt' }); },
  ACTORS: { USER: 'user', BARRY: 'barry', SYSTEM: 'system', CONTACT: 'contact' },
}));

const {
  updateContactStatus, resolveTransition, STATUS_TRIGGERS, CONTACT_STATUSES,
  withEngagementGuard, engagementGuardKey, resetEngagementGuards,
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

describe('ENGAGE_CLICKED no longer exists as a status trigger', () => {
  it('STATUS_TRIGGERS has no ENGAGE_CLICKED constant', () => {
    expect(STATUS_TRIGGERS.ENGAGE_CLICKED).toBeUndefined();
  });

  it('the literal "engage_clicked" string resolves to no transition at all — a stray caller becomes a no-op, not an error', () => {
    expect(resolveTransition(CONTACT_STATUSES.NEW, 'engage_clicked')).toBeNull();
  });

  it('calling updateContactStatus with the literal string writes nothing and logs nothing', async () => {
    put('c1', { contact_status: 'New' });
    const result = await updateContactStatus({ userId: UID, contactId: 'c1', trigger: 'engage_clicked', currentStatus: 'New' });
    expect(result).toBeNull();
    expect(get('c1').contact_status).toBe('New');
    expect(loggedEvents).toHaveLength(0);
  });
});

describe('MANUAL_INTERACTION_LOGGED -> Engaged, priority-respecting', () => {
  it('advances a New contact to Engaged', async () => {
    put('c1', { contact_status: 'New' });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New',
    });
    expect(result).toBe('Engaged');
    expect(get('c1').contact_status).toBe('Engaged');
  });

  it('does NOT regress a contact already at Awaiting Reply', async () => {
    put('c1', { contact_status: 'Awaiting Reply' });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'Awaiting Reply',
    });
    expect(result).toBeNull();
    expect(get('c1').contact_status).toBe('Awaiting Reply');
  });

  it('does NOT regress a contact already at In Conversation', async () => {
    put('c1', { contact_status: 'In Conversation' });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'In Conversation',
    });
    expect(result).toBeNull();
  });

  it('promotes record_status out of suggested, same as any other Engaged-producing transition — this dimension is unaffected by which trigger produces Engaged', async () => {
    put('c1', { contact_status: 'New', status: 'suggested', record_status: 'suggested' });
    await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New',
    });
    expect(get('c1').record_status).toBe('active');
  });
});

describe('Confirmed send and reply triggers: byte-for-byte unaffected', () => {
  it('MESSAGE_SENT still advances from any status, including past Engaged — a real new send legitimately resets the waiting clock', async () => {
    put('c1', { contact_status: 'In Conversation' });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT, currentStatus: 'In Conversation',
    });
    expect(result).toBe('Awaiting Reply');
  });

  it('POSITIVE_REPLY still advances straight from New — a real reply never needed Engaged as a waypoint, before or after this change', async () => {
    put('c1', { contact_status: 'New' });
    const result = await updateContactStatus({
      userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.POSITIVE_REPLY, currentStatus: 'New',
    });
    expect(result).toBe('In Conversation');
  });
});

describe('Idempotency guard', () => {
  it('the deterministic repro: two overlapping calls for the SAME contact+trigger produce exactly one write and one timeline event, not two', async () => {
    put('c1', { contact_status: 'New' });
    // Both start before either resolves — the guard, not timing, decides
    // which one proceeds. This is the exact shape of the "fired twice"
    // symptom (a remounted composer re-claiming before the first write
    // has propagated back) this correction exists to prevent.
    const [r1, r2] = await Promise.all([
      updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New' }),
      updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New' }),
    ]);
    const succeeded = [r1, r2].filter((r) => r !== null);
    expect(succeeded).toHaveLength(1);
    expect(loggedEvents.filter((e) => e.type === 'contact_status_changed')).toHaveLength(1);
  });

  it('a later, non-overlapping call for the same contact+trigger is NOT blocked — only an overlapping one is', async () => {
    put('c1', { contact_status: 'New' });
    const first = await updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New' });
    expect(first).toBe('Engaged');
    // The guard releases once the first call resolves — a second, later
    // call isn't a race, it's a real second instance of the same trigger.
    // (Priority correctly makes it a no-op here since Engaged doesn't
    // advance further, but the GUARD itself must not be what blocks it.)
    const second = await updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'Engaged' });
    expect(second).toBeNull(); // priority, not the guard
  });

  it('two DIFFERENT triggers for the same contact both proceed — not deduped against each other', async () => {
    put('c1', { contact_status: 'New' });
    const [manual, sent] = await Promise.all([
      updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED, currentStatus: 'New' }),
      updateContactStatus({ userId: UID, contactId: 'c1', trigger: STATUS_TRIGGERS.MESSAGE_SENT, currentStatus: 'New' }),
    ]);
    expect(manual).toBe('Engaged');
    expect(sent).toBe('Awaiting Reply');
  });

  it('withEngagementGuard: a duplicate call while the first is still in flight resolves to null immediately, not queued behind it', async () => {
    let release;
    const first = withEngagementGuard('k1', () => new Promise((r) => { release = r; }));
    const second = withEngagementGuard('k1', async () => 'should-not-run');
    expect(await second).toBeNull();
    release('done');
    expect(await first).toBe('done');
  });

  it('withEngagementGuard: once the first call releases its key, a later call with the same key is free to run', async () => {
    await withEngagementGuard('k2', async () => 'first');
    const second = await withEngagementGuard('k2', async () => 'second');
    expect(second).toBe('second');
  });

  it('engagementGuardKey distinguishes by trigger, not just by contact', () => {
    expect(engagementGuardKey('u1', 'c1', 'message_sent')).not.toBe(engagementGuardKey('u1', 'c1', 'manual_interaction_logged'));
    expect(engagementGuardKey('u1', 'c1', 'message_sent')).toBe(engagementGuardKey('u1', 'c1', 'message_sent'));
  });
});
