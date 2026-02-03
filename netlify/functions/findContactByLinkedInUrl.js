import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

/**
 * LINKEDIN URL EXACT MATCH LOOKUP
 *
 * This function is ONLY for LinkedIn Link feature in Scout+.
 *
 * CRITICAL CONSTRAINTS:
 * - Accepts ONLY linkedin_url (exact identifier)
 * - Returns ONLY the exact person for that URL
 * - NO fuzzy search
 * - NO multiple results
 * - NO fallback to search
 *
 * Returns minimal preview fields:
 * - Full Name
 * - Current Title
 * - Company Name
 * - Location
 *
 * If no exact match found, returns clear error.
 */
export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, linkedin_url } = JSON.parse(event.body);

    if (!userId || !authToken || !linkedin_url) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 LinkedIn URL exact match lookup:', linkedin_url);

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

    // Call Apollo Person Match API with LinkedIn URL as exact identifier
    // Note: api_key must be in body (not just headers) when matching by linkedin_url
    const matchBody = {
      linkedin_url: linkedin_url,
      api_key: apolloApiKey
    };

    console.log('📋 Calling Apollo PEOPLE_MATCH with LinkedIn URL');

    const apolloResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(matchBody)
    });

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, matchBody, 'findContactByLinkedInUrl');

      // If 404 or no match found, return user-friendly error
      if (apolloResponse.status === 404) {
        throw new Error('PROFILE_NOT_FOUND');
      }

      throw new Error('Apollo API request failed');
    }

    const apolloData = await apolloResponse.json();
    const person = apolloData.person;

    if (!person) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    console.log(`✅ Found exact match: ${person.name}`);

    // Extract ONLY the required preview fields (minimal data)
    const contact = {
      // Apollo ID (for saving later)
      id: person.id,
      apollo_person_id: person.id,

      // Required preview fields ONLY
      name: person.name || 'Unknown',
      title: person.title || person.headline || null,
      organization_name: person.organization_name || person.organization?.name || null,
      location: person.city && person.state
        ? `${person.city}, ${person.state}`
        : person.city || person.state || null,

      // Additional context for saving (but not shown in preview)
      organization_id: person.organization_id || person.organization?.id || null,
      email: person.email || null,
      phone_numbers: person.phone_numbers || [],
      linkedin_url: person.linkedin_url || linkedin_url,
      photo_url: person.photo_url || null,

      // Metadata
      organization: person.organization || null,
      city: person.city || null,
      state: person.state || null,
      departments: person.departments || [],
      seniority: person.seniority || null
    };

    // Log successful API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'findContactByLinkedInUrl', 'success', {
      responseTime,
      metadata: {
        linkedin_url,
        contactFound: person.name
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
        contact
      })
    };

  } catch (error) {
    console.error('❌ Error in findContactByLinkedInUrl:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'findContactByLinkedInUrl', 'error', {
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

    // User-friendly error message for profile not found
    if (error.message === 'PROFILE_NOT_FOUND') {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Unable to retrieve public profile details from this LinkedIn link. Please verify the URL or try again.'
        })
      };
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to lookup LinkedIn profile'
      })
    };
  }
};
