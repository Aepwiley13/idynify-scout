// SIMPLE Barry Lead Generation - No AI scoring, just Apollo search
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🐻 Barry Simple Lead Generation - Starting');

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
    const { userId, scoutData, icpBrief } = JSON.parse(event.body);
    const apolloKey = process.env.APOLLO_API_KEY;

    if (!apolloKey) {
      throw new Error('Apollo API key not configured');
    }

    console.log('📊 Searching for:', {
      industries: scoutData.industries,
      companySizes: scoutData.companySizes,
      jobTitles: scoutData.jobTitles,
      locations: scoutData.targetStates || scoutData.targetCities
    });

    // SIMPLE: Just pull from Apollo based on ICP parameters
    // Pull 25 companies per industry/size combination
    const allLeads = [];

    // Build search params directly from Scout data
    const industries = scoutData.industries || [];
    const companySizes = parseCompanySizes(scoutData.companySizes || []);
    const jobTitles = scoutData.jobTitles || [];
    const locations = buildLocationFilters(scoutData);

    // For MVP: Just do ONE search with all params
    console.log('🔍 Searching Apollo...');

    const searchPayload = {
      api_key: apolloKey,
      page: 1,
      per_page: 100, // Pull 100 companies
      // Organization filters
      organization_industry_tag_ids: await getIndustryIds(industries, apolloKey),
      organization_num_employees_ranges: companySizes,
      organization_locations: locations,
      // Person filters
      person_titles: jobTitles,
      // Get people with email
      contact_email_status: ['verified', 'guessed']
    };

    const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Apollo error:', error);
      throw new Error(`Apollo API error: ${response.status}`);
    }

    const data = await response.json();
    const people = data.people || [];

    console.log(`✅ Found ${people.length} people`);

    if (people.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          leads: [],
          count: 0,
          message: 'No leads found. Try broadening your search criteria.',
          analytics: {
            companiesSearched: 0,
            peopleFound: 0
          }
        })
      };
    }

    // Simple scoring: Just based on data completeness
    const leads = people.slice(0, 25).map((person, index) => {
      const score = calculateSimpleScore(person);

      return {
        id: person.id || `lead-${index}`,
        name: person.name || 'Unknown',
        title: person.title || 'Unknown',
        company: person.organization?.name || 'Unknown',
        industry: person.organization?.industry || 'Unknown',
        employees: person.organization?.estimated_num_employees || 0,
        location: buildLocation(person),
        email: person.email || null,
        linkedin: person.linkedin_url || null,
        phone: person.phone_numbers?.[0]?.sanitized_number || null,
        photoUrl: person.photo_url || null,
        website: person.organization?.website_url || null,
        score: score,
        scoreBreakdown: {
          hasEmail: person.email ? 25 : 0,
          hasLinkedIn: person.linkedin_url ? 20 : 0,
          hasPhone: person.phone_numbers?.length > 0 ? 15 : 0,
          titleMatch: jobTitles.some(t => person.title?.toLowerCase().includes(t.toLowerCase())) ? 20 : 0,
          industryMatch: industries.some(i => person.organization?.industry?.toLowerCase().includes(i.toLowerCase())) ? 20 : 0
        },
        createdAt: new Date().toISOString()
      };
    });

    // Sort by score
    leads.sort((a, b) => b.score - a.score);

    console.log(`🎉 Returning ${leads.length} leads`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        leads: leads,
        count: leads.length,
        message: `Barry found ${leads.length} ideal clients!`,
        analytics: {
          totalPeopleFound: people.length,
          leadsReturned: leads.length,
          searchCriteria: {
            industries: industries.length,
            companySizes: companySizes.length,
            jobTitles: jobTitles.length,
            locations: locations.length
          }
        }
      })
    };

  } catch (error) {
    console.error('💥 Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message || 'Unknown error',
        leads: [],
        count: 0
      })
    };
  }
};

// Helper functions
function parseCompanySizes(sizes) {
  const sizeMap = {
    '1-10': '1,10',
    '11-50': '11,50',
    '51-200': '51,200',
    '201-500': '201,500',
    '501-1000': '501,1000',
    '1001-5000': '1001,5000',
    '5000+': '5001,10000000'
  };

  return sizes.map(size => sizeMap[size] || size).filter(Boolean);
}

function buildLocationFilters(scoutData) {
  const locations = [];

  if (scoutData.targetStates && scoutData.targetStates.length > 0) {
    scoutData.targetStates.forEach(state => {
      locations.push(`${state}, US`);
    });
  }

  if (scoutData.targetCities && scoutData.targetCities.length > 0) {
    scoutData.targetCities.forEach(city => {
      locations.push(city);
    });
  }

  // If no locations specified, default to US
  if (locations.length === 0) {
    locations.push('United States');
  }

  return locations;
}

function buildLocation(person) {
  const parts = [];
  if (person.city) parts.push(person.city);
  if (person.state) parts.push(person.state);
  if (person.country) parts.push(person.country);
  return parts.join(', ') || 'Unknown';
}

function calculateSimpleScore(person) {
  let score = 0;

  // Email is most important
  if (person.email) score += 25;

  // LinkedIn profile
  if (person.linkedin_url) score += 20;

  // Phone number
  if (person.phone_numbers && person.phone_numbers.length > 0) score += 15;

  // Has photo (shows profile is complete)
  if (person.photo_url) score += 10;

  // Company website
  if (person.organization?.website_url) score += 10;

  // Title exists
  if (person.title) score += 10;

  // Company size known
  if (person.organization?.estimated_num_employees) score += 10;

  return Math.min(score, 100);
}

async function getIndustryIds(industries, apolloKey) {
  // For MVP, just return the industry names as-is
  // Apollo will match them
  return industries;
}
