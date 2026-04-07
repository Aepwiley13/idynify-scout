import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';

/**
 * Returns the current user's subscription tier and feature access flags.
 * { tier: 'starter' | 'pro', isProTier: boolean, hasPhoneAccess: boolean, loading: boolean }
 *
 * hasPhoneAccess is true for Pro users (automatic) and for Starter users who have
 * been manually granted phone access by an admin (features.mobilePhone === true, capped at 25).
 */
export function useSubscription() {
  const [tier, setTier] = useState(null);
  const [hasPhoneAccess, setHasPhoneAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const user = getEffectiveUser();
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const data = snap.data();
          setTier(data.subscriptionTier || 'starter');
          setHasPhoneAccess(data.features?.mobilePhone === true);
        }
      } catch (e) {
        console.error('useSubscription error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { tier, isProTier: tier === 'pro', hasPhoneAccess, loading };
}
