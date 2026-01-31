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

// HARDENING: Detect clearly unrelated input before calling Claude
function checkForUnrelatedInput(input) {
  if (!input || typeof input !== 'string') {
    return {
      understood: null,
      mappingExplanation: "I didn't catch that. Let's focus on who you sell to.",
      needsClarification: true,
      followUpQuestion: "Can you describe the types of companies you're targeting? For example: industry, company size, or location.",
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
      mappingExplanation: "I'm here to help define who you sell to so I can power Scout and Hunter effectively.",
      needsClarification: true,
      followUpQuestion: "Let's stay focused on your ideal customer. Can you describe the types of companies you sell to?",
      followUpType: "industry",
      confidenceScore: 0,
      isAmbiguous: true,
      ambiguityDetails: "Input was empty or contained only emojis."
    };
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
        mappingExplanation: "I'm here to help define who you sell to so I can power Scout and Hunter effectively.",
        needsClarification: true,
        followUpQuestion: "Let's stay focused on your ideal customer. Can you describe the types of companies you sell to? For example: 'Marketing agencies in California' or 'SaaS companies with 50-200 employees'.",
        followUpType: "industry",
        confidenceScore: 0,
        isAmbiguous: true,
        ambiguityDetails: "Input appears unrelated to ICP definition."
      };
    }
  }

  // Check for very short input that's likely not meaningful (less than 3 chars)
  if (trimmed.length < 3) {
    return {
      understood: null,
      mappingExplanation: "I need a bit more detail to understand your target market.",
      needsClarification: true,
      followUpQuestion: "Can you describe the types of companies you sell to? Include details like industry, company size, or geographic focus.",
      followUpType: "industry",
      confidenceScore: 0,
      isAmbiguous: true,
      ambiguityDetails: "Input too short to extract ICP information."
    };
  }

  // Input seems related - proceed to Claude
  return null;
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
    const { userId, authToken, action, userInput, currentStep, conversationHistory, existingICP } = JSON.parse(event.body);

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
      const redirectResponse = checkForUnrelatedInput(userInput);
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
        result = await processFollowup(anthropic, userInput, currentStep, conversationHistory);
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

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

async function processInitialInput(anthropic, userInput, existingICP) {
  const hasExistingICP = existingICP && existingICP.industries && existingICP.industries.length > 0;

  const prompt = `You are Barry, the intelligence layer for Idynify Scout. Your job is to understand who the user sells to and map it to our system.

You are NOT a chatbot. You are a senior sales ops partner - calm, direct, confident.

AVAILABLE INDUSTRIES (you MUST map to one or more of these exactly):
${INDUSTRY_NAMES}

AVAILABLE COMPANY SIZES:
${COMPANY_SIZE_OPTIONS.join(', ')}

US STATES (for location):
${US_STATES.join(', ')}

${hasExistingICP ? `
EXISTING ICP (user has already configured):
- Industries: ${existingICP.industries?.join(', ') || 'None'}
- Company Sizes: ${existingICP.companySizes?.join(', ') || 'None'}
- Locations: ${existingICP.isNationwide ? 'Nationwide' : existingICP.locations?.join(', ') || 'None'}
- Target Titles: ${existingICP.targetTitles?.join(', ') || 'None'}

Since the user already has an ICP, acknowledge it and ask if they want to confirm or refine it.
` : ''}

USER INPUT: "${userInput}"

YOUR TASK:
1. Extract what you can understand from the user's input
2. Map their description to EXACT industry names from the list above (be specific - if they say "marketing agencies", use "Marketing and Advertising")
3. Identify any ambiguity that needs clarification
4. Decide if you need follow-up questions

IMPORTANT RULES:
- If the input is ambiguous (e.g., "marketing agencies" could be broad), ask for clarification
- If you can't map to an industry, ask for clarification
- Maximum 3 follow-up questions total across the conversation
- Be direct, not verbose
- Show what you understood, then ask what's unclear

RESPOND IN JSON:
{
  "understood": {
    "industries": ["exact industry names from the list"],
    "companySizes": ["exact sizes from the list"] or null if not mentioned,
    "locations": ["state names"] or "nationwide" or null if not mentioned,
    "targetTitles": ["job titles"] or null if not mentioned,
    "rawInput": "what the user said"
  },
  "mappingExplanation": "I mapped 'X' to 'Y' because...",
  "needsClarification": true/false,
  "clarificationReason": "why you need more info" or null,
  "followUpQuestion": "your specific question" or null,
  "followUpType": "industry" | "size" | "location" | "titles" | null,
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

  return {
    barryResponse,
    step: barryResponse.needsClarification ? 'clarifying' : 'confirming'
  };
}

async function processFollowup(anthropic, userInput, currentStep, conversationHistory) {
  const historyContext = conversationHistory.map(h =>
    `${h.role === 'barry' ? 'Barry' : 'User'}: ${h.content}`
  ).join('\n');

  const prompt = `You are Barry, the intelligence layer for Idynify Scout.

CONVERSATION SO FAR:
${historyContext}

USER'S NEW INPUT: "${userInput}"

AVAILABLE INDUSTRIES:
${INDUSTRY_NAMES}

AVAILABLE COMPANY SIZES:
${COMPANY_SIZE_OPTIONS.join(', ')}

US STATES:
${US_STATES.join(', ')}

CURRENT STEP: ${currentStep}

YOUR TASK:
1. Incorporate the user's new information
2. Update your understanding
3. Decide if you have enough info or need ONE more clarification (max 3 total follow-ups)

RULES:
- Be direct and concise
- If you have enough info for a reasonable ICP, move to confirmation
- Don't over-question - good enough is good enough

RESPOND IN JSON:
{
  "understood": {
    "industries": ["exact industry names"],
    "companySizes": ["exact sizes"] or null,
    "locations": ["states"] or "nationwide" or null,
    "targetTitles": ["titles"] or null
  },
  "mappingExplanation": "explanation of your mapping",
  "needsMoreInfo": true/false,
  "followUpQuestion": "question" or null,
  "followUpType": "industry" | "size" | "location" | "titles" | null,
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
3. Can be used to explain the ICP to the user for confirmation

RESPOND IN JSON:
{
  "summary": "Your 2-3 sentence summary",
  "bulletPoints": [
    "Industry: X",
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
