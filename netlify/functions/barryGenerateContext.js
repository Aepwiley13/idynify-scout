import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contact, companyData } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry generating context for:', contact.name);

    // Validate environment variables
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      console.error('❌ ANTHROPIC_API_KEY not configured');
      throw new Error('Claude API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token
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

    console.log('✅ Auth token verified');

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: claudeApiKey
    });

    // Prepare contact data for Barry
    const contactSummary = {
      name: contact.name || 'Unknown',
      title: contact.title || 'Not specified',
      company: contact.company_name || 'Unknown company',
      industry: contact.company_industry || companyData?.industry || 'Not specified',
      seniority: contact.seniority || 'Not specified',
      department: contact.department || (contact.departments && contact.departments[0]) || 'Not specified',
      location: [contact.city, contact.state, contact.country].filter(Boolean).join(', ') || 'Not specified',
      linkedin: contact.linkedin_url ? 'Available' : 'Not available',
      tenure: contact.job_start_date || 'Unknown'
    };

    // Prepare company context (if available)
    const companyContext = companyData ? {
      name: companyData.name || contact.company_name,
      industry: companyData.industry || contact.company_industry,
      size: companyData.size || 'Unknown',
      description: companyData.description || 'Not available',
      website: companyData.website || 'Not available'
    } : null;

    // Build the prompt for Barry
    const prompt = `You are Barry, a contextual intelligence guide helping a user prepare for a first conversation with another person.

Your role is NOT sales enablement. Your role is human orientation through calm, grounded context.

CONTACT INFORMATION:
Name: ${contactSummary.name}
Title: ${contactSummary.title}
Company: ${contactSummary.company}
Industry: ${contactSummary.industry}
Seniority: ${contactSummary.seniority}
Department: ${contactSummary.department}
Location: ${contactSummary.location}
LinkedIn: ${contactSummary.linkedin}

${companyContext ? `COMPANY CONTEXT:
Company: ${companyContext.name}
Industry: ${companyContext.industry}
Size: ${companyContext.size}
Description: ${companyContext.description}
Website: ${companyContext.website}
` : ''}

YOUR TASK:
Generate a contextual orientation layer to help the user feel calm, oriented, and confident before meeting this person.

CRITICAL GUARDRAILS (YOU MUST FOLLOW THESE):
- NEVER assume pain, urgency, or buying intent
- NEVER use sales language (pipeline, ROI, close, objection, etc.)
- NEVER reference the user's product or offering
- NEVER score, rank, or qualify this person
- NEVER overclaim certainty
- Use probabilistic language: "Often responsible for...", "Usually focused on...", "Commonly evaluated on..."
- When unsure, say less, not more
- Base company insights ONLY on observable public signals

REQUIRED OUTPUT FORMAT (JSON):
{
  "whoYoureMeeting": "One calm, factual sentence: '[Name] is [role] at [company], operating in [industry/context].' No interpretation. No hype.",

  "whatRoleCaresAbout": [
    "Bullet using probabilistic language (Often responsible for...)",
    "Bullet using probabilistic language (Usually focused on...)",
    "Bullet using probabilistic language (Commonly evaluated on...)"
  ],

  "whatCompanyFocusedOn": [
    "Based on public signals: [observable fact about company focus]",
    "Based on public signals: [observable fact about company direction]"
  ],

  "conversationStarters": [
    "Curiosity-based opening (no pitch, no product mention)",
    "Curiosity-based opening (no CTA)",
    "Curiosity-based opening (genuine curiosity only)"
  ],

  "calmReframe": "One grounding sentence to reduce pressure. Example tone: 'You don't need to impress here — curiosity is enough.'"
}

TONE REQUIREMENTS:
- Quiet, not loud
- Orienting, not instructing
- Calm, not clever
- Reducing anxiety, not adding pressure

Generate the contextual layer now. Respond ONLY with valid JSON.`;

    // Call Claude API using SDK
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = claudeResponse.content[0].text;

    console.log('🐻 Barry context generated');

    // Parse Claude's response
    let barryContext;
    try {
      // Extract JSON from response (in case Claude added any extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        barryContext = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate structure
      if (!barryContext.whoYoureMeeting ||
          !barryContext.whatRoleCaresAbout ||
          !barryContext.whatCompanyFocusedOn ||
          !barryContext.conversationStarters ||
          !barryContext.calmReframe) {
        throw new Error('Invalid context structure');
      }

    } catch (parseError) {
      console.error('Error parsing Barry response:', parseError);
      throw new Error('Failed to generate valid context');
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryGenerateContext', 'success', {
      responseTime,
      metadata: {
        contactName: contact.name,
        hasCompanyData: !!companyData
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        barryContext: {
          ...barryContext,
          generatedAt: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in barryGenerateContext:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryGenerateContext', 'error', {
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
