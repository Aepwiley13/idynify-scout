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

    console.log('🎯 Generating Section 8 Competitive Landscape for user:', userId);

    // Validate required fields
    const requiredFields = [
      'directCompetitors',
      'indirectCompetitors',
      'whyYouWin',
      'whyYouLose',
      'uniqueDifferentiators',
      'competitorStrengths',
      'yourWeaknesses',
      'pricePosition',
      'idealCompetitor',
      'avoidCompetitor'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Validate text fields
      if (['whyYouWin', 'whyYouLose'].includes(field)) {
        if (value.length < 100) {
          throw new Error(`${field} must be at least 100 characters`);
        }
      }
    }

    // Try to get Section 5 data for cost of inaction
    let section5Cost = null;
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.section5Output?.painMotivationMap?.costOfInaction?.totalCost) {
          section5Cost = userData.section5Output.painMotivationMap.costOfInaction.totalCost;
        }
      }
    } catch (err) {
      console.log('Section 5 data not available:', err.message);
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Competitive Landscape Analysis for Section 8 of a RECON ICP intelligence system.

SECTION 8: COMPETITIVE LANDSCAPE

User's answers:
${JSON.stringify(answers, null, 2)}

${section5Cost ? `Cost of Inaction from Section 5: ${section5Cost}` : ''}

Generate the Competitive Landscape output following this EXACT JSON schema with comprehensive battle cards.

CRITICAL: Parse competitors from text into structured data. Extract 3-5 direct competitors and 3-5 indirect alternatives.

CRITICAL: Create detailed battle cards with trap questions for each competitive scenario.

CRITICAL: Extract win/loss reasons from text and categorize by frequency (primary/secondary/occasional).

Return ONLY valid JSON. No markdown. No explanations. No \`\`\`json fences. Just pure JSON.

{
  "section": 8,
  "title": "Competitive Landscape",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "competitiveLandscape": {
    "competitorMap": {
      "directCompetitors": [
        {
          "name": "string (extract competitor 1 from directCompetitors text)",
          "category": "string (enterprise/mid-market/budget based on context)",
          "strengths": ["array of 3-5 strengths from competitorStrengths and whyYouLose"],
          "weaknesses": ["array of 3-5 weaknesses inferred from whyYouWin and context"],
          "whenTheyWin": "string (scenarios where they beat you)",
          "whenYouWin": "string (scenarios where you beat them)",
          "positioning": "string (how to position against them - specific messaging)"
        }
      ],
      "indirectAlternatives": [
        {
          "alternative": "string (extract from indirectCompetitors - e.g., 'Hire more SDRs')",
          "appeal": "string (why customers consider this)",
          "weakness": "string (why it's not ideal)",
          "counterStrategy": "string (how to position against it with numbers)"
        }
      ],
      "statusQuo": {
        "description": "string (extract 'do nothing' or 'manual' from indirectCompetitors)",
        "appeal": "string (why customers stick with status quo - comfort, no budget, etc.)",
        "cost": "string (use section5Cost if available, otherwise estimate from context)",
        "counterStrategy": "string (how to overcome inertia - quantify cost, create urgency)"
      }
    },
    "winLossAnalysis": {
      "winReasons": [
        {
          "reason": "string (extract reason 1 from whyYouWin)",
          "frequency": "string (primary=50%+, secondary=30-50%, occasional=<30% - assess based on language)",
          "customerQuote": "string (rewrite as realistic customer quote)"
        }
      ],
      "lossReasons": [
        {
          "reason": "string (extract from whyYouLose)",
          "frequency": "string (primary/secondary/occasional)",
          "mitigation": "string (specific tactic to address this weakness)"
        }
      ],
      "winRate": {
        "estimatedOverall": "string (estimate based on win/loss reasons - if more/stronger wins, higher rate)",
        "vsEnterprise": "string (if idealCompetitor is enterprise, high rate; if avoidCompetitor, low rate)",
        "vsBudget": "string (typically higher if you're slightly premium position)",
        "vsStatusQuo": "string (typically 50-60% - hardest to overcome)"
      }
    },
    "differentiation": {
      "uniqueValueProps": [
        {
          "differentiator": "string (extract from uniqueDifferentiators)",
          "defendability": "string (hard=unique tech/patent, moderate=expertise/brand, easy=feature parity)",
          "marketRelevance": "string (high=customers care a lot, medium=nice to have, low=differentiator for sake of it)",
          "leverage": "string (how to use in sales - demo, messaging, proof)"
        }
      ],
      "competitiveAdvantages": ["array of 3-5 advantages from whyYouWin"],
      "vulnerabilities": ["array of 3-5 from yourWeaknesses + whyYouLose"]
    },
    "positioningStrategy": {
      "primaryPosition": "string (synthesize from uniqueDifferentiators + pricePosition + idealCompetitor)",
      "againstEnterprise": "string (if competing: emphasize speed, simplicity, cost vs complexity)",
      "againstBudget": "string (if competing: emphasize quality, ROI, professionalism vs cheap)",
      "againstDIY": "string (emphasize opportunity cost, ongoing innovation, focus vs distraction)",
      "againstStatusQuo": "string (quantify cost, create urgency, use peer proof)",
      "targetSegment": "string (describe ideal segment based on idealCompetitor selection)"
    },
    "priceStrategy": {
      "positioning": "string (from pricePosition selection)",
      "implication": "string (what this means for sales - value selling, discount room, etc.)",
      "justification": "string (how to justify price with ROI, quality, cost vs alternatives)",
      "objectionHandling": "string (specific scripts for price objections)"
    },
    "battleCards": {
      "vsEnterprise": {
        "theirStrengths": ["array from competitorStrengths"],
        "theirWeaknesses": ["array of enterprise weaknesses - complex, slow, expensive"],
        "ourAdvantages": ["array from whyYouWin relevant to enterprise comparison"],
        "positioning": "string (specific messaging - emphasize speed, simplicity, ROI)",
        "trapQuestions": [
          "string (question 1 - e.g., 'How long is implementation?' exposes 3-6 months)",
          "string (question 2)",
          "string (question 3)",
          "string (question 4)",
          "string (question 5)"
        ]
      },
      "vsStatusQuo": {
        "theirAppeal": "string (why status quo is comfortable)",
        "costOfInaction": "string (use section5Cost if available, otherwise create estimate)",
        "changeDrivers": ["array of what forces change - urgency, pain, triggers"],
        "positioning": "string (specific messaging - status quo is expensive, not free)",
        "urgencyCreation": "string (tactics to create urgency - deadline, cost per day, competitive pressure)"
      },
      "vsBudget": {
        "theirStrengths": ["Cheap price", "Simple to start", "No commitment"],
        "theirWeaknesses": ["No personalization", "Poor deliverability", "No support", "Damages reputation"],
        "ourAdvantages": ["array from whyYouWin relevant to budget comparison"],
        "positioning": "string (professional-grade vs hobby tools, cost of cheap in long run)",
        "roiJustification": "string (show true cost - reputation damage, wasted time, poor results)"
      }
    },
    "marketOpportunity": {
      "sweetSpot": {
        "description": "string (segment from idealCompetitor - who you want to compete against)",
        "why": "string (why you win in this segment - from whyYouWin)",
        "penetration": "string (realistic market share estimate - be conservative)"
      },
      "avoidSegment": {
        "description": "string (segment from avoidCompetitor)",
        "why": "string (why you lose - from whyYouLose)",
        "strategy": "string (avoid or find different angle)"
      }
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

PARSING INSTRUCTIONS:

1. Extract competitors from directCompetitors text (comma-separated or line-separated)
2. Categorize each competitor: enterprise (Outreach, Salesloft), mid-market (Apollo), budget (Instantly)
3. Extract 3-5 indirect alternatives from indirectCompetitors text
4. Parse whyYouWin into 3-5 distinct win reasons
5. Parse whyYouLose into 3-5 distinct loss reasons
6. Parse uniqueDifferentiators into 3 unique value props
7. Assess defendability: hard (tech/patent), moderate (expertise), easy (features)
8. Create trap questions that expose competitor weaknesses

TRAP QUESTION EXAMPLES:
- "How long is your typical implementation?" (exposes 3-6 months for enterprise)
- "What's the total cost including admin and training?" (exposes hidden costs)
- "Do you require a dedicated admin?" (exposes complexity)
- "How long until we see ROI?" (exposes long payback)
- "Can we start using it this week?" (exposes long onboarding)

WIN/LOSS FREQUENCY ASSESSMENT:
- PRIMARY: If mentioned first or emphasized = 50%+ frequency
- SECONDARY: If mentioned but not emphasized = 30-50% frequency  
- OCCASIONAL: If mentioned last or weak language = <30% frequency`;

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
    if (!output.competitiveLandscape || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate required sections
    const requiredSections = ['competitorMap', 'winLossAnalysis', 'differentiation', 'positioningStrategy', 'battleCards'];
    for (const section of requiredSections) {
      if (!output.competitiveLandscape[section]) {
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

    console.log('✅ Successfully generated Section 8 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);
    console.log(`⚔️  Competitors mapped: ${output.competitiveLandscape.competitorMap.directCompetitors.length}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section8Output: output,
        'reconProgress.section8Completed': true,
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
    console.error('💥 Error generating Section 8:', error);

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
