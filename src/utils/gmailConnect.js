/**
 * Starts the Gmail connection (CH-GMAIL-001). The one place the app calls
 * gmail-oauth-init, so every entry point sends the token the same way and
 * comes back to the page it started from.
 *
 * The server sets a short-lived HttpOnly cookie on this response that binds the
 * attempt to this browser; a same-origin fetch stores it without extra options.
 *
 * Google sends the user back to `returnTo` with `gmail=<outcome>` appended
 * (see GMAIL_OUTCOME_MESSAGES); defaults to the current page.
 */
import { auth } from '../firebase/config';

export const GMAIL_OUTCOME_MESSAGES = Object.freeze({
  connected: null,
  denied: 'Gmail was not connected because access was declined on Google’s screen.',
  missing_permission: 'Gmail was not connected: please allow Idynify to send email on your behalf, then try again.',
  invalid_state: 'That Gmail connection link is not valid for this browser. Please start again from here.',
  expired_state: 'The Gmail connection took too long and expired. Please try again.',
  missing_code: 'Google did not complete the connection. Please try again.',
  token_failed: 'Google did not complete the connection. Please try again.',
  identity_failed: 'Google did not confirm the Gmail address. Please try again.',
  not_configured: 'Gmail is not set up yet. Please contact support.',
  error: 'Gmail could not be connected. Please try again.',
});

/** The message for a `gmail=` outcome, or null for success / no outcome. */
export function gmailOutcomeMessage(outcome) {
  if (!outcome) return null;
  return Object.prototype.hasOwnProperty.call(GMAIL_OUTCOME_MESSAGES, outcome)
    ? GMAIL_OUTCOME_MESSAGES[outcome]
    : GMAIL_OUTCOME_MESSAGES.error;
}

function currentPath() {
  if (typeof window === 'undefined') return undefined;
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * Asks the server for Google's consent URL and navigates there. Throws when
 * the user is signed out or the server refuses; callers show the message.
 */
export async function startGmailConnect({ returnTo = currentPath(), user = auth.currentUser, fetchImpl = fetch, navigate } = {}) {
  if (!user) throw new Error('Please sign in to connect Gmail.');
  const token = await user.getIdToken();
  const res = await fetchImpl('/.netlify/functions/gmail-oauth-init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // userId is the account the screen is acting for. Under admin
    // impersonation that is the target while the token is the admin's, and
    // the server refuses the mismatch rather than connecting the admin's
    // mailbox to someone else's account.
    body: JSON.stringify({ userId: user.uid, returnTo }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authUrl) throw new Error(data.error || 'Could not start the Gmail connection. Please try again.');
  (navigate || ((url) => { window.location.href = url; }))(data.authUrl);
  return data.authUrl;
}
