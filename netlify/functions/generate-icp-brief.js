import Anthropic from '@anthropic-ai/sdk';

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
    const { sectionData, userId, authToken } = JSON.parse(event.body);

    if (!sectionData) {
      throw new Error('Section data is required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!authToken) {
      throw new Error('Authentication token is required');
    }

    console.log('🎯 Generating ICP Brief for user:', userId);

    // Verify Firebase Auth token using REST API
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error('Firebase project ID not configured');
    }

    console.log('🔐 Verifying auth token...');
    const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error('Firebase API key not configured');
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json().catch(() => ({}));
      console.error('❌ Firebase auth verification failed:', {
        status: verifyResponse.status,
        statusText: verifyResponse.statusText,
        error: errorData
      });
      throw new Error(`Invalid authentication token: ${errorData.error?.message || verifyResponse.statusText}`);
    }

    const verifyData = await verifyResponse.json();

    if (!verifyData.users || verifyData.users.length === 0) {
      console.error('❌ No user found in token verification response');
      throw new Error('Authentication token verification failed: no user found');
    }

    const tokenUserId = verifyData.users[0].localId;

    // Verify the token belongs to the claimed user
    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth token verified for user:', userId);

    // Extract only the essential data (rawAnswers) to reduce prompt size
    const essentialData = {};
    for (const [key, value] of Object.entries(sectionData)) {
      if (value && typeof value === 'object') {
        essentialData[key] = value.rawAnswers || value.data || value;
      }
    }

    console.log('📊 Essential data extracted, size:', JSON.stringify(essentialData).length, 'chars');

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `Generate a concise ICP Brief from the RECON data below. Be specific and actionable.

DATA:
${JSON.stringify(essentialData, null, 2)}

Return EXACT JSON schema:
{
  "title": "Comprehensive ICP Brief",
  "generatedAt": "${new Date().toISOString()}",
  "version": 1,
  "executiveSummary": {
    "overview": "string (3-4 sentence synthesis of WHO the ideal customer is across all dimensions)",
    "criticalInsight": "string (THE most important insight that emerged from analyzing all sections together)",
    "confidenceScore": "number (1-10 rating of how clear and specific the ICP is based on the data)"
  },
  "icpProfile": {
    "companyAttributes": {
      "industries": ["string (2-5 primary industries)"],
      "companySize": "string (specific range: employees, revenue)",
      "stage": "string (funding stage, growth stage)",
      "geography": "string (if specified)",
      "techStack": ["string (key technologies they use - observable signals)"]
    },
    "buyerPersonas": [
      {
        "title": "string (e.g., 'VP of Marketing')",
        "seniority": "string (IC, Manager, Director, VP, C-level)",
        "role": "string (describe their function)",
        "painPoints": ["string (3-5 specific pains from Section 5)"],
        "motivations": ["string (2-3 key motivations)"],
        "decisionPower": "string (Economic Buyer, Technical Buyer, Champion, Influencer)"
      }
    ],
    "perfectFitCriteria": [
      "string (10-15 OBSERVABLE signals across firmographics, psychographics, behavior)",
      "string (Include hiring signals, funding, tech stack, company events)",
      "string (Be hyper-specific with numbers and observable data)"
    ],
    "antiProfile": [
      "string (5-10 red flags and companies to avoid)",
      "string (Include churn risks and poor-fit indicators)"
    ]
  },
  "buyingIntelligence": {
    "buyingTriggers": ["string (3-5 events that trigger buying - from Section 10)"],
    "buyingWindow": "string (typical time from awareness to purchase)",
    "decisionMakers": ["string (roles involved in buying decision - from Section 7)"],
    "decisionCriteria": ["string (what they evaluate - from Section 7)"],
    "competitiveAlternatives": ["string (3-5 competitors - from Section 8)"],
    "yourDifferentiation": ["string (2-3 key differentiators - from Sections 2 & 8)"]
  },
  "engagementStrategy": {
    "timingSignals": ["string (3-5 signals they're ready to buy NOW - from Section 10)"],
    "engagementChannels": ["string (where/how they prefer to engage - from Section 6)"],
    "contentPreferences": ["string (what content they consume - from Section 10)"],
    "messagingThemes": ["string (3-5 key messaging themes - from Section 9)"],
    "valueProposition": "string (your core value prop in their language - from Section 9)"
  },
  "targetingPlaybook": {
    "prospectingStrategy": "string (2-3 paragraphs: HOW to find and identify ideal customers)",
    "qualificationCriteria": [
      "MUST-HAVE: string",
      "MUST-HAVE: string",
      "NICE-TO-HAVE: string",
      "DISQUALIFIER: string"
    ],
    "outreachRecommendations": "string (2-3 paragraphs: HOW to approach them based on psychographics/behavior)",
    "expectedConversion": {
      "salesCycleLength": "string (from Section 10)",
      "keyMilestones": ["string (stages in buying process - from Section 7)"]
    }
  },
  "actionableNextSteps": [
    "string (5-10 specific actions to take immediately)",
    "string (Build target account lists, create messaging, etc.)",
    "string (Be tactical and specific)"
  ],
  "metadata": {
    "sectionsAnalyzed": 10,
    "generationTime": 0,
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": 0
  }
}

RULES:
- Use customer's exact language
- Be specific with numbers and observable signals
- Make it actionable
- Return ONLY valid JSON, no markdown fences`;

    console.log('🤖 Calling Claude API for ICP Brief synthesis...');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.5,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    console.log('✅ Claude response received:', responseText.substring(0, 200));

    // Parse JSON response
    let output;
    try {
      // Try to parse directly first
      output = JSON.parse(responseText);
    } catch (e) {
      // If direct parse fails, try to extract JSON from markdown fences
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in Claude response');
      }
      output = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    }

    // Validate schema
    if (!output.icpProfile || !output.buyingIntelligence || !output.targetingPlaybook) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      sectionsAnalyzed: 10,
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens
    };

    console.log('✅ Successfully generated ICP Brief');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: true,
        output,
        metadata: {
          generationTime,
          tokensUsed: output.metadata.tokensUsed
        }
      })
    };

  } catch (error) {
    console.error('💥 Error generating ICP Brief:', error);

    const generationTime = (Date.now() - startTime) / 1000;

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: error.stack,
        generationTime
      })
    };
  }
};
