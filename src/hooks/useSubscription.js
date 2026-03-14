import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';

/**
 * Returns the current user's subscription tier.
 * { tier: 'starter' | 'pro', isProTier: boolean, loading: boolean }
 */
export function useSubscription() {
  const [tier, setTier] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const user = getEffectiveUser();
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          setTier(snap.data().subscriptionTier || 'starter');
        }
      } catch (e) {
        console.error('useSubscription error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { tier, isProTier: tier === 'pro', loading };
}
