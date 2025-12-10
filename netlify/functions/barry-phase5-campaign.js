exports.handler = async (event, context) => {
  console.log('📧 PHASE 5: Campaign Builder - Starting');
  
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { userId, contact, scoutData, campaignType = 'email' } = JSON.parse(event.body);
    
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicKey) {
      throw new Error('Anthropic API key not configured');
    }

    if (!contact) {
      throw new Error('No contact provided');
    }

    console.log(`📧 Generating ${campaignType} campaign for: ${contact.name}`);

    // Generate personalized messages
    const campaign = await generateCampaign(contact, scoutData, campaignType, anthropicKey);

    console.log(`✅ Campaign generated for ${contact.name}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        campaign: campaign,
        contact: contact,
        message: `Campaign generated for ${contact.name}`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Error in Phase 5:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        campaign: null
      })
    };
  }
};

async function generateCampaign(contact, scoutData, campaignType, anthropicKey) {
  const company = contact.companyContext || contact.organization || {};
  
  const prompt = `You are Barry, an expert AI SDR. Generate a personalized ${campaignType} outreach campaign for this prospect.

PROSPECT DETAILS:
- Name: ${contact.name}
- Title: ${contact.title}
- Company: ${company.name} (${company.size || company.estimated_num_employees || '?'} employees)
- Industry: ${company.industry || 'Unknown'}
- Seniority: ${contact.seniority || 'Unknown'}
- Barry Score: ${contact.barryScore}/100
- Why they're a good fit: ${contact.barryReasoning}

YOUR SOLUTION:
- Product: Idynify - AI-powered B2B sales development tool
- Value Prop: Barry AI finds and qualifies ideal prospects automatically
- Key Benefit: 10x faster lead generation with better targeting
- Target Users: Sales teams, founders, SDR managers at B2B companies

CAMPAIGN REQUIREMENTS:
${campaignType === 'email' ? `
Generate 3 EMAIL VARIATIONS:

Each email should:
1. Have a compelling subject line (5-8 words, avoid spam words)
2. Be 80-120 words total (SHORT and punchy)
3. Open with a relevant hook about their company/role
4. Mention 1 specific pain point they likely have
5. Introduce Idynify with 1 clear benefit
6. End with a low-friction CTA (not "schedule a call")
7. Use first name only, casual but professional tone
8. NO buzzwords like "cutting-edge", "revolutionize", "game-changer"
9. NO generic phrases like "hope this email finds you well"
10. Be genuinely helpful, not salesy

VARIATION STYLES:
- Variation 1: Direct/Problem-focused
- Variation 2: Value/Benefit-focused  
- Variation 3: Curiosity/Question-focused
` : `
Generate 2 LINKEDIN MESSAGE VARIATIONS:

Message 1: CONNECTION REQUEST (250 char limit)
- Must be under 250 characters
- Mention something specific about their profile/company
- No pitch, just authentic reason to connect

Message 2: FOLLOW-UP MESSAGE (after they accept)
- 100-150 words
- Reference the connection, thank them
- Ask 1 thoughtful question about their role/challenges
- Soft intro to Idynify if relevant
- CTA: Would they be open to a quick chat
`}

Return ONLY valid JSON (no markdown, no explanation):
${campaignType === 'email' ? `
{
  "variations": [
    {
      "id": 1,
      "subject": "Subject line here",
      "body": "Email body here",
      "style": "direct"
    },
    {
      "id": 2,
      "subject": "Subject line here",
      "body": "Email body here",
      "style": "value"
    },
    {
      "id": 3,
      "subject": "Subject line here",
      "body": "Email body here",
      "style": "curiosity"
    }
  ]
}
` : `
{
  "connectionRequest": "Message here (under 250 chars)",
  "followUp": "Follow-up message here"
}
`}

Be specific to ${contact.name} at ${company.name}. Make it personal.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0].text;
    
    console.log('Barry campaign response:', text.substring(0, 300));
    
    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Could not parse campaign from Barry');
    }
    
    const campaign = JSON.parse(jsonMatch[0]);
    
    return {
      type: campaignType,
      generatedAt: new Date().toISOString(),
      ...campaign
    };
    
  } catch (err) {
    console.error('Error generating campaign:', err);
    
    // Fallback campaign
    if (campaignType === 'email') {
      return {
        type: 'email',
        generatedAt: new Date().toISOString(),
        variations: [
          {
            id: 1,
            subject: `Quick question about ${company.name}'s sales process`,
            body: `Hi ${contact.firstName || contact.name.split(' ')[0]},

I noticed ${company.name} is in ${company.industry || 'your industry'} - curious how your team currently handles lead generation?

We built Idynify to help ${contact.seniority || 'teams like yours'} find better prospects faster using AI. Worth a quick chat?

Best,
[Your name]`,
            style: 'direct'
          }
        ]
      };
    } else {
      return {
        type: 'linkedin',
        generatedAt: new Date().toISOString(),
        connectionRequest: `Hi ${contact.firstName || contact.name.split(' ')[0]}, I noticed your work at ${company.name}. Would love to connect and learn more about your approach to ${company.industry || 'sales'}.`,
        followUp: `Thanks for connecting! I'm always interested in learning how ${contact.seniority || 'leaders'} at ${company.name} approach lead generation. Quick question - what's your biggest challenge with finding quality prospects right now?`
      };
    }
  }
}
