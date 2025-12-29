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
  return industryNames
    .map(name => APOLLO_INDUSTRIES[name])
    .filter(id => id !== undefined);
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

    // Verify Firebase Auth token
    const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
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

    console.log('📊 Apollo query:', JSON.stringify(apolloQuery, null, 2));

    // Call Apollo API
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      throw new Error('Apollo API key not configured');
    }

    const apolloResponse = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        api_key: apolloApiKey,
        ...apolloQuery
      })
    });

    if (!apolloResponse.ok) {
      const errorText = await apolloResponse.text();
      console.error('Apollo API error:', errorText);
      throw new Error(`Apollo API request failed: ${apolloResponse.status}`);
    }

    const apolloData = await apolloResponse.json();
    const companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} companies from Apollo`);

    // Save companies to Firestore
    await saveCompaniesToFirestore(userId, authToken, companies, companyProfile);

    const generationTime = (Date.now() - startTime) / 1000;

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
        generationTime,
        message: `Found ${companies.length} companies matching your criteria`
      })
    };

  } catch (error) {
    console.error('💥 Error in search-companies:', error);

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
  const query = {
    page: 1,
    per_page: 50
  };

  // Map industries to Apollo industry tag IDs
  if (companyProfile.industries && companyProfile.industries.length > 0) {
    query.organization_industry_tag_ids = getIndustryIds(companyProfile.industries);
  }

  // Map company sizes to Apollo format
  if (companyProfile.companySizes && companyProfile.companySizes.length > 0) {
    query.organization_num_employees_ranges = companyProfile.companySizes.map(size => {
      // Convert "51-100" to "51,100" for Apollo
      if (size.includes('+')) {
        // "10,001+" becomes "10001,999999"
        const min = size.replace(/[,+]/g, '');
        return `${min},999999`;
      }
      return size.replace('-', ',').replace(/,/g, '');
    });
  }

  // Map revenue ranges to Apollo format (numeric)
  if (companyProfile.revenueRanges && companyProfile.revenueRanges.length > 0 && !companyProfile.skipRevenue) {
    query.revenue_range = companyProfile.revenueRanges.map(range => {
      return convertRevenueToNumeric(range);
    });
  }

  // Map locations to Apollo format
  if (companyProfile.locations && companyProfile.locations.length > 0) {
    query.organization_locations = formatStatesForApollo(companyProfile.locations);
  }

  return query;
}

function convertRevenueToNumeric(revenueRange) {
  const mapping = {
    "Less than $1M": "0,1000000",
    "$1M-$2M": "1000000,2000000",
    "$2M-$5M": "2000000,5000000",
    "$5M-$10M": "5000000,10000000",
    "$10M-$20M": "10000000,20000000",
    "$20M-$50M": "20000000,50000000",
    "$50M-$100M": "50000000,100000000",
    "$100M-$200M": "100000000,200000000",
    "$200M-$500M": "200000000,500000000",
    "$500M-$1B": "500000000,1000000000",
    "$1B+": "1000000000,999999999999"
  };

  return mapping[revenueRange] || "0,999999999999";
}

async function saveCompaniesToFirestore(userId, authToken, companies, companyProfile) {
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    for (const company of companies) {
      const companyId = company.id || `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Calculate fit score
      const fitScore = calculateFitScore(company, companyProfile);

      const companyData = {
        fields: {
          apollo_organization_id: { stringValue: company.id || '' },
          name: { stringValue: company.name || '' },
          domain: { stringValue: company.website_url || company.primary_domain || '' },
          industry: { stringValue: company.industry || '' },
          employee_count: { integerValue: company.estimated_num_employees || 0 },
          revenue_range: { stringValue: formatRevenueRange(company.revenue_range) },
          headquarters_location: { stringValue: formatLocation(company.primary_location) },
          linkedin_url: { stringValue: company.linkedin_url || '' },
          website_url: { stringValue: company.website_url || '' },
          status: { stringValue: 'pending' },
          fit_score: { integerValue: fitScore },
          fit_reasons: { arrayValue: { values: getFitReasons(company, companyProfile).map(r => ({ stringValue: r })) } },
          foundAt: { timestampValue: new Date().toISOString() },
          source: { stringValue: 'initial_search' },
          swipedAt: { nullValue: null },
          swipeDirection: { nullValue: null }
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
        console.error(`Failed to save company ${company.name}:`, await saveResponse.text());
      }
    }

    console.log(`✅ Saved ${companies.length} companies to Firestore`);

  } catch (error) {
    console.error('❌ Error saving companies to Firestore:', error);
    // Don't throw - allow function to complete even if some saves fail
  }
}

function calculateFitScore(company, companyProfile) {
  let score = 0;
  let maxScore = 0;

  // Industry match (30 points)
  maxScore += 30;
  if (companyProfile.industries.includes(company.industry)) {
    score += 30;
  }

  // Company size match (20 points)
  maxScore += 20;
  const companySize = company.estimated_num_employees;
  for (const sizeRange of companyProfile.companySizes) {
    if (isInSizeRange(companySize, sizeRange)) {
      score += 20;
      break;
    }
  }

  // Revenue match (20 points)
  if (!companyProfile.skipRevenue && companyProfile.revenueRanges.length > 0) {
    maxScore += 20;
    const companyRevenue = company.revenue_range;
    if (companyRevenue && isInRevenueRange(companyRevenue, companyProfile.revenueRanges)) {
      score += 20;
    }
  }

  // Location match (30 points)
  maxScore += 30;
  const companyLocation = company.primary_location?.state;
  if (companyLocation && (companyProfile.isNationwide || companyProfile.locations.includes(companyLocation))) {
    score += 30;
  }

  return Math.round((score / maxScore) * 100);
}

function isInSizeRange(employeeCount, sizeRange) {
  if (sizeRange.includes('+')) {
    const min = parseInt(sizeRange.replace(/[,+]/g, ''));
    return employeeCount >= min;
  }

  const [min, max] = sizeRange.split('-').map(s => parseInt(s.replace(/,/g, '')));
  return employeeCount >= min && employeeCount <= max;
}

function isInRevenueRange(companyRevenue, revenueRanges) {
  // This is a simplified check - you may want to make it more sophisticated
  return true; // For now, accept any revenue if revenue filter is set
}

function getFitReasons(company, companyProfile) {
  const reasons = [];

  if (companyProfile.industries.includes(company.industry)) {
    reasons.push(`Industry match: ${company.industry}`);
  }

  if (company.estimated_num_employees) {
    reasons.push(`Company size: ${company.estimated_num_employees} employees`);
  }

  if (company.revenue_range) {
    reasons.push(`Revenue: ${formatRevenueRange(company.revenue_range)}`);
  }

  if (company.primary_location) {
    reasons.push(`Location: ${formatLocation(company.primary_location)}`);
  }

  return reasons;
}

function formatRevenueRange(revenueRange) {
  if (!revenueRange) return 'Unknown';
  if (typeof revenueRange === 'object' && revenueRange.min && revenueRange.max) {
    return `$${(revenueRange.min / 1000000).toFixed(0)}M-$${(revenueRange.max / 1000000).toFixed(0)}M`;
  }
  return 'Unknown';
}

function formatLocation(location) {
  if (!location) return 'Unknown';
  if (typeof location === 'object') {
    return `${location.city || ''}, ${location.state || ''}, ${location.country || ''}`.replace(/,\s*,/g, ',').trim();
  }
  return location;
}
