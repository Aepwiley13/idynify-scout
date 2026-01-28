/**
 * BARRY ENRICHMENT ORCHESTRATOR
 *
 * User-initiated, multi-source enrichment orchestrated by Barry AI.
 *
 * FLOW:
 * 1. User clicks "Enrich with Barry" on a contact profile
 * 2. Barry checks what data is missing
 * 3. Step 1: Apollo PEOPLE_MATCH (by ID or LinkedIn URL)
 * 4. Step 2: Apollo PEOPLE_SEARCH (fuzzy fallback if step 1 gaps remain)
 * 5. Step 3: Barry AI synthesizes findings + explains gaps
 * 6. Returns enriched data with full provenance (what came from where)
 *
 * DESIGN PRINCIPLES:
 * - User-initiated only (never automatic)
 * - Every field tracks its source
 * - Barry explains what was found and what's missing
 * - Extensible: new sources can be added to the pipeline
 *
 * Last updated: January 2026
 */

import Anthropic from '@anthropic-ai/sdk';
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
    const { userId, authToken, contact } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry Enrichment starting for:', contact.name);

    // Validate API keys
    const apolloApiKey = getApolloApiKey();
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured');
    }

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
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth verified');

    // ─── Assess what's missing ───
    const missingFields = assessMissingData(contact);
    console.log('📋 Missing fields:', missingFields);

    // Track enrichment steps for provenance
    const steps = [];
    let enrichedData = {};
    let apolloRawData = null;

    // ─── STEP 1: Apollo PEOPLE_MATCH (primary source) ───
    const hasApolloId = !!contact.apollo_person_id;
    const hasLinkedIn = !!contact.linkedin_url;

    if (hasApolloId || hasLinkedIn) {
      const step1 = { source: 'apollo_match', status: 'running', fieldsFound: [], timestamp: new Date().toISOString() };

      try {
        const matchBody = hasApolloId
          ? { id: contact.apollo_person_id }
          : { linkedin_url: contact.linkedin_url };

        console.log('🔍 Step 1: Apollo PEOPLE_MATCH', hasApolloId ? 'by ID' : 'by LinkedIn URL');

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
              logValidationErrors(validation, mapped, 'barryEnrich-step1');
            }

            // Extract enriched fields with provenance
            const apolloFields = extractApolloFields(person);
            enrichedData = { ...enrichedData, ...apolloFields.data };
            step1.fieldsFound = apolloFields.fieldsFound;
            step1.status = 'success';

            console.log(`✅ Step 1: Found ${apolloFields.fieldsFound.length} fields`);
          } else {
            step1.status = 'no_data';
            step1.message = 'Apollo returned no person data';
          }
        } else {
          await logApolloError(apolloResponse, { id: contact.apollo_person_id }, 'barryEnrich-step1');
          step1.status = 'error';
          step1.message = `Apollo returned ${apolloResponse.status}`;
        }
      } catch (err) {
        step1.status = 'error';
        step1.message = err.message;
        console.error('❌ Step 1 failed:', err.message);
      }

      steps.push(step1);
    }

    // ─── STEP 2: Apollo PEOPLE_SEARCH (fuzzy fallback) ───
    const stillMissing = assessMissingData({ ...contact, ...enrichedData });
    const hasNameAndCompany = (contact.name || enrichedData.name) && (contact.company_name || enrichedData.current_company_name);

    if (stillMissing.length > 0 && hasNameAndCompany && !hasApolloId) {
      const step2 = { source: 'apollo_search', status: 'running', fieldsFound: [], timestamp: new Date().toISOString() };

      try {
        const name = contact.name || enrichedData.name || '';
        const company = contact.company_name || enrichedData.current_company_name || '';

        console.log('🔍 Step 2: Apollo PEOPLE_SEARCH for', name, 'at', company);

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
            // Find best match by name similarity
            const bestMatch = findBestMatch(people, name, company);

            if (bestMatch) {
              const supplementalFields = extractSupplementalFields(bestMatch, enrichedData);
              enrichedData = { ...enrichedData, ...supplementalFields.data };
              step2.fieldsFound = supplementalFields.fieldsFound;
              step2.status = 'success';
              step2.matchConfidence = supplementalFields.confidence;

              console.log(`✅ Step 2: Supplemented ${supplementalFields.fieldsFound.length} fields`);
            } else {
              step2.status = 'no_match';
              step2.message = 'No confident match found in search results';
            }
          } else {
            step2.status = 'no_results';
            step2.message = 'Apollo search returned no results';
          }
        } else {
          await logApolloError(searchResponse, {}, 'barryEnrich-step2');
          step2.status = 'error';
          step2.message = `Apollo returned ${searchResponse.status}`;
        }
      } catch (err) {
        step2.status = 'error';
        step2.message = err.message;
        console.error('❌ Step 2 failed:', err.message);
      }

      steps.push(step2);
    }

    // ─── STEP 3: Barry AI Analysis ───
    const step3 = { source: 'barry_ai', status: 'running', timestamp: new Date().toISOString() };

    try {
      console.log('🐻 Step 3: Barry analyzing enrichment results...');

      const anthropic = new Anthropic({ apiKey: claudeApiKey });

      const finalMissing = assessMissingData({ ...contact, ...enrichedData });
      const fieldsFoundTotal = steps.reduce((acc, s) => [...acc, ...s.fieldsFound], []);

      const analysisPrompt = `You are Barry, a research assistant helping a user understand the enrichment results for a business contact.

CONTACT BEING ENRICHED:
Name: ${contact.name || enrichedData.name || 'Unknown'}
Title: ${contact.title || enrichedData.current_position_title || 'Unknown'}
Company: ${contact.company_name || enrichedData.current_company_name || 'Unknown'}
LinkedIn: ${contact.linkedin_url || enrichedData.linkedin_url || 'Not available'}

ENRICHMENT STEPS COMPLETED:
${steps.map((s, i) => `Step ${i + 1} (${s.source}): ${s.status} - Found: ${s.fieldsFound.join(', ') || 'nothing'}`).join('\n')}

FIELDS SUCCESSFULLY ENRICHED:
${fieldsFoundTotal.length > 0 ? fieldsFoundTotal.join(', ') : 'None'}

FIELDS STILL MISSING:
${finalMissing.length > 0 ? finalMissing.join(', ') : 'None - all key fields populated'}

ENRICHED DATA SNAPSHOT:
- Email: ${enrichedData.email || contact.email || 'Not found'}
- Email Status: ${enrichedData.email_status || 'Unknown'}
- Phone: ${enrichedData.phone || contact.phone || 'Not found'}
- LinkedIn: ${enrichedData.linkedin_url || contact.linkedin_url || 'Not found'}
- Location: ${[enrichedData.city, enrichedData.state, enrichedData.country].filter(Boolean).join(', ') || 'Not found'}

YOUR TASK:
Generate a brief enrichment summary explaining what was found and what's missing. Be honest and specific.

REQUIRED OUTPUT FORMAT (JSON):
{
  "summary": "One sentence overview of enrichment results",
  "found": ["Human-readable description of each key finding"],
  "notFound": ["Human-readable description of each missing field and why it might be unavailable"],
  "confidence": "high" | "medium" | "low",
  "confidenceReason": "One sentence explaining the confidence level",
  "suggestion": "One actionable next step if data is still missing (or null if complete)"
}

Be direct and factual. No sales language. Respond ONLY with valid JSON.`;

      const claudeResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        messages: [{ role: 'user', content: analysisPrompt }]
      });

      const responseText = claudeResponse.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        step3.status = 'success';
        step3.analysis = analysis;
        console.log('✅ Step 3: Barry analysis complete');
      } else {
        step3.status = 'parse_error';
        step3.message = 'Could not parse Barry response';
      }
    } catch (err) {
      step3.status = 'error';
      step3.message = err.message;
      console.error('❌ Step 3 failed:', err.message);
    }

    steps.push(step3);

    // ─── Build final enrichment result ───

    // Process phone numbers from Apollo data
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

    // Build provenance map (which field came from which source)
    const provenance = {};
    steps.forEach(step => {
      if (step.fieldsFound) {
        step.fieldsFound.forEach(field => {
          provenance[field] = step.source;
        });
      }
    });

    const finalEnrichedData = {
      // Contact Info
      email: enrichedData.email || contact.email || null,
      email_status: enrichedData.email_status || null,
      email_confidence: enrichedData.email_confidence || null,

      // Phone
      phone: primaryPhone || contact.phone || null,
      phone_mobile: phoneByType.mobile || contact.phone_mobile || null,
      phone_direct: phoneByType.direct || contact.phone_direct || null,
      phone_work: phoneByType.work || contact.phone_work || null,
      phone_home: phoneByType.home || contact.phone_home || null,
      phone_numbers: phoneNumbers.length > 0 ? phoneNumbers : (contact.phone_numbers || []),

      // Social
      linkedin_url: enrichedData.linkedin_url || contact.linkedin_url || null,
      twitter_url: enrichedData.twitter_url || contact.twitter_url || null,
      facebook_url: enrichedData.facebook_url || contact.facebook_url || null,

      // Professional
      seniority: enrichedData.seniority || contact.seniority || null,
      departments: enrichedData.departments || contact.departments || [],
      functions: enrichedData.functions || contact.functions || [],

      // Current Employment
      current_position_title: enrichedData.current_position_title || contact.title || null,
      current_company_name: enrichedData.current_company_name || contact.company_name || null,
      job_start_date: enrichedData.job_start_date || contact.job_start_date || null,

      // History
      employment_history: enrichedData.employment_history || contact.employment_history || [],
      education: enrichedData.education || contact.education || [],

      // Location
      city: enrichedData.city || contact.city || null,
      state: enrichedData.state || contact.state || null,
      country: enrichedData.country || contact.country || null,
      time_zone: enrichedData.time_zone || contact.time_zone || null,

      // Metadata
      headline: enrichedData.headline || contact.headline || null,
      photo_url: enrichedData.photo_url || contact.photo_url || null,
      is_likely_decision_maker: enrichedData.is_likely_decision_maker || contact.is_likely_decision_maker || false,

      // Lead fields
      lead_status: contact.lead_status || 'saved',
      export_ready: true,
      last_enriched_at: new Date().toISOString(),
      data_sources: buildDataSources(steps),

      // Enrichment provenance (NEW - tracks where each field came from)
      enrichment_provenance: provenance,
      enrichment_steps: steps.map(s => ({
        source: s.source,
        status: s.status,
        fieldsFound: s.fieldsFound || [],
        timestamp: s.timestamp,
        message: s.message || null
      })),
      enrichment_analysis: step3.analysis || null,

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
        confidence: step3.analysis?.confidence || 'unknown'
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
        analysis: step3.analysis || null,
        provenance
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

// ─── Helper Functions ───

/**
 * Assess which key fields are missing from a contact
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
 * Extract enriched fields from Apollo person data with tracking
 */
function extractApolloFields(person) {
  const data = {};
  const fieldsFound = [];

  if (person.email) { data.email = person.email; data.email_status = person.email_status || null; data.email_confidence = person.email_confidence || null; fieldsFound.push('email'); }
  if (person.linkedin_url) { data.linkedin_url = person.linkedin_url; fieldsFound.push('linkedin_url'); }
  if (person.twitter_url) { data.twitter_url = person.twitter_url; fieldsFound.push('twitter_url'); }
  if (person.facebook_url) { data.facebook_url = person.facebook_url; fieldsFound.push('facebook_url'); }
  if (person.seniority) { data.seniority = person.seniority; fieldsFound.push('seniority'); }
  if (person.departments?.length > 0 || person.functions?.length > 0) { data.departments = person.departments || person.functions || []; fieldsFound.push('departments'); }
  if (person.headline) { data.headline = person.headline; fieldsFound.push('headline'); }
  if (person.photo_url) { data.photo_url = person.photo_url; fieldsFound.push('photo_url'); }
  if (person.city || person.state) { data.city = person.city; data.state = person.state; data.country = person.country; data.time_zone = person.time_zone; fieldsFound.push('location'); }
  if (person.employment_history?.length > 0) {
    data.employment_history = person.employment_history;
    data.current_position_title = person.employment_history[0]?.title || person.title;
    data.current_company_name = person.employment_history[0]?.organization_name;
    data.job_start_date = person.employment_history[0]?.start_date;
    fieldsFound.push('employment_history');
  }
  if (person.education?.length > 0) { data.education = person.education; fieldsFound.push('education'); }
  if (person.functions?.length > 0 && !data.departments?.length) { data.functions = person.functions; fieldsFound.push('functions'); }

  // Decision maker inference
  data.is_likely_decision_maker = inferDecisionMaker(person.seniority, person.title);

  return { data, fieldsFound };
}

/**
 * Extract only supplemental fields (fields not already enriched)
 */
function extractSupplementalFields(person, existingData) {
  const data = {};
  const fieldsFound = [];
  let confidence = 'medium';

  // Only fill gaps
  if (!existingData.email && person.email) { data.email = person.email; data.email_status = person.email_status; fieldsFound.push('email'); }
  if (!existingData.linkedin_url && person.linkedin_url) { data.linkedin_url = person.linkedin_url; fieldsFound.push('linkedin_url'); }
  if (!existingData.seniority && person.seniority) { data.seniority = person.seniority; fieldsFound.push('seniority'); }
  if ((!existingData.city && !existingData.state) && (person.city || person.state)) {
    data.city = person.city; data.state = person.state; data.country = person.country;
    fieldsFound.push('location');
  }
  if (!existingData.headline && person.headline) { data.headline = person.headline; fieldsFound.push('headline'); }
  if (!existingData.photo_url && person.photo_url) { data.photo_url = person.photo_url; fieldsFound.push('photo_url'); }

  if (fieldsFound.length === 0) confidence = 'low';
  if (fieldsFound.length > 3) confidence = 'high';

  return { data, fieldsFound, confidence };
}

/**
 * Find best matching person from search results
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

    // Name match
    if (personName === targetNameNorm) score += 3;
    else if (personName.includes(targetNameNorm) || targetNameNorm.includes(personName)) score += 1;

    // Company match
    if (personCompany === targetCompanyNorm) score += 2;
    else if (personCompany.includes(targetCompanyNorm) || targetCompanyNorm.includes(personCompany)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = person;
    }
  }

  // Only return if there's a reasonable match
  return bestScore >= 3 ? bestMatch : null;
}

/**
 * Build data_sources array from enrichment steps
 */
function buildDataSources(steps) {
  const sources = new Set();
  steps.forEach(step => {
    if (step.status === 'success' && step.fieldsFound?.length > 0) {
      if (step.source.startsWith('apollo')) sources.add('apollo');
      if (step.source === 'barry_ai') sources.add('ai_analysis');
    }
  });
  return Array.from(sources);
}

/**
 * Infer if contact is likely a decision maker
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
