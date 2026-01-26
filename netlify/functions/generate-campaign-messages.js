import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
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
  const startTime = Date.now();

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contactIds, campaignName, engagementIntent } = JSON.parse(event.body);

    if (!userId || !authToken || !contactIds || !Array.isArray(contactIds)) {
      throw new Error('Missing required parameters');
    }

    console.log(`🎯 Generating messages for ${contactIds.length} contacts in campaign:`, campaignName);

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
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

    // Load contact data from Firestore
    console.log('📦 Loading contact data...');
    const contactsPromises = contactIds.map(contactId =>
      db.collection('users').doc(userId).collection('contacts').doc(contactId).get()
    );

    const contactDocs = await Promise.all(contactsPromises);
    const contacts = contactDocs
      .filter(doc => doc.exists)
      .map(doc => ({ id: doc.id, ...doc.data() }));

    if (contacts.length === 0) {
      throw new Error('No valid contacts found');
    }

    console.log(`✅ Loaded ${contacts.length} contacts`);

    // Load Recon data (if exists)
    console.log('🔍 Checking for RECON data...');
    let reconData = null;
    let section5 = null;
    let section9 = null;
    let reconUsed = false;
    let reconSectionsUsed = {}; // NEW: Track which sections are actually used

    // NEW: Tone mapping based on engagement intent (defaults to cold if not provided)
    const toneMap = {
      cold: 'professional, value-driven, establish credibility without being pushy',
      warm: 'friendly but professional, reference shared context or connections',
      hot: 'direct and conversational, assume rapport and get to the point',
      followup: 'persistent but respectful, add new value or perspective'
    };
    const selectedTone = toneMap[engagementIntent] || toneMap.cold; // DEFAULT: cold if missing

    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();

      if (dashboardDoc.exists) {
        const dashboardData = dashboardDoc.data();
        const reconModule = dashboardData.modules?.find(m => m.id === 'recon');

        if (reconModule && reconModule.sections) {
          section5 = reconModule.sections.find(s => s.sectionId === 5); // Pain points
          section9 = reconModule.sections.find(s => s.sectionId === 9); // Messaging

          if (section5 || section9) {
            reconUsed = true;
            // NEW: Track which sections are actually used
            if (section5) reconSectionsUsed.section5 = true;
            if (section9) reconSectionsUsed.section9 = true;
            console.log('✅ RECON data found and will be used');
          }
        }
      }
    } catch (reconError) {
      console.log('⚠️  No RECON data available (skipping)');
    }

    // Initialize Claude AI
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const anthropic = new Anthropic({
      apiKey: anthropicApiKey
    });

    // Generate messages for each contact
    console.log('✨ Generating personalized messages...');

    const messages = await Promise.all(contacts.map(async (contact) => {
      try {
        // Build RECON context
        let reconContext = '';
        if (reconUsed) {
          reconContext = '\n\nRECON INTELLIGENCE:\n';

          if (section5) {
            const painInput = section5.userInput || {};
            reconContext += `Pain Points:
- Primary Pain: ${painInput.primaryPain || 'N/A'}
- Cost of Pain: ${painInput.painCost || 'N/A'}
- What Success Looks Like: ${painInput.successLooksLike || 'N/A'}\n`;
          }

          if (section9) {
            const msgInput = section9.userInput || {};
            reconContext += `\nMessaging Preferences:
- Tone: ${msgInput.emailTone || 'Professional but friendly'}
- Length: ${msgInput.emailLength || 'Short (4-5 sentences)'}
- Key Messages: ${Array.isArray(msgInput.keyMessages) ? msgInput.keyMessages.join(', ') : 'Time savings, Revenue impact'}
- CTA: ${Array.isArray(msgInput.callsToAction) ? msgInput.callsToAction[0] : 'Book a demo'}\n`;
          }
        }

        // Build email generation prompt
        const prompt = `You are a B2B sales email writer. Generate a personalized ${engagementIntent || 'cold'} outreach email.

CONTACT:
- Name: ${contact.name}
- Title: ${contact.title || 'Professional'}
- Company: ${contact.company_name || 'their company'}
${reconContext}
REQUIREMENTS:
- Engagement Intent: ${engagementIntent || 'cold'}
- Tone: ${selectedTone}
- Length: ${section9?.userInput?.emailLength || 'Short (4-5 sentences)'}
- CTA: ${section9?.userInput?.callsToAction?.[0] || 'Book a quick call'}
- Subject line: Make it relevant and non-salesy (max 50 characters)
- Body: Address specific pain points if available, provide quick value prop, clear CTA
- Do NOT use buzzwords like "game-changer", "revolutionize", or "cutting-edge"
- Be conversational and genuine
- Match the ${engagementIntent || 'cold'} intent appropriately

Generate:
1. Subject line (50 chars max)
2. Email body (plain text, no HTML, ${section9?.userInput?.emailLength?.includes('short') ? '4-5 sentences' : '6-8 sentences'})

Format your response EXACTLY like this:
SUBJECT: [subject line here]
BODY:
[email body here]`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].text;
        const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
        const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

        const subject = subjectMatch?.[1]?.trim() || 'Quick question';
        const body = bodyMatch?.[1]?.trim() || text;

        console.log(`✅ Generated message for ${contact.name}`);

        return {
          contactId: contact.id,
          contactName: contact.name,
          contactEmail: contact.email,
          subject: subject,
          body: body,
          status: 'draft',
          sentAt: null,
          gmailMessageId: null
        };

      } catch (contactError) {
        console.error(`❌ Failed to generate message for ${contact.name}:`, contactError);

        // Return fallback message
        return {
          contactId: contact.id,
          contactName: contact.name,
          contactEmail: contact.email,
          subject: 'Quick question',
          body: `Hi ${contact.name.split(' ')[0]},\n\nI wanted to reach out briefly.\n\nWould you be open to a quick conversation?\n\nBest regards`,
          status: 'draft',
          sentAt: null,
          gmailMessageId: null
        };
      }
    }));

    const duration = Date.now() - startTime;
    console.log(`✅ Generated ${messages.length} messages in ${duration}ms`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        messages,
        reconUsed,
        reconSectionsUsed // NEW: Return exactly which sections were used
      })
    };

  } catch (error) {
    console.error('❌ Error generating campaign messages:', error);
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
