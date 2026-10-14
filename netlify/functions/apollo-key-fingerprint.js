/**
 * TEMPORARY DIAGNOSTIC — remove once the Apollo credential question is closed.
 *
 * Reports which APOLLO_API_KEY this deployed runtime holds, without exposing
 * it, so it can be compared with the key `netlify dev:exec --context
 * production` loads (scripts/apollo-auth-check.mjs prints the same
 * fingerprint):
 *   - key length
 *   - SHA-256 fingerprint (first 16 hex chars of the hash of the raw value,
 *     exactly as getApolloApiKey() reads it — no trimming)
 *   - auth/health HTTP status and is_logged_in, using getApolloHeaders()
 *
 * Endpoint: /.netlify/functions/apollo-key-fingerprint
 * Method: POST
 * Auth: Firebase ID token (Authorization: Bearer) + super admin
 */

import { createHash } from 'crypto';
import { admin } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkSuperAdminAccess } from './utils/superAdminAuth.js';
import { getApolloHeaders } from './utils/apolloConstants.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const authToken = extractAuthToken(event);
  if (!authToken) return reply(401, { error: 'Authentication required' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return reply(401, { error: 'Invalid authentication token' });
  }
  if (!(await checkSuperAdminAccess(uid))) return reply(403, { error: 'Super admin access required' });

  const key = process.env.APOLLO_API_KEY;
  if (!key) return reply(200, { keyPresent: false });

  let healthStatus = null;
  let isLoggedIn = null;
  try {
    const res = await fetch('https://api.apollo.io/api/v1/auth/health', { method: 'GET', headers: getApolloHeaders() });
    healthStatus = res.status;
    const body = await res.json().catch(() => null);
    isLoggedIn = body?.is_logged_in ?? null;
  } catch {
    // Network failure: healthStatus stays null.
  }

  return reply(200, {
    keyPresent: true,
    keyLength: key.length,
    keySha256Prefix: createHash('sha256').update(key).digest('hex').slice(0, 16),
    authHealthStatus: healthStatus,
    isLoggedIn,
  });
};
