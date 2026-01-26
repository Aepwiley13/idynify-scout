/**
 * HUNTER PHASE 2: Generate Follow-Up
 *
 * Generates AI-suggested follow-up message based on:
 * - Original message
 * - Outcome (replied/no_response)
 * - Contact context from RECON + Barry
 *
 * Security: Verifies Firebase auth token
 * Returns: { followUpBody }
 */

const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

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
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { idToken, contactId, originalCampaignId, outcome, originalMessage } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Fetch contact
    const contactDoc = await db.collection('users').doc(userId).collection('contacts').doc(contactId).get();
    if (!contactDoc.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Contact not found' }) };
    }
    const contactData = contactDoc.data();

    // Fetch original campaign for context
    const campaignDoc = await db.collection('users').doc(userId).collection('campaigns').doc(originalCampaignId).get();
    const campaignData = campaignDoc.exists ? campaignDoc.data() : {};

    // Build prompt for follow-up generation
    const prompt = `You are a B2B sales follow-up email writer. Generate a follow-up email body based on the context below.

CONTACT INFO:
- Name: ${contactData.firstName} ${contactData.lastName}
- Company: ${contactData.company || 'Unknown'}
- Title: ${contactData.title || 'Unknown'}

ORIGINAL ENGAGEMENT:
- Intent: ${campaignData.engagementIntent || 'cold'}
- Outcome: ${outcome}
- Original Message:
${originalMessage}

FOLLOW-UP GUIDANCE:
${outcome === 'no_response'
  ? '- They did not respond to the original message\n- Add new value or different angle\n- Keep it brief and respectful\n- Give them an easy way to respond'
  : '- They replied (check their email for context)\n- This is to continue the conversation\n- Reference their response\n- Move toward next step'
}

REQUIREMENTS:
- Write ONLY the email body (no subject line)
- Keep it concise (3-5 short paragraphs max)
- Match professional tone
- Include clear call-to-action
- Do not use excessive formatting or emojis
- Use their first name: ${contactData.firstName}

Generate the follow-up email body:`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const followUpBody = message.content[0].text;

    return {
      statusCode: 200,
      body: JSON.stringify({ followUpBody })
    };

  } catch (error) {
    console.error('❌ Generate follow-up error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
