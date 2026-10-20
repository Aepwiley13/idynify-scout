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
const { MODEL_BARRY_SONNET, barrySonnetOptions } = require('./utils/models.js');
const { readClaudeText, claudeErrorCode } = require('./utils/claudeResponse.js');

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

    // Fetch original campaign for context (skip if no campaign ID — e.g. follow-ups from FollowUpCard)
    let campaignData = {};
    if (originalCampaignId && originalCampaignId !== 'null') {
      const campaignDoc = await db.collection('users').doc(userId).collection('campaigns').doc(originalCampaignId).get();
      campaignData = campaignDoc.exists ? campaignDoc.data() : {};
    }

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
  // The reply's text is not sent to this endpoint, so the prompt must not
  // claim it is available: asked to reference it, the model writes notes and
  // placeholders into the draft instead (#699 comparison).
  : '- They replied to the original message. Their reply is not included here, so you do not know what it said\n- Thank them for replying and continue the conversation\n- Do not quote, summarize, or guess at what they said\n- Move toward next step'
}

REQUIREMENTS:
- Write ONLY the email body (no subject line)
- Keep it concise (3-5 short paragraphs max)
- Match professional tone
- Include clear call-to-action
- Do not use excessive formatting or emojis
- Use their first name: ${contactData.firstName}
- Output only the email itself: no notes, explanations, disclaimers, alternative versions, or any text before or after it
- No placeholders or bracketed text to fill in, such as [Your Name] or [detail]; end with a short sign-off such as "Best," and no name

Generate the follow-up email body:`;

    const message = await anthropic.messages.create({
      model: MODEL_BARRY_SONNET,
      max_tokens: 1000,
      ...barrySonnetOptions('followup'),
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const followUpBody = readClaudeText(message);

    return {
      statusCode: 200,
      body: JSON.stringify({ followUpBody })
    };

  } catch (error) {
    console.error('❌ Generate follow-up error:', claudeErrorCode(error), error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
