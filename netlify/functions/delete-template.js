/**
 * HUNTER PHASE 2: Delete Template
 *
 * Deletes a message template from Firestore
 *
 * Security: Verifies Firebase auth token and ensures user owns template
 * Input: { templateId }
 * Returns: { success: true }
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
    const { idToken, templateId } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Delete template (security: only user's own templates accessible via path)
    await db
      .collection('users')
      .doc(userId)
      .collection('templates')
      .doc(templateId)
      .delete();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('❌ Delete template error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
