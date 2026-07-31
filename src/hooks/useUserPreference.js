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

    // doc() validates its arguments and throws SYNCHRONOUSLY when `db` is not
    // a real Firestore instance — before there is a promise for .catch to
    // attach to. So the .catch below never saw it: the throw escaped the
    // effect, React unwound the tree, and any screen using a preference went
    // blank. It took Settings down whole.
    //
    // A misconfigured `db` is a configuration failure, not a missing
    // preference, so it is logged as an error and named as such rather than
    // folded into the "could not load" warning below. The hook still returns
    // defaultValue and the screen still renders — a preference is not worth a
    // blank page.
    const load = async () => {
      let ref;
      try {
        ref = doc(db, 'users', user.uid);
      } catch (err) {
        console.error(
          `[useUserPreference] Firestore is not configured — cannot read '${key}'.`,
          err
        );
        return;
      }

      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const prefs = snap.data().preferences || {};
          if (key in prefs) setValue(prefs[key]);
        }
      } catch (err) {
        // Non-fatal — falls back to defaultValue
        console.warn(`[useUserPreference] Could not load '${key}':`, err.message);
      }
    };

    // Both outcomes finish loading. Deferred to the promise rather than called
    // in the effect body so a configuration failure does not setState during
    // the effect and cascade a render.
    load().finally(() => setLoaded(true));
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
