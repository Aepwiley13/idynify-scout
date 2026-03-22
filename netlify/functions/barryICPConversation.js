import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';

// Apollo Industries for mapping
const APOLLO_INDUSTRIES = [
  { name: "Accounting", id: "5567cd4773696439b10b0000" },
  { name: "Airlines/Aviation", id: "5567cd4773696439b10b0001" },
  { name: "Alternative Dispute Resolution", id: "5567cd4773696439b10b0002" },
  { name: "Alternative Medicine", id: "5567cd4773696439b10b0003" },
  { name: "Animation", id: "5567cd4773696439b10b0004" },
  { name: "Apparel & Fashion", id: "5567cd4773696439b10b0005" },
  { name: "Architecture & Planning", id: "5567cd4773696439b10b0006" },
  { name: "Arts and Crafts", id: "5567cd4773696439b10b0007" },
  { name: "Automotive", id: "5567cd4773696439b10b0008" },
  { name: "Aviation & Aerospace", id: "5567cd4773696439b10b0009" },
  { name: "Banking", id: "5567cd4773696439b10b000a" },
  { name: "Biotechnology", id: "5567cd4773696439b10b000b" },
  { name: "Broadcast Media", id: "5567cd4773696439b10b000c" },
  { name: "Building Materials", id: "5567cd4773696439b10b000d" },
  { name: "Business Supplies and Equipment", id: "5567cd4773696439b10b000e" },
  { name: "Capital Markets", id: "5567cd4773696439b10b000f" },
  { name: "Chemicals", id: "5567cd4773696439b10b0010" },
  { name: "Civic & Social Organization", id: "5567cd4773696439b10b0011" },
  { name: "Civil Engineering", id: "5567cd4773696439b10b0012" },
  { name: "Commercial Real Estate", id: "5567cd4773696439b10b0013" },
  { name: "Computer & Network Security", id: "5567cd4773696439b10b0014" },
  { name: "Computer Games", id: "5567cd4773696439b10b0015" },
  { name: "Computer Hardware", id: "5567cd4773696439b10b0016" },
  { name: "Computer Networking", id: "5567cd4773696439b10b0017" },
  { name: "Computer Software", id: "5567cd4773696439b10b0018" },
  { name: "Construction", id: "5567cd4773696439b10b0019" },
  { name: "Consumer Electronics", id: "5567cd4773696439b10b001a" },
  { name: "Consumer Goods", id: "5567cd4773696439b10b001b" },
  { name: "Consumer Services", id: "5567cd4773696439b10b001c" },
  { name: "Cosmetics", id: "5567cd4773696439b10b001d" },
  { name: "Dairy", id: "5567cd4773696439b10b001e" },
  { name: "Defense & Space", id: "5567cd4773696439b10b001f" },
  { name: "Design", id: "5567cd4773696439b10b0020" },
  { name: "E-Learning", id: "5567cd4773696439b10b0021" },
  { name: "Education Management", id: "5567cd4773696439b10b0022" },
  { name: "Electrical/Electronic Manufacturing", id: "5567cd4773696439b10b0023" },
  { name: "Entertainment", id: "5567cd4773696439b10b0024" },
  { name: "Environmental Services", id: "5567cd4773696439b10b0025" },
  { name: "Events Services", id: "5567cd4773696439b10b0026" },
  { name: "Executive Office", id: "5567cd4773696439b10b0027" },
  { name: "Facilities Services", id: "5567cd4773696439b10b0028" },
  { name: "Farming", id: "5567cd4773696439b10b0029" },
  { name: "Financial Services", id: "5567cd4773696439b10b002a" },
  { name: "Fine Art", id: "5567cd4773696439b10b002b" },
  { name: "Fishery", id: "5567cd4773696439b10b002c" },
  { name: "Food & Beverages", id: "5567cd4773696439b10b002d" },
  { name: "Food Production", id: "5567cd4773696439b10b002e" },
  { name: "Fund-Raising", id: "5567cd4773696439b10b002f" },
  { name: "Furniture", id: "5567cd4773696439b10b0030" },
  { name: "Gambling & Casinos", id: "5567cd4773696439b10b0031" },
  { name: "Glass, Ceramics & Concrete", id: "5567cd4773696439b10b0032" },
  { name: "Government Administration", id: "5567cd4773696439b10b0033" },
  { name: "Government Relations", id: "5567cd4773696439b10b0034" },
  { name: "Graphic Design", id: "5567cd4773696439b10b0035" },
  { name: "Health, Wellness and Fitness", id: "5567cd4773696439b10b0036" },
  { name: "Higher Education", id: "5567cd4773696439b10b0037" },
  { name: "Hospital & Health Care", id: "5567cd4773696439b10b0038" },
  { name: "Hospitality", id: "5567cd4773696439b10b0039" },
  { name: "Human Resources", id: "5567cd4773696439b10b003a" },
  { name: "Import and Export", id: "5567cd4773696439b10b003b" },
  { name: "Individual & Family Services", id: "5567cd4773696439b10b003c" },
  { name: "Industrial Automation", id: "5567cd4773696439b10b003d" },
  { name: "Information Services", id: "5567cd4773696439b10b003e" },
  { name: "Information Technology and Services", id: "5567cd4773696439b10b003f" },
  { name: "Insurance", id: "5567cd4773696439b10b0040" },
  { name: "International Affairs", id: "5567cd4773696439b10b0041" },
  { name: "International Trade and Development", id: "5567cd4773696439b10b0042" },
  { name: "Internet", id: "5567cd4773696439b10b0043" },
  { name: "Investment Banking", id: "5567cd4773696439b10b0044" },
  { name: "Investment Management", id: "5567cd4773696439b10b0045" },
  { name: "Judiciary", id: "5567cd4773696439b10b0046" },
  { name: "Law Enforcement", id: "5567cd4773696439b10b0047" },
  { name: "Law Practice", id: "5567cd4773696439b10b0048" },
  { name: "Legal Services", id: "5567cd4773696439b10b0049" },
  { name: "Legislative Office", id: "5567cd4773696439b10b004a" },
  { name: "Leisure, Travel & Tourism", id: "5567cd4773696439b10b004b" },
  { name: "Libraries", id: "5567cd4773696439b10b004c" },
  { name: "Logistics and Supply Chain", id: "5567cd4773696439b10b004d" },
  { name: "Luxury Goods & Jewelry", id: "5567cd4773696439b10b004e" },
  { name: "Machinery", id: "5567cd4773696439b10b004f" },
  { name: "Management Consulting", id: "5567cd4773696439b10b0050" },
  { name: "Maritime", id: "5567cd4773696439b10b0051" },
  { name: "Market Research", id: "5567cd4773696439b10b0052" },
  { name: "Marketing and Advertising", id: "5567cd4773696439b10b0053" },
  { name: "Mechanical or Industrial Engineering", id: "5567cd4773696439b10b0054" },
  { name: "Media Production", id: "5567cd4773696439b10b0055" },
  { name: "Medical Devices", id: "5567cd4773696439b10b0056" },
  { name: "Medical Practice", id: "5567cd4773696439b10b0057" },
  { name: "Mental Health Care", id: "5567cd4773696439b10b0058" },
  { name: "Military", id: "5567cd4773696439b10b0059" },
  { name: "Mining & Metals", id: "5567cd4773696439b10b005a" },
  { name: "Motion Pictures and Film", id: "5567cd4773696439b10b005b" },
  { name: "Museums and Institutions", id: "5567cd4773696439b10b005c" },
  { name: "Music", id: "5567cd4773696439b10b005d" },
  { name: "Nanotechnology", id: "5567cd4773696439b10b005e" },
  { name: "Newspapers", id: "5567cd4773696439b10b005f" },
  { name: "Non-Profit Organization Management", id: "5567cd4773696439b10b0060" },
  { name: "Oil & Energy", id: "5567cd4773696439b10b0061" },
  { name: "Online Media", id: "5567cd4773696439b10b0062" },
  { name: "Outsourcing/Offshoring", id: "5567cd4773696439b10b0063" },
  { name: "Package/Freight Delivery", id: "5567cd4773696439b10b0064" },
  { name: "Packaging and Containers", id: "5567cd4773696439b10b0065" },
  { name: "Paper & Forest Products", id: "5567cd4773696439b10b0066" },
  { name: "Performing Arts", id: "5567cd4773696439b10b0067" },
  { name: "Pharmaceuticals", id: "5567cd4773696439b10b0068" },
  { name: "Philanthropy", id: "5567cd4773696439b10b0069" },
  { name: "Photography", id: "5567cd4773696439b10b006a" },
  { name: "Plastics", id: "5567cd4773696439b10b006b" },
  { name: "Political Organization", id: "5567cd4773696439b10b006c" },
  { name: "Primary/Secondary Education", id: "5567cd4773696439b10b006d" },
  { name: "Printing", id: "5567cd4773696439b10b006e" },
  { name: "Professional Training & Coaching", id: "5567cd4773696439b10b006f" },
  { name: "Program Development", id: "5567cd4773696439b10b0070" },
  { name: "Public Policy", id: "5567cd4773696439b10b0071" },
  { name: "Public Relations and Communications", id: "5567cd4773696439b10b0072" },
  { name: "Public Safety", id: "5567cd4773696439b10b0073" },
  { name: "Publishing", id: "5567cd4773696439b10b0074" },
  { name: "Railroad Manufacture", id: "5567cd4773696439b10b0075" },
  { name: "Ranching", id: "5567cd4773696439b10b0076" },
  { name: "Real Estate", id: "5567cd4773696439b10b0077" },
  { name: "Recreational Facilities and Services", id: "5567cd4773696439b10b0078" },
  { name: "Religious Institutions", id: "5567cd4773696439b10b0079" },
  { name: "Renewables & Environment", id: "5567cd4773696439b10b007a" },
  { name: "Research", id: "5567cd4773696439b10b007b" },
  { name: "Restaurants", id: "5567cd4773696439b10b007c" },
  { name: "Retail", id: "5567cd4773696439b10b007d" },
  { name: "Security and Investigations", id: "5567cd4773696439b10b007e" },
  { name: "Semiconductors", id: "5567cd4773696439b10b007f" },
  { name: "Shipbuilding", id: "5567cd4773696439b10b0080" },
  { name: "Sporting Goods", id: "5567cd4773696439b10b0081" },
  { name: "Sports", id: "5567cd4773696439b10b0082" },
  { name: "Staffing and Recruiting", id: "5567cd4773696439b10b0083" },
  { name: "Supermarkets", id: "5567cd4773696439b10b0084" },
  { name: "Telecommunications", id: "5567cd4773696439b10b0085" },
  { name: "Textiles", id: "5567cd4773696439b10b0086" },
  { name: "Think Tanks", id: "5567cd4773696439b10b0087" },
  { name: "Tobacco", id: "5567cd4773696439b10b0088" },
  { name: "Translation and Localization", id: "5567cd4773696439b10b0089" },
  { name: "Transportation/Trucking/Railroad", id: "5567cd4773696439b10b008a" },
  { name: "Utilities", id: "5567cd4773696439b10b008b" },
  { name: "Venture Capital & Private Equity", id: "5567cd4773696439b10b008c" },
  { name: "Veterinary", id: "5567cd4773696439b10b008d" },
  { name: "Warehousing", id: "5567cd4773696439b10b008e" },
  { name: "Wholesale", id: "5567cd4773696439b10b008f" },
  { name: "Wine and Spirits", id: "5567cd4773696439b10b0090" },
  { name: "Wireless", id: "5567cd4773696439b10b0091" },
  { name: "Writing and Editing", id: "5567cd4773696439b10b0092" }
];

const INDUSTRY_NAMES = APOLLO_INDUSTRIES.map(i => i.name).join(', ');

const COMPANY_SIZE_OPTIONS = [
  "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
  "501-1,000", "1,001-2,000", "2,001-5,000", "5,001-10,000", "10,001+"
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
  "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming"
];

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
    const { userId, authToken, action, userInput, currentStep, conversationHistory, existingICP, pendingICP } = JSON.parse(event.body);

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
    await logApiUsage(userId, 'barryICPConversation', 'success', {
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
    model: 'claude-sonnet-4-5-20250929',
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

  // Backend enforcement: targetTitles is required — never allow confirming without them
  const hasExtractedTitles = barryResponse.understood?.targetTitles && barryResponse.understood.targetTitles.length > 0;
  if (!hasExtractedTitles && !barryResponse.needsClarification) {
    barryResponse.needsClarification = true;
    barryResponse.followUpQuestion = barryResponse.followUpQuestion || 'Who should I be finding at these companies? What titles or roles are you going after?';
    barryResponse.followUpType = barryResponse.followUpType || 'titles';
  }

  // Determine next step based on whether we need lookalike
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike) {
    nextStep = 'awaiting_example';
  } else if (!barryResponse.needsClarification) {
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
  "readyToConfirm": true/false
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
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

  // Backend enforcement: targetTitles is required — never allow confirming without them
  const hasFollowupTitles = barryResponse.understood?.targetTitles && barryResponse.understood.targetTitles.length > 0;
  // Also check pending ICP in case titles were set in an earlier turn
  const hasPendingTitles = pendingICP?.targetTitles && pendingICP.targetTitles.length > 0;
  if (!hasFollowupTitles && !hasPendingTitles && barryResponse.readyToConfirm) {
    barryResponse.readyToConfirm = false;
    barryResponse.needsMoreInfo = true;
    barryResponse.followUpQuestion = barryResponse.followUpQuestion || 'Who should I be finding at these companies? What titles or roles are you going after?';
    barryResponse.followUpType = barryResponse.followUpType || 'titles';
  }

  // Determine next step
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike && !barryResponse.understood?.lookalikeSeed) {
    nextStep = 'awaiting_example';
  } else if (barryResponse.readyToConfirm) {
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
    model: 'claude-sonnet-4-5-20250929',
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

  // Backend enforcement: targetTitles is required — never allow confirming without them
  const hasExampleTitles = barryResponse.understood?.targetTitles && barryResponse.understood.targetTitles.length > 0;
  const hasPendingExTitles = pendingICP?.targetTitles && pendingICP.targetTitles.length > 0;
  if (!hasExampleTitles && !hasPendingExTitles && barryResponse.readyToConfirm) {
    barryResponse.readyToConfirm = false;
    barryResponse.needsMoreInfo = true;
    barryResponse.followUpQuestion = barryResponse.followUpQuestion || 'Who should I be finding at these companies? What titles or roles are you going after?';
    barryResponse.followUpType = barryResponse.followUpType || 'titles';
  }

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
    model: 'claude-sonnet-4-5-20250929',
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
