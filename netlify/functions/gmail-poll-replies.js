/**
 * GMAIL POLL REPLIES
 *
 * Sprint 3 — Gmail reply detection auto-transition.
 *
 * Checks Gmail for replies on threads where we sent outreach.
 * When a reply is detected the contact transitions:
 *   hunter_status:  awaiting_reply → in_conversation
 *   contact_status: Awaiting Reply → In Conversation
 *
 * Requires: gmail.readonly scope (users connected before Sprint 3 must reconnect).
 * If the token lacks the scope, returns { code: 'NEEDS_RECONNECT' }.
 *
 * Called on-demand by the Hunter People "Sync Replies" button.
 * Safety cap: max 50 contacts checked per call to stay within rate limits.
 *
 * The per-contact logic (thread check, reply classification, status write,
 * timeline event) lives in ./utils/replyPolling.js, shared with the
 * scheduled worker (gmail-reply-sync-worker.js) so "Sync Replies" and the
 * automatic schedule run the exact same implementation. This file keeps
 * only its own HTTP contract — auth, OAuth setup, response shape — unchanged.
 */

import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireProjectId } from './utils/firebaseEnv.js';
import { pollRepliesForUser } from './utils/replyPolling.js';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  initializeApp({
    credential: cert({
      projectId: requireProjectId(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore();

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken } = JSON.parse(event.body);
    if (!userId || !authToken) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing userId or authToken' }) };
    }

    // ── Verify Firebase Auth token ────────────────────────────────────────────
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (verifyData.users[0]?.localId !== userId) throw new Error('Token does not match user ID');

    // ── Load Gmail credentials ────────────────────────────────────────────────
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], code: 'GMAIL_NOT_CONNECTED' }) };
    }

    const gmailData = gmailDoc.data();
    const { googleClientId, googleClientSecret, googleRedirectUri } = {
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
      googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    };
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      throw new Error('Google OAuth not configured');
    }

    const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
    oauth2Client.setCredentials({
      access_token: gmailData.accessToken,
      refresh_token: gmailData.refreshToken,
    });

    // Refresh access token if expired
    if (Date.now() >= gmailData.expiresAt - 60000) {
      console.log('🔄 Refreshing Gmail access token...');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await gmailDoc.ref.update({
          accessToken: credentials.access_token,
          expiresAt: credentials.expiry_date,
          updatedAt: new Date().toISOString(),
        });
        console.log('✅ Token refreshed');
      } catch (refreshErr) {
        console.error('❌ Token refresh failed:', refreshErr);
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], code: 'NEEDS_RECONNECT' }) };
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ── Scope check — try a lightweight read call ─────────────────────────────
    // If the user connected Gmail before Sprint 3 (send-only scope), threads.get
    // will return 403. Detect this and prompt reconnect.
    let myEmail = gmailData.email?.toLowerCase() || '';
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      myEmail = profile.data.emailAddress?.toLowerCase() || myEmail;
    } catch (scopeErr) {
      if (scopeErr.status === 403 || scopeErr.code === 403) {
        console.warn('⚠️  Gmail read scope missing — reconnect required');
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], code: 'NEEDS_RECONNECT' }) };
      }
      // Non-scope errors: continue with stored email
      console.warn('getProfile failed (non-blocking):', scopeErr.message);
    }

    // ── Check tracked threads for replies — shared with the scheduled worker ──
    const { transitioned, checkedCount, needsReconnect } = await pollRepliesForUser(db, gmail, userId, myEmail);

    if (checkedCount === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], checkedCount: 0 }) };
    }

    if (needsReconnect && transitioned.length === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], code: 'NEEDS_RECONNECT' }) };
    }

    console.log(`✅ Poll complete — ${transitioned.length} transitions, ${checkedCount} checked`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        transitioned,
        checkedCount,
      }),
    };

  } catch (error) {
    console.error('❌ gmail-poll-replies error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
