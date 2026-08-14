/**
 * PasswordRequirements — the checklist under the password field.
 *
 * THE RULE THIS FILE EXISTS TO KEEP
 * ─────────────────────────────────
 * "Do not display requirements that are not actually enforced."
 *
 * So the list is not written here. It is READ from the project's live
 * Identity Platform password policy via `validatePassword()`, which returns
 * both the enforced constraints and this password's per-rule status. The UI is
 * a mirror of the console setting rather than a copy of it, which means it
 * cannot drift: change the policy and the checklist follows with no deploy.
 *
 * Three consequences worth knowing before changing anything here:
 *
 *  1. The first call fetches the policy over the network; later calls use the
 *     cached policy. We warm it once on mount so typing never waits on a
 *     round trip.
 *  2. Until the policy resolves, nothing renders. An optimistic checklist
 *     would be a claim we have not verified — the exact failure the rule above
 *     forbids.
 *  3. If the fetch fails outright, nothing renders, permanently, and the field
 *     still works. Degrading to a hardcoded list would turn a network blip
 *     into a false statement about our security posture.
 *
 * `onValidityChange` reports whether the CURRENT password satisfies the live
 * policy. When the policy is unavailable it reports null — "unknown", not
 * "invalid" — so an unreachable policy can never block a legitimate signup.
 * The server is the authority either way; this is guidance, not a gate.
 */

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { validatePassword } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { rowsFromStatus } from './passwordPolicy';

export default function PasswordRequirements({ password, id, onValidityChange }) {
  const [rows, setRows] = useState(null);   // null = policy not resolved yet
  const unavailable = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (unavailable.current) return;

    validatePassword(auth, password || '')
      .then(status => {
        if (cancelled) return;
        setRows(rowsFromStatus(status));
        onValidityChange?.(status.isValid);
      })
      .catch(() => {
        // Logged once, then silent. A retry per keystroke against a policy
        // endpoint that is down is noise, not resilience.
        if (cancelled) return;
        if (!unavailable.current) {
          console.warn('[auth] password policy unavailable — requirements hidden');
          unavailable.current = true;
        }
        setRows(null);
        onValidityChange?.(null);
      });

    return () => { cancelled = true; };
  }, [password, onValidityChange]);

  if (!rows || rows.length === 0) return null;

  return (
    <ul className="auth-req-list" id={id}>
      {rows.map(r => (
        <li key={r.key} className={`auth-req ${r.met ? 'met' : ''}`}>
          <span className="auth-req-mark" aria-hidden="true">
            <Check size={13} strokeWidth={3} />
          </span>
          <span>{r.label}</span>
          {/* The visual tick is decorative; this is what a screen reader reads. */}
          <span className="auth-sr-only">{r.met ? ' — met' : ' — not met yet'}</span>
        </li>
      ))}
    </ul>
  );
}
