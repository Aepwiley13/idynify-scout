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
      privateKey: privateKey
    })
  });
}

const db = getFirestore();

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    const code = params.code;
    const userId = params.state;

    if (!code || !userId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html' },
        body: buildErrorPage('Missing authorization code or user ID.')
      };
    }

    console.log('🔐 Processing Calendar OAuth callback for user:', userId);

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const calendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('gmail-oauth-callback', 'calendar-oauth-callback');

    if (!googleClientId || !googleClientSecret || !calendarRedirectUri) {
      throw new Error('Google Calendar OAuth not configured');
    }

    const oauth2Client = new google.auth.OAuth2(
      googleClientId,
      googleClientSecret,
      calendarRedirectUri
    );

    console.log('🔄 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('Failed to get access token from Google');
    }

    if (!tokens.refresh_token) {
      throw new Error('Failed to get refresh token. Please revoke access and try again.');
    }

    console.log('✅ Calendar tokens received for user:', userId);

    oauth2Client.setCredentials(tokens);

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      throw new Error('Failed to retrieve email address from Google');
    }

    // Store tokens at users/{uid}/integrations/googleCalendar
    await db
      .collection('users')
      .doc(userId)
      .collection('integrations')
      .doc('googleCalendar')
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date || (Date.now() + 3600000),
        email: email,
        connectedAt: new Date().toISOString(),
        status: 'connected',
        scopes: [
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        updatedAt: new Date().toISOString()
      });

    console.log('✅ Calendar tokens stored for user:', userId, '— email:', email);

    return {
      statusCode: 302,
      headers: { 'Location': '/settings?tab=integrations&calendar_connected=true' },
      body: ''
    };

  } catch (error) {
    console.error('❌ Error in Calendar OAuth callback:', error);

    let userMessage = error.message;
    if (error.message?.includes('refresh_token')) {
      userMessage = 'Could not get refresh token. Please disconnect and reconnect Google Calendar.';
    } else if (error.code === 403) {
      userMessage = 'Permission denied. Please approve all requested Calendar permissions.';
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: buildErrorPage(userMessage)
    };
  }
};

function buildErrorPage(message) {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Google Calendar Connection Failed</title>
    <meta charset="utf-8">
  </head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;padding:50px;background:#f5f5f5;">
    <div style="background:white;padding:40px;border-radius:8px;max-width:500px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
      <h1 style="color:#e53e3e;margin-bottom:20px;">Calendar Connection Failed</h1>
      <p style="color:#4a5568;font-size:16px;line-height:1.6;">${message}</p>
      <div style="margin-top:30px;">
        <a href="/settings?tab=integrations" style="background:#3182ce;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Return to Settings</a>
      </div>
      <p style="margin-top:30px;font-size:12px;color:#a0aec0;">
        If this problem persists, try revoking Idynify Scout's access in your
        <a href="https://myaccount.google.com/permissions" target="_blank" style="color:#3182ce;">Google Account Settings</a>
        and reconnecting.
      </p>
    </div>
  </body>
</html>`;
}
