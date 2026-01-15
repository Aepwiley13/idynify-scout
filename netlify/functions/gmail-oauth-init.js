import { google } from 'googleapis';

export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken } = JSON.parse(event.body);

    if (!userId || !authToken) {
      throw new Error('Missing required parameters');
    }

    console.log('🔐 Initializing Gmail OAuth for user:', userId);

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
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

    console.log('✅ Auth token verified for user:', userId);

    // Validate Google OAuth environment variables
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      console.error('❌ Google OAuth credentials not configured');
      throw new Error('Google OAuth not configured. Please contact support.');
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      googleClientId,
      googleClientSecret,
      googleRedirectUri
    );

    // Generate authorization URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Get refresh token
      scope: ['https://www.googleapis.com/auth/gmail.send'],
      state: userId, // Pass userId in state for callback
      prompt: 'consent' // Force consent screen to get refresh token
    });

    console.log('✅ OAuth URL generated for user:', userId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ authUrl })
    };

  } catch (error) {
    console.error('❌ Error initializing Gmail OAuth:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
