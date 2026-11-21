import { collection, doc, onSnapshot, orderBy, limit, query, runTransaction, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { ACTORS, logTimelineEvent } from '../../../utils/timelineLogger';
import { activeStep, canWriteRelationship, INTERACTIONS, isManualStep, stepVersion } from './relationship';

const contactRef = (uid, id) => doc(db, 'users', uid, 'contacts', id);
const timeline = (uid, id) => collection(db, 'users', uid, 'contacts', id, 'timeline');

function assertWritable(uid) {
  if (!canWriteRelationship(uid)) throw new Error('read_only');
}

export function watchRelationship(uid, contactId, next, fail) {
  return onSnapshot(query(timeline(uid, contactId), orderBy('createdAt', 'desc'), limit(50)),
    (snapshot) => next(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))), fail);
}

export async function saveInteraction(uid, contactId, channel, text, id, occurredAt) {
  assertWritable(uid);
  if (!Object.hasOwn(INTERACTIONS, channel) || !text.trim()) throw new Error('invalid_interaction');
  const result = await logTimelineEvent({
    userId: uid, contactId, type: 'outreach_logged', actor: ACTORS.USER,
    preview: text.trim(), metadata: { channel, ...(occurredAt ? { occurred_at: occurredAt } : {}) }, eventId: id,
  });
  if (!result.ok) throw new Error(result.reason);
}

export function saveRelationshipReminder(uid, contactId, { expected, id, text, due, done, dismiss }) {
  assertWritable(uid);
  const person = contactRef(uid, contactId);
  const event = doc(db, 'users', uid, 'contacts', contactId, 'timeline', id);
  const now = Timestamp.now();
  const iso = now.toDate().toISOString();
  const terminal = done || dismiss;
  const status = done ? 'completed' : 'dismissed';
  if (!terminal && (!text.trim() || !Number.isFinite(Date.parse(due)))) throw new Error('invalid_reminder');
  return runTransaction(db, async (tx) => {
    assertWritable(uid);
    const snapshot = await tx.get(person);
    const priorEvent = await tx.get(event);
    if (!snapshot.exists()) throw new Error('missing_contact');
    const contact = snapshot.data();
    const current = {
      next_best_step: contact.next_best_step ?? null,
      next_step_due: contact.next_step_due ?? null,
      next_step_type: contact.next_step_type ?? null,
    };
    if (priorEvent.exists()) return current;
    const previous = activeStep(contact);
    if (stepVersion(previous) !== expected) throw Object.assign(new Error('step_changed'), { current });
    if ((previous && !isManualStep(previous)) || (terminal && !previous)) throw new Error('legacy_step');
    const step = terminal ? null : {
      id: previous?.id ?? id,
      type: 'follow_up',
      action: text.trim(),
      due_at: due,
      status: 'confirmed',
      user_confirmed: true,
      proposed_at: previous?.proposed_at ?? iso,
      confirmed_at: previous?.confirmed_at ?? iso,
      metadata: { source: 'contact_hub' },
    };
    const queue = doc(db, 'users', uid, 'nbs_queue', previous?.id ?? id);
    const patch = { next_best_step: step, next_step_due: step?.due_at ?? null, next_step_type: step?.type ?? null };
    const history = Array.isArray(contact.next_best_step_history) ? contact.next_best_step_history : [];
    assertWritable(uid);
    const finished = terminal ? { ...previous, status, [done ? 'completed_at' : 'dismissed_at']: iso } : null;
    tx.update(person, terminal ? {
      ...patch, next_best_step_history: [...history, finished],
    } : patch);
    tx.set(queue, {
      contact_id: contactId,
      contact_name: contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      nbs: step ?? finished,
      status: terminal ? status : 'confirmed',
      due_at: step?.due_at ?? previous.due_at,
      created_at: previous?.proposed_at ?? iso,
    });
    tx.set(event, {
      type: done ? 'next_step_completed' : dismiss ? 'next_step_dismissed' : previous ? 'next_step_confirmed' : 'next_step_queued',
      actor: ACTORS.USER,
      timestamp: now,
      createdAt: now,
      preview: step?.action ?? previous.action,
      metadata: { due_at: step?.due_at ?? previous.due_at, nbs_type: 'follow_up', queue_id: previous?.id ?? id },
    });
    return patch;
  });
}

export function changeRelationshipNote(uid, contactId, note, content) {
  assertWritable(uid);
  const ref = contactRef(uid, contactId);
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    const notes = snapshot.data()?.notes;
    const existing = Array.isArray(notes) && notes.find((entry) => entry.id === note.id);
    if (!existing || existing.content !== note.content || existing.updated_at !== note.updated_at) {
      throw new Error('note_changed');
    }
    assertWritable(uid);
    const next = content === null ? notes.filter((entry) => entry.id !== note.id)
      : notes.map((entry) => entry.id === note.id ? { ...entry, content, updated_at: new Date().toISOString() } : entry);
    tx.update(ref, { notes: next });
    return next.find((entry) => entry.id === note.id);
  });
}
