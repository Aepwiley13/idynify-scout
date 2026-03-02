/**
 * GMAIL GET THREAD
 *
 * Sprint 2 — Fetch a Gmail thread so the reply can be read inside the app.
 *
 * Returns the thread messages with decoded body text so the user never
 * needs to open Gmail to read a reply.
 *
 * POST body: { userId, authToken, threadId }
 * Response:  { messages: [{ id, from, to, subject, body, date, isInbound }] }
 */

import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
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

// Decode base64url-encoded Gmail message body
function decodeBody(part) {
  if (!part) return '';
  // Prefer plain text; fall back to html
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    // Strip HTML tags for a plain-text preview
    const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  // Recurse into multipart
  if (part.parts && part.parts.length > 0) {
    const plain = part.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return decodeBody(plain);
    const html = part.parts.find(p => p.mimeType === 'text/html');
    if (html) return decodeBody(html);
    // Try nested multipart
    for (const child of part.parts) {
      const result = decodeBody(child);
      if (result) return result;
    }
  }
  return '';
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, threadId } = JSON.parse(event.body);
    if (!userId || !authToken || !threadId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing userId, authToken, or threadId' }) };
    }

    // ── Verify Firebase Auth token ───────────────────────────────────────────
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (verifyData.users[0]?.localId !== userId) throw new Error('Token does not match user ID');

    // ── Load Gmail credentials ───────────────────────────────────────────────
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ messages: [], code: 'GMAIL_NOT_CONNECTED' }) };
    }

    const gmailData = gmailDoc.data();
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2Client.setCredentials({
      access_token: gmailData.accessToken,
      refresh_token: gmailData.refreshToken,
    });

    // Refresh token if needed
    if (Date.now() >= gmailData.expiresAt - 60000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await gmailDoc.ref.update({
          accessToken: credentials.access_token,
          expiresAt: credentials.expiry_date,
          updatedAt: new Date().toISOString(),
        });
      } catch (refreshErr) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ messages: [], code: 'NEEDS_RECONNECT' }) };
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get profile so we know which address is "ours"
    let myEmail = gmailData.email?.toLowerCase() || '';
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      myEmail = profile.data.emailAddress?.toLowerCase() || myEmail;
    } catch (_) {}

    // ── Fetch the full thread ────────────────────────────────────────────────
    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const rawMessages = threadRes.data.messages || [];

    const messages = rawMessages.map(msg => {
      const headers = msg.payload?.headers || [];
      const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const from = get('From');
      const to = get('To');
      const subject = get('Subject');
      const date = get('Date');
      const isInbound = myEmail ? !from.toLowerCase().includes(myEmail) : false;
      const body = decodeBody(msg.payload);

      return { id: msg.id, from, to, subject, body, date, isInbound };
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ messages, threadId }),
    };

  } catch (error) {
    console.error('❌ gmail-get-thread error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
