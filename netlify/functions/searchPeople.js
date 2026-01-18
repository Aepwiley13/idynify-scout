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
    const { userId, authToken, organizationId, titles } = JSON.parse(event.body);

    if (!userId || !authToken || !organizationId || !titles) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 Searching for people at organization:', organizationId);
    console.log('📋 Target titles:', titles);

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

    // Step 1: Search for people by title (gets IDs and basic info)
    const searchResponse = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloApiKey
      },
      body: JSON.stringify({
        organization_ids: [organizationId],
        person_titles: titles,
        page: 1,
        per_page: 10  // Max 10 results
      })
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('❌ Apollo API error:', searchResponse.status, errorText);
      console.error('📊 Request that failed:', JSON.stringify({
        organization_ids: [organizationId],
        person_titles: titles,
        page: 1,
        per_page: 10
      }, null, 2));
      throw new Error(`Apollo API request failed: ${searchResponse.status} - ${errorText}`);
    }

    const searchData = await searchResponse.json();
    const searchResults = searchData.people || [];

    console.log('✅ Found candidate contacts:', searchResults.length);

    // Step 2: Enrich each contact individually to get full profile data
    const enrichedPeople = [];

    for (const candidate of searchResults) {
      try {
        console.log(`🔄 Enriching: ${candidate.first_name || 'Unknown'} (ID: ${candidate.id})`);

        const enrichResponse = await fetch('https://api.apollo.io/v1/people/match', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': apolloApiKey
          },
          body: JSON.stringify({ id: candidate.id })
        });

        if (enrichResponse.ok) {
          const enrichData = await enrichResponse.json();
          const enrichedPerson = enrichData.person;

          if (enrichedPerson) {
            enrichedPeople.push(enrichedPerson);
            console.log(`  ✅ Enriched: ${enrichedPerson.name || enrichedPerson.first_name}`);
          }
        } else {
          console.warn(`  ⚠️ Could not enrich ${candidate.first_name}, using basic data`);
          enrichedPeople.push(candidate); // Fallback to basic search data
        }
      } catch (enrichError) {
        console.error(`  ❌ Error enriching ${candidate.first_name}:`, enrichError.message);
        enrichedPeople.push(candidate); // Fallback to basic search data
      }
    }

    console.log('✅ Total enriched contacts:', enrichedPeople.length);

    // Map enriched data to ensure consistent field names
    const mappedPeople = enrichedPeople.map(person => ({
      ...person,
      // Construct full name if not already present
      name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || null,
      email: person.email || null,
      organization_name: person.organization_name || person.organization?.name || null,
      photo_url: person.photo_url || null,
      linkedin_url: person.linkedin_url || null,
      departments: person.departments || person.functions || [],
      phone_numbers: person.phone_numbers || []
    }));

    console.log('📋 Sample enriched contact:', mappedPeople[0] ? {
      id: mappedPeople[0].id,
      name: mappedPeople[0].name,
      email: mappedPeople[0].email,
      photo_url: mappedPeople[0].photo_url,
      linkedin_url: mappedPeople[0].linkedin_url,
      title: mappedPeople[0].title
    } : 'No people found');

    // Log API usage for admin tracking
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'searchPeople', 'success', {
      responseTime,
      metadata: {
        organizationId,
        titlesSearched: titles,
        resultsFound: mappedPeople.length
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
        people: mappedPeople,
        total: apolloData.pagination?.total_entries || 0
      })
    };

  } catch (error) {
    console.error('❌ Error in searchPeople:', error);

    // Log failed API usage (extract userId from body if available)
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'searchPeople', 'error', {
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
