import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';
import { mapApolloToScoutContact, validateScoutContact, logValidationErrors } from './utils/scoutContactContract.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { db } from './firebase-admin.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // contactData is optional: when provided, write the initial contact document
    // to Firestore before enrichment (avoids client-side Firestore writes that
    // fail under impersonation due to security rules).
    const { userId, authToken, contactId, contactData, companyId } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId) {
      throw new Error('Missing required parameters');
    }

    console.log('🔄 Enriching contact:', contactId);

    // Verify auth token — supports admin impersonation
    await verifyAuthToken(authToken, userId);
    console.log('✅ Auth token verified');

    // Get Apollo API key (throws if not configured)
    getApolloApiKey();

    // ── Optional: write initial contact document server-side ─────────────────
    // When the caller passes contactData we do the initial setDoc here using
    // Firebase Admin SDK which bypasses Firestore security rules. This is
    // required when the authenticated user (admin) differs from the target user
    // (impersonated) — client-side Firestore writes would be denied by rules.
    if (contactData && companyId) {
      const contactDocId = `${companyId}_${contactId}`;
      const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactDocId);
      await contactRef.set({
        apollo_person_id: contactId,
        name: contactData.name || 'Unknown',
        title: contactData.title || '',
        email: contactData.email || null,
        phone: contactData.phone || null,
        linkedin_url: contactData.linkedin_url || null,
        photo_url: contactData.photo_url || null,
        company_id: companyId,
        company_name: contactData.company_name || '',
        company_industry: contactData.company_industry || null,
        lead_owner: userId,
        status: 'pending_enrichment',
        saved_at: new Date().toISOString(),
        source: contactData.source || 'apollo_people_search',
      });
      console.log('✅ Initial contact document written:', contactDocId);
    }

    // ── Apollo enrichment ──────────────────────────────────────────────────────
    const enrichBody = { id: contactId };

    const apolloResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(enrichBody)
    });

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, enrichBody, 'enrichContact');

      // Write enrichment_failed status server-side if we own the contact doc
      if (contactData && companyId) {
        const contactDocId = `${companyId}_${contactId}`;
        await db.collection('users').doc(userId).collection('contacts').doc(contactDocId)
          .update({ status: 'enrichment_failed' });
      }

      throw new Error('Apollo enrichment failed');
    }

    const apolloData = await apolloResponse.json();
    const person = apolloData.person;

    if (!person) {
      throw new Error('Person data not found');
    }

    // Validate basic contact fields
    const mappedPerson = mapApolloToScoutContact(person);
    const validation = validateScoutContact(mappedPerson);
    if (!validation.valid) {
      logValidationErrors(validation, mappedPerson, 'enrichContact');
    }

    console.log('✅ Contact enriched:', person.name || mappedPerson.name);

    // ── Build enrichedData ─────────────────────────────────────────────────────
    const phoneNumbers = person.phone_numbers || [];
    const phoneByType = { mobile: null, direct: null, work: null, home: null, other: null };

    phoneNumbers.forEach(phone => {
      const type = phone.type?.toLowerCase() || 'other';
      if (!phoneByType[type]) {
        phoneByType[type] = phone.sanitized_number || phone.raw_number || phone.number;
      }
    });

    const primaryPhone = phoneByType.mobile || phoneByType.direct || phoneByType.work ||
                        phoneByType.other || phoneByType.home || phoneNumbers[0]?.sanitized_number || null;

    const enrichedData = {
      email: person.email || null,
      email_status: person.email_status || null,
      email_confidence: person.email_confidence || null,
      phone: primaryPhone,
      phone_mobile: phoneByType.mobile,
      phone_direct: phoneByType.direct,
      phone_work: phoneByType.work,
      phone_home: phoneByType.home,
      phone_numbers: phoneNumbers,
      linkedin_url: person.linkedin_url || null,
      twitter_url: person.twitter_url || null,
      facebook_url: person.facebook_url || null,
      seniority: person.seniority || null,
      departments: person.departments || [],
      functions: person.functions || [],
      job_start_date: person.employment_history?.[0]?.start_date || null,
      current_position_title: person.employment_history?.[0]?.title || person.title || null,
      current_company_name: person.employment_history?.[0]?.organization_name || null,
      employment_history: person.employment_history || [],
      education: person.education || [],
      city: person.city || null,
      state: person.state || null,
      country: person.country || null,
      time_zone: person.time_zone || null,
      headline: person.headline || null,
      photo_url: person.photo_url || null,
      name: person.name || mappedPerson.name || null,
      is_likely_decision_maker: inferDecisionMaker(person.seniority, person.title),
      lead_status: 'saved',
      export_ready: true,
      last_enriched_at: new Date().toISOString(),
      data_sources: ['apollo'],
      _raw_apollo_data: {
        person_id: person.id,
        enriched_at: new Date().toISOString(),
        total_phone_numbers: phoneNumbers.length
      }
    };

    // ── Write enriched data to Firestore server-side ───────────────────────────
    // Done here (Admin SDK) so impersonation sessions don't hit Firestore rules.
    if (contactData && companyId) {
      const contactDocId = `${companyId}_${contactId}`;
      await db.collection('users').doc(userId).collection('contacts').doc(contactDocId)
        .update({ ...enrichedData, status: 'active', enriched_at: new Date().toISOString() });
      console.log('✅ Enriched contact document updated:', contactDocId);
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'enrichContact', 'success', {
      responseTime,
      metadata: { contactId, contactName: person.name }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, enrichedData })
    };

  } catch (error) {
    console.error('❌ Error in enrichContact:', error);

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
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

function inferDecisionMaker(seniority, title) {
  if (!seniority && !title) return false;

  const seniorityStr = (seniority || '').toLowerCase();
  const titleStr = (title || '').toLowerCase();

  if (seniorityStr.includes('c_suite') ||
      seniorityStr.includes('c-suite') ||
      titleStr.includes('chief') ||
      titleStr.match(/\b(ceo|cfo|cto|cmo|coo|cro|ciso)\b/)) {
    return true;
  }

  if (seniorityStr.includes('vp') ||
      seniorityStr.includes('vice_president') ||
      titleStr.includes('vice president') ||
      titleStr.includes(' vp ')) {
    return true;
  }

  if (seniorityStr.includes('director') || titleStr.includes('director')) {
    return true;
  }

  if (titleStr.includes('head of') || titleStr.includes('owner')) {
    return true;
  }

  return false;
}
