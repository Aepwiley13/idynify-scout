/**
 * PasswordField — AuthField plus a reveal toggle.
 *
 * The audit's root cause for "no show/hide anywhere in the product" was not a
 * broken toggle. It was that the password inputs were bare <input> elements
 * with no positioned wrapper, so there was nothing to hang a button on, and no
 * PasswordField existed to borrow one from. This file is that missing wrapper.
 *
 * Three details that are easy to get wrong and that the tests pin:
 *
 *  · The toggle is a real <button type="button">. As a <span> it would be
 *    invisible to keyboard users; without the explicit type it would submit
 *    the form, because a button inside a form defaults to submit.
 *  · Its aria-label states the ACTION, and flips with state. A label frozen at
 *    "Show password" lies as soon as the password is showing.
 *  · Toggling does not steal focus. A user who tabs to the toggle, presses it,
 *    and tabs on should land on the CTA — not be bounced back into the field.
 */

import { Eye, EyeOff, Lock } from 'lucide-react';
import { useState } from 'react';
import AuthField from './AuthField';

export default function PasswordField({
  label = 'Password',
  value,
  onChange,
  onBlur,
  autoComplete,          // 'new-password' on signup, 'current-password' on sign in
  placeholder = 'Create a strong password',
  error,
  hint,
  hintId,
  autoFocus,
  name,
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <AuthField
      label={label}
      name={name}
      type={revealed ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      autoComplete={autoComplete}
      placeholder={placeholder}
      icon={Lock}
      error={error}
      hint={hint}
      hintId={hintId}
      autoFocus={autoFocus}
      trailing={
        <button
          type="button"
          className="auth-field-toggle"
          onClick={() => setRevealed(r => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
        >
          {revealed
            ? <EyeOff size={18} aria-hidden="true" />
            : <Eye size={18} aria-hidden="true" />}
        </button>
      }
    />
  );
}
