// Test deployment - 2025-12-17
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
      companySizes: scoutData.companySizes?.length,
      locationScope: scoutData.locationScope?.length,
      targetStates: scoutData.targetStates?.length,
      targetCities: scoutData.targetCities?.length
    });

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Build location targeting string
    let locationTargeting = '';
    if (scoutData.locationScope?.includes('All US')) {
      locationTargeting = 'All United States';
    } else if (scoutData.locationScope?.includes('Remote')) {
      locationTargeting = 'Remote/No Location Preference';
    } else {
      const parts = [];
      if (scoutData.targetStates?.length > 0) {
        parts.push(`States: ${scoutData.targetStates.join(', ')}`);
      }
      if (scoutData.targetCities?.length > 0) {
        parts.push(`Metro Areas: ${scoutData.targetCities.join(', ')}`);
      }
      locationTargeting = parts.join(' | ') || 'Not specified';
    }

    const prompt = `Based on this business information, create a comprehensive Ideal Customer Profile (ICP) brief:

BUSINESS GOAL: ${scoutData.goal}
WEBSITE: ${scoutData.companyWebsite || 'Not provided'}
LINKEDIN: ${scoutData.linkedinCompanyPage || 'Not provided'}

TARGET INDUSTRIES: ${scoutData.industries?.join(', ')}
DECISION-MAKER TITLES: ${scoutData.jobTitles?.join(', ')}
${scoutData.otherJobTitles ? `OTHER TITLES: ${scoutData.otherJobTitles}` : ''}
COMPANY SIZES: ${scoutData.companySizes?.join(', ')}
LOCATION TARGETING: ${locationTargeting}

COMPETITORS: ${scoutData.competitors || 'Not provided'}
PERFECT FIT COMPANIES: ${scoutData.perfectFitCompanies}
AVOID LIST: ${scoutData.avoidList || 'Not provided'}
PAIN POINTS: ${scoutData.painPoints}
VALUE PROPOSITION: ${scoutData.valueProposition}

Generate a comprehensive ICP brief in JSON format with these exact fields:
{
  "companyName": "Extract from website or use 'Your Company'",
  "idealCustomerGlance": "2-3 sentence overview of the ideal customer",
  "perfectFitIndicators": ["5 specific indicators that signal a perfect fit"],
  "antiProfile": ["4 red flags or characteristics to avoid"],
  "keyInsight": "1-2 sentence strategic insight about targeting approach",
  "firmographics": {
    "companySize": "e.g., '50-200 employees'",
    "stage": "e.g., 'Series A-B' or 'Bootstrapped' or 'Growth Stage'",
    "budget": "e.g., '$500-2K/month' or price range they can afford",
    "decisionSpeed": "e.g., '2-4 weeks' typical sales cycle length",
    "industries": [
      {"name": "Industry name", "fit": "High/Medium/Low"},
      {"name": "Industry name", "fit": "High/Medium/Low"},
      {"name": "Industry name", "fit": "High/Medium/Low"},
      {"name": "Industry name", "fit": "High/Medium/Low"}
    ],
    "decisionMakers": [
      {"title": "Job title", "role": "Their role in purchase", "level": "Primary/Secondary"},
      {"title": "Job title", "role": "Their role in purchase", "level": "Primary/Secondary"},
      {"title": "Job title", "role": "Their role in purchase", "level": "Primary/Secondary"}
    ]
  },
  "psychographics": {
    "painPoints": [
      {"pain": "Pain point title", "description": "Brief description", "impact": "Critical/High/Medium"},
      {"pain": "Pain point title", "description": "Brief description", "impact": "Critical/High/Medium"},
      {"pain": "Pain point title", "description": "Brief description", "impact": "Critical/High/Medium"},
      {"pain": "Pain point title", "description": "Brief description", "impact": "Critical/High/Medium"}
    ],
    "values": [
      "Value or belief they hold",
      "Value or belief they hold",
      "Value or belief they hold",
      "Value or belief they hold"
    ]
  },
  "behavioralTriggers": [
    {"trigger": "Trigger event name", "timing": "When it happens", "action": "How to approach them"},
    {"trigger": "Trigger event name", "timing": "When it happens", "action": "How to approach them"},
    {"trigger": "Trigger event name", "timing": "When it happens", "action": "How to approach them"},
    {"trigger": "Trigger event name", "timing": "When it happens", "action": "How to approach them"}
  ]
}

Return ONLY valid JSON, no markdown formatting.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
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