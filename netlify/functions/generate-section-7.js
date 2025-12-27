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

    console.log('🎯 Generating Section 7 Decision Process for user:', userId);

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

    const sectionNumber = 7;
    const sectionTitle = "Decision Process";

    const prompt = `You are generating analysis for Section ${sectionNumber} (${sectionTitle}) of a RECON ICP intelligence system.

User's answers:
${JSON.stringify(answers, null, 2)}

Generate comprehensive ICP analysis output following this EXACT JSON schema:
{
  "section": ${sectionNumber},
  "title": "${sectionTitle}",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "executiveSummary": {
    "overview": "string (2-3 sentence summary of key insights from this section)",
    "keyFindings": [
      "string (3-7 specific, actionable insights derived from the user's answers)",
      "string (Focus on WHO the ideal customer is and HOW to identify them)",
      "string (Be specific with numbers, roles, company attributes)",
      "string (Include observable signals when relevant)",
      "string (Connect findings to ICP targeting strategy)"
    ],
    "icpImplications": [
      "string (3-5 insights about how this data narrows the ICP definition)",
      "string (What does this tell us about company size, industry, roles, etc.)",
      "string (Observable signals for targeting and qualification)"
    ],
    "actionableInsights": [
      "string (2-4 specific next steps or targeting strategies)",
      "string (How to use this information in prospecting/outreach)",
      "string (Warning signs or anti-patterns to avoid)"
    ],
    "keyInsight": "string (ONE critical takeaway that synthesizes this section's contribution to ICP definition)"
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
1. Use the user's EXACT language from their answers - don't sanitize or rewrite
2. Be SPECIFIC - include numbers, percentages, company sizes, roles, technologies
3. Focus on OBSERVABLE signals that can be used for targeting
4. Connect findings to HOW to identify and qualify prospects
5. Key Insight must be ACTIONABLE and section-specific
6. Synthesize across all answers to find patterns and implications
7. Think about: WHO buys, WHAT they look like, WHERE to find them, WHY they buy

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

    console.log('✅ Successfully generated Section 7 output');
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
    console.error('💥 Error generating Section 7:', error);

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
