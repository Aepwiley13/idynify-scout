// Daily Scout Company Queue Refresh
// Runs Monday-Friday at 9am UTC
// Tops off company queue for active users and sends email notifications

import { schedule } from '@netlify/functions';
import { admin, db } from './firebase-admin.js';

/** Typed failure so a discovery error can never be laundered into a clean zero. */
class DiscoveryError extends Error {
  constructor(code, detail) { super(code); this.name = 'DiscoveryError'; this.code = code; this.detail = detail; }
}

const handler = async (event) => {
  const startTime = Date.now();
  console.log('🔄 Starting daily leads refresh job');

  try {
    // Check if today is a weekday (Monday-Friday)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log('📅 Weekend - skipping daily refresh');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Weekend - no refresh needed',
          processedUsers: 0
        })
      };
    }

    // Kill switch — halt the unattended job without a deploy (see rollback plan).
    if (String(process.env.DISCOVERY_CRON_ENABLED).toLowerCase() === 'false') {
      console.warn('discovery.scheduled.disabled — DISCOVERY_CRON_ENABLED=false');
      return { statusCode: 200, body: JSON.stringify({ success: true, disabled: true, reason: 'DISCOVERY_CRON_ENABLED=false' }) };
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new DiscoveryError('missing_api_key');

    let activeUsers;
    try {
      activeUsers = await getActiveUsers();
    } catch (err) {
      // Enumeration failure is fatal and must NEVER present as "0 eligible users".
      console.error('discovery.scheduled.failed', { failureCode: 'enumeration_failed', message: err.message });
      return { statusCode: 500, body: JSON.stringify({ success: false, failureCode: 'enumeration_failed', error: err.message }) };
    }

    console.log(`📊 Found ${activeUsers.length} active users with ICP profiles`);

    const results = {
      processed: 0,
      refreshed: 0,
      emailed: 0,
      failed: 0,
      skipped: 0,
      skippedReasons: {},
      errors: []
    };

    // Process each user
    for (const user of activeUsers) {
      try {
        results.processed++;

        const authToken = await mintUserIdToken(user.userId);

        // A background job has no greater authority to infer ICP identity than
        // an interactive caller. If this user's ICP cannot be resolved, skip
        // their ICP-targeted refresh, record exactly which of the three states
        // it was, and keep processing everyone else. A user without an ICP is
        // not a broken account, and a failed read is not the same as no ICP.
        const resolution = await resolveActiveIcpViaRest(projectId, user.userId);
        if (resolution.status !== 'resolved') {
          results.skipped++;
          results.skippedReasons[resolution.reason] =
            (results.skippedReasons[resolution.reason] || 0) + 1;
          console.log(`⏭️  User ${user.userId}: skipped ICP-targeted refresh (${resolution.reason})`);
          continue;
        }

        // Use the authoritative ICP profile, not the bridge projection.
        const profile = resolution.profile;

        // Call search-companies to top off their queue
        const refreshResult = await refreshUserQueue(user.userId, authToken, profile, resolution.icpId);

        console.log(`✅ User ${user.userId}: ${refreshResult.companiesAdded} companies added (queue: ${refreshResult.currentQueueSize})`);

        // Log the refresh
        await logRefresh(user.userId, authToken, refreshResult);

        if (refreshResult.companiesAdded > 0 || refreshResult.currentQueueSize > 0) {
          results.refreshed++;

          // Send email notification
          const emailSent = await sendDailyEmail(user.email, user.userId, refreshResult.currentQueueSize);

          if (emailSent) {
            results.emailed++;
            console.log(`📧 Email sent to ${user.email}`);
          }
        }

      } catch (userError) {
        results.failed++;
        results.errors.push({
          userId: user.userId,
          code: userError.code || 'unknown',
          error: userError.message,
          detail: userError.detail || null
        });
        console.error('discovery.scheduled.user_failed', { userId: user.userId, failureCode: userError.code || 'unknown' });
        console.error(`❌ Error processing user ${user.userId}:`, userError);
        // Continue with next user
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    console.log(`✅ Daily refresh complete: ${results.refreshed}/${results.processed} users refreshed, ${results.skipped} skipped (${JSON.stringify(results.skippedReasons)}), ${results.emailed} emails sent in ${duration}s`);

    // 207 on partial failure is the alertable signal: a 200 must mean every
    // eligible user succeeded. An honest zero (no Apollo matches) still returns 200.
    const allOk = results.failed === 0 && results.errors.length === 0;
    console.log(allOk ? 'discovery.scheduled.ok' : 'discovery.scheduled.partial_failure', {
      usersEligible: activeUsers.length, usersProcessed: results.processed,
      usersFailed: results.failed, companiesAdded: results.refreshed, durationMs: Date.now() - startTime,
    });
    return {
      statusCode: allOk ? 200 : 207,
      body: JSON.stringify({ success: allOk, results, duration })
    };

  } catch (error) {
    console.error('💥 Fatal error in daily refresh:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

/**
 * REST mirror of the canonical active-ICP resolution contract.
 *
 * This job reads Firestore over the REST API rather than the Admin SDK, so it
 * cannot import the shared resolver directly — but it implements the identical
 * contract, including the three distinct unresolved reasons. It never returns
 * DEFAULT_ICP_ID and never reads companyProfile/current for identity.
 */
async function resolveActiveIcpViaRest(projectId, userId) {
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  let response;
  try {
    response = await fetch(`${firestoreUrl}/users/${userId}/icpProfiles`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.warn(`[resolveActiveIcpViaRest] read failed for ${userId}:`, err.message);
    return { status: 'unresolved', reason: 'read-failed', icpId: null, profile: null };
  }

  if (!response.ok) {
    // 404 means the subcollection has no documents — that is "no ICP created",
    // a valid state. Any other status is a genuine read failure and must not be
    // reported as though the user simply has no ICP.
    if (response.status === 404) {
      return { status: 'unresolved', reason: 'no-profiles', icpId: null, profile: null };
    }
    return { status: 'unresolved', reason: 'read-failed', icpId: null, profile: null };
  }

  const data = await response.json();
  const documents = data.documents || [];
  if (documents.length === 0) {
    return { status: 'unresolved', reason: 'no-profiles', icpId: null, profile: null };
  }

  const active = documents.find(d =>
    d.fields?.isActive?.booleanValue === true &&
    d.fields?.status?.stringValue === 'active'
  );

  if (!active) {
    return { status: 'unresolved', reason: 'none-active', icpId: null, profile: null };
  }

  const f = active.fields || {};
  const strings = key => f[key]?.arrayValue?.values?.map(v => v.stringValue).filter(Boolean) || [];

  return {
    status: 'resolved',
    icpId: active.name.split('/').pop(),
    profile: {
      industries: strings('industries'),
      companySizes: strings('companySizes'),
      revenueRanges: strings('revenueRanges'),
      locations: strings('locations'),
      targetTitles: strings('targetTitles'),
      companyKeywords: strings('companyKeywords'),
      isNationwide: f.isNationwide?.booleanValue || false,
      skipRevenue: f.skipRevenue?.booleanValue || false
    }
  };
}

/**
 * Get all active users with ICP profiles
 */
async function getActiveUsers() {
  // G1-08 CHANGE A — this used to GET the Firestore REST endpoint for /users with
  // NO Authorization header. firestore.rules is owner-only and permits no list of
  // /users, so the request was denied, the error was caught, and the function
  // returned []. The job's real production signature was
  //   "Found 0 active users with ICP profiles"
  // and it never reached the token bug below it. Enumeration must use the Admin
  // SDK, which bypasses rules legitimately and is already used by 20+ functions.
  const usersSnap = await db.collection('users').select('email').get();
  const active = [];

  for (const userDoc of usersSnap.docs) {
    const profileSnap = await db.doc(`users/${userDoc.id}/companyProfile/current`).get();
    if (!profileSnap.exists) continue;
    const p = profileSnap.data() || {};
    const profile = {
      industries: p.industries || [],
      companySizes: p.companySizes || [],
      revenueRanges: p.revenueRanges || [],
      locations: p.locations || [],
      isNationwide: !!p.isNationwide,
      skipRevenue: !!p.skipRevenue,
    };
    if (profile.industries.length || profile.companySizes.length || profile.locations.length) {
      active.push({ userId: userDoc.id, email: userDoc.get('email') ?? null, profile });
    }
  }
  return active;   // throws on real infrastructure failure — the handler reports it
}

/**
 * G1-08 CHANGE B — mint a REAL Firebase ID token for the user.
 *
 * This previously returned FIREBASE_API_KEY, which search-companies then posted
 * to identitytoolkit accounts:lookup as `idToken`. An API key is not an ID
 * token, so verification failed with 'Invalid authentication token'.
 *
 * Admin signs a custom token; Identity Toolkit exchanges it for a genuine ID
 * token for that uid. search-companies is UNCHANGED and its auth is NOT
 * weakened — it verifies this token exactly as it verifies a browser's.
 *
 * Requires the service account to hold Service Account Token Creator
 * (iam.serviceAccounts.signBlob).
 */
async function mintUserIdToken(userId) {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw new DiscoveryError('missing_api_key');

  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(userId);
  } catch (err) {
    throw new DiscoveryError('custom_token_failed', err.message);
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  if (!res.ok) {
    throw new DiscoveryError('token_exchange_failed', `${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.idToken) throw new DiscoveryError('token_exchange_failed', 'no idToken in response');
  return data.idToken;
}

/**
 * Refresh a user's company queue using the search-companies logic
 */
async function refreshUserQueue(userId, authToken, companyProfile, icpId) {
  try {
    // Call the search-companies function, carrying the resolved ICP identity.
    // search-companies now refuses a search without one rather than stamping
    // discovered companies with a fabricated 'default'.
    const searchResponse = await fetch(`${process.env.URL}/.netlify/functions/search-companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        authToken,
        companyProfile,
        icpId
      })
    });

    if (!searchResponse.ok) {
      throw new DiscoveryError('search_failed', `${searchResponse.status}: ${(await searchResponse.text()).slice(0, 200)}`);
    }

    const result = await searchResponse.json();

    return {
      companiesFound: result.companiesFound || 0,
      companiesAdded: result.companiesAdded || 0,
      currentQueueSize: result.currentQueueSize || 0
    };

  } catch (error) {
    // G1-08 CHANGE C — this used to convert ANY failure into all-zeros, which the
    // caller's `companiesAdded > 0 || currentQueueSize > 0` guard then read as
    // "nothing to do". A total auth failure and a genuinely empty result were
    // indistinguishable, and the cron logged a clean success either way.
    throw error instanceof DiscoveryError ? error : new DiscoveryError('search_failed', error.message);
  }
}

/**
 * Log refresh run to Firestore for audit trail
 */
async function logRefresh(userId, authToken, refreshResult) {
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const logData = {
      fields: {
        leads_found_count: { integerValue: String(refreshResult.companiesAdded) },
        current_queue_size: { integerValue: String(refreshResult.currentQueueSize) },
        timestamp: { timestampValue: new Date().toISOString() },
        date: { stringValue: new Date().toISOString().split('T')[0] }
      }
    };

    // Save to users/{uid}/scoutLogs collection
    const logId = `refresh_${Date.now()}`;
    await fetch(`${firestoreUrl}/users/${userId}/scoutLogs/${logId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(logData)
    });

  } catch (error) {
    console.error('Error logging refresh:', error);
    // Don't throw - logging failure shouldn't block the job
  }
}

/**
 * Send daily email notification using Resend
 */
async function sendDailyEmail(userEmail, userId, companyCount) {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.warn('⚠️  RESEND_API_KEY not configured - skipping email');
      return false;
    }

    if (!userEmail) {
      console.warn(`⚠️  No email for user ${userId} - skipping`);
      return false;
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: 'Aaron @ Idynify <aaron@idynify.com>',
        to: userEmail,
        subject: 'You have new companies to review',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px;">

              <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Scout Daily Leads</h1>
              </div>

              <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">

                <p style="font-size: 16px; color: #111827; margin: 0 0 20px 0;">
                  Good morning,
                </p>

                <p style="font-size: 16px; color: #374151; margin: 0 0 30px 0;">
                  You have <strong style="color: #3b82f6; font-size: 20px;">${companyCount} companies</strong> ready to review in your Scout queue.
                </p>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.URL}/scout"
                     style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                    Review Companies
                  </a>
                </div>

                <p style="font-size: 14px; color: #6b7280; margin: 30px 0 0 0; padding-top: 30px; border-top: 1px solid #e5e7eb;">
                  This is your daily Scout update. Fresh leads arrive Monday through Friday.
                </p>

              </div>

            </body>
          </html>
        `
      })
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error('Email send failed:', errorText);
      return false;
    }

    return true;

  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// Schedule: Run at 9am UTC Monday-Friday
// Cron format: minute hour day month dayOfWeek
// 0 9 * * 1-5 = 9am UTC, Monday-Friday
export default schedule('0 9 * * 1-5', handler);
