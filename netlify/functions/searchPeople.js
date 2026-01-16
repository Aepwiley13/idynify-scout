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

    console.log('✅ Found people:', apolloData.people?.length || 0);

    // Map Apollo API response fields to match frontend expectations
    const mappedPeople = (apolloData.people || []).map(person => ({
      ...person,
      // Construct full name from first_name + last_name
      name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || null,
      // Ensure email is mapped correctly
      email: person.email || null,
      // Map organization name if needed
      organization_name: person.organization_name || person.organization?.name || null,
      // Ensure photo_url is mapped
      photo_url: person.photo_url || null,
      // Ensure departments is an array
      departments: person.departments || person.functions || [],
      // Map phone numbers
      phone_numbers: person.phone_numbers || []
    }));

    console.log('📋 Sample mapped person:', mappedPeople[0] ? {
      id: mappedPeople[0].id,
      name: mappedPeople[0].name,
      email: mappedPeople[0].email,
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
