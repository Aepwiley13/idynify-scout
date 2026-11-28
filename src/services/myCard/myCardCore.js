/**
 * myCardCore — a person's own My Card, stored privately at
 * users/{uid}/card/main.
 *
 * Like the sticker service, this takes Firestore as an adapter (`db`, `fs`) so
 * the code the emulator suite runs against the real rules is the code the app
 * runs. src/services/myCardService.js binds it to the web SDK; it has no
 * imports of its own beyond the pure card rules (with their .js extension so
 * plain Node can load it).
 *
 * WHO
 *   Every call acts for the signed-in account, from getSignedInUid(): the real
 *   Firebase Auth uid, never an impersonated one. No function takes a uid, so
 *   a caller cannot point it at someone else's card. firestore.rules lets only
 *   that user read or write it.
 *
 * WHAT IS STORED
 *   The card exactly as normalizeCard returns it (known fields, switches,
 *   schema version) plus three things of this service's own:
 *     revision   0 and up; one more with every save. See STALE SAVES.
 *     createdAt, updatedAt   ISO times.
 *   Sharing (MY-CARD-SHARE-001), only ever from the STORED card, never from what a caller says:
 *     publicId, publishedAt  set when the card is first published; kept while sharing is off; the ID
 *                            changes only on resetMyCardLink. The caller cannot name one.
 *     sharingEnabled         true only through publishMyCard (and kept by saveMyCard while live).
 *   Nothing else is stored: no suggestion, no source, nothing the caller added.
 *
 * ONE TRANSACTION PER ACTION
 *   Every action that changes what is public writes the private card, the public copy
 *   (publicCards/{publicId}) and, for a new ID, the ownership registry (publicIds/{publicId}) in ONE
 *   transaction, so they cannot disagree. firestore.rules checks it again after the write (S1-S8, P1-P4):
 *   a bug here is refused by the server, not trusted.
 *     saveMyCard      while live also rewrites the public copy at the new revision; while off writes the
 *                     private card only. A save that would leave a live card without a shared contact
 *                     method is refused ('gate') unless turnOffIfGateFails, which saves and turns off.
 *     publishMyCard   turn sharing on (the saved card is what is published), new ID on first publish,
 *                     the same ID after that.
 *     unpublishMyCard turn sharing off; the public copy is deleted; the ID is kept.
 *     resetMyCardLink a new ID; the old public copy is deleted; the old ID stays registered, retired for good.
 *
 * STALE SAVES
 *   A card is loaded with its revision and saved against it:
 *   saveMyCard(card, { expectedRevision }). The write runs in a transaction
 *   that reads the stored revision first and writes only if it still equals
 *   expectedRevision, so a second tab holding an older copy gets a conflict
 *   back (with the newer card) and writes nothing. `null` means "I expect no
 *   card yet": it conflicts with any card that exists, which is also what
 *   stops a blank draft, made after a failed load, from replacing a real card.
 *   Revisions are counted, not timed, so clocks do not matter.
 *
 * NEVER SILENT
 *   Every call returns a result with a `status` and never throws. A failed
 *   load is an 'error', never 'missing'. Nothing saves by itself: suggestions
 *   are read and offered, and only saveMyCard writes.
 */
import {
  CARD_DOC_SEGMENTS, CARD_SCHEMA_VERSION, isValidPublicId, newCard, newPublicId, normalizeCard, publicCardDoc, publishGate,
} from '../../utils/myCardRules.js';
import { buildCardSuggestions } from '../../utils/myCardSuggestions.js';

export const MY_CARD_STATUS = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  REPAIRED: 'repaired',
  SAVED: 'saved',
  CONFLICT: 'conflict',
  INVALID: 'invalid',
  GATE: 'gate',
  ERROR: 'error',
});

export const MY_CARD_ERRORS = Object.freeze({
  SIGNED_OUT: 'signed-out',
  PERMISSION_DENIED: 'permission-denied',
  UNAVAILABLE: 'unavailable',
  NEWER_VERSION: 'newer-version',
  BAD_REQUEST: 'bad-request',
  SHARING_BLOCKED: 'sharing-blocked',
  FAILED: 'failed',
});

const MESSAGES = Object.freeze({
  [MY_CARD_ERRORS.SIGNED_OUT]: 'Sign in to see your card.',
  [MY_CARD_ERRORS.PERMISSION_DENIED]: 'You don\'t have access to this card.',
  [MY_CARD_ERRORS.UNAVAILABLE]: 'Couldn\'t reach IDYNIFY. Check your connection and try again.',
  [MY_CARD_ERRORS.NEWER_VERSION]: 'This card was saved by a newer version of IDYNIFY. Refresh the page to edit it.',
  [MY_CARD_ERRORS.BAD_REQUEST]: 'This card can\'t be saved from here. Reload it and try again.',
  [MY_CARD_ERRORS.SHARING_BLOCKED]: 'Sharing isn\'t available for this account.',
  [MY_CARD_ERRORS.FAILED]: 'Something went wrong with your card. Try again.',
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);

const failure = (code) => ({
  status: MY_CARD_STATUS.ERROR,
  code,
  message: MESSAGES[code],
  retryable: code === MY_CARD_ERRORS.UNAVAILABLE || code === MY_CARD_ERRORS.FAILED,
});

/** A Firestore error as one of ours. Permission-denied keeps its meaning. */
function failureFrom(err) {
  const code = err?.code;
  if (code === 'permission-denied') return failure(MY_CARD_ERRORS.PERMISSION_DENIED);
  if (code === 'unauthenticated') return failure(MY_CARD_ERRORS.SIGNED_OUT);
  if (['unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted', 'cancelled'].includes(code)) {
    return failure(MY_CARD_ERRORS.UNAVAILABLE);
  }
  return failure(MY_CARD_ERRORS.FAILED);
}

/** The stored revision: a whole number, or 0 for a card from before revisions. */
const revisionOf = (data) => (own(data, 'revision') && Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : 0);

/** Whether a save based on `expectedRevision` is out of date against the stored card (null: there is none). */
const isStale = (stored, expectedRevision) => (expectedRevision === null
  ? stored !== null
  : stored === null || revisionOf(stored) !== expectedRevision);

/** Whether the stored card was written by a later version of this schema. */
const isNewerVersion = (data) => own(data, 'schemaVersion') && Number.isFinite(data.schemaVersion) && data.schemaVersion > CARD_SCHEMA_VERSION;

/**
 * What a stored card document means: the card as the editor should hold it,
 * and whether anything had to be repaired to get there. Pure.
 */
/** The ID a stored card names, or null. */
const publicIdOf = (data) => (own(data, 'publicId') && isValidPublicId(data.publicId) ? data.publicId : null);

/** A stored card is live only if it says so AND names a real public ID: anything else is private. */
const isLive = (data) => own(data, 'sharingEnabled') && data.sharingEnabled === true && publicIdOf(data) !== null;

/** What the owner is told about the card's sharing: whether it is live, and the ID and first-publish time it has. */
function sharingOf(data) {
  const publicId = publicIdOf(data);
  return {
    live: isLive(data),
    publicId,
    publishedAt: publicId && own(data, 'publishedAt') && typeof data.publishedAt === 'string' ? data.publishedAt : null,
  };
}

const NOT_SHARED = Object.freeze({ live: false, publicId: null, publishedAt: null });

function interpretStored(data) {
  if (isNewerVersion(data)) return failure(MY_CARD_ERRORS.NEWER_VERSION);
  const { card, errors } = normalizeCard(data);
  const repairs = Object.keys(errors);
  // A card that says it is shared without a real public ID is not shared: that is a repair.
  if (own(data, 'sharingEnabled') && data.sharingEnabled !== false && !isLive(data)) repairs.push('sharingEnabled');
  if (!own(data, 'share') || !isPlainObject(data.share)) repairs.push('share');
  const sharing = sharingOf(data);
  const result = { card: { ...card, sharingEnabled: sharing.live }, revision: revisionOf(data), sharing };
  if (repairs.length === 0) return { status: MY_CARD_STATUS.OK, ...result };
  return { status: MY_CARD_STATUS.REPAIRED, ...result, errors, repairs };
}

const MISSING = () => ({ status: MY_CARD_STATUS.MISSING, card: newCard(), revision: null, sharing: { ...NOT_SHARED } });

/** What the stored document is, as a load result. `snap` is a document snapshot. */
const interpretSnapshot = (snap) => (snap.exists() ? interpretStored(snap.data()) : MISSING());

/** The account fields suggestions may read: nothing else of the user document is passed on. */
function accountForSuggestions(data) {
  if (!isPlainObject(data)) return null;
  const pick = {};
  for (const key of ['displayName', 'firstName', 'lastName', 'name', 'email']) if (own(data, key)) pick[key] = data[key];
  return pick;
}

function reconForSuggestions(data) {
  const answers = isPlainObject(data) && own(data, 'section1Answers') ? data.section1Answers : null;
  if (!isPlainObject(answers)) return null;
  const pick = {};
  for (const key of ['role', 'companyName']) if (own(answers, key)) pick[key] = answers[key];
  return pick;
}

function linkedinForSuggestions(data) {
  if (!isPlainObject(data)) return null;
  const pick = {};
  for (const key of ['status', 'givenName', 'familyName', 'email', 'emailVerified', 'pictureUrl']) if (own(data, key)) pick[key] = data[key];
  return pick;
}

/**
 * @param {object} adapter
 * @param {object} adapter.db  the Firestore instance
 * @param {object} adapter.fs  { doc, getDoc, runTransaction }
 * @param {() => (string|null)} adapter.getSignedInUid  the REAL signed-in uid, or null
 * @param {() => string} [adapter.now]  an ISO time, for tests
 */
export function createMyCardService({
  db, fs, getSignedInUid, now = () => new Date().toISOString(),
}) {
  const { doc, getDoc, runTransaction } = fs;
  const cardRef = (uid) => doc(db, ...CARD_DOC_SEGMENTS(uid));
  const publicRef = (publicId) => doc(db, 'publicCards', publicId);
  const registryRef = (publicId) => doc(db, 'publicIds', publicId);

  /**
   * The signed-in user's card.
   *
   * @returns {Promise<
   *   | { status: 'ok', card: object, revision: number }
   *   | { status: 'repaired', card: object, revision: number, errors: object, repairs: string[] }
   *   | { status: 'missing', card: object, revision: null }
   *   | { status: 'error', code: string, message: string, retryable: boolean }
   * >}
   *   'missing' is only ever a card that was read and is not there. A read that
   *   failed is 'error'. 'repaired' means the stored card had values the rules
   *   refuse (listed in `errors`) or sharing switched on; `card` is the safe
   *   version. Pass `revision` back to saveMyCard.
   */
  async function loadMyCard() {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);
    try {
      return interpretSnapshot(await getDoc(cardRef(uid)));
    } catch (err) {
      return failureFrom(err);
    }
  }

  /** A Firestore refusal as one of ours; for the sharing actions a refusal that is not a stale write is "sharing blocked". */
  async function sharingFailure(err, ref, expectedRevision) {
    if (err?.code === 'permission-denied') {
      // The rules take only the NEXT revision, so a write that lost a race is refused as permission-denied.
      // Look once more: if the card has moved on, that is the conflict it is.
      try {
        const snap = await getDoc(ref);
        const stored = snap.exists() ? snap.data() : null;
        if (!(stored && isNewerVersion(stored)) && isStale(stored, expectedRevision)) {
          return { status: MY_CARD_STATUS.CONFLICT, current: interpretSnapshot(snap) };
        }
      } catch { /* cannot look again: it is reported as the refusal it was */ }
      return failure(MY_CARD_ERRORS.SHARING_BLOCKED);
    }
    return failureFrom(err);
  }

  /** The stored card for a sharing action: the card to act on, or the result to return instead. */
  function storedForAction(snap, expectedRevision) {
    const stored = snap.exists() ? snap.data() : null;
    if (!stored) return { done: failure(MY_CARD_ERRORS.BAD_REQUEST) };
    if (isNewerVersion(stored)) return { done: failure(MY_CARD_ERRORS.NEWER_VERSION) };
    if (isStale(stored, expectedRevision)) return { done: { status: MY_CARD_STATUS.CONFLICT, current: interpretSnapshot(snap) } };
    const { card, errors, valid } = normalizeCard(stored);
    if (!valid) return { done: { status: MY_CARD_STATUS.INVALID, errors } };
    return { stored, card };
  }

  const wellFormedRevision = (value) => Number.isInteger(value) && value >= 0;

  /**
   * Saves the card, if nobody else has saved since `expectedRevision`.
   *
   * @param {object} card  what the editor holds. Normalized here; a card with
   *   a refused value or no name is not saved at all ('invalid').
   * @param {object} options
   * @param {number|null} options.expectedRevision  the revision loadMyCard
   *   returned, or null for "there is no card yet". Required.
   * @param {boolean} [options.turnOffIfGateFails]  when the card is live and this save would leave it
   *   without a shared contact method: save it anyway and turn sharing off (the editor's "Save and turn
   *   off sharing"). Otherwise that save is refused with 'gate' and nothing is written.
   * @returns {Promise<
   *   | { status: 'saved', card: object, revision: number, sharing: object }
   *   | { status: 'conflict', current: object }   the stored card now, as a load result; nothing was written
   *   | { status: 'invalid', errors: object }     nothing was written
   *   | { status: 'gate', fixes: object[] }       the card is live and would have no shared contact method; nothing was written
   *   | { status: 'error', code: string, message: string, retryable: boolean }
   * >}
   */
  async function saveMyCard(card, { expectedRevision, turnOffIfGateFails = false } = {}) {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);

    // A save must name the card it was based on: that is what makes it safe.
    if (!(expectedRevision === null || wellFormedRevision(expectedRevision))) return failure(MY_CARD_ERRORS.BAD_REQUEST);

    const { card: clean, errors, valid } = normalizeCard(card);
    if (!valid) return { status: MY_CARD_STATUS.INVALID, errors };

    const ref = cardRef(uid);
    const at = now();
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const stored = snap.exists() ? snap.data() : null;

        // Never replace a card a newer version of the app wrote: it would lose what this one cannot see.
        if (stored && isNewerVersion(stored)) return failure(MY_CARD_ERRORS.NEWER_VERSION);

        if (isStale(stored, expectedRevision)) return { status: MY_CARD_STATUS.CONFLICT, current: interpretSnapshot(snap) };

        const revision = (stored ? revisionOf(stored) : 0) + 1;
        const createdAt = stored && typeof stored.createdAt === 'string' && stored.createdAt ? stored.createdAt : at;

        // What is shared comes from the STORED card, never from the caller: a draft cannot publish.
        const publicId = stored ? publicIdOf(stored) : null;
        const live = Boolean(stored) && isLive(stored);
        let stayLive = live;
        if (live && !publishGate(clean).ok) {
          if (!turnOffIfGateFails) return { status: MY_CARD_STATUS.GATE, fixes: publishGate(clean).fixes };
          stayLive = false;
        }

        // Built from the normalized card and these fields alone.
        const payload = { ...clean, sharingEnabled: stayLive, revision, createdAt, updatedAt: at };
        if (publicId) {
          payload.publicId = publicId;
          payload.publishedAt = typeof stored.publishedAt === 'string' ? stored.publishedAt : at;
        }
        tx.set(ref, payload);
        if (live) {
          if (stayLive) tx.set(publicRef(publicId), publicCardDoc(clean, { revision, updatedAt: at }));
          else tx.delete(publicRef(publicId));
        }
        return {
          status: MY_CARD_STATUS.SAVED,
          card: { ...clean, sharingEnabled: stayLive },
          revision,
          sharing: { live: stayLive, publicId, publishedAt: payload.publishedAt ?? null },
        };
      });
    } catch (err) {
      // The card rules (firestore.rules) take only the NEXT revision, so when two saves land at the
      // same moment the loser is refused at the server, as permission-denied, before Firestore's own
      // retry can show it the newer card. Nothing was written. Look once more: if the card has moved
      // on, that is the conflict it is, not "no access". A refusal for any other reason stays one.
      if (err?.code === 'permission-denied') {
        try {
          const snap = await getDoc(ref);
          const stored = snap.exists() ? snap.data() : null;
          if (!(stored && isNewerVersion(stored)) && isStale(stored, expectedRevision)) {
            return { status: MY_CARD_STATUS.CONFLICT, current: interpretSnapshot(snap) };
          }
          // Not stale, and the card is live: the only refusal left is the account's standing (suspended, or
          // taken down). Turning sharing off is always allowed, and then the card can be edited.
          if (stored && isLive(stored)) return failure(MY_CARD_ERRORS.SHARING_BLOCKED);
        } catch { /* cannot look again: it is reported as the refusal it was */ }
      }
      return failureFrom(err);
    }
  }

  /**
   * Turns sharing on for the SAVED card (the editor saves first). The first publish makes a new public ID
   * and registers it; turning back on after sharing was off keeps the same ID, so the link and QR code
   * stay the same. Already live is not an error: nothing is written.
   *
   * @returns {Promise<
   *   | { status: 'saved', card: object, revision: number, sharing: { live: true, publicId: string, publishedAt: string } }
   *   | { status: 'gate', fixes: object[] }   no name or no shared contact method; nothing was written
   *   | { status: 'conflict', current: object } | { status: 'invalid', errors: object }
   *   | { status: 'error', code: string, message: string, retryable: boolean }   ('sharing-blocked' when the account may not publish)
   * >}
   */
  async function publishMyCard({ expectedRevision } = {}) {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);
    if (!wellFormedRevision(expectedRevision)) return failure(MY_CARD_ERRORS.BAD_REQUEST);
    const ref = cardRef(uid);
    const at = now();
    try {
      return await runTransaction(db, async (tx) => {
        const found = storedForAction(await tx.get(ref), expectedRevision);
        if (found.done) return found.done;
        const { stored, card } = found;
        if (isLive(stored)) {
          return { status: MY_CARD_STATUS.SAVED, card: { ...card, sharingEnabled: true }, revision: revisionOf(stored), sharing: sharingOf(stored) };
        }
        const gate = publishGate(card);
        if (!gate.ok) return { status: MY_CARD_STATUS.GATE, fixes: gate.fixes };

        const revision = revisionOf(stored) + 1;
        const existingId = publicIdOf(stored);
        const publicId = existingId ?? newPublicId();
        const publishedAt = existingId && typeof stored.publishedAt === 'string' ? stored.publishedAt : at;
        const createdAt = typeof stored.createdAt === 'string' && stored.createdAt ? stored.createdAt : at;
        tx.set(ref, { ...card, sharingEnabled: true, publicId, publishedAt, revision, createdAt, updatedAt: at });
        if (!existingId) tx.set(registryRef(publicId), { ownerUid: uid, createdAt: at });
        tx.set(publicRef(publicId), publicCardDoc(card, { revision, updatedAt: at }));
        return {
          status: MY_CARD_STATUS.SAVED, card: { ...card, sharingEnabled: true }, revision, sharing: { live: true, publicId, publishedAt },
        };
      });
    } catch (err) {
      return sharingFailure(err, ref, expectedRevision);
    }
  }

  /**
   * Turns sharing off: the public copy is deleted at once, and the card keeps its ID and the registry its
   * entry, so turning sharing back on restores the same link. Already off is not an error.
   * Always allowed, whatever the account's standing and whatever the card holds.
   */
  async function unpublishMyCard({ expectedRevision } = {}) {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);
    if (!wellFormedRevision(expectedRevision)) return failure(MY_CARD_ERRORS.BAD_REQUEST);
    const ref = cardRef(uid);
    const at = now();
    try {
      return await runTransaction(db, async (tx) => {
        const found = storedForAction(await tx.get(ref), expectedRevision);
        if (found.done) return found.done;
        const { stored, card } = found;
        if (!isLive(stored)) {
          return { status: MY_CARD_STATUS.SAVED, card: { ...card, sharingEnabled: false }, revision: revisionOf(stored), sharing: sharingOf(stored) };
        }
        const revision = revisionOf(stored) + 1;
        const publicId = publicIdOf(stored);
        const publishedAt = typeof stored.publishedAt === 'string' ? stored.publishedAt : at;
        tx.set(ref, {
          ...card, sharingEnabled: false, publicId, publishedAt, revision,
          createdAt: typeof stored.createdAt === 'string' && stored.createdAt ? stored.createdAt : at, updatedAt: at,
        });
        tx.delete(publicRef(publicId));
        return {
          status: MY_CARD_STATUS.SAVED, card: { ...card, sharingEnabled: false }, revision, sharing: { live: false, publicId, publishedAt },
        };
      });
    } catch (err) {
      return sharingFailure(err, ref, expectedRevision);
    }
  }

  /**
   * Reset Link: a new public ID. The old link and QR code stop working at once (its public copy is deleted
   * in the same write) and the old ID stays registered to this account forever, so it can never be taken
   * again. If the card is live the new link is live; if it is off, only the new ID is named.
   * A card that has never been published has no link to reset ('bad-request').
   */
  async function resetMyCardLink({ expectedRevision } = {}) {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);
    if (!wellFormedRevision(expectedRevision)) return failure(MY_CARD_ERRORS.BAD_REQUEST);
    const ref = cardRef(uid);
    const at = now();
    try {
      return await runTransaction(db, async (tx) => {
        const found = storedForAction(await tx.get(ref), expectedRevision);
        if (found.done) return found.done;
        const { stored, card } = found;
        const oldId = publicIdOf(stored);
        if (!oldId) return failure(MY_CARD_ERRORS.BAD_REQUEST);
        const live = isLive(stored);
        if (live) {
          const gate = publishGate(card);
          if (!gate.ok) return { status: MY_CARD_STATUS.GATE, fixes: gate.fixes };
        }
        const revision = revisionOf(stored) + 1;
        const publicId = newPublicId();
        const publishedAt = typeof stored.publishedAt === 'string' ? stored.publishedAt : at;
        tx.set(ref, {
          ...card, sharingEnabled: live, publicId, publishedAt, revision,
          createdAt: typeof stored.createdAt === 'string' && stored.createdAt ? stored.createdAt : at, updatedAt: at,
        });
        tx.set(registryRef(publicId), { ownerUid: uid, createdAt: at });
        tx.delete(publicRef(oldId));
        if (live) tx.set(publicRef(publicId), publicCardDoc(card, { revision, updatedAt: at }));
        return {
          status: MY_CARD_STATUS.SAVED, card: { ...card, sharingEnabled: live }, revision, sharing: { live, publicId, publishedAt },
        };
      });
    } catch (err) {
      return sharingFailure(err, ref, expectedRevision);
    }
  }

  /**
   * What the account already knows that could fill the card: read-only, for the
   * pure suggestion rules (utils/myCardSuggestions.js). Reads the account
   * document and the LinkedIn connection of the signed-in user, and passes on
   * only the few fields suggestions use. Writes nothing and saves nothing.
   * A source that cannot be read is listed in `unavailable`; the others still
   * count.
   *
   * @returns {Promise<{ suggestions: object, unavailable: string[] }>}
   */
  async function loadCardSuggestions() {
    const uid = getSignedInUid();
    if (!uid) return { suggestions: buildCardSuggestions(), unavailable: ['account', 'linkedin'] };

    const [account, linkedin] = await Promise.allSettled([
      getDoc(doc(db, 'users', uid)),
      getDoc(doc(db, 'users', uid, 'integrations', 'linkedin')),
    ]);
    const dataOf = (settled) => (settled.status === 'fulfilled' && settled.value.exists() ? settled.value.data() : null);
    const accountData = dataOf(account);
    const unavailable = [];
    if (account.status === 'rejected') unavailable.push('account');
    if (linkedin.status === 'rejected') unavailable.push('linkedin');

    return {
      suggestions: buildCardSuggestions({
        account: accountForSuggestions(accountData),
        linkedin: linkedinForSuggestions(dataOf(linkedin)),
        recon: reconForSuggestions(accountData),
      }),
      unavailable,
    };
  }

  return {
    loadMyCard, saveMyCard, publishMyCard, unpublishMyCard, resetMyCardLink, loadCardSuggestions,
  };
}

export default { createMyCardService };
