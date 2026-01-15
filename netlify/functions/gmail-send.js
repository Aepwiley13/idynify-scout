import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, campaignId, messageIndex, subject, body, toEmail, toName } = JSON.parse(event.body);

    if (!userId || !authToken || !campaignId || messageIndex === undefined || !subject || !body || !toEmail || !toName) {
      throw new Error('Missing required parameters');
    }

    console.log(`📧 Sending email to ${toName} (${toEmail}) from user ${userId}`);

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
    const tokenUserId = verifyData.users[0].localId;

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
      throw new Error('Gmail not connected. Please connect Gmail first.');
    }

    const gmailData = gmailDoc.data();

    if (gmailData.status !== 'connected') {
      throw new Error('Gmail connection expired. Please reconnect.');
    }

    let accessToken = gmailData.accessToken;
    let refreshToken = gmailData.refreshToken;
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
    if (Date.now() >= expiresAt - 60000) { // Refresh if expires in less than 1 minute
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
        throw new Error('Gmail connection expired. Please reconnect Gmail.');
      }
    }

    // Create email in RFC 2822 format
    const email = [
      `To: ${toName} <${toEmail}>`,
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

    console.log('✅ Email sent successfully, Gmail message ID:', gmailMessageId);

    // Update campaign in Firestore
    const campaignRef = db
      .collection('users')
      .doc(userId)
      .collection('campaigns')
      .doc(campaignId);

    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) {
      throw new Error('Campaign not found');
    }

    const campaignData = campaignDoc.data();
    const messages = campaignData.messages || [];

    if (messageIndex < 0 || messageIndex >= messages.length) {
      throw new Error('Invalid message index');
    }

    // Update message status
    messages[messageIndex] = {
      ...messages[messageIndex],
      status: 'sent',
      sentAt: new Date().toISOString(),
      gmailMessageId: gmailMessageId
    };

    // Check if all messages are sent
    const allSent = messages.every(m => m.status === 'sent');
    const campaignStatus = allSent ? 'completed' : 'in_progress';

    await campaignRef.update({
      messages: messages,
      status: campaignStatus,
      updatedAt: new Date().toISOString(),
      ...(allSent ? { completedAt: new Date().toISOString() } : {})
    });

    console.log('✅ Campaign updated in Firestore');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        gmailMessageId: gmailMessageId,
        sentAt: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Error sending email:', error);

    // Check for Gmail quota errors
    let errorMessage = error.message;

    if (error.message?.includes('quota') || error.message?.includes('limit')) {
      errorMessage = 'Gmail daily sending limit reached. Please try again tomorrow.';
    } else if (error.message?.includes('token') || error.message?.includes('auth')) {
      errorMessage = 'Gmail connection expired. Please reconnect Gmail.';
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: errorMessage })
    };
  }
};
