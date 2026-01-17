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
    const { userId, authToken, contactId } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId) {
      throw new Error('Missing required parameters');
    }

    console.log('🔄 Enriching contact:', contactId);

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

    // Call Apollo Person Enrichment API
    const enrichBody = { id: contactId };

    const apolloResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(enrichBody)
    });

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, enrichBody, 'enrichContact');
      throw new Error('Apollo enrichment failed');
    }

    const apolloData = await apolloResponse.json();
    const person = apolloData.person;

    if (!person) {
      throw new Error('Person data not found');
    }

    // Validate basic contact fields (Phase 2: early warning if Apollo changes API)
    const mappedPerson = mapApolloToScoutContact(person);
    const validation = validateScoutContact(mappedPerson);
    if (!validation.valid) {
      logValidationErrors(validation, mappedPerson, 'enrichContact');
    }

    console.log('✅ Contact enriched:', person.name || mappedPerson.name);

    // Log API usage for admin tracking
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'enrichContact', 'success', {
      responseTime,
      metadata: {
        contactId,
        contactName: person.name
      }
    });

    // Extract phone numbers by type
    const phoneNumbers = person.phone_numbers || [];
    const phoneByType = {
      mobile: null,
      direct: null,
      work: null,
      home: null,
      other: null
    };

    // Organize phone numbers by type
    phoneNumbers.forEach(phone => {
      const type = phone.type?.toLowerCase() || 'other';
      if (!phoneByType[type]) {
        phoneByType[type] = phone.sanitized_number || phone.raw_number || phone.number;
      }
    });

    // Fallback: if no specific types, use first available
    const primaryPhone = phoneByType.mobile || phoneByType.direct || phoneByType.work ||
                        phoneByType.other || phoneByType.home || phoneNumbers[0]?.sanitized_number || null;

    // Extract and structure enriched data
    const enrichedData = {
      // Contact Info - Email
      email: person.email || null,
      email_status: person.email_status || null,
      email_confidence: person.email_confidence || null,

      // Contact Info - Phone Numbers (organized by type)
      phone: primaryPhone, // Primary phone for backward compatibility
      phone_mobile: phoneByType.mobile,
      phone_direct: phoneByType.direct,
      phone_work: phoneByType.work,
      phone_home: phoneByType.home,
      phone_numbers: phoneNumbers, // Keep all phone numbers with metadata

      // Contact Info - Social
      linkedin_url: person.linkedin_url || null,
      twitter_url: person.twitter_url || null,
      facebook_url: person.facebook_url || null,

      // Professional Info
      seniority: person.seniority || null,
      departments: person.departments || [],
      functions: person.functions || [],

      // Current Employment
      job_start_date: person.employment_history?.[0]?.start_date || null,
      current_position_title: person.employment_history?.[0]?.title || person.title || null,
      current_company_name: person.employment_history?.[0]?.organization_name || null,

      // Employment History
      employment_history: person.employment_history || [],

      // Education
      education: person.education || [],

      // Location & Time Zone
      city: person.city || null,
      state: person.state || null,
      country: person.country || null,
      time_zone: person.time_zone || null,

      // Additional metadata
      headline: person.headline || null,
      photo_url: person.photo_url || null,

      // Derived flags for decision-making context
      is_likely_decision_maker: inferDecisionMaker(person.seniority, person.title),

      // Lead Export Readiness - CANONICAL LEAD RECORD
      lead_status: 'saved',           // "saved" | "exported" | "contacted"
      export_ready: true,              // Always true after enrichment
      last_enriched_at: new Date().toISOString(),
      data_sources: ['apollo'],        // Will add "ai_summary" after AI enrichment runs

      // Raw data for future AI processing
      _raw_apollo_data: {
        person_id: person.id,
        enriched_at: new Date().toISOString(),
        total_phone_numbers: phoneNumbers.length
      }
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        enrichedData
      })
    };

  } catch (error) {
    console.error('❌ Error in enrichContact:', error);

    // Log failed API usage (extract userId from body if available)
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'enrichContact', 'error', {
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

// Helper function to infer if contact is likely a decision maker
function inferDecisionMaker(seniority, title) {
  if (!seniority && !title) return false;

  const seniorityStr = (seniority || '').toLowerCase();
  const titleStr = (title || '').toLowerCase();

  // C-level executives
  if (seniorityStr.includes('c_suite') ||
      seniorityStr.includes('c-suite') ||
      titleStr.includes('chief') ||
      titleStr.match(/\b(ceo|cfo|cto|cmo|coo|cro|ciso)\b/)) {
    return true;
  }

  // VP level
  if (seniorityStr.includes('vp') ||
      seniorityStr.includes('vice_president') ||
      titleStr.includes('vice president') ||
      titleStr.includes(' vp ')) {
    return true;
  }

  // Director level
  if (seniorityStr.includes('director') || titleStr.includes('director')) {
    return true;
  }

  // Head of / Owner roles
  if (titleStr.includes('head of') || titleStr.includes('owner')) {
    return true;
  }

  return false;
}
