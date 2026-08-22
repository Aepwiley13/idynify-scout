import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { LEGACY_SONNET_4_5 } from './utils/models.js';
import { APOLLO_INDUSTRIES, COMPANY_SIZE_OPTIONS, US_STATES } from '../../src/constants/targetingCanon.js';

// The supported targeting vocabulary. These lists used to live inline here, in
// three separate arrays, while `src/constants` carried its own copies of two of
// them. Duplicated enumerations drift, and the copy that drifts is the one that
// lets an unsupported value reach a query — so they now have one home that this
// function, the normalizer and the editors all read from.

// The prompt shows Claude the industry vocabulary it may choose from. Derived
// from the canonical list rather than written out again.
const INDUSTRY_NAMES = APOLLO_INDUSTRIES.map(i => i.name).join(', ');


// Industries where lookalike disambiguation is critical
const BROAD_INDUSTRIES = [
  "Marketing and Advertising",    // agencies vs platforms vs media
  "Computer Software",            // SaaS vs enterprise vs dev tools
  "Information Technology and Services",
  "Financial Services",           // banks vs fintech vs advisors
  "Management Consulting",        // big 4 vs boutique vs freelance
  "Internet",                     // everything
  "Design",                       // agencies vs freelance vs product
  "Media Production",             // studios vs agencies vs freelance
  "Public Relations and Communications"
];

// Triggers that suggest user wants a specific company TYPE within a broad industry
const SPECIFICITY_TRIGGERS = [
  "agency", "agencies",
  "startup", "startups",
  "saas", "platform", "platforms",
  "boutique", "enterprise",
  "firm", "firms",
  "studio", "studios",
  "consultancy", "consultancies",
  "vendor", "vendors",
  "provider", "providers"
];

// Example companies for broad industries (used as suggestions)
const EXAMPLE_COMPANIES = {
  "Marketing and Advertising": [
    { name: "Disruptive Advertising", type: "paid media agency" },
    { name: "WebFX", type: "full-service digital agency" },
    { name: "KlientBoost", type: "PPC/CRO agency" }
  ],
  "Computer Software": [
    { name: "Slack", type: "SaaS collaboration" },
    { name: "Salesforce", type: "enterprise CRM" },
    { name: "Notion", type: "productivity SaaS" }
  ],
  "Management Consulting": [
    { name: "Bain & Company", type: "strategy consulting" },
    { name: "Slalom", type: "business & tech consulting" },
    { name: "Point B", type: "boutique consulting" }
  ],
  "Financial Services": [
    { name: "Stripe", type: "fintech/payments" },
    { name: "Wealthfront", type: "robo-advisor" },
    { name: "Marcus by Goldman Sachs", type: "consumer banking" }
  ]
};

// Detect clearly unrelated input before calling Claude
function checkForUnrelatedInput(input, conversationHistory = []) {
  if (!input || typeof input !== 'string') {
    return {
      understood: null,
      mappingExplanation: "I didn't catch that. Let's lock in your targets.",
      needsClarification: true,
      followUpQuestion: "Describe who you're hunting. Industry, company size, location — any of those help.",
      followUpType: "industry",
      confidenceScore: 0,
      isAmbiguous: true,
      ambiguityDetails: "Empty or invalid input received."
    };
  }

  const trimmed = input.trim();

  // Check for empty or emoji-only input
  const emojiOnlyRegex = /^[\p{Emoji}\s]+$/u;
  if (trimmed.length === 0 || emojiOnlyRegex.test(trimmed)) {
    return {
      understood: null,
      mappingExplanation: "I power Scout and Hunter by knowing who you're after.",
      needsClarification: true,
      followUpQuestion: "Let's stay on target. What types of companies are you hunting?",
      followUpType: "industry",
      confidenceScore: 0,
      isAmbiguous: true,
      ambiguityDetails: "Input was empty or contained only emojis."
    };
  }

  // FIXED: Allow numbered selections (1, 2, 3) when Barry offered options
  const lastBarryMessage = conversationHistory
    .filter(h => h.role === 'barry')
    .slice(-1)[0]?.content || '';

  const barryOfferedOptions = /\b[1-3]\.\s/.test(lastBarryMessage) ||
                              /option\s*[1-3]/i.test(lastBarryMessage);

  if (barryOfferedOptions && /^[1-3]$/.test(trimmed)) {
    // User is selecting from Barry's numbered options - allow it
    return null;
  }

  // Check for clearly unrelated questions/topics
  const unrelatedPatterns = [
    /^(what('?s| is) the weather|weather forecast|how('?s| is) the weather)/i,
    /^(tell me a joke|make me laugh|say something funny)/i,
    /^(how do i use|how does .* work|what is scout|what is hunter|what is recon|help me with)/i,
    /^(hi|hello|hey|yo|sup)[\s!?.]*$/i,
    /^(thanks|thank you|thx|ty)[\s!?.]*$/i,
    /^(bye|goodbye|see you|later)[\s!?.]*$/i,
    /^(what time|what date|current time|current date)/i,
    /^(who are you|what are you|are you ai|are you a bot)/i,
    /^(can you|could you|would you) (help|assist|tell|explain|show)/i,
    /\b(stock price|crypto|bitcoin|weather|news|sports score)\b/i
  ];

  for (const pattern of unrelatedPatterns) {
    if (pattern.test(trimmed)) {
      return {
        understood: null,
        mappingExplanation: "I power Scout and Hunter by knowing who you're after.",
        needsClarification: true,
        followUpQuestion: "Let's stay on target. What companies are you hunting? For example: 'Marketing agencies in California' or 'SaaS companies, 50-200 employees'.",
        followUpType: "industry",
        confidenceScore: 0,
        isAmbiguous: true,
        ambiguityDetails: "Input appears unrelated to ICP definition."
      };
    }
  }

  // Check for very short input (but allow company names which can be short)
  const looksLikeCompanyName = /^[A-Z]/.test(trimmed) || trimmed.includes('.com') || trimmed.includes('.io');
  if (trimmed.length < 3 && !looksLikeCompanyName && !/^[1-3]$/.test(trimmed)) {
    return {
      understood: null,
      mappingExplanation: "Need more to lock in your targets.",
      needsClarification: true,
      followUpQuestion: "Describe who you're hunting — industry, company size, or geography all help me dial in your ICP.",
      followUpType: "industry",
      confidenceScore: 0,
      isAmbiguous: true,
      ambiguityDetails: "Input too short to extract ICP information."
    };
  }

  // Input seems related - proceed to Claude
  return null;
}

// Check if user input indicates a specific company type within a broad industry
function detectNeedsLookalike(userInput, industries) {
  const inputLower = userInput.toLowerCase();

  // Check if any mapped industry is broad
  const hasBroadIndustry = industries?.some(ind => BROAD_INDUSTRIES.includes(ind));

  // Check if user used specificity triggers
  const hasSpecificityTrigger = SPECIFICITY_TRIGGERS.some(trigger =>
    inputLower.includes(trigger)
  );

  return hasBroadIndustry && hasSpecificityTrigger;
}

// Extract company type keywords from user input
function extractCompanyKeywords(userInput) {
  const inputLower = userInput.toLowerCase();
  const keywords = [];

  for (const trigger of SPECIFICITY_TRIGGERS) {
    if (inputLower.includes(trigger)) {
      // Normalize to singular form
      const normalized = trigger.replace(/ies$/, 'y').replace(/s$/, '');
      if (!keywords.includes(normalized) && !keywords.includes(trigger)) {
        keywords.push(trigger.replace(/ies$/, 'y').replace(/s$/, ''));
      }
    }
  }

  // Also extract descriptive phrases
  const descriptivePatterns = [
    /digital marketing/i,
    /paid media/i,
    /full.?service/i,
    /b2b/i,
    /b2c/i,
    /enterprise/i,
    /smb/i,
    /small business/i
  ];

  for (const pattern of descriptivePatterns) {
    const match = inputLower.match(pattern);
    if (match && !keywords.includes(match[0])) {
      keywords.push(match[0]);
    }
  }

  return keywords;
}

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, action, userInput, currentStep, conversationHistory, existingICP, pendingICP, icpId } = JSON.parse(event.body);
    // icpId scopes which profile's existingICP the client resolved — used for logging;
    // Firestore writes remain client-side (no writes added to this function)
    if (icpId) console.log('🐻 Barry ICP Conversation - icpId:', icpId);

    if (!userId || !authToken) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry ICP Conversation - Action:', action);

    // Validate environment variables
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      throw new Error('Invalid authentication token');
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: claudeApiKey
    });

    // HARDENING: Check for unrelated input before calling Claude
    if (action === 'process_initial_input' || action === 'process_followup') {
      const redirectResponse = checkForUnrelatedInput(userInput, conversationHistory || []);
      if (redirectResponse) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: true,
            barryResponse: redirectResponse,
            step: 'clarifying'
          })
        };
      }
    }

    let result;

    switch (action) {
      case 'process_initial_input':
        result = await processInitialInput(anthropic, userInput, existingICP);
        break;
      case 'process_followup':
        result = await processFollowup(anthropic, userInput, currentStep, conversationHistory, pendingICP);
        break;
      case 'process_example_company':
        result = await processExampleCompany(anthropic, userInput, conversationHistory, pendingICP);
        break;
      case 'generate_summary':
        result = await generateSummary(anthropic, conversationHistory);
        break;
      default:
        throw new Error('Invalid action');
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryICPConversation', 'success', { provider: 'anthropic', model: LEGACY_SONNET_4_5,
      responseTime,
      metadata: { action, currentStep }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        ...result
      })
    };

  } catch (error) {
    console.error('Error in barryICPConversation:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryICPConversation', 'error', {
          provider: 'anthropic',
          model: LEGACY_SONNET_4_5,
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

    // Never expose raw error messages to the frontend
    const safeMessage = error.message?.includes('API key')
      || error.message?.includes('not configured')
      || error.message?.includes('not defined')
      ? 'Barry hit a temporary issue. Please try again.'
      : (error.message || 'Something went wrong. Please try again.');

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: safeMessage,
        generationTime: (Date.now() - startTime) / 1000
      })
    };
  }
};

async function processInitialInput(anthropic, userInput, existingICP) {
  const hasExistingICP = existingICP && existingICP.industries && existingICP.industries.length > 0;

  // Extract keywords from user input for later use
  const companyKeywords = extractCompanyKeywords(userInput);

  const prompt = `You are Barry, the AI sales intelligence assistant for Idynify. Help the user define their Ideal Customer Profile through a focused conversational interview. You are building a targeting profile that drives real company and contact search results.

REQUIRED FIELDS — never confirm ICP until all 6 are populated:
1. industries         — must match Apollo industry list exactly
2. companySizes       — employee ranges
3. locations          — US states, or confirm nationwide
4. companyKeywords    — stage/type signals (saas, startup, series A, etc.)
5. lookalikeSeed      — at least 1 real company as a search anchor
6. targetTitles       — REQUIRED. You must ask for and confirm this.
                        NEVER set needsClarification:false if targetTitles
                        is empty or null. No exceptions.

OPTIONAL FIELD (7th — never block ICP completion on this):
7. foundedAgeRange    — { minAge: number|null, maxAge: number|null }
                        ONLY set when user explicitly references company age or founding time.
                        "founded after 2015" → { minAge: ${new Date().getFullYear() - 2015}, maxAge: null }
                        "companies under 5 years old" → { minAge: null, maxAge: 5 }
                        "companies 5 to 10 years old" → { minAge: 5, maxAge: 10 }
                        "at least 15 years old" → { minAge: 15, maxAge: null }
                        DO NOT infer from stage language ("startup", "Series A") — those go to companyKeywords.
                        If the intent is ambiguous, ask once: "Do you want to filter by founding year?"

HARD RULES:
- If the user has not mentioned who they want to reach, ask: "Who should I be finding at these companies? What titles or roles are you going after?" — ask this once, clearly.
- If the user gives a vague industry (e.g. "software", "tech"), ask for 1-2 real example companies before proceeding.
- Parse natural language generously. Example: "Utah founders raising money" maps to:
    industries = Computer Software
    locations = Utah
    companySizes = 1-10, 11-20, 21-50
    companyKeywords = seed stage, Series A, fundraising
    targetTitles = Founder, CEO, Co-Founder
- If user says "keep what I have but add X" — preserve ALL existing fields and only modify the one they specified.
- Ask ONE clarifying question per turn. Never stack questions.
- Re-entry sessions: open by referencing the user's existing ICP. Example: "You're currently targeting [summary]. Want to refine anything, or should I keep searching?"
- After each user message, briefly reflect what you understood and what is still missing — 2 sentences max.

TARGETING AMBIGUITY — MUST CHECK BEFORE EXTRACTING:
When the user's input could describe EITHER companies to sell to OR individuals/roles to find,
you MUST set isAmbiguous:true, needsClarification:true, and ask ONE bounded clarification question.

Examples of ambiguous input:
- "SaaS sales people in Utah" — could mean SaaS companies in Utah (to sell to), or individual sales professionals at SaaS companies in Utah (to recruit/reach)
- "marketing consultants in Texas" — could mean marketing consulting firms, or individual marketing consultants
- "tech recruiters in California" — could mean recruiting agencies, or individual recruiters at tech companies
- "insurance agents in Florida" — could mean insurance agencies, or individual insurance agents

When ambiguous, ask something like:
"Are you looking for [company interpretation] to sell to, or [individual interpretation]?"

Do NOT set isAmbiguous for clearly unambiguous input:
- "Roofing companies in Utah with 10-50 employees" — clearly companies
- "Find me SaaS startups in Texas" — clearly companies
- "I sell to marketing agencies" — clearly companies

The test: is the OBJECT of the user's intended action a type of company, or a type of person, or is that still unclear? The mere presence of the word "companies" does not resolve ambiguity when the sentence structure makes a role or profession the primary subject. For example, "sales people at SaaS companies in Utah" is AMBIGUOUS — the user may want to discover SaaS companies to sell to, or they may want to find individual sales professionals who work at SaaS companies. The word "companies" appears, but it modifies the workplace, not the target. Unambiguous input names the company type as the direct object: "Find me SaaS companies", "I sell to marketing agencies."

When isAmbiguous is true, still extract what you can into "understood" but set needsClarification:true and provide the clarification question as followUpQuestion. Set followUpType to "industry".

CONFIDENCE SCORING:
  95%+   all 6 fields confirmed including lookalike
  80-94% missing lookalike only, everything else confirmed
  < 80%  titles or location not confirmed — no summary card

BROAD INDUSTRIES (require lookalike for specific targeting):
${BROAD_INDUSTRIES.join(', ')}

SPECIFICITY TRIGGERS (words that indicate user wants a specific company TYPE):
${SPECIFICITY_TRIGGERS.join(', ')}

AVAILABLE INDUSTRIES:
${INDUSTRY_NAMES}

AVAILABLE COMPANY SIZES:
${COMPANY_SIZE_OPTIONS.join(', ')}

US STATES:
${US_STATES.join(', ')}

${hasExistingICP ? `
EXISTING ICP (user has already configured):
- Industries: ${existingICP.industries?.join(', ') || 'None'}
- Company Sizes: ${existingICP.companySizes?.join(', ') || 'None'}
- Locations: ${existingICP.isNationwide ? 'Nationwide' : existingICP.locations?.join(', ') || 'None'}
- Target Titles: ${existingICP.targetTitles?.join(', ') || 'None'}
- Lookalike Seed: ${existingICP.lookalikeSeed?.name || 'None'}
` : ''}

USER INPUT: "${userInput}"

EXAMPLE_COMPANIES for suggestions:
${JSON.stringify(EXAMPLE_COMPANIES, null, 2)}

OUTPUT: Respond only with valid JSON matching the schema below. No text outside the JSON object.

{
  "understood": {
    "industries": ["exact industry names from the list"],
    "companySizes": ["exact sizes from the list"] or null,
    "locations": ["state names"] or "nationwide" or null,
    "targetTitles": ["job titles"] or null,
    "companyKeywords": ["agency", "saas", etc.] - extracted company type keywords,
    "foundedAgeRange": { "minAge": number or null, "maxAge": number or null } or null,
    "rawInput": "what the user said"
  },
  "mappingExplanation": "Your explanation of what you understood",
  "needsLookalike": true/false - CRITICAL: true if broad industry + specificity trigger,
  "lookalikeSuggestions": ["Company 1", "Company 2", "Company 3"] or null - suggestions if asking for lookalike,
  "needsClarification": true/false,
  "followUpQuestion": "your question" or null,
  "followUpType": "lookalike" | "industry" | "size" | "location" | "titles" | "foundedAge" | null,
  "searchStrategy": "lookalike" | "industry_only" | "hybrid",
  "confidenceScore": 0.0 to 1.0,
  "isAmbiguous": true/false,
  "ambiguityDetails": "what's ambiguous" or null
}`;

  const response = await anthropic.messages.create({
    model: LEGACY_SONNET_4_5,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = response.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Failed to parse Barry response');
  }

  const barryResponse = JSON.parse(jsonMatch[0]);

  // Add extracted keywords if Claude didn't include them
  if (!barryResponse.understood?.companyKeywords || barryResponse.understood.companyKeywords.length === 0) {
    if (barryResponse.understood) {
      barryResponse.understood.companyKeywords = companyKeywords;
    }
  }

  // Validate industries against our list
  if (barryResponse.understood?.industries) {
    barryResponse.understood.industries = barryResponse.understood.industries.filter(ind =>
      APOLLO_INDUSTRIES.some(ai => ai.name.toLowerCase() === ind.toLowerCase())
    ).map(ind => {
      const match = APOLLO_INDUSTRIES.find(ai => ai.name.toLowerCase() === ind.toLowerCase());
      return match ? match.name : ind;
    });
  }

  // Validate company sizes
  if (barryResponse.understood?.companySizes) {
    barryResponse.understood.companySizes = barryResponse.understood.companySizes.filter(size =>
      COMPANY_SIZE_OPTIONS.includes(size)
    );
  }

  // Validate locations
  if (barryResponse.understood?.locations && barryResponse.understood.locations !== 'nationwide') {
    barryResponse.understood.locations = barryResponse.understood.locations.filter(loc =>
      US_STATES.includes(loc) || loc.toLowerCase() === 'nationwide'
    );
  }

  // Validate foundedAgeRange — sanitize values, never block ICP completion
  if (barryResponse.understood?.foundedAgeRange) {
    const far = barryResponse.understood.foundedAgeRange;
    const minAge = typeof far.minAge === 'number' && far.minAge >= 0 ? Math.round(far.minAge) : null;
    const maxAge = typeof far.maxAge === 'number' && far.maxAge >= 0 ? Math.round(far.maxAge) : null;
    // If both are null, drop the field entirely
    if (minAge === null && maxAge === null) {
      barryResponse.understood.foundedAgeRange = null;
    } else {
      barryResponse.understood.foundedAgeRange = { minAge, maxAge };
    }
  }

  // targetTitles are useful but do not gate the proposal.
  //
  // This block used to force a clarification turn whenever no titles had been
  // extracted, on the reasoning that Barry should never confirm without them.
  // But titles are a person filter: `mixed_companies/search` never receives
  // them, so a definition missing titles is not a definition that cannot
  // search. Blocking on one contradicts the locked quality floor — a single
  // supported retrieval constraint is enough to start — and turns the last
  // step into the questionnaire this phase exists to remove.
  //
  // Titles are still asked for, just not as a gate: they are surfaced as
  // something Barry does not know yet, and they matter at the moment he goes
  // looking for people at a company rather than at the moment he finds it.
  barryResponse.missingTargetTitles =
    !(barryResponse.understood?.targetTitles?.length > 0);

  // Determine next step — ambiguity blocks confirmation even when the
  // extraction has enough fields.
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike) {
    nextStep = 'awaiting_example';
  } else if (!barryResponse.needsClarification && !barryResponse.isAmbiguous) {
    nextStep = 'confirming';
  }

  return {
    barryResponse,
    step: nextStep
  };
}

async function processFollowup(anthropic, userInput, currentStep, conversationHistory, pendingICP) {
  const historyContext = conversationHistory.map(h =>
    `${h.role === 'barry' ? 'Barry' : 'User'}: ${h.content}`
  ).join('\n');

  // Check if this is an example company response
  const lastBarryMessage = conversationHistory
    .filter(h => h.role === 'barry')
    .slice(-1)[0]?.content || '';

  const wasAskingForExample = lastBarryMessage.toLowerCase().includes('example') &&
                              (lastBarryMessage.toLowerCase().includes('company') ||
                               lastBarryMessage.toLowerCase().includes('ideal'));

  if (wasAskingForExample || currentStep === 'awaiting_example') {
    return processExampleCompany(anthropic, userInput, conversationHistory, pendingICP);
  }

  const prompt = `You are Barry, the AI sales intelligence assistant for Idynify. You are mid-conversation helping the user refine their Ideal Customer Profile.

REQUIRED FIELDS — never set readyToConfirm:true until all 6 are populated:
1. industries         — must match Apollo industry list exactly
2. companySizes       — employee ranges
3. locations          — US states, or confirm nationwide
4. companyKeywords    — stage/type signals (saas, startup, series A, etc.)
5. lookalikeSeed      — at least 1 real company as a search anchor
6. targetTitles       — REQUIRED. NEVER set readyToConfirm:true if targetTitles is empty or null. No exceptions.

OPTIONAL FIELD (7th — never block ICP completion on this):
7. foundedAgeRange    — { minAge: number|null, maxAge: number|null }
                        ONLY set when user explicitly references company age or founding time.
                        DO NOT infer from stage language ("startup", "Series A") — those go to companyKeywords.
                        If ambiguous, ask once: "Do you want to filter by founding year?"

HARD RULES:
- If the user has not mentioned who they want to reach, ask: "Who should I be finding at these companies? What titles or roles are you going after?" — ask this once, clearly.
- If the user gives a vague industry (e.g. "software", "tech"), ask for 1-2 real example companies before proceeding.
- Parse natural language generously. Example: "Utah founders raising money" maps to:
    industries = Computer Software
    locations = Utah
    companySizes = 1-10, 11-20, 21-50
    companyKeywords = seed stage, Series A, fundraising
    targetTitles = Founder, CEO, Co-Founder
- If user says "keep what I have but add X" — preserve ALL existing fields and only modify the one they specified.
- Ask ONE clarifying question per turn. Never stack questions.
- After each user message, briefly reflect what you understood and what is still missing — 2 sentences max.

TARGETING AMBIGUITY — MUST CHECK BEFORE EXTRACTING:
When the user's input could describe EITHER companies to sell to OR individuals/roles to find,
you MUST set isAmbiguous:true, needsMoreInfo:true, and ask ONE bounded clarification question.

Examples of ambiguous input:
- "SaaS sales people in Utah" — could mean SaaS companies in Utah, or individual sales professionals at SaaS companies
- "marketing consultants in Texas" — could mean marketing consulting firms, or individual consultants
- "tech recruiters in California" — could mean recruiting agencies, or individual recruiters

When ambiguous, ask: "Are you looking for [company interpretation] to sell to, or [individual interpretation]?"

Do NOT flag clearly unambiguous input as ambiguous:
- "Roofing companies in Utah with 10-50 employees" — clearly companies
- "Find me SaaS startups in Texas" — clearly companies
- "I sell to marketing agencies" — clearly companies

The test: is the OBJECT of the user's intended action a type of company, or a type of person, or is that still unclear? The mere presence of the word "companies" does not resolve ambiguity when the sentence structure makes a role or profession the primary subject. For example, "sales people at SaaS companies in Utah" is AMBIGUOUS — the user may want SaaS companies to sell to, or individual sales professionals at those companies. Unambiguous input names the company type as the direct object.

When isAmbiguous is true, still extract what you can into "understood" but set needsMoreInfo:true, provide the clarification as followUpQuestion, and set followUpType to "industry".

CONFIDENCE SCORING:
  95%+   all 6 fields confirmed including lookalike
  80-94% missing lookalike only, everything else confirmed
  < 80%  titles or location not confirmed — no summary card

CONVERSATION SO FAR:
${historyContext}

USER'S NEW INPUT: "${userInput}"

PENDING ICP STATE:
${JSON.stringify(pendingICP || {}, null, 2)}

AVAILABLE INDUSTRIES:
${INDUSTRY_NAMES}

AVAILABLE COMPANY SIZES:
${COMPANY_SIZE_OPTIONS.join(', ')}

US STATES:
${US_STATES.join(', ')}

BROAD INDUSTRIES (require lookalike):
${BROAD_INDUSTRIES.join(', ')}

CURRENT STEP: ${currentStep}

OUTPUT: Respond only with valid JSON matching the schema below. No text outside the JSON object.

{
  "understood": {
    "industries": ["exact industry names"],
    "companySizes": ["exact sizes"] or null,
    "locations": ["states"] or "nationwide" or null,
    "targetTitles": ["titles"] or null,
    "companyKeywords": ["agency", etc.] or null,
    "lookalikeSeed": { "name": "Company Name" } or null,
    "foundedAgeRange": { "minAge": number or null, "maxAge": number or null } or null
  },
  "mappingExplanation": "explanation",
  "needsLookalike": true/false,
  "lookalikeSuggestions": ["Company 1", "Company 2"] or null,
  "needsMoreInfo": true/false,
  "followUpQuestion": "question" or null,
  "followUpType": "lookalike" | "industry" | "size" | "location" | "titles" | "foundedAge" | null,
  "searchStrategy": "lookalike" | "industry_only" | "hybrid",
  "confidenceScore": 0.0 to 1.0,
  "readyToConfirm": true/false,
  "isAmbiguous": true/false,
  "ambiguityDetails": "what's ambiguous" or null
}`;

  const response = await anthropic.messages.create({
    model: LEGACY_SONNET_4_5,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = response.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Failed to parse Barry followup response');
  }

  const barryResponse = JSON.parse(jsonMatch[0]);

  // Validate industries
  if (barryResponse.understood?.industries) {
    barryResponse.understood.industries = barryResponse.understood.industries.filter(ind =>
      APOLLO_INDUSTRIES.some(ai => ai.name.toLowerCase() === ind.toLowerCase())
    ).map(ind => {
      const match = APOLLO_INDUSTRIES.find(ai => ai.name.toLowerCase() === ind.toLowerCase());
      return match ? match.name : ind;
    });
  }

  // Validate company sizes
  if (barryResponse.understood?.companySizes) {
    barryResponse.understood.companySizes = barryResponse.understood.companySizes.filter(size =>
      COMPANY_SIZE_OPTIONS.includes(size)
    );
  }

  // Validate locations
  if (barryResponse.understood?.locations && barryResponse.understood.locations !== 'nationwide') {
    barryResponse.understood.locations = barryResponse.understood.locations.filter(loc =>
      US_STATES.includes(loc) || loc.toLowerCase() === 'nationwide'
    );
  }

  // Validate foundedAgeRange — sanitize values, never block ICP completion
  if (barryResponse.understood?.foundedAgeRange) {
    const far = barryResponse.understood.foundedAgeRange;
    const minAge = typeof far.minAge === 'number' && far.minAge >= 0 ? Math.round(far.minAge) : null;
    const maxAge = typeof far.maxAge === 'number' && far.maxAge >= 0 ? Math.round(far.maxAge) : null;
    barryResponse.understood.foundedAgeRange = (minAge === null && maxAge === null)
      ? null
      : { minAge, maxAge };
  }

  // Same rule on this path: titles are reported, never used to withdraw a
  // proposal Barry can otherwise defend. Titles are a person filter and the
  // company search never receives them, so their absence is not a reason the
  // search cannot run. See the initial-input path for the full reasoning.
  const hasFollowupTitles = barryResponse.understood?.targetTitles?.length > 0;
  // Titles may have been given in an earlier turn and carried in pendingICP.
  const hasPendingTitles = pendingICP?.targetTitles?.length > 0;
  barryResponse.missingTargetTitles = !hasFollowupTitles && !hasPendingTitles;

  // Determine next step — ambiguity must block confirmation on this path
  // too. A followup that remains materially ambiguous cannot become
  // 'confirming' merely because the extracted targeting contains enough
  // fields or readyToConfirm happens to be true.
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike && !barryResponse.understood?.lookalikeSeed) {
    nextStep = 'awaiting_example';
  } else if (barryResponse.readyToConfirm && !barryResponse.isAmbiguous && !barryResponse.needsMoreInfo) {
    nextStep = 'confirming';
  }

  return {
    barryResponse,
    step: nextStep
  };
}

async function processExampleCompany(anthropic, userInput, conversationHistory, pendingICP) {
  const historyContext = conversationHistory.map(h =>
    `${h.role === 'barry' ? 'Barry' : 'User'}: ${h.content}`
  ).join('\n');

  const prompt = `You are Barry, the AI sales intelligence assistant for Idynify. The user has just provided an example company to use as a lookalike search anchor.

REQUIRED FIELDS — never set readyToConfirm:true until all 6 are populated:
1. industries         — must match Apollo industry list exactly
2. companySizes       — employee ranges
3. locations          — US states, or confirm nationwide
4. companyKeywords    — stage/type signals
5. lookalikeSeed      — the company the user just named (required for this step)
6. targetTitles       — REQUIRED. NEVER set readyToConfirm:true if targetTitles is empty or null. No exceptions.

HARD RULES:
- Extract the company name from the user's response and confirm it as the lookalike seed.
- Explain the strategy: "I'll prioritize companies similar to [Company] within [Industry]. This gets you real [type], not just any [industry] company."
- If targetTitles are not yet confirmed, ask: "Who should I be finding at these companies? What titles or roles are you going after?"
- Ask ONE clarifying question per turn. Never stack questions.
- Parse natural language generously for any size/location/title signals in the user's message.

CONFIDENCE SCORING:
  95%+   all 6 fields confirmed including lookalike
  80-94% missing lookalike only, everything else confirmed
  < 80%  titles or location not confirmed — no summary card

CONVERSATION SO FAR:
${historyContext}

USER'S RESPONSE: "${userInput}"

PENDING ICP:
${JSON.stringify(pendingICP || {}, null, 2)}

OUTPUT: Respond only with valid JSON matching the schema below. No text outside the JSON object.

{
  "understood": {
    "industries": ["exact industry names"],
    "companySizes": ["exact sizes"] or null,
    "locations": ["states"] or "nationwide" or null,
    "targetTitles": ["titles"] or null,
    "companyKeywords": ["agency", etc.] or null,
    "lookalikeSeed": {
      "name": "Company Name the user provided",
      "domain": "companyname.com" (if you can infer it, otherwise null)
    },
    "foundedAgeRange": { "minAge": number or null, "maxAge": number or null } or null
  },
  "mappingExplanation": "Your strategic explanation of how you'll use this",
  "needsMoreInfo": true/false,
  "followUpQuestion": "question about size/location/titles" or null,
  "followUpType": "size" | "location" | "titles" | "foundedAge" | null,
  "searchStrategy": "lookalike",
  "confidenceScore": 0.0 to 1.0,
  "readyToConfirm": true/false
}`;

  const response = await anthropic.messages.create({
    model: LEGACY_SONNET_4_5,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = response.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Failed to parse Barry example company response');
  }

  const barryResponse = JSON.parse(jsonMatch[0]);

  // Validate industries
  if (barryResponse.understood?.industries) {
    barryResponse.understood.industries = barryResponse.understood.industries.filter(ind =>
      APOLLO_INDUSTRIES.some(ai => ai.name.toLowerCase() === ind.toLowerCase())
    ).map(ind => {
      const match = APOLLO_INDUSTRIES.find(ai => ai.name.toLowerCase() === ind.toLowerCase());
      return match ? match.name : ind;
    });
  }

  // Validate company sizes
  if (barryResponse.understood?.companySizes) {
    barryResponse.understood.companySizes = barryResponse.understood.companySizes.filter(size =>
      COMPANY_SIZE_OPTIONS.includes(size)
    );
  }

  // Validate locations
  if (barryResponse.understood?.locations && barryResponse.understood.locations !== 'nationwide') {
    barryResponse.understood.locations = barryResponse.understood.locations.filter(loc =>
      US_STATES.includes(loc) || loc.toLowerCase() === 'nationwide'
    );
  }

  // Validate foundedAgeRange — sanitize values, never block ICP completion
  if (barryResponse.understood?.foundedAgeRange) {
    const far = barryResponse.understood.foundedAgeRange;
    const minAge = typeof far.minAge === 'number' && far.minAge >= 0 ? Math.round(far.minAge) : null;
    const maxAge = typeof far.maxAge === 'number' && far.maxAge >= 0 ? Math.round(far.maxAge) : null;
    barryResponse.understood.foundedAgeRange = (minAge === null && maxAge === null)
      ? null
      : { minAge, maxAge };
  }

  // Same rule on the follow-up path: titles are reported as missing, never
  // used to withdraw a proposal Barry can otherwise defend. See above.
  const hasExampleTitles = barryResponse.understood?.targetTitles?.length > 0;
  const hasPendingExTitles = pendingICP?.targetTitles?.length > 0;
  barryResponse.missingTargetTitles = !hasExampleTitles && !hasPendingExTitles;

  return {
    barryResponse,
    step: barryResponse.readyToConfirm ? 'confirming' : 'clarifying'
  };
}

async function generateSummary(anthropic, conversationHistory) {
  const historyContext = conversationHistory.map(h =>
    `${h.role === 'barry' ? 'Barry' : 'User'}: ${h.content}`
  ).join('\n');

  const prompt = `You are Barry. Based on this conversation, generate a clear, human-readable ICP summary.

CONVERSATION:
${historyContext}

Generate a summary that:
1. Is 2-3 sentences, natural language
2. Explains WHO the user is targeting
3. Explains the STRATEGY (lookalike vs industry-only)
4. Can be used to explain the ICP to the user for confirmation

RESPOND IN JSON:
{
  "summary": "Your 2-3 sentence summary including the search strategy",
  "bulletPoints": [
    "Industry: X",
    "Based on: [Company Name] (if using lookalike)" or "Industry filter only",
    "Size: Y",
    "Location: Z",
    "Contacts: A"
  ]
}`;

  const response = await anthropic.messages.create({
    model: LEGACY_SONNET_4_5,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = response.content[0].text;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Failed to parse Barry summary response');
  }

  return JSON.parse(jsonMatch[0]);
}
