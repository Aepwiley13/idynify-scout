/**
 * Generate Text Messages (SMS)
 *
 * Generates AI-powered SMS messages for outreach
 * Optimized for SMS constraints (160 chars = 1 SMS, 306 = 2 SMS)
 *
 * Input: contactIds, engagementIntent, textType (intro/followup)
 * Output: Array of SMS messages with contact info
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
    const { userId, authToken, contactIds, engagementIntent, textType } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(authToken);
    if (decodedToken.uid !== userId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    console.log(`🎯 Generating ${contactIds.length} text messages (${engagementIntent} intent)`);

    // Fetch contacts
    const messages = [];

    for (const contactId of contactIds) {
      const contactDoc = await db.collection(`users/${userId}/contacts`).doc(contactId).get();

      if (!contactDoc.exists) {
        console.warn(`⚠️ Contact ${contactId} not found`);
        continue;
      }

      const contactData = contactDoc.data();

      if (!contactData.phone) {
        console.warn(`⚠️ Contact ${contactId} has no phone number`);
        continue;
      }

      // Tone mapping based on engagement intent
      const toneMap = {
        cold: 'professional but friendly, brief and respectful',
        warm: 'familiar and friendly, reference shared context',
        hot: 'direct and conversational, assume rapport',
        followup: 'persistent but respectful, add new value'
      };

      const selectedTone = toneMap[engagementIntent] || toneMap.cold;

      // Build prompt for AI
      const prompt = `You are a B2B SMS copywriter. Generate a ${textType === 'intro' ? 'first outreach' : 'follow-up'} text message.

CONTACT INFO:
- Name: ${contactData.firstName} ${contactData.lastName}
- Title: ${contactData.title || 'Unknown'}
- Company: ${contactData.company_name || 'Unknown'}

REQUIREMENTS:
- Engagement Intent: ${engagementIntent}
- Tone: ${selectedTone}
- Keep it under 160 characters (1 SMS) if possible, max 306 characters (2 SMS)
- Be direct and actionable
- Include a clear call-to-action
- Use their first name: ${contactData.firstName}
- ${textType === 'intro' ? 'Introduce yourself briefly and provide value' : 'Reference previous outreach and add new value'}
- NO emojis or special characters
- NO links (they break SMS formatting)
- DO NOT write "Hi [Name]" - use actual name

Generate ONLY the text message body (no subject, no explanations):`;

      const message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const generatedBody = message.content[0].text.trim();

      messages.push({
        contactId: contactData.id || contactId,
        contactName: `${contactData.firstName} ${contactData.lastName}`,
        contactPhone: contactData.phone,
        companyName: contactData.company_name || '',
        title: contactData.title || '',
        body: generatedBody
      });

      console.log(`✅ Generated message for ${contactData.firstName} (${generatedBody.length} chars)`);
    }

    console.log(`✅ Generated ${messages.length} text messages`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        messages,
        reconUsed: false // SMS doesn't use RECON (too short)
      })
    };

  } catch (error) {
    console.error('❌ Generate text messages error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
