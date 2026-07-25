import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useActiveUser } from '../context/ImpersonationContext';

/**
 * Resolve a cadence's status.
 *
 * The brief specifies counting docs by an explicit `status` field
 * ('active' | 'completed' | 'draft'). Cadence docs written today by
 * BulkSendExecutor do NOT persist a `status` field — the rest of the app
 * (CadenceDetail.jsx, the old CadencesList.jsx) derives status from
 * `completedAt` / `sentCount`. To return real numbers we honor an explicit
 * `status` when present and fall back to the app's canonical derivation
 * otherwise. See the PR notes for the flag on this.
 */
function resolveStatus(c) {
  if (typeof c.status === 'string' && c.status.trim()) {
    return c.status.trim().toLowerCase();
  }
  if (c.completedAt) return 'completed';
  if ((c.sentCount || 0) > 0) return 'active';
  return 'draft';
}

/**
 * Aggregate stats over users/{uid}/cadences.
 *
 * Returns only Phase 1 (real-data) metrics. Average reply rate and meetings
 * booked are Phase 2 and are intentionally NOT computed here.
 *
 * @returns {{
 *   activeCadences: number,
 *   completedCadences: number,
 *   draftCadences: number,
 *   totalContactsReached: number,
 *   totalSent: number,
 *   loading: boolean,
 *   error: any,
 * }}
 */
export default function useCadenceStats() {
  const user = useActiveUser();
  const [stats, setStats] = useState({
    activeCadences: 0,
    completedCadences: 0,
    draftCadences: 0,
    totalContactsReached: 0,
    totalSent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    setLoading(true);
    setError(null);

    const ref = collection(db, 'users', user.uid, 'cadences');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        let activeCadences = 0;
        let completedCadences = 0;
        let draftCadences = 0;
        let totalContactsReached = 0;
        let totalSent = 0;

        snap.forEach((docSnap) => {
          const c = docSnap.data();
          const status = resolveStatus(c);
          if (status === 'active') activeCadences += 1;
          else if (status === 'completed') completedCadences += 1;
          else if (status === 'draft') draftCadences += 1;

          totalContactsReached += c.contactCount || 0;
          totalSent += c.sentCount || 0;
        });

        setStats({
          activeCadences,
          completedCadences,
          draftCadences,
          totalContactsReached,
          totalSent,
        });
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsub;
  }, [user?.uid]);

  return { ...stats, loading, error };
}
