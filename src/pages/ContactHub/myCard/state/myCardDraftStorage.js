/**
 * My Card — keeping an unsaved draft, so leaving the page cannot lose it.
 *
 * The router here is a plain BrowserRouter, which cannot stop an in-app
 * navigation. So nothing tries to: the draft is kept, and handed back when the
 * person returns. This module is that keeping, and nothing else. It touches
 * only the storage it is given, and it is the ONLY place in My Card that reads
 * or writes browser storage.
 *
 * WHAT IS STORED, under  idynify.myCardDraft.v1:<uid>
 *   { v, uid, savedAt, baseRevision, fields, share }
 *     fields        the ten card fields, as typed
 *     share         the eight Shared / Private switches
 *     baseRevision  the saved revision the draft started from (null: no saved card yet)
 *   Nothing else, ever: no suggestions or their sources, no sharing setting, no
 *   account email, no token, no preview. The shape is an exact allowlist, in
 *   both directions: what is written is built field by field from the card
 *   rules' own lists, and anything read back with a key too many or too few is
 *   thrown away.
 *
 * WHERE: sessionStorage. It belongs to one tab and ends with it, so a draft
 * holding a name, an email and a phone number does not outlive the visit on a
 * shared computer, and two tabs never read each other's draft. (The browser
 * does not encrypt it, and nothing here pretends otherwise: it is the person's
 * own data, in their own tab, and never sent anywhere.)
 *
 * WHOSE: the key carries the account's uid and the value repeats it. A draft
 * is read back only for the account that wrote it.
 *
 * HOW LONG: 12 hours, and at most 8 KB. An older draft, or one that is not
 * exactly what this module writes, is deleted when it is read. A draft too big
 * to keep is not kept, and the older one it would have replaced is deleted
 * with it, so a stale draft cannot come back in place of the newer one.
 *
 * NEVER A FAILURE: storage that is missing, full or refuses access makes
 * every call return a result, never throw. The page works without it.
 *
 * Everything takes the storage and the clock as options, so this is tested with
 * a fake and a fixed time.
 */
import { CARD_FIELDS, SHAREABLE_FIELDS } from '../../../../utils/myCardRules';

export const DRAFT_KEY_PREFIX = 'idynify.myCardDraft.v1:';
export const DRAFT_VERSION = 1;
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const DRAFT_MAX_BYTES = 8 * 1024;

// A clock that is a little ahead is not a reason to throw a draft away; one a long way ahead is.
const FUTURE_SLACK_MS = 5 * 60 * 1000;
// What a Firebase uid looks like. Anything else never becomes part of a key.
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const TOP_LEVEL_KEYS = Object.freeze(['baseRevision', 'fields', 'savedAt', 'share', 'uid', 'v']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (object, allowed) => {
  const keys = Object.keys(object).sort();
  const wanted = [...allowed].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
};
const byteLength = (text) => new TextEncoder().encode(text).length;

/** Runs `fn`; whatever it throws, answers `fallback`. Storage can throw on any call. */
function attempt(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** The tab's sessionStorage, or null where there is none (or the browser refuses access to it). */
export function browserSessionStorage() {
  return attempt(() => globalThis.sessionStorage ?? null, null);
}

/** The key for an account, or null for anything that is not a plausible uid. */
export function draftKey(uid) {
  return typeof uid === 'string' && UID_PATTERN.test(uid) ? `${DRAFT_KEY_PREFIX}${uid}` : null;
}

/** Every key of ours in the storage, collected first so removing them cannot disturb the walk. */
function ourKeys(storage) {
  return attempt(() => {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    return keys;
  }, []);
}

/**
 * What would be written for this draft, or null when it cannot be: built from
 * the card rules' own field lists, so nothing the card happens to carry can
 * get in.
 */
export function buildDraftPayload({ uid, card, baseRevision, now }) {
  const baseOk = baseRevision === null || (Number.isInteger(baseRevision) && baseRevision >= 0);
  if (!draftKey(uid) || !baseOk || !Number.isFinite(now)) return null;
  const source = isPlainObject(card) ? card : {};
  const sourceShare = isPlainObject(source.share) ? source.share : {};
  const fields = {};
  for (const field of CARD_FIELDS) fields[field] = own(source, field) && typeof source[field] === 'string' ? source[field] : '';
  const share = {};
  for (const field of SHAREABLE_FIELDS) share[field] = own(sourceShare, field) && sourceShare[field] === true;
  return { v: DRAFT_VERSION, uid, savedAt: now, baseRevision, fields, share };
}

/**
 * Keeps a draft.
 *
 * @param {{ uid: string, card: object, baseRevision: number|null }} draft
 * @param {{ storage?: Storage|null, now?: number }} [options]
 * @returns {{ ok: true } | { ok: false, reason: 'unavailable'|'invalid'|'too-large'|'error' }}
 */
export function saveDraft({ uid, card, baseRevision }, { storage = browserSessionStorage(), now = Date.now() } = {}) {
  const key = draftKey(uid);
  const payload = buildDraftPayload({ uid, card, baseRevision, now });
  if (!storage) return { ok: false, reason: 'unavailable' };
  if (!key || !payload) return { ok: false, reason: 'invalid' };

  const text = JSON.stringify(payload);
  if (byteLength(text) > DRAFT_MAX_BYTES) {
    // Not kept, and the older draft is not kept in its place either.
    attempt(() => storage.removeItem(key), undefined);
    return { ok: false, reason: 'too-large' };
  }
  try {
    storage.setItem(key, text);
    return { ok: true };
  } catch {
    // Full, or refused. The draft is simply not kept this time.
    return { ok: false, reason: 'error' };
  }
}

/**
 * The draft kept for an account, if there is a good one.
 *
 * A draft that is not good is deleted as it is found, and says why:
 *   'too-large'  more than 8 KB, which this module never writes
 *   'malformed'  not JSON, or not exactly the shape this module writes
 *   'version'    written by another version of the format
 *   'uid'        written for another account
 *   'expired'    more than 12 hours old (or dated in the future)
 *
 * @returns {{ status: 'none' }
 *   | { status: 'ok', draft: { card: object, baseRevision: number|null, savedAt: number } }
 *   | { status: 'discarded', reason: string }}
 */
export function readDraft(uid, { storage = browserSessionStorage(), now = Date.now() } = {}) {
  const key = draftKey(uid);
  if (!key || !storage) return { status: 'none' };
  const raw = attempt(() => storage.getItem(key), null);
  if (raw === null || raw === undefined) return { status: 'none' };

  const discard = (reason) => {
    attempt(() => storage.removeItem(key), undefined);
    return { status: 'discarded', reason };
  };

  if (typeof raw !== 'string') return discard('malformed');
  if (byteLength(raw) > DRAFT_MAX_BYTES) return discard('too-large');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return discard('malformed');
  }
  if (!isPlainObject(data)) return discard('malformed');
  if (data.v !== DRAFT_VERSION) return discard('version');
  if (!sameKeys(data, TOP_LEVEL_KEYS)) return discard('malformed');
  if (data.uid !== uid) return discard('uid');

  const { savedAt, baseRevision, fields, share } = data;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return discard('malformed');
  if (savedAt > now + FUTURE_SLACK_MS || now - savedAt > DRAFT_MAX_AGE_MS) return discard('expired');
  if (!(baseRevision === null || (Number.isInteger(baseRevision) && baseRevision >= 0))) return discard('malformed');
  if (!isPlainObject(fields) || !sameKeys(fields, CARD_FIELDS) || !CARD_FIELDS.every((field) => typeof fields[field] === 'string')) return discard('malformed');
  if (!isPlainObject(share) || !sameKeys(share, SHAREABLE_FIELDS) || !SHAREABLE_FIELDS.every((field) => typeof share[field] === 'boolean')) return discard('malformed');

  return {
    status: 'ok',
    draft: {
      // The draft's own shape: the fields, the switches, and sharing off.
      card: { ...fields, share: { ...share }, sharingEnabled: false },
      baseRevision,
      savedAt,
    },
  };
}

/** Forgets one account's draft. */
export function clearDraft(uid, { storage = browserSessionStorage() } = {}) {
  const key = draftKey(uid);
  if (!key || !storage) return false;
  return attempt(() => { storage.removeItem(key); return true; }, false);
}

/**
 * Forgets every draft that is not this account's. Run when My Card opens, so a
 * draft left by someone who signed out of this tab is not left lying around.
 * @returns {number} how many were removed
 */
export function purgeOtherAccounts(currentUid, { storage = browserSessionStorage() } = {}) {
  if (!storage) return 0;
  const keep = draftKey(currentUid);
  let removed = 0;
  for (const key of ourKeys(storage)) {
    if (key !== keep && attempt(() => { storage.removeItem(key); return true; }, false)) removed += 1;
  }
  return removed;
}

/**
 * Forgets every My Card draft in the tab, whoever's. For sign-out, whether or
 * not My Card is open.
 * @returns {number} how many were removed
 */
export function clearAllMyCardDrafts({ storage = browserSessionStorage() } = {}) {
  if (!storage) return 0;
  let removed = 0;
  for (const key of ourKeys(storage)) {
    if (attempt(() => { storage.removeItem(key); return true; }, false)) removed += 1;
  }
  return removed;
}
