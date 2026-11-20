/**
 * MyCardSaveBar — Save, and what is the matter with the card.
 *
 * The bar kept in view at the bottom of the page: one line saying where the
 * card stands (saved, unsaved changes, saving, not saved yet, could not save,
 * a newer version is saved) and the Save button. It decides nothing: whether
 * Save is on, and what it says, come from the page (the useMyCard hook).
 *
 * Save is on whenever there is something to save, even if the card is not
 * valid yet: pressing it then shows what to fix, which is clearer to a person
 * and to a screen reader than a button that is simply dead.
 */

const STATUS_TEXT = Object.freeze({
  saved: 'All changes saved',
  unsaved: 'You have unsaved changes',
  new: 'Not saved yet',
  saving: 'Saving…',
  'save-error': 'Couldn\'t save your changes',
  conflict: 'A newer version is saved',
});

/**
 * @param {object} props
 * @param {string} props.status  statusOf(): 'saved' | 'unsaved' | 'new' | 'saving' | 'save-error' | 'conflict'
 * @param {{ enabled: boolean }} props.availability  saveAvailability()
 * @param {number} [props.errorCount]  fields the card's rules refuse and the person has been told about
 * @param {() => void} props.onSave
 */
export default function MyCardSaveBar({ status, availability, errorCount = 0, onSave }) {
  const saving = status === 'saving';
  // What there is to fix takes the line, once the person has been told what it is.
  const fix = errorCount > 0 && (status === 'unsaved' || status === 'new');
  const text = fix
    ? `Fix ${errorCount === 1 ? 'the field' : `${errorCount} fields`} marked in red, then save.`
    : (STATUS_TEXT[status] ?? '');

  return (
    <div className="mycard-savebar">
      <p className={`mycard-savestatus mycard-savestatus--${fix ? 'fix' : status}`} role="status" aria-live="polite">
        {text}
      </p>
      <button
        type="button"
        className="mycard-btn mycard-btn--primary"
        disabled={!availability.enabled}
        aria-busy={saving ? 'true' : undefined}
        onClick={onSave}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
