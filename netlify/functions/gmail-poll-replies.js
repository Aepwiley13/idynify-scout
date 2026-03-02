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

const MAX_CONTACTS = 50;

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

    // ── Load contacts awaiting a reply that have a tracked threadId ───────────
    const contactsSnap = await db
      .collection('users').doc(userId)
      .collection('contacts')
      .where('hunter_status', 'in', ['active_mission', 'awaiting_reply'])
      .get();

    const candidates = contactsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => !!c.gmail_thread_id)
      .slice(0, MAX_CONTACTS);

    console.log(`📬 Checking ${candidates.length} tracked threads for ${userId}`);

    if (candidates.length === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], checkedCount: 0 }) };
    }

    // ── Check each thread for replies ─────────────────────────────────────────
    const transitioned = [];
    let needsReconnect = false;
    const receivedAt = new Date().toISOString();

    await Promise.all(candidates.map(async (contact) => {
      try {
        const threadRes = await gmail.users.threads.get({
          userId: 'me',
          id: contact.gmail_thread_id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });

        const messages = threadRes.data.messages || [];
        if (messages.length < 2) return; // Only our outbound message — no reply yet

        // Find messages NOT from us (replies from the contact)
        const replies = messages.filter(msg => {
          const fromHeader = msg.payload?.headers?.find(h => h.name === 'From')?.value || '';
          return myEmail ? !fromHeader.toLowerCase().includes(myEmail) : true;
        });

        if (replies.length === 0) return; // All messages are from us — no reply

        const latestReply = replies[replies.length - 1];
        const fromHeader = latestReply.payload?.headers?.find(h => h.name === 'From')?.value || '';
        const subjectHeader = latestReply.payload?.headers?.find(h => h.name === 'Subject')?.value || '';
        const gmailReplyId = latestReply.id;

        console.log(`✉️  Reply detected for contact ${contact.id} from ${fromHeader}`);

        // Write transition to Firestore (contact document)
        const contactRef = db
          .collection('users').doc(userId)
          .collection('contacts').doc(contact.id);

        await contactRef.update({
          hunter_status: 'in_conversation',
          contact_status: 'In Conversation',
          contact_status_updated_at: receivedAt,
          last_reply_at: receivedAt,
          last_reply_from: fromHeader,
          last_interaction_at: receivedAt,
          updated_at: receivedAt,
        });

        // ── Task 2.1: Also update mission document if contact is in a mission ──
        // Re-read the contact to get the latest active_mission_id
        const freshContactSnap = await contactRef.get();
        const freshContact = freshContactSnap.data() || {};
        const activeMissionId = freshContact.active_mission_id || contact.active_mission_id;

        if (activeMissionId) {
          try {
            const missionRef = db
              .collection('users').doc(userId)
              .collection('missions').doc(activeMissionId);
            const missionSnap = await missionRef.get();

            if (missionSnap.exists) {
              const missionData = missionSnap.data();
              const updatedContacts = (missionData.contacts || []).map(c =>
                c.contactId === contact.id
                  ? { ...c, replyStatus: 'replied', repliedAt: receivedAt, repliedFrom: fromHeader }
                  : c
              );
              await missionRef.update({ contacts: updatedContacts, updatedAt: receivedAt });
              console.log(`✅ Mission ${activeMissionId} updated — contact ${contact.id} marked replied`);
            }
          } catch (missionErr) {
            // Non-fatal — contact is still updated; log and continue
            console.warn(`[PollReplies] Mission update skipped for ${contact.id}:`, missionErr.message);
          }
        }

        // Log timeline event
        await db
          .collection('users').doc(userId)
          .collection('contacts').doc(contact.id)
          .collection('timeline')
          .add({
            type: 'message_received',
            actor: 'contact',
            preview: subjectHeader || 'Reply received',
            metadata: {
              gmailMessageId: gmailReplyId,
              gmailThreadId: contact.gmail_thread_id,
              fromAddress: fromHeader,
              autoDetected: true,
            },
            timestamp: receivedAt,
            createdAt: FieldValue.serverTimestamp(),
          });

        transitioned.push({
          contactId: contact.id,
          name: contact.name || 'Contact',
          threadId: contact.gmail_thread_id,
          fromEmail: fromHeader,
        });

      } catch (err) {
        if (err.status === 403 || err.code === 403) {
          needsReconnect = true;
        } else {
          console.warn(`[PollReplies] Skipping contact ${contact.id}:`, err.message);
        }
      }
    }));

    if (needsReconnect && transitioned.length === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ transitioned: [], code: 'NEEDS_RECONNECT' }) };
    }

    console.log(`✅ Poll complete — ${transitioned.length} transitions, ${candidates.length} checked`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        transitioned,
        checkedCount: candidates.length,
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
