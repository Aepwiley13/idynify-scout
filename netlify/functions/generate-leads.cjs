// Netlify Functions use native fetch (Node 18+) - NO IMPORTS NEEDED

// Lead scoring function (0-100 points)
function calculateLeadScore(lead, scoutData, icpBrief) {
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
  const leadTitle = (lead.title || '').toLowerCase();
  
  let titleMatch = false;
  for (const targetTitle of targetTitles) {
    const target = targetTitle.toLowerCase();
    if (leadTitle.includes(target) || target.includes(leadTitle)) {
      if (leadTitle === target) {
        breakdown.title = 25;
        matchDetails.push(`✓ Exact title match (${lead.title})`);
      } else {
        breakdown.title = 20;
        matchDetails.push(`✓ Close title match (${lead.title})`);
      }
      titleMatch = true;
      break;
    }
  }
  
  if (!titleMatch && leadTitle.length > 0) {
    const keywords = ['vp', 'vice president', 'director', 'head', 'chief', 'manager', 'ceo', 'cfo', 'cto', 'president', 'owner', 'founder'];
    if (keywords.some(kw => leadTitle.includes(kw))) {
      breakdown.title = 12;
      matchDetails.push(`⚠ Related title (${lead.title})`);
    }
  }

  // 2. INDUSTRY MATCH (20 points max)
  const targetIndustries = scoutData.industries || [];
  const leadIndustry = (lead.organization?.industry || '').toLowerCase();
  
  let industryMatch = false;
  for (const targetIndustry of targetIndustries) {
    const target = targetIndustry.toLowerCase();
    if (leadIndustry.includes(target) || target.includes(leadIndustry)) {
      breakdown.industry = 20;
      matchDetails.push(`✓ Perfect industry (${lead.organization?.industry || 'N/A'})`);
      industryMatch = true;
      break;
    }
  }
  
  if (!industryMatch && leadIndustry.length > 0) {
    breakdown.industry = 8;
    matchDetails.push(`⚠ Different industry (${lead.organization?.industry || 'N/A'})`);
  }

  // 3. COMPANY SIZE (20 points max)
  const leadEmployees = lead.organization?.estimated_num_employees || 0;
  const targetSizes = scoutData.companySizes || [];
  
  let sizeMatch = false;
  for (const sizeRange of targetSizes) {
    const match = sizeRange.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      if (leadEmployees >= min && leadEmployees <= max) {
        breakdown.size = 20;
        matchDetails.push(`✓ Ideal company size (${leadEmployees} employees)`);
        sizeMatch = true;
        break;
      }
    } else if (sizeRange.includes('1000+') && leadEmployees >= 1000) {
      breakdown.size = 20;
      matchDetails.push(`✓ Ideal company size (${leadEmployees} employees)`);
      sizeMatch = true;
      break;
    }
  }
  
  if (!sizeMatch && leadEmployees > 0) {
    breakdown.size = 10;
    matchDetails.push(`⚠ Size outside target range (${leadEmployees} employees)`);
  }

  // 4. LOCATION MATCH (15 points max)
  const personLocation = {
    city: (lead.city || '').toLowerCase(),
    state: (lead.state || '').toLowerCase(),
    country: (lead.country || '').toLowerCase()
  };
  
  if (scoutData.locationScope?.includes('All US') || scoutData.locationScope?.includes('Remote')) {
    breakdown.location = 15;
    matchDetails.push(`✓ Location: ${scoutData.locationScope.join(', ')}`);
  } else {
    let locationMatched = false;
    
    if (scoutData.targetStates && scoutData.targetStates.length > 0) {
      for (const targetState of scoutData.targetStates) {
        if (personLocation.state.includes(targetState.toLowerCase()) || 
            targetState.toLowerCase().includes(personLocation.state)) {
          breakdown.location = 15;
          matchDetails.push(`✓ Target state (${lead.state})`);
          locationMatched = true;
          break;
        }
      }
    }
    
    if (!locationMatched && scoutData.targetCities && scoutData.targetCities.length > 0) {
      for (const targetCity of scoutData.targetCities) {
        const cityName = targetCity.toLowerCase().replace(' metro', '').replace(' area', '');
        if (personLocation.city.includes(cityName) || cityName.includes(personLocation.city)) {
          breakdown.location = 15;
          matchDetails.push(`✓ Target metro (${lead.city})`);
          locationMatched = true;
          break;
        }
      }
    }
    
    if (!locationMatched && personLocation.country.includes('united states')) {
      breakdown.location = 5;
      matchDetails.push(`⚠ US location but not target area (${lead.state || lead.city})`);
    } else if (!locationMatched) {
      matchDetails.push(`✗ Outside target locations (${lead.state || lead.country || 'Unknown'})`);
    }
  }

  // 5. NOT IN AVOID LIST (10 points)
  const avoidList = (scoutData.avoidList || '').toLowerCase();
  const companyName = (lead.organization?.name || '').toLowerCase();
  
  let isAvoided = false;
  
  if (avoidList && avoidList.split(',').some(avoid => companyName.includes(avoid.trim()))) {
    isAvoided = true;
    matchDetails.push('✗ Company in avoid list');
  }
  
  if (avoidList.includes('enterprise') && leadEmployees > 1000) {
    isAvoided = true;
    matchDetails.push('⚠ Large enterprise (in avoid criteria)');
  }
  
  if (avoidList.includes('b2c') && leadIndustry.includes('consumer')) {
    isAvoided = true;
    matchDetails.push('⚠ B2C company (in avoid criteria)');
  }
  
  if (!isAvoided) {
    breakdown.notAvoid = 10;
    matchDetails.push('✓ Not in avoid list');
  }

  // 6. DATA QUALITY (10 points max)
  let dataScore = 0;
  if (lead.email) {
    dataScore += 5;
    matchDetails.push('✓ Email available');
  }
  if (lead.linkedin_url) {
    dataScore += 3;
    matchDetails.push('✓ LinkedIn profile');
  }
  if (lead.phone_numbers && lead.phone_numbers.length > 0) {
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
  console.log('🎯 Generate Leads - Enhanced Scoring with ICP Brief');
  
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
          leads: [],
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
          leads: [],
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
          leads: [],
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
          leads: [],
          count: 0
        })
      };
    }

    const apolloData = await response.json();
    console.log(`📊 Got ${apolloData.people?.length || 0} raw leads from Apollo`);

    if (!apolloData.people || apolloData.people.length === 0) {
      console.log('⚠️ No leads returned - search may be too narrow');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          leads: [],
          count: 0,
          message: 'No leads found matching criteria. Try broadening your search.'
        })
      };
    }

    // Transform and score leads (pass icpBrief if available)
    const scoredLeads = (apolloData.people || []).map(person => {
      const { score, breakdown, matchDetails } = calculateLeadScore(person, scoutData, icpBrief);
      
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
    scoredLeads.sort((a, b) => b.score - a.score);
    const topLeads = scoredLeads.slice(0, 10);

    console.log('🎉 Returning top', topLeads.length, 'scored leads');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        leads: topLeads,
        count: topLeads.length,
        scoreDistribution: {
          excellent: topLeads.filter(l => l.score >= 85).length,
          good: topLeads.filter(l => l.score >= 70 && l.score < 85).length,
          moderate: topLeads.filter(l => l.score >= 50 && l.score < 70).length
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
        leads: [],
        count: 0
      })
    };
  }
};
