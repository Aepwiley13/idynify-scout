/**
 * The one support destination.
 *
 * Before this, "Help" did three different things depending on where you found
 * it: the top bar opened the Crisp widget if `window.$crisp` happened to be
 * loaded and otherwise a `mailto:support@idynify.com` that nothing answers,
 * and the mobile surfaces had no help affordance at all. One address, one
 * subject line, built in one place.
 */
export const SUPPORT_EMAIL = 'aaron@idynify.com';
export const SUPPORT_SUBJECT = 'Idynify Support Request';

/**
 * `mailto:` for the support link. Encoded rather than interpolated raw: a
 * subject with a space or an ampersand in it silently truncates the mailto in
 * some clients.
 */
export function supportMailto() {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
}
