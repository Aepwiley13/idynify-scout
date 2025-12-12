const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { scoutData } = JSON.parse(event.body);
    
    if (!scoutData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Scout data is required' })
      };
    }

    const prompt = `You are Barry AI, a space-themed bear consultant helping with B2B lead generation. Analyze this business and create an Executive Summary for their Ideal Customer Profile.

Business Information:
- Goal: ${scoutData.goal}
- Company: ${scoutData.company}
- Website: ${scoutData.website || 'Not provided'}
- Industry: ${scoutData.industry}
- Target Industries: ${scoutData.targetIndustry}
- Target Company Size: ${scoutData.companySize}
- Pain Points They Solve: ${scoutData.painPoints}
- Value Proposition: ${scoutData.valueProposition}

Create an Executive Summary with these sections:
1. Ideal Customer at a Glance (2-3 sentences max)
2. Perfect Fit Indicators (3-5 bullet points)
3. Anti-Profile (Who to AVOID - 2-3 bullet points)
4. Key Insight (1 sentence game-changer)

Keep it concise, actionable, and reference their goal: "${scoutData.goal}" throughout.

Respond ONLY with valid JSON in this exact format:
{
  "idealCustomerGlance": "string",
  "perfectFitIndicators": ["string", "string", "string"],
  "antiProfile": ["string", "string"],
  "keyInsight": "string"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    
    let executiveSummary;
    try {
      executiveSummary = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/\{[\s\S]+\}/);
      if (jsonMatch) {
        executiveSummary = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        executiveSummary: executiveSummary
      })
    };

  } catch (error) {
    console.error('Error generating executive summary:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to generate executive summary',
        message: error.message 
      })
    };
  }
};
