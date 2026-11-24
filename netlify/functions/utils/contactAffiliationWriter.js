import { affiliationsForContact, projectPrimaryAffiliation, validateContactAffiliations } from '../../../src/utils/contactAffiliations.js';
import { isWritableContact } from './contactWriteLifecycle.js';
import { Buffer } from 'node:buffer';

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const versionOf = (snap) => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;

export function createContactAffiliationWriter({ db, verifyToken, enabled, timestamp }) {
  return async (event) => {
    if (!enabled()) return json(404, { error: 'unavailable' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
    const bearer = (event.headers?.authorization ?? event.headers?.Authorization ?? '').match(/^Bearer (\S+)$/i)?.[1];
    let actor;
    try { actor = bearer && await verifyToken(bearer); } catch { return json(401, { error: 'sign_in' }); }
    if (!validId(actor?.uid)) return json(401, { error: 'sign_in' });
    if (actor.firebase?.sign_in_provider === 'custom') return json(403, { error: 'read_only' });
    let input;
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 64 * 1024) throw new Error();
      input = JSON.parse(event.body);
    } catch { return json(400, { error: 'invalid_affiliations' }); }
    if (!exact(input, ['uid', 'contactId', 'expectedVersion', 'affiliations'])) return json(400, { error: 'invalid_affiliations' });
    if (input.uid !== actor.uid) return json(403, { error: 'read_only' });
    if (!validId(input.contactId)
      || !(input.expectedVersion === null || (typeof input.expectedVersion === 'string' && /^\d{1,12}:\d{1,9}$/.test(input.expectedVersion)))
      || !validateContactAffiliations(input.affiliations).ok) return json(400, { error: 'invalid_affiliations' });

    const owner = db.doc(`users/${actor.uid}`);
    const contact = owner.collection('contacts').doc(input.contactId);
    const sessions = db.collection('impersonationSessions').where('adminUserId', '==', actor.uid).where('status', '==', 'active');
    try {
      const result = await db.runTransaction(async (tx) => {
        const [account, person, active] = await Promise.all([tx.get(owner), tx.get(contact), tx.get(sessions)]);
        if (!account.exists || active.docs.some((row) => {
          const expires = row.data().expiresAt?.toMillis?.();
          return !Number.isFinite(expires) || expires > Date.now();
        })) throw Object.assign(new Error('read_only'), { status: 403 });
        if (!person.exists || !isWritableContact(person)) throw Object.assign(new Error('contact_unavailable'), { status: 409 });
        if (versionOf(person) !== input.expectedVersion) throw Object.assign(new Error('contact_changed'), { status: 409 });
        const old = affiliationsForContact({ ...person.data(), id: person.id });
        const oldById = new Map(old.map((row) => [row.id, row]));
        const affiliations = input.affiliations.map((row) => {
          const previous = oldById.get(row.id);
          const changed = previous && ['organization_name', 'company_id', 'title', 'type', 'status']
            .some((key) => (previous[key] ?? null) !== (row[key] ?? null));
          const provenance = previous
            ? [...(previous.provenance ?? []), ...(changed && !previous.provenance?.some((source) => source.source === 'user' && source.contact_id === input.contactId)
              ? [{ source: 'user', contact_id: input.contactId }] : [])]
            : [{ source: 'user', contact_id: input.contactId }];
          return { ...row, organization_name: row.organization_name?.trim() || null,
            company_id: row.company_id?.trim() || null, title: row.title?.trim() || null,
            type: row.type?.trim() || null, provenance };
        });
        if (!validateContactAffiliations(affiliations).ok) throw Object.assign(new Error('invalid_affiliations'), { status: 400 });
        const projection = projectPrimaryAffiliation(affiliations);
        tx.update(contact, { contact_affiliations: affiliations, ...projection, updated_at: timestamp() });
        return affiliations;
      });
      return json(200, { status: 'saved', affiliations: result });
    } catch (error) { return json(error.status ?? 503, { error: error.message ?? 'unavailable' }); }
  };
}
