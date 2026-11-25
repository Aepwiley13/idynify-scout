/**
 * Google's redirect back after the Gmail consent screen (CH-GMAIL-001).
 *
 * The Idynify user is taken ONLY from the single-use state stored at init and
 * bound to this browser by cookie; nothing in the query string can name a
 * user. Every outcome redirects back to the page that started the attempt
 * with `gmail=<outcome>` (and `connected=true` on success). No page is
 * rendered here, so nothing from the request is ever reflected into HTML.
 */
import { google } from 'googleapis';
import { db } from './firebase-admin.js';
import {
  getGmailOAuthConfig, consumeGmailOAuthState, assertUsableGrant, connectionDocument,
  integrationPath, readBindingCookie, clearBindingCookie, returnLocation,
  GmailOAuthError, OUTCOMES, DEFAULT_RETURN_PATH,
} from './utils/gmailOAuth.js';

function backTo(returnTo, outcome) {
  return {
    statusCode: 302,
    headers: {
      Location: returnLocation(returnTo || DEFAULT_RETURN_PATH, outcome),
      'Set-Cookie': clearBindingCookie(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
    body: '',
  };
}

/** Everything external is injected so the flow can be tested end to end. */
export function createGmailOAuthCallbackHandler({ db: firestore, makeOAuthClient, readUserInfo }) {
  return async (event) => {
    if (event.httpMethod !== 'GET') return backTo(null, OUTCOMES.ERROR);

    const params = event.queryStringParameters || {};
    const binding = readBindingCookie(event.headers || {});
    let uid = null;
    let returnTo = null;

    try {
      const config = getGmailOAuthConfig();

      // Consume the state first, whatever else the query says, so a state is
      // spent even when the user declined on Google's screen.
      let consumed = null;
      let stateError = null;
      try {
        consumed = await consumeGmailOAuthState(firestore, { state: params.state, binding });
        ({ uid, returnTo } = consumed);
      } catch (err) {
        stateError = err;
        returnTo = err.returnTo || null;
      }

      if (params.error) {
        console.log('[gmail-oauth-callback] user declined:', String(params.error).slice(0, 64));
        return backTo(returnTo, OUTCOMES.DENIED);
      }
      if (stateError) throw stateError;
      if (typeof params.code !== 'string' || !params.code || params.code.length > 2048) {
        throw new GmailOAuthError(OUTCOMES.MISSING_CODE, 'No authorization code');
      }

      const client = makeOAuthClient(config);
      let tokens;
      try {
        ({ tokens } = await client.getToken({ code: params.code, codeVerifier: consumed.codeVerifier }));
      } catch (err) {
        throw new GmailOAuthError(OUTCOMES.TOKEN_FAILED, `Token exchange failed: ${err?.response?.data?.error || err.message}`);
      }
      assertUsableGrant(tokens);

      client.setCredentials(tokens);
      let info;
      try {
        info = await readUserInfo(client);
      } catch (err) {
        throw new GmailOAuthError(OUTCOMES.IDENTITY_FAILED, `userinfo failed: ${err.message}`);
      }
      const email = typeof info?.email === 'string' ? info.email.trim() : '';
      if (!email || info.verified_email === false) {
        throw new GmailOAuthError(OUTCOMES.IDENTITY_FAILED, 'Google returned no verified email address');
      }

      await firestore.doc(integrationPath(uid)).set(connectionDocument({ tokens, email }));

      console.log('[gmail-oauth-callback] connected for user:', uid);
      return backTo(returnTo, OUTCOMES.CONNECTED);
    } catch (err) {
      const outcome = err instanceof GmailOAuthError ? err.outcome : OUTCOMES.ERROR;
      console.error('[gmail-oauth-callback] failed:', outcome, uid ? `user: ${uid}` : '', err.message);
      return backTo(returnTo, outcome);
    }
  };
}

export const handler = createGmailOAuthCallbackHandler({
  db,
  makeOAuthClient: ({ clientId, clientSecret, redirectUri }) => new google.auth.OAuth2(clientId, clientSecret, redirectUri),
  readUserInfo: async (client) => (await google.oauth2({ version: 'v2', auth: client }).userinfo.get()).data,
});
