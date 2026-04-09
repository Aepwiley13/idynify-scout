// Daily Scout Company Queue Refresh
// Runs Monday-Friday at 9am UTC
// Tops off company queue for active users and sends email notifications

import { schedule } from '@netlify/functions';

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

    // Get Firebase credentials
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    if (!firebaseApiKey || !projectId) {
      throw new Error('Firebase credentials not configured');
    }

    // activeUsers is a flat list of { userId, email, profile, icpId } — one entry per ICP.
    // Group by userId so we process all stacks for a user together and send one email.
    const activeUsers = await getActiveUsers(projectId);

    // Deduplicate entries: group ICP entries by userId
    const userMap = new Map();
    for (const entry of activeUsers) {
      if (!userMap.has(entry.userId)) {
        userMap.set(entry.userId, { userId: entry.userId, email: entry.email, icps: [] });
      }
      userMap.get(entry.userId).icps.push({ profile: entry.profile, icpId: entry.icpId });
    }

    const uniqueUsers = Array.from(userMap.values());
    console.log(`📊 Found ${uniqueUsers.length} active users — ${activeUsers.length} ICP stacks total`);

    const results = {
      processed: 0,
      refreshed: 0,
      emailed: 0,
      failed: 0,
      errors: []
    };

    // Process each user — top off every ICP stack, send one aggregated email
    for (const user of uniqueUsers) {
      try {
        results.processed++;

        const authToken = await getServiceAccountToken();

        let totalAdded = 0;
        let totalQueueSize = 0;

        // Top off each ICP stack independently
        for (const { profile, icpId } of user.icps) {
          try {
            const refreshResult = await refreshUserQueue(user.userId, authToken, profile, icpId);
            totalAdded += refreshResult.companiesAdded || 0;
            totalQueueSize += refreshResult.currentQueueSize || 0;

            console.log(`  ✅ User ${user.userId} ICP ${icpId || 'legacy'}: +${refreshResult.companiesAdded} companies (queue: ${refreshResult.currentQueueSize})`);

            await logRefresh(user.userId, authToken, { ...refreshResult, icpId });
          } catch (icpError) {
            console.error(`  ❌ ICP ${icpId} for user ${user.userId}:`, icpError.message);
            // Continue with other stacks — don't abort the whole user
          }
        }

        if (totalAdded > 0 || totalQueueSize > 0) {
          results.refreshed++;

          // Send one email per user summarising all stacks
          const emailSent = await sendDailyEmail(user.email, user.userId, totalQueueSize);
          if (emailSent) {
            results.emailed++;
            console.log(`📧 Email sent to ${user.email} (${totalQueueSize} total pending across ${user.icps.length} stack${user.icps.length !== 1 ? 's' : ''})`);
          }
        }

      } catch (userError) {
        results.failed++;
        results.errors.push({ userId: user.userId, error: userError.message });
        console.error(`❌ Error processing user ${user.userId}:`, userError);
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    console.log(`✅ Daily refresh complete: ${results.refreshed}/${results.processed} users refreshed, ${results.emailed} emails sent in ${duration}s`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        results,
        duration
      })
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
 * Get all active users with ICP profiles
 */
async function getActiveUsers(projectId) {
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    // Get all users
    const usersResponse = await fetch(`${firestoreUrl}/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!usersResponse.ok) {
      throw new Error('Failed to fetch users');
    }

    const usersData = await usersResponse.json();
    const users = usersData.documents || [];

    const activeUsers = [];

    // For each user, check if they have ICP profiles
    for (const userDoc of users) {
      try {
        const userId = userDoc.name.split('/').pop();

        // Get user's email from profile
        const userEmail = userDoc.fields?.email?.stringValue || null;

        // First, try the new icpProfiles subcollection (current system)
        const icpProfilesResponse = await fetch(`${firestoreUrl}/users/${userId}/icpProfiles`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (icpProfilesResponse.ok) {
          const icpData = await icpProfilesResponse.json();
          const icpDocs = (icpData.documents || []).filter(d => d.fields);

          if (icpDocs.length > 0) {
            // Use the first ICP profile (primary). Sort by createdAt ascending to match app logic.
            const sorted = icpDocs.sort((a, b) => {
              const aTime = a.fields?.createdAt?.timestampValue || a.fields?.createdAt?.stringValue || '';
              const bTime = b.fields?.createdAt?.timestampValue || b.fields?.createdAt?.stringValue || '';
              return aTime.localeCompare(bTime);
            });
            const primaryICP = sorted[0];
            const icpId = primaryICP.name.split('/').pop();

            const profile = {
              industries: primaryICP.fields?.industries?.arrayValue?.values?.map(v => v.stringValue) || [],
              companySizes: primaryICP.fields?.companySizes?.arrayValue?.values?.map(v => v.stringValue) || [],
              revenueRanges: primaryICP.fields?.revenueRanges?.arrayValue?.values?.map(v => v.stringValue) || [],
              locations: primaryICP.fields?.locations?.arrayValue?.values?.map(v => v.stringValue) || [],
              isNationwide: primaryICP.fields?.isNationwide?.booleanValue || false,
              skipRevenue: primaryICP.fields?.skipRevenue?.booleanValue || false,
              targetTitles: primaryICP.fields?.targetTitles?.arrayValue?.values?.map(v => v.stringValue) || [],
              foundedAgeRange: primaryICP.fields?.foundedAgeRange ? {
                minAge: primaryICP.fields.foundedAgeRange.mapValue?.fields?.minAge?.integerValue
                  ? parseInt(primaryICP.fields.foundedAgeRange.mapValue.fields.minAge.integerValue)
                  : null,
                maxAge: primaryICP.fields.foundedAgeRange.mapValue?.fields?.maxAge?.integerValue
                  ? parseInt(primaryICP.fields.foundedAgeRange.mapValue.fields.maxAge.integerValue)
                  : null,
              } : null,
            };

            // Only include users with at least one ICP criterion defined
            if (profile.industries.length > 0 || profile.companySizes.length > 0 || profile.locations.length > 0) {
              activeUsers.push({ userId, email: userEmail, profile, icpId });
            }
            continue; // Skip legacy fallback for this user
          }
        }

        // Fallback: legacy companyProfile/current for users not yet on new system
        const profileResponse = await fetch(`${firestoreUrl}/users/${userId}/companyProfile/current`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (profileResponse.ok) {
          const profileData = await profileResponse.json();

          const profile = {
            industries: profileData.fields?.industries?.arrayValue?.values?.map(v => v.stringValue) || [],
            companySizes: profileData.fields?.companySizes?.arrayValue?.values?.map(v => v.stringValue) || [],
            revenueRanges: profileData.fields?.revenueRanges?.arrayValue?.values?.map(v => v.stringValue) || [],
            locations: profileData.fields?.locations?.arrayValue?.values?.map(v => v.stringValue) || [],
            isNationwide: profileData.fields?.isNationwide?.booleanValue || false,
            skipRevenue: profileData.fields?.skipRevenue?.booleanValue || false,
            targetTitles: profileData.fields?.targetTitles?.arrayValue?.values?.map(v => v.stringValue) || [],
          };

          if (profile.industries.length > 0 || profile.companySizes.length > 0 || profile.locations.length > 0) {
            activeUsers.push({ userId, email: userEmail, profile });
          }
        }
      } catch (profileError) {
        // Skip users without profiles
        continue;
      }
    }

    return activeUsers;

  } catch (error) {
    console.error('Error fetching active users:', error);
    return [];
  }
}

/**
 * Get service account token for Firestore API calls
 */
async function getServiceAccountToken() {
  // For now, return a placeholder
  // In production, this would use Firebase Admin SDK or service account credentials
  // Since we're calling public Firestore REST API, we can use the API key
  return process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
}

/**
 * Refresh a user's company queue using the search-companies logic
 */
async function refreshUserQueue(userId, authToken, companyProfile, icpId) {
  try {
    // Call the search-companies function
    const searchResponse = await fetch(`${process.env.URL}/.netlify/functions/search-companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        authToken,
        companyProfile,
        ...(icpId ? { icpId } : {})
      })
    });

    if (!searchResponse.ok) {
      throw new Error('Search companies request failed');
    }

    const result = await searchResponse.json();

    return {
      companiesFound: result.companiesFound || 0,
      companiesAdded: result.companiesAdded || 0,
      currentQueueSize: result.currentQueueSize || 0
    };

  } catch (error) {
    console.error('Error refreshing user queue:', error);
    return {
      companiesFound: 0,
      companiesAdded: 0,
      currentQueueSize: 0
    };
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
