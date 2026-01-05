/**
 * Log API usage to Firestore for admin tracking and billing
 *
 * @param {string} userId - Firebase user UID
 * @param {string} endpoint - API endpoint name ('enrichContact', 'searchCompanies', 'searchPeople', 'enrichCompany')
 * @param {string} status - 'success' or 'error'
 * @param {object} metadata - Optional metadata about the call
 */
export async function logApiUsage(userId, endpoint, status, metadata = {}) {
  try {
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;

    if (!firebaseApiKey) {
      console.warn('⚠️ Firebase API key not configured - skipping API usage logging');
      return;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || 'idynify-mission-control';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const timestamp = new Date().toISOString();
    const creditsUsed = 1; // All API calls = 1 credit

    // 1. Add log entry to apiUsage/logs collection
    const logDocUrl = `${firestoreUrl}/users/${userId}/apiUsage/logs`;

    await fetch(logDocUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          endpoint: { stringValue: endpoint },
          timestamp: { timestampValue: timestamp },
          creditsUsed: { integerValue: creditsUsed },
          status: { stringValue: status },
          metadata: { stringValue: JSON.stringify(metadata) }
        }
      })
    });

    // 2. Update summary document with incremented counters
    const summaryDocUrl = `${firestoreUrl}/users/${userId}/apiUsage/summary`;

    // First, try to get existing summary
    const summaryResponse = await fetch(summaryDocUrl);

    let currentTotalCredits = 0;
    let currentEndpointCount = 0;

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      currentTotalCredits = parseInt(summaryData.fields?.totalCredits?.integerValue || 0);
      currentEndpointCount = parseInt(summaryData.fields?.[endpoint]?.integerValue || 0);
    }

    // Update summary with new totals
    await fetch(summaryDocUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          totalCredits: { integerValue: currentTotalCredits + creditsUsed },
          [endpoint]: { integerValue: currentEndpointCount + creditsUsed },
          lastUpdated: { timestampValue: timestamp }
        }
      })
    });

    console.log(`✅ API usage logged: ${endpoint} (${status}) - User: ${userId}`);
  } catch (error) {
    console.error('❌ Failed to log API usage:', error);
    // Don't throw - logging failure shouldn't break the main operation
  }
}
