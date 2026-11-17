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
 *   `sharingEnabled` is written false every time. Nothing else is stored: no
 *   suggestion, no source, nothing the caller added.
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
  CARD_DOC_SEGMENTS, CARD_SCHEMA_VERSION, newCard, normalizeCard,
} from '../../utils/myCardRules.js';
import { buildCardSuggestions } from '../../utils/myCardSuggestions.js';

export const MY_CARD_STATUS = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  REPAIRED: 'repaired',
  SAVED: 'saved',
  CONFLICT: 'conflict',
  INVALID: 'invalid',
  ERROR: 'error',
});

export const MY_CARD_ERRORS = Object.freeze({
  SIGNED_OUT: 'signed-out',
  PERMISSION_DENIED: 'permission-denied',
  UNAVAILABLE: 'unavailable',
  NEWER_VERSION: 'newer-version',
  BAD_REQUEST: 'bad-request',
  FAILED: 'failed',
});

const MESSAGES = Object.freeze({
  [MY_CARD_ERRORS.SIGNED_OUT]: 'Sign in to see your card.',
  [MY_CARD_ERRORS.PERMISSION_DENIED]: 'You don\'t have access to this card.',
  [MY_CARD_ERRORS.UNAVAILABLE]: 'Couldn\'t reach IDYNIFY. Check your connection and try again.',
  [MY_CARD_ERRORS.NEWER_VERSION]: 'This card was saved by a newer version of IDYNIFY. Refresh the page to edit it.',
  [MY_CARD_ERRORS.BAD_REQUEST]: 'This card can\'t be saved from here. Reload it and try again.',
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

/** Whether the stored card was written by a later version of this schema. */
const isNewerVersion = (data) => own(data, 'schemaVersion') && Number.isFinite(data.schemaVersion) && data.schemaVersion > CARD_SCHEMA_VERSION;

/**
 * What a stored card document means: the card as the editor should hold it,
 * and whether anything had to be repaired to get there. Pure.
 */
function interpretStored(data) {
  if (isNewerVersion(data)) return failure(MY_CARD_ERRORS.NEWER_VERSION);
  const { card, errors } = normalizeCard(data);
  // In this phase nothing may be shared, whatever a stored record says.
  const repairs = Object.keys(errors);
  if (own(data, 'sharingEnabled') && data.sharingEnabled !== false) repairs.push('sharingEnabled');
  if (!own(data, 'share') || !isPlainObject(data.share)) repairs.push('share');
  const result = { card: { ...card, sharingEnabled: false }, revision: revisionOf(data) };
  if (repairs.length === 0) return { status: MY_CARD_STATUS.OK, ...result };
  return { status: MY_CARD_STATUS.REPAIRED, ...result, errors, repairs };
}

const MISSING = () => ({ status: MY_CARD_STATUS.MISSING, card: newCard(), revision: null });

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

  /**
   * Saves the card, if nobody else has saved since `expectedRevision`.
   *
   * @param {object} card  what the editor holds. Normalized here; a card with
   *   a refused value or no name is not saved at all ('invalid').
   * @param {object} options
   * @param {number|null} options.expectedRevision  the revision loadMyCard
   *   returned, or null for "there is no card yet". Required.
   * @returns {Promise<
   *   | { status: 'saved', card: object, revision: number }
   *   | { status: 'conflict', current: object }   the stored card now, as a load result; nothing was written
   *   | { status: 'invalid', errors: object }     nothing was written
   *   | { status: 'error', code: string, message: string, retryable: boolean }
   * >}
   */
  async function saveMyCard(card, { expectedRevision } = {}) {
    const uid = getSignedInUid();
    if (!uid) return failure(MY_CARD_ERRORS.SIGNED_OUT);

    // A save must name the card it was based on: that is what makes it safe.
    const wellFormed = expectedRevision === null || (Number.isInteger(expectedRevision) && expectedRevision >= 0);
    if (!wellFormed) return failure(MY_CARD_ERRORS.BAD_REQUEST);

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

        const stale = expectedRevision === null ? stored !== null : stored === null || revisionOf(stored) !== expectedRevision;
        if (stale) return { status: MY_CARD_STATUS.CONFLICT, current: interpretSnapshot(snap) };

        const revision = (stored ? revisionOf(stored) : 0) + 1;
        const createdAt = stored && typeof stored.createdAt === 'string' && stored.createdAt ? stored.createdAt : at;
        // Built from the normalized card and these fields alone.
        const payload = { ...clean, sharingEnabled: false, revision, createdAt, updatedAt: at };
        tx.set(ref, payload);
        return { status: MY_CARD_STATUS.SAVED, card: { ...clean, sharingEnabled: false }, revision };
      });
    } catch (err) {
      return failureFrom(err);
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

  return { loadMyCard, saveMyCard, loadCardSuggestions };
}

export default { createMyCardService };
