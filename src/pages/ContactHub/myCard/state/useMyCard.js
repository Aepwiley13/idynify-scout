/**
 * useMyCard — the My Card screen's brain: it loads the card, keeps the draft
 * safe, saves it, and settles a conflict. It adds no rules of its own. The
 * rules are in myCardState (what may happen when), myCardDraftStorage (what is
 * kept, for whom, for how long) and myCardDiff (what differs); this hook only
 * connects them to the service and to React, in one place.
 *
 * Everything outside the page is injected, so this file imports no Firebase,
 * no service and no browser storage of its own:
 *   service      { loadMyCard, saveMyCard, loadCardSuggestions } (services/myCardService)
 *   uid          the REAL signed-in account's uid (never an impersonated one), or null
 *   impersonating  an admin is viewing as someone else: nothing is read, saved or kept
 *   currentUid   () => the uid signed in right now. A draft is written only while it is
 *                still the account that wrote it, so a page closing as someone signs
 *                out cannot write that person's draft back after sign-out cleared it.
 *   storage, now, debounceMs  for tests
 *
 * WHAT HAPPENS
 *   Load      The card and the suggestions are read together. A card that does
 *             not exist yet starts as a NEW card, pre-filled in memory from the
 *             suggestions (nothing is saved or kept for it). A kept draft is
 *             then looked at (planRecovery): forgotten if it says what is saved,
 *             restored with a notice if it began from the saved revision,
 *             restored WITH a conflict if it began from an older one. Drafts of
 *             other accounts are forgotten first.
 *   Keeping   While there are unsaved changes the draft is kept after a pause
 *             (500 ms), and at once when the page is hidden or closed, when the
 *             page is left, and never for an account that has signed out. A
 *             draft that is clean again is forgotten.
 *   Leaving   A browser warning (beforeunload) while there are unsaved changes.
 *             Leaving inside the app cannot be stopped under a BrowserRouter, so
 *             it does not need to be: the draft is kept and comes back.
 *   Save      Always against a revision (revisionToSaveAgainst). A card that is
 *             not valid is not sent: its messages are shown. Typing during a save
 *             is kept, as unsaved changes on top of what was saved.
 *   Conflict  The draft is never touched. The person chooses, and confirms:
 *             Load latest (replaces the draft) or Save my version over it (saves
 *             against the revision just seen; if the card changed again it stops
 *             and asks again).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useCardDraft } from '../useCardDraft';
import { newCard } from '../../../../utils/myCardRules';
import { prefilledNewCard } from '../../../../utils/myCardSuggestions';
import { diffCards } from './myCardDiff';
import { clearDraft, purgeOtherAccounts, readDraft, saveDraft } from './myCardDraftStorage';
import {
  BLOCKED, CONFLICT_CHOICE, MY_CARD_ACTION as A, conflictChoices, initialMyCardState, myCardReducer, planRecovery,
  revisionToSaveAgainst, saveAvailability, shouldPersistDraft, shouldWarnBeforeUnload, statusOf,
} from './myCardState';

export const PERSIST_DEBOUNCE_MS = 500;

const UNREADABLE = Object.freeze({ code: 'failed', message: 'Something went wrong with your card. Try again.', retryable: true });

/**
 * @param {object} options  see the header
 */
export function useMyCard({
  uid = null, impersonating = false, service, currentUid = null, storage, now = Date.now, debounceMs = PERSIST_DEBOUNCE_MS,
}) {
  const draft = useCardDraft(newCard());
  const [state, dispatch] = useReducer(myCardReducer, initialMyCardState);
  const [reloadToken, setReloadToken] = useState(0);

  // Latest values, for code that runs later (timers, listeners, answers that arrive late).
  const stateRef = useRef(state);
  const draftRef = useRef(draft);
  const latest = useRef({ uid: null, card: null, revision: null, persist: false });
  useEffect(() => { stateRef.current = state; draftRef.current = draft; });

  const loadCounter = useRef(0);
  const saveCounter = useRef(0);
  // Changes whenever the account, the mode or the page itself changes: answers from an older one are dropped.
  const generation = useRef(0);
  // True once a load has been handled, draft and all. Before it, nothing is kept or forgotten.
  const hydrated = useRef(false);
  const timer = useRef(null);

  const options = useMemo(() => ({ storage }), [storage]);
  // Read through a ref, so the things that listen for the page closing do not change when a caller passes a new function each render.
  const outside = useRef({ currentUid, now, options });
  useEffect(() => { outside.current = { currentUid, now, options }; });

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  /** Keeps the draft now, if it should be kept and its account is still the one signed in. */
  const flush = useCallback(() => {
    cancelTimer();
    const l = latest.current;
    const { currentUid: signedIn, now: clock, options: storageOptions } = outside.current;
    if (!l.persist || !l.uid || (signedIn && signedIn() !== l.uid)) return;
    const kept = saveDraft({ uid: l.uid, card: l.card, baseRevision: l.revision }, { ...storageOptions, now: clock() });
    // An uploaded photo that could not be kept is said so, never dropped silently; a draft with none is fine.
    dispatch({ type: A.PHOTO_KEEP_CHANGED, kept: kept?.photoKept !== false });
  }, [cancelTimer]);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    hydrated.current = false;
    cancelTimer();
    const alive = () => generation.current === mine;

    // Whatever was on screen belongs to the account or mode that has just ended.
    draft.reset(newCard());

    if (impersonating) {
      // Read-only, and nothing touches the tab's storage, not even to forget.
      dispatch({ type: A.LOAD_BLOCKED, reason: BLOCKED.IMPERSONATING });
      return () => { generation.current += 1; };
    }
    loadCounter.current += 1;
    const loadId = loadCounter.current;
    if (!uid) {
      dispatch({ type: A.LOAD_STARTED, uid: null, loadId });
      return () => { generation.current += 1; };
    }

    dispatch({ type: A.LOAD_STARTED, uid, loadId });
    purgeOtherAccounts(uid, options);

    (async () => {
      let loaded;
      let suggested;
      try {
        [loaded, suggested] = await Promise.all([service.loadMyCard(), service.loadCardSuggestions()]);
      } catch {
        loaded = { status: 'error', ...UNREADABLE };
        suggested = { suggestions: {}, unavailable: [] };
      }
      if (!alive()) return;
      if (!loaded || loaded.status === 'error') {
        dispatch({ type: A.LOAD_FAILED, loadId, uid, error: loaded ?? UNREADABLE });
        return;
      }
      const suggestions = suggested?.suggestions ?? {};
      const unavailable = suggested?.unavailable ?? [];
      // Where the draft is measured from: the saved card, or, for a card never saved, the
      // pre-filled new one (which is not unsaved work: it is made again from the account).
      const isNew = loaded.status === 'missing';
      const baseline = isNew ? prefilledNewCard(suggestions) : loaded.card;
      const revision = isNew ? null : loaded.revision;

      const plan = planRecovery({ stored: readDraft(uid, { ...options, now: outside.current.now() }), loaded: { card: baseline, revision } });
      if (plan.action === 'restore' || plan.action === 'conflict') draft.reset(baseline, plan.card);
      else draft.reset(baseline);
      if (plan.action === 'discard') clearDraft(uid, options);

      hydrated.current = true;
      dispatch({ type: A.LOAD_SUCCEEDED, loadId, uid, result: loaded, suggestions, unavailable });
      if (plan.action === 'restore' || plan.action === 'conflict') {
        dispatch({ type: A.RECOVERY_RESTORED, savedAt: plan.savedAt, baseRevision: plan.baseRevision, photoLost: plan.photoLost });
      }
      if (plan.action === 'conflict') dispatch({ type: A.CONFLICT_DETECTED, current: loaded, changes: plan.changes });
    })();

    return () => { generation.current += 1; };
    // draft.reset is stable; the rest are the things a load depends on.
  }, [uid, impersonating, reloadToken, service, options, cancelTimer, draft.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keeping the draft ──────────────────────────────────────────────────────
  const persist = shouldPersistDraft(state, { dirty: draft.dirty });
  const warn = shouldWarnBeforeUnload(state, { dirty: draft.dirty });

  useEffect(() => {
    latest.current = { uid, card: draft.card, revision: state.revision, persist: persist && hydrated.current && !impersonating };
  });

  useEffect(() => {
    if (state.load !== 'ready' || impersonating || !hydrated.current) return undefined;
    if (!persist) {
      // Back to what is saved: nothing to keep.
      if (uid && (!outside.current.currentUid || outside.current.currentUid() === uid)) clearDraft(uid, options);
      return undefined;
    }
    cancelTimer();
    timer.current = setTimeout(flush, debounceMs);
    return cancelTimer;
  }, [state.load, impersonating, persist, draft.card, state.revision, uid, options, debounceMs, flush, cancelTimer]);

  // The page being hidden or closed, and the page being left inside the app, keep the draft at once.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [flush]);

  // A browser warning, only while there is something unsaved to lose.
  useEffect(() => {
    if (!warn || impersonating) return undefined;
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [warn, impersonating]);

  // ── Saving ─────────────────────────────────────────────────────────────────
  const performSave = useCallback(async ({ over }) => {
    const s = stateRef.current;
    const d = draftRef.current;
    if (over) {
      if (s.conflict?.confirm !== CONFLICT_CHOICE.SAVE_OVER || !conflictChoices(s).canSaveOver) return { status: 'blocked' };
    } else if (!saveAvailability(s, { dirty: d.dirty }).enabled) {
      return { status: 'blocked' };
    }
    if (!d.valid) {
      d.showAllErrors();
      return { status: 'invalid' };
    }

    saveCounter.current += 1;
    const saveId = saveCounter.current;
    const mine = generation.current;
    const account = uid;
    const cardAtSave = d.card;
    const expectedRevision = revisionToSaveAgainst(s);
    dispatch({ type: over ? A.SAVE_OVER_STARTED : A.SAVE_STARTED, saveId });

    let result;
    try {
      result = await service.saveMyCard(cardAtSave, { expectedRevision });
    } catch {
      result = { status: 'error', ...UNREADABLE };
    }
    // The account or mode changed while this was away: its answer belongs to nobody here now.
    if (generation.current !== mine) return { status: 'stale' };

    if (result?.status === 'saved') {
      dispatch({ type: A.SAVE_SUCCEEDED, saveId, revision: result.revision });
      cancelTimer();
      clearDraft(account, options);
      // The saved card is the new starting point. Typing done while it was saving stays, as unsaved changes.
      const hasUnsavedChanges = draftRef.current.card !== cardAtSave;
      if (!hasUnsavedChanges) draftRef.current.reset(result.card);
      else draftRef.current.reset(result.card, draftRef.current.card);
      return { status: 'saved', hasUnsavedChanges };
    }
    if (result?.status === 'conflict') {
      const current = result.current;
      const changes = current?.card ? diffCards(cardAtSave, current.card).changes : [];
      dispatch({ type: A.SAVE_CONFLICTED, saveId, current, changes });
      return { status: 'conflict' };
    }
    if (result?.status === 'invalid') {
      draftRef.current.showAllErrors();
      dispatch({ type: A.SAVE_FAILED, saveId, error: { code: 'invalid', message: 'Check the fields marked above.', retryable: false } });
      return { status: 'invalid' };
    }
    dispatch({ type: A.SAVE_FAILED, saveId, error: result?.status === 'error' ? result : UNREADABLE });
    return { status: 'error' };
  }, [uid, service, options, cancelTimer]);

  const save = useCallback(() => performSave({ over: false }), [performSave]);
  const confirmSaveOver = useCallback(() => performSave({ over: true }), [performSave]);

  // ── Conflict, and a recovered draft ────────────────────────────────────────
  const chooseConflict = useCallback((choice) => dispatch({ type: A.CONFLICT_CHOSEN, choice }), []);
  const cancelConflict = useCallback(() => dispatch({ type: A.CONFLICT_CANCELLED }), []);

  /** Replaces the draft with the latest saved card. Only after Load latest was chosen. */
  const confirmLoadLatest = useCallback(() => {
    const s = stateRef.current;
    if (s.conflict?.confirm !== CONFLICT_CHOICE.LOAD_LATEST || !conflictChoices(s).canLoadLatest) return false;
    const { current } = s.conflict;
    dispatch({ type: A.LOAD_LATEST_CONFIRMED });
    draftRef.current.reset(current.status === 'missing' ? prefilledNewCard(s.suggestions) : current.card);
    if (uid) clearDraft(uid, options);
    cancelTimer();
    return true;
  }, [uid, options, cancelTimer]);

  /** "Discard changes" on a restored draft: back to the saved card, and the draft forgotten. */
  const discardRecovered = useCallback(() => {
    const s = stateRef.current;
    if (!s.recovered) return false;
    cancelTimer();
    if (s.conflict) {
      // The restored draft was older than the saved card: discarding it is loading the latest.
      const { current } = s.conflict;
      dispatch({ type: A.CONFLICT_CHOSEN, choice: CONFLICT_CHOICE.LOAD_LATEST });
      dispatch({ type: A.LOAD_LATEST_CONFIRMED });
      draftRef.current.reset(current.status === 'missing' ? prefilledNewCard(s.suggestions) : current.card);
    } else {
      draftRef.current.discard();
      dispatch({ type: A.RECOVERY_DISMISSED });
    }
    if (uid) clearDraft(uid, options);
    return true;
  }, [uid, options, cancelTimer]);

  const dismissRecovered = useCallback(() => dispatch({ type: A.RECOVERY_DISMISSED }), []);
  const retryLoad = useCallback(() => setReloadToken((token) => token + 1), []);

  const actions = useMemo(() => ({
    save, confirmSaveOver, chooseConflict, cancelConflict, confirmLoadLatest, discardRecovered, dismissRecovered, retryLoad,
  }), [save, confirmSaveOver, chooseConflict, cancelConflict, confirmLoadLatest, discardRecovered, dismissRecovered, retryLoad]);

  return {
    draft,
    state,
    status: statusOf(state, { dirty: draft.dirty }),
    availability: saveAvailability(state, { dirty: draft.dirty }),
    choices: conflictChoices(state),
    actions,
  };
}

export default useMyCard;
