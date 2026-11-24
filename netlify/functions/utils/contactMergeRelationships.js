import { inspectPhotoDataUrl } from '../../../src/utils/photoPrep.js';
import { isHttpsPhotoUrl } from '../../../src/utils/photoUrl.js';
import { isPlaceholderPhoto } from '../../../src/utils/contactPhoto.js';

const terminal = new Set(['completed', 'dismissed']);
const manual = (step) => step?.metadata?.source === 'contact_hub' && step.type === 'follow_up'
  && typeof step.id === 'string' && /^[\w-]{1,150}$/.test(step.id)
  && typeof step.action === 'string' && Number.isFinite(Date.parse(step.due_at));
const validPhoto = (value) => value?.updatedAt?.toMillis && (
  value.kind === 'hidden' && Object.keys(value).length === 2
  || value.kind === 'url' && Object.keys(value).length === 3 && isHttpsPhotoUrl(value.url) && !isPlaceholderPhoto(value.url)
  || value.kind === 'upload' && Object.keys(value).length === 3 && inspectPhotoDataUrl(value.jpeg).ok
);
const marker = (value) => value?.kind === 'hidden' ? 'hidden' : value ? 'custom' : undefined;

export async function readMergeRelationships(tx, db, uid, contacts) {
  return Promise.all(contacts.map(async (contact) => {
    const [photo, privateDocs, queue] = await Promise.all([
      tx.get(contact.collection('private').doc('photo')),
      tx.get(contact.collection('private').limit(2)),
      tx.get(db.collection(`users/${uid}/nbs_queue`).where('contact_id', '==', contact.id).limit(51)),
    ]);
    return { photo, privateDocs, queue };
  }));
}

export function planMergeRelationships({ current, related, merged, choose, blockers, canonical, now, survivorId }) {
  const writes = [];
  const photos = related.map(({ photo }) => photo.data());
  related.forEach(({ privateDocs, queue }, index) => {
    if (privateDocs.docs.some((row) => row.id !== 'photo') || (photos[index] && !validPhoto(photos[index]))
      || marker(photos[index]) !== current[index].contact_hub_photo) blockers.add('private_photo_requires_transfer');
    if (queue.docs.length >= 51) blockers.add('reminder_requires_transfer');
  });

  if (photos.some(Boolean)) {
    const options = [];
    current.forEach((contact, index) => {
      const origin = index === 0 ? 'Survivor' : 'Source';
      if (photos[index]) options.push({ title: `${origin}: ${photos[index].kind === 'hidden' ? 'keep hidden' : 'private ' + photos[index].kind}`, photo: photos[index], index });
      if (!isPlaceholderPhoto(contact.photo_url)) options.push({ title: `${origin}: original photo`, index });
    });
    const picked = choose('photo_display', options.map(({ title }) => title));
    const selection = options.find(({ title }) => title === picked);
    if (selection) {
      const original = current[selection.index];
      merged.photo_url = original.photo_url ?? null;
      merged.photo_source = original.photo_source ?? null;
      if (selection.photo) merged.contact_hub_photo = marker(selection.photo);
      else delete merged.contact_hub_photo;
      const ref = related[0].photo.ref;
      writes.push({ ref, before: photos[0] ?? null, after: selection.photo ?? null });
    }
  }

  const active = current.map((contact, index) => ({ step: contact.next_best_step, index })).filter(({ step }) => step);
  for (const { step, index } of active) {
    const contact = current[index];
    const queue = related[index].queue.docs.find((row) => row.id === step.id);
    if (!manual(step) || step.status !== 'confirmed' || step.user_confirmed !== true
      || contact.next_step_due !== step.due_at || contact.next_step_type !== 'follow_up'
      || !queue || queue.data().status !== 'confirmed' || queue.data().due_at !== step.due_at
      || canonical(queue.data().nbs) !== canonical(step)) blockers.add('reminder_requires_transfer');
  }
  if (current.some((contact) => !contact.next_best_step && (contact.next_step_due || contact.next_step_type))) blockers.add('reminder_requires_transfer');
  const history = current.flatMap((contact) => Array.isArray(contact.next_best_step_history) ? contact.next_best_step_history : []);
  if (history.some((step) => !manual(step) || !terminal.has(step.status))) blockers.add('reminder_requires_transfer');
  const selected = choose('active_reminder', active.map(({ step, index }) => `${index === 0 ? 'Survivor' : 'Source'}: ${step.action} · ${step.due_at}`));
  const winner = active.find(({ step, index }) => selected === `${index === 0 ? 'Survivor' : 'Source'}: ${step.action} · ${step.due_at}`);
  if (winner) {
    merged.next_best_step = winner.step;
    merged.next_step_due = winner.step.due_at;
    merged.next_step_type = winner.step.type;
  }

  for (const [index, entry] of related.entries()) {
    for (const row of entry.queue.docs) {
      const before = row.data();
      if (!manual(before.nbs) || before.nbs.id !== row.id || before.due_at !== before.nbs.due_at
        || (before.status !== 'confirmed' && !terminal.has(before.status))
        || (terminal.has(before.status) && before.nbs.status !== before.status)
        || (before.status === 'confirmed' && current[index].next_best_step?.id !== row.id)) {
        blockers.add('reminder_requires_transfer');
        continue;
      }
      if (before.status === 'confirmed' && !winner) continue;
      const after = { ...before, contact_id: survivorId, contact_name: merged.name ?? '' };
      if (before.status === 'confirmed' && row.id !== winner.step.id) {
        after.status = 'dismissed';
        after.nbs = { ...before.nbs, status: 'dismissed', dismissed_at: new Date(now()).toISOString(), disposition: 'superseded_by_merge' };
        history.push(after.nbs);
      }
      writes.push({ ref: row.ref, before, after });
    }
  }
  if (history.length) merged.next_best_step_history = [...new Map(history.map((step) => [canonical(step), step])).values()];
  return { writes, photos };
}
