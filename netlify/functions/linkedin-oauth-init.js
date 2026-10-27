/**
 * linkedin-oauth-init — starts Connect LinkedIn for the signed-in user.
 *
 * POST, Authorization: Bearer <Firebase ID token>.
 * Returns { authUrl }; the browser then navigates there (the same shape as
 * gmail-oauth-init, since a top-level navigation cannot carry the token).
 *
 * The user is the token's holder — never a userId from the body — so an
 * admin impersonating someone cannot attach their own LinkedIn to that
 * account. See utils/linkedinOAuth.js for how `state` is built and stored.
 */

import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import {
  getLinkedInConfig, createOAuthState, buildAuthorizationUrl, bindingCookie,
  LinkedInOAuthError, OUTCOMES,
} from './utils/linkedinOAuth.js';
import { withLambda } from '@netlify/aws-lambda-compat';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function respond(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { ...JSON_HEADERS, ...extraHeaders }, body: JSON.stringify(body) };
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const authToken = extractAuthToken(event);
  if (!authToken) return respond(401, { error: 'Sign in to connect LinkedIn' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return respond(401, { error: 'Invalid authentication token' });
  }

  try {
    const config = getLinkedInConfig();
    const { state, nonce, binding } = await createOAuthState(db, { uid });
    const authUrl = buildAuthorizationUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state, nonce });
    // The binding cookie is set on the host this request reached and is only
    // sent back to that host, so a callback on another host always fails.
    const requestHost = event.headers?.host;
    const callbackHost = new URL(config.redirectUri).host;
    if (requestHost && requestHost !== callbackHost) {
      console.warn(`[linkedin-oauth-init] started on ${requestHost} but LINKEDIN_REDIRECT_URI is on ${callbackHost}; the callback will reject this attempt`);
    }
    console.log('[linkedin-oauth-init] started for user:', uid);
    return respond(200, { authUrl }, { 'Set-Cookie': bindingCookie(binding) });
  } catch (err) {
    if (err instanceof LinkedInOAuthError && err.outcome === OUTCOMES.NOT_CONFIGURED) {
      console.error('[linkedin-oauth-init] LINKEDIN_* environment variables are not set');
      return respond(503, { error: 'LinkedIn is not set up yet. Please contact support.' });
    }
    console.error('[linkedin-oauth-init] failed:', err.message);
    return respond(500, { error: 'Could not start the LinkedIn connection. Please try again.' });
  }
};

// PHASE 0 SPIKE (#734) — do not merge. Runs this Lambda-style handler on
// Netlify's modern runtime. An export *named* `handler` makes Netlify treat
// the file as Lambda-mode, so the tests import it as `lambdaHandler`.
export { handler as lambdaHandler };
export default withLambda(handler);
