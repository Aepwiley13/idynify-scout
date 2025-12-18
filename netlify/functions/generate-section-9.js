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

    console.log('🎯 Generating Section 9 Messaging Framework for user:', userId);

    // Validate required fields
    const requiredFields = [
      'emailTone',
      'emailLength',
      'keyMessages',
      'callsToAction',
      'meetingTypes',
      'socialProofEmphasis',
      'personalizationLevel',
      'urgencyTactics'
    ];
    
    for (const field of requiredFields) {
      const value = answers[field];
      if (!value) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Validate arrays
      if (['keyMessages', 'callsToAction', 'meetingTypes'].includes(field)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Error(`At least one selection required for: ${field}`);
        }
      }
    }

    // Fetch data from previous sections
    const contextData = {
      section4: null,
      section5: null,
      section6: null,
      section7: null,
      section8: null
    };

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists()) {
        const userData = userDoc.data();
        contextData.section4 = userData.section4Output?.customerProfile || null;
        contextData.section5 = userData.section5Output?.painMotivationMap || null;
        contextData.section6 = userData.section6Output?.buyingBehaviorProfile || null;
        contextData.section7 = userData.section7Output?.decisionProcessMap || null;
        contextData.section8 = userData.section8Output?.competitiveLandscape || null;
      }
    } catch (err) {
      console.log('⚠️  Warning: Could not fetch all previous section data:', err.message);
    }

    // Log which sections are available
    console.log('📊 Context data availability:');
    Object.keys(contextData).forEach(key => {
      console.log(`  ${key}: ${contextData[key] ? '✓' : '✗'}`);
    });

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Messaging Framework for Section 9 of a RECON ICP intelligence system.

SECTION 9: MESSAGING & COMMUNICATION

User's messaging preferences:
${JSON.stringify(answers, null, 2)}

Context from previous sections:
${JSON.stringify(contextData, null, 2)}

Generate the Messaging Framework output following this EXACT JSON schema.

CRITICAL INSTRUCTIONS:

1. USE DATA FROM PREVIOUS SECTIONS:
   - Section 4: Use exact customer phrases in subject lines and body copy
   - Section 5: Reference quantified pain ($860K cost) in objection handling
   - Section 6: Create trigger-based emails for each trigger event
   - Section 7: Generate stakeholder-specific messaging for economic buyer, champion, users
   - Section 8: Use win reasons in value props, trap questions in discovery, positioning in competitive objections

2. EMAIL TONE & LENGTH:
   - Apply emailTone (${answers.emailTone}) to all email copy
   - Keep emails to emailLength (${answers.emailLength})
   - Match personalizationLevel (${answers.personalizationLevel})

3. 5-TOUCH COLD SEQUENCE:
   - Touch 1 (Day 0): Short, personalized hook with question
   - Touch 2 (Day 2-3): Value-focused with social proof
   - Touch 3 (Day 5-7): Idea/insight with soft CTA
   - Touch 4 (Day 10-12): Cost of inaction math with urgency
   - Touch 5 (Day 15-17): Breakup email with value nugget

4. SUBJECT LINES:
   - Use customer language from Section 4
   - Reference pain from Section 5
   - Reference triggers from Section 6
   - Keep under 60 characters for mobile
   - Generate 5-7 in each category

5. OBJECTION HANDLING:
   - Price: Use Section 5 cost of inaction vs tool cost
   - Timing: Use Section 6 triggers to create urgency
   - Competitor: Use Section 8 trap questions
   - Status quo: Use Section 8 battle card positioning
   - Feature: Use Section 8 differentiation

6. DISCOVERY QUESTIONS:
   - Pain discovery: Surface Section 5 pain points
   - Stakeholder mapping: Identify Section 7 players
   - Competitive intel: Include Section 8 trap questions

7. VALUE PROPS:
   - Create for each Section 7 stakeholder (economic buyer, champion, users)
   - Map to Section 7 decision criteria
   - Use Section 5 pain as problem statement
   - Use Section 8 win reasons as differentiators

Return ONLY valid JSON. No markdown. No explanations. No \`\`\`json fences. Just pure JSON.

{
  "section": 9,
  "title": "Messaging & Communication",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "messagingFramework": {
    "coreValueProps": [
      {
        "audience": "string (from Section 7 stakeholder)",
        "valueProp": "string (outcome-focused, 1 sentence)",
        "painPoint": "string (from Section 5)",
        "outcome": "string (transformation)",
        "proof": "string (from Section 8 win reasons)"
      }
    ],
    "emailSequences": {
      "coldOutreach": {
        "sequence": [
          {
            "touchNumber": 1,
            "timing": "Day 0",
            "channel": "Email",
            "subjectLine": "string (personalized, <60 chars)",
            "body": "string (match emailLength, use emailTone)",
            "cta": "string (from callsToAction)",
            "personalizationNotes": "string"
          },
          {
            "touchNumber": 2,
            "timing": "Day 2-3",
            "channel": "Email",
            "subjectLine": "string",
            "body": "string",
            "cta": "string",
            "personalizationNotes": "string"
          },
          {
            "touchNumber": 3,
            "timing": "Day 5-7",
            "channel": "Email or LinkedIn",
            "subjectLine": "string",
            "body": "string",
            "cta": "string",
            "personalizationNotes": "string"
          },
          {
            "touchNumber": 4,
            "timing": "Day 10-12",
            "channel": "Email",
            "subjectLine": "string",
            "body": "string",
            "cta": "string",
            "personalizationNotes": "string"
          },
          {
            "touchNumber": 5,
            "timing": "Day 15-17",
            "channel": "Email (breakup)",
            "subjectLine": "string",
            "body": "string",
            "cta": "string (no CTA for breakup)",
            "personalizationNotes": "string"
          }
        ],
        "notes": "string (best practices)"
      },
      "triggerBased": {
        "triggers": [
          {
            "trigger": "string (from Section 6 if available)",
            "timing": "string",
            "subjectLine": "string",
            "body": "string",
            "cta": "string",
            "urgency": "string"
          }
        ]
      },
      "stakeholderSpecific": [
        {
          "stakeholder": "string (from Section 7 if available)",
          "focusArea": "string (from Section 7 decision criteria)",
          "subjectLine": "string",
          "body": "string",
          "cta": "string",
          "meetingType": "string (from meetingTypes)"
        }
      ]
    },
    "subjectLines": {
      "painFocused": ["array of 5-7 using Section 5 pain"],
      "valueFocused": ["array of 5-7 emphasizing outcomes"],
      "triggerFocused": ["array of 5-7 for trigger events"],
      "curiosityBased": ["array of 5-7 curiosity hooks"],
      "personalizedTemplates": ["array of 5-7 with {{variables}}"]
    },
    "objectionHandling": {
      "priceObjection": {
        "objection": "\\"This is too expensive\\"",
        "response": "string (use Section 5 cost of inaction)",
        "reframe": "string",
        "proof": "string"
      },
      "timingObjection": {
        "objection": "\\"Not the right time\\"",
        "response": "string (use Section 6 triggers)",
        "reframe": "string",
        "proof": "string"
      },
      "competitorObjection": {
        "objection": "\\"We're looking at [Competitor]\\"",
        "response": "string (use Section 8 trap questions)",
        "reframe": "string",
        "proof": "string"
      },
      "statusQuoObjection": {
        "objection": "\\"We're fine with current process\\"",
        "response": "string (use Section 5 cost + Section 8 positioning)",
        "reframe": "string",
        "proof": "string"
      },
      "featureObjection": {
        "objection": "\\"You're missing [Feature]\\"",
        "response": "string (use Section 8 differentiation)",
        "reframe": "string",
        "proof": "string"
      }
    },
    "discoveryQuestions": {
      "painDiscovery": ["array of 5-7 questions to surface Section 5 pain"],
      "processDiscovery": ["array of 5-7 questions about current state"],
      "stakeholderMapping": ["array of 5-7 questions to identify Section 7 players"],
      "competitiveIntel": ["array of 5-7 including Section 8 trap questions"],
      "urgencyCreation": ["array of 5-7 questions to create urgency"]
    },
    "valuePropOnePages": [
      {
        "audience": "string (Section 7 stakeholder)",
        "headline": "string (outcome-focused)",
        "subheadline": "string (Section 5 problem)",
        "keyBenefits": ["array of 3-5 benefits"],
        "socialProof": "string",
        "differentiator": "string (Section 8)",
        "cta": "string"
      }
    ],
    "linkedInMessaging": {
      "connectionRequest": "string (150 chars max)",
      "followUpMessage": "string",
      "contentCommentTemplates": ["array of 3-5 templates"]
    }
  },
  "rawAnswers": ${JSON.stringify(answers, null, 2)},
  "contextFromPreviousSections": ${JSON.stringify(contextData, null, 2)},
  "metadata": {
    "generationTime": 0,
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": 0,
    "editHistory": []
  }
}`;

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
    if (!output.messagingFramework || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Validate required sections
    const requiredSections = ['coreValueProps', 'emailSequences', 'subjectLines', 'objectionHandling'];
    for (const section of requiredSections) {
      if (!output.messagingFramework[section]) {
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

    console.log('✅ Successfully generated Section 9 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);
    console.log(`📧 Email sequences: ${output.messagingFramework.emailSequences.coldOutreach.sequence.length}`);
    console.log(`💬 Subject lines: ${Object.keys(output.messagingFramework.subjectLines).length} categories`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section9Output: output,
        'reconProgress.section9Completed': true,
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
    console.error('💥 Error generating Section 9:', error);

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
