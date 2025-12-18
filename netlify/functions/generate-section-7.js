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

    console.log('🎯 Generating Section 7 Decision Process Map for user:', userId);

    // Validate required fields
    const requiredFields = [
      'economicBuyer',
      'champion',
      'otherStakeholders',
      'committeeDecision',
      'approvalLevels',
      'technicalEvaluation',
      'userInput',
      'consensusOrTopDown',
      'procurementInvolved',
      'decisionCriteria'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Validate arrays
      if (['otherStakeholders', 'technicalEvaluation'].includes(field)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`At least one selection required for: ${field}`);
        }
      }
      
      // Validate text fields
      if (field === 'decisionCriteria') {
        if (typeof value === 'string' && value.length < 100) {
          throw new Error(`${field} must be at least 100 characters`);
        }
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Decision Process Map for Section 7 of a RECON ICP intelligence system.

SECTION 7: DECISION PROCESS & STAKEHOLDERS

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Decision Process Map output following this EXACT JSON schema:
{
  "section": 7,
  "title": "Decision Process & Stakeholders",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "decisionProcessMap": {
    "stakeholderMap": {
      "economicBuyer": {
        "role": "string (from economicBuyer selection)",
        "authority": "string (what they control - budget amount, final decision)",
        "motivations": "string (what drives them - ROI, risk, growth, career)",
        "concerns": "string (what worries them - cost, risk, implementation)",
        "engagementStrategy": "string (how to engage - exec meetings, business case)"
      },
      "champion": {
        "role": "string (from champion selection)",
        "relationship": "string (relationship to economic buyer - reports to, peer, same person)",
        "motivations": "string (what drives champion - career, solving pain, recognition)",
        "influence": "string (very high/high/medium/low influence on economic buyer)",
        "support": "string (how to support champion - content, references, tools)"
      },
      "technicalBuyers": [
        {
          "role": "string (from technicalEvaluation selections)",
          "concerns": "string (security, integration, data privacy, etc.)",
          "vetoPower": boolean,
          "engagementNeeds": "string (technical docs, security reviews, etc.)"
        }
      ],
      "influencers": [
        {
          "role": "string (from otherStakeholders - extract each)",
          "influence": "string (high/medium/low)",
          "concerns": "string (what matters to them)",
          "engagementStrategy": "string (how to engage)"
        }
      ],
      "endUsers": {
        "role": "string (SDRs, AEs, etc. - infer from context)",
        "influence": "string (from userInput selection)",
        "vetoPower": boolean (true if userInput is 'Very high', false otherwise),
        "adoptionCritical": boolean (true if users selected in otherStakeholders)
      }
    },
    "decisionComplexity": {
      "committeeSize": "string (from committeeDecision selection)",
      "approvalLayers": "string (from approvalLevels selection)",
      "complexity": "string (calculate based on committee + approvals: single+1level=low, small+2levels=moderate, large+3levels=high, very large+4levels=very high)",
      "averageDecisionTime": "string (estimate based on complexity: low=2-4 weeks, moderate=6-8 weeks, high=12-16 weeks, very high=20+ weeks)",
      "consensusRequirement": "string (from consensusOrTopDown)"
    },
    "approvalWorkflow": {
      "stages": [
        {
          "stage": 1,
          "name": "string (e.g., 'Champion Evaluation')",
          "stakeholders": ["array of roles involved in this stage"],
          "duration": "string",
          "activities": "string (what happens in this stage)",
          "successCriteria": "string (how to know stage is complete)"
        },
        {
          "stage": 2,
          "name": "string",
          "stakeholders": ["array"],
          "duration": "string",
          "activities": "string",
          "successCriteria": "string"
        },
        {
          "stage": 3,
          "name": "string",
          "stakeholders": ["array"],
          "duration": "string",
          "activities": "string",
          "successCriteria": "string"
        }
      ],
      "totalDuration": "string (sum of all stages - should match averageDecisionTime)",
      "bottlenecks": ["array of 3-5 common bottlenecks based on answers"]
    },
    "procurementProcess": {
      "involvement": "string (from procurementInvolved selection)",
      "whenInvolved": "string (at what stage - usually stage 3 after executive approval)",
      "typicalDuration": "string (how long procurement adds: always=2-4 weeks, usually=1-2 weeks, sometimes=1 week, rarely/never=0 weeks)",
      "requirements": ["array of what procurement needs - MSA, security, insurance, etc."],
      "negotiationStyle": "string (aggressive, collaborative, by-the-book - infer from involvement level)"
    },
    "decisionCriteria": {
      "rankedCriteria": [
        {
          "rank": 1,
          "criterion": "string (extract criterion 1 from decisionCriteria text)",
          "weight": "string (critical/high/moderate - rank 1-2 are critical, 3-4 are high, 5+ are moderate)",
          "stakeholderOwner": "string (who cares most about this - map to stakeholder roles)"
        },
        {
          "rank": 2,
          "criterion": "string",
          "weight": "string",
          "stakeholderOwner": "string"
        },
        {
          "rank": 3,
          "criterion": "string",
          "weight": "string",
          "stakeholderOwner": "string"
        },
        {
          "rank": 4,
          "criterion": "string (if exists)",
          "weight": "string",
          "stakeholderOwner": "string"
        },
        {
          "rank": 5,
          "criterion": "string (if exists)",
          "weight": "string",
          "stakeholderOwner": "string"
        }
      ],
      "mustHaves": ["array of non-negotiable criteria - typically rank 1-2"],
      "niceToHaves": ["array of nice-to-have criteria - typically rank 4-5"],
      "dealBreakers": ["array of things that would kill deal - infer from criteria"]
    },
    "sellingStrategy": {
      "multiThreading": {
        "required": boolean (true if committeeDecision is not 'Single decision maker'),
        "keyRelationships": ["array of roles to multi-thread to - prioritize economic buyer, champion, technical buyers"],
        "priority": "string (describe sequence: 1st: champion, 2nd: users, 3rd: technical, 4th: economic buyer)"
      },
      "championEnablement": {
        "contentNeeds": ["array of what champion needs - ROI calc, slides, competitive comparison, etc."],
        "internalSelling": "string (how to help champion sell internally)",
        "politicalNavigation": "string (how to navigate org politics based on decision style)"
      },
      "consensusBuilding": {
        "strategy": "string (how to build consensus - sequential, parallel, etc.)",
        "alignmentMeetings": "string (what meetings are needed)",
        "objectionHandling": "string (how to handle differing opinions)"
      },
      "executiveEngagement": {
        "when": "string (timing - after champion advocacy, before final decision)",
        "how": "string (executive briefing, business review, etc.)",
        "topics": ["array of topics to discuss with executive"]
      }
    },
    "riskFactors": {
      "singleThreadedRisk": "string (risk if only talking to champion - high/medium/low)",
      "championDepartureRisk": "string (what happens if champion leaves)",
      "consensusFailureRisk": "string (risk if stakeholders don't align)",
      "procurementRisk": "string (risk from procurement delays/demands based on procurementInvolved)",
      "mitigationStrategies": ["array of 5-7 specific mitigation strategies"]
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
1. Map stakeholder roles accurately:
   - Economic Buyer = budget authority, final decision
   - Champion = internal advocate, drives process
   - Technical Buyers = evaluate security, integration (veto power)
   - Influencers = other stakeholders without veto power
   - End Users = people who will actually use the tool

2. Assess champion influence:
   - Very high: Champion IS economic buyer OR economic buyer fully trusts them
   - High: Champion reports directly to economic buyer + good relationship
   - Medium: Champion is peer to economic buyer OR indirect report
   - Low: Champion is IC with limited access to economic buyer

3. Calculate decision complexity:
   - Low: Single decision maker + 1 approval level
   - Moderate: Small committee (2-3) + 2 approval levels
   - High: Large committee (4-6) + 3 approval levels
   - Very high: Very large committee (7+) + 4+ approval levels

4. Estimate decision time:
   - Low complexity: 2-4 weeks
   - Moderate complexity: 6-8 weeks
   - High complexity: 12-16 weeks
   - Very high complexity: 20+ weeks

5. Create 3-stage approval workflow:
   - Stage 1: Champion Evaluation (champion + users if applicable)
   - Stage 2: Executive & Technical Review (economic buyer + IT/Security)
   - Stage 3: Contract & Procurement (Legal + Procurement if applicable)
   
   Duration splits based on total time:
   - 2-4 weeks total: 1w, 1w, 1w
   - 6-8 weeks total: 2w, 3w, 2w
   - 12-16 weeks total: 4w, 6w, 4w
   - 20+ weeks total: 6w, 10w, 6w

6. Parse decisionCriteria text into ranked list:
   - Look for numbered lists (1), 2), 3)) or priority markers
   - Extract criterion name
   - Assign weight: rank 1-2 = critical, 3-4 = high, 5+ = moderate
   - Map stakeholder owner (ROI → economic buyer, ease of use → users, integration → IT)

7. Determine veto power:
   - Technical buyers (IT/Security): YES (can block on security)
   - End users: YES if userInput is "Very high", NO otherwise
   - Procurement: NO (can delay but not block)
   - Legal: NO (can delay but not block)
   - Other influencers: NO

8. Multi-threading is REQUIRED unless single decision maker

9. Engagement priority sequence:
   - 1st: Build champion relationship (PRIMARY)
   - 2nd: Get users excited (if high influence)
   - 3rd: Engage technical buyers early (prevent late veto)
   - 4th: Executive briefing (after champion advocacy built)

10. Common bottlenecks to include:
    - IT Security review delays
    - Legal contract negotiation
    - Champion building internal case
    - Economic buyer calendar/availability
    - Procurement process
    - Budget approval delays
    - Consensus paralysis (if large committee)

EXAMPLE STAKEHOLDER MAPPING:
economicBuyer: "VP Sales"
champion: "Sales Operations Manager"
otherStakeholders: ["IT / Security", "End Users (SDRs/AEs)", "Finance Team"]

Output:
economicBuyer: {
  role: "VP Sales",
  authority: "Controls sales budget up to $100K",
  motivations: "Hitting revenue targets, scaling team, career advancement"
}
champion: {
  role: "Sales Operations Manager",
  relationship: "Reports directly to VP Sales",
  influence: "High - VP Sales trusts their technical judgment"
}
technicalBuyers: [{
  role: "IT/Security team",
  vetoPower: true,
  concerns: "Data security, compliance, integration security"
}]
influencers: [
  {role: "End Users (SDRs)", influence: "High", concerns: "Ease of use, doesn't add work"},
  {role: "Finance Team", influence: "Medium", concerns: "ROI justification"}
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
    if (!output.decisionProcessMap || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate required sections
    const requiredSections = ['stakeholderMap', 'decisionComplexity', 'approvalWorkflow', 'decisionCriteria', 'sellingStrategy'];
    for (const section of requiredSections) {
      if (!output.decisionProcessMap[section]) {
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

    console.log('✅ Successfully generated Section 7 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);
    console.log(`👥 Complexity: ${output.decisionProcessMap.decisionComplexity.complexity}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section7Output: output,
        'reconProgress.section7Completed': true,
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
    console.error('💥 Error generating Section 7:', error);

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
