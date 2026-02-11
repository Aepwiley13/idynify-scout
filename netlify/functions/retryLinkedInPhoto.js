/**
 * RETRY LINKEDIN PHOTO ENRICHMENT
 *
 * Dedicated function for retrying LinkedIn profile photo enrichment only.
 * Scoped strictly to photo — does NOT re-run full enrichment pipeline.
 *
 * Strategies (in order):
 *   0. Direct LinkedIn fetch — fetch the public profile page and extract og:image
 *      (This gets the CURRENT CDN URL, not Google's stale cache)
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
const PHOTO_VALIDATE_TIMEOUT = 5000;
const LINKEDIN_FETCH_TIMEOUT = 8000;

/**
 * Validate a photo URL is actually reachable (not 404, not expired CDN).
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
      const contentType = response.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        return true;
      }
      return response.status >= 200 && response.status < 300;
    }

    console.log(`⚠️ Photo URL validation failed: ${response.status} for ${url}`);
    return false;
  } catch (err) {
    console.log(`⚠️ Photo URL validation error: ${err.message} for ${url}`);
    return false;
  }
}

// Known placeholder patterns to reject
const PLACEHOLDER_PATTERNS = [
  'ghost-person', 'ghost_person', 'default-avatar', 'no-photo',
  'placeholder', '/static.licdn.com/sc/h/', 'data:image'
];

function isPlaceholderUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

/**
 * Strategy 0: Fetch LinkedIn profile page directly and extract og:image.
 *
 * LinkedIn public profiles expose an og:image meta tag with the CURRENT
 * CDN URL for the profile photo. This is the same URL that appears when
 * you share a LinkedIn profile on Slack/Twitter/etc.
 *
 * This bypasses Google's stale cache entirely.
 */
async function fetchLinkedInProfilePhoto(linkedinUrl) {
  try {
    // Normalize URL to public profile format
    const usernameMatch = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (!usernameMatch) {
      return { success: false, photoUrl: null, message: 'Could not extract LinkedIn username' };
    }
    const profileUrl = `https://www.linkedin.com/in/${usernameMatch[1]}/`;

    console.log(`📷 Direct LinkedIn fetch: ${profileUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINKEDIN_FETCH_TIMEOUT);

    const response = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`⚠️ LinkedIn profile fetch returned ${response.status}`);
      return { success: false, photoUrl: null, message: `LinkedIn returned ${response.status}` };
    }

    const html = await response.text();

    // Extract og:image meta tag — this has the current photo URL
    // LinkedIn uses: <meta property="og:image" content="https://media.licdn.com/dms/image/..."/>
    const ogImagePatterns = [
      /< *meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /< *meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ];

    let ogImageUrl = null;
    for (const pattern of ogImagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        ogImageUrl = match[1];
        break;
      }
    }

    if (!ogImageUrl) {
      console.log(`⚠️ No og:image found in LinkedIn profile HTML`);

      // Fallback: try to find image URL in the HTML directly
      // LinkedIn sometimes embeds the photo URL in JSON-LD or other meta tags
      const imagePatterns = [
        /["'](https:\/\/media\.licdn\.com\/dms\/image\/[^"'\s]+displayphoto[^"'\s]+)["']/i,
        /< *meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /< *meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
        /< *img[^>]+class=["'][^"']*profile[^"']*["'][^>]+src=["'](https:\/\/media\.licdn\.com[^"']+)["']/i,
      ];

      for (const pattern of imagePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          ogImageUrl = match[1];
          console.log(`📷 Found photo via fallback pattern: ${ogImageUrl}`);
          break;
        }
      }
    }

    if (!ogImageUrl) {
      return { success: false, photoUrl: null, message: 'No photo URL found in LinkedIn profile page' };
    }

    // Decode HTML entities in URL
    ogImageUrl = ogImageUrl.replace(/&amp;/g, '&');

    // Check it's not a placeholder
    if (isPlaceholderUrl(ogImageUrl)) {
      console.log(`⚠️ LinkedIn og:image is a placeholder: ${ogImageUrl}`);
      return { success: false, photoUrl: null, message: 'LinkedIn profile has placeholder photo' };
    }

    console.log(`✅ Direct LinkedIn photo URL: ${ogImageUrl}`);
    return { success: true, photoUrl: ogImageUrl, message: 'Photo found via direct LinkedIn fetch' };

  } catch (err) {
    console.log(`⚠️ Direct LinkedIn fetch failed: ${err.message}`);
    return { success: false, photoUrl: null, message: `LinkedIn fetch error: ${err.message}` };
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
      if (windowStart > oneHourAgo) {
        if (photoRetryCount >= MAX_RETRIES_PER_HOUR) {
          const resetTime = new Date(windowStart.getTime() + 60 * 60 * 1000);
          console.log(`⚠️ Rate limit exceeded for contact ${contactId}`);

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
      } else {
        photoRetryCount = 0;
        photoRetryWindowStart = null;
      }
    }

    // ─── Multi-strategy photo fetch with validation ───
    let validPhotoUrl = null;
    let searchSource = null;
    const triedUrls = new Set();

    if (currentPhotoUrl) {
      triedUrls.add(currentPhotoUrl);
    }

    // ── Strategy 0: Direct LinkedIn profile page fetch (BEST — gets current CDN URL) ──
    console.log(`📷 Strategy 0: Direct LinkedIn profile fetch`);
    const directResult = await fetchLinkedInProfilePhoto(linkedinUrl);

    if (directResult.success && directResult.photoUrl && !triedUrls.has(directResult.photoUrl)) {
      console.log(`📷 Candidate URL from Strategy 0: ${directResult.photoUrl}`);
      const isReachable = await isPhotoUrlReachable(directResult.photoUrl);
      if (isReachable) {
        validPhotoUrl = directResult.photoUrl;
        searchSource = 'linkedin_direct_fetch';
      } else {
        console.log(`⚠️ Strategy 0 URL failed HEAD validation`);
        triedUrls.add(directResult.photoUrl);
      }
    } else if (directResult.photoUrl && triedUrls.has(directResult.photoUrl)) {
      console.log(`⚠️ Strategy 0 returned same broken URL — skipping`);
    } else {
      console.log(`⚠️ Strategy 0: ${directResult.message}`);
    }

    // ── Strategy 1: Targeted LinkedIn photo search (Google) ──
    if (!validPhotoUrl) {
      console.log(`📷 Strategy 1: searchLinkedInPhoto`);
      const photoResult = await searchLinkedInPhoto({ linkedinUrl, name: contactName || '' });

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

    // ── Strategy 2: Broader profile search (Google, multiple query strategies) ──
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
    }

    // ── Strategy 3: Google Image Search ──
    if (!validPhotoUrl) {
      const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
      const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

      if (apiKey && searchEngineId) {
        console.log(`📷 Strategy 3: Google Image Search`);

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
            for (const imgItem of (imgData.items || [])) {
              const imgUrl = imgItem.link || '';
              if (!imgUrl.startsWith('http') || triedUrls.has(imgUrl) || isPlaceholderUrl(imgUrl)) continue;

              if (imgUrl.includes('media.licdn.com') || imgUrl.includes('linkedin.com')) {
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
          console.error('Strategy 3 failed:', err.message);
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
        metadata: { contactId, contactName: contactName || 'unknown', retryAttempt: newRetryCount, photoUrl: validPhotoUrl, source: searchSource }
      });
    } else {
      console.log(`⚠️ No valid photo found after all strategies. Tried ${triedUrls.size} URLs.`);

      await logApiUsage(userId, 'retryLinkedInPhoto', 'not_found', {
        responseTime: Date.now() - startTime,
        metadata: { contactId, contactName: contactName || 'unknown', retryAttempt: newRetryCount, failureReason: 'all_urls_broken_or_not_found', urlsTried: triedUrls.size }
      });
    }

    await fetch(`${retryDocUrl}?${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateFields)
    });

    const retriesRemaining = MAX_RETRIES_PER_HOUR - newRetryCount;

    if (validPhotoUrl) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        failure_reason: 'server_error'
      })
    };
  }
};
