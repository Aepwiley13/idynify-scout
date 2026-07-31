/**
 * The one support destination.
 *
 * Before this, "Help" did three different things depending on where you found
 * it: the top bar opened the Crisp widget if `window.$crisp` happened to be
 * loaded and otherwise a `mailto:support@idynify.com` that nothing answers,
 * and the mobile surfaces had no help affordance at all.
 *
 * CHANGING THE ADDRESS IS A ONE-LINE EDIT HERE, or an environment variable —
 * nothing else in the codebase names a support address. Every surface calls
 * `supportMailto()`.
 *
 * The target is support@idynify.com. It is not the default yet because that
 * inbox is not live, and pointing help at an unmonitored address is worse than
 * pointing it at a monitored personal one — that is exactly the failure the
 * old fallback had. Aaron confirms when it is live; flip DEFAULT_SUPPORT_EMAIL
 * below, or set VITE_SUPPORT_EMAIL to roll it out per environment first.
 */

/** The intended destination. Not live yet — see above. */
export const PLANNED_SUPPORT_EMAIL = 'support@idynify.com';

/** What ships today. Monitored. */
const DEFAULT_SUPPORT_EMAIL = 'aaron@idynify.com';

export const SUPPORT_EMAIL =
  import.meta.env?.VITE_SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL;

export const SUPPORT_SUBJECT = 'Idynify Support Request';

/**
 * `mailto:` for the support link. Encoded rather than interpolated raw: a
 * subject with a space or an ampersand in it silently truncates the mailto in
 * some clients.
 */
export function supportMailto() {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
}
