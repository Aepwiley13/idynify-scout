import { getEffectiveUser } from '../../../context/ImpersonationContext';

export const INTERACTIONS = { call: 'Call', meeting: 'Meeting', text: 'Text', other: 'Other' };

export function canWriteRelationship(uid) {
  const user = getEffectiveUser();
  return Boolean(uid && user?.uid === uid && !user._isImpersonated);
}

export function activeStep(contact) {
  const step = contact.next_best_step;
  if (step && !['completed', 'dismissed', 'superseded'].includes(step.status)) return step;
  if (!step && contact.next_step_due) return { due_at: contact.next_step_due };
  return null;
}

export const isManualStep = (step) => Boolean(step?.id && step.metadata?.source === 'contact_hub');
export const stepVersion = (step) => step
  ? JSON.stringify([step.id, step.status, step.action, step.due_at, step.metadata?.source])
  : null;

function milliseconds(value) {
  return value?.toMillis?.() ?? Date.parse(value);
}

export function relationshipHistory(notes, events) {
  const rows = [];
  const noteIds = new Set();
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note?.id || !note.content || noteIds.has(note.id)) continue;
    noteIds.add(note.id);
    rows.push({ id: 'note:' + note.id, label: 'Note', note, text: note.content, time: milliseconds(note.created_at) });
  }
  const eventIds = new Set();
  for (const event of events) {
    if (eventIds.has(event.id) || /^note_(added|edited|deleted)$/.test(event.type)) continue;
    eventIds.add(event.id);
    const isEmail = event.metadata?.channel === 'email' || ['email_opened', 'message_received', 'reply_sent'].includes(event.type);
    const label = event.type === 'outreach_logged'
      ? INTERACTIONS[event.metadata?.channel] ?? 'Interaction'
      : ({
          next_step_queued: 'Reminder set', next_step_confirmed: 'Reminder updated',
          next_step_completed: 'Reminder completed', message_sent: 'Message sent',
          message_received: 'Message received', reply_received: 'Reply received',
        })[event.type] ?? event.type?.replaceAll('_', ' ');
    if (label) rows.push({ id: 'event:' + event.id, label, text: event.preview, time: milliseconds(event.metadata?.occurred_at ?? event.timestamp ?? event.createdAt), isEmail });
  }
  return rows.sort((a, b) => (b.time || 0) - (a.time || 0));
}
