// Module 5: ICP Brief Generation
// Generate ICP Brief Function - Calls Anthropic API with Claude Sonnet 4

const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, icpData } = JSON.parse(event.body);

    // Validate input
    if (!userId || !icpData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing userId or icpData' })
      };
    }

    if (!icpData.industries || !icpData.companySizes || !icpData.targetTitles || !icpData.territories) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Incomplete ICP data' })
      };
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Create the prompt for Claude
    const prompt = `Generate a comprehensive 1-page Ideal Customer Profile (ICP) Brief based on the following targeting criteria:

**Industries**: ${icpData.industries.join(', ')}
**Company Sizes**: ${icpData.companySizes.join(', ')} employees
**Target Titles**: ${icpData.targetTitles.join(', ')}
**Geographic Territories**: ${icpData.territories.join(', ')}

Please create a professional ICP brief that includes:
1. Executive Summary (2-3 sentences)
2. Target Market Overview
3. Ideal Company Profile
4. Key Decision Makers
5. Geographic Focus
6. Recommended Approach

Keep the brief concise, actionable, and focused on helping a sales team identify and target the right prospects.`;

    // Call Anthropic API with Claude Sonnet 4
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the generated text
    const briefText = message.content[0].text;

    // Return the brief with timestamp
    return {
      statusCode: 200,
      body: JSON.stringify({
        text: briefText,
        generatedAt: new Date().toISOString(),
        userId: userId
      })
    };

  } catch (error) {
    console.error('Error generating ICP brief:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate ICP brief',
        message: error.message
      })
    };
  }
};
