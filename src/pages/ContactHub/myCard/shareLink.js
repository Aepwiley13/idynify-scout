/**
 * My Card sharing — the link, the share sheet and Copy Link. Pure functions with the browser's APIs
 * passed in, so they are tested without a browser.
 *
 * THE LINK is https://<domain>/c/<publicId>. It is the same for the life of the ID: details changing
 * never changes it; only Reset Link does. The domain is this page's own origin unless
 * VITE_MY_CARD_SHARE_ORIGIN names the canonical one (the production domain is verified in PR 5/7 before
 * any QR code is printed), and it is always https.
 */
import { isValidPublicId } from '../../../utils/myCardRules';

/** The public address of a card, or null when there is no valid ID to point at. */
export function cardLinkUrl(publicId, origin) {
  if (!isValidPublicId(publicId)) return null;
  let base;
  try {
    base = new URL(typeof origin === 'string' ? origin : '');
  } catch {
    return null;
  }
  // A card is only ever shared over https; plain http is allowed for a local address while developing.
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) return null;
  return `${base.origin}/c/${publicId}`;
}

/** The origin the link is built on: the configured one, else this page's. */
export function shareOrigin(env = import.meta.env, location = globalThis.location) {
  const configured = env?.VITE_MY_CARD_SHARE_ORIGIN;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return location?.origin ?? '';
}

export const SHARE_FEEDBACK = Object.freeze({
  copied: 'Link copied',
  copyFailed: 'Couldn\'t copy the link. Press and hold it to copy.',
  shared: 'Card shared',
  cancelled: null,
  unavailable: 'Turn on sharing first.',
});

/** The text that goes with the link in a message: the person's name, never any other detail. */
export const shareText = (name) => (name ? `${name}'s digital business card` : 'My digital business card');

/**
 * Copies `text`: the clipboard when there is one, else a temporary text selection. Never throws.
 * @returns {Promise<boolean>}
 */
export async function copyText(text, { clipboard = globalThis.navigator?.clipboard, document: doc = globalThis.document } = {}) {
  try {
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the selection method */ }
  try {
    if (!doc?.body || typeof doc.execCommand !== 'function') return false;
    const field = doc.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    doc.body.appendChild(field);
    field.select();
    const copied = doc.execCommand('copy');
    field.remove();
    return Boolean(copied);
  } catch {
    return false;
  }
}

/**
 * Share My Card: the device's share sheet (Messages, Mail, AirDrop and so on) with the person's name and
 * the link; where there is none, Copy Link. Cancelling the sheet is not an error.
 * @returns {Promise<{ status: 'shared'|'copied'|'cancelled'|'failed' }>}
 */
export async function shareCard({ url, name }, { navigator: nav = globalThis.navigator, copy = copyText } = {}) {
  if (!url) return { status: 'failed' };
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title: shareText(name), text: shareText(name), url });
      return { status: 'shared' };
    } catch (err) {
      // The person closed the sheet: nothing went wrong, and nothing is copied behind their back.
      if (err?.name === 'AbortError') return { status: 'cancelled' };
      // Anything else (a browser that refuses): fall back to copying the link.
    }
  }
  return (await copy(url)) ? { status: 'copied' } : { status: 'failed' };
}
