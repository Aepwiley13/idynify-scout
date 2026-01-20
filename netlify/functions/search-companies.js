import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

// Apollo industry mapping helpers (copied to avoid import issues)
// Full list of 150+ Apollo industry tag IDs
const APOLLO_INDUSTRIES = {
  "Accounting": "5567cd4773696439b10b0000",
  "Airlines/Aviation": "5567cd4773696439b10b0001",
  "Alternative Dispute Resolution": "5567cd4773696439b10b0002",
  "Alternative Medicine": "5567cd4773696439b10b0003",
  "Animation": "5567cd4773696439b10b0004",
  "Apparel & Fashion": "5567cd4773696439b10b0005",
  "Architecture & Planning": "5567cd4773696439b10b0006",
  "Arts and Crafts": "5567cd4773696439b10b0007",
  "Automotive": "5567cd4773696439b10b0008",
  "Aviation & Aerospace": "5567cd4773696439b10b0009",
  "Banking": "5567cd4773696439b10b000a",
  "Biotechnology": "5567cd4773696439b10b000b",
  "Broadcast Media": "5567cd4773696439b10b000c",
  "Building Materials": "5567cd4773696439b10b000d",
  "Business Supplies and Equipment": "5567cd4773696439b10b000e",
  "Capital Markets": "5567cd4773696439b10b000f",
  "Chemicals": "5567cd4773696439b10b0010",
  "Civic & Social Organization": "5567cd4773696439b10b0011",
  "Civil Engineering": "5567cd4773696439b10b0012",
  "Commercial Real Estate": "5567cd4773696439b10b0013",
  "Computer & Network Security": "5567cd4773696439b10b0014",
  "Computer Games": "5567cd4773696439b10b0015",
  "Computer Hardware": "5567cd4773696439b10b0016",
  "Computer Networking": "5567cd4773696439b10b0017",
  "Computer Software": "5567cd4773696439b10b0018",
  "Construction": "5567cd4773696439b10b0019",
  "Consumer Electronics": "5567cd4773696439b10b001a",
  "Consumer Goods": "5567cd4773696439b10b001b",
  "Consumer Services": "5567cd4773696439b10b001c",
  "Cosmetics": "5567cd4773696439b10b001d",
  "Dairy": "5567cd4773696439b10b001e",
  "Defense & Space": "5567cd4773696439b10b001f",
  "Design": "5567cd4773696439b10b0020",
  "E-Learning": "5567cd4773696439b10b0021",
  "Education Management": "5567cd4773696439b10b0022",
  "Electrical/Electronic Manufacturing": "5567cd4773696439b10b0023",
  "Entertainment": "5567cd4773696439b10b0024",
  "Environmental Services": "5567cd4773696439b10b0025",
  "Events Services": "5567cd4773696439b10b0026",
  "Executive Office": "5567cd4773696439b10b0027",
  "Facilities Services": "5567cd4773696439b10b0028",
  "Farming": "5567cd4773696439b10b0029",
  "Financial Services": "5567cd4773696439b10b002a",
  "Fine Art": "5567cd4773696439b10b002b",
  "Fishery": "5567cd4773696439b10b002c",
  "Food & Beverages": "5567cd4773696439b10b002d",
  "Food Production": "5567cd4773696439b10b002e",
  "Fund-Raising": "5567cd4773696439b10b002f",
  "Furniture": "5567cd4773696439b10b0030",
  "Gambling & Casinos": "5567cd4773696439b10b0031",
  "Glass, Ceramics & Concrete": "5567cd4773696439b10b0032",
  "Government Administration": "5567cd4773696439b10b0033",
  "Government Relations": "5567cd4773696439b10b0034",
  "Graphic Design": "5567cd4773696439b10b0035",
  "Health, Wellness and Fitness": "5567cd4773696439b10b0036",
  "Higher Education": "5567cd4773696439b10b0037",
  "Hospital & Health Care": "5567cd4773696439b10b0038",
  "Hospitality": "5567cd4773696439b10b0039",
  "Human Resources": "5567cd4773696439b10b003a",
  "Import and Export": "5567cd4773696439b10b003b",
  "Individual & Family Services": "5567cd4773696439b10b003c",
  "Industrial Automation": "5567cd4773696439b10b003d",
  "Information Services": "5567cd4773696439b10b003e",
  "Information Technology and Services": "5567cd4773696439b10b003f",
  "Insurance": "5567cd4773696439b10b0040",
  "International Affairs": "5567cd4773696439b10b0041",
  "International Trade and Development": "5567cd4773696439b10b0042",
  "Internet": "5567cd4773696439b10b0043",
  "Investment Banking": "5567cd4773696439b10b0044",
  "Investment Management": "5567cd4773696439b10b0045",
  "Judiciary": "5567cd4773696439b10b0046",
  "Law Enforcement": "5567cd4773696439b10b0047",
  "Law Practice": "5567cd4773696439b10b0048",
  "Legal Services": "5567cd4773696439b10b0049",
  "Legislative Office": "5567cd4773696439b10b004a",
  "Leisure, Travel & Tourism": "5567cd4773696439b10b004b",
  "Libraries": "5567cd4773696439b10b004c",
  "Logistics and Supply Chain": "5567cd4773696439b10b004d",
  "Luxury Goods & Jewelry": "5567cd4773696439b10b004e",
  "Machinery": "5567cd4773696439b10b004f",
  "Management Consulting": "5567cd4773696439b10b0050",
  "Maritime": "5567cd4773696439b10b0051",
  "Market Research": "5567cd4773696439b10b0052",
  "Marketing and Advertising": "5567cd4773696439b10b0053",
  "Mechanical or Industrial Engineering": "5567cd4773696439b10b0054",
  "Media Production": "5567cd4773696439b10b0055",
  "Medical Devices": "5567cd4773696439b10b0056",
  "Medical Practice": "5567cd4773696439b10b0057",
  "Mental Health Care": "5567cd4773696439b10b0058",
  "Military": "5567cd4773696439b10b0059",
  "Mining & Metals": "5567cd4773696439b10b005a",
  "Motion Pictures and Film": "5567cd4773696439b10b005b",
  "Museums and Institutions": "5567cd4773696439b10b005c",
  "Music": "5567cd4773696439b10b005d",
  "Nanotechnology": "5567cd4773696439b10b005e",
  "Newspapers": "5567cd4773696439b10b005f",
  "Non-Profit Organization Management": "5567cd4773696439b10b0060",
  "Oil & Energy": "5567cd4773696439b10b0061",
  "Online Media": "5567cd4773696439b10b0062",
  "Outsourcing/Offshoring": "5567cd4773696439b10b0063",
  "Package/Freight Delivery": "5567cd4773696439b10b0064",
  "Packaging and Containers": "5567cd4773696439b10b0065",
  "Paper & Forest Products": "5567cd4773696439b10b0066",
  "Performing Arts": "5567cd4773696439b10b0067",
  "Pharmaceuticals": "5567cd4773696439b10b0068",
  "Philanthropy": "5567cd4773696439b10b0069",
  "Photography": "5567cd4773696439b10b006a",
  "Plastics": "5567cd4773696439b10b006b",
  "Political Organization": "5567cd4773696439b10b006c",
  "Primary/Secondary Education": "5567cd4773696439b10b006d",
  "Printing": "5567cd4773696439b10b006e",
  "Professional Training & Coaching": "5567cd4773696439b10b006f",
  "Program Development": "5567cd4773696439b10b0070",
  "Public Policy": "5567cd4773696439b10b0071",
  "Public Relations and Communications": "5567cd4773696439b10b0072",
  "Public Safety": "5567cd4773696439b10b0073",
  "Publishing": "5567cd4773696439b10b0074",
  "Railroad Manufacture": "5567cd4773696439b10b0075",
  "Ranching": "5567cd4773696439b10b0076",
  "Real Estate": "5567cd4773696439b10b0077",
  "Recreational Facilities and Services": "5567cd4773696439b10b0078",
  "Religious Institutions": "5567cd4773696439b10b0079",
  "Renewables & Environment": "5567cd4773696439b10b007a",
  "Research": "5567cd4773696439b10b007b",
  "Restaurants": "5567cd4773696439b10b007c",
  "Retail": "5567cd4773696439b10b007d",
  "Security and Investigations": "5567cd4773696439b10b007e",
  "Semiconductors": "5567cd4773696439b10b007f",
  "Shipbuilding": "5567cd4773696439b10b0080",
  "Sporting Goods": "5567cd4773696439b10b0081",
  "Sports": "5567cd4773696439b10b0082",
  "Staffing and Recruiting": "5567cd4773696439b10b0083",
  "Supermarkets": "5567cd4773696439b10b0084",
  "Telecommunications": "5567cd4773696439b10b0085",
  "Textiles": "5567cd4773696439b10b0086",
  "Think Tanks": "5567cd4773696439b10b0087",
  "Tobacco": "5567cd4773696439b10b0088",
  "Translation and Localization": "5567cd4773696439b10b0089",
  "Transportation/Trucking/Railroad": "5567cd4773696439b10b008a",
  "Utilities": "5567cd4773696439b10b008b",
  "Venture Capital & Private Equity": "5567cd4773696439b10b008c",
  "Veterinary": "5567cd4773696439b10b008d",
  "Warehousing": "5567cd4773696439b10b008e",
  "Wholesale": "5567cd4773696439b10b008f",
  "Wine and Spirits": "5567cd4773696439b10b0090",
  "Wireless": "5567cd4773696439b10b0091",
  "Writing and Editing": "5567cd4773696439b10b0092"
};

function getIndustryIds(industryNames) {
  console.log('\n🔍 Industry ID Mapping:');
  const ids = industryNames.map(name => {
    const id = APOLLO_INDUSTRIES[name];
    console.log(`  "${name}" -> ${id || 'NOT FOUND'}`);
    if (!id) {
      console.error(`  ❌ WARNING: Industry "${name}" not found in APOLLO_INDUSTRIES mapping!`);
    }
    return id;
  }).filter(id => id !== undefined);

  if (ids.length === 0 && industryNames.length > 0) {
    console.error('❌ CRITICAL: No valid industry IDs mapped! This will return companies from ALL industries!');
  }

  return ids;
}

function formatStatesForApollo(states) {
  return states.map(state => `${state}, United States`);
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
    const { userId, authToken, companyProfile } = JSON.parse(event.body);

    if (!userId || !authToken || !companyProfile) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 Starting Apollo company search for user:', userId);
    console.log('📋 Company profile:', JSON.stringify(companyProfile, null, 2));

    // Get Apollo API key (throws if not configured)
    const apolloApiKey = getApolloApiKey();

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured in environment');
      throw new Error('Firebase API key not configured. Please contact support.');
    }

    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      console.error('❌ FIREBASE_PROJECT_ID not configured in environment');
      throw new Error('Firebase Project ID not configured. Please contact support.');
    }

    console.log('✅ All environment variables validated');

    // Verify Firebase Auth token
    const apiKey = firebaseApiKey;
    if (!apiKey) {
      throw new Error('Firebase API key not configured');
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
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

    console.log('✅ Auth token verified');

    // Map company profile to Apollo API format
    const apolloQuery = buildApolloQuery(companyProfile);

    console.log('📊 Search query:', JSON.stringify(apolloQuery, null, 2));
    console.log('🔍 Industry filter check:');
    console.log(`   - Requested industries: ${JSON.stringify(companyProfile.industries)}`);
    console.log(`   - Keyword search: ${JSON.stringify(apolloQuery.q_organization_keyword_tags || 'NONE')}`);

    // Validate query parameters before sending
    console.log('🔍 Validating request parameters...');
    console.log('   - Industries count:', apolloQuery.organization_industry_tag_ids?.length || 0);
    console.log('   - Employee range valid:', !!apolloQuery.organization_num_employees_ranges);
    console.log('   - Keywords:', apolloQuery.q_organization_keyword_tags);
    console.log('   - Per page:', apolloQuery.per_page);

    if (!apolloQuery.organization_industry_tag_ids || apolloQuery.organization_industry_tag_ids.length === 0) {
      console.warn('⚠️  No industry filters provided - search may return broad results');
    }

    if (!apolloQuery.per_page || apolloQuery.per_page < 1) {
      console.error('❌ Invalid per_page value:', apolloQuery.per_page);
      throw new Error('Invalid search parameters - please contact support');
    }

    // Call external company search API
    const apolloResponse = await fetch(APOLLO_ENDPOINTS.COMPANIES_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(apolloQuery)
    });

    if (!apolloResponse.ok) {
      // Log detailed error for server-side debugging
      const errorText = await logApolloError(apolloResponse, apolloQuery, 'search-companies');
      console.error('External API request failed:', apolloResponse.status);
      console.error('Error details logged above');

      // Return user-friendly error messages based on status
      let userMessage = 'Company search service is temporarily unavailable. Please try again later.';

      if (apolloResponse.status === 422) {
        console.error('❌ VALIDATION ERROR: Invalid search parameters detected');
        console.error('   This usually means empty or malformed query data');
        userMessage = 'Invalid search criteria. Please check your company profile settings and try again, or contact support if this persists.';
      } else if (apolloResponse.status === 429) {
        userMessage = 'Search service rate limit exceeded. Please try again in a few minutes.';
      } else if (apolloResponse.status === 401 || apolloResponse.status === 403) {
        userMessage = 'Search service authentication error. Please contact support.';
      } else if (apolloResponse.status >= 500) {
        userMessage = 'Search service is experiencing issues. Please try again later.';
      }

      throw new Error(userMessage);
    }

    const apolloData = await apolloResponse.json();
    let companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} companies from external API`);

    // Log first 3 companies details for debugging
    if (companies.length > 0) {
      console.log('\n📊 Sample companies returned:');
      console.log('\n🔍 First company RAW DATA:');
      console.log(JSON.stringify(companies[0], null, 2));

      companies.slice(0, 3).forEach((company, index) => {
        console.log(`\n  Company ${index + 1}:`);
        console.log(`    - Name: ${company.name}`);
        console.log(`    - Industry: ${company.industry || company.primary_industry || 'N/A'}`);
        console.log(`    - Employees: ${company.estimated_num_employees || 'N/A'}`);
        console.log(`    - Location: ${JSON.stringify(company.headquarters_location || company.primary_location || 'N/A')}`);
        console.log(`    - Available keys: ${Object.keys(company).slice(0, 20).join(', ')}`);
      });
      console.log('\n');
    }

    // VALIDATION: Filter companies to ensure they match requested industries
    // External API sometimes returns companies that don't match the filter
    const requestedIndustries = companyProfile.industries || [];
    const debugInfo = {
      apolloReturned: companies.length,
      requestedIndustries: requestedIndustries,
      sampleIndustriesReturned: companies.slice(0, 10).map(c => ({
        name: c.name,
        industry: c.industry || c.primary_industry || 'N/A'
      }))
    };

    // TEMPORARILY DISABLED - External API is not returning industry field reliably
    // Need to investigate raw response structure first
    console.log('⚠️  INDUSTRY VALIDATION TEMPORARILY DISABLED');
    console.log('⚠️  All companies from Apollo will be saved regardless of industry');
    console.log('⚠️  This is to debug why Apollo returns industry: N/A for all companies');

    /* DISABLED - RE-ENABLE AFTER FIXING APOLLO INDUSTRY FIELD
    if (requestedIndustries.length > 0) {
      console.log(`🔍 Validating companies match requested industries: ${requestedIndustries.join(', ')}`);

      const beforeCount = companies.length;
      const filteredCompanies = companies.filter(company => {
        const companyIndustry = company.industry || company.primary_industry || '';
        const matches = requestedIndustries.includes(companyIndustry);

        if (!matches) {
          console.log(`  ❌ Filtering out ${company.name} - Industry: "${companyIndustry}" (not in requested list)`);
        }

        return matches;
      });

      console.log(`✅ Validation complete: ${filteredCompanies.length}/${beforeCount} companies match requested industries`);

      debugInfo.afterValidation = filteredCompanies.length;

      if (filteredCompanies.length === 0) {
        console.error('❌ CRITICAL: No companies match requested industries after filtering!');
        console.error('This likely means Apollo is ignoring the industry filter.');
        console.error('Check the Apollo query and industry IDs above.');
        console.error('Debug info:', JSON.stringify(debugInfo, null, 2));
      }

      companies = filteredCompanies;
    }
    */

    // Top-off model: Only add companies if queue needs refilling
    const pendingCount = await countPendingCompanies(userId, authToken);
    const TARGET_QUEUE_SIZE = 50;

    console.log(`📊 Current pending companies: ${pendingCount}`);

    if (pendingCount >= TARGET_QUEUE_SIZE) {
      console.log(`✅ Queue is full (${pendingCount}/${TARGET_QUEUE_SIZE}). No new companies needed.`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          success: true,
          companiesFound: 0,
          companiesAdded: 0,
          currentQueueSize: pendingCount,
          message: `Queue is full with ${pendingCount} pending companies. No new companies added.`,
          generationTime: (Date.now() - startTime) / 1000
        })
      };
    }

    // Get existing company IDs to prevent duplicates
    const existingCompanyIds = await getExistingCompanyIds(userId, authToken);

    // Filter out companies that already exist
    const newCompanies = companies.filter(c => !existingCompanyIds.has(String(c.id)));

    console.log(`📊 Filtered ${companies.length} companies → ${newCompanies.length} new (removed ${companies.length - newCompanies.length} duplicates)`);

    // Calculate how many we need to add
    const needed = TARGET_QUEUE_SIZE - pendingCount;
    const toAdd = newCompanies.slice(0, needed);

    console.log(`📊 Adding ${toAdd.length} companies to reach target of ${TARGET_QUEUE_SIZE}`);

    // Save companies to Firestore
    await saveCompaniesToFirestore(userId, authToken, toAdd, companyProfile);

    const responseTime = Date.now() - startTime;

    // Log API usage for admin tracking
    await logApiUsage(userId, 'searchCompanies', 'success', {
      responseTime,
      metadata: {
        companiesFound: companies.length,
        companiesAdded: toAdd.length
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: true,
        companiesFound: companies.length,
        companiesAdded: toAdd.length,
        currentQueueSize: pendingCount + toAdd.length,
        generationTime,
        message: `Added ${toAdd.length} companies to queue (now ${pendingCount + toAdd.length}/${TARGET_QUEUE_SIZE})`,
        debug: companies.length === 0 ? {
          apolloQuery: apolloQuery,
          apolloReturnedCount: debugInfo?.apolloReturned || 0,
          requestedIndustries: debugInfo?.requestedIndustries || [],
          sampleIndustriesFromApollo: debugInfo?.sampleIndustriesReturned || []
        } : undefined
      })
    };

  } catch (error) {
    console.error('💥 Error in search-companies:', error);

    // Log failed API usage (extract userId from body if available)
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'searchCompanies', 'error', {
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

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
        generationTime
      })
    };
  }
};

function buildApolloQuery(companyProfile) {
  console.log('📋 Building Apollo query from profile:', JSON.stringify(companyProfile, null, 2));

  const query = {
    page: 1,
    per_page: 50
  };

  // FIXED: Use keyword search instead of industry tag IDs
  // Industry tag IDs don't work - Apollo ignores them
  // Keyword search is more reliable
  if (companyProfile.industries && companyProfile.industries.length > 0) {
    // Convert industry names to lowercase keywords for search
    query.q_organization_keyword_tags = companyProfile.industries.map(i => i.toLowerCase());
    console.log(`🏭 Industries selected: ${companyProfile.industries.join(', ')}`);
    console.log(`🏭 Using keyword search: ${query.q_organization_keyword_tags.join(', ')}`);
  } else {
    console.log('⚠️  No industries selected!');
  }

  // Map company sizes to Apollo format (comma-separated strings)
  if (companyProfile.companySizes && companyProfile.companySizes.length > 0) {
    query.organization_num_employees_ranges = companyProfile.companySizes.map(size => {
      // Convert "51-100" to "51,100" for Apollo
      if (size.includes('+')) {
        // "10,001+" becomes "10001,999999"
        const min = size.replace(/[,+]/g, '');
        return `${min},999999`;
      }
      // "1,001-2,000" becomes "1001,2000"
      // First remove any existing commas, then split by dash
      const cleaned = size.replace(/,/g, '');
      return cleaned.replace('-', ',');
    });
    console.log(`👥 Company sizes selected: ${companyProfile.companySizes.join(', ')}`);
    console.log(`👥 Mapped to Apollo format: ${query.organization_num_employees_ranges.join(', ')}`);
  } else {
    console.log('⚠️  No company sizes selected!');
  }

  // Map revenue ranges to Apollo format (single min/max object)
  // TEMPORARILY DISABLED TO DEBUG - Apollo keeps rejecting with "Invalid parameters"
  // if (companyProfile.revenueRanges && companyProfile.revenueRanges.length > 0 && !companyProfile.skipRevenue) {
  //   const allRanges = companyProfile.revenueRanges.map(range => convertRevenueToNumeric(range));
  //   const minRevenue = Math.min(...allRanges.map(r => r[0]));
  //   const maxRevenue = Math.max(...allRanges.map(r => r[1]));
  //   query.revenue_range = {
  //     min: minRevenue,
  //     max: maxRevenue
  //   };
  // }

  // Map locations to Apollo format
  if (companyProfile.locations && companyProfile.locations.length > 0) {
    query.organization_locations = formatStatesForApollo(companyProfile.locations);
    console.log(`📍 Locations selected: ${companyProfile.locations.join(', ')}`);
    console.log(`📍 Mapped to Apollo format: ${query.organization_locations.join(', ')}`);
  } else if (companyProfile.isNationwide) {
    console.log('🌎 Nationwide search enabled');
  } else {
    console.log('⚠️  No locations selected and not nationwide!');
  }

  return query;
}

function convertRevenueToNumeric(revenueRange) {
  const mapping = {
    "Less than $1M": [0, 1000000],
    "$1M-$2M": [1000000, 2000000],
    "$2M-$5M": [2000000, 5000000],
    "$5M-$10M": [5000000, 10000000],
    "$10M-$20M": [10000000, 20000000],
    "$20M-$50M": [20000000, 50000000],
    "$50M-$100M": [50000000, 100000000],
    "$100M-$200M": [100000000, 200000000],
    "$200M-$500M": [200000000, 500000000],
    "$500M-$1B": [500000000, 1000000000],
    "$1B+": [1000000000, 999999999999]
  };

  return mapping[revenueRange] || [0, 999999999999];
}

/**
 * Count pending companies in the queue
 */
async function countPendingCompanies(userId, authToken) {
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    if (!projectId) {
      console.error('❌ Firebase Project ID not configured');
      return 0;
    }

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const queryBody = {
      structuredQuery: {
        from: [{
          collectionId: 'companies'
        }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'pending' }
          }
        }
      }
    };

    const queryResponse = await fetch(`${firestoreUrl}/users/${userId}:runQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(queryBody)
    });

    if (!queryResponse.ok) {
      console.error(`❌ Failed to query pending companies`);
      return 0;
    }

    const queryResults = await queryResponse.json();

    const count = queryResults.filter(result => result.document).length;

    return count;

  } catch (error) {
    console.error('❌ Error counting pending companies:', error);
    return 0;
  }
}

/**
 * Get all existing company IDs to prevent duplicates
 */
async function getExistingCompanyIds(userId, authToken) {
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    if (!projectId) {
      return new Set();
    }

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const queryBody = {
      structuredQuery: {
        from: [{
          collectionId: 'companies'
        }],
        select: {
          fields: [{ fieldPath: 'apollo_organization_id' }]
        }
      }
    };

    const queryResponse = await fetch(`${firestoreUrl}/users/${userId}:runQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(queryBody)
    });

    if (!queryResponse.ok) {
      console.error(`❌ Failed to query existing companies`);
      return new Set();
    }

    const queryResults = await queryResponse.json();

    const ids = queryResults
      .filter(result => result.document)
      .map(result => result.document.fields?.apollo_organization_id?.stringValue)
      .filter(id => id);

    return new Set(ids);

  } catch (error) {
    console.error('❌ Error getting existing company IDs:', error);
    return new Set();
  }
}

async function saveCompaniesToFirestore(userId, authToken, companies, companyProfile) {
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    if (!projectId) {
      console.error('❌ Firebase Project ID not configured');
      throw new Error('Firebase Project ID not configured');
    }

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    console.log(`📦 Processing ${companies.length} companies from Apollo...`);

    // SIMPLIFIED: Accept ALL companies - no filtering or complex scoring
    // Scout's job is discovery, not scoring. User decides fit via swipes.
    const simplifiedCompanies = companies.map((company, index) => {
      // Extract available data from Apollo
      // NOTE: Apollo search endpoint doesn't return employee_count or headquarters_location
      // We use the data that IS available: revenue, founded_year, phone, etc.
      const revenue = company.organization_revenue_printed ||
                     (company.organization_revenue ? `$${(company.organization_revenue / 1000000).toFixed(1)}M` : null);
      const foundedYear = company.founded_year || null;
      const phone = company.phone || null;

      // Debug logging for first company
      if (index === 0) {
        console.log('\n📊 First company data extraction (using available fields):');
        console.log(`  Name: ${company.name}`);
        console.log(`  Revenue: ${revenue}`);
        console.log(`  Founded: ${foundedYear}`);
        console.log(`  Phone: ${phone}`);
        console.log(`  Website: ${company.website_url || company.primary_domain}`);
        console.log(`  LinkedIn: ${company.linkedin_url}`);
        console.log(`  ⚠️  NOTE: Apollo search endpoint does NOT return employee_count or location`);
      }

      return {
        // IDs
        apollo_organization_id: company.id,

        // Basic Info (what Scout displays)
        name: company.name || 'Unknown Company',
        industry: companyProfile.industries?.[0] || 'Accounting', // Use selected industry

        // Use revenue and founded year (Apollo DOES return these)
        revenue: revenue,
        founded_year: foundedYear,
        phone: phone,

        // Links (critical for user research)
        website_url: company.website_url || (company.primary_domain ? `https://${company.primary_domain}` : null),
        linkedin_url: company.linkedin_url || null,

        // Metadata
        found_at: new Date().toISOString(),
        source: 'apollo_api',

        // User Actions
        status: 'pending' // pending | accepted | rejected
      };
    });

    console.log(`✅ Accepting ALL ${simplifiedCompanies.length} companies (no filtering)`);
    console.log(`📊 Scout shows total market size, user decides fit via swipes`);

    // Save to Firestore - ALL companies, no sorting needed
    for (const company of simplifiedCompanies) {
      const companyId = company.apollo_organization_id || `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const companyData = {
        fields: {
          apollo_organization_id: { stringValue: String(company.apollo_organization_id) },
          name: { stringValue: String(company.name) },
          industry: { stringValue: String(company.industry) },
          revenue: { stringValue: String(company.revenue || '') },
          founded_year: { integerValue: String(company.founded_year || 0) },
          phone: { stringValue: String(company.phone || '') },
          linkedin_url: { stringValue: String(company.linkedin_url || '') },
          website_url: { stringValue: String(company.website_url || '') },
          status: { stringValue: 'pending' },
          found_at: { timestampValue: company.found_at },
          source: { stringValue: 'apollo_api' }
        }
      };

      // Save to Firestore using REST API
      const docUrl = `${firestoreUrl}/users/${userId}/companies/${companyId}`;

      const saveResponse = await fetch(docUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(companyData)
      });

      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error(`❌ Failed to save company ${company.name}:`, errorText);
      }
    }

    console.log(`✅ Saved ${simplifiedCompanies.length} companies to Firestore`);

  } catch (error) {
    console.error('❌ Error saving companies to Firestore:', error);
    // Throw error so user knows companies weren't saved
    throw error;
  }
}

/**
 * Extract simple location string from Apollo company object
 */
function extractSimpleLocation(company) {
  // Try headquarters_location first
  if (company.headquarters_location) {
    if (typeof company.headquarters_location === 'object') {
      const { city, state } = company.headquarters_location;
      if (city && state) return `${city}, ${state}`;
      if (state) return `${state}, USA`;
    }
    if (typeof company.headquarters_location === 'string') {
      return company.headquarters_location;
    }
  }

  // Try primary_location
  if (company.primary_location?.state) {
    return `${company.primary_location.state}, USA`;
  }

  // Try organization_locations array
  if (company.organization_locations && company.organization_locations.length > 0) {
    return company.organization_locations[0];
  }

  return 'Location not available';
}

/**
 * DEPRECATED - OLD COMPLEX ENRICHMENT (NOT USED ANYMORE)
 * Kept for reference only - Scout now uses simplified approach
 */
function enrichCompanyData(company, companyProfile) {
  // Extract and format employee count
  const employeeCount = company.estimated_num_employees ||
                       extractMidpoint(company.organization_num_employees_ranges) ||
                       0;

  // Extract industry with fallbacks
  const industry = company.industry ||
                  company.primary_industry ||
                  'Unknown Industry';

  // Extract location with multiple fallbacks
  const location = extractLocation(company);

  // Format revenue range
  const revenueRange = formatRevenueRange(company.revenue_range);

  // Calculate company age
  const foundedYear = company.founded_year || null;
  const companyAge = foundedYear ? new Date().getFullYear() - foundedYear : 0;

  // Calculate fit score
  const fitScore = calculateFitScore(company, companyProfile);

  // Generate fit reasons
  const fitReasons = generateFitReasons(company, companyProfile, fitScore);

  return {
    apollo_organization_id: company.id,
    name: company.name || 'Unknown Company',
    domain: company.website_url || company.primary_domain || null,
    industry: industry,
    employee_count: employeeCount,
    employee_range: formatEmployeeRange(employeeCount),
    revenue_range: revenueRange,
    headquarters_location: location,
    linkedin_url: company.linkedin_url || null,
    website_url: company.website_url || null,
    phone: company.phone || null,
    founded_year: foundedYear,
    company_age_years: companyAge,
    fit_score: fitScore,
    fit_reasons: fitReasons,
    status: 'pending'
  };
}

/**
 * Validate company data before saving
 */
function validateCompanyData(company) {
  // Require minimum fit score of 50%
  if (company.fit_score < 50) {
    console.log(`⚠️  Filtering out ${company.name}: Low fit score (${company.fit_score}%)`);
    return false;
  }

  // Require at least name and one other key field
  const hasName = company.name && company.name !== 'Unknown Company';
  const hasIndustry = company.industry && company.industry !== 'Unknown Industry';
  const hasLocation = company.headquarters_location && company.headquarters_location !== 'Unknown';

  if (!hasName) {
    console.log(`⚠️  Filtering out company: No name`);
    return false;
  }

  // Reject if both industry and location are unknown
  if (!hasIndustry && !hasLocation) {
    console.log(`⚠️  Filtering out ${company.name}: Missing industry AND location`);
    return false;
  }

  return true;
}

/**
 * Extract location from Apollo response with fallbacks
 */
function extractLocation(company) {
  // Try headquarters_location first
  if (company.headquarters_location) {
    if (typeof company.headquarters_location === 'object') {
      const { city, state, country } = company.headquarters_location;
      if (city && state) return `${city}, ${state}`;
      if (state) return `${state}, USA`;
      if (country) return country;
    }
    if (typeof company.headquarters_location === 'string') {
      return company.headquarters_location;
    }
  }

  // Try primary_location
  if (company.primary_location) {
    if (typeof company.primary_location === 'object') {
      const { city, state, country } = company.primary_location;
      if (city && state) return `${city}, ${state}`;
      if (state) return `${state}, USA`;
      if (country) return country;
    }
  }

  // Try organization_locations array
  if (company.organization_locations && company.organization_locations.length > 0) {
    return company.organization_locations[0];
  }

  return 'Unknown';
}

/**
 * Extract midpoint from employee range string
 */
function extractMidpoint(rangeString) {
  if (!rangeString) return null;

  // Handle "51,100" format
  if (typeof rangeString === 'string' && rangeString.includes(',')) {
    const [min, max] = rangeString.split(',').map(n => parseInt(n));
    return Math.floor((min + max) / 2);
  }

  return null;
}

/**
 * Format employee count to range string
 */
function formatEmployeeRange(count) {
  if (!count || count === 0) return 'Unknown Size';
  if (count <= 10) return '1-10 employees';
  if (count <= 20) return '11-20 employees';
  if (count <= 50) return '21-50 employees';
  if (count <= 100) return '51-100 employees';
  if (count <= 200) return '101-200 employees';
  if (count <= 500) return '201-500 employees';
  if (count <= 1000) return '501-1,000 employees';
  if (count <= 2000) return '1,001-2,000 employees';
  if (count <= 5000) return '2,001-5,000 employees';
  if (count <= 10000) return '5,001-10,000 employees';
  return '10,001+ employees';
}

/**
 * Generate human-readable fit reasons
 */
function generateFitReasons(company, companyProfile, fitScore) {
  const reasons = [];

  // Industry match
  if (companyProfile.industries.includes(company.industry)) {
    reasons.push(`✓ Industry match: ${company.industry}`);
  }

  // Size match
  const employeeCount = company.estimated_num_employees || extractMidpoint(company.organization_num_employees_ranges);
  if (employeeCount && isWithinSizeRange(employeeCount, companyProfile.companySizes)) {
    reasons.push(`✓ Size match: ${formatEmployeeRange(employeeCount)}`);
  }

  // Location match
  const location = extractLocation(company);
  const state = extractStateFromLocation(location);
  if (state && (companyProfile.isNationwide || companyProfile.locations.includes(state))) {
    reasons.push(`✓ Location: ${state} (your target)`);
  }

  // Add at least one reason if fit score is decent
  if (reasons.length === 0 && fitScore >= 50) {
    reasons.push(`✓ Good match for your criteria (${fitScore}% fit)`);
  }

  return reasons;
}

/**
 * Check if employee count is within ICP size ranges
 */
function isWithinSizeRange(employeeCount, icpSizes) {
  if (!employeeCount || !icpSizes || icpSizes.length === 0) return false;

  return icpSizes.some(range => {
    // Handle "10,001+" format
    if (range.includes('+')) {
      const min = parseInt(range.replace(/[,+]/g, ''));
      return employeeCount >= min;
    }

    // Handle "51-100" format
    const cleaned = range.replace(/,/g, '');
    const [min, max] = cleaned.split('-').map(n => parseInt(n));
    return employeeCount >= min && employeeCount <= max;
  });
}

/**
 * Extract state from location string
 */
function extractStateFromLocation(location) {
  if (!location || location === 'Unknown') return null;

  // Handle "City, State" or "State, Country" format
  const parts = location.split(',').map(s => s.trim());

  // If we have "City, State" or "State, USA"
  if (parts.length >= 2) {
    // Check if second part is USA/United States, return first part
    if (parts[1].includes('USA') || parts[1].includes('United States')) {
      return parts[0];
    }
    // Otherwise return second part (likely the state)
    return parts[1];
  }

  // Single part, return as-is
  return parts[0];
}

function calculateFitScore(company, companyProfile) {
  let score = 0;
  let maxScore = 0;

  // Extract industry (with fallback)
  const industry = company.industry || company.primary_industry || '';

  // Industry match (30 points)
  maxScore += 30;
  if (industry && companyProfile.industries.includes(industry)) {
    score += 30;
  }

  // Company size match (25 points)
  maxScore += 25;
  const employeeCount = company.estimated_num_employees || extractMidpoint(company.organization_num_employees_ranges);
  if (employeeCount && companyProfile.companySizes) {
    if (isWithinSizeRange(employeeCount, companyProfile.companySizes)) {
      score += 25;
    }
  }

  // Revenue match (20 points) - only if user specified revenue preference
  if (!companyProfile.skipRevenue && companyProfile.revenueRanges && companyProfile.revenueRanges.length > 0) {
    maxScore += 20;
    // For now, give points if company has revenue data
    if (company.revenue_range) {
      score += 20;
    }
  } else if (companyProfile.skipRevenue) {
    // If user skipped revenue, don't penalize - add to max score and give points
    maxScore += 20;
    score += 20;
  }

  // Location match (25 points)
  maxScore += 25;
  const location = extractLocation(company);
  const state = extractStateFromLocation(location);

  if (state) {
    if (companyProfile.isNationwide || (companyProfile.locations && companyProfile.locations.includes(state))) {
      score += 25;
    }
  }

  // Calculate percentage
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return percentage;
}

/**
 * Format revenue range from Apollo API response
 */
function formatRevenueRange(revenueRange) {
  if (!revenueRange) return 'Unknown';

  if (typeof revenueRange === 'object' && revenueRange.min !== undefined && revenueRange.max !== undefined) {
    const minFormatted = formatRevenueNumber(revenueRange.min);
    const maxFormatted = formatRevenueNumber(revenueRange.max);
    return `$${minFormatted} - $${maxFormatted}`;
  }

  return 'Unknown';
}

/**
 * Format revenue number to readable string (e.g., 1000000 -> "1M")
 */
function formatRevenueNumber(amount) {
  if (!amount || amount === 0) return '0';
  if (amount >= 1000000000) return `${(amount / 1000000000).toFixed(1)}B`;
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(0)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`;
  return amount.toString();
}
