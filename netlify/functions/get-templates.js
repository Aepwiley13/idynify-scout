/**
 * HUNTER PHASE 2: Get Templates
 *
 * Retrieves user's saved message templates from Firestore
 *
 * Security: Verifies Firebase auth token
 * Returns: Array of templates sorted by creation date (newest first)
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
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { idToken } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Fetch user's templates
    const templatesSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('templates')
      .orderBy('createdAt', 'desc')
      .get();

    const templates = [];
    templatesSnapshot.forEach(doc => {
      templates.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ templates })
    };

  } catch (error) {
    console.error('❌ Get templates error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
