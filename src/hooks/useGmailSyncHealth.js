/**
 * useGmailSyncHealth — the reader the sync worker never had.
 *
 * The worker has written `syncStatus`, `lastSyncError` and
 * `lastSuccessfulSyncAt` to `users/{uid}/integrations/gmail` on every run for
 * as long as it has existed. The Gate 2 audit found nothing in the application
 * read any of them: an account could sit in `needs_reconnect` indefinitely
 * while every screen reported healthy.
 *
 * A live subscription rather than a one-shot read, because the interesting
 * transitions — a token expiring, a mailbox wedging — happen while someone is
 * looking at the screen, and a stale "all good" is the failure being fixed.
 *
 * The classification itself lives in `src/utils/gmailSyncHealth.js` so it can
 * be tested without React and shared with anything server-side that needs the
 * same verdict.
 */

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';
import { deriveSyncHealth, SYNC_HEALTH } from '../utils/gmailSyncHealth';

export { SYNC_HEALTH };

export function useGmailSyncHealth() {
  // Lazily initialised so the signed-out case is settled before first paint
  // rather than corrected by a synchronous setState inside the effect, which
  // costs a cascading render and trips react-hooks/set-state-in-effect.
  const [state, setState] = useState(() => ({
    health: null,
    loading: Boolean(getEffectiveUser()),
  }));

  useEffect(() => {
    const user = getEffectiveUser();
    if (!user) return;

    // `doc()` throws SYNCHRONOUSLY when Firestore is not configured — the
    // onSnapshot error callback never gets the chance to see it. Unguarded,
    // that turns a diagnostic banner into a crash of whatever page mounted it,
    // which is a spectacularly bad trade for a health indicator.
    try {
      const ref = doc(db, 'users', user.uid, 'integrations', 'gmail');
      return onSnapshot(
        ref,
        (snap) => {
          setState({
            health: deriveSyncHealth(snap.exists() ? snap.data() : null),
            loading: false,
          });
        },
        (err) => {
          // A failed read is not evidence of health, so it must not render as
          // healthy. Report nothing rather than something reassuring.
          console.error('[useGmailSyncHealth] subscription failed:', err);
          setState({ health: null, loading: false });
        }
      );
    } catch (err) {
      console.error('[useGmailSyncHealth] could not subscribe:', err);
      setState({ health: null, loading: false });
      return undefined;
    }
  }, []);

  return state;
}

export default useGmailSyncHealth;
