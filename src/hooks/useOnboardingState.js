/**
 * useOnboardingState — Mission Control 2.0 Sprint 2, Workstream A2.
 *
 * Single source of truth for where a user is in the 6-step onboarding flow
 * (Meet Barry → First Prospects). Reads the `onboarding` object off the user
 * doc live, derives the current step + flags, and exposes `markStep` to advance.
 *
 * Onboarding flags live at users/{uid}.onboarding:
 *   started               true once the Step 1 CTA is clicked
 *   websiteAnalyzed       true after analyze-website succeeds
 *   smartQuestionsAnswered true after Step 3 completes
 *   completed             true once Step 6 is reached (+ completedAt)
 *   skipped               true if the user clicks "Skip setup"
 *
 * Gmail connection is NOT stored as a flag — it's derived live from
 * users/{uid}/integrations/gmail having a valid token, so the step reacts the
 * moment Gmail is connected or disconnected.
 *
 * Returned shape:
 *   {
 *     currentStep: number (1-6),
 *     isNewUser: boolean,          // onboarding.completed is false or missing
 *     isComplete: boolean,
 *     isSkipped: boolean,
 *     flags: { started, websiteAnalyzed, smartQuestionsAnswered, gmailConnected, completed },
 *     markStep: (flag) => Promise<void>,
 *     loading: boolean,
 *   }
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';

// Days after which a stuck-but-started user is treated as done, so returning
// users are never trapped in the onboarding flow forever.
const STALE_ONBOARDING_DAYS = 7;

// Flags that markStep can write. `completed` also stamps completedAt.
export const ONBOARDING_FLAGS = {
  started: 'started',
  websiteAnalyzed: 'websiteAnalyzed',
  smartQuestionsAnswered: 'smartQuestionsAnswered',
  completed: 'completed',
  skipped: 'skipped',
};

/**
 * A Gmail integration counts as connected when the doc exists, hasn't been
 * disconnected, and carries a refresh token (which lets us mint fresh access
 * tokens even after the current one expires).
 */
export function deriveGmailConnected(integrationData) {
  if (!integrationData) return false;
  if (integrationData.status && integrationData.status !== 'connected') return false;
  return Boolean(integrationData.refreshToken || integrationData.accessToken);
}

/** Convert a Firestore Timestamp | Date | ISO string to millis, or null. */
function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when an account is older than the cutoff and onboarding is not marked
 * complete. Deliberately does NOT require `started` (FLAG 5): existing users
 * predate the onboarding flow entirely — they have no onboarding field at all —
 * and must be sent straight to Mission Control rather than into onboarding.
 */
export function isStaleOnboarding(onboarding, createdAt, now = Date.now()) {
  if (onboarding?.completed) return false;
  const createdMs = toMillis(createdAt);
  if (createdMs == null) return false;
  const ageDays = (now - createdMs) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_ONBOARDING_DAYS;
}

/**
 * Pure step/flag derivation, exported for testing.
 *
 * @param {Object} onboarding - users/{uid}.onboarding (may be undefined)
 * @param {boolean} gmailConnected - live-derived Gmail connection
 * @param {*} createdAt - users/{uid}.createdAt for the staleness fallback
 */
export function deriveOnboardingState(onboarding = {}, gmailConnected = false, createdAt = null) {
  const ob = onboarding || {};

  const started = Boolean(ob.started);
  const websiteAnalyzed = Boolean(ob.websiteAnalyzed);
  const smartQuestionsAnswered = Boolean(ob.smartQuestionsAnswered);
  const explicitlyComplete = Boolean(ob.completed);

  // Returning-user safety valve: an account older than 7 days without a
  // completion is treated as complete — protects existing users who predate the
  // onboarding flow (no onboarding field) and anyone who never finished it.
  const staleComplete = isStaleOnboarding(ob, createdAt);
  const isComplete = explicitlyComplete || staleComplete;

  const flags = {
    started,
    websiteAnalyzed,
    smartQuestionsAnswered,
    gmailConnected,
    completed: isComplete,
  };

  // Walk the flow to the first unmet gate.
  let currentStep;
  if (isComplete) currentStep = 6;             // First Prospects
  else if (!started) currentStep = 1;          // Meet Barry
  else if (!websiteAnalyzed) currentStep = 2;  // Barry Learns Your Business
  else if (!smartQuestionsAnswered) currentStep = 3; // Barry Asks Smart Questions
  else if (!gmailConnected) currentStep = 4;   // Connect Gmail
  else currentStep = 5;                        // Scout Builds Your List

  return {
    currentStep,
    isNewUser: !isComplete,
    isComplete,
    isSkipped: Boolean(ob.skipped),
    flags,
  };
}

export function useOnboardingState() {
  // `undefined` means "not yet loaded from Firestore"; an object/null means loaded.
  const [onboarding, setOnboarding] = useState(undefined);
  const [createdAt, setCreatedAt] = useState(null);
  const [gmailData, setGmailData] = useState(undefined);

  const user = getEffectiveUser();
  const uid = user?.uid || null;

  // Live subscription to the user doc (onboarding object + createdAt).
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setOnboarding(data.onboarding || {});
        setCreatedAt(data.createdAt || null);
      },
      (err) => {
        console.warn('[useOnboardingState] user doc listen failed:', err.message);
        setOnboarding({});
      }
    );
  }, [uid]);

  // Live subscription to the Gmail integration doc (connection state).
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      doc(db, 'users', uid, 'integrations', 'gmail'),
      (snap) => setGmailData(snap.exists() ? snap.data() : null),
      (err) => {
        console.warn('[useOnboardingState] gmail doc listen failed:', err.message);
        setGmailData(null);
      }
    );
  }, [uid]);

  /**
   * Write an onboarding flag to Firestore. `completed` also stamps completedAt.
   * Uses setDoc(merge) so it works even before the onboarding object exists.
   */
  const markStep = useCallback(
    async (flag) => {
      if (!ONBOARDING_FLAGS[flag]) {
        console.warn(`[useOnboardingState] Unknown onboarding flag: ${flag}`);
        return;
      }
      const activeUser = getEffectiveUser();
      if (!activeUser?.uid) return;

      const onboardingUpdate = { [flag]: true };
      if (flag === ONBOARDING_FLAGS.completed) {
        onboardingUpdate.completedAt = serverTimestamp();
      }

      try {
        await setDoc(
          doc(db, 'users', activeUser.uid),
          { onboarding: onboardingUpdate },
          { merge: true }
        );
      } catch (err) {
        console.error(`[useOnboardingState] Failed to mark '${flag}':`, err.message);
      }
    },
    []
  );

  const gmailConnected = deriveGmailConnected(gmailData);
  const derived = deriveOnboardingState(onboarding, gmailConnected, createdAt);

  // With no signed-in user there is nothing to load; otherwise we're loading
  // until both live subscriptions have delivered their first snapshot.
  const loading = uid ? onboarding === undefined || gmailData === undefined : false;

  return {
    ...derived,
    markStep,
    loading,
  };
}

export default useOnboardingState;
