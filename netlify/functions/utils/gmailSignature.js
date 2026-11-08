/**
 * Gmail Signature Utility
 *
 * Fetches the user's Gmail signature from the Gmail settings API.
 * Returns both the original HTML and a plain-text fallback so callers
 * sending text/html emails can preserve the user's rich signature.
 *
 * Requires gmail.readonly or gmail.settings.basic OAuth scope (both of which
 * are already requested during Gmail OAuth init).
 */

/**
 * Strip HTML tags and decode common HTML entities from a signature string.
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')  // <br> → newline
    .replace(/<p[^>]*>/gi, '\n')    // <p> opens → newline
    .replace(/<\/p>/gi, '')         // </p> → nothing (newline already added)
    .replace(/<div[^>]*>/gi, '\n')  // <div> opens → newline
    .replace(/<[^>]+>/g, '')        // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')     // collapse excessive blank lines
    .trim();
}

/**
 * Fetch the primary Gmail signature for the authenticated user.
 *
 * @param {import('googleapis').gmail_v1.Gmail} gmail  Authenticated Gmail client
 * @returns {Promise<string>} Plain-text signature, or empty string if none / on error
 */
export async function getGmailSignature(gmail) {
  try {
    const res = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAsEntries = res.data.sendAs || [];

    const primary = sendAsEntries.find(s => s.isDefault) || sendAsEntries[0];

    if (primary && primary.signature) {
      return htmlToPlainText(primary.signature);
    }

    return '';
  } catch (err) {
    console.warn('⚠️ Could not fetch Gmail signature (non-blocking):', err.message);
    return '';
  }
}

/**
 * Fetch the primary Gmail signature as raw HTML for use in HTML emails.
 *
 * @param {import('googleapis').gmail_v1.Gmail} gmail  Authenticated Gmail client
 * @returns {Promise<string>} HTML signature, or empty string if none / on error
 */
export async function getGmailSignatureHtml(gmail) {
  try {
    const res = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAsEntries = res.data.sendAs || [];

    const primary = sendAsEntries.find(s => s.isDefault) || sendAsEntries[0];

    if (primary && primary.signature) {
      return primary.signature;
    }

    return '';
  } catch (err) {
    console.warn('⚠️ Could not fetch Gmail signature HTML (non-blocking):', err.message);
    return '';
  }
}

/**
 * Append the Gmail signature to a body string.
 * Inserts a blank line between body and signature (Gmail convention).
 *
 * @param {string} body
 * @param {string} signature  Plain-text signature (may be empty)
 * @returns {string}
 */
export function appendSignature(body, signature) {
  if (!signature) return body;
  return `${body}\n\n-- \n${signature}`;
}

/**
 * Append the raw HTML Gmail signature to an HTML body.
 * Uses the standard Gmail separator convention.
 *
 * @param {string} htmlBody
 * @param {string} signatureHtml  Raw HTML signature (may be empty)
 * @returns {string}
 */
export function appendSignatureHtml(htmlBody, signatureHtml) {
  if (!signatureHtml) return htmlBody;
  return `${htmlBody}<br><div class="gmail_signature_container"><div dir="ltr" class="gmail_signature">${signatureHtml}</div></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The deterministic sign-off used when the user has no signature configured
 * in their Gmail account — the common case, since nothing in the app prompts
 * them to set one. Not a model-written name: Barry's own draft-generation
 * prompt deliberately omits the sender's name (see outboundCopyRules.js) and
 * ends every message with "Best," and nothing after it, so without this the
 * email goes out signed by no one. `name` is the caller's own resolved
 * display name (e.g. from userIdentity.js's displayNameFor) — this function
 * only renders it, it does not resolve identity itself.
 *
 * @param {string} name  Already-resolved display name; empty/falsy means
 *   there is nothing to sign with, so the result is '' (no fallback forced).
 * @returns {string} HTML signature block, or '' when there's no name to use.
 */
export function buildFallbackSignatureHtml(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return `Best,<br>${escapeHtml(trimmed)}`;
}
