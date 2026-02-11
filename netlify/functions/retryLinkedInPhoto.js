/**
 * RETRY LINKEDIN PHOTO ENRICHMENT
 *
 * Dedicated function for retrying LinkedIn profile photo enrichment only.
 * Scoped strictly to photo — does NOT re-run full enrichment pipeline.
 *
 * If no LinkedIn URL is stored, will search for it first using name+company,
 * then fetch the photo. Saves both linkedin_url and photo_url if discovered.
 *
 * Strategies (in order):
 *   0. Apollo PEOPLE_MATCH — re-enrich via Apollo to get fresh photo_url
 *   1. searchLinkedInPhoto — targeted Google search for LinkedIn profile photo
 *   2. searchLinkedInProfile — broader Google search with multiple strategies
 *   3. Google Image Search — image-specific search for LinkedIn profile
 *
 * Each candidate URL is validated with a HEAD request to reject 404s.
 * URLs matching the current broken photo are skipped.
 *
 * Rate limited: max 3 retries per lead per hour.
 */

import { logApiUsage } from './utils/logApiUsage.js';
import { searchLinkedInPhoto, searchLinkedInProfile } from './utils/linkedinSearch.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';

const MAX_RETRIES_PER_HOUR = 3;
const PHOTO_VALIDATE_TIMEOUT = 5000;

// ── Helpers ──

const PLACEHOLDER_PATTERNS = [
  'ghost-person', 'ghost_person', 'default-avatar', 'no-photo',
  'placeholder', '/static.licdn.com/sc/h/', 'data:image'
];

function isPlaceholderUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

async function isPhotoUrlReachable(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PHOTO_VALIDATE_TIMEOUT);
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`⚠️ Photo validation: ${response.status} for ${url}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(`⚠️ Photo validation error: ${err.message}`);
    return false;
  }
}

/**
 * Fetch photo from Apollo PEOPLE_MATCH API.
 * Apollo is already working (per logs) — use it to get a fresh photo_url.
 */
async function fetchApolloPhoto({ linkedinUrl, name, company }) {
  try {
    const matchBody = linkedinUrl
      ? { linkedin_url: linkedinUrl }
      : { name, organization_name: company };

    console.log(`📷 Apollo photo fetch: ${linkedinUrl || name}`);

    const response = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(matchBody)
    });

    if (!response.ok) {
      return { success: false, photoUrl: null, message: `Apollo returned ${response.status}` };
    }

    const data = await response.json();
    const person = data.person;

    if (person && person.photo_url) {
      console.log(`✅ Apollo returned photo: ${person.photo_url}`);
      return {
        success: true,
        photoUrl: person.photo_url,
        linkedinUrl: person.linkedin_url || null,
        message: 'Photo found via Apollo'
      };
    }

    return {
      success: false,
      photoUrl: null,
      linkedinUrl: person?.linkedin_url || null,
      message: person ? 'Apollo person found but no photo_url' : 'No person found in Apollo'
    };
  } catch (err) {
    return { success: false, photoUrl: null, message: `Apollo error: ${err.message}` };
  }
}

// ── Main handler ──

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      userId, authToken, contactId, linkedinUrl, contactName,
      currentPhotoUrl, companyName, title
    } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing required parameters' })
      };
    }

    // Need either a LinkedIn URL or name+company to search
    if (!linkedinUrl && !contactName) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Need LinkedIn URL or contact name to search',
          failure_reason: 'insufficient_data'
        })
      };
    }

    // ─── Verify Firebase Auth ───
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid auth token' }) };
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Token mismatch' }) };
    }

    console.log(`📷 Photo retry for contact ${contactId} | LinkedIn: ${linkedinUrl || 'NONE'} | Name: ${contactName}`);

    // ─── Rate Limiting ───
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'idynify-scout-dev';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const retryDocUrl = `${firestoreUrl}/users/${userId}/contacts/${contactId}`;
    const contactResponse = await fetch(retryDocUrl);

    let photoRetryCount = 0;
    let photoRetryWindowStart = null;

    if (contactResponse.ok) {
      const contactDoc = await contactResponse.json();
      const fields = contactDoc.fields || {};
      photoRetryCount = parseInt(fields.photo_retry_count?.integerValue || '0');
      photoRetryWindowStart = fields.photo_retry_window_start?.stringValue || null;
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (photoRetryWindowStart) {
      const windowStart = new Date(photoRetryWindowStart);
      if (windowStart > oneHourAgo && photoRetryCount >= MAX_RETRIES_PER_HOUR) {
        const resetTime = new Date(windowStart.getTime() + 60 * 60 * 1000);
        await logApiUsage(userId, 'retryLinkedInPhoto', 'rate_limited', {
          responseTime: Date.now() - startTime,
          metadata: { contactId, retryCount: photoRetryCount }
        });
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            success: false,
            error: 'Retry limit exceeded. Please try again later.',
            failure_reason: 'rate_limited',
            retries_remaining: 0,
            reset_at: resetTime.toISOString()
          })
        };
      }
      if (windowStart <= oneHourAgo) {
        photoRetryCount = 0;
        photoRetryWindowStart = null;
      }
    }

    // ─── Step 1: Resolve LinkedIn URL if missing ───
    let resolvedLinkedInUrl = linkedinUrl || null;
    let discoveredLinkedIn = false;

    if (!resolvedLinkedInUrl && contactName) {
      console.log(`🔍 No LinkedIn URL — searching for ${contactName} at ${companyName || 'unknown company'}`);
      const searchResult = await searchLinkedInProfile({
        name: contactName,
        company: companyName || '',
        title: title || ''
      });

      if (searchResult.success && searchResult.linkedinUrl) {
        resolvedLinkedInUrl = searchResult.linkedinUrl;
        discoveredLinkedIn = true;
        console.log(`✅ Found LinkedIn URL: ${resolvedLinkedInUrl}`);

        // If the search also returned a photo, grab it as a candidate
        if (searchResult.photoUrl && !isPlaceholderUrl(searchResult.photoUrl)) {
          console.log(`📷 Profile search also found photo candidate: ${searchResult.photoUrl}`);
        }
      } else {
        console.log(`⚠️ Could not find LinkedIn URL for ${contactName}`);
      }
    }

    // ─── Step 2: Multi-strategy photo fetch ───
    let validPhotoUrl = null;
    let searchSource = null;
    const triedUrls = new Set();

    if (currentPhotoUrl) {
      triedUrls.add(currentPhotoUrl);
    }

    // Strategy 0: Apollo PEOPLE_MATCH (re-enrich to get fresh photo_url)
    if (resolvedLinkedInUrl || contactName) {
      console.log(`📷 Strategy 0: Apollo PEOPLE_MATCH`);
      try {
        const apolloResult = await fetchApolloPhoto({
          linkedinUrl: resolvedLinkedInUrl,
          name: contactName,
          company: companyName
        });

        // If Apollo also found a LinkedIn URL we didn't have, capture it
        if (!resolvedLinkedInUrl && apolloResult.linkedinUrl) {
          resolvedLinkedInUrl = apolloResult.linkedinUrl;
          discoveredLinkedIn = true;
          console.log(`✅ Apollo also discovered LinkedIn: ${resolvedLinkedInUrl}`);
        }

        if (apolloResult.success && apolloResult.photoUrl && !triedUrls.has(apolloResult.photoUrl)) {
          const isReachable = await isPhotoUrlReachable(apolloResult.photoUrl);
          if (isReachable) {
            validPhotoUrl = apolloResult.photoUrl;
            searchSource = 'apollo_match';
          } else {
            console.log(`⚠️ Strategy 0: Apollo URL failed HEAD validation`);
            triedUrls.add(apolloResult.photoUrl);
          }
        } else if (apolloResult.photoUrl) {
          console.log(`⚠️ Strategy 0: Apollo URL already tried or same as current`);
          triedUrls.add(apolloResult.photoUrl);
        } else {
          console.log(`⚠️ Strategy 0: ${apolloResult.message}`);
        }
      } catch (err) {
        console.error(`Strategy 0 (Apollo) failed:`, err.message);
      }
    }

    // Strategy 1: Targeted LinkedIn photo search (Google)
    if (!validPhotoUrl && resolvedLinkedInUrl) {
      console.log(`📷 Strategy 1: searchLinkedInPhoto`);
      const photoResult = await searchLinkedInPhoto({
        linkedinUrl: resolvedLinkedInUrl,
        name: contactName || ''
      });

      if (photoResult.success && photoResult.photoUrl && !triedUrls.has(photoResult.photoUrl)) {
        const isReachable = await isPhotoUrlReachable(photoResult.photoUrl);
        if (isReachable) {
          validPhotoUrl = photoResult.photoUrl;
          searchSource = 'linkedin_photo_search';
        } else {
          triedUrls.add(photoResult.photoUrl);
        }
      }
    }

    // Strategy 2: Broader profile search (Google, multiple strategies)
    if (!validPhotoUrl && contactName) {
      console.log(`📷 Strategy 2: searchLinkedInProfile`);
      const profileResult = await searchLinkedInProfile({
        name: contactName,
        company: companyName || '',
        title: title || ''
      });

      if (profileResult.success && profileResult.photoUrl && !triedUrls.has(profileResult.photoUrl)) {
        const isReachable = await isPhotoUrlReachable(profileResult.photoUrl);
        if (isReachable) {
          validPhotoUrl = profileResult.photoUrl;
          searchSource = 'linkedin_profile_search';
        } else {
          triedUrls.add(profileResult.photoUrl);
        }
      }

      // If no LinkedIn URL yet and this search found one, use it
      if (!resolvedLinkedInUrl && profileResult.success && profileResult.linkedinUrl) {
        resolvedLinkedInUrl = profileResult.linkedinUrl;
        discoveredLinkedIn = true;

        // Now try Apollo with the newly discovered LinkedIn URL
        if (!validPhotoUrl) {
          console.log(`📷 Strategy 0 (retry): Apollo with newly discovered LinkedIn URL`);
          try {
            const apolloRetry = await fetchApolloPhoto({ linkedinUrl: resolvedLinkedInUrl });
            if (apolloRetry.success && apolloRetry.photoUrl && !triedUrls.has(apolloRetry.photoUrl)) {
              const isReachable = await isPhotoUrlReachable(apolloRetry.photoUrl);
              if (isReachable) {
                validPhotoUrl = apolloRetry.photoUrl;
                searchSource = 'apollo_match';
              } else {
                triedUrls.add(apolloRetry.photoUrl);
              }
            }
          } catch (err) {
            console.error('Apollo retry failed:', err.message);
          }
        }
      }
    }

    // Strategy 3: Google Image Search
    if (!validPhotoUrl) {
      const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
      const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

      if (apiKey && searchEngineId && contactName) {
        console.log(`📷 Strategy 3: Google Image Search`);
        const imageQuery = `"${contactName}" linkedin profile photo`;

        try {
          const url = new URL('https://www.googleapis.com/customsearch/v1');
          url.searchParams.append('key', apiKey);
          url.searchParams.append('cx', searchEngineId);
          url.searchParams.append('q', imageQuery);
          url.searchParams.append('searchType', 'image');
          url.searchParams.append('num', '5');

          const imgResponse = await fetch(url.toString());
          if (imgResponse.ok) {
            const imgData = await imgResponse.json();
            for (const imgItem of (imgData.items || [])) {
              const imgUrl = imgItem.link || '';
              if (!imgUrl.startsWith('http') || triedUrls.has(imgUrl) || isPlaceholderUrl(imgUrl)) continue;
              if (imgUrl.includes('media.licdn.com') || imgUrl.includes('linkedin.com')) {
                const isReachable = await isPhotoUrlReachable(imgUrl);
                if (isReachable) {
                  validPhotoUrl = imgUrl;
                  searchSource = 'google_image_search';
                  break;
                }
                triedUrls.add(imgUrl);
              }
            }
          }
        } catch (err) {
          console.error('Strategy 3 failed:', err.message);
        }
      }
    }

    // ─── Step 3: Save results ───
    const newRetryCount = photoRetryCount + 1;
    const newWindowStart = photoRetryWindowStart && new Date(photoRetryWindowStart) > oneHourAgo
      ? photoRetryWindowStart
      : now.toISOString();

    const updateFields = {
      fields: {
        photo_retry_count: { integerValue: String(newRetryCount) },
        photo_retry_window_start: { stringValue: newWindowStart },
        last_photo_retry_at: { stringValue: now.toISOString() }
      }
    };

    let updateMask = 'updateMask.fieldPaths=photo_retry_count&updateMask.fieldPaths=photo_retry_window_start&updateMask.fieldPaths=last_photo_retry_at';

    if (validPhotoUrl) {
      updateFields.fields.photo_url = { stringValue: validPhotoUrl };
      updateFields.fields.photo_retry_source = { stringValue: searchSource };
      updateMask += '&updateMask.fieldPaths=photo_url&updateMask.fieldPaths=photo_retry_source';
    }

    // Save discovered LinkedIn URL
    if (discoveredLinkedIn && resolvedLinkedInUrl) {
      updateFields.fields.linkedin_url = { stringValue: resolvedLinkedInUrl };
      updateMask += '&updateMask.fieldPaths=linkedin_url';
    }

    await fetch(`${retryDocUrl}?${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateFields)
    });

    const retriesRemaining = MAX_RETRIES_PER_HOUR - newRetryCount;

    // Log result
    await logApiUsage(userId, 'retryLinkedInPhoto', validPhotoUrl ? 'success' : 'not_found', {
      responseTime: Date.now() - startTime,
      metadata: {
        contactId,
        contactName: contactName || 'unknown',
        retryAttempt: newRetryCount,
        source: searchSource,
        discoveredLinkedIn,
        urlsTried: triedUrls.size,
        ...(validPhotoUrl ? { photoUrl: validPhotoUrl } : { failureReason: 'no_valid_photo_found' })
      }
    });

    if (validPhotoUrl) {
      console.log(`✅ Photo found via ${searchSource}: ${validPhotoUrl}`);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          photo_url: validPhotoUrl,
          linkedin_url: discoveredLinkedIn ? resolvedLinkedInUrl : undefined,
          message: 'Photo found and updated',
          retries_remaining: retriesRemaining
        })
      };
    }

    console.log(`⚠️ No valid photo after all strategies. Tried ${triedUrls.size} URLs.`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        photo_url: null,
        linkedin_url: discoveredLinkedIn ? resolvedLinkedInUrl : undefined,
        message: 'Photo unavailable. Try again.',
        failure_reason: 'no_valid_photo_found',
        retries_remaining: retriesRemaining
      })
    };

  } catch (error) {
    console.error('❌ Error in retryLinkedInPhoto:', error);
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        await logApiUsage(userId, 'retryLinkedInPhoto', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message
        });
      }
    } catch (_) {}

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message, failure_reason: 'server_error' })
    };
  }
};
