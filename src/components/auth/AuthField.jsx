/**
 * AuthField — a labelled text input for the authentication surface.
 *
 * WHY THIS IS A COMPONENT AND NOT THREE HAND-WIRED INPUTS
 * ───────────────────────────────────────────────────────
 * The audit found every input on the old signup page unlabelled: no `id`, no
 * `for`, no `autocomplete`, and errors that no screen reader ever announced.
 * Each of those was individually a one-line fix, which is exactly why they
 * came back — a per-screen fix protects one screen until someone adds a field.
 *
 * So the accessibility is structural here, not applied:
 *
 *   · `id` comes from useId() and `htmlFor` is derived from it, so a field
 *     cannot be rendered unlabelled. There is no prop that turns it off.
 *   · `autoComplete` is REQUIRED. Omitting it is a visible mistake at the call
 *     site rather than a silent regression, because password managers failing
 *     quietly is how it went missing the first time.
 *   · The error owns `role="alert"` + `aria-live="polite"`, is linked by
 *     `aria-describedby`, and sets `aria-invalid` — so submitting an invalid
 *     form is perceivable without sight. Previously nothing happened at all.
 *
 * `hint` and `error` share one describedby slot: an error replaces the hint
 * rather than stacking, because two competing descriptions on one input is
 * worse than either alone.
 */

import { useId } from 'react';

export default function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  autoComplete,          // required — see header
  placeholder,
  icon: Icon,
  error,
  hint,
  hintId: hintIdProp,
  required = true,
  inputMode,
  autoFocus,
  trailing,              // rendered inside the field box, right side
  inputRef,
  name,
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = hintIdProp || `${id}-hint`;

  // One description at a time. An error supersedes the hint it replaces.
  const describedBy = error ? errorId : (hint || hintIdProp) ? hintId : undefined;

  return (
    <div className="auth-field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>

      <div className={`auth-field-box ${error ? 'has-error' : ''}`}>
        {Icon && <Icon className="auth-field-icon" size={18} aria-hidden="true" />}
        <input
          id={id}
          ref={inputRef}
          name={name}
          className={`auth-field-input ${Icon ? 'has-icon' : ''} ${trailing ? 'has-trailing' : ''}`}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          inputMode={inputMode}
          autoFocus={autoFocus}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        {trailing}
      </div>

      {error ? (
        <p className="auth-field-error" id={errorId} role="alert" aria-live="polite">
          {error}
        </p>
      ) : hint ? (
        <p className="auth-field-hint" id={hintId}>{hint}</p>
      ) : null}
    </div>
  );
}
