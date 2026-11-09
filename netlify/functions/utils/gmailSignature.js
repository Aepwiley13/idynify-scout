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

/**
 * A bare valediction on its own line at the very end of the body, with no
 * name after it — Barry's draft prompt always produces exactly this (see
 * outboundCopyRules.js: "end emails with 'Best,' and no name"). Requires the
 * word to start right after a line break (or the string start) and run to
 * the end, so it only matches a line that IS the sign-off, not a sentence
 * that happens to end in one of these words ("let me know, thanks" does not
 * match; a line reading only "Thanks" or "Thanks," does).
 */
const BARE_VALEDICTION = /(^|\n)[ \t]*(Best regards|Best|Thanks|Thank you|Regards|Sincerely|Warmly|Cheers)[ \t]*,?[ \t]*$/i;

/**
 * Decide how to complete a message's sign-off when the user has no Gmail
 * signature configured, without ever producing a duplicate closing.
 *
 * The original fallback always appended a brand-new "Best,<br>{name}" block
 * after the body, via appendSignatureHtml. That collides with two real
 * cases: Barry's draft already ends every message with a bare "Best," (no
 * name) — appending another "Best,<br>Name" after it reads as
 * "Best,\n\nBest,\nName"; and a user who already typed their own closing
 * ("...\n\nBest,\nAaron Wiley", the exact workaround from the smoke test)
 * would get that same name appended a second time.
 *
 * This instead: (1) if the body already appears to end with the resolved
 * name, adds nothing — it's already signed; (2) if the body ends with a
 * bare valediction and no name, completes THAT line in place (same
 * paragraph, not a new signature block); (3) otherwise, with no existing
 * sign-off at all, adds a wholly separate "Best,<br>{name}" block exactly as
 * before.
 *
 * @param {string} bodyText  The plain-text message body, before HTML conversion.
 * @param {string} name      Already-resolved display name; empty/falsy means
 *   there is nothing to sign with — the body is returned unchanged.
 * @returns {{ bodyText: string, signatureHtml: string }}
 */
export function resolveFallbackSignOff(bodyText, name) {
  const trimmedName = (name || '').trim();
  if (!trimmedName || typeof bodyText !== 'string') {
    return { bodyText: bodyText ?? '', signatureHtml: '' };
  }

  // Already signed with (something that looks like) this name — the last
  // couple of non-empty lines are enough to catch "Best,\nAaron Wiley" or a
  // name on its own line with no valediction at all.
  const tailLines = bodyText.split('\n').map(l => l.trim()).filter(Boolean).slice(-2);
  if (tailLines.join(' ').toLowerCase().includes(trimmedName.toLowerCase())) {
    return { bodyText, signatureHtml: '' };
  }

  if (BARE_VALEDICTION.test(bodyText)) {
    // Complete the existing sign-off in place — same line, not a second one.
    return { bodyText: `${bodyText}\n${trimmedName}`, signatureHtml: '' };
  }

  // No sign-off of any kind in the body — add a wholly separate block.
  return { bodyText, signatureHtml: buildFallbackSignatureHtml(trimmedName) };
}
