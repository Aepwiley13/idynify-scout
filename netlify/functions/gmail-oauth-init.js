/**
 * Starts a Gmail connection for the signed-in user (CH-GMAIL-001).
 *
 * POST, Firebase ID token in `Authorization: Bearer` (or `authToken` in the
 * body, for older clients). Optional body `returnTo`: a same-site path to come
 * back to. Returns { authUrl } and sets the browser-binding cookie. The OAuth
 * `state` is random and single-use; see utils/gmailOAuth.js.
 *
 * Available to every signed-in account, Free (Contact Hub) included: nothing
 * here checks a plan.
 */
import { google } from 'googleapis';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import {
  getGmailOAuthConfig, createGmailOAuthState, bindingCookie, authenticateOwner,
  GmailOAuthError, OUTCOMES, GMAIL_SCOPES,
} from './utils/gmailOAuth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function respond(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { ...JSON_HEADERS, ...extraHeaders }, body: JSON.stringify(body) };
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

/** Pure enough to test: everything external is injected. */
export function createGmailOAuthInitHandler({ verifyIdToken, db: firestore, makeOAuthClient }) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

    const body = parseBody(event);
    if (body === null) return respond(400, { error: 'Invalid request' });

    const auth = await authenticateOwner({
      verifyIdToken, authToken: extractAuthToken(event), bodyUserId: body.userId,
    });
    if (auth.error) return respond(auth.status, { error: auth.error });
    const { uid } = auth;

    try {
      const config = getGmailOAuthConfig();
      const { state, binding, codeChallenge } = await createGmailOAuthState(firestore, { uid, returnTo: body.returnTo });
      const authUrl = makeOAuthClient(config).generateAuthUrl({
        access_type: 'offline', // refresh token
        prompt: 'consent',      // always return a refresh token, also on reconnect
        scope: [...GMAIL_SCOPES],
        state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
      });

      // The binding cookie is __Host-, so it only comes back if the callback
      // runs on the host that started the attempt.
      const requestHost = event.headers?.host;
      const callbackHost = new URL(config.redirectUri).host;
      if (requestHost && requestHost !== callbackHost) {
        console.warn(`[gmail-oauth-init] started on ${requestHost} but GOOGLE_REDIRECT_URI is on ${callbackHost}; the callback will reject this attempt`);
      }

      console.log('[gmail-oauth-init] started for user:', uid);
      return respond(200, { authUrl }, { 'Set-Cookie': bindingCookie(binding) });
    } catch (err) {
      if (err instanceof GmailOAuthError && err.outcome === OUTCOMES.NOT_CONFIGURED) {
        console.error('[gmail-oauth-init] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI not set');
        return respond(503, { error: 'Gmail is not set up yet. Please contact support.' });
      }
      console.error('[gmail-oauth-init] failed:', err.message);
      return respond(500, { error: 'Could not start the Gmail connection. Please try again.' });
    }
  };
}

export const handler = createGmailOAuthInitHandler({
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  db,
  makeOAuthClient: ({ clientId, clientSecret, redirectUri }) => new google.auth.OAuth2(clientId, clientSecret, redirectUri),
});
