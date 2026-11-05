/**
 * The one message for each sticker failure (UI spec §4). Components never
 * show raw Firebase text. Pure.
 */
import { STICKER_ERRORS, DENIAL_REASONS, STICKER_LIMIT, STICKER_NAME_MAX, STICKER_DESCRIPTION_MAX } from '../../services/stickers/stickerCore';

export const LIMIT_MESSAGE = `This contact has ${STICKER_LIMIT} stickers. Remove one to add another.`;

const MESSAGES = Object.freeze({
  [STICKER_ERRORS.INVALID_NAME]: `A sticker name needs 1–${STICKER_NAME_MAX} characters.`,
  [STICKER_ERRORS.INVALID_COLOR]: 'Pick one of the colors.',
  [STICKER_ERRORS.INVALID_EMOJI]: 'That emoji is too long.',
  [STICKER_ERRORS.INVALID_DESCRIPTION]: `A description can be up to ${STICKER_DESCRIPTION_MAX} characters.`,
  [STICKER_ERRORS.LIMIT_REACHED]: LIMIT_MESSAGE,
  [STICKER_ERRORS.STICKER_ARCHIVED]: 'That sticker was archived. Restore it from Stickers to use it.',
  [STICKER_ERRORS.STICKER_NOT_FOUND]: 'That sticker no longer exists.',
  [STICKER_ERRORS.CONTACT_NOT_FOUND]: 'This contact no longer exists.',
});

const RETRY = "Couldn't save. Try again.";
const FALLBACK = 'Something went wrong. Try again.';

/** What went wrong, for the person: { message, retryable, writeDenied }. */
export function describeStickerError(error) {
  const code = error?.code;
  const reason = error?.reason;
  if (code === STICKER_ERRORS.PERMISSION_DENIED) {
    if (reason === DENIAL_REASONS.READ_DENIED) return { message: "You can't change stickers on this contact.", retryable: false, writeDenied: false };
    if (reason === DENIAL_REASONS.WRITE_DENIED) return { message: "Stickers can't be changed right now.", retryable: false, writeDenied: true };
    return { message: RETRY, retryable: true, writeDenied: false };
  }
  if (code === STICKER_ERRORS.WRITE_FAILED) return { message: RETRY, retryable: true, writeDenied: false };
  if (MESSAGES[code]) return { message: MESSAGES[code], retryable: false, writeDenied: false };
  return { message: FALLBACK, retryable: false, writeDenied: false };
}

/** The log line for a failure: codes only, never a name or an id (UI spec U7). */
export function logStickerFailure(action, error) {
  console.warn('[stickers]', { action, code: error?.code ?? 'unknown', reason: error?.reason ?? null });
}

export default { describeStickerError, logStickerFailure, LIMIT_MESSAGE };
