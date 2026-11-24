import { isWritableContact } from './contactWriteLifecycle.js';
import { deletedContactRef } from './contactWriteLifecycle.js';
import { deleteContactWithPhoto } from './contactPhotoWriter.js';

const MAX_CONTACTS = 20;
const MAX_RELATED = 400;
const CHILDREN = ['timeline', 'stageHistory', 'outcomeLog', 'barry_attributions', 'barry_drafts', 'barry_analysis', 'relationship_context', 'barry_sessions'];
const validId = (value) => typeof value === 'string' && value.length <= 1500
  && value !== '.' && value !== '..' && /^[^/\s]+$/.test(value);
const reply = (statusCode, payload) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

export function createContactHubDelete({ db, verifyToken, enabled = () => true, now = Date.now }) {
  return async function handler(event) {
    if (!enabled()) return reply(404, { error: 'unavailable' });
    if (event.httpMethod !== 'POST') return reply(405, { error: 'method' });
    const bearer = (event.headers?.authorization ?? event.headers?.Authorization ?? '').match(/^Bearer (\S+)$/i)?.[1];
    const actor = await (bearer ? Promise.resolve().then(() => verifyToken(bearer)).catch(() => null) : null);
    if (!validId(actor?.uid)) return reply(401, { error: 'sign_in' });
    if (actor.firebase?.sign_in_provider === 'custom') return reply(403, { error: 'read_only' });

    let input;
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || event.body.length > 40_000) throw new Error();
      input = JSON.parse(event.body);
    } catch { return reply(400, { error: 'invalid_selection' }); }
    if (input?.uid !== actor.uid) return reply(403, { error: 'read_only' });
    const ids = input.contactIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_CONTACTS
      || !ids.every(validId) || new Set(ids).size !== ids.length) return reply(400, { error: 'invalid_selection' });

    const owner = db.doc(`users/${actor.uid}`);
    const sessions = db.collection('impersonationSessions')
      .where('adminUserId', '==', actor.uid).where('status', '==', 'active');
    const results = [];
    for (const id of ids) {
      const contact = owner.collection('contacts').doc(id);
      let status;
      try {
        status = await db.runTransaction(async (tx) => {
          const [account, person, active] = await Promise.all([tx.get(owner), tx.get(contact), tx.get(sessions)]);
          if (active.docs.some((entry) => {
            const expiry = entry.data().expiresAt?.toMillis?.();
            return !Number.isFinite(expiry) || expiry > now();
          })) return 'read_only';
          if (person.exists && !isWritableContact(person)) return 'contact_retired';
          if (!account.exists) return 'account_unavailable';
          const queries = CHILDREN.map((name) => contact.collection(name));
          queries.push(owner.collection('nbs_queue').where('contact_id', '==', id));
          const related = (await Promise.all(queries.map((query) => tx.get(query.limit(MAX_RELATED + 1)))))
            .flatMap((snapshot) => snapshot.docs);
          if (related.length > MAX_RELATED) return 'too_many_related_records';
          for (const entry of related) tx.delete(entry.ref);
          if (person.exists) tx.set(deletedContactRef(db, actor.uid, id), { deleted: true });
          deleteContactWithPhoto(tx, contact);
          return person.exists ? 'deleted' : 'already_deleted';
        });
      } catch {
        status = 'retry';
      }
      results.push({ id, status });
    }
    return reply(200, { results });
  };
}
