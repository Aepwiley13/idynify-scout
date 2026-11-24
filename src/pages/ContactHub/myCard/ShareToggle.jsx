/**
 * ShareToggle — one field's Shared / Private choice.
 *
 * A switch in the standard sense: a button with role="switch" and aria-checked,
 * so a keyboard (Tab, then Space or Enter) and a screen reader both get it for
 * free. The words and the icon carry the state, never colour alone.
 *
 * Compact to look at (32px) and 44px to hit: the stylesheet grows its touch
 * area past its edge, so a thumb gets the full target without the row growing.
 *
 * It only says what the person wants for the field. Nothing is shared by it:
 * sharing the card at all is a separate, later setting.
 */
import { Eye, Lock } from 'lucide-react';

/**
 * @param {string} label        the field's name, "Email": the switch is named "Email on your card"
 * @param {boolean} shared      whether the field is switched on
 * @param {(shared: boolean) => void} onChange
 * @param {boolean} [disabled]
 */
export default function ShareToggle({ label, shared, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shared}
      aria-label={`${label} on your card`}
      className={`mycard-share${shared ? ' mycard-share--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!shared)}
    >
      {shared ? <Eye size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
      <span aria-hidden="true">{shared ? 'Shared' : 'Private'}</span>
    </button>
  );
}
