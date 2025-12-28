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

    console.log('📊 Generating All Reports for user:', userId);

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

    const prompt = `Generate actionable intelligence reports from the RECON data. Be concise and tactical.

DATA:
${JSON.stringify(essentialData, null, 2)}

Return EXACT JSON schema:
{
  "title": "RECON Intelligence Reports",
  "generatedAt": "${new Date().toISOString()}",
  "version": 1,
  "reports": {
    "executiveBrief": {
      "title": "Executive ICP Brief (1-Page Summary)",
      "sections": [
        {
          "heading": "WHO IS THE IDEAL CUSTOMER?",
          "content": "string (2-3 paragraphs describing the complete ICP profile)"
        },
        {
          "heading": "WHAT MAKES THEM READY TO BUY?",
          "content": "string (key buying triggers and timing signals)"
        },
        {
          "heading": "HOW TO FIND & ENGAGE THEM?",
          "content": "string (prospecting and engagement strategy)"
        },
        {
          "heading": "KEY ACTIONS",
          "content": "string (bulleted list of 5-7 immediate next steps)"
        }
      ]
    },
    "buyerPersonaGuide": {
      "title": "Buyer Persona Intelligence Guide",
      "personas": [
        {
          "personaName": "string (e.g., 'The Overwhelmed VP of Marketing')",
          "demographics": {
            "title": "string",
            "seniority": "string",
            "department": "string",
            "companySize": "string",
            "industry": "string"
          },
          "psychographics": {
            "mindset": "string (how they think - from Section 4)",
            "priorities": ["string (top 3-5 priorities)"],
            "fears": ["string (2-3 key fears)"],
            "motivations": ["string (2-3 key motivations)"]
          },
          "painPoints": ["string (5-7 specific pain points from Section 5)"],
          "buyingBehavior": {
            "decisionRole": "string (Economic Buyer, Champion, etc.)",
            "evaluationCriteria": ["string (what they care about most)"],
            "contentPreferences": ["string (what content they consume)"],
            "preferredChannels": ["string (how they like to be reached)"]
          },
          "messagingStrategy": {
            "hooks": ["string (3-5 opening hooks that resonate)"],
            "valueProps": ["string (2-3 key value propositions for THIS persona)"],
            "proofPoints": ["string (what evidence they need to see)"]
          },
          "objectionHandling": [
            {
              "objection": "string (common objection)",
              "response": "string (how to handle it)"
            }
          ]
        }
      ]
    },
    "targetAccountCriteria": {
      "title": "Target Account Scoring Criteria",
      "description": "Use this to score and prioritize target accounts",
      "mustHaveAttributes": [
        {
          "criterion": "string",
          "howToVerify": "string (LinkedIn, company website, funding announcements, etc.)",
          "points": 10
        }
      ],
      "strongFitAttributes": [
        {
          "criterion": "string",
          "howToVerify": "string",
          "points": 5
        }
      ],
      "niceToHaveAttributes": [
        {
          "criterion": "string",
          "howToVerify": "string",
          "points": 2
        }
      ],
      "disqualifiers": [
        "string (automatic disqualification criteria)"
      ],
      "scoringGuidance": {
        "hotLead": "string (score range and description)",
        "warmLead": "string",
        "coldLead": "string",
        "disqualified": "string"
      }
    },
    "competitiveBattleCard": {
      "title": "Competitive Intelligence Battle Card",
      "mainCompetitors": [
        {
          "name": "string",
          "positioning": "string (how they position themselves)",
          "strengths": ["string"],
          "weaknesses": ["string"],
          "yourAdvantage": "string (why you win against them)",
          "howToCompete": "string (tactical advice)"
        }
      ],
      "competitiveNarrative": "string (your overarching competitive story from Section 9)",
      "landmines": ["string (competitive traps to avoid)"],
      "winningMessages": ["string (messages that differentiate you)"]
    },
    "messagingPlaybook": {
      "title": "ICP-Specific Messaging Playbook",
      "coreValueProposition": "string (your primary value prop in customer language)",
      "messagingPillars": [
        {
          "pillar": "string (theme)",
          "description": "string",
          "keyMessages": ["string (3-5 messages)"],
          "proofPoints": ["string (evidence/examples)"],
          "whenToUse": "string (what stage/context)"
        }
      ],
      "elevatorPitch": {
        "30second": "string",
        "60second": "string",
        "2minute": "string"
      },
      "coldOutreachTemplates": [
        {
          "channel": "string (Email, LinkedIn, etc.)",
          "hook": "string",
          "body": "string",
          "cta": "string"
        }
      ]
    },
    "prospectingPlaybook": {
      "title": "Prospecting & Outreach Playbook",
      "targetAccountSources": [
        "string (where to find target companies - be specific: Apollo, ZoomInfo, LinkedIn filters, etc.)"
      ],
      "linkedInSearchFilters": {
        "companies": ["string (specific filters to use)"],
        "people": ["string (title, seniority, etc.)"]
      },
      "timingSignals": [
        {
          "signal": "string (observable trigger)",
          "whereToMonitor": "string (LinkedIn, Crunchbase, company blog, etc.)",
          "outreachTiming": "string (when to reach out after signal)"
        }
      ],
      "sequenceRecommendations": {
        "touchPoints": "number (recommended # of touches)",
        "duration": "string (days/weeks)",
        "channelMix": ["string (Email -> LinkedIn -> Phone, etc.)"],
        "cadence": "string (Day 1: Email, Day 3: LinkedIn, etc.)"
      },
      "qualificationQuestions": [
        "string (questions to ask during discovery to qualify fit)"
      ]
    },
    "implementationRoadmap": {
      "title": "30-60-90 Day Implementation Roadmap",
      "days0to30": {
        "focus": "string (what to focus on)",
        "actions": ["string (specific tasks)"],
        "expectedOutcomes": ["string"]
      },
      "days31to60": {
        "focus": "string",
        "actions": ["string"],
        "expectedOutcomes": ["string"]
      },
      "days61to90": {
        "focus": "string",
        "actions": ["string"],
        "expectedOutcomes": ["string"]
      },
      "successMetrics": [
        {
          "metric": "string",
          "target": "string",
          "howToTrack": "string"
        }
      ]
    }
  },
  "metadata": {
    "sectionsAnalyzed": 10,
    "reportsGenerated": 7,
    "generationTime": 0,
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": 0
  }
}

RULES:
- Make reports immediately actionable
- Use customer's exact language
- Be specific with examples and tools
- Return ONLY valid JSON, no markdown fences`;

    console.log('🤖 Calling Claude API for comprehensive reports...');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6144,
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
    if (!output.reports) {
      throw new Error('Invalid output schema - missing reports');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      sectionsAnalyzed: 10,
      reportsGenerated: Object.keys(output.reports).length,
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens
    };

    console.log('✅ Successfully generated all reports');
    console.log(`📊 Reports created: ${output.metadata.reportsGenerated}`);
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
          tokensUsed: output.metadata.tokensUsed,
          reportsGenerated: output.metadata.reportsGenerated
        }
      })
    };

  } catch (error) {
    console.error('💥 Error generating reports:', error);

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
