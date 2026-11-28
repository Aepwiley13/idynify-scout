/**
 * My Card — what the page knows about the card's life: loading, the saved
 * revision, saving, a conflict with a newer saved card, a recovered draft.
 *
 * A reducer and selectors, and nothing else: no React, no storage, no service.
 * The hook that comes next feeds it what the service and the storage say and
 * does what it decides. The text of the draft is NOT here (that is useCardDraft's);
 * this holds everything around it.
 *
 * THE RULES IT KEEPS
 *   - A result is applied only to the request it answers. Every load and save
 *     carries an id; a late answer, or one for a different account, is ignored.
 *     So switching account, retrying, or two saves racing cannot put one
 *     request's answer into another's state.
 *   - Saving is always against a revision. The reducer never offers a way to
 *     save without one (revisionToSaveAgainst), and a never-saved card is the
 *     revision `null`, which the service treats as "there is no card yet".
 *   - A conflict never touches the draft. It is a notice with two choices, and
 *     each choice needs a second, explicit confirmation:
 *       'load-latest'  replace the draft with the saved card
 *       'save-over'    save the draft over the saved card, against THE REVISION
 *                      THAT WAS JUST SEEN. If the card changed again, the answer
 *                      is another conflict (renewed: true) and the confirmation
 *                      starts again; any failed overwrite does the same. There is
 *                      no automatic retry and no way around the revision.
 *     While there is a conflict, Save is unavailable.
 *   - Impersonation (and being signed out) is a blocked load: nothing is read,
 *     nothing is saved and nothing is kept for the draft (shouldPersistDraft).
 */
import { diffCards } from './myCardDiff';

export const MY_CARD_ACTION = Object.freeze({
  LOAD_STARTED: 'load/started',
  LOAD_SUCCEEDED: 'load/succeeded',
  LOAD_FAILED: 'load/failed',
  LOAD_BLOCKED: 'load/blocked',
  SESSION_ENDED: 'session/ended',
  RECOVERY_RESTORED: 'recovery/restored',
  RECOVERY_DISMISSED: 'recovery/dismissed',
  PHOTO_KEEP_CHANGED: 'photo-keep/changed',
  SAVE_STARTED: 'save/started',
  SAVE_OVER_STARTED: 'save/over-started',
  SAVE_SUCCEEDED: 'save/succeeded',
  SAVE_FAILED: 'save/failed',
  SAVE_CONFLICTED: 'save/conflicted',
  CONFLICT_DETECTED: 'conflict/detected',
  CONFLICT_CHOSEN: 'conflict/chosen',
  CONFLICT_CANCELLED: 'conflict/cancelled',
  LOAD_LATEST_CONFIRMED: 'conflict/load-latest-confirmed',
  REVISION_ADVANCED: 'revision/advanced',
});

/** The two ways out of a conflict. */
export const CONFLICT_CHOICE = Object.freeze({ LOAD_LATEST: 'load-latest', SAVE_OVER: 'save-over' });

export const BLOCKED = Object.freeze({ IMPERSONATING: 'impersonating', SIGNED_OUT: 'signed-out' });

export const initialMyCardState = Object.freeze({
  uid: null,
  loadId: 0,
  load: 'idle', // idle | loading | ready | error | blocked
  blocked: null, // BLOCKED.* while load is 'blocked'
  loadError: null, // { code, message, retryable }
  revision: null, // the saved revision the draft is based on; null: nothing saved yet
  isNew: false, // there is no saved card
  repaired: null, // { errors, repairs } when the saved card had to be repaired
  suggestions: Object.freeze({}),
  unavailable: Object.freeze([]), // suggestion sources that could not be read
  recovered: null, // { savedAt, baseRevision, photoLost? } while a restored draft is announced (photoLost only when true)
  photoKept: true, // false while an uploaded photo in the draft could not be kept in the tab's storage
  saveId: 0,
  save: 'idle', // idle | saving | saved | error
  saveError: null, // { code, message, retryable }
  conflict: null, // { current, changes, confirm, renewed }
});

const isObject = (value) => value !== null && typeof value === 'object';
const LOADED = ['ok', 'repaired', 'missing'];

/** An error as the state keeps it: a code, words for a person, and whether trying again can help. */
function errorOf(error) {
  const source = isObject(error) ? error : {};
  return {
    code: typeof source.code === 'string' ? source.code : 'failed',
    message: typeof source.message === 'string' ? source.message : 'Something went wrong with your card. Try again.',
    retryable: source.retryable === true,
  };
}

/** What the service says the saved card is now, as a conflict holds it. Anything unrecognised is an error: no choices. */
function currentOf(current) {
  return isObject(current) && [...LOADED, 'error'].includes(current.status) ? current : { status: 'error', code: 'failed', message: '', retryable: false };
}

/** The choices a conflict allows. A saved card this version cannot read (status 'error') allows neither. */
export function conflictChoices(state) {
  const usable = Boolean(state.conflict) && LOADED.includes(state.conflict.current.status);
  return { canLoadLatest: usable, canSaveOver: usable };
}

const REVISION_OK = (revision) => revision === null || (Number.isInteger(revision) && revision >= 0);

/** The revision of a saved card, from a service result (null for "no card"). */
const revisionOfResult = (result) => (result.status === 'missing' ? null : result.revision);

export function myCardReducer(state = initialMyCardState, action = {}) {
  switch (action?.type) {
    case MY_CARD_ACTION.LOAD_STARTED: {
      if (!Number.isInteger(action.loadId) || action.loadId <= state.loadId) return state;
      if (typeof action.uid !== 'string' || action.uid === '') {
        return { ...initialMyCardState, loadId: action.loadId, saveId: state.saveId, load: 'blocked', blocked: BLOCKED.SIGNED_OUT };
      }
      // Everything starts again, for this account. A save still in flight is no longer awaited.
      return { ...initialMyCardState, uid: action.uid, loadId: action.loadId, saveId: state.saveId, load: 'loading' };
    }

    case MY_CARD_ACTION.LOAD_BLOCKED: {
      if (!Object.values(BLOCKED).includes(action.reason)) return state;
      return { ...initialMyCardState, loadId: state.loadId, saveId: state.saveId, load: 'blocked', blocked: action.reason };
    }

    case MY_CARD_ACTION.SESSION_ENDED:
      return { ...initialMyCardState, loadId: state.loadId, saveId: state.saveId };

    case MY_CARD_ACTION.LOAD_SUCCEEDED: {
      if (state.load !== 'loading' || action.loadId !== state.loadId || action.uid !== state.uid) return state;
      const result = action.result;
      if (!isObject(result) || !LOADED.includes(result.status)) {
        return { ...state, load: 'error', loadError: errorOf(null) };
      }
      if (result.status !== 'missing' && !REVISION_OK(result.revision)) {
        return { ...state, load: 'error', loadError: errorOf(null) };
      }
      return {
        ...state,
        load: 'ready',
        loadError: null,
        revision: revisionOfResult(result),
        isNew: result.status === 'missing',
        repaired: result.status === 'repaired' ? { errors: result.errors ?? {}, repairs: result.repairs ?? [] } : null,
        suggestions: isObject(action.suggestions) ? action.suggestions : {},
        unavailable: Array.isArray(action.unavailable) ? action.unavailable : [],
      };
    }

    case MY_CARD_ACTION.LOAD_FAILED: {
      if (state.load !== 'loading' || action.loadId !== state.loadId || action.uid !== state.uid) return state;
      return { ...state, load: 'error', loadError: errorOf(action.error) };
    }

    case MY_CARD_ACTION.RECOVERY_RESTORED: {
      if (state.load !== 'ready') return state;
      return { ...state, recovered: { savedAt: action.savedAt ?? null, baseRevision: action.baseRevision ?? null, ...(action.photoLost === true ? { photoLost: true } : {}) } };
    }

    case MY_CARD_ACTION.PHOTO_KEEP_CHANGED: {
      if (state.load !== 'ready') return state;
      const photoKept = action.kept !== false;
      return state.photoKept === photoKept ? state : { ...state, photoKept };
    }

    case MY_CARD_ACTION.RECOVERY_DISMISSED:
      return state.recovered ? { ...state, recovered: null } : state;

    case MY_CARD_ACTION.SAVE_STARTED: {
      if (state.load !== 'ready' || state.save === 'saving' || state.conflict) return state;
      if (!Number.isInteger(action.saveId) || action.saveId <= state.saveId) return state;
      return { ...state, save: 'saving', saveId: action.saveId, saveError: null };
    }

    case MY_CARD_ACTION.SAVE_OVER_STARTED: {
      // Only from a conflict whose overwrite has been confirmed, and that can be overwritten.
      if (state.load !== 'ready' || state.save === 'saving' || !state.conflict) return state;
      if (state.conflict.confirm !== CONFLICT_CHOICE.SAVE_OVER || !conflictChoices(state).canSaveOver) return state;
      if (!Number.isInteger(action.saveId) || action.saveId <= state.saveId) return state;
      return { ...state, save: 'saving', saveId: action.saveId, saveError: null };
    }

    case MY_CARD_ACTION.SAVE_SUCCEEDED: {
      if (state.save !== 'saving' || action.saveId !== state.saveId || !Number.isInteger(action.revision) || action.revision < 0) return state;
      return {
        ...state,
        save: 'saved',
        saveError: null,
        revision: action.revision,
        isNew: false,
        conflict: null,
        recovered: null,
        repaired: null,
        photoKept: true,
      };
    }

    // Publishing, turning sharing off and Reset Link each write the card at its next revision. The draft is
    // untouched (they publish what is saved), so only the revision the draft is based on moves with it.
    case MY_CARD_ACTION.REVISION_ADVANCED: {
      if (state.load !== 'ready' || !Number.isInteger(action.revision) || action.revision < 0) return state;
      if (state.revision !== null && action.revision <= state.revision) return state;
      return { ...state, revision: action.revision, isNew: false };
    }

    case MY_CARD_ACTION.SAVE_FAILED: {
      if (state.save !== 'saving' || action.saveId !== state.saveId) return state;
      // A failed overwrite is not retried and not remembered as confirmed: it must be confirmed again.
      const conflict = state.conflict ? { ...state.conflict, confirm: null } : null;
      return { ...state, save: 'error', saveError: errorOf(action.error), conflict };
    }

    case MY_CARD_ACTION.SAVE_CONFLICTED: {
      if (state.save !== 'saving' || action.saveId !== state.saveId) return state;
      return {
        ...state,
        save: 'idle',
        saveError: null,
        // A conflict met while overwriting is a new one: the choice, and its confirmation, start again.
        conflict: {
          current: currentOf(action.current),
          changes: Array.isArray(action.changes) ? action.changes : [],
          confirm: null,
          renewed: state.conflict !== null,
        },
      };
    }

    case MY_CARD_ACTION.CONFLICT_DETECTED: {
      if (state.load !== 'ready' || state.conflict) return state;
      return {
        ...state,
        conflict: {
          current: currentOf(action.current),
          changes: Array.isArray(action.changes) ? action.changes : [],
          confirm: null,
          renewed: false,
        },
      };
    }

    case MY_CARD_ACTION.CONFLICT_CHOSEN: {
      if (!state.conflict || state.save === 'saving') return state;
      const choices = conflictChoices(state);
      const allowed = (action.choice === CONFLICT_CHOICE.LOAD_LATEST && choices.canLoadLatest)
        || (action.choice === CONFLICT_CHOICE.SAVE_OVER && choices.canSaveOver);
      return allowed ? { ...state, conflict: { ...state.conflict, confirm: action.choice } } : state;
    }

    case MY_CARD_ACTION.CONFLICT_CANCELLED: {
      if (!state.conflict || state.save === 'saving' || state.conflict.confirm === null) return state;
      return { ...state, conflict: { ...state.conflict, confirm: null } };
    }

    case MY_CARD_ACTION.LOAD_LATEST_CONFIRMED: {
      const { conflict } = state;
      if (!conflict || state.save === 'saving' || conflict.confirm !== CONFLICT_CHOICE.LOAD_LATEST || !conflictChoices(state).canLoadLatest) return state;
      const { current } = conflict;
      return {
        ...state,
        revision: revisionOfResult(current),
        isNew: current.status === 'missing',
        repaired: current.status === 'repaired' ? { errors: current.errors ?? {}, repairs: current.repairs ?? [] } : null,
        conflict: null,
        recovered: null,
        photoKept: true,
        save: 'idle',
        saveError: null,
      };
    }

    default:
      return state;
  }
}

// ── What the page asks of the state ─────────────────────────────────────────

export const isReadOnly = (state) => state.load === 'blocked';
export const isReady = (state) => state.load === 'ready';

/**
 * The revision a save must be made against: the one the draft is based on, or,
 * when overwriting after a confirmed conflict, the one that was just seen
 * (`null` where the saved card has since been deleted).
 */
export function revisionToSaveAgainst(state) {
  if (state.conflict?.confirm === CONFLICT_CHOICE.SAVE_OVER && conflictChoices(state).canSaveOver) {
    return revisionOfResult(state.conflict.current);
  }
  return state.revision;
}

/**
 * Whether Save can be pressed, and if not, why.
 * `dirty` is the draft's own (useCardDraft); a card that was never saved can be saved untouched.
 *
 * @returns {{ enabled: boolean, reason: null|'read-only'|'loading'|'load-error'|'saving'|'conflict'|'nothing-to-save' }}
 */
export function saveAvailability(state, { dirty = false } = {}) {
  const no = (reason) => ({ enabled: false, reason });
  if (state.load === 'blocked') return no('read-only');
  if (state.load === 'error') return no('load-error');
  if (state.load !== 'ready') return no('loading');
  if (state.save === 'saving') return no('saving');
  if (state.conflict) return no('conflict');
  if (!dirty && !state.isNew) return no('nothing-to-save');
  return { enabled: true, reason: null };
}

/**
 * One word for the page's status line.
 * @returns {'read-only'|'loading'|'load-error'|'saving'|'conflict'|'save-error'|'unsaved'|'new'|'saved'}
 */
export function statusOf(state, { dirty = false } = {}) {
  if (state.load === 'blocked') return 'read-only';
  if (state.load === 'error') return 'load-error';
  if (state.load !== 'ready') return 'loading';
  if (state.save === 'saving') return 'saving';
  if (state.conflict) return 'conflict';
  if (state.save === 'error') return 'save-error';
  if (dirty) return 'unsaved';
  if (state.isNew) return 'new';
  return 'saved';
}

/** Whether leaving the page should be warned about: there is something unsaved, and it is the person's to lose. */
export const shouldWarnBeforeUnload = (state, { dirty = false } = {}) => state.load === 'ready' && dirty === true;

/**
 * Whether the draft should be kept in the tab's storage. Never while read-only (impersonation, signed out),
 * never before the card has loaded, and never for a draft with nothing in it that is not already saved.
 */
export const shouldPersistDraft = (state, { dirty = false } = {}) => state.load === 'ready' && dirty === true;

/**
 * What to do with a draft found in storage, once the saved card has loaded.
 *
 *   none      nothing usable was kept
 *   discard   the draft says what the saved card says: forget it
 *   restore   the draft started from the saved revision: put it back, with a notice
 *   conflict  the draft started from an older revision: put it back, with the conflict notice,
 *             and the differences. The draft is kept as it is, and the choice is the person's.
 *
 * @param {{ stored: ReturnType<import('./myCardDraftStorage').readDraft>, loaded: { card: object, revision: number|null } }} input
 */
export function planRecovery({ stored, loaded }) {
  if (!isObject(stored) || stored.status !== 'ok') return { action: 'none' };
  const { draft } = stored;
  const { changes } = diffCards(draft.card, loaded.card);
  // An uploaded photo that was in the draft and is not there to give back is told to the person, even when
  // nothing else differs: forgetting the draft would forget that it was ever there.
  const photoLost = draft.photoLost === true;
  const base = { card: draft.card, savedAt: draft.savedAt, baseRevision: draft.baseRevision, ...(photoLost ? { photoLost } : {}) };
  if (changes.length === 0) return photoLost ? { action: 'restore', ...base } : { action: 'discard' };
  if (draft.baseRevision === loaded.revision) return { action: 'restore', ...base };
  return { action: 'conflict', ...base, changes };
}
