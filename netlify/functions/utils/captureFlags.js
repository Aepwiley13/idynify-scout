/**
 * Relationship Capture rollout switches (architecture section 24).
 *
 * One server-side mode decides who may use capture. Every capture endpoint
 * checks it itself, so the client can hide or show the entry but can never
 * turn the feature on. Setting CAPTURE_MODE=off stops new captures without a
 * deploy.
 *
 *   CAPTURE_MODE     off | internal | beta | on
 *                      internal  admins and super admins
 *                      beta      those, plus users enrolled in
 *                                capture_enrollment/{uid} with stage 'beta'
 *                      on        every signed-in user
 *   CAPTURE_WITNESS  on | off   the second-opinion OCR check (section 4)
 *   CAPTURE_REPORTS  on | off   opt-in bad-scan reports (section 18)
 *
 * Fail-safe, as GMAIL_IDENTITY_MODE is: only the exact values above count.
 * Unset, empty, mixed-case or padded values mean off.
 *
 * Nothing here imports Firebase. The caller passes the admin check and the
 * database, so the same functions serve captureConfig and, later, every
 * capture endpoint.
 */
import process from 'node:process';

export const CAPTURE_MODES = Object.freeze({
  OFF: 'off',
  INTERNAL: 'internal',
  BETA: 'beta',
  ON: 'on',
});

const KNOWN_MODES = new Set(Object.values(CAPTURE_MODES));

/** Server-only: Firestore rules deny every client read and write. */
export const ENROLLMENT_COLLECTION = 'capture_enrollment';
export const ENROLLED_STAGE = 'beta';

/** The capture mode in force. Anything but an exact known value is off. */
export function captureMode(env = process.env) {
  const value = env.CAPTURE_MODE;
  return KNOWN_MODES.has(value) ? value : CAPTURE_MODES.OFF;
}

/** An on/off switch. Only the exact value 'on' turns it on. */
export function switchOn(value) {
  return value === 'on';
}

/**
 * Whether one user may capture, given what is known about them.
 * Pure: the caller supplies isAdmin and enrolled.
 */
export function decideCaptureAccess({ mode, isAdmin = false, enrolled = false }) {
  switch (mode) {
    case CAPTURE_MODES.ON: return true;
    case CAPTURE_MODES.BETA: return isAdmin === true || enrolled === true;
    case CAPTURE_MODES.INTERNAL: return isAdmin === true;
    default: return false;
  }
}

/**
 * Whether capture_enrollment/{uid} enrolls the user. `db` is an Admin SDK
 * Firestore instance.
 */
export async function isEnrolled(db, uid) {
  const snapshot = await db.collection(ENROLLMENT_COLLECTION).doc(uid).get();
  return snapshot.exists === true && snapshot.data()?.stage === ENROLLED_STAGE;
}

/**
 * The capture configuration for one user, reading only what the mode needs:
 * nothing when off or on, the admin check when internal, and enrollment only
 * when beta and the user is not an admin.
 *
 *   isAdmin(uid)  -> Promise<boolean>
 *   enrolled(uid) -> Promise<boolean>
 *
 * Returns { enabled, stage, witnessEnabled, reportEnabled }. The witness and
 * report switches read false for anyone capture is not enabled for.
 */
export async function resolveCaptureConfig(uid, { env = process.env, isAdmin, enrolled }) {
  const mode = captureMode(env);
  let admin = false;
  let enrolledUser = false;
  if (mode === CAPTURE_MODES.INTERNAL || mode === CAPTURE_MODES.BETA) {
    admin = await isAdmin(uid);
    if (mode === CAPTURE_MODES.BETA && !admin) enrolledUser = await enrolled(uid);
  }
  const enabled = decideCaptureAccess({ mode, isAdmin: admin, enrolled: enrolledUser });
  return {
    enabled,
    stage: enabled ? mode : null,
    witnessEnabled: enabled && switchOn(env.CAPTURE_WITNESS),
    reportEnabled: enabled && switchOn(env.CAPTURE_REPORTS),
  };
}
