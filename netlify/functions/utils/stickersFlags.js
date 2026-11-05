/**
 * Sticker rollout (ADR-007), server side.
 *
 * Reads the three inputs firestore.rules reads for every sticker write, and
 * makes the same decision with the same function:
 *   feature_flags/stickers.mode         the rollout mode
 *   users/{uid}.role                    admin or super_admin
 *   sticker_enrollment/{uid}.stage      the beta list
 * The ADMIN_USER_IDS / SUPER_ADMIN_USER_IDS environment lists are NOT used:
 * the rules cannot see them, and an answer the rules would contradict is the
 * failure this module exists to prevent.
 *
 * `db` is an Admin SDK Firestore instance.
 */
import {
  decideStickerAccess,
  readStickerMode,
  STICKER_FLAG_PATH,
  STICKER_ENROLLMENT_COLLECTION,
} from '../../../src/constants/stickersAccess.js';

const field = (snapshot, name) => (snapshot.exists ? snapshot.data()?.[name] : undefined);

export async function readStickerAccessInputs(db, uid) {
  const [flag, user, enrollment] = await Promise.all([
    db.collection(STICKER_FLAG_PATH.collection).doc(STICKER_FLAG_PATH.doc).get(),
    db.collection('users').doc(uid).get(),
    db.collection(STICKER_ENROLLMENT_COLLECTION).doc(uid).get(),
  ]);
  return { mode: field(flag, 'mode'), role: field(user, 'role'), enrollmentStage: field(enrollment, 'stage') };
}

/** { enabled, mode } for one user: the answer the rules give that user's sticker writes. */
export async function resolveStickersConfig(db, uid) {
  const inputs = await readStickerAccessInputs(db, uid);
  return { enabled: decideStickerAccess(inputs), mode: readStickerMode(inputs.mode) };
}
