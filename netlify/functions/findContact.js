import { logApiUsage } from './utils/logApiUsage.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, searchParams } = JSON.parse(event.body);

    if (!userId || !authToken || !searchParams) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 Find Contact search with params:', searchParams);

    // Validate environment variables
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      console.error('❌ APOLLO_API_KEY not configured');
      throw new Error('Apollo API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
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

    console.log('✅ Auth token verified');

    // Build Apollo search query based on provided inputs
    const apolloQuery = buildApolloQuery(searchParams);

    console.log('📋 Apollo query:', JSON.stringify(apolloQuery, null, 2));

    // Call Apollo People Search API
    const apolloResponse = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloApiKey
      },
      body: JSON.stringify({
        ...apolloQuery,
        page: 1,
        per_page: 5 // Return max 5 results
      })
    });

    if (!apolloResponse.ok) {
      const errorText = await apolloResponse.text();
      console.error('❌ Apollo API error:', apolloResponse.status, errorText);
      throw new Error(`Apollo API request failed: ${apolloResponse.status}`);
    }

    const apolloData = await apolloResponse.json();
    const people = apolloData.people || [];

    console.log(`✅ Found ${people.length} potential matches`);

    // Enrich results with match quality scores
    const enrichedResults = people.map(person => ({
      ...person,
      match_quality: calculateMatchQuality(person, searchParams)
    }));

    // Sort by match quality
    enrichedResults.sort((a, b) => b.match_quality - a.match_quality);

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'findContact', 'success', {
      responseTime,
      metadata: {
        searchParams,
        resultsFound: enrichedResults.length
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        results: enrichedResults,
        total: enrichedResults.length
      })
    };

  } catch (error) {
    console.error('❌ Error in findContact:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'findContact', 'error', {
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

// Build Apollo query based on flexible search parameters
function buildApolloQuery(searchParams) {
  const query = {};

  // Priority 1: LinkedIn URL (most specific)
  if (searchParams.linkedin_url) {
    query.linkedin_url = searchParams.linkedin_url;
    return query; // LinkedIn URL alone is highly specific
  }

  // Priority 2: Full name + Company name
  if (searchParams.name) {
    query.q_keywords = searchParams.name;
  }

  if (searchParams.company_name) {
    query.organization_names = [searchParams.company_name];
  }

  // Priority 3: Facebook URL
  if (searchParams.facebook_url) {
    query.q_keywords = (query.q_keywords || '') + ' ' + searchParams.facebook_url;
  }

  // Additional filters for better matching
  // Prioritize current employment
  query.current_titles = true;

  return query;
}

// Calculate match quality score (0-100)
function calculateMatchQuality(person, searchParams) {
  let score = 0;

  // LinkedIn URL match = perfect match (100 points)
  if (searchParams.linkedin_url && person.linkedin_url === searchParams.linkedin_url) {
    return 100;
  }

  // Name match (40 points)
  if (searchParams.name && person.name) {
    const searchName = searchParams.name.toLowerCase();
    const personName = person.name.toLowerCase();
    if (personName.includes(searchName) || searchName.includes(personName)) {
      score += 40;
    }
  }

  // Company match (30 points)
  if (searchParams.company_name && person.organization_name) {
    const searchCompany = searchParams.company_name.toLowerCase();
    const personCompany = person.organization_name.toLowerCase();
    if (personCompany.includes(searchCompany) || searchCompany.includes(personCompany)) {
      score += 30;
    }
  }

  // Has email (10 points)
  if (person.email) {
    score += 10;
  }

  // Has LinkedIn (10 points)
  if (person.linkedin_url) {
    score += 10;
  }

  // Has photo (5 points)
  if (person.photo_url) {
    score += 5;
  }

  // Has title (5 points)
  if (person.title) {
    score += 5;
  }

  return Math.min(score, 100);
}
