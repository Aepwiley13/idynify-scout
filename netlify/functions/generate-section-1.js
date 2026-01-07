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

    console.log('🎯 Generating Section 1 Executive Summary for user:', userId);

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

    // Validate required fields
    const requiredFields = ['companyName', 'whatYouDo', 'industry', 'stage', 'role', 'mainProduct', 'problemSolved', 'currentCustomers'];
    for (const field of requiredFields) {
      if (!answers[field] || answers[field].trim() === '') {
        throw new Error(`Required field missing: ${field}`);
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Executive Summary for Section 1 of a RECON ICP intelligence system.

SECTION 1: COMPANY IDENTITY & FOUNDATION

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Executive Summary output following this EXACT JSON schema:
{
  "section": 1,
  "title": "Company Identity & Foundation",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "executiveSummary": {
    "companyOverview": {
      "name": "string",
      "industry": "string",
      "stage": "string",
      "elevatorPitch": "string (1-2 sentences combining whatYouDo into compelling pitch)"
    },
    "coreOffering": {
      "product": "string (from mainProduct)",
      "problemSolved": "string (use exact customer language from problemSolved)",
      "targetCustomer": "string (from currentCustomers)"
    },
    "currentState": {
      "ninetyDayGoal": "string (from ninetyDayGoal)",
      "biggestChallenge": "string (from biggestChallenge)",
      "implication": "string (analyze what challenge means for ICP - be specific)"
    },
    "idealCustomerGlance": "string (2-3 sentence snapshot synthesizing currentCustomers + problemSolved)",
    "perfectFitIndicators": [
      "string (5-7 OBSERVABLE signals like 'Recently raised Series A funding')",
      "string (Use currentCustomers + stage + industry to infer signals)",
      "string (Focus on LinkedIn-visible signals: hiring, funding, job changes)",
      "string (Be specific: '50-100 employees' not 'small team')",
      "string (Include tech stack signals if relevant)",
      "string (optional)",
      "string (optional)"
    ],
    "antiProfile": [
      "string (3-5 company types to avoid)",
      "string (Infer from stage - e.g., if Growth stage, avoid Pre-revenue)",
      "string (Infer from currentCustomers - opposite characteristics)",
      "string (optional - companies likely to churn)",
      "string (optional - wrong fit indicators)"
    ],
    "keyInsight": "string (ONE actionable takeaway connecting goal + challenge + ICP)"
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
1. Use the customer's EXACT language from their answers - don't sanitize it
2. Be SPECIFIC - no vague terms like "various industries" or "small businesses"
3. Perfect Fit Indicators must be OBSERVABLE (funding, hiring, company size, revenue, tech stack)
4. Anti-Profile should include companies they want to avoid PLUS likely churners
5. Key Insight must be ACTIONABLE and connect their 90-day goal to ICP targeting
6. If biggestChallenge mentions long sales cycles, address this in the insight
7. Elevator pitch should be punchy and use their language, not marketing fluff

EXAMPLE GOOD OUTPUT:
{
  "idealCustomerGlance": "Your ideal customer is a B2B SaaS company in growth mode (Series A-B, $2M-$10M revenue) with 20-100 employees. They sell to mid-market customers and have a small, overwhelmed marketing team (1-2 people) struggling to manually nurture leads.",

  "perfectFitIndicators": [
    "Recently raised Series A or Series B funding (within 12 months)",
    "Hiring for marketing or sales development roles",
    "Company size: 20-100 employees",
    "Revenue range: $2M-$10M annually",
    "Using basic email tools (Mailchimp, Constant Contact) but outgrowing them",
    "Active LinkedIn presence (regular posting from founders/marketing)",
    "Trial-to-paid conversion rate below 15%"
  ],

  "antiProfile": [
    "Pre-revenue startups (no budget, too early)",
    "Enterprise companies 500+ employees (need more complex tools)",
    "B2C companies (different buying process and needs)",
    "Companies not using product trials (can't benefit from trial optimization)",
    "Marketing teams of 5+ people (not overwhelmed, have resources)"
  ],

  "keyInsight": "To close 10 customers in 90 days and hit $100K MRR, focus exclusively on Series A/B SaaS companies showing hiring signals and recent funding. Your 6+ month sales cycle suggests you're targeting too broad - narrow to companies with active pain (trial conversion issues) and budget (recent funding). This focus will cut your cycle to 2-3 months."
}

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

    console.log('✅ Successfully generated Section 1 output');
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
    console.error('💥 Error generating Section 1:', error);

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
