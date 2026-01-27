/**
 * Check Twilio Setup
 *
 * Checks if user has Twilio credentials configured
 * For now, returns false - requires admin setup
 *
 * Future: Store Twilio credentials per user in Firestore
 */

const admin = require('firebase-admin');

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
    const { idToken } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Check if user has Twilio integration configured
    const twilioDoc = await db.collection('users').doc(userId).collection('integrations').doc('twilio').get();

    const isSetup = twilioDoc.exists && twilioDoc.data().status === 'connected';

    return {
      statusCode: 200,
      body: JSON.stringify({
        isSetup,
        message: isSetup ? 'Twilio is configured' : 'Twilio setup required'
      })
    };

  } catch (error) {
    console.error('❌ Check Twilio setup error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
