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

    console.log('🎯 Generating Section 5 Pain & Motivation Map for user:', userId);

    // Validate required fields
    const requiredFields = [
      'primaryPain',
      'painCost',
      'triedBefore',
      'whyFailed',
      'doNothing',
      'urgentTrigger',
      'successLooksLike',
      'workarounds',
      'whoElseFeels'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value || value.trim() === '') {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Validate text length
      if (value.length < 100) {
        throw new Error(`${field} must be at least 100 characters`);
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Pain & Motivation Map for Section 5 of a RECON ICP intelligence system.

SECTION 5: PAIN POINTS & MOTIVATIONS

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Pain & Motivation Map output following this EXACT JSON schema:
{
  "section": 5,
  "title": "Pain Points & Motivations",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "painMotivationMap": {
    "primaryPainPoint": {
      "customerLanguage": "string (use EXACT text from primaryPain answer)",
      "painDescription": "string (elaborate on the pain - what does it mean operationally?)",
      "severity": number (rate 1-10 based on impact, urgency, cost),
      "frequency": "string (daily, weekly, monthly - infer from primaryPain description)"
    },
    "costOfInaction": {
      "timeWasted": "string (extract time costs from painCost answer)",
      "moneyLost": "string (extract financial costs from painCost answer)",
      "opportunityMissed": "string (extract opportunity costs from painCost answer)",
      "totalCost": "string (sum up all costs into annual figure if possible)",
      "painROI": "string (calculate potential ROI if this pain is solved - be specific)"
    },
    "failedSolutionHistory": {
      "attemptedSolutions": [
        {
          "solution": "string (extract solution 1 from triedBefore)",
          "failureReason": "string (extract reason from whyFailed for this solution)",
          "lessonLearned": "string (infer what they learned - why they won't repeat this mistake)"
        },
        {
          "solution": "string (solution 2)",
          "failureReason": "string",
          "lessonLearned": "string"
        },
        {
          "solution": "string (solution 3 if mentioned)",
          "failureReason": "string",
          "lessonLearned": "string"
        }
      ],
      "patterns": "string (identify common failure patterns across all attempts)",
      "skepticismLevel": "string (high/medium/low - based on number and severity of failures)"
    },
    "urgencyTriggers": {
      "hotTriggers": [
        "string (extract trigger 1 from urgentTrigger answer)",
        "string (trigger 2)",
        "string (trigger 3)",
        "string (trigger 4 if mentioned)",
        "string (trigger 5 if mentioned)"
      ],
      "triggerEvents": "string (elaborate on what creates urgency - synthesize urgentTrigger)",
      "urgencyLevel": "string (high/medium/low - based on triggers and doNothing consequences)",
      "windowOfOpportunity": "string (how long does urgency last? infer from triggers)"
    },
    "successVision": {
      "specificOutcome": "string (use EXACT text from successLooksLike answer)",
      "timeframe": "string (extract timeframe from successLooksLike - 30 days, 90 days, etc.)",
      "successMetrics": [
        "string (extract metric 1 from successLooksLike)",
        "string (metric 2)",
        "string (metric 3)",
        "string (metric 4 if mentioned)",
        "string (metric 5 if mentioned)"
      ],
      "idealEndState": "string (paint vivid picture of success - expand on successLooksLike)"
    },
    "currentWorkarounds": {
      "copingMechanisms": [
        {
          "workaround": "string (extract workaround 1 from workarounds answer)",
          "cost": "string (what does this workaround cost in time, money, quality?)",
          "sustainability": "string (how long can they keep doing this? is it breaking?)"
        },
        {
          "workaround": "string (workaround 2)",
          "cost": "string",
          "sustainability": "string"
        },
        {
          "workaround": "string (workaround 3 if mentioned)",
          "cost": "string",
          "sustainability": "string"
        }
      ],
      "workaroundCost": "string (total cost of all workarounds - aggregate)",
      "unsustainable": "string (explain WHY current approach is breaking - synthesize from workarounds + doNothing)"
    },
    "stakeholderPainMap": {
      "primaryStakeholder": {
        "role": "string (infer primary stakeholder from whoElseFeels - usually the buyer)",
        "painExperienced": "string (their specific pain)",
        "impact": "string (how it affects them personally)"
      },
      "secondaryStakeholders": [
        {
          "role": "string (extract role 1 from whoElseFeels)",
          "painExperienced": "string (their pain)",
          "impact": "string (their impact)"
        },
        {
          "role": "string (role 2)",
          "painExperienced": "string",
          "impact": "string"
        },
        {
          "role": "string (role 3 if mentioned)",
          "painExperienced": "string",
          "impact": "string"
        }
      ],
      "organizationalImpact": "string (company-wide effects - synthesize from whoElseFeels)",
      "rippleEffects": "string (downstream consequences if not solved)"
    },
    "churnPatterns": {
      "whyTheyLeave": [
        "string (reason 1 from churnReasons if provided)",
        "string (reason 2 if provided)",
        "string (reason 3 if provided)"
      ],
      "failureIndicators": [
        "string (early warning sign 1 - infer from churnReasons)",
        "string (early warning sign 2 if applicable)"
      ],
      "retentionDrivers": "string (what keeps customers successful - infer inverse of churn reasons)",
      "churnRisk": "string (high/medium/low - based on churn patterns)",
      "applicableNote": "string (if churnReasons is empty/null, note 'No existing customer data provided' or 'Currently evaluating solution')"
    },
    "painSeverityScale": {
      "rating": number (1-10 severity rating based on: cost, urgency, consequences, stakeholder impact),
      "rationale": "string (explain WHY this severity rating - be specific with reasoning)",
      "comparisonToOtherPains": "string (how this ranks vs other problems they have - infer from context)"
    },
    "motivationHierarchy": {
      "rankedDrivers": [
        {
          "rank": 1,
          "driver": "string (primary motivation - what's driving them most)",
          "urgency": "string (critical/high/moderate)"
        },
        {
          "rank": 2,
          "driver": "string (secondary motivation)",
          "urgency": "string"
        },
        {
          "rank": 3,
          "driver": "string (tertiary motivation)",
          "urgency": "string"
        }
      ],
      "motivationStrength": "string (very strong/strong/moderate/weak - based on pain + urgency + consequences)"
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
1. Use EXACT customer language for primaryPainPoint.customerLanguage and successVision.specificOutcome
2. Extract NUMBERS from painCost answer (hours, dollars, percentages) for cost calculations
3. Parse triedBefore and whyFailed together to create failedSolutionHistory with lessons learned
4. Extract specific triggers from urgentTrigger (funding, deadlines, CEO pressure, churn, etc.)
5. Break down successLooksLike into specific measurable metrics
6. Parse workarounds answer into individual coping mechanisms with costs
7. Parse whoElseFeels answer into stakeholder map with roles and impacts
8. If churnReasons is empty/null, note "No existing customer data" in applicableNote
9. Calculate painSeverityScale.rating (1-10) based on:
   - Cost magnitude (higher $ = higher severity)
   - Urgency level (immediate = higher severity)
   - Consequences of inaction (severe = higher severity)
   - Number of stakeholders affected (more = higher severity)
10. Create motivationHierarchy by ranking what's driving them MOST urgently
11. For costOfInaction.painROI, calculate potential return: if pain costs $X annually, what's the ROI of a $Y solution?

EXAMPLE SEVERITY CALCULATION:
- Cost: $860K annually = 8 points
- Urgency: Q4 deadline (90 days) = 9 points
- Consequences: Miss targets, job at risk = 10 points
- Stakeholders: 5+ affected = 9 points
Average: (8+9+10+9)/4 = 9/10 severity

EXAMPLE ROI CALCULATION:
Pain costs $860K/year. Solution costs $30K/year.
If solution recovers 50% of wasted time + 25% more pipeline:
Savings = $430K (time) + $250K (pipeline) = $680K
ROI = $680K / $30K = 22.6x or 2,260% return
Write as: "If solution costs $30K annually but recovers 50% of wasted time and adds 25% more pipeline, ROI is 22x+ in first year"

EXAMPLE FAILED SOLUTION PARSING:
Input: "Tried Salesforce with Outreach but too complex. Hired agency but quality was terrible. Tried Mailshake but no personalization."
Output:
[
  {
    "solution": "Salesforce with Outreach (Sales Engagement Platform)",
    "failureReason": "Too complex, took 3 months to implement, team never adopted it",
    "lessonLearned": "Need simpler solution that doesn't require extensive implementation or dedicated admin"
  },
  {
    "solution": "Offshore prospecting agency",
    "failureReason": "Quality was terrible - generic messages, didn't understand ICP",
    "lessonLearned": "Can't outsource this - need to maintain quality and control internally"
  },
  {
    "solution": "Basic email automation (Mailshake)",
    "failureReason": "No real personalization - just mail merge, messages looked automated",
    "lessonLearned": "Need intelligent personalization, not just {{FirstName}} templates"
  }
]

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
    if (!output.painMotivationMap || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate pain severity is a number between 1-10
    const severity = output.painMotivationMap.primaryPainPoint.severity;
    if (typeof severity !== 'number' || severity < 1 || severity > 10) {
      throw new Error('Pain severity must be a number between 1 and 10');
    }

    // Validate pain severity scale rating
    const rating = output.painMotivationMap.painSeverityScale.rating;
    if (typeof rating !== 'number' || rating < 1 || rating > 10) {
      throw new Error('Pain severity scale rating must be a number between 1 and 10');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      editHistory: []
    };

    console.log('✅ Successfully generated Section 5 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);
    console.log(`💢 Pain severity: ${rating}/10`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section5Output: output,
        'reconProgress.section5Completed': true,
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
    console.error('💥 Error generating Section 5:', error);

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
