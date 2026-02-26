/**
 * useUserPreference — Reads and writes a single user preference field.
 *
 * Preferences are stored on the user document at:
 *   users/{userId}.preferences.{key}
 *
 * API mirrors useState: [value, setValue]
 * - Initial value comes from Firestore on mount (falls back to defaultValue)
 * - setValue writes to Firestore and updates local state optimistically
 * - Safe to call before auth is ready — returns defaultValue until loaded
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';

export function useUserPreference(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  // Load from Firestore on mount
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    getDoc(doc(db, 'users', user.uid))
      .then(snap => {
        if (snap.exists()) {
          const prefs = snap.data().preferences || {};
          if (key in prefs) setValue(prefs[key]);
        }
      })
      .catch(err => {
        // Non-fatal — falls back to defaultValue
        console.warn(`[useUserPreference] Could not load '${key}':`, err.message);
      })
      .finally(() => setLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to Firestore + update local state optimistically
  const persistValue = useCallback(async (newValue) => {
    setValue(newValue); // optimistic update
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        [`preferences.${key}`]: newValue
      });
    } catch (err) {
      // Roll back on failure
      setValue(value);
      console.error(`[useUserPreference] Failed to persist '${key}':`, err.message);
    }
  }, [key, value]);

  return [value, persistValue, loaded];
}
