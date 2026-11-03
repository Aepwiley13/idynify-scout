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
 * MERGE RULES (deterministic, not AI) — src/utils/contactProtection.js:
 * - The contact's own values win; enrichment fills empty fields only
 * - Name, email, phones, company and website are never overwritten
 * - A different title or company is returned as a suggestion, not written
 * - Location is filled as one unit; person-level beats company-level
 * - Every written field gets a source tag in enrichment_provenance
 *
 * WHO THE PERSON IS (the same rules as Find LinkedIn, #731/#732)
 * ─────────────────────────────────────────────────────────────
 * Person details come only from an exact Apollo match: the contact's own
 * Apollo id or its own LinkedIn URL. A LinkedIn profile Barry finds any other
 * way (Apollo's people search, Google, or the LinkedIn on the matched record)
 * is never written and its record is never read: it comes back in
 * `linkedinCandidates`, ranked by Find LinkedIn's rules, for the user to
 * confirm through Find LinkedIn's confirm (the duplicate check, then the
 * exact lookup).
 *
 * WHERE THE RESULT IS WRITTEN (#738)
 * ─────────────────────────────────
 * With `save: true` and a `contactId` (the contact profile), the result is
 * written here, in one Firestore transaction on the contact as it is stored
 * NOW: users/{uid}/contacts/{contactId}, with uid from the verified token.
 * What may be written is decided inside that transaction, against that
 * latest copy, so a field the contact gained after the browser loaded it
 * (another tab, device or teammate) is never overwritten, and provenance is
 * added entry by entry, so an entry written meanwhile survives. If the
 * contact changes while the transaction runs, Firestore retries it and the
 * decision is made again on the new state.
 *
 * Without `save` (Relationship First Value), nothing is written: the answer
 * is computed against the contact the request sent, for display only.
 *
 * Logs carry step names, statuses and counts: never a name, email, phone,
 * company, title or URL.
 */

import process from 'node:process';
import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';
import { mapApolloToScoutContact, validateScoutContact, logValidationErrors } from './utils/scoutContactContract.js';
import { googleBusinessLookup } from './utils/googleBusinessLookup.js';
import { searchLinkedInCandidates, searchLinkedInPhoto } from './utils/linkedinSearch.js';
import { rankLinkedInCandidates, readPerson, candidateFromApolloPerson } from './utils/capture/linkedinCandidates.js';
import { enrichmentPatch } from '../../src/utils/contactProtection.js';
import { load } from 'cheerio';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contact, person: requestedPerson, contactId, save } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters');
    }
    // A saved run names one contact document; never a path.
    if (save && (typeof contactId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(contactId))) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry Enrichment starting');

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

    // Who to look for on LinkedIn: the details the browser sent (Find
    // LinkedIn's search person), else the contact's own name, company and
    // title. Only when the contact has no LinkedIn of its own.
    const hasOwnLinkedIn = Boolean(contact.linkedin_url);
    const searchPerson = hasOwnLinkedIn ? null : (readPerson(requestedPerson) ?? readPerson({
      name: typeof contact.name === 'string' ? contact.name : null,
      company: [contact.company_name, contact.company].find(v => typeof v === 'string' && v.trim()) ?? null,
      title: typeof contact.title === 'string' ? contact.title : null,
    }));
    const profilesFound = [];

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

            // Its LinkedIn is still only a profile to confirm.
            const candidate = searchPerson ? candidateFromApolloPerson(person) : null;
            if (candidate) profilesFound.push(candidate);

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

    // Step 1b: Apollo PEOPLE_SEARCH: profiles to offer, never details to copy.
    // A search by name and company can return a namesake; its LinkedIn is a
    // candidate for the user to confirm, and nothing else of it is used.
    const hasNameAndCompany = (contact.name || enrichedData.name) &&
      (contact.company_name || contact.company || enrichedData.current_company_name || contact.organization_name);

    if (searchPerson && hasNameAndCompany && !hasApolloId) {
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

        console.log('🔍 Step 1b: Apollo PEOPLE_SEARCH for LinkedIn profiles');

        const searchResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, {
          method: 'POST',
          headers: getApolloHeaders(),
          body: JSON.stringify({ q_keywords: `${name} ${company}`, page: 1, per_page: 3 })
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const people = (searchData.people || []).map(candidateFromApolloPerson).filter(Boolean);
          profilesFound.push(...people);
          step1b.status = people.length > 0 ? 'success' : 'no_results';
          step1b.message = people.length > 0 ? `${people.length} possible LinkedIn profile(s) to confirm` : 'Apollo search returned no profiles';
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
    // STEP 1c: LinkedIn search — profiles to confirm, never attached
    // ═══════════════════════════════════════════════════
    // The same Google search Find LinkedIn uses. A profile found here is not
    // the person until the user says so: no URL is written, no record is read
    // for it, and no photo is taken from it.
    if (searchPerson) {
      const step1c = {
        source: 'linkedin_search',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        console.log('🔍 Step 1c: LinkedIn search for profiles to confirm');

        const search = await searchLinkedInCandidates({
          name: searchPerson.name,
          company: searchPerson.company,
          title: searchPerson.title,
          domain: searchPerson.domain,
          env: process.env,
        });
        profilesFound.push(...search.results.map(result => ({ ...result, source: 'search' })));

        if (!search.configured) {
          step1c.status = 'skipped';
          step1c.message = 'LinkedIn search not configured';
        } else if (search.failed) {
          step1c.status = 'error';
          step1c.message = 'LinkedIn search failed';
        } else {
          step1c.status = search.results.length > 0 ? 'success' : 'no_match';
          step1c.message = search.results.length > 0 ? `${search.results.length} possible LinkedIn profile(s) to confirm` : 'No LinkedIn profile found';
        }
      } catch (err) {
        step1c.status = 'error';
        step1c.message = err.message;
        console.error('❌ Step 1c failed:', err.message);
      }

      steps.push(step1c);
    }

    // The profiles to offer, best first, by Find LinkedIn's rules.
    const linkedinCandidates = searchPerson ? rankLinkedInCandidates(searchPerson, profilesFound) : [];

    // ═══════════════════════════════════════════════════
    // STEP 1d: LinkedIn Photo Search — if we have LinkedIn URL but no photo
    // ═══════════════════════════════════════════════════
    const currentLinkedInUrl = contact.linkedin_url;
    const currentPhotoUrl = enrichedData.photo_url || contact.photo_url;

    if (currentLinkedInUrl && !currentPhotoUrl) {
      const step1d = {
        source: 'linkedin_photo_search',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        console.log('📷 Step 1d: Searching for LinkedIn photo via Google...');

        const photoResult = await searchLinkedInPhoto({
          linkedinUrl: currentLinkedInUrl,
          name: contact.name || enrichedData.name || ''
        });

        if (photoResult.success && photoResult.photoUrl) {
          enrichedData.photo_url = photoResult.photoUrl;
          step1d.fieldsFound = ['photo_url'];
          step1d.status = 'success';
          step1d.message = photoResult.message;
          provenance.photo_url = 'linkedin_photo_search';

          console.log('✅ Step 1d: Found photo');
        } else {
          step1d.status = 'no_data';
          step1d.message = photoResult.message;
          console.log('⚠️ Step 1d: no photo');
        }
      } catch (err) {
        step1d.status = 'error';
        step1d.message = err.message;
        console.error('❌ Step 1d failed:', err.message);
      }

      steps.push(step1d);
    }

    // ═══════════════════════════════════════════════════
    // STEP 1e: Website Scrape Fallback — email missing after Apollo
    // ═══════════════════════════════════════════════════
    const mergedAfterApollo = { ...contact, ...enrichedData };
    const emailStillMissing = !mergedAfterApollo.email && !mergedAfterApollo.work_email;
    const websiteForScrape = mergedAfterApollo.company_website ||
      mergedAfterApollo.website_url ||
      mergedAfterApollo.company_domain || null;

    if (emailStillMissing && websiteForScrape) {
      const step1e = {
        source: 'website_scrape',
        status: 'running',
        fieldsFound: [],
        timestamp: new Date().toISOString(),
        message: null
      };

      try {
        console.log('🌐 Step 1e: Website scrape fallback for email');

        const scrapeResult = await scrapeWebsiteForEmail(websiteForScrape);

        if (scrapeResult.email) {
          enrichedData.email = scrapeResult.email;
          enrichedData.emailSource = 'website';
          step1e.fieldsFound = ['email'];
          step1e.status = 'success';
          step1e.message = `Found email on ${scrapeResult.foundOn}`;
          provenance.email = 'website_scrape';
          console.log('✅ Step 1e: Found an email on the website');
        } else {
          step1e.status = 'no_data';
          step1e.message = 'No email found on website';
          console.log('⚠️ Step 1e: No email found on website');
        }
      } catch (err) {
        step1e.status = 'error';
        step1e.message = err.message;
        console.error('❌ Step 1e failed:', err.message);
      }

      steps.push(step1e);
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
        console.log('🌐 Step 2: Google Places for the company');

        const googleResult = await googleBusinessLookup({
          companyName,
          domain: mergedSoFar.company_domain || null,
          city: mergedSoFar.city || mergedSoFar.company_city || null,
          state: mergedSoFar.state || mergedSoFar.company_state || null
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

    const phoneNumbers = apolloRawData?.phone_numbers || [];

    // What may be written, decided against `base`: the contact as stored at
    // the moment of the write when saving (inside the transaction below), or
    // the contact the request sent when only showing the result.
    const decide = (base) => {
      // Compute final missing fields + confidence (rule-based)
      const finalMissing = assessMissingData({ ...base, ...enrichedData });
      const totalFieldsFound = steps.reduce((acc, s) => acc + (s.fieldsFound?.length || 0), 0);
      const confidence = computeConfidence(totalFieldsFound, finalMissing.length);

      // What may be written onto the contact: its own values win, enrichment
      // fills empty fields, and a different title or company is a suggestion
      // (src/utils/contactProtection.js, the rules #732 set for LinkedIn).
      const { patch, filled, suggestions } = enrichmentPatch(base, enrichedData, {
        provenance,
        phoneNumbers,
        person: apolloRawData,
      });

      const finalEnrichedData = {
        ...patch,

        // Lead fields
        lead_status: base.lead_status || 'saved',
        export_ready: true,
        last_enriched_at: new Date().toISOString(),
        data_sources: buildDataSources(steps),

        // enrichment_provenance comes from the patch: every existing entry, plus
        // the source of each field written here.
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
          fields_filled: filled,
          fields_missing: finalMissing,
          confidence,
          total_steps: steps.length,
          sources_used: [...new Set(Object.values(provenance))],
          // No LinkedIn and none found: the profile offers a pasted link instead
          needs_manual_linkedin: !base.linkedin_url && linkedinCandidates.length === 0,
          // Enrichment quality assessment
          enrichment_quality: Object.keys(provenance).length >= 5 ? 'complete' :
                             Object.keys(provenance).length >= 2 ? 'partial' : 'minimal'
        },

        // Raw data for debugging
        _raw_apollo_data: apolloRawData ? {
          person_id: apolloRawData.id,
          enriched_at: new Date().toISOString(),
          total_phone_numbers: phoneNumbers.length
        } : base._raw_apollo_data || null
      };

      // A company filled where the contact had none: the browser links it
      // through the shared company resolver, with the matched organization.
      const company = filled.includes('company_name') ? {
        name: patch.company_name,
        apollo_organization_id: apolloRawData?.organization_id || apolloRawData?.organization?.id || null,
        domain: apolloRawData?.organization?.primary_domain || null,
      } : null;
      return { finalEnrichedData, company, suggestions, confidence };
    };

    let decided;
    if (save) {
      // uid is the verified token's (checked against userId above); the
      // contact is addressed by id alone.
      const { db } = await import('./firebase-admin.js');
      const ref = db.doc(`users/${userId}/contacts/${contactId}`);
      decided = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Contact not found');
        const latest = { id: snap.id, ...snap.data() };
        const result = decide(latest);
        tx.update(ref, firestoreUpdate(result.finalEnrichedData, latest));
        return result;
      });
    } else {
      decided = decide(contact);
    }
    const { finalEnrichedData, company, suggestions, confidence } = decided;

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryEnrich', 'success', {
      responseTime,
      metadata: {
        stepsCompleted: steps.length,
        fieldsEnriched: Object.keys(provenance).length,
        linkedinCandidates: linkedinCandidates.length,
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
        suggestions,
        linkedinCandidates,
        company,
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
 * The Firestore update for a saved run: every written field, with
 * provenance set entry by entry (`enrichment_provenance.<field>`) rather than
 * as a whole map, so an entry written meanwhile is never dropped.
 */
function firestoreUpdate(finalEnrichedData, latest) {
  const { enrichment_provenance: provenance = {}, ...fields } = finalEnrichedData;
  const update = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const before = latest.enrichment_provenance ?? {};
  for (const [field, source] of Object.entries(provenance)) {
    if (source !== undefined && before[field] !== source) update[`enrichment_provenance.${field}`] = source;
  }
  return update;
}

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

  // The organization's location is where the company is, not the person:
  // kept as the company location, so a person-level location found later wins
  // and this one is used only as a whole fallback.
  if ((!contact.city && !contact.state) && contact.organization) {
    if (contact.organization.city) {
      data.company_city = contact.organization.city;
      data.company_state = contact.organization.state || null;
      data.company_country = contact.organization.country || null;
      fieldsFound.push('company_location');
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
  // A LinkedIn URL is never copied: the user confirms it (linkedinCandidates).
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

// A location is one fact: its parts are taken together from one source, or
// not at all, so a city from one source never sits beside a state from another.
const LOCATION_GROUPS = [
  ['city', 'state', 'country', 'time_zone'],
  ['company_city', 'company_state', 'company_country', 'company_zip'],
];
const hasText = v => typeof v === 'string' && v.trim() !== '';

/**
 * Merge new data into enriched data, respecting precedence.
 * User-entered data is never overwritten.
 */
function mergeWithPrecedence(enrichedData, newData, originalContact) {
  const merged = { ...enrichedData };
  const rest = { ...newData };

  for (const group of LOCATION_GROUPS) {
    const offered = group.filter(key => key in rest);
    if (offered.length === 0) continue;
    const taken = group.some(key => hasText(originalContact[key]) || hasText(merged[key]));
    const usable = group.some(key => hasText(rest[key]));
    if (!taken && usable) {
      for (const key of group) if (key in rest) merged[key] = rest[key];
    }
    for (const key of offered) delete rest[key];
  }

  for (const [key, value] of Object.entries(rest)) {
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
      if (step.source === 'linkedin_photo_search') sources.add('linkedin');
      if (step.source === 'website_scrape') sources.add('website');
    }
  });
  return Array.from(sources);
}

/**
 * Extract emails from HTML using cheerio and regex.
 * Prioritizes emails matching the domain.
 */
function extractEmailsFromHTML(html, domain) {
  const $ = load(html);
  const emails = new Set();

  // Method 1: mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
    if (email.includes('@')) emails.add(email.toLowerCase());
  });

  // Method 2: regex scan of visible text and raw HTML
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex) || [];
  matches.forEach(email => {
    // Filter out image/asset false positives
    if (!email.includes('.png') && !email.includes('.jpg') && !email.includes('.svg')) {
      emails.add(email.toLowerCase());
    }
  });

  // Method 3: prioritize emails matching the domain
  const domainEmails = [...emails].filter(e => e.includes(domain));
  return domainEmails.length > 0 ? domainEmails : [...emails];
}

/**
 * Scrape a website for contact email addresses.
 * Fetches homepage, /contact, and /about in parallel.
 */
async function scrapeWebsiteForEmail(websiteUrl) {
  let domain;
  try {
    const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const url = new URL(normalizedUrl);
    domain = url.hostname.replace('www.', '');
  } catch {
    return { email: null };
  }

  const pages = ['', '/contact', '/about'];
  const results = await Promise.all(
    pages.map(path =>
      fetch(`https://${domain}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
        signal: AbortSignal.timeout(5000)
      })
      .then(r => r.text())
      .catch(() => '')
    )
  );

  const allHTML = results.join(' ');
  const emails = extractEmailsFromHTML(allHTML, domain);

  return {
    email: emails[0] || null,
    foundOn: domain
  };
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
