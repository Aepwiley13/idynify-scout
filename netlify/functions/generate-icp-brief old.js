import Anthropic from '@anthropic-ai/sdk';

export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { scoutData } = JSON.parse(event.body);

    if (!scoutData) {
      throw new Error('Scout data is required');
    }

    console.log('🎯 Generating ICP Brief from scoutData:', {
      goal: scoutData.goal,
      industries: scoutData.industries?.length,
      jobTitles: scoutData.jobTitles?.length,
      companySizes: scoutData.companySizes?.length
    });

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `Based on this business information, create an Ideal Customer Profile (ICP) brief:

BUSINESS GOAL: ${scoutData.goal}
WEBSITE: ${scoutData.companyWebsite}
LINKEDIN: ${scoutData.linkedinCompanyPage}

TARGET INDUSTRIES: ${scoutData.industries?.join(', ')}
DECISION-MAKER TITLES: ${scoutData.jobTitles?.join(', ')}
${scoutData.otherJobTitles ? `OTHER TITLES: ${scoutData.otherJobTitles}` : ''}
COMPANY SIZES: ${scoutData.companySizes?.join(', ')}

COMPETITORS: ${scoutData.competitors}
PERFECT FIT COMPANIES: ${scoutData.perfectFitCompanies}
AVOID LIST: ${scoutData.avoidList}

PAIN POINTS: ${scoutData.painPoints}
VALUE PROPOSITION: ${scoutData.valueProposition}

Generate a concise ICP brief in JSON format with these fields:
{
  "companyName": "Extract from website or use 'Your Company'",
  "idealCustomerGlance": "2-3 sentence overview of the ideal customer",
  "perfectFitIndicators": ["5 specific indicators that signal a perfect fit"],
  "antiProfile": ["4 red flags or characteristics to avoid"],
  "keyInsight": "1-2 sentence strategic insight about targeting approach"
}

Return ONLY valid JSON, no markdown formatting.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    console.log('🤖 Claude response:', responseText.substring(0, 200));

    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const icpBrief = JSON.parse(jsonMatch[0]);
    
    console.log('✅ Successfully generated ICP Brief');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ icpBrief })
    };

  } catch (error) {
    console.error('💥 Error generating ICP brief:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: error.message,
        details: error.stack
      })
    };
  }
};