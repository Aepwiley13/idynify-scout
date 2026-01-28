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
    const { userId, authToken, toEmail, toName, subject, body, contactId } = JSON.parse(event.body);

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

    // Create email in RFC 2822 format
    const recipientName = toName || toEmail;
    const email = [
      `To: ${recipientName} <${toEmail}>`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body
    ].join('\n');

    // Encode email in base64url format (required by Gmail API)
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    console.log('📤 Sending email via Gmail API...');

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    const gmailMessageId = result.data.id;
    const sentAt = new Date().toISOString();

    console.log('✅ Email sent successfully, Gmail message ID:', gmailMessageId);

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
        status: 'sent',
        sentAt,
        source: 'quick_engage'
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
