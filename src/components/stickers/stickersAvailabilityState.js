/**
 * What the app shows for a stickersConfig answer. Pure, with no imports, so
 * the emulator suite (scripts/rules-check/stickers-flag-parity.mjs) runs the
 * exact decision useStickersAvailability makes against the real rules.
 *
 *   available    the server said enabled, and not read-only
 *   unavailable  anything else: disabled, read-only (viewing as another
 *                user), an error status, or a malformed answer
 */
export const AVAILABILITY = Object.freeze({ CHECKING: 'checking', AVAILABLE: 'available', UNAVAILABLE: 'unavailable' });

export function availabilityFromConfig({ status, body } = {}) {
  return status === 200 && body?.enabled === true && body?.readOnly === false
    ? AVAILABILITY.AVAILABLE
    : AVAILABILITY.UNAVAILABLE;
}

export default { AVAILABILITY, availabilityFromConfig };
