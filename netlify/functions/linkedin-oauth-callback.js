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

export const handler = async (event) => {
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

    const identity = await resolveLinkedInIdentity({ code: params.code, nonce: consumed.nonce, config });
    await saveLinkedInIntegration(db, { uid, identity });

    console.log('[linkedin-oauth-callback] connected for user:', uid);
    return backToSettings(OUTCOMES.CONNECTED);
  } catch (err) {
    const outcome = err instanceof LinkedInOAuthError ? err.outcome : OUTCOMES.ERROR;
    console.error('[linkedin-oauth-callback] failed:', outcome, uid ? `user: ${uid}` : '', err instanceof LinkedInOAuthError ? '' : err.message);
    return backToSettings(outcome);
  }
};
