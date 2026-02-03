/**
 * BARRY ENRICHMENT ORCHESTRATOR
 *
 * User-initiated, multi-source enrichment. Barry orchestrates tools — no AI.
 *
 * ENRICHMENT DOCTRINE:
 * - Barry orchestrates tools, Barry does not "think"
 * - Allowed: Apollo APIs, Google Places, internal DB, rule-based merging
 * - NOT allowed: Claude, guessing, free-text inference, message generation
 * - Claude only comes AFTER enrichment, inside Hunter / messaging
 *
 * PIPELINE:
 * Step 0: Internal DB — check existing data, same-company matches ($0)
 * Step 1: Apollo PEOPLE_MATCH / PEOPLE_SEARCH — person-level data
 * Step 2: Google Places — company-level fallback (phone, address, website)
 *
 * MERGE RULES (deterministic, not AI):
 * - Person-level beats company-level
 * - Direct source beats inferred
 * - New data never overwrites user-entered data
 * - Every field gets a source tag
 *
 * Last updated: January 2026
 */

import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';
import { mapApolloToScoutContact, validateScoutContact, logValidationErrors } from './utils/scoutContactContract.js';
import { googleBusinessLookup } from './utils/googleBusinessLookup.js';
import { searchLinkedInProfile, extractEmailDomain } from './utils/linkedinSearch.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contact } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry Enrichment starting for:', contact.name);

    // Validate Apollo API key
    getApolloApiKey();

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
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
    if (verifyData.users[0].localId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth verified');

    // ─── Assess what's missing before we start ───
    const initialMissing = assessMissingData(contact);
    console.log('📋 Missing fields:', initialMissing);

    // Track enrichment steps + provenance
    const steps = [];
    let enrichedData = {};
    let apolloRawData = null;
    const provenance = {};

    // ═══════════════════════════════════════════════════
    // STEP 0: Internal DB — use what we already have ($0)
    // ═══════════════════════════════════════════════════
    const step0 = {
      source: 'internal_db',
      status: 'running',
      fieldsFound: [],
      timestamp: new Date().toISOString(),
      message: null
    };

    try {
      console.log('📂 Step 0: Checking internal data...');

      // Fill obvious fields from existing contact data that might be stored
      // under alternate field names
      const internalFields = extractInternalFields(contact);
      if (internalFields.fieldsFound.length > 0) {
        enrichedData = { ...enrichedData, ...internalFields.data };
        step0.fieldsFound = internalFields.fieldsFound;
        internalFields.fieldsFound.forEach(f => { provenance[f] = 'internal_db'; });
        step0.status = 'success';
        console.log(`✅ Step 0: Recovered ${internalFields.fieldsFound.length} fields from internal data`);
      } else {
        step0.status = 'no_data';
        step0.message = 'No additional internal data found';
      }
    } catch (err) {
      step0.status = 'error';
      step0.message = err.message;
      console.error('❌ Step 0 failed:', err.message);
    }

    steps.push(step0);

    // ═══════════════════════════════════════════════════
    // STEP 1: Apollo — person-level data
    // ═══════════════════════════════════════════════════

    // Step 1a: Apollo PEOPLE_MATCH (exact lookup)
    const hasApolloId = !!contact.apollo_person_id;
    const hasLinkedIn = !!contact.linkedin_url;

    if (hasApolloId || hasLinkedIn) {
      const step1a = {
        source: 'apollo_match',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        const matchBody = hasApolloId
          ? { id: contact.apollo_person_id }
          : { linkedin_url: contact.linkedin_url };

        console.log('🔍 Step 1a: Apollo PEOPLE_MATCH', hasApolloId ? 'by ID' : 'by LinkedIn URL');

        const apolloResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
          method: 'POST',
          headers: getApolloHeaders(),
          body: JSON.stringify(matchBody)
        });

        if (apolloResponse.ok) {
          const apolloData = await apolloResponse.json();
          const person = apolloData.person;

          if (person) {
            apolloRawData = person;
            const mapped = mapApolloToScoutContact(person);
            const validation = validateScoutContact(mapped);
            if (!validation.valid) {
              logValidationErrors(validation, mapped, 'barryEnrich-step1a');
            }

            const apolloFields = extractApolloFields(person, contact);
            enrichedData = mergeWithPrecedence(enrichedData, apolloFields.data, contact);
            step1a.fieldsFound = apolloFields.fieldsFound;
            apolloFields.fieldsFound.forEach(f => { provenance[f] = 'apollo_match'; });
            step1a.status = 'success';

            console.log(`✅ Step 1a: Found ${apolloFields.fieldsFound.length} fields`);
          } else {
            step1a.status = 'no_data';
            step1a.message = 'Apollo returned no person data';
          }
        } else {
          await logApolloError(apolloResponse, { id: contact.apollo_person_id }, 'barryEnrich-step1a');
          step1a.status = 'error';
          step1a.message = `Apollo returned ${apolloResponse.status}`;
        }
      } catch (err) {
        step1a.status = 'error';
        step1a.message = err.message;
        console.error('❌ Step 1a failed:', err.message);
      }

      steps.push(step1a);
    }

    // Step 1b: Apollo PEOPLE_SEARCH (fuzzy fallback — only if no Apollo ID)
    const postApolloMissing = assessMissingData({ ...contact, ...enrichedData });
    // Check for company in all possible field names (company_name, company, organization_name)
    const hasNameAndCompany = (contact.name || enrichedData.name) &&
      (contact.company_name || contact.company || enrichedData.current_company_name || contact.organization_name);

    if (postApolloMissing.length > 0 && hasNameAndCompany && !hasApolloId) {
      const step1b = {
        source: 'apollo_search',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        const name = contact.name || enrichedData.name || '';
        // Check for company in all possible field names (CSV uses "company", others use "company_name")
        const company = contact.company_name || contact.company || enrichedData.current_company_name || contact.organization_name || '';

        console.log('🔍 Step 1b: Apollo PEOPLE_SEARCH for', name, 'at', company);

        const searchBody = {
          q_keywords: `${name} ${company}`,
          page: 1,
          per_page: 3
        };

        const searchResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, {
          method: 'POST',
          headers: getApolloHeaders(),
          body: JSON.stringify(searchBody)
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const people = searchData.people || [];

          if (people.length > 0) {
            const bestMatch = findBestMatch(people, name, company);

            if (bestMatch) {
              if (!apolloRawData) apolloRawData = bestMatch;
              const supplementalFields = extractSupplementalFields(bestMatch, { ...contact, ...enrichedData });
              enrichedData = mergeWithPrecedence(enrichedData, supplementalFields.data, contact);
              step1b.fieldsFound = supplementalFields.fieldsFound;
              supplementalFields.fieldsFound.forEach(f => { provenance[f] = 'apollo_search'; });
              step1b.status = 'success';

              console.log(`✅ Step 1b: Supplemented ${supplementalFields.fieldsFound.length} fields`);
            } else {
              step1b.status = 'no_match';
              step1b.message = 'No confident match in search results';
            }
          } else {
            step1b.status = 'no_results';
            step1b.message = 'Apollo search returned no results';
          }
        } else {
          await logApolloError(searchResponse, {}, 'barryEnrich-step1b');
          step1b.status = 'error';
          step1b.message = `Apollo returned ${searchResponse.status}`;
        }
      } catch (err) {
        step1b.status = 'error';
        step1b.message = err.message;
        console.error('❌ Step 1b failed:', err.message);
      }

      steps.push(step1b);
    }

    // ═══════════════════════════════════════════════════
    // STEP 1c: LinkedIn Search Fallback — if Apollo failed
    // ═══════════════════════════════════════════════════
    const postApolloData = { ...contact, ...enrichedData };
    const hasLinkedInUrl = !!(postApolloData.linkedin_url || enrichedData.linkedin_url);

    // Only run LinkedIn search if Apollo didn't find a LinkedIn URL
    if (!hasLinkedInUrl) {
      const step1c = {
        source: 'linkedin_search',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        const searchName = contact.name || enrichedData.name || '';
        const searchCompany = contact.company_name || contact.company || enrichedData.current_company_name || contact.organization_name || '';
        const searchTitle = contact.title || enrichedData.current_position_title || '';
        const emailDomain = extractEmailDomain(contact.email || contact.work_email || '');

        console.log('🔍 Step 1c: LinkedIn Search fallback for', searchName);

        const linkedinResult = await searchLinkedInProfile({
          name: searchName,
          company: searchCompany,
          title: searchTitle,
          emailDomain
        });

        if (linkedinResult.success && linkedinResult.linkedinUrl) {
          enrichedData.linkedin_url = linkedinResult.linkedinUrl;
          step1c.fieldsFound = ['linkedin_url'];
          step1c.status = 'success';
          step1c.message = linkedinResult.message;
          provenance.linkedin_url = 'linkedin_search';

          console.log(`✅ Step 1c: Found LinkedIn profile: ${linkedinResult.linkedinUrl}`);

          // Now that we have LinkedIn URL, try Apollo PEOPLE_MATCH again
          if (linkedinResult.linkedinUrl && linkedinResult.confidence !== 'low') {
            console.log('🔄 Re-running Apollo with discovered LinkedIn URL...');

            try {
              const reMatchResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
                method: 'POST',
                headers: getApolloHeaders(),
                body: JSON.stringify({ linkedin_url: linkedinResult.linkedinUrl })
              });

              if (reMatchResponse.ok) {
                const reMatchData = await reMatchResponse.json();
                const person = reMatchData.person;

                if (person) {
                  console.log('✅ Apollo re-match successful with LinkedIn URL');
                  apolloRawData = person;

                  const apolloFields = extractApolloFields(person, { ...contact, ...enrichedData });
                  enrichedData = mergeWithPrecedence(enrichedData, apolloFields.data, contact);

                  // Update provenance for newly found fields
                  apolloFields.fieldsFound.forEach(f => {
                    if (!provenance[f]) provenance[f] = 'apollo_match';
                  });

                  step1c.fieldsFound = [...new Set([...step1c.fieldsFound, ...apolloFields.fieldsFound])];
                  step1c.message = `LinkedIn found, Apollo enriched ${apolloFields.fieldsFound.length} additional fields`;
                }
              }
            } catch (reMatchErr) {
              console.error('Apollo re-match failed:', reMatchErr.message);
            }
          }
        } else {
          step1c.status = linkedinResult.message?.includes('not configured') ? 'skipped' : 'no_match';
          step1c.message = linkedinResult.message;
          console.log(`⚠️ Step 1c: ${linkedinResult.message}`);
        }
      } catch (err) {
        step1c.status = 'error';
        step1c.message = err.message;
        console.error('❌ Step 1c failed:', err.message);
      }

      steps.push(step1c);
    }

    // ═══════════════════════════════════════════════════
    // STEP 2: Google Places — company-level fallback
    // ═══════════════════════════════════════════════════
    const mergedSoFar = { ...contact, ...enrichedData };
    const needsCompanyData =
      !mergedSoFar.company_phone &&
      !mergedSoFar.company_website &&
      !mergedSoFar.company_address;

    const companyName = mergedSoFar.company_name || mergedSoFar.organization_name ||
      mergedSoFar.current_company_name || null;

    if (needsCompanyData && companyName) {
      const step2 = {
        source: 'google_places',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        console.log('🌐 Step 2: Google Places for', companyName);

        const googleResult = await googleBusinessLookup({
          companyName,
          domain: mergedSoFar.company_domain || null,
          city: mergedSoFar.city || null,
          state: mergedSoFar.state || null
        });

        step2.status = googleResult.status;
        step2.message = googleResult.message;

        if (googleResult.fieldsFound.length > 0) {
          enrichedData = mergeWithPrecedence(enrichedData, googleResult.data, contact);
          step2.fieldsFound = googleResult.fieldsFound;
          googleResult.fieldsFound.forEach(f => { provenance[f] = 'google_places'; });
          console.log(`✅ Step 2: Found ${googleResult.fieldsFound.length} company fields`);
        }
      } catch (err) {
        step2.status = 'error';
        step2.message = err.message;
        console.error('❌ Step 2 failed:', err.message);
      }

      steps.push(step2);
    }

    // ═══════════════════════════════════════════════════
    // BUILD FINAL RESULT — deterministic merge
    // ═══════════════════════════════════════════════════

    // Process phone numbers from Apollo
    const phoneNumbers = apolloRawData?.phone_numbers || [];
    const phoneByType = { mobile: null, direct: null, work: null, home: null };

    phoneNumbers.forEach(phone => {
      const type = phone.type?.toLowerCase() || 'other';
      if (phoneByType[type] !== undefined && !phoneByType[type]) {
        phoneByType[type] = phone.sanitized_number || phone.raw_number || phone.number;
      }
    });

    const primaryPhone = phoneByType.mobile || phoneByType.direct || phoneByType.work ||
                          phoneByType.home || phoneNumbers[0]?.sanitized_number || null;

    // Compute final missing fields + confidence (rule-based)
    const finalMissing = assessMissingData({ ...contact, ...enrichedData });
    const totalFieldsFound = steps.reduce((acc, s) => acc + (s.fieldsFound?.length || 0), 0);
    const confidence = computeConfidence(totalFieldsFound, finalMissing.length);

    const finalEnrichedData = {
      // Person contact info (Apollo-sourced)
      email: enrichedData.email || contact.email || null,
      email_status: enrichedData.email_status || contact.email_status || null,
      email_confidence: enrichedData.email_confidence || contact.email_confidence || null,

      // Phone (Apollo-sourced, person-level)
      phone: primaryPhone || contact.phone || null,
      phone_mobile: phoneByType.mobile || contact.phone_mobile || null,
      phone_direct: phoneByType.direct || contact.phone_direct || null,
      phone_work: phoneByType.work || contact.phone_work || null,
      phone_home: phoneByType.home || contact.phone_home || null,
      phone_numbers: phoneNumbers.length > 0 ? phoneNumbers : (contact.phone_numbers || []),

      // Social (Apollo-sourced)
      linkedin_url: enrichedData.linkedin_url || contact.linkedin_url || null,
      twitter_url: enrichedData.twitter_url || contact.twitter_url || null,
      facebook_url: enrichedData.facebook_url || contact.facebook_url || null,

      // Professional (Apollo-sourced)
      seniority: enrichedData.seniority || contact.seniority || null,
      departments: enrichedData.departments || contact.departments || [],
      functions: enrichedData.functions || contact.functions || [],

      // Current Employment (Apollo-sourced)
      // Primary fields - these are what the UI reads
      title: enrichedData.current_position_title || enrichedData.title || contact.title || null,
      company_name: enrichedData.current_company_name || enrichedData.company_name || contact.company_name || contact.company || null,
      // Legacy Apollo-style fields - kept for backward compatibility
      current_position_title: enrichedData.current_position_title || contact.title || null,
      current_company_name: enrichedData.current_company_name || contact.company_name || contact.company || null,
      job_start_date: enrichedData.job_start_date || contact.job_start_date || null,

      // History (Apollo-sourced)
      employment_history: enrichedData.employment_history || contact.employment_history || [],
      education: enrichedData.education || contact.education || [],

      // Location (Apollo person-level, or Google company-level)
      city: enrichedData.city || enrichedData.company_city || contact.city || null,
      state: enrichedData.state || enrichedData.company_state || contact.state || null,
      country: enrichedData.country || enrichedData.company_country || contact.country || null,
      time_zone: enrichedData.time_zone || contact.time_zone || null,

      // Metadata
      headline: enrichedData.headline || contact.headline || null,
      photo_url: enrichedData.photo_url || contact.photo_url || null,
      is_likely_decision_maker: enrichedData.is_likely_decision_maker || contact.is_likely_decision_maker || false,

      // Company-level data (Google-sourced)
      company_phone: enrichedData.company_phone || contact.company_phone || null,
      company_website: enrichedData.company_website || contact.company_website || null,
      company_address: enrichedData.company_address || contact.company_address || null,

      // Lead fields
      lead_status: contact.lead_status || 'saved',
      export_ready: true,
      last_enriched_at: new Date().toISOString(),
      data_sources: buildDataSources(steps),

      // Enrichment provenance — tracks where each field came from
      enrichment_provenance: provenance,
      enrichment_steps: steps.map(s => ({
        source: s.source,
        status: s.status,
        fieldsFound: s.fieldsFound || [],
        timestamp: s.timestamp,
        message: s.message || null
      })),

      // Rule-based enrichment summary (NO AI)
      enrichment_summary: {
        fields_found: Object.keys(provenance),
        fields_missing: finalMissing,
        confidence,
        total_steps: steps.length,
        sources_used: [...new Set(Object.values(provenance))],
        // Flag to indicate if manual LinkedIn URL input is needed
        needs_manual_linkedin: !enrichedData.linkedin_url && !contact.linkedin_url,
        // Enrichment quality assessment
        enrichment_quality: Object.keys(provenance).length >= 5 ? 'complete' :
                           Object.keys(provenance).length >= 2 ? 'partial' : 'minimal'
      },

      // Raw data for debugging
      _raw_apollo_data: apolloRawData ? {
        person_id: apolloRawData.id,
        enriched_at: new Date().toISOString(),
        total_phone_numbers: phoneNumbers.length
      } : contact._raw_apollo_data || null
    };

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryEnrich', 'success', {
      responseTime,
      metadata: {
        contactName: contact.name,
        stepsCompleted: steps.length,
        fieldsEnriched: Object.keys(provenance).length,
        confidence
      }
    });

    console.log(`✅ Barry Enrichment complete: ${Object.keys(provenance).length} fields enriched in ${responseTime}ms`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        enrichedData: finalEnrichedData,
        steps,
        provenance,
        summary: finalEnrichedData.enrichment_summary
      })
    };

  } catch (error) {
    console.error('❌ Error in barryEnrich:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryEnrich', 'error', {
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

// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS — all deterministic, no AI
// ═══════════════════════════════════════════════════

/**
 * Assess which key fields are missing from a contact.
 * Returns array of field names.
 */
function assessMissingData(contact) {
  const missing = [];

  if (!contact.email && !contact.work_email) missing.push('email');
  if (!contact.phone && !contact.phone_mobile && !contact.phone_direct) missing.push('phone');
  if (!contact.linkedin_url) missing.push('linkedin_url');
  if (!contact.city && !contact.state) missing.push('location');
  if (!contact.seniority) missing.push('seniority');
  if (!contact.departments || contact.departments.length === 0) missing.push('departments');
  if (!contact.employment_history || contact.employment_history.length === 0) missing.push('employment_history');
  if (!contact.education || contact.education.length === 0) missing.push('education');
  if (!contact.headline) missing.push('headline');
  if (!contact.photo_url) missing.push('photo_url');

  return missing;
}

/**
 * Step 0: Extract usable fields from existing contact data.
 * Checks alternate field names and normalizes.
 */
function extractInternalFields(contact) {
  const data = {};
  const fieldsFound = [];

  // Check for email in alternate locations
  if (!contact.email && contact.work_email) {
    data.email = contact.work_email;
    fieldsFound.push('email');
  }

  // Check for company name in alternate fields
  // CSV uploads use "company", other sources use "company_name" or "organization_name"
  if (!contact.company_name && contact.company) {
    data.current_company_name = contact.company;
    fieldsFound.push('company_name');
  }
  if (!contact.company_name && !contact.company && contact.organization_name) {
    data.current_company_name = contact.organization_name;
    fieldsFound.push('company_name');
  }
  if (!contact.company_name && !contact.company && contact.organization?.name) {
    data.current_company_name = contact.organization.name;
    fieldsFound.push('company_name');
  }

  // Check for location from organization data
  if ((!contact.city && !contact.state) && contact.organization) {
    if (contact.organization.city) {
      data.city = contact.organization.city;
      data.state = contact.organization.state || null;
      data.country = contact.organization.country || null;
      fieldsFound.push('location');
    }
  }

  // Check for website from organization
  if (!contact.company_website && contact.organization?.website_url) {
    data.company_website = contact.organization.website_url;
    fieldsFound.push('company_website');
  }

  // Normalize phone from alternate fields
  if (!contact.phone && !contact.phone_mobile && !contact.phone_direct) {
    if (contact.phone_work) {
      data.phone = contact.phone_work;
      fieldsFound.push('phone');
    } else if (contact.phone_home) {
      data.phone = contact.phone_home;
      fieldsFound.push('phone');
    }
  }

  return { data, fieldsFound };
}

/**
 * Extract enriched fields from Apollo person data.
 * Tracks which fields were actually new.
 */
function extractApolloFields(person, existingContact) {
  const data = {};
  const fieldsFound = [];

  if (person.email && !existingContact.email) {
    data.email = person.email;
    data.email_status = person.email_status || null;
    data.email_confidence = person.email_confidence || null;
    fieldsFound.push('email');
  }
  if (person.linkedin_url && !existingContact.linkedin_url) {
    data.linkedin_url = person.linkedin_url;
    fieldsFound.push('linkedin_url');
  }
  if (person.twitter_url && !existingContact.twitter_url) {
    data.twitter_url = person.twitter_url;
    fieldsFound.push('twitter_url');
  }
  if (person.facebook_url && !existingContact.facebook_url) {
    data.facebook_url = person.facebook_url;
    fieldsFound.push('facebook_url');
  }
  if (person.seniority && !existingContact.seniority) {
    data.seniority = person.seniority;
    fieldsFound.push('seniority');
  }
  if ((person.departments?.length > 0 || person.functions?.length > 0) &&
      (!existingContact.departments || existingContact.departments.length === 0)) {
    data.departments = person.departments || person.functions || [];
    fieldsFound.push('departments');
  }
  if (person.headline && !existingContact.headline) {
    data.headline = person.headline;
    fieldsFound.push('headline');
  }
  if (person.photo_url && !existingContact.photo_url) {
    data.photo_url = person.photo_url;
    fieldsFound.push('photo_url');
  }
  if ((person.city || person.state) && !existingContact.city && !existingContact.state) {
    data.city = person.city;
    data.state = person.state;
    data.country = person.country;
    data.time_zone = person.time_zone;
    fieldsFound.push('location');
  }
  if (person.employment_history?.length > 0 &&
      (!existingContact.employment_history || existingContact.employment_history.length === 0)) {
    data.employment_history = person.employment_history;
    data.current_position_title = person.employment_history[0]?.title || person.title;
    data.current_company_name = person.employment_history[0]?.organization_name;
    data.job_start_date = person.employment_history[0]?.start_date;
    fieldsFound.push('employment_history');
  }
  if (person.education?.length > 0 &&
      (!existingContact.education || existingContact.education.length === 0)) {
    data.education = person.education;
    fieldsFound.push('education');
  }

  // Decision maker inference (rule-based)
  data.is_likely_decision_maker = inferDecisionMaker(person.seniority, person.title);

  return { data, fieldsFound };
}

/**
 * Extract only supplemental fields not already present.
 */
function extractSupplementalFields(person, existingData) {
  const data = {};
  const fieldsFound = [];

  if (!existingData.email && person.email) {
    data.email = person.email;
    data.email_status = person.email_status;
    fieldsFound.push('email');
  }
  if (!existingData.linkedin_url && person.linkedin_url) {
    data.linkedin_url = person.linkedin_url;
    fieldsFound.push('linkedin_url');
  }
  if (!existingData.seniority && person.seniority) {
    data.seniority = person.seniority;
    fieldsFound.push('seniority');
  }
  if ((!existingData.city && !existingData.state) && (person.city || person.state)) {
    data.city = person.city;
    data.state = person.state;
    data.country = person.country;
    fieldsFound.push('location');
  }
  if (!existingData.headline && person.headline) {
    data.headline = person.headline;
    fieldsFound.push('headline');
  }
  if (!existingData.photo_url && person.photo_url) {
    data.photo_url = person.photo_url;
    fieldsFound.push('photo_url');
  }

  return { data, fieldsFound };
}

/**
 * Merge new data into enriched data, respecting precedence.
 * User-entered data is never overwritten.
 */
function mergeWithPrecedence(enrichedData, newData, originalContact) {
  const merged = { ...enrichedData };

  for (const [key, value] of Object.entries(newData)) {
    // Never overwrite user-entered data (from original contact)
    const userEntered = originalContact[key];
    if (userEntered && typeof userEntered === 'string' && userEntered.trim() !== '') {
      continue;
    }

    // Never overwrite already-enriched data (person-level beats company-level)
    if (merged[key] && typeof merged[key] === 'string' && merged[key].trim() !== '') {
      continue;
    }

    // Arrays: only overwrite if empty
    if (Array.isArray(merged[key]) && merged[key].length > 0) {
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

/**
 * Find best matching person from search results.
 * Score-based — name + company match required.
 */
function findBestMatch(people, targetName, targetCompany) {
  const normalize = (s) => (s || '').toLowerCase().trim();
  const targetNameNorm = normalize(targetName);
  const targetCompanyNorm = normalize(targetCompany);

  let bestScore = 0;
  let bestMatch = null;

  for (const person of people) {
    let score = 0;
    const personName = normalize(person.name || `${person.first_name} ${person.last_name}`);
    const personCompany = normalize(person.organization_name || person.organization?.name || '');

    if (personName === targetNameNorm) score += 3;
    else if (personName.includes(targetNameNorm) || targetNameNorm.includes(personName)) score += 1;

    if (personCompany === targetCompanyNorm) score += 2;
    else if (personCompany.includes(targetCompanyNorm) || targetCompanyNorm.includes(personCompany)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = person;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

/**
 * Compute confidence level — pure rules, no AI.
 */
function computeConfidence(fieldsFound, fieldsMissing) {
  if (fieldsFound >= 6 && fieldsMissing <= 2) return 'high';
  if (fieldsFound >= 3) return 'medium';
  return 'low';
}

/**
 * Build data_sources array from enrichment steps.
 */
function buildDataSources(steps) {
  const sources = new Set();
  steps.forEach(step => {
    if (step.status === 'success' && step.fieldsFound?.length > 0) {
      if (step.source.startsWith('apollo')) sources.add('apollo');
      if (step.source === 'google_places') sources.add('google');
      if (step.source === 'internal_db') sources.add('internal');
      if (step.source === 'linkedin_search') sources.add('linkedin');
    }
  });
  return Array.from(sources);
}

/**
 * Infer decision maker status — rule-based.
 */
function inferDecisionMaker(seniority, title) {
  if (!seniority && !title) return false;

  const seniorityStr = (seniority || '').toLowerCase();
  const titleStr = (title || '').toLowerCase();

  if (seniorityStr.includes('c_suite') || seniorityStr.includes('c-suite') ||
      titleStr.includes('chief') || titleStr.match(/\b(ceo|cfo|cto|cmo|coo|cro|ciso)\b/)) return true;
  if (seniorityStr.includes('vp') || seniorityStr.includes('vice_president') ||
      titleStr.includes('vice president') || titleStr.includes(' vp ')) return true;
  if (seniorityStr.includes('director') || titleStr.includes('director')) return true;
  if (titleStr.includes('head of') || titleStr.includes('owner')) return true;

  return false;
}
