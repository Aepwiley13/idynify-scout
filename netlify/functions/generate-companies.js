// Netlify Functions use native fetch (Node 18+) - NO IMPORTS NEEDED

// Company scoring function (0-100 points)
function calculateCompanyScore(contact, scoutData, icpBrief) {
  let score = 0;
  const breakdown = {
    title: 0,
    industry: 0,
    size: 0,
    location: 0,
    notAvoid: 0,
    dataQuality: 0
  };
  const matchDetails = [];

  // 1. TITLE MATCH (25 points max)
  const targetTitles = scoutData.jobTitles || [];
  const contactTitle = (contact.title || '').toLowerCase();

  let titleMatch = false;
  for (const targetTitle of targetTitles) {
    const target = targetTitle.toLowerCase();
    if (contactTitle.includes(target) || target.includes(contactTitle)) {
      if (contactTitle === target) {
        breakdown.title = 25;
        matchDetails.push(`✓ Exact title match (${contact.title})`);
      } else {
        breakdown.title = 20;
        matchDetails.push(`✓ Close title match (${contact.title})`);
      }
      titleMatch = true;
      break;
    }
  }

  if (!titleMatch && contactTitle.length > 0) {
    const keywords = ['vp', 'vice president', 'director', 'head', 'chief', 'manager', 'ceo', 'cfo', 'cto', 'president', 'owner', 'founder'];
    if (keywords.some(kw => contactTitle.includes(kw))) {
      breakdown.title = 12;
      matchDetails.push(`⚠ Related title (${contact.title})`);
    }
  }

  // 2. INDUSTRY MATCH (20 points max)
  const targetIndustries = scoutData.industries || [];
  const companyIndustry = (contact.organization?.industry || '').toLowerCase();

  let industryMatch = false;
  for (const targetIndustry of targetIndustries) {
    const target = targetIndustry.toLowerCase();
    if (companyIndustry.includes(target) || target.includes(companyIndustry)) {
      breakdown.industry = 20;
      matchDetails.push(`✓ Perfect industry (${contact.organization?.industry || 'N/A'})`);
      industryMatch = true;
      break;
    }
  }

  if (!industryMatch && companyIndustry.length > 0) {
    breakdown.industry = 8;
    matchDetails.push(`⚠ Different industry (${contact.organization?.industry || 'N/A'})`);
  }

  // 3. COMPANY SIZE (20 points max)
  const companyEmployees = contact.organization?.estimated_num_employees || 0;
  const targetSizes = scoutData.companySizes || [];

  let sizeMatch = false;
  for (const sizeRange of targetSizes) {
    const match = sizeRange.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      if (companyEmployees >= min && companyEmployees <= max) {
        breakdown.size = 20;
        matchDetails.push(`✓ Ideal company size (${companyEmployees} employees)`);
        sizeMatch = true;
        break;
      }
    } else if (sizeRange.includes('1000+') && companyEmployees >= 1000) {
      breakdown.size = 20;
      matchDetails.push(`✓ Ideal company size (${companyEmployees} employees)`);
      sizeMatch = true;
      break;
    }
  }

  if (!sizeMatch && companyEmployees > 0) {
    breakdown.size = 10;
    matchDetails.push(`⚠ Size outside target range (${companyEmployees} employees)`);
  }

  // 4. LOCATION MATCH (15 points max)
  const contactLocation = {
    city: (contact.city || '').toLowerCase(),
    state: (contact.state || '').toLowerCase(),
    country: (contact.country || '').toLowerCase()
  };

  if (scoutData.locationScope?.includes('All US') || scoutData.locationScope?.includes('Remote')) {
    breakdown.location = 15;
    matchDetails.push(`✓ Location: ${scoutData.locationScope.join(', ')}`);
  } else {
    let locationMatched = false;

    if (scoutData.targetStates && scoutData.targetStates.length > 0) {
      for (const targetState of scoutData.targetStates) {
        if (contactLocation.state.includes(targetState.toLowerCase()) ||
            targetState.toLowerCase().includes(contactLocation.state)) {
          breakdown.location = 15;
          matchDetails.push(`✓ Target state (${contact.state})`);
          locationMatched = true;
          break;
        }
      }
    }

    if (!locationMatched && scoutData.targetCities && scoutData.targetCities.length > 0) {
      for (const targetCity of scoutData.targetCities) {
        const cityName = targetCity.toLowerCase().replace(' metro', '').replace(' area', '');
        if (contactLocation.city.includes(cityName) || cityName.includes(contactLocation.city)) {
          breakdown.location = 15;
          matchDetails.push(`✓ Target metro (${contact.city})`);
          locationMatched = true;
          break;
        }
      }
    }

    if (!locationMatched && contactLocation.country.includes('united states')) {
      breakdown.location = 5;
      matchDetails.push(`⚠ US location but not target area (${contact.state || contact.city})`);
    } else if (!locationMatched) {
      matchDetails.push(`✗ Outside target locations (${contact.state || contact.country || 'Unknown'})`);
    }
  }

  // 5. NOT IN AVOID LIST (10 points)
  const avoidList = (scoutData.avoidList || '').toLowerCase();
  const companyName = (contact.organization?.name || '').toLowerCase();

  let isAvoided = false;

  if (avoidList && avoidList.split(',').some(avoid => companyName.includes(avoid.trim()))) {
    isAvoided = true;
    matchDetails.push('✗ Company in avoid list');
  }

  if (avoidList.includes('enterprise') && companyEmployees > 1000) {
    isAvoided = true;
    matchDetails.push('⚠ Large enterprise (in avoid criteria)');
  }

  if (avoidList.includes('b2c') && companyIndustry.includes('consumer')) {
    isAvoided = true;
    matchDetails.push('⚠ B2C company (in avoid criteria)');
  }

  if (!isAvoided) {
    breakdown.notAvoid = 10;
    matchDetails.push('✓ Not in avoid list');
  }

  // 6. DATA QUALITY (10 points max)
  let dataScore = 0;
  if (contact.email) {
    dataScore += 5;
    matchDetails.push('✓ Email available');
  }
  if (contact.linkedin_url) {
    dataScore += 3;
    matchDetails.push('✓ LinkedIn profile');
  }
  if (contact.phone_numbers && contact.phone_numbers.length > 0) {
    dataScore += 2;
    matchDetails.push('✓ Phone number');
  }
  breakdown.dataQuality = Math.min(dataScore, 10);

  score = breakdown.title + breakdown.industry + breakdown.size + breakdown.location + breakdown.notAvoid + breakdown.dataQuality;

  return { score, breakdown, matchDetails };
}

// Build location array for Apollo API
function buildLocationArray(scoutData) {
  const locations = [];

  if (scoutData.locationScope?.includes('All US')) {
    return ['United States'];
  }

  if (scoutData.targetStates && scoutData.targetStates.length > 0) {
    locations.push(...scoutData.targetStates.map(state => `${state}, United States`));
  }

  if (scoutData.targetCities && scoutData.targetCities.length > 0) {
    locations.push(...scoutData.targetCities.map(city => {
      const cityName = city.replace(' Metro', '').replace(' Area', '').replace(' Bay', '');
      return cityName;
    }));
  }

  return locations.length > 0 ? locations : ['United States'];
}

exports.handler = async (event, context) => {
  console.log('🏢 Generate Companies - Enhanced Scoring with ICP Brief');

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
    // Parse request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Invalid request body - must be valid JSON',
          companies: [],
          count: 0
        })
      };
    }

    const { userId, scoutData, icpBrief } = requestBody;

    if (!scoutData) {
      console.error('❌ No scoutData in request');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'scoutData is required in request body',
          companies: [],
          count: 0
        })
      };
    }

    const apolloKey = process.env.APOLLO_API_KEY;

    if (!apolloKey) {
      console.error('❌ APOLLO_API_KEY not set');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'APOLLO_API_KEY not configured in Netlify environment variables',
          companies: [],
          count: 0
        })
      };
    }

    console.log('📊 Scout Data:', {
      industries: scoutData.industries?.length,
      jobTitles: scoutData.jobTitles?.length,
      companySizes: scoutData.companySizes?.length,
      locationScope: scoutData.locationScope,
      targetStates: scoutData.targetStates?.length,
      targetCities: scoutData.targetCities?.length
    });

    console.log('🎯 ICP Brief:', icpBrief ? 'Present' : 'Not provided');

    // Build Apollo search query
    const searchPayload = {
      page: 1,
      per_page: 25,
      person_locations: buildLocationArray(scoutData)
    };

    if (scoutData.jobTitles && scoutData.jobTitles.length > 0) {
      searchPayload.person_titles = scoutData.jobTitles.slice(0, 5);
    }

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

    console.log('🔍 Apollo Search Payload:', JSON.stringify(searchPayload, null, 2));

    // Call Apollo API (using native fetch - no import needed!)
    const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
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
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: `Apollo API error: ${response.status}`,
          details: errorText,
          companies: [],
          count: 0
        })
      };
    }

    const apolloData = await response.json();
    console.log(`📊 Got ${apolloData.people?.length || 0} contacts from Apollo`);

    if (!apolloData.people || apolloData.people.length === 0) {
      console.log('⚠️ No companies returned - search may be too narrow');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          companies: [],
          count: 0,
          message: 'No companies found matching criteria. Try broadening your search.'
        })
      };
    }

    // Transform and score companies (pass icpBrief if available)
    const scoredCompanies = (apolloData.people || []).map(person => {
      const { score, breakdown, matchDetails } = calculateCompanyScore(person, scoutData, icpBrief);

      return {
        id: person.id || Math.random().toString(36),
        name: person.name || 'Unknown',
        title: person.title || 'Unknown',
        company: person.organization?.name || 'Unknown',
        industry: person.organization?.industry || 'Unknown',
        employees: person.organization?.estimated_num_employees || 0,
        location: `${person.city || ''}${person.city && person.state ? ', ' : ''}${person.state || ''}`.trim() || 'Unknown',
        email: person.email || null,
        linkedin: person.linkedin_url || null,
        phone: person.phone_numbers?.[0]?.sanitized_number || null,
        photoUrl: person.photo_url || null,
        score: score,
        scoreBreakdown: breakdown,
        matchDetails: matchDetails,
        createdAt: new Date().toISOString()
      };
    });

    // Sort by score and take top 10
    scoredCompanies.sort((a, b) => b.score - a.score);
    const topCompanies = scoredCompanies.slice(0, 10);

    console.log('🎉 Returning top', topCompanies.length, 'scored companies');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        companies: topCompanies,
        count: topCompanies.length,
        scoreDistribution: {
          excellent: topCompanies.filter(c => c.score >= 85).length,
          good: topCompanies.filter(c => c.score >= 70 && c.score < 85).length,
          moderate: topCompanies.filter(c => c.score >= 50 && c.score < 70).length
        },
        generatedAt: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 CRITICAL ERROR:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message || 'Unknown error occurred',
        errorType: error.name || 'Error',
        companies: [],
        count: 0
      })
    };
  }
};
