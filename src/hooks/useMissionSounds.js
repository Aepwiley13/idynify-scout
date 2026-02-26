/**
 * useMissionSounds — Mission sounds + haptics preference hook.
 *
 * Firestore path: users/{userId}.preferences.missionSounds (boolean)
 * Default: true (sounds on by default)
 *
 * Returns:
 *   soundEnabled    — boolean, persisted to Firestore
 *   setSoundEnabled — persists to Firestore + updates local state
 *   hapticsEnabled  — boolean, true if Vibration API is available (device capability)
 *
 * Haptics are ALWAYS enabled on capable devices regardless of soundEnabled.
 * When sound is OFF: engage fires haptic only, archive fires nothing.
 */

import { useMemo } from 'react';
import { useUserPreference } from './useUserPreference';
import { isHapticsAvailable } from '../utils/hunterHaptics';

export function useMissionSounds() {
  const [soundEnabled, setSoundEnabled] = useUserPreference('missionSounds', true);

  // Device capability — cannot be toggled by user (it's hardware)
  const hapticsEnabled = useMemo(() => isHapticsAvailable(), []);

  return { soundEnabled, setSoundEnabled, hapticsEnabled };
}
