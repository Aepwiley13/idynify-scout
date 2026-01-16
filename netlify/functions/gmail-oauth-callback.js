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
  // Only allow GET (OAuth callback)
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    // Extract OAuth code and state (userId) from query params
    const params = event.queryStringParameters || {};
    const code = params.code;
    const userId = params.state;

    if (!code || !userId) {
      console.error('❌ Missing code or state in OAuth callback');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <!DOCTYPE html>
          <html>
            <head><title>Gmail Connection Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Connection Failed</h1>
              <p>Missing authorization code or user ID.</p>
              <a href="/hunter">Return to Hunter</a>
            </body>
          </html>
        `
      };
    }

    console.log('🔐 Processing Gmail OAuth callback for user:', userId);

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

    // Exchange code for tokens
    console.log('🔄 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to get access or refresh token');
    }

    console.log('✅ Tokens received');

    // Set credentials to get user profile
    oauth2Client.setCredentials(tokens);

    // Get Gmail user profile
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;

    console.log('✅ Gmail profile retrieved:', email);

    // Store tokens in Firestore
    await db
      .collection('users')
      .doc(userId)
      .collection('integrations')
      .doc('gmail')
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date || (Date.now() + 3600000), // 1 hour default
        email: email,
        connectedAt: new Date().toISOString(),
        status: 'connected',
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
        updatedAt: new Date().toISOString()
      });

    console.log('✅ Gmail tokens stored for user:', userId);

    // Redirect to Hunter dashboard with success message
    return {
      statusCode: 302,
      headers: {
        'Location': '/hunter?connected=true'
      },
      body: ''
    };

  } catch (error) {
    console.error('❌ Error in Gmail OAuth callback:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <!DOCTYPE html>
        <html>
          <head><title>Gmail Connection Failed</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Connection Failed</h1>
            <p>${error.message}</p>
            <a href="/hunter">Return to Hunter</a>
          </body>
        </html>
      `
    };
  }
};
