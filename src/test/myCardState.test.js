/**
 * My Card's state, on its own: the card's life around the draft. Loading, the
 * saved revision, saving, a conflict, a recovered draft, impersonation, and
 * what the page may ask. A reducer and selectors, so every case is a list of
 * actions and what the state says after them.
 */
import { describe, it, expect } from 'vitest';
import {
  BLOCKED, CONFLICT_CHOICE, MY_CARD_ACTION as A, conflictChoices, initialMyCardState, isReadOnly, isReady,
  myCardReducer, planRecovery, revisionToSaveAgainst, saveAvailability, shouldPersistDraft,
  shouldWarnBeforeUnload, statusOf,
} from '../pages/ContactHub/myCard/state/myCardState';
import { DEFAULT_SHARE, newCard } from '../utils/myCardRules';

const run = (state, ...actions) => actions.reduce(myCardReducer, state);
const savedCard = (extra = {}) => ({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', ...extra });
const okResult = (revision = 3, extra = {}) => ({ status: 'ok', card: savedCard(extra), revision });
const missingResult = () => ({ status: 'missing', card: newCard(), revision: null });

const loading = (uid = 'U', loadId = 1) => run(initialMyCardState, { type: A.LOAD_STARTED, uid, loadId });
const ready = (result = okResult(), { uid = 'U', loadId = 1, suggestions = {}, unavailable = [] } = {}) => (
  run(loading(uid, loadId), { type: A.LOAD_SUCCEEDED, loadId, uid, result, suggestions, unavailable })
);
const startSave = (state, saveId = 1) => run(state, { type: A.SAVE_STARTED, saveId });
const conflictAfterSave = (state, current = okResult(5, { title: 'Newer' }), saveId = 1) => run(
  startSave(state, saveId),
  { type: A.SAVE_CONFLICTED, saveId, current, changes: [{ kind: 'value', field: 'title', label: 'Title' }] },
);
const choose = (state, choice) => run(state, { type: A.CONFLICT_CHOSEN, choice });

describe('loading', () => {
  it('starts idle, and loading once it is started for an account', () => {
    expect(initialMyCardState.load).toBe('idle');
    const state = loading('U', 1);
    expect(state).toMatchObject({ uid: 'U', loadId: 1, load: 'loading' });
    expect(isReady(state)).toBe(false);
  });

  it('is ready with the saved revision when the card exists', () => {
    const state = ready(okResult(7), { suggestions: { title: { value: 'x', source: 'recon' } }, unavailable: ['linkedin'] });
    expect(state).toMatchObject({ load: 'ready', revision: 7, isNew: false, repaired: null, unavailable: ['linkedin'] });
    expect(state.suggestions.title.value).toBe('x');
    expect(isReady(state)).toBe(true);
  });

  it('is ready with no revision, and new, when there is no saved card', () => {
    expect(ready(missingResult())).toMatchObject({ load: 'ready', revision: null, isNew: true });
  });

  it('keeps what had to be repaired', () => {
    const state = ready({ status: 'repaired', card: savedCard(), revision: 2, errors: { email: 'x' }, repairs: ['email', 'sharingEnabled'] });
    expect(state.repaired).toEqual({ errors: { email: 'x' }, repairs: ['email', 'sharingEnabled'] });
    expect(state.revision).toBe(2);
  });

  it('is an error, with what to say and whether to retry, when the load fails', () => {
    const state = run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: { code: 'unavailable', message: 'Offline.', retryable: true } });
    expect(state).toMatchObject({ load: 'error', loadError: { code: 'unavailable', message: 'Offline.', retryable: true } });
  });

  it('gives a failure with nothing in it plain words, and a result it cannot read the same', () => {
    expect(run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U' }).loadError).toMatchObject({ code: 'failed', retryable: false });
    expect(run(loading(), { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: { status: 'error' } }).load).toBe('error');
    expect(run(loading(), { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: { status: 'ok', revision: -1, card: {} } }).load).toBe('error');
    expect(run(loading(), { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: null }).load).toBe('error');
  });

  it('can be retried after an error, and starts again from nothing', () => {
    const failed = run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: { code: 'unavailable' } });
    const retry = run(failed, { type: A.LOAD_STARTED, uid: 'U', loadId: 2 });
    expect(retry).toMatchObject({ load: 'loading', loadError: null, loadId: 2 });
  });

  it('refuses a load start that does not move forward', () => {
    const state = loading('U', 5);
    expect(run(state, { type: A.LOAD_STARTED, uid: 'U', loadId: 5 })).toBe(state);
    expect(run(state, { type: A.LOAD_STARTED, uid: 'U', loadId: 4 })).toBe(state);
    expect(run(state, { type: A.LOAD_STARTED, uid: 'U', loadId: '6' })).toBe(state);
  });

  it('is blocked, as signed out, when there is no account', () => {
    for (const uid of ['', null, undefined, 7]) {
      expect(run(initialMyCardState, { type: A.LOAD_STARTED, uid, loadId: 1 })).toMatchObject({ load: 'blocked', blocked: BLOCKED.SIGNED_OUT }, String(uid));
    }
  });
});

describe('answers only to the request they answer', () => {
  it('ignores a load answer for an older load', () => {
    const state = loading('U', 2);
    expect(run(state, { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: okResult() })).toBe(state);
    expect(run(state, { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: {} })).toBe(state);
  });

  it('ignores a load answer for another account', () => {
    const state = loading('U', 1);
    expect(run(state, { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'OTHER', result: okResult() })).toBe(state);
  });

  it('ignores a load answer when nothing is loading', () => {
    const state = ready();
    expect(run(state, { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: okResult(9) })).toBe(state);
  });

  it('on switching account, starts again and ignores everything the first account was waiting for', () => {
    const first = startSave(ready(okResult(3), { uid: 'A' }), 1);
    expect(first.save).toBe('saving');
    const second = run(first, { type: A.LOAD_STARTED, uid: 'B', loadId: 2 });
    expect(second).toMatchObject({ uid: 'B', load: 'loading', save: 'idle', revision: null, conflict: null, recovered: null });
    // A's load and A's save both come back late: neither lands in B's state.
    const afterLate = run(
      second,
      { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'A', result: okResult(3) },
      { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 },
      { type: A.SAVE_CONFLICTED, saveId: 1, current: okResult(9), changes: [] },
      { type: A.SAVE_FAILED, saveId: 1, error: {} },
    );
    expect(afterLate).toBe(second);
    const bReady = run(afterLate, { type: A.LOAD_SUCCEEDED, loadId: 2, uid: 'B', result: okResult(11) });
    expect(bReady).toMatchObject({ uid: 'B', revision: 11, load: 'ready' });
  });

  it('ignores a save answer for an older save, or one that is not in flight', () => {
    const state = startSave(ready(okResult(3)), 2);
    expect(run(state, { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 })).toBe(state);
    expect(run(state, { type: A.SAVE_FAILED, saveId: 1, error: {} })).toBe(state);
    expect(run(state, { type: A.SAVE_CONFLICTED, saveId: 1, current: okResult(9), changes: [] })).toBe(state);
    const idle = ready();
    expect(run(idle, { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 })).toBe(idle);
  });

  it('does not start a second save while one is in flight, and ids must move forward', () => {
    const saving = startSave(ready(), 5);
    expect(run(saving, { type: A.SAVE_STARTED, saveId: 6 })).toBe(saving);
    const idle = ready();
    expect(run(idle, { type: A.SAVE_STARTED, saveId: 0 })).toBe(idle);
    const done = run(saving, { type: A.SAVE_SUCCEEDED, saveId: 5, revision: 4 });
    expect(run(done, { type: A.SAVE_STARTED, saveId: 5 })).toBe(done);
    expect(run(done, { type: A.SAVE_STARTED, saveId: 6 }).save).toBe('saving');
  });

  it('does not start a save before the card has loaded, or after a failed load', () => {
    const stillLoading = loading();
    expect(startSave(stillLoading)).toBe(stillLoading);
    const failed = run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: { code: 'unavailable' } });
    expect(startSave(failed)).toBe(failed);
  });
});

describe('saving', () => {
  it('is against the revision the draft is based on, and moves it on when it succeeds', () => {
    const saving = startSave(ready(okResult(3)), 1);
    expect(saving.save).toBe('saving');
    expect(revisionToSaveAgainst(saving)).toBe(3);
    const saved = run(saving, { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 });
    expect(saved).toMatchObject({ save: 'saved', revision: 4, isNew: false, saveError: null });
    // The next save is against the revision just made.
    expect(revisionToSaveAgainst(saved)).toBe(4);
    expect(startSave(saved, 2).save).toBe('saving');
  });

  it('is against "no card yet" for a card that was never saved, and then against its first revision', () => {
    const fresh = ready(missingResult());
    expect(revisionToSaveAgainst(fresh)).toBeNull();
    const saved = run(startSave(fresh, 1), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 1 });
    expect(saved).toMatchObject({ revision: 1, isNew: false });
    expect(revisionToSaveAgainst(saved)).toBe(1);
  });

  it('clears the notices about a recovered draft and a repaired card once it succeeds', () => {
    const state = run(
      ready({ status: 'repaired', card: savedCard(), revision: 2, errors: { email: 'x' }, repairs: ['email'] }),
      { type: A.RECOVERY_RESTORED, savedAt: 1, baseRevision: 2 },
    );
    expect(state.recovered).not.toBeNull();
    const saved = run(startSave(state), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 3 });
    expect(saved.recovered).toBeNull();
    expect(saved.repaired).toBeNull();
  });

  it('refuses a revision that is not a whole number', () => {
    const saving = startSave(ready());
    for (const revision of [-1, 1.5, '4', null, undefined, NaN]) {
      expect(run(saving, { type: A.SAVE_SUCCEEDED, saveId: 1, revision })).toBe(saving);
    }
  });

  it('keeps the revision and says what failed, when a save fails, and can be tried again', () => {
    const failed = run(startSave(ready(okResult(3))), { type: A.SAVE_FAILED, saveId: 1, error: { code: 'unavailable', message: 'Offline.', retryable: true } });
    expect(failed).toMatchObject({ save: 'error', revision: 3, saveError: { code: 'unavailable', retryable: true } });
    const again = startSave(failed, 2);
    expect(again).toMatchObject({ save: 'saving', saveError: null });
  });
});

describe('what the page may ask: can it save, what to say, whether to warn', () => {
  it('can save a changed card that has loaded', () => {
    expect(saveAvailability(ready(), { dirty: true })).toEqual({ enabled: true, reason: null });
  });

  it('has nothing to save for a saved card that has not changed, but can save a new one as it is', () => {
    expect(saveAvailability(ready(), { dirty: false })).toEqual({ enabled: false, reason: 'nothing-to-save' });
    expect(saveAvailability(ready(missingResult()), { dirty: false })).toEqual({ enabled: true, reason: null });
  });

  it('says why not, in a fixed order', () => {
    expect(saveAvailability(initialMyCardState, { dirty: true }).reason).toBe('loading');
    expect(saveAvailability(loading(), { dirty: true }).reason).toBe('loading');
    const failed = run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: {} });
    expect(saveAvailability(failed, { dirty: true }).reason).toBe('load-error');
    expect(saveAvailability(run(initialMyCardState, { type: A.LOAD_BLOCKED, reason: BLOCKED.IMPERSONATING }), { dirty: true }).reason).toBe('read-only');
    expect(saveAvailability(startSave(ready()), { dirty: true }).reason).toBe('saving');
    expect(saveAvailability(conflictAfterSave(ready()), { dirty: true }).reason).toBe('conflict');
  });

  it('has one word for the status line', () => {
    expect(statusOf(initialMyCardState)).toBe('loading');
    expect(statusOf(run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: {} }))).toBe('load-error');
    expect(statusOf(run(initialMyCardState, { type: A.LOAD_BLOCKED, reason: BLOCKED.IMPERSONATING }))).toBe('read-only');
    expect(statusOf(ready(), { dirty: false })).toBe('saved');
    expect(statusOf(ready(), { dirty: true })).toBe('unsaved');
    expect(statusOf(ready(missingResult()), { dirty: false })).toBe('new');
    expect(statusOf(ready(missingResult()), { dirty: true })).toBe('unsaved');
    expect(statusOf(startSave(ready()), { dirty: true })).toBe('saving');
    expect(statusOf(conflictAfterSave(ready()), { dirty: true })).toBe('conflict');
    expect(statusOf(run(startSave(ready()), { type: A.SAVE_FAILED, saveId: 1, error: {} }), { dirty: true })).toBe('save-error');
    expect(statusOf(run(startSave(ready()), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 }), { dirty: false })).toBe('saved');
    // Editing after a save is unsaved again.
    expect(statusOf(run(startSave(ready()), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 }), { dirty: true })).toBe('unsaved');
  });

  it('warns before leaving, and keeps the draft, only for unsaved changes on a card that has loaded', () => {
    expect(shouldWarnBeforeUnload(ready(), { dirty: true })).toBe(true);
    expect(shouldPersistDraft(ready(), { dirty: true })).toBe(true);
    expect(shouldWarnBeforeUnload(ready(), { dirty: false })).toBe(false);
    expect(shouldPersistDraft(ready(), { dirty: false })).toBe(false);
    expect(shouldWarnBeforeUnload(ready(missingResult()), { dirty: false })).toBe(false);
    for (const state of [initialMyCardState, loading(), run(loading(), { type: A.LOAD_FAILED, loadId: 1, uid: 'U', error: {} })]) {
      expect(shouldWarnBeforeUnload(state, { dirty: true })).toBe(false);
      expect(shouldPersistDraft(state, { dirty: true })).toBe(false);
    }
  });

  it('still warns and keeps the draft during a save and a conflict: the changes are still unsaved', () => {
    expect(shouldWarnBeforeUnload(startSave(ready()), { dirty: true })).toBe(true);
    expect(shouldPersistDraft(conflictAfterSave(ready()), { dirty: true })).toBe(true);
  });
});

describe('impersonation: read-only, nothing kept', () => {
  const blocked = () => run(ready(), { type: A.LOAD_BLOCKED, reason: BLOCKED.IMPERSONATING });

  it('blocks everything, and forgets what the account had', () => {
    const state = blocked();
    expect(state).toMatchObject({ load: 'blocked', blocked: 'impersonating', revision: null, uid: null, conflict: null, recovered: null });
    expect(isReadOnly(state)).toBe(true);
  });

  it('cannot save, and nothing starts one', () => {
    const state = blocked();
    expect(saveAvailability(state, { dirty: true })).toEqual({ enabled: false, reason: 'read-only' });
    expect(startSave(state)).toBe(state);
    expect(run(state, { type: A.SAVE_OVER_STARTED, saveId: 1 })).toBe(state);
  });

  it('keeps no draft and warns about nothing, whatever the draft says', () => {
    const state = blocked();
    expect(shouldPersistDraft(state, { dirty: true })).toBe(false);
    expect(shouldWarnBeforeUnload(state, { dirty: true })).toBe(false);
    expect(statusOf(state, { dirty: true })).toBe('read-only');
  });

  it('ignores answers that arrive after it, and notices that cannot apply', () => {
    const state = blocked();
    expect(run(state, { type: A.LOAD_SUCCEEDED, loadId: 1, uid: 'U', result: okResult() })).toBe(state);
    expect(run(state, { type: A.RECOVERY_RESTORED, savedAt: 1, baseRevision: 3 })).toBe(state);
    expect(run(state, { type: A.CONFLICT_DETECTED, current: okResult(), changes: [] })).toBe(state);
  });

  it('is left only by starting a load for an account', () => {
    expect(run(blocked(), { type: A.LOAD_STARTED, uid: 'U', loadId: 2 }).load).toBe('loading');
  });

  it('refuses a reason it does not know', () => {
    const state = ready();
    expect(run(state, { type: A.LOAD_BLOCKED, reason: 'because' })).toBe(state);
  });

  it('ends a session, whether signed out or switched, back to nothing', () => {
    const ended = run(ready(), { type: A.SESSION_ENDED });
    expect(ended).toMatchObject({ load: 'idle', uid: null, revision: null });
    expect(ended.loadId).toBe(1);
  });
});

describe('a conflict: the draft is never touched, and nothing happens without a confirmation', () => {
  it('is raised when a save finds a newer saved card, with the differences', () => {
    const state = conflictAfterSave(ready(okResult(3)), okResult(5, { title: 'Newer' }));
    expect(state.save).toBe('idle');
    expect(state.conflict).toMatchObject({ confirm: null, renewed: false });
    expect(state.conflict.current).toMatchObject({ status: 'ok', revision: 5 });
    expect(state.conflict.changes).toEqual([{ kind: 'value', field: 'title', label: 'Title' }]);
    // The revision the draft is based on has not moved.
    expect(state.revision).toBe(3);
    expect(statusOf(state, { dirty: true })).toBe('conflict');
  });

  it('blocks saving while it stands, and a new save cannot start', () => {
    const state = conflictAfterSave(ready());
    expect(saveAvailability(state, { dirty: true }).reason).toBe('conflict');
    expect(startSave(state, 2)).toBe(state);
  });

  it('can also be raised by a recovered draft that started from an older revision', () => {
    const state = run(ready(okResult(5)), { type: A.CONFLICT_DETECTED, current: okResult(5), changes: [{ kind: 'switch', field: 'email', label: 'Email' }] });
    expect(state.conflict).toMatchObject({ confirm: null, renewed: false });
    expect(run(state, { type: A.CONFLICT_DETECTED, current: okResult(9), changes: [] })).toBe(state);
  });

  describe('Load latest saved version', () => {
    it('does nothing until the choice is made, and nothing more until it is confirmed', () => {
      const state = conflictAfterSave(ready(okResult(3)));
      // Confirming without choosing is not a thing.
      expect(run(state, { type: A.LOAD_LATEST_CONFIRMED })).toBe(state);
      const chosen = choose(state, CONFLICT_CHOICE.LOAD_LATEST);
      expect(chosen.conflict.confirm).toBe('load-latest');
      // The choice alone has changed nothing about the revision or the conflict.
      expect(chosen).toMatchObject({ revision: 3 });
      expect(chosen.conflict).not.toBeNull();
    });

    it('takes the saved revision, and ends the conflict, only on the confirmation', () => {
      const confirmed = run(choose(conflictAfterSave(ready(okResult(3)), okResult(5)), CONFLICT_CHOICE.LOAD_LATEST), { type: A.LOAD_LATEST_CONFIRMED });
      expect(confirmed).toMatchObject({ revision: 5, isNew: false, conflict: null, recovered: null, save: 'idle' });
      expect(saveAvailability(confirmed, { dirty: false }).reason).toBe('nothing-to-save');
    });

    it('can be changed of mind: cancelling leaves the conflict, and the draft, as they were', () => {
      const chosen = choose(conflictAfterSave(ready(okResult(3))), CONFLICT_CHOICE.LOAD_LATEST);
      const cancelled = run(chosen, { type: A.CONFLICT_CANCELLED });
      expect(cancelled.conflict.confirm).toBeNull();
      expect(cancelled.revision).toBe(3);
      expect(run(cancelled, { type: A.LOAD_LATEST_CONFIRMED })).toBe(cancelled);
    });

    it('when the saved card has since been deleted, goes back to a new card', () => {
      const state = run(choose(conflictAfterSave(ready(okResult(3)), missingResult()), CONFLICT_CHOICE.LOAD_LATEST), { type: A.LOAD_LATEST_CONFIRMED });
      expect(state).toMatchObject({ revision: null, isNew: true, conflict: null });
    });

    it('carries over what had to be repaired in the saved card', () => {
      const current = { status: 'repaired', card: savedCard(), revision: 6, errors: { phone: 'x' }, repairs: ['phone'] };
      const state = run(choose(conflictAfterSave(ready(okResult(3)), current), CONFLICT_CHOICE.LOAD_LATEST), { type: A.LOAD_LATEST_CONFIRMED });
      expect(state).toMatchObject({ revision: 6, repaired: { errors: { phone: 'x' }, repairs: ['phone'] } });
    });
  });

  describe('Save my version over it', () => {
    const chosen = (revision = 5) => choose(conflictAfterSave(ready(okResult(3)), okResult(revision)), CONFLICT_CHOICE.SAVE_OVER);

    it('does not start without the choice, or without its confirmation, and no ordinary save can start', () => {
      const unchosen = conflictAfterSave(ready(okResult(3)));
      expect(run(unchosen, { type: A.SAVE_OVER_STARTED, saveId: 2 })).toBe(unchosen);
      const cancelled = run(chosen(), { type: A.CONFLICT_CANCELLED });
      expect(run(cancelled, { type: A.SAVE_OVER_STARTED, saveId: 2 })).toBe(cancelled);
      expect(startSave(chosen(), 2)).toEqual(chosen());
    });

    it('is against the revision that was just seen, not the old one', () => {
      expect(revisionToSaveAgainst(conflictAfterSave(ready(okResult(3)), okResult(5)))).toBe(3);
      const confirmed = chosen(5);
      expect(revisionToSaveAgainst(confirmed)).toBe(5);
      const saving = run(confirmed, { type: A.SAVE_OVER_STARTED, saveId: 2 });
      expect(saving.save).toBe('saving');
      expect(revisionToSaveAgainst(saving)).toBe(5);
    });

    it('is against "no card" when the saved card was deleted meanwhile', () => {
      const state = choose(conflictAfterSave(ready(okResult(3)), missingResult()), CONFLICT_CHOICE.SAVE_OVER);
      expect(revisionToSaveAgainst(state)).toBeNull();
    });

    it('ends the conflict, and moves the revision on, when it succeeds', () => {
      const saving = run(chosen(5), { type: A.SAVE_OVER_STARTED, saveId: 2 });
      const done = run(saving, { type: A.SAVE_SUCCEEDED, saveId: 2, revision: 6 });
      expect(done).toMatchObject({ save: 'saved', revision: 6, conflict: null });
      expect(revisionToSaveAgainst(done)).toBe(6);
    });

    it('if the card changed again, stops and asks again: a new conflict, renewed, with nothing confirmed', () => {
      const saving = run(chosen(5), { type: A.SAVE_OVER_STARTED, saveId: 2 });
      const again = run(saving, { type: A.SAVE_CONFLICTED, saveId: 2, current: okResult(8, { title: 'Newer still' }), changes: [{ kind: 'value', field: 'title', label: 'Title' }] });
      expect(again.save).toBe('idle');
      expect(again.conflict).toMatchObject({ confirm: null, renewed: true });
      expect(again.conflict.current.revision).toBe(8);
      // It cannot go on without a fresh choice and a fresh confirmation, and then it is against revision 8.
      expect(run(again, { type: A.SAVE_OVER_STARTED, saveId: 3 })).toBe(again);
      const reconfirmed = choose(again, CONFLICT_CHOICE.SAVE_OVER);
      expect(revisionToSaveAgainst(reconfirmed)).toBe(8);
      expect(run(reconfirmed, { type: A.SAVE_OVER_STARTED, saveId: 3 }).save).toBe('saving');
    });

    it('if it fails for any other reason, is not remembered as confirmed, and the error is shown', () => {
      const saving = run(chosen(5), { type: A.SAVE_OVER_STARTED, saveId: 2 });
      const failed = run(saving, { type: A.SAVE_FAILED, saveId: 2, error: { code: 'unavailable', message: 'Offline.', retryable: true } });
      expect(failed).toMatchObject({ save: 'error', saveError: { code: 'unavailable' } });
      expect(failed.conflict).toMatchObject({ confirm: null });
      expect(run(failed, { type: A.SAVE_OVER_STARTED, saveId: 3 })).toBe(failed);
      expect(startSave(failed, 3)).toBe(failed);
    });

    it('never retries by itself: only a person\'s confirmation starts an overwrite', () => {
      let state = conflictAfterSave(ready(okResult(3)), okResult(5));
      const started = [];
      for (let i = 0; i < 4; i += 1) {
        state = choose(state, CONFLICT_CHOICE.SAVE_OVER);
        state = run(state, { type: A.SAVE_OVER_STARTED, saveId: 10 + i });
        started.push(state.save);
        state = run(state, { type: A.SAVE_CONFLICTED, saveId: 10 + i, current: okResult(6 + i), changes: [] });
        expect(state.conflict.confirm).toBeNull();
      }
      expect(started).toEqual(['saving', 'saving', 'saving', 'saving']);
    });
  });

  describe('the choices, guarded', () => {
    it('allows only the two choices', () => {
      const state = conflictAfterSave(ready());
      for (const choice of ['overwrite', 'discard', '', null, undefined, 'LOAD-LATEST']) expect(choose(state, choice), String(choice)).toBe(state);
    });

    it('allows neither when the saved card cannot be read (a newer version wrote it)', () => {
      const state = conflictAfterSave(ready(), { status: 'error', code: 'newer-version', message: 'Newer.', retryable: false });
      expect(conflictChoices(state)).toEqual({ canLoadLatest: false, canSaveOver: false });
      expect(choose(state, CONFLICT_CHOICE.LOAD_LATEST)).toBe(state);
      expect(choose(state, CONFLICT_CHOICE.SAVE_OVER)).toBe(state);
    });

    it('treats a saved card it does not recognise as one that cannot be read', () => {
      for (const current of [null, 'card', 7, { status: 'weird' }, {}]) {
        const state = conflictAfterSave(ready(), current);
        expect(conflictChoices(state), JSON.stringify(current)).toEqual({ canLoadLatest: false, canSaveOver: false });
      }
    });

    it('allows both when the saved card can be read, including a missing or a repaired one', () => {
      expect(conflictChoices(conflictAfterSave(ready(), okResult(5)))).toEqual({ canLoadLatest: true, canSaveOver: true });
      expect(conflictChoices(conflictAfterSave(ready(), missingResult()))).toEqual({ canLoadLatest: true, canSaveOver: true });
      expect(conflictChoices(ready())).toEqual({ canLoadLatest: false, canSaveOver: false });
    });

    it('changes nothing while a save is in flight', () => {
      const saving = run(choose(conflictAfterSave(ready()), CONFLICT_CHOICE.SAVE_OVER), { type: A.SAVE_OVER_STARTED, saveId: 2 });
      expect(choose(saving, CONFLICT_CHOICE.LOAD_LATEST)).toBe(saving);
      expect(run(saving, { type: A.CONFLICT_CANCELLED })).toBe(saving);
      expect(run(saving, { type: A.LOAD_LATEST_CONFIRMED })).toBe(saving);
    });

    it('cancelling with nothing chosen, or with no conflict, is nothing', () => {
      const state = conflictAfterSave(ready());
      expect(run(state, { type: A.CONFLICT_CANCELLED })).toBe(state);
      const noConflict = ready();
      expect(run(noConflict, { type: A.CONFLICT_CANCELLED })).toBe(noConflict);
      expect(choose(noConflict, CONFLICT_CHOICE.LOAD_LATEST)).toBe(noConflict);
    });
  });
});

describe('a recovered draft', () => {
  it('is announced once the card has loaded, and can be dismissed', () => {
    const state = run(ready(), { type: A.RECOVERY_RESTORED, savedAt: 1700, baseRevision: 3 });
    expect(state.recovered).toEqual({ savedAt: 1700, baseRevision: 3 });
    expect(run(state, { type: A.RECOVERY_DISMISSED }).recovered).toBeNull();
    const none = ready();
    expect(run(none, { type: A.RECOVERY_DISMISSED })).toBe(none);
  });

  it('cannot be announced before the card has loaded', () => {
    const state = loading();
    expect(run(state, { type: A.RECOVERY_RESTORED, savedAt: 1, baseRevision: 3 })).toBe(state);
  });
});

describe('what to do with a draft found in storage', () => {
  const stored = (card, baseRevision, savedAt = 1700) => ({ status: 'ok', draft: { card, baseRevision, savedAt } });
  const loaded = (card, revision) => ({ card, revision });

  it('does nothing for no draft, or one that was thrown away', () => {
    expect(planRecovery({ stored: { status: 'none' }, loaded: loaded(savedCard(), 3) })).toEqual({ action: 'none' });
    expect(planRecovery({ stored: { status: 'discarded', reason: 'expired' }, loaded: loaded(savedCard(), 3) })).toEqual({ action: 'none' });
    expect(planRecovery({ stored: null, loaded: loaded(savedCard(), 3) })).toEqual({ action: 'none' });
    expect(planRecovery({ stored: undefined, loaded: loaded(savedCard(), 3) })).toEqual({ action: 'none' });
  });

  it('forgets a draft that says what the saved card says', () => {
    expect(planRecovery({ stored: stored(savedCard(), 3), loaded: loaded(savedCard(), 3) })).toEqual({ action: 'discard' });
  });

  it('forgets it even from an older revision, and when only formatting differs', () => {
    expect(planRecovery({ stored: stored(savedCard(), 1), loaded: loaded(savedCard(), 3) })).toEqual({ action: 'discard' });
    expect(planRecovery({ stored: stored(savedCard({ email: 'ADA@Example.com' }), 3), loaded: loaded(savedCard({ email: 'ada@example.com' }), 3) })).toEqual({ action: 'discard' });
  });

  it('restores a draft that started from the saved revision', () => {
    const draftCard = savedCard({ title: 'Edited' });
    expect(planRecovery({ stored: stored(draftCard, 3, 1700), loaded: loaded(savedCard(), 3) })).toEqual({
      action: 'restore', card: draftCard, savedAt: 1700, baseRevision: 3,
    });
  });

  it('restores a draft for a card that was never saved, against "no card"', () => {
    const draftCard = savedCard({ title: 'Edited' });
    expect(planRecovery({ stored: stored(draftCard, null), loaded: loaded(newCard(), null) }).action).toBe('restore');
  });

  it('keeps the draft and raises a conflict when it started from another revision', () => {
    const draftCard = savedCard({ title: 'Edited', share: { ...DEFAULT_SHARE, email: true } });
    const plan = planRecovery({ stored: stored(draftCard, 2), loaded: loaded(savedCard({ title: 'Newer' }), 5) });
    expect(plan.action).toBe('conflict');
    expect(plan.card).toBe(draftCard);
    expect(plan).toMatchObject({ savedAt: 1700, baseRevision: 2 });
    expect(plan.changes.map((change) => `${change.kind}:${change.field}`)).toEqual(['value:title', 'switch:email']);
  });

  it('raises a conflict when the draft was for a never-saved card and one has been saved since', () => {
    const plan = planRecovery({ stored: stored(savedCard({ title: 'Edited' }), null), loaded: loaded(savedCard({ title: 'Saved elsewhere' }), 1) });
    expect(plan.action).toBe('conflict');
  });
});

describe('a photo that could not be kept, or restored', () => {
  it('is told as soon as the tab will not keep it, and told no more once it can', () => {
    const state = ready();
    expect(state.photoKept).toBe(true);
    const lost = run(state, { type: A.PHOTO_KEEP_CHANGED, kept: false });
    expect(lost.photoKept).toBe(false);
    expect(run(lost, { type: A.PHOTO_KEEP_CHANGED, kept: true }).photoKept).toBe(true);
    // Anything that is not exactly false is "kept": a result with no photo in it says nothing is wrong.
    expect(run(lost, { type: A.PHOTO_KEEP_CHANGED, kept: undefined }).photoKept).toBe(true);
    expect(run(state, { type: A.PHOTO_KEEP_CHANGED, kept: true })).toBe(state);
  });

  it('is not told before the card has loaded, or after the account has gone', () => {
    const loadingState = loading();
    expect(run(loadingState, { type: A.PHOTO_KEEP_CHANGED, kept: false })).toBe(loadingState);
    expect(run(ready(), { type: A.PHOTO_KEEP_CHANGED, kept: false }, { type: A.SESSION_ENDED }).photoKept).toBe(true);
    expect(run(ready(), { type: A.PHOTO_KEEP_CHANGED, kept: false }, { type: A.LOAD_STARTED, uid: 'V', loadId: 2 }).photoKept).toBe(true);
  });

  it('stops being told once the card is saved, or the latest saved version is loaded: there is no draft to keep', () => {
    const lost = run(ready(), { type: A.PHOTO_KEEP_CHANGED, kept: false });
    const saved = run(startSave(lost), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 });
    expect(saved.photoKept).toBe(true);
    const viaConflict = choose(conflictAfterSave(lost), CONFLICT_CHOICE.LOAD_LATEST);
    expect(run(viaConflict, { type: A.LOAD_LATEST_CONFIRMED }).photoKept).toBe(true);
  });

  it('is part of what a restored draft announces, only when it is true', () => {
    expect(run(ready(), { type: A.RECOVERY_RESTORED, savedAt: 1700, baseRevision: 3, photoLost: true }).recovered)
      .toEqual({ savedAt: 1700, baseRevision: 3, photoLost: true });
    for (const photoLost of [false, undefined, 'yes', 1, null]) {
      expect(run(ready(), { type: A.RECOVERY_RESTORED, savedAt: 1700, baseRevision: 3, photoLost }).recovered).toEqual({ savedAt: 1700, baseRevision: 3 });
    }
  });

  describe('when a draft is found', () => {
    const stored = (card, baseRevision, photoLost, savedAt = 1700) => ({ status: 'ok', draft: { card, baseRevision, savedAt, photoLost } });
    const loaded = (card, revision) => ({ card, revision });

    it('restores a draft whose photo is gone even when nothing else differs, instead of forgetting that it was there', () => {
      expect(planRecovery({ stored: stored(savedCard(), 3, true), loaded: loaded(savedCard(), 3) })).toEqual({
        action: 'restore', card: savedCard(), savedAt: 1700, baseRevision: 3, photoLost: true,
      });
      // From an older revision too: nothing differs, so there is no conflict to raise.
      expect(planRecovery({ stored: stored(savedCard(), 1, true), loaded: loaded(savedCard(), 3) }).action).toBe('restore');
    });

    it('says the photo is gone in a restore and in a conflict, and nothing about it when it is not', () => {
      const draftCard = savedCard({ title: 'Edited' });
      expect(planRecovery({ stored: stored(draftCard, 3, true), loaded: loaded(savedCard(), 3) })).toMatchObject({ action: 'restore', photoLost: true });
      expect(planRecovery({ stored: stored(draftCard, 2, true), loaded: loaded(savedCard({ title: 'Newer' }), 5) })).toMatchObject({ action: 'conflict', photoLost: true });
      expect(planRecovery({ stored: stored(draftCard, 3, false), loaded: loaded(savedCard(), 3) })).not.toHaveProperty('photoLost');
      expect(planRecovery({ stored: stored(savedCard(), 3, false), loaded: loaded(savedCard(), 3) })).toEqual({ action: 'discard' });
    });
  });
});

describe('the reducer itself', () => {
  it('returns the same state for an action it does not know, or for nothing', () => {
    const state = ready();
    expect(run(state, { type: 'nope' })).toBe(state);
    expect(myCardReducer(state, null)).toBe(state);
    expect(myCardReducer(state, undefined)).toBe(state);
    expect(myCardReducer(undefined, { type: 'nope' })).toBe(initialMyCardState);
  });

  it('does not change the state it was given', () => {
    const before = conflictAfterSave(ready(okResult(3)));
    const snapshot = JSON.stringify(before);
    run(before, { type: A.CONFLICT_CHOSEN, choice: CONFLICT_CHOICE.SAVE_OVER }, { type: A.SAVE_OVER_STARTED, saveId: 5 }, { type: A.SESSION_ENDED });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('never makes sharing a thing it tracks: nothing in the state is about turning sharing on', () => {
    const states = [ready(), conflictAfterSave(ready()), run(startSave(ready()), { type: A.SAVE_SUCCEEDED, saveId: 1, revision: 4 })];
    for (const state of states) {
      expect(Object.keys(state).filter((key) => /shar/i.test(key))).toEqual([]);
      // (A saved card held in a conflict says sharing is off, as the service always makes it.)
      expect(JSON.stringify(state)).not.toMatch(/"sharingEnabled":true/);
    }
  });
});
