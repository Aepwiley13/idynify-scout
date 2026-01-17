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

    // Call Apollo People Search API
    const apolloResponse = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
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
        per_page: 10
      })
    });

    if (!apolloResponse.ok) {
      const errorText = await apolloResponse.text();
      console.error('❌ Apollo API error:', apolloResponse.status, errorText);
      console.error('📊 Request that failed:', JSON.stringify({
        organization_ids: [organizationId],
        person_titles: titles,
        page: 1,
        per_page: 10
      }, null, 2));
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

        const enrichResponse = await fetch('https://api.apollo.io/v1/people/match', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': apolloApiKey
          },
          body: JSON.stringify({
            id: candidate.id
          })
        });

        if (enrichResponse.ok) {
          const enrichData = await enrichResponse.json();
          const fullPerson = enrichData.person;

          if (fullPerson) {
            // Map the enriched person data
            const mappedPerson = {
              ...fullPerson,
              // Construct full name from first_name + last_name if name doesn't exist
              name: fullPerson.name || `${fullPerson.first_name || ''} ${fullPerson.last_name || ''}`.trim() || null,
              email: fullPerson.email || null,
              photo_url: fullPerson.photo_url || null,
              linkedin_url: fullPerson.linkedin_url || null,
              organization_name: fullPerson.organization_name || fullPerson.organization?.name || null,
              departments: fullPerson.departments || fullPerson.functions || [],
              phone_numbers: fullPerson.phone_numbers || []
            };

            enrichedPeople.push(mappedPerson);
            console.log(`  ✅ Enriched: ${mappedPerson.name || candidate.first_name}`);
          } else {
            // Fallback to candidate data if enrichment returns no person
            console.warn(`  ⚠️ No enrichment data, using candidate data for ${candidate.first_name}`);
            enrichedPeople.push({
              ...candidate,
              name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() || null
            });
          }
        } else {
          // Fallback to candidate data if enrichment fails
          console.warn(`  ⚠️ Enrichment failed (${enrichResponse.status}), using candidate data`);
          enrichedPeople.push({
            ...candidate,
            name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() || null
          });
        }
      } catch (enrichError) {
        console.error(`  ❌ Error enriching ${candidate.first_name}:`, enrichError.message);
        // Fallback to candidate data on error
        enrichedPeople.push({
          ...candidate,
          name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() || null
        });
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
