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
    const { answers, userId, authToken } = JSON.parse(event.body);

    if (!answers) {
      throw new Error('Answers are required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!authToken) {
      throw new Error('Authentication token is required');
    }

    console.log('🎯 Generating Section 2 Product Deep Dive for user:', userId);

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

    // Validate that we have answers (generic validation)
    if (!answers || Object.keys(answers).length === 0) {
      throw new Error('No answers provided');
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Product Analysis for Section 2 of a RECON ICP intelligence system.

SECTION 2: PRODUCT DEEP DIVE

User's product/service details:
${JSON.stringify(answers, null, 2)}

Generate the Product Analysis output following this EXACT JSON schema:
{
  "section": 2,
  "title": "Product Deep Dive",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "executiveSummary": {
    "productSnapshot": {
      "name": "string (productName)",
      "category": "string (category)",
      "positioning": "string (1-2 sentences describing what it does and who it's for)"
    },
    "coreValue": {
      "topFeatures": ["array of 3-5 most compelling features from coreFeatures"],
      "differentiation": "string (what makes it unique - from differentiation field)",
      "primaryUseCases": ["array from useCases field"]
    },
    "implementationProfile": {
      "timeToValue": "string (from implementationTime)",
      "supportNeeded": "string (from supportLevel)",
      "buyerImplication": "string (what this means for who buys it - quick = self-serve, long = executive buy-in needed)"
    },
    "pricingStrategy": {
      "model": "string (from pricingModel)",
      "startingPrice": "string (from startingPrice)",
      "marketPosition": "string (analyze if this is enterprise, mid-market, or SMB pricing)"
    },
    "techStackFit": {
      "idealEnvironment": "string (from techStack - what tools do ideal customers use)",
      "criticalIntegrations": ["array from integrations if provided"],
      "buyerSignal": "string (What does their tech stack tell you about ICP? e.g., 'Salesforce users = enterprise focus')"
    },
    "icpImplications": [
      "string (3-5 insights about WHO will buy based on product attributes)",
      "string (e.g., 'High implementation time + enterprise pricing = targets IT/RevOps leaders, not individual contributors')",
      "string (e.g., 'Self-serve model + low price = targets doers/practitioners, not C-suite')",
      "string (e.g., 'Salesforce integration required = only companies with $1M+ revenue')",
      "string (Connect product features to buyer persona and company profile)"
    ],
    "keyInsight": "string (ONE actionable insight: What does this product reveal about your ICP's needs, budget, and buying process?)"
  },
  "rawAnswers": ${JSON.stringify(answers, null, 2)},
  "metadata": {
    "generationTime": 0,
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": 0,
    "editHistory": []
  }
}

CRITICAL INSTRUCTIONS:
1. Analyze what the PRODUCT reveals about the IDEAL CUSTOMER
2. Implementation time + pricing + support level = buyer persona clues
3. Tech stack = company size/sophistication signals
4. Be SPECIFIC about implications (not "various companies" but "Series A SaaS companies with 20-100 employees")
5. Key Insight should connect product attributes to WHO can actually buy and use it successfully

Return ONLY valid JSON. No markdown. No explanations. No \`\`\`json fences. Just pure JSON.`;

    console.log('🤖 Calling Claude API...');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.7,
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
    if (!output.executiveSummary || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      editHistory: []
    };

    console.log('✅ Successfully generated Section 2 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);

    // Note: Client will save to Firestore using its authenticated session
    console.log('💡 Returning output to client for Firestore save');

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
    console.error('💥 Error generating Section 2:', error);

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
