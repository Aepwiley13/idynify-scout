/**
 * linkedin-disconnect — removes the signed-in user's LinkedIn connection.
 *
 * POST, Authorization: Bearer <Firebase ID token>. Acts on the token's
 * holder only. No LinkedIn token is stored (utils/linkedinOAuth.js), so there
 * is nothing to revoke at LinkedIn; the user can also remove the app from
 * their LinkedIn settings.
 */

import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { disconnectLinkedIn } from './utils/linkedinOAuth.js';
import { withLambda } from '@netlify/aws-lambda-compat';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function respond(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const authToken = extractAuthToken(event);
  if (!authToken) return respond(401, { error: 'Sign in to disconnect LinkedIn' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return respond(401, { error: 'Invalid authentication token' });
  }

  try {
    await disconnectLinkedIn(db, { uid });
    console.log('[linkedin-disconnect] disconnected for user:', uid);
    return respond(200, { success: true });
  } catch (err) {
    console.error('[linkedin-disconnect] failed:', err.message);
    return respond(500, { error: 'Could not disconnect LinkedIn. Please try again.' });
  }
};

// PHASE 0 SPIKE (#734) — do not merge. Runs this Lambda-style handler on
// Netlify's modern runtime. An export *named* `handler` makes Netlify treat
// the file as Lambda-mode, so the tests import it as `lambdaHandler`.
export { handler as lambdaHandler };
export default withLambda(handler);
