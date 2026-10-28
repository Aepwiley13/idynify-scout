/**
 * linkedin-oauth-callback — LinkedIn redirects here after the consent screen.
 *
 * GET ?code&state, or ?error&state when the user declines.
 *
 * Always ends in a 302 back to Settings → Integrations with
 * `linkedin=<outcome>` (OUTCOMES in utils/linkedinOAuth.js), never on a raw
 * function response. The binding cookie is cleared either way.
 *
 * Order matters: the state is consumed before anything else, so it is
 * single-use even when the user declined or the code is missing.
 */

import { db } from './firebase-admin.js';
import {
  getLinkedInConfig, consumeOAuthState, resolveLinkedInIdentity, saveLinkedInIntegration,
  readBindingCookie, clearBindingCookie, LinkedInOAuthError, OUTCOMES, RETURN_PATH,
} from './utils/linkedinOAuth.js';
import { withLambda } from '@netlify/aws-lambda-compat';

function backToSettings(outcome) {
  return {
    statusCode: 302,
    headers: {
      Location: `${RETURN_PATH}&linkedin=${encodeURIComponent(outcome)}`,
      'Set-Cookie': clearBindingCookie(),
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

const handler = async (event) => {
  if (event.httpMethod !== 'GET') return backToSettings(OUTCOMES.ERROR);

  const params = event.queryStringParameters || {};
  const binding = readBindingCookie(event.headers || {});
  let uid = null;

  try {
    const config = getLinkedInConfig();

    let consumed = null;
    let stateError = null;
    try {
      consumed = await consumeOAuthState(db, { state: params.state, binding });
      uid = consumed.uid;
    } catch (err) {
      stateError = err;
    }

    // A decline is reported as such even when its state is bad: nothing was
    // granted, so there is nothing to protect, and "cancelled" is the truth.
    if (params.error) {
      console.log('[linkedin-oauth-callback] user declined:', String(params.error).slice(0, 64));
      return backToSettings(OUTCOMES.DENIED);
    }
    if (stateError) throw stateError;
    if (!params.code) throw new LinkedInOAuthError(OUTCOMES.MISSING_CODE, 'No authorization code');

    const { identity, nonceCheck } = await resolveLinkedInIdentity({ code: params.code, nonce: consumed.nonce, config });
    await saveLinkedInIntegration(db, { uid, identity });

    // nonceCheck is 'matched' or 'absent' — whether LinkedIn echoed the nonce
    // (see LINKEDIN_NONCE_POLICY), never the value.
    console.log('[linkedin-oauth-callback] connected for user:', uid, `nonce: ${nonceCheck}`);
    return backToSettings(OUTCOMES.CONNECTED);
  } catch (err) {
    const outcome = err instanceof LinkedInOAuthError ? err.outcome : OUTCOMES.ERROR;
    // LinkedInOAuthError messages are written to be loggable: they name the
    // failed check or an HTTP status, never a code, state, token or secret.
    console.error('[linkedin-oauth-callback] failed:', outcome, uid ? `user: ${uid}` : '', err.message);
    return backToSettings(outcome);
  }
};

// PHASE 0 SPIKE (#734) — do not merge. Runs this Lambda-style handler on
// Netlify's modern runtime. An export *named* `handler` makes Netlify treat
// the file as Lambda-mode, so the tests import it as `lambdaHandler`.
export { handler as lambdaHandler };
export default withLambda(handler);
