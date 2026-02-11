/**
 * RETRY LINKEDIN PHOTO ENRICHMENT
 *
 * Dedicated function for retrying LinkedIn profile photo enrichment only.
 * Scoped strictly to photo — does NOT re-run full enrichment pipeline.
 *
 * Rate limited: max 3 retries per lead per hour.
 *
 * Returns:
 *   { success, photo_url, message, retries_remaining }
 */

import { logApiUsage } from './utils/logApiUsage.js';
import { searchLinkedInPhoto } from './utils/linkedinSearch.js';

const MAX_RETRIES_PER_HOUR = 3;

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contactId, linkedinUrl, contactName } = JSON.parse(event.body);

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

    // ─── Rate Limiting: max 3 retries per lead per hour ───
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'idynify-scout-dev';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // Read the contact's photo retry tracking
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

    // Check if we're within the rate limit window
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (photoRetryWindowStart) {
      const windowStart = new Date(photoRetryWindowStart);

      if (windowStart > oneHourAgo) {
        // Within the hour window — check count
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
        // Window expired — reset
        photoRetryCount = 0;
        photoRetryWindowStart = null;
      }
    }

    // ─── Attempt photo fetch ───
    console.log(`📷 Attempting LinkedIn photo search for: ${linkedinUrl}`);

    const photoResult = await searchLinkedInPhoto({
      linkedinUrl,
      name: contactName || ''
    });

    // Update retry tracking regardless of result
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

    if (photoResult.success && photoResult.photoUrl) {
      // Success — update the avatar field too
      updateFields.fields.photo_url = { stringValue: photoResult.photoUrl };

      // Add provenance tracking
      updateFields.fields.photo_retry_source = { stringValue: 'linkedin_photo_retry' };

      console.log(`✅ Photo found: ${photoResult.photoUrl}`);

      await logApiUsage(userId, 'retryLinkedInPhoto', 'success', {
        responseTime: Date.now() - startTime,
        metadata: {
          contactId,
          contactName: contactName || 'unknown',
          retryAttempt: newRetryCount,
          photoUrl: photoResult.photoUrl
        }
      });
    } else {
      console.log(`⚠️ Photo not found: ${photoResult.message}`);

      await logApiUsage(userId, 'retryLinkedInPhoto', 'not_found', {
        responseTime: Date.now() - startTime,
        metadata: {
          contactId,
          contactName: contactName || 'unknown',
          retryAttempt: newRetryCount,
          failureReason: photoResult.message
        }
      });
    }

    // Update contact document with retry tracking (and photo if found)
    await fetch(`${retryDocUrl}?updateMask.fieldPaths=photo_retry_count&updateMask.fieldPaths=photo_retry_window_start&updateMask.fieldPaths=last_photo_retry_at${photoResult.success ? '&updateMask.fieldPaths=photo_url&updateMask.fieldPaths=photo_retry_source' : ''}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateFields)
    });

    const retriesRemaining = MAX_RETRIES_PER_HOUR - newRetryCount;

    if (photoResult.success && photoResult.photoUrl) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          photo_url: photoResult.photoUrl,
          message: 'Photo found and updated',
          retries_remaining: retriesRemaining
        })
      };
    }

    // Determine failure reason for frontend
    let failureReason = 'unknown';
    const msg = (photoResult.message || '').toLowerCase();

    if (msg.includes('not configured')) {
      failureReason = 'api_not_configured';
    } else if (msg.includes('no photo found')) {
      failureReason = 'no_photo_available';
    } else if (msg.includes('api error')) {
      failureReason = 'network_error';
    } else if (msg.includes('no linkedin url')) {
      failureReason = 'invalid_linkedin_url';
    } else {
      failureReason = 'no_photo_available';
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
        failure_reason: failureReason,
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
