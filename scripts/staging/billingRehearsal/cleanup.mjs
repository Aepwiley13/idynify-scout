/**
 * BILLING REHEARSAL — finding and deleting a run's documents.
 *
 * A run's documents are found by ENUMERATION, never by scanning or wiping a collection: every
 * id a run can create is derived from the run id (fixtures.mjs: SLOTS × EVENT_LABELS), and the
 * review-queue records, whose ids are random, are found by an equality query on a run's own
 * uids. Every document then passes assertRehearsalDocPath() immediately before it is deleted.
 * A document that is not provably this run's is never read for deletion, let alone deleted.
 */
import { assertRehearsalDocPath, assertRunId } from './guard.mjs';
import { SLOTS, EVENT_LABELS, idsFor } from './fixtures.mjs';

/** Every document of this run that currently exists: [{ ref, path, data }]. Read-only. */
export async function findRunDocs(db, runId) {
  assertRunId(runId);
  const ids = idsFor(runId);
  const found = [];
  const add = (snap) => {
    if (snap.exists) found.push({ ref: snap.ref, path: snap.ref.path, data: snap.data() });
  };

  for (const slot of SLOTS) {
    add(await db.collection('users').doc(ids.uid(slot)).get());
    add(await db.collection('billingAllocations').doc(ids.subscription(slot)).get());
    for (const label of EVENT_LABELS) {
      add(await db.collection('stripeWebhookEvents').doc(ids.event(slot, label)).get());
    }
    const parked = await db.collection('stripeWebhookPendingEvents').doc(ids.customer(slot)).collection('events').get();
    parked.docs.forEach(add);
    const flagged = await db.collection('billingAmbiguousAccounts').where('uid', '==', ids.uid(slot)).get();
    flagged.docs.forEach(add);
  }
  return found;
}

/**
 * Deletes this run's documents. With dryRun, deletes nothing and reports what it would delete.
 * Returns { deleted: [paths], wouldDelete: [paths], remaining: number }.
 */
export async function deleteRunDocs(db, runId, { dryRun = false } = {}) {
  const docs = await findRunDocs(db, runId);
  // Check every path BEFORE the first delete: one unexpected document stops the whole clean-up.
  for (const doc of docs) assertRehearsalDocPath(doc.path, runId, { data: doc.data });
  const paths = docs.map((d) => d.path).sort();
  if (dryRun) return { deleted: [], wouldDelete: paths, remaining: docs.length };

  for (const doc of docs) {
    assertRehearsalDocPath(doc.path, runId, { data: doc.data });
    await doc.ref.delete();
  }
  const remaining = (await findRunDocs(db, runId)).length;
  return { deleted: paths, wouldDelete: [], remaining };
}
