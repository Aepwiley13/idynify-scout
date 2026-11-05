/**
 * Who may write stickers, by rollout mode (ADR-007).
 *
 * ONE decision, enforced in two places that must agree:
 *   firestore.rules           stickerWritesAllowed(): the gate. Every sticker
 *                             write is a client write, so the rules decide.
 *   stickersConfig function   whether the app shows sticker controls at all.
 *
 * Both read the same inputs from Firestore: the mode in feature_flags/stickers,
 * the user's role in users/{uid}.role and the user's row in
 * sticker_enrollment/{uid}. Neither reads the ADMIN_USER_IDS or
 * SUPER_ADMIN_USER_IDS environment lists, because the rules cannot see them.
 *
 * STICKER_ACCESS_MATRIX is run by BOTH suites: src/test/stickersAccess.test.js
 * against decideStickerAccess(), and scripts/rules-check/stickers.mjs against
 * the real rules in the Firestore emulator. A row that passes one and fails
 * the other means the UI and the database disagree.
 *
 * Plain data and one pure function: no Firebase import, so the browser, the
 * Netlify functions and the emulator suite can all load it.
 */

export const STICKER_MODES = Object.freeze({
  OFF: 'off',
  INTERNAL: 'internal',
  BETA: 'beta',
  ON: 'on',
});

const KNOWN_MODES = new Set(Object.values(STICKER_MODES));

/** Roles in users/{uid}.role that count as platform admins for stickers. */
export const STICKER_ADMIN_ROLES = Object.freeze(['admin', 'super_admin']);

/** The sticker_enrollment/{uid}.stage value that enrolls a user in beta. */
export const STICKER_ENROLLED_STAGE = 'beta';

/** Where the rollout mode and the beta list live. Clients can read neither. */
export const STICKER_FLAG_PATH = Object.freeze({ collection: 'feature_flags', doc: 'stickers' });
export const STICKER_ENROLLMENT_COLLECTION = 'sticker_enrollment';

/** The mode in force: only an exact known value counts; anything else is off. */
export function readStickerMode(value) {
  return KNOWN_MODES.has(value) ? value : STICKER_MODES.OFF;
}

/**
 * May this user write stickers?
 *
 * @param {object} input
 * @param {*} input.mode             feature_flags/stickers.mode as stored (any value)
 * @param {*} input.role             users/{uid}.role as stored (any value)
 * @param {*} input.enrollmentStage  sticker_enrollment/{uid}.stage, or undefined
 * @returns {boolean}
 */
export function decideStickerAccess({ mode, role, enrollmentStage } = {}) {
  const admin = STICKER_ADMIN_ROLES.includes(role);
  const enrolled = enrollmentStage === STICKER_ENROLLED_STAGE;
  switch (readStickerMode(mode)) {
    case STICKER_MODES.ON: return true;
    case STICKER_MODES.BETA: return admin || enrolled;
    case STICKER_MODES.INTERNAL: return admin;
    default: return false;
  }
}

/**
 * The parity table. `mode: null` means feature_flags/stickers does not exist;
 * `role: null` means users/{uid} has no role; `stage: null` means no
 * enrollment row.
 */
export const STICKER_ACCESS_MATRIX = Object.freeze([
  // No flag document, or a value that is not exactly a mode: off for everyone.
  { mode: null, role: 'admin', stage: 'beta', allowed: false },
  { mode: 'On', role: 'admin', stage: null, allowed: false },
  { mode: 'enabled', role: null, stage: null, allowed: false },
  // off
  { mode: 'off', role: null, stage: null, allowed: false },
  { mode: 'off', role: 'admin', stage: null, allowed: false },
  { mode: 'off', role: 'super_admin', stage: null, allowed: false },
  { mode: 'off', role: null, stage: 'beta', allowed: false },
  // internal: admins and super admins only
  { mode: 'internal', role: null, stage: null, allowed: false },
  { mode: 'internal', role: null, stage: 'beta', allowed: false },
  { mode: 'internal', role: 'admin', stage: null, allowed: true },
  { mode: 'internal', role: 'super_admin', stage: null, allowed: true },
  { mode: 'internal', role: 'viewer', stage: null, allowed: false },
  // beta: admins, plus users enrolled with stage "beta"
  { mode: 'beta', role: null, stage: null, allowed: false },
  { mode: 'beta', role: null, stage: 'beta', allowed: true },
  { mode: 'beta', role: null, stage: 'waitlist', allowed: false },
  { mode: 'beta', role: 'admin', stage: null, allowed: true },
  { mode: 'beta', role: 'super_admin', stage: null, allowed: true },
  // on: every signed-in user
  { mode: 'on', role: null, stage: null, allowed: true },
  { mode: 'on', role: 'admin', stage: null, allowed: true },
]);

export default {
  STICKER_MODES,
  STICKER_ADMIN_ROLES,
  STICKER_ENROLLED_STAGE,
  STICKER_FLAG_PATH,
  STICKER_ENROLLMENT_COLLECTION,
  STICKER_ACCESS_MATRIX,
  readStickerMode,
  decideStickerAccess,
};
