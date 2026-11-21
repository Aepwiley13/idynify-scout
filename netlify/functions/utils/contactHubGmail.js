import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hasArchiveSignal, isDeferredRecord } from '../../../src/constants/statusModel.js';
import { emailOf } from '../../../src/utils/savedContactEmail.js';

const SEND_SOURCE = 'contact_hub_manual';
const COOKIE = '__Host-contact_hub_gmail';
const OAUTH_AGE = 600_000;
const MAX_PER_MINUTE = 5;
const MAX_PER_DAY = 30;
// Firestore document segments cannot contain slashes or control characters.
// eslint-disable-next-line no-control-regex
const ID = /^[^/\u0000-\u001f]{1,1500}$/;
const KEY = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SECRET = /^[\w-]{43}$/;
const GMAIL_ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && ID.test(value) && value !== '.' && value !== '..';
const fail = (http, code) => Object.assign(new Error(code), { http, code });
const cookie = (value, age) => `${COOKIE}=${value}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Lax`;
const json = (statusCode, body, fields = {}) => ({
  statusCode, body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...fields },
});
const redirect = (location) => ({
  statusCode: 303, body: '',
  headers: { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': cookie('', 0), 'Referrer-Policy': 'no-referrer' },
});
const pathFor = (id) => `/contact-hub/person/${encodeURIComponent(id)}?compose=email`;
const publicState = (entry) => ({ status: entry.status, ...(entry.reason ? { reason: entry.reason } : {}) });

export function createContactHubGmail({ db, verifyToken, gmail, enabled, timestamp, now = Date.now }) {
  const refs = (uid, id) => ({
    owner: db.doc(`users/${uid}`),
    contact: db.doc(`users/${uid}/contacts/${id}`),
    privateConnection: db.doc(`contact_hub_gmail/${uid}`),
    existingConnection: db.doc(`users/${uid}/integrations/gmail`),
    sessions: db.collection('impersonationSessions').where('adminUserId', '==', uid).where('status', '==', 'active'),
  });

  async function checkOwner(tx, refs) {
    const [owner, contact, sessions] = await Promise.all([tx.get(refs.owner), tx.get(refs.contact), tx.get(refs.sessions)]);
    if (sessions.docs.some((record) => {
      const expiry = record.data().expiresAt?.toMillis?.();
      return !Number.isFinite(expiry) || expiry > now();
    })) throw fail(403, 'read_only');
    if (!owner.exists || !contact.exists) throw fail(404, 'contact_unavailable');
    const person = contact.data();
    if (hasArchiveSignal(person) || isDeferredRecord(person) || person.company_archived === true) throw fail(404, 'contact_unavailable');
    const recipient = emailOf(person)?.address;
    if (!recipient || !GMAIL_ADDRESS.test(recipient)) throw fail(422, 'missing_email');
    return recipient;
  }

  async function connectionFor(tx, refs) {
    const [privateDoc, existing] = await Promise.all([tx.get(refs.privateConnection), tx.get(refs.existingConnection)]);
    for (const doc of [privateDoc, existing]) {
      const record = doc.data();
      if (record?.status === 'connected' && record.refreshToken && GMAIL_ADDRESS.test(record.email ?? '')) return record;
    }
    return null;
  }

  async function reserve(refs, intent, limit, input) {
    return db.runTransaction(async (tx) => {
      const to = await checkOwner(tx, refs);
      const [previous, limits, connection] = await Promise.all([tx.get(intent), tx.get(limit), connectionFor(tx, refs)]);
      if (previous.exists) {
        if (previous.data().fingerprint !== input.fingerprint) throw fail(409, 'intent_changed');
        return { previous: previous.data() };
      }
      // Compare with the address the user saw. The recipient is always selected from Firestore.
      if (input.recipient !== to) throw fail(409, 'recipient_changed');
      if (!connection) throw fail(409, 'connect_gmail');
      if (input.sender !== connection.email) throw fail(409, 'sender_changed');
      const minute = Math.floor(now() / 60_000);
      const day = Math.floor(minute / 1440);
      const prior = limits.data() ?? {};
      const perMinute = prior.minute === minute ? prior.perMinute : 0;
      const perDay = prior.day === day ? prior.perDay : 0;
      if (perMinute >= MAX_PER_MINUTE || perDay >= MAX_PER_DAY) throw fail(429, 'app_limit');
      tx.set(limit, { minute, day, perMinute: perMinute + 1, perDay: perDay + 1 });
      tx.set(intent, { status: 'sending', fingerprint: input.fingerprint, createdAt: timestamp() });
      return { to, connection };
    });
  }

  async function send(refs, uid, input) {
    if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 160
      || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 20_000
      || typeof input.requestId !== 'string' || !KEY.test(input.requestId)
      || typeof input.sender !== 'string' || input.sender.length > 254
      || typeof input.recipient !== 'string' || input.recipient.length > 254) throw fail(400, 'invalid_message');
    const intent = db.doc(`contact_hub_gmail_limits/${uid}/attempts/${input.requestId}`);
    const limit = db.doc(`contact_hub_gmail_limits/${uid}`);
    const fingerprint = hash(JSON.stringify([input.contactId, input.recipient, input.sender, input.subject, input.message]));
    const reserved = await reserve(refs, intent, limit, { ...input, fingerprint });
    if (reserved.previous) return json(200, publicState(reserved.previous));
    let messageId;
    try {
      messageId = await gmail.send(reserved.connection, { toEmail: reserved.to, subject: input.subject.trim(), body: input.message });
    } catch (error) {
      const reason = ['connect_gmail', 'gmail_quota', 'gmail_rejected'].includes(error.code) ? error.code : 'send_unconfirmed';
      const status = reason === 'send_unconfirmed' ? 'unknown' : 'rejected';
      await intent.update({ status, reason });
      return json(200, { status, reason });
    }
    const at = timestamp();
    try {
      return await db.runTransaction(async (tx) => {
        const contact = await tx.get(refs.contact);
        if (contact.exists) {
          tx.set(refs.contact.collection('timeline').doc(`contact-hub-gmail-${input.requestId}`), {
            type: 'message_sent', actor: 'user', preview: input.subject.trim(), timestamp: at, createdAt: at,
            metadata: { channel: 'email', source: SEND_SOURCE, gmail_message_id: messageId },
          });
        }
        tx.update(intent, { status: 'sent', ...(contact.exists ? {} : { reason: 'activity_unavailable' }) });
        return json(200, { status: 'sent', ...(contact.exists ? {} : { reason: 'activity_unavailable' }) });
      });
    } catch {
      // Gmail already sent it. Preserve the reserved ID even when the activity write fails.
      try { await intent.update({ status: 'sent', reason: 'activity_unavailable' }); } catch { /* the sending marker still prevents replay */ }
      return json(200, { status: 'sent', reason: 'activity_unavailable' });
    }
  }

  async function api(event) {
    if (!enabled()) return json(404, { error: 'unavailable' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
    const bearer = (event.headers?.authorization ?? event.headers?.Authorization ?? '').match(/^Bearer (\S+)$/i)?.[1];
    let actor;
    try {
      actor = bearer ? await verifyToken(bearer) : null;
    } catch { return json(401, { error: 'sign_in' }); }
    if (!validId(actor?.uid)) return json(401, { error: 'sign_in' });
    if (actor.firebase?.sign_in_provider === 'custom') return json(403, { error: 'read_only' });
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || event.body.length > 55_000) throw fail(400, 'invalid_message');
      const input = JSON.parse(event.body);
      if (!validId(input?.contactId)) throw fail(400, 'invalid_contact');
      if (input.uid !== actor.uid) throw fail(403, 'read_only');
      const scoped = refs(actor.uid, input.contactId);
      if (input.action === 'send') return await send(scoped, actor.uid, input);
      if (input.action === 'finish_connect') {
        if (!SECRET.test(input.completion ?? '')) throw fail(400, 'invalid_oauth');
        await db.runTransaction(async (tx) => {
          const pending = db.doc(`contact_hub_gmail_oauth/${input.completion}`);
          const [saved] = await Promise.all([tx.get(pending), checkOwner(tx, scoped)]);
          const data = saved.data();
          if (!data?.connection || data.uid !== actor.uid || data.contactId !== input.contactId
            || data.expiresAt.toMillis() <= now()) throw fail(403, 'invalid_oauth');
          tx.set(scoped.privateConnection, {
            ...data.connection, source: SEND_SOURCE, status: 'connected', updatedAt: timestamp(),
          });
          tx.delete(pending);
        });
        return json(200, { status: 'connected' });
      }
      if (input.action === 'status') {
        return await db.runTransaction(async (tx) => {
          const recipient = await checkOwner(tx, scoped);
          const connection = await connectionFor(tx, scoped);
          return json(200, { recipient, connected: !!connection, sender: connection?.email ?? null });
        });
      }
      if (input.action !== 'connect') throw fail(400, 'invalid_action');

      const state = randomBytes(32).toString('base64url');
      const browser = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      await db.runTransaction(async (tx) => {
        await checkOwner(tx, scoped);
        tx.set(db.doc(`contact_hub_gmail_oauth/${state}`), {
          uid: actor.uid, contactId: input.contactId, verifier, browserHash: hash(browser), expiresAt: timestamp(now() + OAUTH_AGE),
        });
      });
      return json(200, { url: gmail.connectUrl(state, verifier) }, { 'Set-Cookie': cookie(browser, OAUTH_AGE / 1000) });
    } catch (error) {
      return json(error.http ?? (error instanceof SyntaxError ? 400 : 503), { error: error.http ? error.code : 'unavailable' });
    }
  }

  async function callback(event) {
    if (!enabled()) return json(404, { error: 'unavailable' });
    if (event.httpMethod !== 'GET') return json(405, { error: 'method' });
    const { state, code } = event.queryStringParameters ?? {};
    const browser = (event.headers?.cookie ?? event.headers?.Cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)(?:;|$)`))?.[1];
    if (!SECRET.test(state ?? '') || !SECRET.test(browser ?? '')) return redirect('/contact-hub?gmail=failed');
    let route = '/contact-hub?gmail=failed';
    try {
      const stateRef = db.doc(`contact_hub_gmail_oauth/${state}`);
      const claimed = await db.runTransaction(async (tx) => {
        const saved = (await tx.get(stateRef)).data();
        if (!saved || saved.expiresAt.toMillis() <= now() || !validId(saved.uid) || !validId(saved.contactId)
          || !/^[a-f0-9]{64}$/.test(saved.browserHash)
          || !timingSafeEqual(Buffer.from(saved.browserHash), Buffer.from(hash(browser)))) throw fail(403, 'invalid_oauth');
        const scoped = refs(saved.uid, saved.contactId);
        await checkOwner(tx, scoped);
        tx.delete(stateRef);
        return { saved, scoped };
      });
      route = `${pathFor(claimed.saved.contactId)}&gmail=failed`;
      if (typeof code !== 'string' || !code || code.length > 2048) return redirect(route);
      const connection = await gmail.exchange(code, claimed.saved.verifier);
      const completion = randomBytes(32).toString('base64url');
      await db.runTransaction(async (tx) => {
        await checkOwner(tx, claimed.scoped);
        tx.set(db.doc(`contact_hub_gmail_oauth/${completion}`), {
          uid: claimed.saved.uid, contactId: claimed.saved.contactId, connection, expiresAt: timestamp(now() + OAUTH_AGE),
        });
      });
      return redirect(`${pathFor(claimed.saved.contactId)}&gmail_connection=${completion}`);
    } catch { return redirect(route); }
  }

  return { api, callback };
}
