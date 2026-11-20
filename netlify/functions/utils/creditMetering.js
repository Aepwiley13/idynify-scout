/**
 * W4: server-side credit metering for paid Apollo lookups.
 *
 * Off until the server switch says otherwise: CREDIT_METERING=on. Off, every wrapped function
 * behaves exactly as before (paid accounts are not charged), so enabling paid enrichment broadly
 * stays a separate, explicit decision once metering is proven.
 *
 * On, each credit-bearing function's handler is wrapped (withCreditMetering) and, for a paying
 * account acting for itself:
 *
 *   1. Reserve. One Firestore transaction reads the account and this request's charge record.
 *      Not enough credits: 402 insufficient_credits, before any Apollo call. Otherwise the most
 *      the request could cost is taken from the balance and the charge is recorded `reserved`.
 *   2. The function runs (Apollo is called once).
 *   3. Settle. One transaction charges what the response shows Apollo actually returned (a
 *      matched person, a company, each revealed decision maker) and returns the rest. No match,
 *      an error or a crash of the function: everything is returned (`refunded`). Each settle
 *      writes one creditTransactions entry.
 *
 * No double charges:
 *   - The charge record is keyed by account, action and the request itself (its body without
 *     tokens). The same request again while it is running: 409 lookup_in_progress, no Apollo
 *     call. Again within RETRY_WINDOW_MS of a charged answer: that answer is replayed, with no
 *     Apollo call and no charge. After that window, the same lookup is a new, billable lookup.
 *   - A reservation left behind by a crash is returned in full once it is STALE_RESERVATION_MS
 *     old, the next time the same request comes in. We cannot tell whether Apollo charged us, so
 *     the customer gets the benefit of the doubt.
 *   - A settle that finds its reservation already handled changes nothing.
 *
 * Not charged: admins (as in the paid guard), and admin impersonation (the token holder acting
 * for someone else). Not metered here: accounts without paid access, which the function's own
 * paid guard (paidApiAccess.js) refuses.
 *
 * Usage limits: the credit balance for lookups that cost credits; a daily count for the searches
 * that cost none (CREDIT_DAILY_SEARCH_LIMIT, default 200); and searchPeople's own server cap.
 *
 * Rates are configuration, not decisions: CREDIT_RATES='{"person":1,"company":1}' (whole credits
 * per unit). The defaults below are PROVISIONAL until Idynify's Apollo pricing is verified
 * (docs/billing/PHASE3_CREDIT_AUDIT.md).
 */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { isPaidApiEligible, isAdminAccount } from './paidApiAccess.js';

// The Admin SDK loads on the first metered request, never when a function module loads: with
// metering off nothing here touches Firebase, and a start-up failure becomes a 503 refusal.
const firebase = () => import('../firebase-admin.js');

export const PROVISIONAL_CREDIT_RATES = Object.freeze({ person: 1, company: 1 });
export const RETRY_WINDOW_MS = 10 * 60 * 1000;
export const STALE_RESERVATION_MS = 2 * 60 * 1000;
export const MAX_STORED_RESPONSE = 300_000;
export const DEFAULT_DAILY_SEARCH_LIMIT = 200;
/** searchPeople enriches at most this many people per request (also enforced in searchPeople.js). */
export const SEARCH_PEOPLE_MAX = 5;
/** enrichCompany reveals at most this many decision makers. */
export const COMPANY_PEOPLE_MAX = 3;

export const meteringEnabled = (env = process.env) => env.CREDIT_METERING === 'on';

/** The configured rates, each a whole number 0–100, else the provisional default. Pure. */
export function creditRates(env = process.env) {
  let configured = {};
  try {
    configured = env.CREDIT_RATES ? JSON.parse(env.CREDIT_RATES) : {};
  } catch {
    configured = {};
  }
  const pick = (key) => {
    const v = configured?.[key];
    return Number.isInteger(v) && v >= 0 && v <= 100 ? v : PROVISIONAL_CREDIT_RATES[key];
  };
  return { person: pick('person'), company: pick('company') };
}

export function dailySearchLimit(env = process.env) {
  const v = Number(env.CREDIT_DAILY_SEARCH_LIMIT);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_DAILY_SEARCH_LIMIT;
}

const count = (v) => (Array.isArray(v) ? v.length : 0);
const ok = (b) => b?.success === true;

/**
 * The credit-bearing functions: the most a request may cost (reserved first) and what its
 * response shows was actually returned (charged). Pure. `r` is the rates.
 */
export const METERED = Object.freeze({
  enrichContact: { max: (r) => r.person, used: (b, r) => (ok(b) && b.enrichedData ? r.person : 0) },
  enrichCompany: {
    max: (r) => r.company + COMPANY_PEOPLE_MAX * r.person,
    used: (b, r) => (ok(b) && b.data ? r.company + r.person * Math.min(COMPANY_PEOPLE_MAX, count(b.data.decisionMakers)) : 0),
  },
  searchPeople: { max: (r) => SEARCH_PEOPLE_MAX * r.person, used: (b, r) => (ok(b) ? r.person * Math.min(SEARCH_PEOPLE_MAX, count(b.people)) : 0) },
  barryEnrich: { max: (r) => r.person, used: (b, r) => (ok(b) && Object.values(b.provenance ?? {}).includes('apollo_match') ? r.person : 0) },
  findContactByLinkedInUrl: { max: (r) => r.person, used: (b, r) => (ok(b) && b.contact ? r.person : 0) },
  'find-contact-by-email': { max: (r) => r.person, used: (b, r) => (ok(b) && b.contact ? r.person : 0) },
  captureLinkedIn: {
    max: (r) => r.person,
    // Charged when a profile Apollo supplied is among the candidates shown (rankLinkedInCandidates).
    used: (b, r) => ((b?.candidates ?? []).some((c) => Array.isArray(c?.sources) && c.sources.includes('apollo')) ? r.person : 0),
  },
});

/** The searches that cost no credits but count toward the daily limit. */
export const COUNTED = Object.freeze(new Set(['findContact', 'search-companies', 'search-companies-manual']));

// ── Requests ────────────────────────────────────────────────────────────────────────────────────

const TOKEN_FIELDS = ['authToken', 'idToken'];

function parseBody(event) {
  try {
    const raw = event?.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event?.body;
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** One key per account, action and request (its body without tokens). Pure. */
export function chargeKey(uid, action, body) {
  const rest = Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => !TOKEN_FIELDS.includes(k)));
  return createHash('sha256').update(`${uid}|${action}|${stable(rest)}`).digest('hex').slice(0, 40);
}

/** Every distinct token the request carries. Pure. */
export function requestTokens(event, body) {
  const tokens = [];
  const header = event?.headers?.authorization ?? event?.headers?.Authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ') && header.length > 7) tokens.push(header.slice(7));
  for (const f of TOKEN_FIELDS) if (typeof body?.[f] === 'string' && body[f]) tokens.push(body[f]);
  return [...new Set(tokens)];
}

/**
 * Who is charged. { uid } to meter; { pass: true } to leave the request to the function
 * (no token, or acting for someone else); { refuse: true } when the tokens do not all verify
 * to one account, so no lookup can slip past metering on a token the function reads instead.
 */
async function identify(event, body, verify) {
  const tokens = requestTokens(event, body);
  if (tokens.length === 0) return { pass: true };
  const uids = new Set();
  for (const t of tokens) {
    try {
      const uid = (await verify(t))?.uid;
      if (!uid) return { refuse: true };
      uids.add(uid);
    } catch {
      return { refuse: true };
    }
  }
  if (uids.size !== 1) return { refuse: true };
  const [uid] = uids;
  if (typeof body.userId === 'string' && body.userId && body.userId !== uid) return { pass: true };
  return { uid };
}

// ── Balances ────────────────────────────────────────────────────────────────────────────────────

/** What is left, from either stored shape. Pure. */
export function remainingOf(credits) {
  if (typeof credits === 'number') return credits;
  return Number(credits?.remaining) || 0;
}

/** The balance after taking `amount` (negative to give back), in the stored shape. Pure. */
export function adjustCredits(credits, amount) {
  if (typeof credits === 'number') return credits - amount;
  const current = credits ?? {};
  return {
    ...current,
    used: Math.max(0, (Number(current.used) || 0) + amount),
    remaining: (Number(current.remaining) || 0) - amount,
  };
}

const chargeRef = (db, uid, key) => db.collection('users').doc(uid).collection('creditCharges').doc(key);
const ledgerRef = (db, uid) => db.collection('users').doc(uid).collection('creditTransactions').doc();
const usageRef = (db, uid, day) => db.collection('users').doc(uid).collection('creditUsage').doc(day);

/**
 * Step 1. One of: unmetered | replay (with the stored response) | in_progress | insufficient
 * (remaining, required) | reserved (chargeId, reserved).
 */
export async function beginCharge({ uid, action, key, reserve, now = Date.now() }) {
  const { db } = await firebase();
  const userRef = db.collection('users').doc(uid);
  const ref = chargeRef(db, uid, key);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const chargeSnap = await tx.get(ref);
    const user = userSnap.exists ? userSnap.data() : null;
    if (!isPaidApiEligible(uid, user) || isAdminAccount(uid, user)) return { kind: 'unmetered' };

    let credits = user.credits;
    const prior = chargeSnap.exists ? chargeSnap.data() : null;
    if (prior?.status === 'reserved') {
      if (now - Date.parse(prior.reservedAt) < STALE_RESERVATION_MS) return { kind: 'in_progress' };
      // Left behind by a crash: give it all back, then reserve afresh.
      credits = adjustCredits(credits, -(Number(prior.reserved) || 0));
      tx.set(ledgerRef(db, uid), {
        action, cost: 0, refunded: Number(prior.reserved) || 0, reason: 'stale_reservation',
        chargeKey: key, timestamp: new Date(now).toISOString(), remainingAfter: remainingOf(credits),
      });
    } else if (prior?.status === 'settled' && now - Date.parse(prior.settledAt) < RETRY_WINDOW_MS) {
      return prior.response ? { kind: 'replay', response: JSON.parse(prior.response) } : { kind: 'in_progress' };
    }

    const remaining = remainingOf(credits);
    if (user.credits == null || remaining < reserve) {
      if (credits !== user.credits) tx.update(userRef, { credits });
      return { kind: 'insufficient', remaining, required: reserve };
    }
    const chargeId = randomUUID();
    tx.update(userRef, { credits: adjustCredits(credits, reserve) });
    tx.set(ref, { status: 'reserved', chargeId, action, reserved: reserve, reservedAt: new Date(now).toISOString(), response: null });
    return { kind: 'reserved', chargeId, reserved: reserve };
  });
}

/** Step 3. Charges `used` (at most what was reserved) and returns the rest. */
export async function settleCharge({ uid, action, key, chargeId, used, response, now = Date.now() }) {
  const { db } = await firebase();
  const userRef = db.collection('users').doc(uid);
  const ref = chargeRef(db, uid, key);
  return db.runTransaction(async (tx) => {
    const chargeSnap = await tx.get(ref);
    const userSnap = await tx.get(userRef);
    const charge = chargeSnap.exists ? chargeSnap.data() : null;
    if (!charge || charge.status !== 'reserved' || charge.chargeId !== chargeId) return { kind: 'already_handled' };

    const reserved = Number(charge.reserved) || 0;
    const charged = Math.max(0, Math.min(reserved, Number(used) || 0));
    const credits = adjustCredits(userSnap.data()?.credits, -(reserved - charged));
    let stored = null;
    if (charged > 0 && response) {
      const text = JSON.stringify(response);
      stored = text.length <= MAX_STORED_RESPONSE ? text : null;
    }
    tx.update(userRef, { credits });
    tx.set(ref, {
      ...charge, status: charged > 0 ? 'settled' : 'refunded', charged,
      settledAt: new Date(now).toISOString(), response: stored,
    });
    tx.set(ledgerRef(db, uid), {
      action, cost: charged, reserved, chargeKey: key, timestamp: new Date(now).toISOString(), remainingAfter: remainingOf(credits),
    });
    return { kind: charged > 0 ? 'settled' : 'refunded', charged };
  });
}

/** The daily count for searches that cost no credits. unmetered | counted | daily_limit. */
export async function countSearch({ uid, limit, now = Date.now() }) {
  const { db } = await firebase();
  const userRef = db.collection('users').doc(uid);
  const day = new Date(now).toISOString().slice(0, 10);
  const ref = usageRef(db, uid, day);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const usageSnap = await tx.get(ref);
    const user = userSnap.exists ? userSnap.data() : null;
    if (!isPaidApiEligible(uid, user) || isAdminAccount(uid, user)) return { kind: 'unmetered' };
    const searches = Number(usageSnap.exists ? usageSnap.data().searches : 0) || 0;
    if (searches >= limit) return { kind: 'daily_limit', limit };
    tx.set(ref, { searches: searches + 1, day }, { merge: true });
    return { kind: 'counted' };
  });
}

// ── The wrapper ─────────────────────────────────────────────────────────────────────────────────

const HEADERS = Object.freeze({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
const refusal = (statusCode, error, message, extra = {}) => ({
  statusCode, headers: { ...HEADERS }, body: JSON.stringify({ success: false, error, message, ...extra }),
});

function parseResponseBody(res) {
  try {
    return typeof res?.body === 'string' ? JSON.parse(res.body) : null;
  } catch {
    return null;
  }
}

const verifyWithAdmin = async (token) => (await firebase()).admin.auth().verifyIdToken(token);

export function withCreditMetering(handler, { action, env = process.env, verify = verifyWithAdmin, now = () => Date.now() } = {}) {
  if (typeof handler !== 'function') throw new TypeError('withCreditMetering needs the handler function');
  if (!METERED[action] && !COUNTED.has(action)) throw new TypeError(`withCreditMetering: unknown action ${action}`);

  const metered = async (event, context) => {
    if (!meteringEnabled(env) || event?.httpMethod === 'OPTIONS') return handler(event, context);
    const body = parseBody(event);
    const who = await identify(event, body, verify);
    if (who.refuse) return refusal(401, 'unauthorized', 'Please sign in again.');
    if (who.pass) return handler(event, context);
    const { uid } = who;
    const unavailable = (err) => {
      console.error('credit_metering.unavailable', { action, message: err?.message });
      return refusal(503, 'credits_unavailable', 'Your credits could not be checked right now. Nothing was looked up. Please try again shortly.');
    };

    if (COUNTED.has(action)) {
      let counted;
      try {
        counted = await countSearch({ uid, limit: dailySearchLimit(env), now: now() });
      } catch (err) {
        return unavailable(err);
      }
      if (counted.kind === 'daily_limit') {
        return refusal(429, 'daily_limit_reached', `You have reached today's limit of ${counted.limit} searches. It resets at midnight UTC.`, { limit: counted.limit });
      }
      return handler(event, context);
    }

    const rates = creditRates(env);
    const key = chargeKey(uid, action, body);
    let begin;
    try {
      begin = await beginCharge({ uid, action, key, reserve: METERED[action].max(rates), now: now() });
    } catch (err) {
      return unavailable(err);
    }
    if (begin.kind === 'unmetered') return handler(event, context);
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') return refusal(409, 'lookup_in_progress', 'This lookup is already running. You have not been charged twice.');
    if (begin.kind === 'insufficient') {
      return refusal(402, 'insufficient_credits',
        `This needs up to ${begin.required} credit${begin.required === 1 ? '' : 's'} and you have ${begin.remaining} left. Nothing was looked up.`,
        { remaining: begin.remaining, required: begin.required });
    }

    let res;
    let thrown = null;
    try {
      res = await handler(event, context);
    } catch (err) {
      thrown = err;
    }
    const used = !thrown && res?.statusCode === 200 ? METERED[action].used(parseResponseBody(res), rates) : 0;
    try {
      await settleCharge({ uid, action, key, chargeId: begin.chargeId, used, response: used > 0 ? res : null, now: now() });
    } catch (err) {
      // The reservation stays and is returned in full once stale: never charged twice.
      console.error('credit_metering.settle_failed', { action, message: err?.message });
    }
    if (thrown) throw thrown;
    return res;
  };
  Object.defineProperty(metered, 'creditAction', { value: action });
  return metered;
}
