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

    console.log('🎯 Generating Section 2 Product Intelligence Brief for user:', userId);

    // Validate required fields
    const requiredFields = [
      'productName', 
      'category', 
      'coreFeatures', 
      'differentiation', 
      'useCases', 
      'implementationTime', 
      'supportLevel', 
      'pricingModel', 
      'startingPrice', 
      'techStack'
    ];
    
    for (const field of requiredFields) {
      if (!answers[field] || (typeof answers[field] === 'string' && answers[field].trim() === '')) {
        throw new Error(`Required field missing: ${field}`);
      }
      
      // Special validation for arrays
      if (field === 'coreFeatures' && (!Array.isArray(answers[field]) || answers[field].filter(f => f && f.trim()).length === 0)) {
        throw new Error('At least one core feature is required');
      }
      if (field === 'useCases' && (!Array.isArray(answers[field]) || answers[field].length < 2)) {
        throw new Error('At least 2 use cases are required');
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `You are generating the Product Intelligence Brief for Section 2 of a RECON ICP intelligence system.

SECTION 2: PRODUCT/SERVICE DEEP DIVE

User's answers:
${JSON.stringify(answers, null, 2)}

Generate the Product Intelligence Brief output following this EXACT JSON schema:
{
  "section": 2,
  "title": "Product/Service Deep Dive",
  "status": "completed",
  "completedAt": "${new Date().toISOString()}",
  "version": 1,
  "productIntelligence": {
    "productProfile": {
      "name": "string (from productName)",
      "category": "string (from category)",
      "coreFeatures": [
        "string (feature 1 from coreFeatures array)",
        "string (feature 2)",
        "string (feature 3)",
        "string (feature 4)",
        "string (feature 5)"
      ],
      "featurePriority": "string (analyze which features matter most to customers and why)"
    },
    "differentiation": {
      "uniqueValue": "string (what makes it different - extract key point from differentiation)",
      "competitiveAdvantage": "string (why it's defensible - analyze their differentiation)",
      "positioning": "string (premium/value/niche based on pricing and features)"
    },
    "useCaseMap": {
      "primaryUseCases": [
        "string (use case 1 from useCases array)",
        "string (use case 2)",
        "string (use case 3 - if provided)",
        "string (use case 4 - if provided)"
      ],
      "customerApplications": "string (describe HOW customers actually use it in practice based on use cases)"
    },
    "implementationProfile": {
      "timeToValue": "string (from implementationTime)",
      "supportLevel": "string (from supportLevel)",
      "complexity": "string (derive: instant/< 1 week = simple, 1-4 weeks = moderate, 1-3 months = complex, 3+ months = very complex)",
      "onboardingRequirements": "string (based on implementationTime + supportLevel, describe what customer needs)"
    },
    "pricingStructure": {
      "model": "string (from pricingModel)",
      "entryPoint": "string (from startingPrice)",
      "positioning": "string (derive: <$200/mo = budget, $200-$1000 = value, >$1000 = premium)",
      "implication": "string (what this pricing means for ICP - who can afford it, who it filters out)"
    },
    "technicalFit": {
      "typicalTechStack": "string (from techStack)",
      "requiredIntegrations": [
        "string (integration 1 from integrations array if provided)",
        "string (integration 2 - if provided)",
        "string (integration 3 - if provided)",
        "string (integration 4 - if provided)",
        "string (integration 5 - if provided)"
      ],
      "technicalBarriers": "string (infer potential friction points based on techStack + integrations)"
    },
    "sweetSpotCustomer": {
      "description": "string (synthesize: who gets maximum value based on all answers)",
      "characteristics": [
        "string (characteristic 1 - be specific)",
        "string (characteristic 2 - be specific)",
        "string (characteristic 3 - be specific)"
      ]
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
1. Use the customer's EXACT feature descriptions from coreFeatures - don't rewrite them
2. Be SPECIFIC in featurePriority - explain which features drive purchase decisions
3. For differentiation.uniqueValue, extract the CORE differentiator from their answer
4. For differentiation.competitiveAdvantage, analyze WHY it's defensible (moat, IP, data, network effects)
5. Derive positioning based on pricing: <$200 = budget, $200-$1000 = value, >$1000 = premium
6. For pricingStructure.implication, be specific about WHO this price attracts/repels
7. In technicalBarriers, identify REAL friction points (API access, admin permissions, domain setup, etc.)
8. sweetSpotCustomer.description should synthesize ALL answers into a clear profile
9. sweetSpotCustomer.characteristics must be SPECIFIC and OBSERVABLE (company size, revenue, tech maturity)
10. If integrations array is empty or all blank, set requiredIntegrations to empty array []

EXAMPLE GOOD OUTPUT:
{
  "productProfile": {
    "featurePriority": "Customers prioritize the AI personalization engine and multi-channel orchestration above all else. Lead sourcing is table stakes, but the quality of AI-generated messages is what drives their results. Analytics are important for optimization but not a primary decision factor."
  },
  "differentiation": {
    "uniqueValue": "Only platform combining lead sourcing, AI personalization, and multi-channel execution in one place",
    "competitiveAdvantage": "AI trained on 10M+ successful B2B sales emails (proprietary dataset), not generic GPT prompts. This creates a data moat that improves with scale.",
    "positioning": "Value premium - between budget tools and enterprise platforms"
  },
  "pricingStructure": {
    "implication": "Pricing attracts Series A-B SaaS and bootstrapped profitable companies ($1M+ revenue). Too expensive for pre-revenue startups, too cheap for enterprises. Naturally filters ICP to growth-stage companies with 10-100 employees."
  },
  "technicalBarriers": "Email deliverability requires SPF/DKIM/DMARC setup. CRM API access needs admin permissions which can delay setup. LinkedIn rate limits if using other automation tools. Domain reputation issues require new sending domain.",
  "sweetSpotCustomer": {
    "description": "B2B SaaS companies with 10-100 employees, $1M-$10M revenue, selling products priced $5K-$50K annually. Small sales team (1-5 reps) doing high-volume outbound. Tried basic tools but need better personalization.",
    "characteristics": [
      "Series A or bootstrapped profitable with sales team growing rapidly",
      "Using Salesforce or HubSpot and comfortable with CRM integrations",
      "Sending 500-2000 outbound emails per week with low response rates (<2%)",
      "Budget for tools ($500-$1K/mo) but not enterprise pricing ($3K+/mo)",
      "Technical enough for email authentication but want setup help"
    ]
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
    if (!output.productIntelligence || !output.rawAnswers) {
      throw new Error('Invalid output schema - missing required fields');
    }

    // Add metadata
    const generationTime = (Date.now() - startTime) / 1000;
    output.metadata = {
      generationTime,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
      editHistory: []
    };

    console.log('✅ Successfully generated Section 2 output');
    console.log(`⏱️  Generation time: ${generationTime.toFixed(2)}s`);
    console.log(`🪙 Tokens used: ${output.metadata.tokensUsed}`);

    // Save to Firestore
    try {
      await db.collection('users').doc(userId).update({
        section2Output: output,
        'reconProgress.section2Completed': true,
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
    console.error('💥 Error generating Section 2:', error);

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
