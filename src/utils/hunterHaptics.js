/**
 * HUNTER HAPTICS — Vibration feedback via Web Vibration API.
 *
 * Mobile only. Desktop: silent fallback (do nothing, no substitute).
 * The absence of fallback is intentional — don't simulate haptics visually.
 *
 * Archive: NO haptic — intentional per spec.
 * The absence of feedback on archive = low energy = this contact stays benched.
 * Confirm this is absent, not broken, during QA.
 */

/**
 * triggerEngageHaptic — Single firm 50ms pulse on engage.
 * Not a buzz — a confirmation. Like a physical button click.
 * Fires simultaneously with the rocket launch sound (Phase 1 shake).
 */
export function triggerEngageHaptic() {
  if (!navigator.vibrate) return; // Desktop / unsupported — silent fallback
  navigator.vibrate(50);
}

/**
 * isHapticsAvailable — Returns true if the Vibration API is supported.
 * Used by useMissionSounds to set the initial hapticsEnabled state.
 */
export function isHapticsAvailable() {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}
