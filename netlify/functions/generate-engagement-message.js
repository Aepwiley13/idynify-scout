import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logApiUsage } from './utils/logApiUsage.js';
import { createMessageWithRetry } from './utils/anthropicRetry.js';
import { assembleBarryContext } from './utils/barryContextAssembler.js';
import { checkRelationshipGuardrail, getGuardrailPromptModifier } from './utils/barryGuardrail.js';
import { recommendStrategy } from './utils/barryStrategyRecommender.js';

/**
 * GENERATE ENGAGEMENT MESSAGE - Barry AI Intelligence Engine
 *
 * This is the CORE of Hunter. It takes:
 * - User's free-form intent (what they want to do)
 * - Contact data (enriched from Apollo)
 * - Company data (if available)
 * - RECON data (Sections 5 & 9 - pain points, messaging preferences)
 * - Existing barryContext
 *
 * And generates 4 distinct, personalized message strategies:
 * - Direct & Short
 * - Warm & Personal
 * - Value-Led
 * - Humor-Driven
 *
 * Each with subject line, body, and reasoning.
 */

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

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const {
      userId,
      authToken,
      contactId,
      userIntent,        // FREE-FORM: What the user wants to do (REQUIRED)
      engagementIntent,  // Prospect / Warm / Customer / Partner
      contact,           // Basic contact info passed from frontend
      barryContext,      // Existing Barry context (if available)
      guardrailAction    // User's response to a guardrail warning (Sprint 2 wiring)
    } = JSON.parse(event.body);

    // Validate required fields
    if (!userId || !authToken) {
      throw new Error('Missing authentication');
    }

    if (!userIntent || userIntent.trim().length === 0) {
      throw new Error('User intent is required - tell Barry what you want to do');
    }

    if (!contactId && !contact) {
      throw new Error('Contact information is required');
    }

    console.log('🎯 Barry generating engagement messages');
    console.log('📝 User intent:', userIntent);
    console.log('🤝 Engagement context:', engagementIntent || 'prospect');

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

    console.log('✅ Auth verified');

    // === LOAD ALL INTELLIGENCE DATA ===

    // 1. Load full contact data from Firestore (if contactId provided)
    let fullContact = contact || {};
    if (contactId) {
      const contactDoc = await db.collection('users').doc(userId).collection('contacts').doc(contactId).get();
      if (contactDoc.exists) {
        fullContact = { id: contactDoc.id, ...contactDoc.data() };
        console.log('✅ Loaded contact:', fullContact.firstName, fullContact.lastName);
      }
    }

    // 2. Load RECON data (Sections 5 & 9)
    let section5 = null;
    let section9 = null;
    let reconLoaded = false;

    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();

      if (dashboardDoc.exists) {
        const dashboardData = dashboardDoc.data();
        const reconModule = dashboardData.modules?.find(m => m.id === 'recon');

        if (reconModule && reconModule.sections) {
          section5 = reconModule.sections.find(s => s.sectionId === 5);
          section9 = reconModule.sections.find(s => s.sectionId === 9);

          if (section5 || section9) {
            reconLoaded = true;
            console.log('✅ RECON data loaded');
          }
        }
      }
    } catch (reconError) {
      console.log('⚠️ No RECON data available');
    }

    // 3. Load user profile (company name, etc.)
    let userProfile = null;
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        userProfile = userDoc.data();
        console.log('✅ User profile loaded');
      }
    } catch (profileError) {
      console.log('⚠️ No user profile available');
    }

    // 4. Load Barry's memory context (Sprint 0 — gives Barry history awareness)
    let barryMemoryContext = '';
    let barryFullContext = null;
    try {
      if (contactId) {
        const { promptContext, context: fullCtx } = await assembleBarryContext(db, userId, contactId);
        barryMemoryContext = promptContext || '';
        barryFullContext = fullCtx;
        if (barryMemoryContext) {
          console.log('✅ Barry memory context loaded');
        }
      }
    } catch (memoryError) {
      console.log('⚠️ Barry memory unavailable:', memoryError.message);
    }

    // === PRE-GENERATION GUARDRAIL CHECK (Sprint 2) ===
    let barryWarning = null;
    try {
      barryWarning = checkRelationshipGuardrail(fullContact, engagementIntent, userIntent);
      if (barryWarning) {
        console.log(`⚠️ Barry guardrail triggered: ${barryWarning.type} (${barryWarning.severity})`);
      }
    } catch (guardrailError) {
      console.log('⚠️ Guardrail check failed (non-blocking):', guardrailError.message);
    }

    // === GUARDRAIL PROMPT MODIFIER (Sprint 2 wiring) ===
    // Apply modifier whenever the frontend passes a guardrailAction — even if the
    // guardrail didn't re-trigger on this call (the user already responded to it).
    let guardrailPromptModifier = '';
    if (guardrailAction) {
      const guardrailType = barryWarning?.type || 'tone_mismatch';
      guardrailPromptModifier = getGuardrailPromptModifier(guardrailAction, guardrailType, fullContact);
      if (guardrailPromptModifier) {
        console.log(`✅ Guardrail modifier applied: ${guardrailAction}`);
      }
      // Suppress the warning from the response — user already acted on it
      barryWarning = null;
    }

    // === STRATEGY RECOMMENDATION (Sprint 4) ===
    let strategyRecommendation = null;
    let strategyPromptGuidance = '';
    try {
      const recResult = recommendStrategy({
        contact: fullContact,
        engagementIntent: engagementIntent || 'prospect',
        strategyStats: barryFullContext?.strategy_stats || null,
        barryMemory: fullContact.barry_memory || null,
        recentAttributions: barryFullContext?.recent_attributions || []
      });
      strategyRecommendation = recResult.recommendation;
      strategyPromptGuidance = recResult.promptGuidance || '';
      if (strategyRecommendation?.strategy) {
        console.log(`✅ Barry recommends: ${strategyRecommendation.strategy} (${strategyRecommendation.confidence})`);
      }
    } catch (recError) {
      console.log('⚠️ Strategy recommendation failed (non-blocking):', recError.message);
    }

    // === BUILD CONTEXT FOR BARRY ===

    const firstName = fullContact.firstName || fullContact.name?.split(' ')[0] || 'there';
    const lastName = fullContact.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const title = fullContact.title || fullContact.current_position_title || '';
    const company = fullContact.company_name || fullContact.current_company_name || '';
    const industry = fullContact.company_industry || fullContact.industry || '';
    const seniority = fullContact.seniority || '';

    // Build RECON context string
    let reconContext = '';
    if (reconLoaded) {
      if (section5?.userInput) {
        const s5 = section5.userInput;
        reconContext += `
USER'S CUSTOMER INTELLIGENCE (from RECON):
- Primary customer pain point: ${s5.primaryPain || 'Not specified'}
- Cost of this pain: ${s5.painCost || 'Not specified'}
- What success looks like for customers: ${s5.successLooksLike || 'Not specified'}
- Why previous solutions failed: ${s5.whyFailed || 'Not specified'}
- What triggers urgency: ${s5.urgentTrigger || 'Not specified'}
`;
      }

      if (section9?.userInput) {
        const s9 = section9.userInput;
        reconContext += `
USER'S MESSAGING PREFERENCES:
- Email tone: ${s9.emailTone || 'Professional'}
- Email length: ${s9.emailLength || 'Short'}
- Key messages to emphasize: ${Array.isArray(s9.keyMessages) ? s9.keyMessages.join(', ') : 'Not specified'}
- Preferred CTAs: ${Array.isArray(s9.callsToAction) ? s9.callsToAction.join(', ') : 'Not specified'}
- Social proof emphasis: ${s9.socialProofEmphasis || 'Moderate'}
- Personalization level: ${s9.personalizationLevel || 'Highly personalized'}
`;
      }
    }

    // Build Barry context string (if available)
    let barryContextString = '';
    const existingBarryContext = barryContext || fullContact.barryContext;
    if (existingBarryContext) {
      barryContextString = `
BARRY'S EXISTING ANALYSIS OF THIS CONTACT:
- Who they are: ${existingBarryContext.whoYoureMeeting || 'N/A'}
- What their role cares about: ${Array.isArray(existingBarryContext.whatRoleCaresAbout) ? existingBarryContext.whatRoleCaresAbout.join('; ') : 'N/A'}
- What their company focuses on: ${Array.isArray(existingBarryContext.whatCompanyFocusedOn) ? existingBarryContext.whatCompanyFocusedOn.join('; ') : 'N/A'}
`;
    }

    // Structured context fields (Step 3)
    const structuredContext = {
      relationship_type: fullContact.relationship_type || null,
      warmth_level: fullContact.warmth_level || null,
      strategic_value: fullContact.strategic_value || null
    };

    // Map engagement intent to tone guidance
    const intentToneMap = {
      prospect: 'This is a NEW contact - be professional, establish credibility, spark curiosity without being pushy',
      warm: 'This is someone the user ALREADY KNOWS - be warm, reference shared context, conversational tone',
      customer: 'This is an EXISTING CUSTOMER - be helpful, service-oriented, assume rapport',
      partner: 'This is a BUSINESS PARTNER - be collaborative, peer-to-peer, mutual value focused'
    };
    const toneGuidance = intentToneMap[engagementIntent] || intentToneMap.prospect;

    // === CALL CLAUDE API ===

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const anthropic = new Anthropic({
      apiKey: anthropicApiKey
    });

    const prompt = `You are Barry, an expert B2B engagement assistant. Your job is to help the user reach out to a contact with highly personalized, context-aware messages.

THE USER'S GOAL (THIS IS THE PRIMARY DRIVER):
"${userIntent}"

CONTACT INFORMATION:
- Name: ${fullName}
- Title: ${title || 'Not specified'}
- Company: ${company || 'Not specified'}
- Industry: ${industry || 'Not specified'}
- Seniority: ${seniority || 'Not specified'}
- Email: ${fullContact.email || 'Not available'}
- Phone: ${fullContact.phone || fullContact.phone_mobile || 'Not available'}
- LinkedIn: ${fullContact.linkedin_url || 'Not available'}

RELATIONSHIP CONTEXT:
${toneGuidance}
${structuredContext.relationship_type || structuredContext.warmth_level || structuredContext.strategic_value ? `
STRATEGIC CLASSIFICATION (user-set):
${structuredContext.relationship_type ? `- Relationship Type: ${structuredContext.relationship_type}` : ''}
${structuredContext.warmth_level ? `- Warmth Level: ${structuredContext.warmth_level}` : ''}
${structuredContext.strategic_value ? `- Strategic Value: ${structuredContext.strategic_value}` : ''}

Calibrate messaging accordingly:
- Cold contacts: Zero familiarity, no assumptions about shared context
- Warm contacts: Can reference shared context, more conversational
- Hot contacts: Precision matters, be specific and relevant
- High-value contacts: Extra care on tone, subject lines, and personalization
- Delegate contacts: Orient around the decision-maker they represent
` : ''}
${barryContextString}
${reconContext}
${barryMemoryContext}
${strategyPromptGuidance}${guardrailPromptModifier ? `\n${guardrailPromptModifier}\n` : ''}
USER'S COMPANY (if available):
${userProfile?.companyName || userProfile?.company || 'Not specified'}

YOUR TASK:
Generate 4 DISTINCT message approaches that fulfill the user's goal. Each must be clearly different in strategy and tone.

CRITICAL REQUIREMENTS:
1. Messages must be SPECIFIC to this contact - reference their name, title, company, or industry
2. Messages must address the user's stated goal directly
3. Messages should feel human, not templated
4. Each approach should work for a different personality type
5. Include subject lines for email (max 50 characters)
6. Include brief reasoning explaining WHY this approach fits

OUTPUT FORMAT (respond ONLY with this JSON structure):
{
  "messages": [
    {
      "strategy": "direct",
      "label": "Direct & Short",
      "subject": "Subject line here (50 chars max)",
      "message": "The full message body here. Keep it concise but personalized.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation of the strategy."
    },
    {
      "strategy": "warm",
      "label": "Warm & Personal",
      "subject": "Subject line here",
      "message": "The full message body here. More relationship-focused.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation."
    },
    {
      "strategy": "value",
      "label": "Value-Led",
      "subject": "Subject line here",
      "message": "The full message body here. Lead with value/insight.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation."
    },
    {
      "strategy": "humor",
      "label": "Humor-Driven",
      "subject": "Subject line here",
      "message": "The full message body here. Use a witty, self-aware, or playful tone to stand out.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation."
    }
  ],
  "dataUsed": {
    "contact": true,
    "recon": ${reconLoaded},
    "barryContext": ${!!existingBarryContext}
  }
}

STYLE GUIDELINES:
- No buzzwords like "game-changer", "revolutionize", "synergy"
- No generic phrases like "I hope this email finds you well"
- Be conversational and genuine
- Match the relationship context (${engagementIntent || 'prospect'})
- Keep messages between 3-6 sentences unless user specified otherwise
- For the Humor-Driven option: be witty, self-aware, or playfully irreverent — NOT cheesy or forced. Think "clever subject line that earns the open" not "dad joke". The humor should serve the goal, not distract from it.

Generate the messages now. Respond ONLY with valid JSON.`;

    console.log('🤖 Calling Claude API...');

    const claudeResponse = await createMessageWithRetry(anthropic, {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = claudeResponse.content[0].text;
    console.log('✅ Claude response received');

    // Parse the JSON response
    let result;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate structure
      if (!result.messages || !Array.isArray(result.messages) || result.messages.length < 3) { // Accept 3+ (humor may be omitted by Claude)
        throw new Error('Invalid response structure');
      }
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', parseError);
      throw new Error('Failed to generate valid messages');
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'generate-engagement-message', 'success', {
      responseTime,
      metadata: {
        contactName: fullName,
        userIntent: userIntent.substring(0, 100),
        engagementIntent,
        reconUsed: reconLoaded,
        barryMemoryUsed: !!barryMemoryContext
      }
    });

    console.log(`✅ Generated ${result.messages.length} messages in ${responseTime}ms`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        messages: result.messages,
        barry_warning: barryWarning || null,
        barry_recommendation: strategyRecommendation || null,
        dataUsed: result.dataUsed || {
          contact: true,
          recon: reconLoaded,
          barryContext: !!existingBarryContext
        },
        contactSummary: {
          name: fullName,
          title,
          company,
          email: fullContact.email
        },
        generatedAt: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Error in generate-engagement-message:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'generate-engagement-message', 'error', {
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
