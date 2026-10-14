/**
 * Live updates for companies whose company-only enrichment is still running.
 *
 * Saved Companies loads once with getDocs. A company accepted moments ago may
 * still be "Verifying company details…" when the page loads; this listens to
 * exactly those documents, hands each change to `onUpdate(id, data)` so the
 * page can merge it and rescore, and stops listening once a company is no
 * longer pending. Nothing else on the page goes live.
 *
 * It also re-renders the host when the oldest pending marker expires, so an
 * enrichment abandoned mid-call stops showing "Verifying…" without a refresh.
 */
import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ENRICHMENT_PENDING_TTL_MS, isEnrichmentPending } from '../services/companyEnrichment';

export function usePendingEnrichmentUpdates({ userId, companies, onUpdate }) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const [, setExpiryTick] = useState(0);

  const pending = (companies || []).filter(c => isEnrichmentPending(c));
  const pendingKey = pending.map(c => c.id).sort().join(',');
  const oldestRequestedAt = pending.reduce(
    (min, c) => Math.min(min, c.company_enrichment_requested_at), Infinity,
  );

  useEffect(() => {
    if (!userId || !pendingKey) return undefined;
    const unsubscribes = pendingKey.split(',').map(id =>
      onSnapshot(doc(db, 'users', userId, 'companies', id), snap => {
        if (snap.exists()) onUpdateRef.current(id, snap.data());
      }, err => console.warn('[saved-companies] enrichment listener failed', { id, error: err?.message })),
    );
    const msUntilExpiry = Math.max(0, oldestRequestedAt + ENRICHMENT_PENDING_TTL_MS - Date.now()) + 50;
    const timer = setTimeout(() => setExpiryTick(t => t + 1), msUntilExpiry);
    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
      clearTimeout(timer);
    };
  }, [userId, pendingKey, oldestRequestedAt]);
}
