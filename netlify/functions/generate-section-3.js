import Anthropic from '@anthropic-ai/sdk';
import admin from 'firebase-admin';

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

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
    const { answers, userId } = JSON.parse(event.body);

    if (!answers) {
      throw new Error('Answers are required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    console.log('🎯 Generating Section 3 Firmographic Profile for user:', userId);

    // Validate required fields
    const requiredFields = [
      'companySize',
      'revenueRange',
      'growthStage',
      'geography',
      'targetIndustries',
      'companyType',
      'budgetRange',
      'decisionSpeed',
      'marketSize'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Special validation for arrays
      if (['companySize', 'revenueRange', 'growthStage', 'geography', 'targetIndustries'].includes(field)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`At least one selection required for: ${field}`);
        }
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Firmographic Profile for Section 3 of a RECON ICP intelligence system.

SECTION 3: TARGET MARKET FIRMOGRAPHICS

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Firmographic Profile output following this EXACT JSON schema:
{
  "section": 3,
  "title": "Target Market Firmographics",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "firmographicProfile": {
    "companySizeParameters": {
      "employees": {
        "ranges": [array of selected employee ranges from companySize],
        "primary": "string (identify the MOST IMPORTANT range from their selections)",
        "rationale": "string (explain WHY these employee ranges are ideal - be specific about business maturity, team structure, decision-making)"
      },
      "revenue": {
        "ranges": [array of selected revenue ranges from revenueRange],
        "primary": "string (identify the MOST IMPORTANT range from their selections)",
        "rationale": "string (explain WHY these revenue ranges work - budget availability, growth stage, scale)"
      }
    },
    "growthStageIndicators": {
      "targetStages": [array from growthStage selections],
      "idealStage": "string (identify the BEST FIT stage from their selections)",
      "stageRationale": "string (explain WHY these stages are ideal - funding, urgency, budget authority, growth mindset)"
    },
    "geographicTargeting": {
      "scope": "string (describe overall geographic reach - local/regional/national/international)",
      "regions": [array from geography selections],
      "marketPenetration": "string (explain HOW to serve each region - sales model, support, localization needs)"
    },
    "industryFocus": {
      "primaryIndustries": [array from targetIndustries - up to 3],
      "industryRationale": "string (explain WHY these industries are best fit - use cases, buying behavior, tech adoption, pain points)",
      "avoidIndustries": "string (from avoidIndustries field or 'None specified')",
      "avoidRationale": "string (explain WHY to avoid them - long cycles, low budgets, compliance, poor fit)"
    },
    "companyType": {
      "classification": "string (from companyType field)",
      "implications": "string (explain what this business model means for sales approach, deal complexity, channels)"
    },
    "budgetProfile": {
      "typicalSpend": "string (from budgetRange field)",
      "budgetAlignment": "string (CRITICAL: compare this budget to Section 2 pricing if available, or note if alignment can't be verified)",
      "budgetCycle": "string (infer when they typically buy based on budget range and company type)"
    },
    "decisionVelocity": {
      "speed": "string (from decisionSpeed field)",
      "implication": "string (explain what this speed means for sales cycle, resources needed, urgency tactics)",
      "urgencyFactors": "string (identify what drives fast vs slow decisions at this velocity)"
    },
    "marketSize": {
      "userEstimate": "string (from marketSize field)",
      "tamEstimate": number (CALCULATE: Take midpoint of user's range, apply filters based on selections to estimate total addressable market),
      "samEstimate": number (CALCULATE: Typically 30% of TAM based on current market penetration capability),
      "confidence": "string (high if specific selections, medium if broad selections, low if 'Any stage' or very broad)",
      "methodology": "string (EXPLAIN your calculation: user estimate midpoint, filters applied, assumptions made)"
    },
    "firmographicScoring": {
      "criteria": [
        {
          "factor": "company size",
          "weight": 20,
          "scoring": "string (CREATE scoring rules: Perfect fit (20 pts) = their primary range, Good fit (15 pts) = secondary ranges, Acceptable (10 pts) = adjacent ranges, Poor fit (5 pts) = outliers, Disqualified (0 pts) = completely wrong size)"
        },
        {
          "factor": "revenue",
          "weight": 20,
          "scoring": "string (CREATE scoring rules based on revenue ranges selected)"
        },
        {
          "factor": "industry",
          "weight": 25,
          "scoring": "string (CREATE scoring rules: Perfect fit = targetIndustries, Poor fit = avoidIndustries, others in between)"
        },
        {
          "factor": "growth stage",
          "weight": 20,
          "scoring": "string (CREATE scoring rules based on growth stages selected)"
        },
        {
          "factor": "geography",
          "weight": 15,
          "scoring": "string (CREATE scoring rules based on geographic selections)"
        }
      ],
      "totalWeight": 100,
      "scoringFormula": "string (EXPLAIN: Sum all factor scores. 90-100 = A+ (perfect fit), 75-89 = A (strong), 60-74 = B (good), 45-59 = C (acceptable), 30-44 = D (marginal), 0-29 = F (disqualify). Provide guidance on how to use this score.)"
    }
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
1. For companySizeParameters, identify their PRIMARY range (most important one) from selections
2. For growthStageIndicators, identify the IDEAL stage (best fit) from their selections
3. For marketSize calculation:
   - Extract midpoint from user's range (e.g., "10,000-50,000" → 30,000)
   - Apply filters: B2B (70%), target industries (80%), growth stage (50%), active hiring (40%)
   - TAM = filtered result, SAM = 30% of TAM
   - EXPLAIN your methodology clearly
4. For firmographicScoring, create SPECIFIC scoring rules based on THEIR selections:
   - Perfect fit (20-25 pts) = exactly matches their primary selections
   - Good fit (15-20 pts) = matches their secondary selections
   - Acceptable (10-15 pts) = adjacent/related to their selections
   - Poor fit (5-10 pts) = outliers but not disqualified
   - Disqualified (0 pts) = completely wrong (e.g., avoidIndustries)
5. Budget alignment: If you don't have Section 2 data, note this. If you do, compare budget to pricing.
6. Be SPECIFIC in all rationales - avoid generic language
7. Industry rationale should explain WHY these industries (use cases, buying patterns, tech adoption)
8. Decision velocity should connect to sales cycle length and resource requirements

EXAMPLE MARKET SIZE CALCULATION:
User selects "10,000-50,000 companies"
Midpoint: 30,000 companies
Filters applied:
- B2B companies only (70% of total) = 21,000
- Target industries in US (80% of filtered) = 16,800
- Series A-B or bootstrapped with $1M+ revenue (50%) = 8,400
- Actively hiring sales roles in last 6 months (40%) = 3,360
TAM = 30,000 (broad firmographic match)
SAM = 8,400 (serviceable with current resources and reach)
Confidence: Medium (based on user estimate + industry data approximations)

EXAMPLE SCORING RULES:
If user selected "11-50" and "51-200" employees:
"Perfect fit (20 pts): 11-50 employees (primary range). Good fit (15 pts): 51-200 employees (secondary). Acceptable (10 pts): 1-10 or 201-500 (adjacent ranges). Poor fit (5 pts): 501-1000. Disqualified (0 pts): 1000+ (enterprise complexity we can't serve)."

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
    if (!output.firmographicProfile || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate market size calculations
    if (!output.firmographicProfile.marketSize.tamEstimate || typeof output.firmographicProfile.marketSize.tamEstimate !== 'number') {
      throw new Error('Invalid TAM calculation - must be a number');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      editHistory: []
    };

    console.log('✅ Successfully generated Section 3 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);
    console.log(`📊 TAM: ${output.firmographicProfile.marketSize.tamEstimate.toLocaleString()}, SAM: ${output.firmographicProfile.marketSize.samEstimate.toLocaleString()}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section3Output: output,
        'reconProgress.section3Completed': true,
        'reconProgress.lastUpdated': admin.firestore.FieldValue.serverTimestamp()
      });
      console.log('💾 Saved to Firestore');
    } catch (firestoreError) {
      console.error('⚠️  Warning: Failed to save to Firestore:', firestoreError.message);
      // Don't fail the entire request if Firestore save fails
    }

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
    console.error('💥 Error generating Section 3:', error);

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
