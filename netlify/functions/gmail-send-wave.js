/**
 * GMAIL SEND WAVE
 *
 * Batch-send emails for a Basecamp engagement wave.
 * Iterates through recipients, personalizes {{first_name}},
 * sends each email via Gmail API, and returns per-recipient results.
 *
 * Called from EngagementCenter when user launches a wave.
 */

import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getGmailSignature, appendSignature } from './utils/gmailSignature.js';

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
}

const db = getFirestore();

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      userId,
      authToken,
      waveId,
      subject,
      messageTemplate,
      recipients, // [{ contactId, email, firstName, lastName, name, existingThreadId }]
    } = JSON.parse(event.body);

    if (!userId || !authToken || !waveId || !subject || !messageTemplate || !recipients?.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required parameters: userId, authToken, waveId, subject, messageTemplate, recipients'
        })
      };
    }

    console.log(`📧 Wave send: ${recipients.length} emails for wave ${waveId}`);

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) throw new Error('Invalid authentication token');

    const verifyData = await verifyResponse.json();
    if (verifyData.users[0]?.localId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth verified');

    // Load Gmail OAuth tokens
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Gmail not connected. Please connect Gmail in Settings first.',
          code: 'GMAIL_NOT_CONNECTED'
        })
      };
    }

    const gmailData = gmailDoc.data();
    let accessToken = gmailData.accessToken;
    const refreshToken = gmailData.refreshToken;

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    // Refresh token if expired
    if (Date.now() >= (gmailData.expiresAt || 0) - 60000) {
      console.log('🔄 Refreshing access token...');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        accessToken = credentials.access_token;
        await db.collection('users').doc(userId)
          .collection('integrations').doc('gmail')
          .update({
            accessToken,
            expiresAt: credentials.expiry_date,
            updatedAt: new Date().toISOString()
          });
      } catch (refreshError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Gmail connection expired. Please reconnect Gmail.',
            code: 'GMAIL_REFRESH_FAILED'
          })
        };
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch signature once for all emails
    const signature = await getGmailSignature(gmail);

    // Send emails sequentially (to respect Gmail rate limits)
    const results = [];
    let sentCount = 0;

    for (const recipient of recipients) {
      try {
        if (!recipient.email) {
          results.push({ contactId: recipient.contactId, status: 'skipped', reason: 'No email address' });
          continue;
        }

        // Personalize message
        const firstName = recipient.firstName || recipient.name?.split(' ')[0] || 'there';
        const personalizedBody = messageTemplate.replace(/\{\{first_name\}\}/gi, firstName);
        const bodyWithSignature = appendSignature(personalizedBody, signature);

        // Build RFC 2822 email
        const displayName = recipient.name ||
          `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() ||
          recipient.email;

        const emailLines = [
          `To: ${displayName} <${recipient.email}>`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          bodyWithSignature
        ];
        const rawEmail = emailLines.join('\n');

        const encodedEmail = Buffer.from(rawEmail)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Send via Gmail API
        const result = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedEmail,
            ...(recipient.existingThreadId ? { threadId: recipient.existingThreadId } : {}),
          }
        });

        const gmailMessageId = result.data.id;
        const gmailThreadId = result.data.threadId;
        const sentAt = new Date().toISOString();
        sentCount++;

        console.log(`✅ Sent to ${recipient.email} (${sentCount}/${recipients.length})`);

        // Update contact in Firestore (non-blocking)
        if (recipient.contactId) {
          try {
            const contactUpdate = {
              gmail_last_message_id: gmailMessageId,
              hunter_status: 'awaiting_reply',
              last_sent_at: sentAt,
              updated_at: sentAt,
            };
            if (!recipient.existingThreadId && gmailThreadId) {
              contactUpdate.gmail_thread_id = gmailThreadId;
            }
            await db.collection('users').doc(userId)
              .collection('contacts').doc(recipient.contactId)
              .update(contactUpdate);
          } catch (err) {
            console.warn(`Failed to update contact ${recipient.contactId}:`, err.message);
          }
        }

        // Log to email_logs
        try {
          await db.collection('email_logs').add({
            userId,
            contactId: recipient.contactId || null,
            toEmail: recipient.email,
            toName: displayName,
            subject,
            bodyPreview: personalizedBody.substring(0, 200),
            gmailMessageId,
            gmailThreadId: gmailThreadId || null,
            status: 'sent',
            sentAt,
            source: 'wave',
            waveId,
          });
        } catch (logErr) {
          console.warn('Failed to log email:', logErr.message);
        }

        results.push({
          contactId: recipient.contactId,
          status: 'sent',
          gmailMessageId,
          gmailThreadId,
          sentAt,
        });

        // Small delay between sends to avoid hitting Gmail rate limits
        if (sentCount < recipients.length) {
          await new Promise(r => setTimeout(r, 500));
        }

      } catch (sendErr) {
        console.error(`❌ Failed to send to ${recipient.email}:`, sendErr.message);
        results.push({
          contactId: recipient.contactId,
          status: 'failed',
          error: sendErr.message,
        });
      }
    }

    // Update wave doc with actual results
    try {
      await db.collection('users').doc(userId)
        .collection('waves').doc(waveId)
        .update({
          status: 'processed',
          'stats.sent': sentCount,
          processedAt: new Date().toISOString(),
        });
    } catch (err) {
      console.warn('Failed to update wave doc:', err.message);
    }

    console.log(`✅ Wave complete: ${sentCount}/${recipients.length} sent`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sent: sentCount,
        total: recipients.length,
        results,
      })
    };

  } catch (error) {
    console.error('❌ Wave send error:', error);

    let errorMessage = error.message;
    let errorCode = 'WAVE_SEND_FAILED';

    if (error.message?.includes('quota') || error.message?.includes('limit')) {
      errorMessage = 'Gmail daily sending limit reached. Try again tomorrow.';
      errorCode = 'GMAIL_QUOTA';
    } else if (error.message?.includes('token') || error.message?.includes('auth')) {
      errorMessage = 'Gmail connection expired. Please reconnect Gmail.';
      errorCode = 'GMAIL_AUTH';
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: errorMessage, code: errorCode })
    };
  }
};
