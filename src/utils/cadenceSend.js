/**
 * cadenceSend — shared rules for the bulk cadence send (BulkComposeModal).
 *
 * Kept out of the component file so the modal, the Scout+ import hand-off
 * and the tests all read one definition.
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Recipients per send. The send loop is sequential with a 1.5s gap, so 100 is
 * about three minutes in an open tab — the practical ceiling for a browser-run
 * send. Personalization is still requested PERSONALIZE_CHUNK at a time, because
 * barryBulkPersonalize caps each request at 25; the user sees one operation.
 */
export const MAX_BULK_CONTACTS = 100;
export const PERSONALIZE_CHUNK = 25;

/**
 * People who already received the cadence named `cadenceName`, from every
 * cadence doc with that name.
 *
 * Each send writes its own cadence doc, so "this cadence" is identified by its
 * name — which is what the user picks when they reuse one. A contact counts as
 * delivered when its row says sent/opened, or when the send loop recorded it
 * in `deliveredContactIds` (which survives a send interrupted before its
 * completion write). One equality query; no composite index needed.
 */
export async function loadAlreadyDelivered(userId, cadenceName) {
  const name = (cadenceName || '').trim();
  if (!userId || !name) return new Set();
  const snap = await getDocs(query(collection(db, 'users', userId, 'cadences'), where('name', '==', name)));
  const ids = new Set();
  snap.docs.forEach((d) => {
    const c = d.data();
    (c.deliveredContactIds || []).forEach((id) => ids.add(id));
    (c.contacts || []).forEach((ct) => {
      if (ct?.contactId && (ct.status === 'sent' || ct.status === 'opened')) ids.add(ct.contactId);
    });
  });
  return ids;
}

/**
 * The message a cadence was composed from, for reuse with new recipients.
 *
 * Cadences sent from here on store `templateSubject` / `templateBody`. Older
 * cadence docs only carry `subject` / `body` — the FIRST recipient's rendered
 * email, beginning "Hi <name>," (and, when Barry personalized it, that
 * person's opening line). The greeting is stripped so it is not sent to
 * everyone twice; anything else is returned as-is and flagged `legacy` so the
 * UI can ask the user to check it before sending.
 */
export function cadenceTemplate(cadence = {}) {
  if (cadence.templateBody != null || cadence.templateSubject != null) {
    return {
      subject: cadence.templateSubject || '',
      body: cadence.templateBody || '',
      path: cadence.path || 'write_your_own',
      personalize: cadence.personalizedWithBarry !== false,
      cc: cadence.cc || '',
      hasAttachment: Boolean(cadence.hasAttachment),
      legacy: false,
    };
  }
  const body = String(cadence.body || '').replace(/^Hi [^\n]*,\s*\n+/, '');
  return {
    subject: cadence.subject || '',
    body,
    path: cadence.path || 'write_your_own',
    personalize: cadence.personalizedWithBarry !== false,
    cc: cadence.cc || '',
    hasAttachment: false,
    legacy: true,
  };
}

/** A Firestore Timestamp, Date, ISO string or millis → millis (0 when absent). */
function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Cadences newest first, by completion time and, for a send that never
 * completed, its start time — so an interrupted send sorts where it began
 * instead of disappearing.
 */
export function sortCadencesByRecency(cadences = []) {
  const at = (c) => millis(c.completedAt) || millis(c.lastSentAt) || millis(c.createdAt);
  return [...cadences].sort((a, b) => at(b) - at(a));
}

/**
 * Existing cadences to offer for reuse, newest first, one per name.
 *
 * Every send writes its own cadence doc, so a cadence sent three times appears
 * three times in the collection. The picker shows each name once, using its
 * most recent send as the template.
 */
export function distinctCadencesForReuse(cadences = []) {
  const byName = new Map();
  for (const c of [...cadences].sort((a, b) => millis(b.createdAt ?? b.completedAt) - millis(a.createdAt ?? a.completedAt))) {
    const name = (c.name || '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, c);
  }
  return [...byName.values()];
}
