/**
 * GMAIL SEND QUICK
 *
 * Send a single email via Gmail API without requiring a campaign.
 * Used by Quick Engage flow in HunterContactDrawer.
 *
 * OPTION A: Real Send - produces verifiable email in Gmail Sent folder.
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

// Phase 1.5: attachment cap enforced server-side. NOTE: Netlify synchronous
// functions cap the request payload at ~6MB, so base64-encoded PDFs larger
// than ~4.3MB never reach this handler — see the Phase 1.5 flag on this.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Strip characters that would break or inject into MIME headers. */
function sanitizeFilename(filename) {
  const cleaned = String(filename || '').replace(/[\r\n"\\]/g, '').trim().slice(0, 200);
  return cleaned || 'attachment.pdf';
}

/**
 * Validate and normalize the optional attachment input
 * ({ data: base64 string, filename, mimeType: 'application/pdf' }).
 * Returns { error } on invalid input, or { part } ready for buildRawEmail.
 * Exported for testing.
 */
export function prepareAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
    return { error: 'attachment must be an object with data and filename' };
  }
  const { data, filename, mimeType } = attachment;
  if (typeof data !== 'string' || !data.trim()) {
    return { error: 'attachment.data must be a base64-encoded string' };
  }
  if (!filename || typeof filename !== 'string') {
    return { error: 'attachment.filename is required' };
  }
  if (mimeType && mimeType !== 'application/pdf') {
    return { error: 'Only PDF attachments (application/pdf) are supported' };
  }
  // Accept an optional data-URL prefix and strip whitespace/newlines
  const normalized = data.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return { error: 'attachment.data is not valid base64' };
  }
  const sizeBytes = Math.floor((normalized.length * 3) / 4);
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { error: 'Attachment exceeds the 10MB limit' };
  }
  return { part: { data: normalized, filename: sanitizeFilename(filename), mimeType: 'application/pdf' } };
}

/**
 * Build the RFC 2822 message for the Gmail API.
 * Without an attachment this produces exactly the same plain-text format as
 * before Phase 1.5 — no regression for existing callers. With an attachment
 * it produces a multipart/mixed message: a text/plain part for the body and
 * an application/pdf part with Content-Disposition: attachment.
 * Exported for testing.
 */
export function buildRawEmail({ toEmail, recipientName, subject, bodyText, ccHeader, attachment }) {
  const lines = [`To: ${recipientName} <${toEmail}>`];
  if (ccHeader) lines.push(`Cc: ${ccHeader}`);

  if (!attachment) {
    lines.push(
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      bodyText
    );
    return lines.join('\n');
  }

  const boundary = `idynify_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  // RFC 2045: base64 content lines must stay short — wrap at 76 chars
  const wrappedData = attachment.data.replace(/(.{76})/g, '$1\n');

  lines.push(
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    wrappedData,
    `--${boundary}--`,
    ''
  );
  return lines.join('\n');
}

export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // existingThreadId: optional — when provided the message is attached to an
    // existing Gmail thread (follow-up reply). gmail_thread_id in Firestore is
    // preserved; only gmail_last_message_id and last_sent_at are updated.
    // ccEmails: optional array of { name, email } objects to CC.
    // cc: optional single CC email string (Phase 1.5) — merged with ccEmails.
    // attachment: optional { data: base64, filename, mimeType: 'application/pdf' } (Phase 1.5).
    const { userId, authToken, toEmail, toName, subject, body, contactId, existingThreadId, ccEmails, cc, attachment } = JSON.parse(event.body);

    // Validate required fields
    if (!userId || !authToken || !toEmail || !subject || !body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required parameters: userId, authToken, toEmail, subject, body'
        })
      };
    }

    // Merge the Phase 1.5 single `cc` string into the CC list (deduplicated)
    const ccList = Array.isArray(ccEmails) ? [...ccEmails] : [];
    if (cc !== undefined && cc !== null && cc !== '') {
      const ccTrimmed = typeof cc === 'string' ? cc.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccTrimmed)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'cc must be a valid email address' })
        };
      }
      if (!ccList.some(r => r.email === ccTrimmed)) {
        ccList.push({ email: ccTrimmed });
      }
    }

    // Validate and normalize the optional attachment
    let attachmentPart = null;
    if (attachment !== undefined && attachment !== null) {
      const { error: attachmentError, part } = prepareAttachment(attachment);
      if (attachmentError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: attachmentError })
        };
      }
      attachmentPart = part;
    }

    console.log(`📧 Quick send email to ${toName || toEmail} from user ${userId}`);

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      throw new Error('Invalid authentication token');
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0]?.localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth token verified');

    // Load Gmail OAuth tokens from Firestore
    const gmailDoc = await db
      .collection('users')
      .doc(userId)
      .collection('integrations')
      .doc('gmail')
      .get();

    if (!gmailDoc.exists) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Gmail not connected. Please connect Gmail first.',
          code: 'GMAIL_NOT_CONNECTED'
        })
      };
    }

    const gmailData = gmailDoc.data();

    if (gmailData.status !== 'connected') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Gmail connection expired. Please reconnect.',
          code: 'GMAIL_EXPIRED'
        })
      };
    }

    let accessToken = gmailData.accessToken;
    const refreshToken = gmailData.refreshToken;
    const expiresAt = gmailData.expiresAt;

    console.log('✅ Gmail tokens loaded');

    // Validate Google OAuth environment variables
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      throw new Error('Google OAuth not configured');
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      googleClientId,
      googleClientSecret,
      googleRedirectUri
    );

    // Set initial credentials
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    // Check if access token is expired and refresh if needed
    if (Date.now() >= expiresAt - 60000) {
      console.log('🔄 Refreshing access token...');

      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        accessToken = credentials.access_token;

        // Update Firestore with new access token
        await db
          .collection('users')
          .doc(userId)
          .collection('integrations')
          .doc('gmail')
          .update({
            accessToken: accessToken,
            expiresAt: credentials.expiry_date,
            updatedAt: new Date().toISOString()
          });

        console.log('✅ Access token refreshed');
      } catch (refreshError) {
        console.error('❌ Failed to refresh token:', refreshError);
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

    // Fetch and append Gmail signature (non-blocking — falls back to no signature)
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const signature = await getGmailSignature(gmail);
    const bodyWithSignature = appendSignature(body, signature);

    // Create email in RFC 2822 format (multipart/mixed when a PDF is attached)
    const recipientName = toName || toEmail;
    const ccHeader = ccList.length > 0
      ? ccList.map(r => r.name && r.name !== r.email ? `${r.name} <${r.email}>` : r.email).join(', ')
      : null;
    const email = buildRawEmail({
      toEmail,
      recipientName,
      subject,
      bodyText: bodyWithSignature,
      ccHeader,
      attachment: attachmentPart
    });

    // Encode email in base64url format (required by Gmail API)
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    console.log('📤 Sending email via Gmail API...');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
        // Attach to existing thread when following up (keeps gmail_thread_id stable)
        ...(existingThreadId ? { threadId: existingThreadId } : {}),
      }
    });

    const gmailMessageId = result.data.id;
    const gmailThreadId = result.data.threadId;
    const sentAt = new Date().toISOString();

    console.log('✅ Email sent successfully, Gmail message ID:', gmailMessageId, 'thread ID:', gmailThreadId);

    // Store threadId on contact + mark as awaiting_reply (non-blocking)
    // If existingThreadId was provided (in-thread follow-up), gmail_thread_id is
    // preserved — only last_message and timestamps are updated.
    if (contactId) {
      try {
        const contactUpdate = {
          gmail_last_message_id: gmailMessageId,
          hunter_status: 'awaiting_reply',
          last_sent_at: sentAt,
          updated_at: sentAt,
        };
        if (!existingThreadId && gmailThreadId) {
          // Fresh send — record the new thread so replies can be tracked
          contactUpdate.gmail_thread_id = gmailThreadId;
        }
        await db
          .collection('users').doc(userId)
          .collection('contacts').doc(contactId)
          .update(contactUpdate);
        const threadLabel = existingThreadId ? `existing thread ${existingThreadId}` : `new thread ${gmailThreadId}`;
        console.log(`✅ Contact updated — ${threadLabel}, hunter_status → awaiting_reply`);
      } catch (updateErr) {
        console.warn('Failed to update contact after send, non-blocking:', updateErr);
      }
    }

    // Log to email_logs collection for admin visibility
    try {
      await db.collection('email_logs').add({
        userId,
        contactId: contactId || null,
        toEmail,
        toName: recipientName,
        subject,
        bodyPreview: body.substring(0, 200),
        gmailMessageId,
        gmailThreadId: gmailThreadId || null,
        status: 'sent',
        sentAt,
        source: 'quick_engage',
        ...(ccList.length > 0 && { ccEmails: ccList.map(r => r.email) }),
        ...(attachmentPart && { attachmentFilename: attachmentPart.filename })
      });
    } catch (logError) {
      console.warn('Failed to log email, non-blocking:', logError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        gmailMessageId,
        gmailThreadId,
        sentAt,
        message: 'Email sent successfully via Gmail'
      })
    };

  } catch (error) {
    console.error('❌ Error sending email:', error);

    // Determine user-friendly error message
    let errorMessage = error.message;
    let errorCode = 'SEND_FAILED';

    if (error.message?.includes('quota') || error.message?.includes('limit')) {
      errorMessage = 'Gmail daily sending limit reached. Please try again tomorrow.';
      errorCode = 'GMAIL_QUOTA';
    } else if (error.message?.includes('token') || error.message?.includes('auth')) {
      errorMessage = 'Gmail connection expired. Please reconnect Gmail.';
      errorCode = 'GMAIL_AUTH';
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: errorMessage,
        code: errorCode
      })
    };
  }
};
