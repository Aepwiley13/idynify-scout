import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';
import { mapApolloToScoutContact, validateScoutContact, logValidationErrors } from './utils/scoutContactContract.js';

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

    // Get Apollo API key (throws if not configured)
    const apolloApiKey = getApolloApiKey();

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

    // Step 1: Search Apollo API for contact candidates
    const searchBody = {
      organization_ids: [organizationId],
      person_titles: titles,
      page: 1,
      per_page: 10
    };

    const apolloResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(searchBody)
    });

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, searchBody, 'searchPeople');
      throw new Error(`Apollo API request failed: ${apolloResponse.status} - ${errorText}`);
    }

    const apolloData = await apolloResponse.json();
    const candidates = (apolloData.people || []).slice(0, 10);

    console.log('✅ Found contact candidates:', candidates.length);

    // Step 2: Enrich each person individually to get full profile data
    // The /api_search endpoint only returns basic fields (first_name, title)
    // We need to call /people/match to get full data (name, email, photo, linkedin)
    const enrichedPeople = [];

    for (const candidate of candidates) {
      try {
        console.log(`🔄 Enriching: ${candidate.first_name || 'Unknown'} (ID: ${candidate.id})`);

        const enrichResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
          method: 'POST',
          headers: getApolloHeaders(),
          body: JSON.stringify({ id: candidate.id })
        });

        if (enrichResponse.ok) {
          const enrichData = await enrichResponse.json();
          const fullPerson = enrichData.person;

          if (fullPerson) {
            // Use canonical mapper from Scout Contact Contract
            const mappedPerson = mapApolloToScoutContact(fullPerson);

            // Validate mapped contact (Phase 2: early warning if Apollo changes API)
            const validation = validateScoutContact(mappedPerson);
            if (!validation.valid) {
              logValidationErrors(validation, mappedPerson, 'searchPeople');
            }

            enrichedPeople.push(mappedPerson);
            console.log(`  ✅ Enriched: ${mappedPerson.name || candidate.first_name}`);
          } else {
            // Fallback to candidate data if enrichment returns no person
            console.warn(`  ⚠️ No enrichment data, using candidate data for ${candidate.first_name}`);
            enrichedPeople.push(mapApolloToScoutContact(candidate));
          }
        } else {
          // Fallback to candidate data if enrichment fails
          console.warn(`  ⚠️ Enrichment failed (${enrichResponse.status}), using candidate data`);
          enrichedPeople.push(mapApolloToScoutContact(candidate));
        }
      } catch (enrichError) {
        console.error(`  ❌ Error enriching ${candidate.first_name}:`, enrichError.message);
        // Fallback to candidate data on error
        enrichedPeople.push(mapApolloToScoutContact(candidate));
      }
    }

    console.log('✅ Enriched contacts:', enrichedPeople.length);
    console.log('📋 Sample enriched person:', enrichedPeople[0] ? {
      id: enrichedPeople[0].id,
      name: enrichedPeople[0].name,
      email: enrichedPeople[0].email,
      photo_url: enrichedPeople[0].photo_url,
      linkedin_url: enrichedPeople[0].linkedin_url,
      title: enrichedPeople[0].title
    } : 'No people found');

    // Log API usage for admin tracking
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'searchPeople', 'success', {
      responseTime,
      metadata: {
        organizationId,
        titlesSearched: titles,
        resultsFound: enrichedPeople.length
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
        people: enrichedPeople,
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
