/**
 * HUNTER PHASE 2: Send Follow-Up
 *
 * Sends manual follow-up email via Gmail
 * Creates new campaign with "followup" intent for tracking
 *
 * Security: Verifies Firebase auth token
 * Returns: { campaignId, gmailMessageId }
 */

const admin = require('firebase-admin');
const { google } = require('googleapis');

// Initialize Firebase Admin (if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { idToken, contactId, originalCampaignId, subject, body, toEmail, toName } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Fetch user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || !userDoc.data().gmailAccessToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Gmail not connected' }) };
    }

    const { gmailAccessToken, gmailRefreshToken } = userDoc.data();

    // Set up Gmail OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: gmailAccessToken,
      refresh_token: gmailRefreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email
    const emailLines = [
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ];

    const email = emailLines.join('\r\n');
    const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Send email via Gmail
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    const gmailMessageId = res.data.id;
    const sentAt = new Date();

    // Create new follow-up campaign for tracking
    const campaignData = {
      name: `Follow-up: ${toName}`,
      weapon: 'email',
      engagementIntent: 'followup',
      parentCampaignId: originalCampaignId,
      contacts: [{
        contactId,
        name: toName,
        email: toEmail,
        subject,
        body,
        status: 'sent',
        sentAt,
        gmailMessageId,
        outcome: null,
        outcomeMarkedAt: null,
        outcomeLocked: false,
        outcomeLockedAt: null
      }],
      createdAt: sentAt,
      userId
    };

    const campaignRef = await db.collection('users').doc(userId).collection('campaigns').add(campaignData);

    return {
      statusCode: 200,
      body: JSON.stringify({
        campaignId: campaignRef.id,
        gmailMessageId,
        sentAt: sentAt.toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Send follow-up error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
