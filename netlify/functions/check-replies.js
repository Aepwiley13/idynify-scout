/**
 * CHECK REPLIES — Cadence reply detection
 *
 * Phase 2 Workstream B — checks Gmail threads for replies to cadence emails.
 *
 * POST body: { userId, authToken, cadenceId }
 * Response:  { checked, repliesFound, replies: [{ contactId, name }] }
 *
 * For each contact in the cadence where replied !== true and gmailThreadId
 * exists, fetches the Gmail thread and checks if someone other than the
 * user has replied. On reply detected:
 *   1. Updates contact entry in cadence doc: replied: true, repliedAt
 *   2. Increments repliedCount on cadence doc
 *   3. Writes timeline event: reply_received
 *   4. Updates contact doc: last_replied_at, contact_status: 'In Conversation'
 *
 * Rate limit: max 50 threads per call.
 */

import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

const MAX_THREADS = 50;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, cadenceId } = JSON.parse(event.body);
    if (!userId || !authToken || !cadenceId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing userId, authToken, or cadenceId' }) };
    }

    // ── Verify Firebase Auth token ──────────────────────────────────────────
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (verifyData.users[0]?.localId !== userId) throw new Error('Token does not match user ID');

    // ── Read cadence doc ────────────────────────────────────────────────────
    const cadenceRef = db.collection('users').doc(userId).collection('cadences').doc(cadenceId);
    const cadenceSnap = await cadenceRef.get();
    if (!cadenceSnap.exists) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cadence not found' }) };
    }

    const cadenceData = cadenceSnap.data();
    const contacts = cadenceData.contacts || [];

    const candidates = contacts
      .filter(c => !c.replied && c.gmailThreadId)
      .slice(0, MAX_THREADS);

    if (candidates.length === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ checked: 0, repliesFound: 0, replies: [] }) };
    }

    // ── Load Gmail credentials ──────────────────────────────────────────────
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ checked: 0, repliesFound: 0, code: 'GMAIL_NOT_CONNECTED' }) };
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
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ checked: 0, repliesFound: 0, code: 'NEEDS_RECONNECT' }) };
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ── Get user's email for filtering outbound messages ────────────────────
    let myEmail = gmailData.email?.toLowerCase() || '';
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      myEmail = profile.data.emailAddress?.toLowerCase() || myEmail;
    } catch (scopeErr) {
      if (scopeErr.status === 403 || scopeErr.code === 403) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ checked: 0, repliesFound: 0, code: 'NEEDS_RECONNECT' }) };
      }
    }

    // ── Check each thread for replies ───────────────────────────────────────
    const replies = [];
    const now = new Date().toISOString();

    await Promise.all(candidates.map(async (contact) => {
      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: contact.gmailThreadId,
          format: 'metadata',
          metadataHeaders: ['From'],
        });

        const messages = threadRes.data.messages || [];
        if (messages.length < 2) return;

        const inboundMessages = messages.filter(msg => {
          const fromHeader = msg.payload?.headers?.find(h => h.name === 'From')?.value || '';
          return myEmail ? !fromHeader.toLowerCase().includes(myEmail) : false;
        });

        if (inboundMessages.length === 0) return;

        replies.push({
          contactId: contact.contactId,
          name: contact.name || contact.email,
          gmailThreadId: contact.gmailThreadId,
        });
      } catch (err) {
        console.warn(`[check-replies] Skipping thread ${contact.gmailThreadId}:`, err.message);
      }
    }));

    // ── Write reply data to Firestore ───────────────────────────────────────
    if (replies.length > 0) {
      const replyContactIds = new Set(replies.map(r => r.contactId));

      const updatedContacts = contacts.map(c => {
        if (replyContactIds.has(c.contactId)) {
          return { ...c, replied: true, repliedAt: now };
        }
        return c;
      });

      await cadenceRef.update({
        contacts: updatedContacts,
        repliedCount: FieldValue.increment(replies.length),
      });

      const writePromises = replies.map(async (reply) => {
        if (!reply.contactId) return;
        try {
          const contactRef = db
            .collection('users').doc(userId)
            .collection('contacts').doc(reply.contactId);

          await contactRef.update({
            last_replied_at: now,
            contact_status: 'In Conversation',
            updated_at: now,
          });

          await db
            .collection('users').doc(userId)
            .collection('contacts').doc(reply.contactId)
            .collection('timeline')
            .add({
              type: 'reply_received',
              actor: 'contact',
              preview: 'Reply received',
              metadata: {
                cadenceId,
                gmailThreadId: reply.gmailThreadId,
                repliedAt: now,
              },
              timestamp: now,
              createdAt: FieldValue.serverTimestamp(),
            });
        } catch (writeErr) {
          console.warn(`[check-replies] Contact doc update failed for ${reply.contactId}:`, writeErr.message);
        }
      });

      await Promise.all(writePromises);
    }

    console.log(`✅ check-replies complete — ${candidates.length} checked, ${replies.length} replies found`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        checked: candidates.length,
        repliesFound: replies.length,
        replies: replies.map(r => ({ contactId: r.contactId, name: r.name })),
      }),
    };

  } catch (error) {
    console.error('❌ check-replies error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
