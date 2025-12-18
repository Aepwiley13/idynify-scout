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

    console.log('🎯 Generating Section 6 Buying Behavior Profile for user:', userId);

    // Validate required fields
    const requiredFields = [
      'startTriggers',
      'researchMethods',
      'salesCycleLength',
      'bestBuyingTimes',
      'linkedinSignals',
      'competitiveAlternatives',
      'lastStepBeforeBuy',
      'stallReasons',
      'accelerators'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Validate arrays
      if (['startTriggers', 'researchMethods', 'bestBuyingTimes', 'linkedinSignals', 'lastStepBeforeBuy'].includes(field)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`At least one selection required for: ${field}`);
        }
      }
      
      // Validate text fields
      if (['competitiveAlternatives', 'stallReasons', 'accelerators'].includes(field)) {
        if (typeof value === 'string' && value.length < 100) {
          throw new Error(`${field} must be at least 100 characters`);
        }
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Buying Behavior Profile for Section 6 of a RECON ICP intelligence system.

SECTION 6: BUYING BEHAVIOR & TRIGGERS

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Buying Behavior Profile output following this EXACT JSON schema:
{
  "section": 6,
  "title": "Buying Behavior & Triggers",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "buyingBehaviorProfile": {
    "hotTriggers": {
      "eventBased": ["array of selected triggers from startTriggers"],
      "performanceBased": "string (elaborate on performance triggers like poor results, missing targets)",
      "timeBased": "string (elaborate on time-based triggers like fiscal year, quarters, budget cycles)",
      "triggerStrength": "string (very strong/strong/moderate/weak based on number and type of triggers)"
    },
    "researchPatterns": {
      "primaryChannels": ["array of top 3 research methods from researchMethods"],
      "influenceSources": "string (who influences decisions - peers, analysts, reviews, etc.)",
      "contentPreferences": "string (what content they consume - demos, case studies, trials, etc.)",
      "researchDepth": "string (deep/moderate/light based on methods selected)",
      "peerInfluence": "string (very high/high/medium/low based on peer/network selections)"
    },
    "salesCycleTimeline": {
      "averageDuration": "string (from salesCycleLength selection)",
      "durationRange": "string (expand on typical range - e.g., '6-12 weeks typical, 3-4 weeks fast-track')",
      "variance": "string (what causes cycles to be shorter or longer)",
      "stages": [
        {
          "stage": "Awareness",
          "duration": "string (estimate based on total cycle length)",
          "activities": "string (what happens in this stage)"
        },
        {
          "stage": "Evaluation",
          "duration": "string",
          "activities": "string"
        },
        {
          "stage": "Decision",
          "duration": "string",
          "activities": "string"
        }
      ],
      "industryBenchmark": "string (how this cycle compares to industry standards)"
    },
    "seasonalPatterns": {
      "bestTimes": ["array from bestBuyingTimes selections"],
      "avoidTimes": ["array from avoidTimes selections or empty array if none"],
      "seasonalityStrength": "string (very strong/strong/moderate/weak/none)",
      "planningImplications": "string (how to plan outreach, campaigns, and pipeline building)"
    },
    "readinessSignals": {
      "linkedinSignals": ["array from linkedinSignals selections"],
      "digitalFootprint": "string (what online behavior indicates buying readiness)",
      "hiringSignals": "string (if hiring posts selected, elaborate on what hiring signals mean)",
      "fundingSignals": "string (if funding selected, elaborate on funding as trigger)",
      "competitiveSignals": "string (if competitor threat selected, explain competitive pressure)",
      "signalReliability": "string (assess reliability: high 70%+, medium 40-70%, low <40%)"
    },
    "competitiveSet": {
      "directCompetitors": ["array extracted from competitiveAlternatives text - list 2-5 direct competitors"],
      "alternatives": ["array of indirect alternatives - other categories, DIY, etc."],
      "doNothing": "string (describe status quo/manual process if mentioned)",
      "evaluationProcess": "string (how they evaluate you vs competitors - criteria, sequence)"
    },
    "decisionMilestones": {
      "finalSteps": ["array from lastStepBeforeBuy selections"],
      "approvalLevels": "string (what approvals needed - infer from lastStepBeforeBuy)",
      "criticalPath": "string (what MUST happen to close deal - sequence of milestones)",
      "pointOfNoReturn": "string (when deal becomes inevitable - what milestone locks it in)"
    },
    "velocityFactors": {
      "stalls": {
        "commonBottlenecks": ["array extracted from stallReasons - parse into 3-5 reasons"],
        "stallDuration": "string (how long stalls typically last - estimate)",
        "recoveryStrategies": "string (how to get stalled deals moving again)"
      },
      "accelerators": {
        "speedDrivers": ["array extracted from accelerators - parse into 3-5 drivers"],
        "compressionTactics": "string (specific tactics to compress sales cycle)",
        "urgencyCreation": "string (how to create urgency when it doesn't exist naturally)"
      }
    },
    "closeTriggers": {
      "finalPushFactors": ["array from accelerators - what closes deals"],
      "commitmentMoment": "string (when they mentally commit before signing)",
      "lastObjection": "string (typical final hurdle before closing)"
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
1. Use EXACT selections from multi-select fields - don't paraphrase or change
2. Break down salesCycleLength into 3 stages with estimated durations:
   - < 1 week: Awareness (1-2 days), Evaluation (2-3 days), Decision (1-2 days)
   - 1-4 weeks: Awareness (3-7 days), Evaluation (1-2 weeks), Decision (3-5 days)
   - 1-3 months: Awareness (1-2 weeks), Evaluation (4-8 weeks), Decision (2-4 weeks)
   - 3-6 months: Awareness (2-4 weeks), Evaluation (8-16 weeks), Decision (4-8 weeks)
   - 6+ months: Awareness (1-2 months), Evaluation (3-6 months), Decision (1-3 months)
3. Parse competitiveAlternatives text to extract:
   - Direct competitors (tools in same category)
   - Indirect alternatives (different approaches to same problem)
   - Do nothing option (manual/status quo if mentioned)
4. Extract 3-5 specific bottlenecks from stallReasons text
5. Extract 3-5 specific drivers from accelerators text
6. Assess trigger strength based on:
   - Very strong: 4+ triggers including performance + time-based
   - Strong: 3+ triggers with clear urgency
   - Moderate: 2-3 triggers
   - Weak: 1-2 triggers only
7. Assess peer influence based on research methods:
   - Very high: "Ask peers" is #1 or #2 method
   - High: "Ask peers" selected + LinkedIn recommendations
   - Medium: Only one peer-related method
   - Low: No peer-related methods selected
8. For seasonalPatterns.planningImplications, provide SPECIFIC guidance:
   - When to accelerate (best times)
   - When to nurture (avoid times)
   - How to structure quarterly pipeline
9. Signal reliability assessment:
   - Hiring signals: 70%+ (very reliable)
   - Funding signals: 60-70% (reliable within 90 days)
   - Job changes: 40-60% (moderate - new leaders take time)
   - Thought leadership: <40% (low - not buying signal)
10. For criticalPath, describe sequence: "Trial → References → ROI → Approval" (order matters)

EXAMPLE TRIGGER STRENGTH:
Input: ["Raised funding", "Poor quarterly results", "Team churn", "New hire", "Scaling phase"]
Analysis: 5 triggers including funding (budget), poor results (urgency), churn (pain), new hire (champion), scaling (growth)
Output: "Very strong - multiple converging triggers create perfect storm. Funding + poor results + churn = extreme urgency."

EXAMPLE COMPETITIVE SET PARSING:
Input: "Direct competitors: Outreach, Salesloft, Apollo. Indirect: ZoomInfo (data only), Instantly (budget). Biggest competitor is do nothing - manual."
Output:
directCompetitors: ["Outreach", "Salesloft", "Apollo.io"]
alternatives: ["ZoomInfo (data provider)", "Instantly.ai (budget option)", "Build internal tool"]
doNothing: "Status quo is manual prospecting - familiar even if painful. Inertia is strong competitor."

EXAMPLE STALL PARSING:
Input: "Budget approval delays, champion leaving, too many stakeholders, seasonal slowdown, competing priorities"
Output:
commonBottlenecks: [
  "Budget approval delays (CFO or CEO slow to approve)",
  "Champion leaves company mid-deal (lose internal advocate)",
  "Too many stakeholders involved (consensus paralysis)",
  "Seasonal slowdown (summer/holidays)",
  "Competing priorities (other initiatives take precedence)"
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
    if (!output.buyingBehaviorProfile || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate required sections
    const requiredSections = ['hotTriggers', 'researchPatterns', 'salesCycleTimeline', 'velocityFactors'];
    for (const section of requiredSections) {
      if (!output.buyingBehaviorProfile[section]) {
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

    console.log('✅ Successfully generated Section 6 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section6Output: output,
        'reconProgress.section6Completed': true,
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
    console.error('💥 Error generating Section 6:', error);

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
