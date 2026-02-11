/**
 * RETRY LINKEDIN PHOTO ENRICHMENT
 *
 * Dedicated function for retrying LinkedIn profile photo enrichment only.
 * Scoped strictly to photo — does NOT re-run full enrichment pipeline.
 *
 * Strategies (in order):
 *   1. searchLinkedInPhoto — targeted Google search for LinkedIn profile photo
 *   2. searchLinkedInProfile — broader Google search with multiple strategies
 *   3. Google Image Search — image-specific search for LinkedIn profile
 *
 * Each candidate URL is validated with a HEAD request to reject 404s/broken CDN links.
 * URLs matching the current broken photo are automatically skipped.
 *
 * Rate limited: max 3 retries per lead per hour.
 *
 * Returns:
 *   { success, photo_url, message, retries_remaining }
 */

import { logApiUsage } from './utils/logApiUsage.js';
import { searchLinkedInPhoto, searchLinkedInProfile } from './utils/linkedinSearch.js';

const MAX_RETRIES_PER_HOUR = 3;
const PHOTO_VALIDATE_TIMEOUT = 5000; // 5s timeout for HEAD request

/**
 * Validate a photo URL is actually reachable (not 404, not expired CDN).
 * Returns true if the URL responds with 2xx status.
 */
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

    if (response.ok) {
      // Verify it's actually an image content type
      const contentType = response.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        return true;
      }
      // Some CDNs don't return content-type on HEAD — accept 2xx anyway
      return response.status >= 200 && response.status < 300;
    }

    console.log(`⚠️ Photo URL validation failed: ${response.status} for ${url}`);
    return false;
  } catch (err) {
    console.log(`⚠️ Photo URL validation error: ${err.message} for ${url}`);
    return false;
  }
}

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const {
      userId, authToken, contactId, linkedinUrl, contactName,
      currentPhotoUrl, companyName, title
    } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId || !linkedinUrl) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Missing required parameters: userId, authToken, contactId, linkedinUrl'
        })
      };
    }

    // Validate LinkedIn URL format
    if (!linkedinUrl.includes('linkedin.com/in/')) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Invalid LinkedIn URL',
          failure_reason: 'invalid_linkedin_url'
        })
      };
    }

    // ─── Verify Firebase Auth ───
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Token does not match user ID' })
      };
    }

    console.log(`📷 Photo retry requested for contact ${contactId}`);
    if (currentPhotoUrl) {
      console.log(`📷 Current broken photo URL: ${currentPhotoUrl}`);
    }

    // ─── Rate Limiting: max 3 retries per lead per hour ───
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

      if (windowStart > oneHourAgo) {
        if (photoRetryCount >= MAX_RETRIES_PER_HOUR) {
          const resetTime = new Date(windowStart.getTime() + 60 * 60 * 1000);
          console.log(`⚠️ Rate limit exceeded for contact ${contactId} (${photoRetryCount}/${MAX_RETRIES_PER_HOUR})`);

          await logApiUsage(userId, 'retryLinkedInPhoto', 'rate_limited', {
            responseTime: Date.now() - startTime,
            metadata: { contactId, retryCount: photoRetryCount }
          });

          return {
            statusCode: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              success: false,
              error: 'Retry limit exceeded. Please try again later.',
              failure_reason: 'rate_limited',
              retries_remaining: 0,
              reset_at: resetTime.toISOString()
            })
          };
        }
      } else {
        photoRetryCount = 0;
        photoRetryWindowStart = null;
      }
    }

    // ─── Multi-strategy photo fetch with validation ───
    let validPhotoUrl = null;
    let searchSource = null;
    const triedUrls = new Set();

    // Always skip the current broken URL
    if (currentPhotoUrl) {
      triedUrls.add(currentPhotoUrl);
    }

    // Strategy 1: Targeted LinkedIn photo search
    console.log(`📷 Strategy 1: searchLinkedInPhoto for ${linkedinUrl}`);
    const photoResult = await searchLinkedInPhoto({
      linkedinUrl,
      name: contactName || ''
    });

    if (photoResult.success && photoResult.photoUrl && !triedUrls.has(photoResult.photoUrl)) {
      console.log(`📷 Candidate URL from Strategy 1: ${photoResult.photoUrl}`);
      const isReachable = await isPhotoUrlReachable(photoResult.photoUrl);
      if (isReachable) {
        validPhotoUrl = photoResult.photoUrl;
        searchSource = 'linkedin_photo_search';
      } else {
        console.log(`⚠️ Strategy 1 URL failed validation (404/unreachable)`);
        triedUrls.add(photoResult.photoUrl);
      }
    } else if (photoResult.photoUrl && triedUrls.has(photoResult.photoUrl)) {
      console.log(`⚠️ Strategy 1 returned same broken URL — skipping`);
    }

    // Strategy 2: Broader profile search (different query strategies)
    if (!validPhotoUrl && contactName) {
      console.log(`📷 Strategy 2: searchLinkedInProfile for ${contactName}`);
      const profileResult = await searchLinkedInProfile({
        name: contactName,
        company: companyName || '',
        title: title || ''
      });

      if (profileResult.success && profileResult.photoUrl && !triedUrls.has(profileResult.photoUrl)) {
        console.log(`📷 Candidate URL from Strategy 2: ${profileResult.photoUrl}`);
        const isReachable = await isPhotoUrlReachable(profileResult.photoUrl);
        if (isReachable) {
          validPhotoUrl = profileResult.photoUrl;
          searchSource = 'linkedin_profile_search';
        } else {
          console.log(`⚠️ Strategy 2 URL failed validation (404/unreachable)`);
          triedUrls.add(profileResult.photoUrl);
        }
      } else if (profileResult.photoUrl && triedUrls.has(profileResult.photoUrl)) {
        console.log(`⚠️ Strategy 2 returned already-tried URL — skipping`);
      }
    }

    // Strategy 3: Google Image Search for LinkedIn profile photo
    if (!validPhotoUrl) {
      const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
      const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

      if (apiKey && searchEngineId) {
        console.log(`📷 Strategy 3: Google Image Search for ${contactName || linkedinUrl}`);

        const usernameMatch = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
        const username = usernameMatch ? usernameMatch[1] : null;

        const imageQuery = contactName
          ? `"${contactName}" linkedin profile photo`
          : `linkedin.com/in/${username || ''} profile photo`;

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
            const imgItems = imgData.items || [];

            for (const imgItem of imgItems) {
              const imgUrl = imgItem.link || '';

              // Skip non-image URLs, placeholder patterns, and already-tried URLs
              if (!imgUrl.startsWith('http') || triedUrls.has(imgUrl)) continue;

              // Skip known LinkedIn placeholders
              const lower = imgUrl.toLowerCase();
              if (lower.includes('ghost-person') || lower.includes('ghost_person') ||
                  lower.includes('default-avatar') || lower.includes('no-photo') ||
                  lower.includes('placeholder') || lower.includes('/static.licdn.com/sc/h/') ||
                  lower.includes('data:image')) {
                continue;
              }

              // Prefer LinkedIn CDN images
              if (imgUrl.includes('media.licdn.com') || imgUrl.includes('linkedin.com')) {
                console.log(`📷 Candidate URL from Strategy 3: ${imgUrl}`);
                const isReachable = await isPhotoUrlReachable(imgUrl);
                if (isReachable) {
                  validPhotoUrl = imgUrl;
                  searchSource = 'google_image_search';
                  break;
                } else {
                  triedUrls.add(imgUrl);
                }
              }
            }
          }
        } catch (err) {
          console.error('Strategy 3 (Google Image Search) failed:', err.message);
        }
      }
    }

    // ─── Update retry tracking ───
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

      console.log(`✅ Valid photo found via ${searchSource}: ${validPhotoUrl}`);

      await logApiUsage(userId, 'retryLinkedInPhoto', 'success', {
        responseTime: Date.now() - startTime,
        metadata: {
          contactId,
          contactName: contactName || 'unknown',
          retryAttempt: newRetryCount,
          photoUrl: validPhotoUrl,
          source: searchSource,
          strategiesTried: triedUrls.size
        }
      });
    } else {
      console.log(`⚠️ No valid photo found after all strategies. Tried ${triedUrls.size} URLs.`);

      await logApiUsage(userId, 'retryLinkedInPhoto', 'not_found', {
        responseTime: Date.now() - startTime,
        metadata: {
          contactId,
          contactName: contactName || 'unknown',
          retryAttempt: newRetryCount,
          failureReason: 'all_urls_broken_or_not_found',
          urlsTried: triedUrls.size
        }
      });
    }

    // Write to Firestore
    await fetch(`${retryDocUrl}?${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateFields)
    });

    const retriesRemaining = MAX_RETRIES_PER_HOUR - newRetryCount;

    if (validPhotoUrl) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          photo_url: validPhotoUrl,
          message: 'Photo found and updated',
          retries_remaining: retriesRemaining
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        photo_url: null,
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
        error: error.message,
        failure_reason: 'server_error'
      })
    };
  }
};
