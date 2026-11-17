/**
 * My Card's notices: everything the page has to tell a person that is not the
 * card itself.
 *
 *   MyCardNotices   above the editor, once the card has loaded:
 *                   a conflict (a newer saved version), a failed save,
 *                   a restored draft, and a saved card that had to be repaired.
 *   MyCardBlocked   instead of the editor, when there is no card to show:
 *                   loading, a failed load, impersonation, signed out.
 *
 * Presentational: they show what the state says and call back what the person
 * chooses. The rules (what may happen when, what needs confirming) are in the
 * state; what is here is the words, and making a destructive choice a
 * two-step one on screen as well.
 *
 * THE CONFLICT NEVER DECIDES. It says what differs, offers two ways out, and
 * each needs a second click on a button that says what it will do. The person
 * may also keep editing: Save stays on hold until they choose.
 *
 * A conflict, or a failed save, can arrive while the person is looking at the
 * bottom of a long form, with only the Save bar in view. So each scrolls itself
 * into view when it appears (once: not on every change after it).
 *
 * None of these words contains what is in the card.
 */
import { useCallback, useState } from 'react';
import { FIELD_META } from './cardDraft';

/** Fields as a person names them, from the list the saved card was repaired by. */
function repairedLabels(repairs) {
  return (repairs ?? [])
    .filter((field) => Object.prototype.hasOwnProperty.call(FIELD_META, field))
    .map((field) => FIELD_META[field].shareLabel ?? FIELD_META[field].label);
}

/** A ref that brings its element into view as it appears. Stable, so it runs once, not on every render. */
function useBringIntoView() {
  return useCallback((element) => { element?.scrollIntoView?.({ block: 'nearest' }); }, []);
}

function Conflict({ state, choices, saving, changeLabels, onChoose, onCancel, onConfirmLoadLatest, onConfirmSaveOver }) {
  const { conflict } = state;
  const bringIntoView = useBringIntoView();
  const unreadable = conflict.current.status === 'error';
  const names = changeLabels.join(', ');

  return (
    <section ref={bringIntoView} className="mycard-notice mycard-notice--conflict" role="alert" aria-labelledby="mycard-conflict-title">
      <h2 id="mycard-conflict-title" className="mycard-notice-title">A newer version of your card was saved</h2>

      {unreadable ? (
        <p className="mycard-notice-text">
          {conflict.current.message || 'It was saved by a newer version of IDYNIFY.'} Refresh the page to edit it. Your changes are still here until you do.
        </p>
      ) : (
        <>
          <p className="mycard-notice-text">
            {conflict.renewed ? 'It changed again while you were deciding. ' : 'Someone saved your card since you opened it, perhaps you in another tab. '}
            {names ? `These differ from your version: ${names}.` : 'Your version and the saved one look the same, but another change was saved.'}
          </p>
          <p className="mycard-notice-text">Your edits are untouched. You can keep editing; saving waits until you choose.</p>

          {conflict.confirm === null ? (
            <div className="mycard-notice-actions">
              <button type="button" className="mycard-btn mycard-btn--secondary" disabled={!choices.canLoadLatest || saving} onClick={() => onChoose('load-latest')}>
                Load latest saved version
              </button>
              <button type="button" className="mycard-btn mycard-btn--secondary" disabled={!choices.canSaveOver || saving} onClick={() => onChoose('save-over')}>
                Save my version over it
              </button>
            </div>
          ) : null}

          {conflict.confirm === 'load-latest' ? (
            <div className="mycard-confirm">
              <p className="mycard-notice-text"><strong>This replaces your unsaved edits</strong> with the latest saved version. You can&apos;t get them back.</p>
              <div className="mycard-notice-actions">
                <button type="button" className="mycard-btn mycard-btn--danger" disabled={saving} onClick={onConfirmLoadLatest}>Replace my edits</button>
                <button type="button" className="mycard-btn mycard-btn--secondary" autoFocus onClick={onCancel}>Cancel</button>
              </div>
            </div>
          ) : null}

          {conflict.confirm === 'save-over' ? (
            <div className="mycard-confirm">
              <p className="mycard-notice-text"><strong>This overwrites the newer saved version</strong> with yours. The changes saved since you opened it will be lost.</p>
              <div className="mycard-notice-actions">
                <button type="button" className="mycard-btn mycard-btn--danger" disabled={saving} aria-busy={saving ? 'true' : undefined} onClick={onConfirmSaveOver}>
                  {saving ? 'Saving…' : 'Overwrite with my version'}
                </button>
                <button type="button" className="mycard-btn mycard-btn--secondary" autoFocus disabled={saving} onClick={onCancel}>Cancel</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Recovered({ onDismiss, onDiscard }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="mycard-notice mycard-notice--info" role="status" aria-labelledby="mycard-recovered-title">
      <h2 id="mycard-recovered-title" className="mycard-notice-title">We restored the changes you hadn&apos;t saved</h2>
      {confirming ? (
        <div className="mycard-confirm">
          <p className="mycard-notice-text"><strong>Discard these changes?</strong> Your card goes back to the last saved version.</p>
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--danger" onClick={onDiscard}>Yes, discard</button>
            <button type="button" className="mycard-btn mycard-btn--secondary" autoFocus onClick={() => setConfirming(false)}>Keep them</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mycard-notice-text">They are in the form now, and nothing is saved until you press Save.</p>
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--secondary" onClick={() => setConfirming(true)}>Discard changes</button>
            <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onDismiss}>OK</button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * @param {object} props
 * @param {object} props.state  the page's state (myCardState)
 * @param {{ canLoadLatest: boolean, canSaveOver: boolean }} props.choices
 * @param {string[]} [props.changeLabels]  what differs in a conflict, in words ("Title", "Email switch")
 * @param {() => void} props.onRetrySave
 * @param {() => void} props.onDismissRecovered
 * @param {() => void} props.onDiscardRecovered
 * @param {(choice: string) => void} props.onChooseConflict
 * @param {() => void} props.onCancelConflict
 * @param {() => void} props.onConfirmLoadLatest
 * @param {() => void} props.onConfirmSaveOver
 */
export function MyCardNotices({
  state, choices, changeLabels = [], onRetrySave, onDismissRecovered, onDiscardRecovered,
  onChooseConflict, onCancelConflict, onConfirmLoadLatest, onConfirmSaveOver,
}) {
  const saving = state.save === 'saving';
  const repaired = repairedLabels(state.repaired?.repairs);
  const sharingReset = (state.repaired?.repairs ?? []).some((repair) => repair === 'sharingEnabled' || repair === 'share');
  const hasFailed = state.save === 'error' && state.saveError;
  const bringIntoView = useBringIntoView();

  return (
    <>
      {state.conflict ? (
        <Conflict
          state={state}
          choices={choices}
          saving={saving}
          changeLabels={changeLabels}
          onChoose={onChooseConflict}
          onCancel={onCancelConflict}
          onConfirmLoadLatest={onConfirmLoadLatest}
          onConfirmSaveOver={onConfirmSaveOver}
        />
      ) : null}

      {hasFailed ? (
        <section ref={bringIntoView} className="mycard-notice mycard-notice--error" role="alert" aria-labelledby="mycard-save-error-title">
          <h2 id="mycard-save-error-title" className="mycard-notice-title">Couldn&apos;t save your changes</h2>
          <p className="mycard-notice-text">{state.saveError.message} Your changes are still here.</p>
          {state.saveError.retryable && !state.conflict ? (
            <div className="mycard-notice-actions">
              <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onRetrySave}>Try again</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* With a conflict on screen, the conflict is where the choices are; this only says what happened. */}
      {state.recovered ? (
        state.conflict ? (
          <p className="mycard-notice mycard-notice--info mycard-notice-text" role="status">We restored the changes you hadn&apos;t saved.</p>
        ) : (
          <Recovered onDismiss={onDismissRecovered} onDiscard={onDiscardRecovered} />
        )
      ) : null}

      {state.repaired && (repaired.length > 0 || sharingReset) ? (
        <section className="mycard-notice mycard-notice--info" role="status" aria-labelledby="mycard-repaired-title">
          <h2 id="mycard-repaired-title" className="mycard-notice-title">Your saved card needed tidying</h2>
          {repaired.length > 0 ? (
            <p className="mycard-notice-text">These saved details weren&apos;t valid and were left empty: {repaired.join(', ')}.</p>
          ) : null}
          {sharingReset ? <p className="mycard-notice-text">Your Shared / Private choices were reset to the defaults.</p> : null}
          <p className="mycard-notice-text">Saving keeps the tidied card.</p>
        </section>
      ) : null}
    </>
  );
}

/**
 * Instead of the editor, when there is no card to edit.
 * @param {{ state: object, onRetryLoad: () => void }} props
 */
export function MyCardBlocked({ state, onRetryLoad }) {
  if (state.load === 'error') {
    return (
      <section className="mycard-notice mycard-notice--error" role="alert" aria-labelledby="mycard-load-error-title">
        <h2 id="mycard-load-error-title" className="mycard-notice-title">Couldn&apos;t load your card</h2>
        <p className="mycard-notice-text">{state.loadError?.message} Nothing has been changed.</p>
        {state.loadError?.retryable ? (
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onRetryLoad}>Try again</button>
          </div>
        ) : null}
      </section>
    );
  }
  if (state.load === 'blocked') {
    return (
      <section className="mycard-notice mycard-notice--info" role="status" aria-labelledby="mycard-blocked-title">
        <h2 id="mycard-blocked-title" className="mycard-notice-title">
          {state.blocked === 'impersonating' ? 'You\'re viewing as someone else' : 'Sign in to see your card'}
        </h2>
        <p className="mycard-notice-text">
          {state.blocked === 'impersonating'
            ? 'My Card belongs to the account that is signed in, so it can\'t be shown or changed while you view as someone else.'
            : 'My Card belongs to your account.'}
        </p>
      </section>
    );
  }
  return <p className="mycard-loading" role="status">Loading your card…</p>;
}
