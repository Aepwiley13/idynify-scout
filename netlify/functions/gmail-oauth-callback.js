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

    if (!tokens.access_token) {
      console.error('❌ Missing access_token in OAuth response');
      throw new Error('Failed to get access token from Google');
    }

    if (!tokens.refresh_token) {
      console.error('❌ Missing refresh_token - user may have already authorized');
      throw new Error('Failed to get refresh token. Please revoke access and try again.');
    }

    console.log('✅ Tokens received successfully');
    console.log('📅 Token expires at:', new Date(tokens.expiry_date).toISOString());

    // Set credentials to get user info
    oauth2Client.setCredentials(tokens);

    // Get user email via OAuth2 API (not Gmail API - avoids needing Gmail read scope)
    console.log('🔄 Fetching user email via OAuth2 API...');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      console.error('❌ No email returned from OAuth2 userinfo');
      throw new Error('Failed to retrieve email address from Google');
    }

    console.log('✅ User email retrieved:', email);

    // Store tokens in Firestore (Hunter-owned path: users/{uid}/integrations/gmail)
    console.log('💾 Storing tokens in Firestore...');
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
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        updatedAt: new Date().toISOString()
      });

    console.log('✅ Gmail tokens stored successfully for user:', userId);
    console.log('📧 Connected email:', email);

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
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      name: error.name
    });

    // Provide user-friendly error messages without exposing sensitive data
    let userMessage = error.message;

    if (error.message?.includes('refresh_token')) {
      userMessage = 'Could not get refresh token. Please disconnect and reconnect Gmail.';
    } else if (error.message?.includes('access_token')) {
      userMessage = 'Could not get access token from Google. Please try again.';
    } else if (error.message?.includes('email')) {
      userMessage = 'Could not retrieve your email address. Please check your Google account permissions.';
    } else if (error.code === 403 || error.message?.includes('403')) {
      userMessage = 'Permission denied. Please make sure you approved all requested permissions.';
    } else if (error.code === 401 || error.message?.includes('401')) {
      userMessage = 'Authentication failed. Please try connecting Gmail again.';
    } else if (error.message?.includes('Firebase') || error.message?.includes('Firestore')) {
      userMessage = 'Database error. Please contact support.';
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Gmail Connection Failed</title>
            <meta charset="utf-8">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
            <div style="background: white; padding: 40px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #e53e3e; margin-bottom: 20px;">❌ Connection Failed</h1>
              <p style="color: #4a5568; font-size: 16px; line-height: 1.6;">${userMessage}</p>
              <div style="margin-top: 30px;">
                <a href="/hunter" style="background: #3182ce; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">Return to Hunter</a>
              </div>
              <p style="margin-top: 30px; font-size: 12px; color: #a0aec0;">
                If this problem persists, try revoking Idynify Scout's access in your
                <a href="https://myaccount.google.com/permissions" target="_blank" style="color: #3182ce;">Google Account Settings</a>
                and reconnecting.
              </p>
            </div>
          </body>
        </html>
      `
    };
  }
};
