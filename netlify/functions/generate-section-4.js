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

    console.log('🎯 Generating Section 4 Psychographic Profile for user:', userId);

    // Validate required fields
    const requiredFields = [
      'nightFears',
      'goals',
      'values',
      'commonPhrases',
      'emotionalState',
      'decisionFears',
      'changeAttitude',
      'successMeasurement',
      'personalMotivators',
      'riskTolerance'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Special validation for arrays
      if (['values', 'emotionalState', 'personalMotivators'].includes(field)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`At least one selection required for: ${field}`);
        }
      }
      
      // Special validation for text fields
      if (['nightFears', 'goals', 'decisionFears', 'successMeasurement'].includes(field)) {
        if (typeof value === 'string' && value.length < 100) {
          throw new Error(`${field} must be at least 100 characters`);
        }
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Psychographic Profile for Section 4 of a RECON ICP intelligence system.

SECTION 4: IDEAL CUSTOMER PSYCHOGRAPHICS

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Psychographic Profile output following this EXACT JSON schema:
{
  "section": 4,
  "title": "Ideal Customer Psychographics",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "psychographicProfile": {
    "painLandscape": {
      "nightFears": "string (use their exact nightFears answer)",
      "generalAnxiety": "string (synthesize broader anxiety themes from their answer)",
      "dailyFrustrations": "string (infer tactical daily pain from nightFears + commonPhrases)",
      "strategicChallenges": "string (infer big-picture challenges from nightFears + goals)"
    },
    "goalArchitecture": {
      "objectives": "string (extract specific objectives from goals answer)",
      "aspirations": "string (extract aspirational/career goals from goals answer)",
      "measurableTargets": "string (extract or infer specific metrics from successMeasurement)",
      "timeline": "string (infer urgency and timeframe from goals + successMeasurement)"
    },
    "valueSystem": {
      "topValues": [
        {
          "value": "string (value 1 from values array)",
          "priority": 1,
          "implication": "string (what this value means for purchasing decisions)"
        },
        {
          "value": "string (value 2)",
          "priority": 2,
          "implication": "string"
        },
        {
          "value": "string (value 3)",
          "priority": 3,
          "implication": "string"
        },
        {
          "value": "string (value 4 if provided)",
          "priority": 4,
          "implication": "string"
        },
        {
          "value": "string (value 5 if provided)",
          "priority": 5,
          "implication": "string"
        }
      ],
      "tradeoffs": "string (analyze what they will sacrifice for top values based on their selections)"
    },
    "languagePatterns": {
      "exactPhrases": [
        "array of 5-8 exact phrases extracted from commonPhrases answer - split by commas, periods, or natural breaks"
      ],
      "painLanguage": "string (analyze HOW they describe problems - metaphors, tone, emotional words from commonPhrases)",
      "outcomeLanguage": "string (analyze how they describe desired outcomes - extract from goals + successMeasurement)",
      "industryJargon": "string (identify technical terms or industry-specific language in their answers)",
      "emotionalWords": "string (identify emotionally charged words from nightFears + decisionFears + commonPhrases)"
    },
    "emotionalDrivers": {
      "currentState": "string (describe current emotional state based on emotionalState selections)",
      "desiredState": "string (infer desired emotional state from goals + values)",
      "emotionalJourney": "string (map emotional journey from current frustration to desired success)",
      "triggers": "string (identify what triggers emotional responses based on nightFears + decisionFears)"
    },
    "riskPerception": {
      "decisionFears": "string (use their exact decisionFears answer)",
      "concernsHesitations": "string (synthesize specific concerns from decisionFears)",
      "worstCaseScenario": "string (extrapolate worst-case from decisionFears)",
      "riskMitigationNeeds": "string (infer what would reduce their fear based on decisionFears + riskTolerance)"
    },
    "changeReadiness": {
      "adoptionCurve": "string (use their exact changeAttitude answer)",
      "changeAttitude": "string (elaborate on what their adoption curve position means behaviorally)",
      "innovationTolerance": "string (analyze comfort with new vs proven solutions based on changeAttitude + riskTolerance)",
      "statusQuoBias": "string (assess strength of inertia based on changeAttitude + emotionalState + riskTolerance)"
    },
    "successDefinition": {
      "successMetrics": "string (extract metrics from successMeasurement answer)",
      "proofPoints": "string (infer what would prove success to them based on successMeasurement + values)",
      "timeframe": "string (extract or infer timeframe from successMeasurement + goals)",
      "acceptableROI": "string (infer minimum ROI expectations based on riskTolerance + values)"
    },
    "personalMotivators": {
      "careerDrivers": [
        "array of their personalMotivators selections"
      ],
      "professionalGoals": "string (synthesize from goals + personalMotivators)",
      "personalRewards": "string (elaborate on what drives them based on personalMotivators selections)"
    },
    "riskProfile": {
      "tolerance": "string (use their exact riskTolerance answer)",
      "pastBehavior": "string (infer likely past behavior with risky decisions based on riskTolerance + changeAttitude)",
      "riskRewardBalance": "string (analyze how they weigh risk vs reward based on riskTolerance + values)"
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
1. Use their EXACT language for nightFears, decisionFears, and primary quotes - don't sanitize or formalize
2. Extract exact phrases from commonPhrases by splitting on commas, periods, or line breaks (5-8 phrases total)
3. For valueSystem, prioritize their values 1-5 in the order they selected them
4. For each value, explain SPECIFIC implications for purchasing (not generic)
5. Language analysis should identify PATTERNS not just repeat their words:
   - Pain language: What metaphors/tone do they use? (military, sports, drowning, etc.)
   - Outcome language: How do they describe success? (winning, scaling, leveling up, etc.)
6. Emotional journey should map: START state → desired END state → transition path
7. Risk mitigation needs should be SPECIFIC (social proof, trials, guarantees, etc.)
8. Status quo bias: Be honest about resistance to change if indicated by selections
9. ROI expectations should align with their risk tolerance:
   - Risk taker: 2-3x acceptable
   - Calculated risk: 3-5x expected
   - Risk averse: 5-10x needed
   - Very conservative: Must be guaranteed/proven
10. Personal motivators should connect to professional goals explicitly

EXAMPLE GOOD OUTPUT:
{
  "languagePatterns": {
    "exactPhrases": [
      "We're drowning in manual work",
      "We can't scale fast enough",
      "Our SDRs are burning out",
      "We're losing deals to faster competitors",
      "We need to do more with less",
      "I can't prove ROI to my CEO"
    ],
    "painLanguage": "Uses military/sports metaphors ('we're getting crushed', 'losing ground'). Talks in terms of time wasted ('burning hours'). Expresses urgency through scarcity ('running out of time').",
    "outcomeLanguage": "Talks about 'winning' and 'dominating'. Uses multipliers ('2x pipeline', '3x meetings'). Describes ideal as 'machine' or 'engine'. Wants to 'level up'."
  },
  "valueSystem": {
    "topValues": [
      {
        "value": "Speed / Quick results",
        "priority": 1,
        "implication": "They need wins fast to prove themselves. Long implementations are deal-breakers. Time-to-value matters more than feature completeness."
      }
    ],
    "tradeoffs": "Will sacrifice cost savings for speed and reliability. Will pay premium for something that works vs discount for something requiring heavy lifting."
  }
}

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
    if (!output.psychographicProfile || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate critical sections exist
    const requiredSections = ['painLandscape', 'goalArchitecture', 'valueSystem', 'languagePatterns', 'changeReadiness'];
    for (const section of requiredSections) {
      if (!output.psychographicProfile[section]) {
        throw new Error(`Missing required section in output: ${section}`);
      }
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      editHistory: []
    };

    console.log('✅ Successfully generated Section 4 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section4Output: output,
        'reconProgress.section4Completed': true,
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
    console.error('💥 Error generating Section 4:', error);

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
