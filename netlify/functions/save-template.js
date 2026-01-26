/**
 * HUNTER PHASE 2: Save Template
 *
 * Saves a new message template to Firestore
 *
 * Security: Verifies Firebase auth token
 * Input: { name, subject, body, intent }
 * Returns: { templateId }
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
    const { idToken, template } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Validate template data
    if (!template.name || !template.subject || !template.body || !template.intent) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required template fields' })
      };
    }

    // Create template document
    const templateData = {
      name: template.name,
      subject: template.subject,
      body: template.body,
      intent: template.intent,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const templateRef = await db
      .collection('users')
      .doc(userId)
      .collection('templates')
      .add(templateData);

    return {
      statusCode: 200,
      body: JSON.stringify({ templateId: templateRef.id })
    };

  } catch (error) {
    console.error('❌ Save template error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
