/**
 * #006.8 — one plain-language explanation of an ICP profile's state.
 *
 * Derived only from fields ICP Settings already reads (isActive, status,
 * managedByBarry). It decides nothing: activation, setup and saving keep
 * their existing handlers. Exactly one state applies, so the screen never
 * shows two status messages that disagree; "managed by Barry" is a note
 * that adds to whichever state applies.
 */

export const PROFILE_STATE = Object.freeze({
  ACTIVE: 'active',      // isActive && status === 'active' (same test as the tab's Active badge)
  SETUP: 'setup',        // status === 'pending' — messaging setup not finished
  INACTIVE: 'inactive',  // anything else: saved, not searching
});

export const PROFILE_STATE_TEXT = Object.freeze({
  active: 'Barry is searching with this profile.',
  inactive: 'This profile is saved but not active. Activate it to start searching.',
  // Saved and not active, but no Set as Active control is offered for it.
  inactiveNoAction: 'This profile is saved but not active.',
  setup: 'This profile is saved but not active. Finish setup to start searching.',
  managed: 'Barry created this profile with you. Your edits here take priority.',
});

/**
 * @param {object|null} icp       the selected profile as listed (isActive, status)
 * @param {object|null} profile   the profile being edited (managedByBarry)
 * @returns {null | { state, text, managedText: string|null, canActivate: boolean, canFinishSetup: boolean }}
 */
export function describeIcpProfile(icp, profile = icp) {
  if (!icp) return null;
  const managedText = profile?.managedByBarry ? PROFILE_STATE_TEXT.managed : null;

  if (icp.isActive && icp.status === 'active') {
    return { state: PROFILE_STATE.ACTIVE, text: PROFILE_STATE_TEXT.active, managedText, canActivate: false, canFinishSetup: false };
  }
  if (icp.status === 'pending') {
    return { state: PROFILE_STATE.SETUP, text: PROFILE_STATE_TEXT.setup, managedText, canActivate: false, canFinishSetup: true };
  }
  const canActivate = icp.status === 'inactive';
  return {
    state: PROFILE_STATE.INACTIVE,
    text: canActivate ? PROFILE_STATE_TEXT.inactive : PROFILE_STATE_TEXT.inactiveNoAction,
    managedText,
    canActivate,
    canFinishSetup: false,
  };
}
