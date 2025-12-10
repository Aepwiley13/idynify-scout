exports.handler = async (event, context) => {
  console.log('🔍 PHASE 1: TAM Discovery - Starting');
  
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { userId, scoutData } = JSON.parse(event.body);
    const apolloKey = process.env.APOLLO_API_KEY;
    
    if (!apolloKey) {
      throw new Error('Apollo API key not configured');
    }

    console.log('📊 Scout Data:', {
      industries: scoutData.industries?.length,
      companySizes: scoutData.companySizes?.length,
      jobTitles: scoutData.jobTitles?.length
    });

    // Build Apollo search for COMPANIES only (not people)
    const searchPayload = {
      page: 1,
      per_page: 100, // Get up to 100 companies for TAM
      organization_locations: buildLocationArray(scoutData),
      q_organization_keyword_tags: scoutData.industries || []
    };

    // Add company size filters
    if (scoutData.companySizes && scoutData.companySizes.length > 0) {
      const sizes = [];
      scoutData.companySizes.forEach(range => {
        if (range.includes('1-10')) sizes.push('1-10');
        if (range.includes('11-50')) sizes.push('11-50');
        if (range.includes('51-200')) sizes.push('51-200');
        if (range.includes('201-500')) sizes.push('201-500');
        if (range.includes('501-1000')) sizes.push('501-1000');
        if (range.includes('1000+')) sizes.push('1001-10000');
      });
      if (sizes.length > 0) {
        searchPayload.organization_num_employees_ranges = sizes;
      }
    }

    console.log('🔍 Searching Apollo for companies:', JSON.stringify(searchPayload, null, 2));

    // Call Apollo Organizations Search API
    const response = await fetch('https://api.apollo.io/v1/organizations/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apolloKey
      },
      body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Apollo API Error:', errorText);
      throw new Error(`Apollo API error: ${response.status}`);
    }

    const data = await response.json();
    const companies = data.organizations || [];
    
    console.log(`✅ Found ${companies.length} companies`);

    if (companies.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          companies: [],
          totalCount: 0,
          message: 'No companies found matching your criteria. Try broadening your search parameters.',
          analytics: {
            searchCriteria: searchPayload
          }
        })
      };
    }

    // Calculate distribution stats
    const analytics = calculateDistribution(companies, scoutData);

    // Select 10% sample for validation (max 10 companies)
    const sampleSize = Math.min(10, Math.ceil(companies.length * 0.1));
    const validationSample = companies.slice(0, sampleSize).map(company => ({
      id: company.id,
      name: company.name,
      industry: company.industry || 'Unknown',
      employees: company.estimated_num_employees || 0,
      location: buildCompanyLocation(company),
      website: company.website_url || null,
      founded: company.founded_year || null
    }));

    console.log(`📊 Returning ${companies.length} companies with ${validationSample.length} validation sample`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        companies: companies,
        totalCount: companies.length,
        validationSample: validationSample,
        analytics: analytics,
        message: `Barry discovered ${companies.length} companies in your Total Addressable Market!`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Error in Phase 1:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        companies: [],
        totalCount: 0
      })
    };
  }
};

// Helper Functions

function buildLocationArray(scoutData) {
  const locations = [];
  
  if (scoutData.locationScope?.includes('All US')) {
    return ['United States'];
  }
  
  if (scoutData.targetStates?.length > 0) {
    locations.push(...scoutData.targetStates.map(state => `${state}, United States`));
  }
  
  if (scoutData.targetCities?.length > 0) {
    locations.push(...scoutData.targetCities.map(city => {
      const cityName = city.replace(' Metro', '').replace(' Area', '').replace(' Bay', '');
      return cityName;
    }));
  }
  
  return locations.length > 0 ? locations : ['United States'];
}

function buildCompanyLocation(company) {
  const parts = [];
  if (company.city) parts.push(company.city);
  if (company.state) parts.push(company.state);
  if (company.country && parts.length === 0) parts.push(company.country);
  return parts.join(', ') || 'Unknown';
}

function calculateDistribution(companies, scoutData) {
  // Industry distribution
  const industries = {};
  companies.forEach(c => {
    const industry = c.industry || 'Unknown';
    industries[industry] = (industries[industry] || 0) + 1;
  });

  // Size distribution
  const sizes = {
    '1-10': 0,
    '11-50': 0,
    '51-200': 0,
    '201-500': 0,
    '501-1000': 0,
    '1000+': 0
  };

  companies.forEach(c => {
    const empCount = c.estimated_num_employees || 0;
    if (empCount <= 10) sizes['1-10']++;
    else if (empCount <= 50) sizes['11-50']++;
    else if (empCount <= 200) sizes['51-200']++;
    else if (empCount <= 500) sizes['201-500']++;
    else if (empCount <= 1000) sizes['501-1000']++;
    else sizes['1000+']++;
  });

  // Sort industries by count
  const topIndustries = Object.entries(industries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([industry, count]) => ({ industry, count }));

  return {
    totalCompanies: companies.length,
    industries: topIndustries,
    sizes: sizes,
    targetIndustries: scoutData.industries || [],
    targetSizes: scoutData.companySizes || []
  };
}
