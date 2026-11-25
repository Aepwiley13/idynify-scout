/**
 * Disconnects the signed-in user's own Gmail (CH-GMAIL-001).
 *
 * POST, Firebase ID token in `Authorization: Bearer` (or `authToken` in the
 * body). Deletes users/{uid}/integrations/gmail, which holds the tokens, so
 * nothing in Idynify can use the grant again. Idempotent: disconnecting when
 * nothing is connected succeeds.
 *
 * The grant is deliberately NOT revoked at Google here. A Google grant is per
 * (Google account, OAuth client), so two Idynify accounts that connected the
 * same mailbox share one grant, and revoking it from one would silently
 * disconnect the other. The user can remove Idynify from
 * https://myaccount.google.com/permissions; see docs/gmail/CH-GMAIL-001.md.
 */
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { authenticateOwner, integrationPath } from './utils/gmailOAuth.js';

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export function createGmailDisconnectHandler({ verifyIdToken, db: firestore }) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return respond(400, { error: 'Invalid request' });
    }

    const auth = await authenticateOwner({
      verifyIdToken, authToken: extractAuthToken(event), bodyUserId: body.userId,
    });
    if (auth.error) return respond(auth.status, { error: auth.error });

    try {
      await firestore.doc(integrationPath(auth.uid)).delete();
      console.log('[gmail-disconnect] disconnected for user:', auth.uid);
      return respond(200, { success: true });
    } catch (err) {
      console.error('[gmail-disconnect] failed:', err.message);
      return respond(500, { error: 'Could not disconnect Gmail. Please try again.' });
    }
  };
}

export const handler = createGmailDisconnectHandler({
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  db,
});
