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
    const { userId, authToken, results, searchParams } = JSON.parse(event.body);

    if (!userId || !authToken || !results || !searchParams) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry validating', results.length, 'contacts');

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

    // Prepare data for Claude
    const contactSummaries = results.slice(0, 5).map((contact, idx) => ({
      index: idx + 1,
      name: contact.name,
      title: contact.title,
      company: contact.organization_name,
      email: contact.email || 'Not available',
      linkedin: contact.linkedin_url ? 'Available' : 'Not available',
      location: contact.city && contact.state ? `${contact.city}, ${contact.state}` : 'Not available',
      match_score: contact.match_quality || 0
    }));

    const prompt = `You are Barry, a helpful AI assistant helping users find the right contact. A user searched for a contact with these criteria:

Search Criteria:
${searchParams.name ? `- Name: ${searchParams.name}` : ''}
${searchParams.company_name ? `- Company: ${searchParams.company_name}` : ''}
${searchParams.linkedin_url ? `- LinkedIn: ${searchParams.linkedin_url}` : ''}
${searchParams.facebook_url ? `- Facebook: ${searchParams.facebook_url}` : ''}

Here are the search results:

${contactSummaries.map(c => `
${c.index}. ${c.name}
   Title: ${c.title || 'Not available'}
   Company: ${c.company || 'Not available'}
   Email: ${c.email}
   LinkedIn: ${c.linkedin}
   Location: ${c.location}
   Match Score: ${c.match_score}/100
`).join('\n')}

Your task:
1. Select the BEST match based on name similarity, company match, and data completeness
2. Assign a confidence level: "high" (90%+ sure), "medium" (60-89% sure), or "low" (<60% sure)
3. Write a brief, friendly explanation (1-2 sentences) explaining why this is the best match

Respond ONLY with valid JSON in this exact format:
{
  "selected_index": 1,
  "confidence": "high",
  "explanation": "This looks like the best match based on..."
}`;

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('❌ Claude API error:', claudeResponse.status, errorText);
      throw new Error('AI validation failed');
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content[0].text;

    console.log('🐻 Barry response:', responseText);

    // Parse Claude's response
    let barryDecision;
    try {
      // Extract JSON from response (in case Claude added any extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        barryDecision = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing Barry response:', parseError);
      // Fallback to top match
      barryDecision = {
        selected_index: 1,
        confidence: 'medium',
        explanation: 'This is the top match based on the search criteria.'
      };
    }

    // Get the selected contact
    const selectedContact = results[barryDecision.selected_index - 1] || results[0];

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryValidateContact', 'success', {
      responseTime,
      metadata: {
        resultsCount: results.length,
        selectedIndex: barryDecision.selected_index,
        confidence: barryDecision.confidence
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
        recommendation: {
          contact: selectedContact,
          confidence: barryDecision.confidence,
          explanation: barryDecision.explanation
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in barryValidateContact:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryValidateContact', 'error', {
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
