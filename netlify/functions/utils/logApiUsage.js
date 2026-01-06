/**
 * Log API usage to Firestore for admin tracking
 *
 * Creates immutable log entries in top-level apiLogs collection
 * with normalized operation names and environment detection.
 *
 * @param {string} userId - Firebase user UID
 * @param {string} operation - Operation name ('searchCompanies', 'enrichContact', 'searchPeople', 'enrichCompany')
 * @param {string} status - 'success' or 'error'
 * @param {object} options - { responseTime, errorCode, metadata }
 */
export async function logApiUsage(userId, operation, status, options = {}) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'idynify-scout-dev';

    // Determine environment from project ID
    const environment = projectId.includes('dev') ? 'dev' : 'prod';

    // Normalize endpoint to APOLLO_<OPERATION_NAME> format
    const endpoint = `APOLLO_${operation.toUpperCase()}`;

    // Extract options
    const responseTime = options.responseTime || 0;
    const errorCode = options.errorCode || null;
    const metadata = options.metadata || {};

    const timestamp = new Date().toISOString();
    const creditsUsed = 1; // All Apollo API calls = 1 credit

    // Create log entry in top-level apiLogs collection
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const logDocUrl = `${firestoreUrl}/apiLogs`;

    const logData = {
      fields: {
        userId: { stringValue: userId },
        endpoint: { stringValue: endpoint },
        creditsUsed: { integerValue: String(creditsUsed) },
        timestamp: { timestampValue: timestamp },
        status: { stringValue: status },
        responseTime: { integerValue: String(Math.round(responseTime)) },
        environment: { stringValue: environment }
      }
    };

    // Add errorCode if present
    if (errorCode) {
      logData.fields.errorCode = { stringValue: String(errorCode) };
    }

    // Add metadata as JSON string if present
    if (Object.keys(metadata).length > 0) {
      logData.fields.metadata = { stringValue: JSON.stringify(metadata) };
    }

    // POST to create new document with auto-generated ID
    await fetch(logDocUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logData)
    });

    // Also update user's API usage summary for backward compatibility
    const summaryDocUrl = `${firestoreUrl}/users/${userId}/apiUsage/summary`;

    const summaryResponse = await fetch(summaryDocUrl);
    let currentTotalCredits = 0;
    let currentEndpointCount = 0;

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      currentTotalCredits = parseInt(summaryData.fields?.totalCredits?.integerValue || 0);
      currentEndpointCount = parseInt(summaryData.fields?.[operation]?.integerValue || 0);
    }

    await fetch(summaryDocUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          totalCredits: { integerValue: String(currentTotalCredits + creditsUsed) },
          [operation]: { integerValue: String(currentEndpointCount + creditsUsed) },
          lastUpdated: { timestampValue: timestamp }
        }
      })
    });

    console.log(`✅ API log created: ${endpoint} (${status}) - ${environment} - User: ${userId} - ${responseTime}ms`);

  } catch (error) {
    console.error('❌ Failed to log API usage:', error);
    // Don't throw - logging failure shouldn't break the main operation
  }
}
