/**
 * stickerCore — the ONE module that writes stickers and sticker membership
 * (ADR-007).
 *
 * Writes:
 *   users/{uid}/stickers/{stickerId}         the user's sticker definitions
 *   users/{uid}/contacts/{contactId}         sticker_ids, sticker_assignments,
 *                                            sticker_change (membership only)
 *
 * Nothing else may write those. src/test/stickerWritePaths.test.js fails the
 * build if another module does, and firestore.rules refuses a membership
 * write that does not have exactly the shape built here.
 *
 * NO FIREBASE IMPORT. Firestore arrives as an adapter: `db` plus the modular
 * functions this module calls. The browser passes the web SDK
 * (src/services/stickerService.js); the emulator suite passes its own copy of
 * the same SDK, so the code tested against the real rules is this code. The
 * same pattern as src/utils/identityResolution.js.
 *
 * MEMBERSHIP IS DECIDED IN A TRANSACTION, against the contact and the sticker
 * as they are stored at that moment:
 *   - the sticker must exist and be active (an archive landing at the same
 *     moment makes the add fail; nothing is half-written);
 *   - the list changes through arrayUnion / arrayRemove, which the server
 *     applies to the list as stored, so a concurrent add or remove from
 *     another tab is kept;
 *   - adding a sticker the contact already has, or removing one it does not
 *     have, writes nothing.
 * The rules check the same things again, server-side, against the stored
 * document. Under contention the server can refuse a write the rules judge
 * on newer data (permission-denied, which Firestore does not retry), so a
 * membership change is re-read and re-decided up to MEMBERSHIP_ATTEMPTS
 * times. A real refusal (feature off, someone else's contact) fails every
 * attempt and is reported as permission_denied.
 */

export const STICKER_LIMIT = 50;
export const STICKER_NAME_MAX = 60;
export const STICKER_DESCRIPTION_MAX = 280;
export const STICKER_EMOJI_MAX = 16;
export const STICKER_COLORS = Object.freeze(['teal', 'blue', 'purple', 'coral', 'amber', 'pink', 'green', 'gray']);
export const STICKER_STATUS = Object.freeze({ ACTIVE: 'active', ARCHIVED: 'archived' });
export const ASSIGNED_BY = Object.freeze(['user', 'csv_import']);
export const MEMBERSHIP_ATTEMPTS = 4;

const STICKER_ID = /^[A-Za-z0-9]{20}$/;
const CONTACT_ID = /^[^/]{1,1500}$/;

export const STICKER_ERRORS = Object.freeze({
  NOT_SIGNED_IN: 'not_signed_in',
  INVALID_NAME: 'invalid_name',
  INVALID_COLOR: 'invalid_color',
  INVALID_EMOJI: 'invalid_emoji',
  INVALID_DESCRIPTION: 'invalid_description',
  INVALID_CHANGE: 'invalid_change',
  INVALID_STICKER_ID: 'invalid_sticker_id',
  INVALID_CONTACT_ID: 'invalid_contact_id',
  STICKER_NOT_FOUND: 'sticker_not_found',
  STICKER_ARCHIVED: 'sticker_archived',
  CONTACT_NOT_FOUND: 'contact_not_found',
  LIMIT_REACHED: 'limit_reached',
  PERMISSION_DENIED: 'permission_denied',
  WRITE_FAILED: 'write_failed',
});

/** A sticker failure with a stable code the UI can map to a message. Never carries contact data. */
export class StickerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'StickerError';
    this.code = code;
  }
}

/** Any failure as a StickerError: Firestore's permission-denied keeps its meaning. */
export function toStickerError(err) {
  if (err instanceof StickerError) return err;
  const code = err?.code === 'permission-denied' ? STICKER_ERRORS.PERMISSION_DENIED : STICKER_ERRORS.WRITE_FAILED;
  return new StickerError(code, err?.message ?? code);
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** The name as stored: trimmed, inner whitespace collapsed, 1–60 characters. */
export function cleanStickerName(name) {
  const value = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!value || value.length > STICKER_NAME_MAX) {
    throw new StickerError(STICKER_ERRORS.INVALID_NAME, `A sticker name needs 1–${STICKER_NAME_MAX} characters.`);
  }
  return value;
}

/** For duplicate-name warnings and search. A label, never an identity. */
export function stickerNameKey(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

export function isStickerId(id) {
  return typeof id === 'string' && STICKER_ID.test(id);
}

/** The sticker IDs a stored contact holds, exactly as stored (an absent field is none). */
export function storedStickerIds(contact) {
  return Array.isArray(contact?.sticker_ids) ? contact.sticker_ids : [];
}

/** Active stickers in display order: by name, case-insensitive, then by ID. */
export function sortStickers(stickers) {
  return [...stickers].sort((a, b) => stickerNameKey(a.name).localeCompare(stickerNameKey(b.name)) || (a.id < b.id ? -1 : 1));
}

/**
 * The stickers to show on a contact: known and active, in display order.
 * An ID with no definition (or an archived one) is not shown and not removed.
 */
export function visibleStickers(contact, stickersById) {
  const shown = [];
  for (const id of new Set(storedStickerIds(contact))) {
    const sticker = stickersById.get(id);
    if (sticker && sticker.status === STICKER_STATUS.ACTIVE) shown.push(sticker);
  }
  return sortStickers(shown);
}

function checkColor(color) {
  if (!STICKER_COLORS.includes(color)) throw new StickerError(STICKER_ERRORS.INVALID_COLOR, 'Unknown sticker color.');
  return color;
}

function checkEmoji(emoji) {
  if (emoji === null || emoji === undefined || emoji === '') return null;
  if (typeof emoji !== 'string' || emoji.trim().length > STICKER_EMOJI_MAX) {
    throw new StickerError(STICKER_ERRORS.INVALID_EMOJI, 'That emoji is too long.');
  }
  return emoji.trim();
}

function checkDescription(description) {
  if (description === null || description === undefined) return null;
  const value = typeof description === 'string' ? description.trim() : null;
  if (value === null || value.length > STICKER_DESCRIPTION_MAX) {
    throw new StickerError(STICKER_ERRORS.INVALID_DESCRIPTION, `A description can be up to ${STICKER_DESCRIPTION_MAX} characters.`);
  }
  return value || null;
}

function requireUid(uid) {
  if (typeof uid !== 'string' || !uid) throw new StickerError(STICKER_ERRORS.NOT_SIGNED_IN, 'Sign in to use stickers.');
}

function requireStickerId(id) {
  if (!isStickerId(id)) throw new StickerError(STICKER_ERRORS.INVALID_STICKER_ID, 'Not a sticker ID.');
}

function requireContactId(id) {
  if (typeof id !== 'string' || !CONTACT_ID.test(id)) throw new StickerError(STICKER_ERRORS.INVALID_CONTACT_ID, 'Not a contact ID.');
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * @param {object} adapter
 * @param {object} adapter.db  a Firestore instance
 * @param {object} adapter.fs  { doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp,
 *                             deleteField, onSnapshot, arrayUnion, arrayRemove }
 */
export function createStickerStore({ db, fs }) {
  const {
    doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, onSnapshot, arrayUnion, arrayRemove,
  } = fs;
  const stickerRef = (uid, id) => doc(db, 'users', uid, 'stickers', id);
  const contactRef = (uid, id) => doc(db, 'users', uid, 'contacts', id);

  /** Run a membership transaction, re-reading after a refusal that may only mean "stale". */
  async function withContentionRetry(run) {
    let lastError = null;
    for (let attempt = 0; attempt < MEMBERSHIP_ATTEMPTS; attempt += 1) {
      try {
        return await run();
      } catch (err) {
        if (err instanceof StickerError) throw err; // decided from fresh data: final
        if (err?.code !== 'permission-denied') throw toStickerError(err);
        lastError = err;
      }
    }
    throw toStickerError(lastError);
  }

  /** Create a sticker. Its ID is a fresh Firestore auto-ID, never reused. */
  async function createSticker(uid, { name, color = 'gray', emoji = null, description = null } = {}) {
    requireUid(uid);
    const data = {
      schema_version: 1,
      name: cleanStickerName(name),
      color: checkColor(color),
      emoji: checkEmoji(emoji),
      description: checkDescription(description),
      status: STICKER_STATUS.ACTIVE,
      archived_at: null,
      created_at: serverTimestamp(),
      created_by: uid,
      updated_at: serverTimestamp(),
    };
    const ref = doc(collection(db, 'users', uid, 'stickers'));
    try {
      await setDoc(ref, data);
    } catch (err) {
      throw toStickerError(err);
    }
    return { id: ref.id };
  }

  /** Rename, recolor, change the emoji or description. Only those fields. */
  async function updateSticker(uid, stickerId, changes = {}) {
    requireUid(uid);
    requireStickerId(stickerId);
    const allowed = ['name', 'color', 'emoji', 'description'];
    const keys = Object.keys(changes);
    if (!keys.length || keys.some((key) => !allowed.includes(key))) {
      throw new StickerError(STICKER_ERRORS.INVALID_CHANGE, 'Only a sticker\'s name, color, emoji and description can change.');
    }
    const patch = { updated_at: serverTimestamp() };
    if ('name' in changes) patch.name = cleanStickerName(changes.name);
    if ('color' in changes) patch.color = checkColor(changes.color);
    if ('emoji' in changes) patch.emoji = checkEmoji(changes.emoji);
    if ('description' in changes) patch.description = checkDescription(changes.description);
    try {
      await updateDoc(stickerRef(uid, stickerId), patch);
    } catch (err) {
      throw toStickerError(err);
    }
  }

  async function setStatus(uid, stickerId, status) {
    requireUid(uid);
    requireStickerId(stickerId);
    try {
      await updateDoc(stickerRef(uid, stickerId), {
        status,
        archived_at: status === STICKER_STATUS.ARCHIVED ? serverTimestamp() : null,
        updated_at: serverTimestamp(),
      });
    } catch (err) {
      throw toStickerError(err);
    }
  }

  /** Hide a sticker from pickers and filters. Its memberships stay. */
  const archiveSticker = (uid, stickerId) => setStatus(uid, stickerId, STICKER_STATUS.ARCHIVED);
  /** Bring an archived sticker back, with every membership it had. */
  const restoreSticker = (uid, stickerId) => setStatus(uid, stickerId, STICKER_STATUS.ACTIVE);

  /** Live list of the user's stickers, sorted by name. Returns the unsubscribe function. */
  function subscribeStickers(uid, onNext, onError = () => {}) {
    requireUid(uid);
    return onSnapshot(
      collection(db, 'users', uid, 'stickers'),
      (snapshot) => onNext(sortStickers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))),
      (err) => onError(toStickerError(err)),
    );
  }

  /**
   * Add one sticker to one contact.
   * @returns {Promise<{status: 'added'|'already'}>}
   */
  async function addSticker(uid, contactId, stickerId, { assignedBy = 'user' } = {}) {
    requireUid(uid);
    requireContactId(contactId);
    requireStickerId(stickerId);
    if (!ASSIGNED_BY.includes(assignedBy)) throw new StickerError(STICKER_ERRORS.INVALID_CHANGE, 'Unknown assignment source.');
    return withContentionRetry(() => runTransaction(db, async (tx) => {
      const [sticker, contact] = await Promise.all([tx.get(stickerRef(uid, stickerId)), tx.get(contactRef(uid, contactId))]);
      if (!sticker.exists()) throw new StickerError(STICKER_ERRORS.STICKER_NOT_FOUND, 'That sticker no longer exists.');
      if (sticker.data().status !== STICKER_STATUS.ACTIVE) throw new StickerError(STICKER_ERRORS.STICKER_ARCHIVED, 'That sticker was archived.');
      if (!contact.exists()) throw new StickerError(STICKER_ERRORS.CONTACT_NOT_FOUND, 'That contact no longer exists.');
      const ids = storedStickerIds(contact.data());
      if (ids.includes(stickerId)) return { status: 'already' };
      if (ids.length >= STICKER_LIMIT) throw new StickerError(STICKER_ERRORS.LIMIT_REACHED, `A contact can have up to ${STICKER_LIMIT} stickers.`);
      tx.update(contactRef(uid, contactId), {
        sticker_ids: arrayUnion(stickerId),
        [`sticker_assignments.${stickerId}`]: { assigned_at: serverTimestamp(), assigned_by: assignedBy },
        sticker_change: { op: 'add', sticker_id: stickerId, at: serverTimestamp() },
      });
      return { status: 'added' };
    }));
  }

  /**
   * Remove one sticker from one contact. Works for an archived sticker too.
   * @returns {Promise<{status: 'removed'|'absent'}>}
   */
  async function removeSticker(uid, contactId, stickerId) {
    requireUid(uid);
    requireContactId(contactId);
    requireStickerId(stickerId);
    return withContentionRetry(() => runTransaction(db, async (tx) => {
      const contact = await tx.get(contactRef(uid, contactId));
      if (!contact.exists()) throw new StickerError(STICKER_ERRORS.CONTACT_NOT_FOUND, 'That contact no longer exists.');
      const ids = storedStickerIds(contact.data());
      if (!ids.includes(stickerId)) return { status: 'absent' };
      tx.update(contactRef(uid, contactId), {
        sticker_ids: arrayRemove(stickerId),
        [`sticker_assignments.${stickerId}`]: deleteField(),
        sticker_change: { op: 'remove', sticker_id: stickerId, at: serverTimestamp() },
      });
      return { status: 'removed' };
    }));
  }

  /**
   * Add one sticker to many contacts (People's bulk bar). One transaction per
   * contact: a failure on one never undoes or blocks the others.
   * @returns {Promise<{added: string[], already: string[], failed: Array<{contactId: string, code: string}>}>}
   */
  async function addStickerToContacts(uid, contactIds, stickerId, { assignedBy = 'user', concurrency = 5 } = {}) {
    requireUid(uid);
    requireStickerId(stickerId);
    const unique = [...new Set(contactIds)];
    const results = await mapWithConcurrency(unique, concurrency, async (contactId) => {
      try {
        return { contactId, ...(await addSticker(uid, contactId, stickerId, { assignedBy })) };
      } catch (err) {
        return { contactId, status: 'failed', code: toStickerError(err).code };
      }
    });
    return {
      added: results.filter((r) => r.status === 'added').map((r) => r.contactId),
      already: results.filter((r) => r.status === 'already').map((r) => r.contactId),
      failed: results.filter((r) => r.status === 'failed').map(({ contactId, code }) => ({ contactId, code })),
    };
  }

  return {
    createSticker,
    updateSticker,
    archiveSticker,
    restoreSticker,
    subscribeStickers,
    addSticker,
    removeSticker,
    addStickerToContacts,
  };
}

export default { createStickerStore };
