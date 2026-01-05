/**
 * Admin Get Users - Netlify Function
 *
 * Fetches all users with aggregated data from Firestore for admin dashboard.
 * Uses Firebase REST APIs (no Admin SDK needed).
 */

export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken } = JSON.parse(event.body);

    if (!userId || !authToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required parameters: userId and authToken'
        })
      };
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev';

    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    console.log('📊 Admin API Call:', { userId, timestamp: new Date().toISOString() });

    // Step 1: Verify Firebase Auth token
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
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid authentication token'
        })
      };
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Token does not match user ID'
        })
      };
    }

    console.log('✅ Auth token verified for user:', userId);

    // Step 2: Check if user is admin
    const isAdmin = await checkAdminAccess(userId, projectId);

    if (!isAdmin) {
      console.warn('⚠️ Unauthorized admin access attempt by:', userId);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized - Admin access required'
        })
      };
    }

    console.log('✅ Admin access confirmed for:', userId);

    // Step 3: Fetch all users from Firestore users collection
    console.log('📊 Fetching all users from Firestore...');
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const allUserIds = await fetchAllFirestoreUsers(firestoreUrl);
    console.log(`✅ Found ${allUserIds.length} users in Firestore`);

    // Step 4: Aggregate data for each user
    const usersWithData = [];
    const errors = [];

    for (const userId of allUserIds) {
      try {
        const userData = await aggregateUserData(userId, projectId, firebaseApiKey);
        usersWithData.push(userData);
      } catch (error) {
        console.error(`❌ Error aggregating data for user ${userId}:`, error.message);
        errors.push({
          userId,
          error: error.message
        });
      }
    }

    // Step 5: Calculate platform-wide stats
    const platformStats = calculatePlatformStats(usersWithData);

    console.log('✅ Successfully aggregated data for all users');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        users: usersWithData,
        platformStats,
        totalUsers: usersWithData.length,
        errors: errors.length > 0 ? errors : undefined
      })
    };

  } catch (error) {
    console.error('❌ Error in admin-get-users:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      })
    };
  }
};

/**
 * Check if user has admin access via Firestore
 */
async function checkAdminAccess(userId, projectId) {
  // Check environment variable
  const adminUserIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

  if (adminUserIds.includes(userId)) {
    console.log('🔑 Admin access granted via ADMIN_USER_IDS env var');
    return true;
  }

  // Check Firestore role
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;
    const userDocResponse = await fetch(firestoreUrl);

    if (userDocResponse.ok) {
      const userDoc = await userDocResponse.json();
      const role = userDoc.fields?.role?.stringValue;

      if (role === 'admin') {
        console.log('🔑 Admin access granted via Firestore role');
        return true;
      }
    }
  } catch (error) {
    console.error('⚠️ Error checking Firestore for admin role:', error);
  }

  return false;
}

/**
 * Fetch all user IDs from Firestore users collection
 */
async function fetchAllFirestoreUsers(firestoreUrl) {
  const userIds = [];
  let pageToken = null;

  do {
    const url = `${firestoreUrl}/users${pageToken ? `?pageToken=${pageToken}` : ''}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch Firestore users collection');
    }

    const data = await response.json();

    // Extract user IDs from document paths
    if (data.documents) {
      data.documents.forEach(doc => {
        // Document name format: projects/{project}/databases/{db}/documents/users/{userId}
        const userId = doc.name.split('/').pop();
        userIds.push(userId);
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return userIds;
}

/**
 * Aggregate all data for a single user
 */
async function aggregateUserData(uid, projectId, firebaseApiKey) {
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // Fetch auth data for this user
  let email = null;
  let signupDate = null;
  let lastLogin = null;

  try {
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`;
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] })
    });

    if (authResponse.ok) {
      const authData = await authResponse.json();
      if (authData.users && authData.users.length > 0) {
        const authUser = authData.users[0];
        email = authUser.email || null;
        signupDate = authUser.createdAt ? new Date(parseInt(authUser.createdAt)).toISOString() : null;
        lastLogin = authUser.lastLoginAt ? new Date(parseInt(authUser.lastLoginAt)).toISOString() : null;
      }
    }
  } catch (error) {
    console.error(`Failed to fetch auth data for ${uid}:`, error);
  }

  const userData = {
    uid,
    email,
    signupDate,
    lastLogin,

    scout: {
      companiesTotal: 0,
      companiesPending: 0,
      companiesAccepted: 0,
      companiesRejected: 0,
      contactsTotal: 0,
      icpConfigured: false,
      icpIndustries: 0,
      icpCompanySizes: 0,
      icpLocations: 0,
      targetTitles: 0,
      dailySwipeCount: 0,
      dailySwipeLimit: 25,
      lastActivity: null
    },

    recon: {
      leadsTotal: 0,
      icpBriefGenerated: false,
      lastActivity: null
    },

    credits: {
      total: 0,
      enrichContact: 0,
      enrichCompany: 0,
      searchPeople: 0,
      searchCompanies: 0,
      lastUsed: null
    }
  };

  // Fetch API usage summary
  try {
    const usageSummaryUrl = `${firestoreUrl}/users/${uid}/apiUsage/summary`;
    const usageResponse = await fetch(usageSummaryUrl);

    if (usageResponse.ok) {
      const usageDoc = await usageResponse.json();
      userData.credits = {
        total: parseInt(usageDoc.fields?.totalCredits?.integerValue || 0),
        enrichContact: parseInt(usageDoc.fields?.enrichContact?.integerValue || 0),
        enrichCompany: parseInt(usageDoc.fields?.enrichCompany?.integerValue || 0),
        searchPeople: parseInt(usageDoc.fields?.searchPeople?.integerValue || 0),
        searchCompanies: parseInt(usageDoc.fields?.searchCompanies?.integerValue || 0),
        lastUsed: usageDoc.fields?.lastUpdated?.timestampValue || null
      };
    }
  } catch (error) {
    console.error(`Failed to fetch API usage for ${uid}:`, error);
  }

  // Fetch ICP profile
  try {
    const icpUrl = `${firestoreUrl}/users/${uid}/companyProfile/current`;
    const icpResponse = await fetch(icpUrl);

    if (icpResponse.ok) {
      const icpDoc = await icpResponse.json();
      const industries = icpDoc.fields?.industries?.arrayValue?.values || [];
      const companySizes = icpDoc.fields?.companySizes?.arrayValue?.values || [];
      const locations = icpDoc.fields?.locations?.arrayValue?.values || [];
      const targetTitles = icpDoc.fields?.targetTitles?.arrayValue?.values || [];

      userData.scout.icpConfigured = industries.length > 0 || companySizes.length > 0;
      userData.scout.icpIndustries = industries.length;
      userData.scout.icpCompanySizes = companySizes.length;
      userData.scout.icpLocations = locations.length;
      userData.scout.targetTitles = targetTitles.length;
    }
  } catch (error) {
    console.error(`Failed to fetch ICP for ${uid}:`, error);
  }

  // Fetch Scout progress
  try {
    const progressUrl = `${firestoreUrl}/users/${uid}/scoutProgress/swipes`;
    const progressResponse = await fetch(progressUrl);

    if (progressResponse.ok) {
      const progressDoc = await progressResponse.json();
      userData.scout.dailySwipeCount = parseInt(progressDoc.fields?.dailySwipeCount?.integerValue || 0);
    }
  } catch (error) {
    console.error(`Failed to fetch Scout progress for ${uid}:`, error);
  }

  // Count companies by status
  try {
    const companiesUrl = `${firestoreUrl}/users/${uid}/companies`;
    const companiesResponse = await fetch(companiesUrl);

    if (companiesResponse.ok) {
      const companiesData = await companiesResponse.json();
      const companies = companiesData.documents || [];

      userData.scout.companiesTotal = companies.length;
      userData.scout.companiesPending = companies.filter(doc =>
        doc.fields?.status?.stringValue === 'pending'
      ).length;
      userData.scout.companiesAccepted = companies.filter(doc =>
        doc.fields?.status?.stringValue === 'accepted'
      ).length;
      userData.scout.companiesRejected = companies.filter(doc =>
        doc.fields?.status?.stringValue === 'rejected'
      ).length;

      // Find last activity
      let lastActivityTimestamp = null;
      companies.forEach(doc => {
        const swipedAt = doc.fields?.swipedAt?.timestampValue;
        const createdAt = doc.fields?.createdAt?.timestampValue;
        const timestamp = swipedAt || createdAt;

        if (timestamp && (!lastActivityTimestamp || timestamp > lastActivityTimestamp)) {
          lastActivityTimestamp = timestamp;
        }
      });

      userData.scout.lastActivity = lastActivityTimestamp;
    }
  } catch (error) {
    console.error(`Failed to fetch companies for ${uid}:`, error);
  }

  // Count contacts
  try {
    const contactsUrl = `${firestoreUrl}/users/${uid}/contacts`;
    const contactsResponse = await fetch(contactsUrl);

    if (contactsResponse.ok) {
      const contactsData = await contactsResponse.json();
      userData.scout.contactsTotal = (contactsData.documents || []).length;
    }
  } catch (error) {
    console.error(`Failed to fetch contacts for ${uid}:`, error);
  }

  // Count Recon leads
  try {
    const leadsUrl = `${firestoreUrl}/users/${uid}/leads`;
    const leadsResponse = await fetch(leadsUrl);

    if (leadsResponse.ok) {
      const leadsData = await leadsResponse.json();
      userData.recon.leadsTotal = (leadsData.documents || []).length;
    }
  } catch (error) {
    console.error(`Failed to fetch leads for ${uid}:`, error);
  }

  return userData;
}

/**
 * Calculate platform-wide statistics
 */
function calculatePlatformStats(users) {
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const stats = {
    totalUsers: users.length,
    activeUsers: 0,
    totalCredits: 0,
    totalCompanies: 0,
    totalContacts: 0
  };

  users.forEach(user => {
    // Count active users
    if (user.lastLogin) {
      const lastLogin = new Date(user.lastLogin);
      if (lastLogin >= sevenDaysAgo) {
        stats.activeUsers++;
      }
    }

    // Sum totals
    stats.totalCredits += user.credits.total;
    stats.totalCompanies += user.scout.companiesTotal;
    stats.totalContacts += user.scout.contactsTotal;
  });

  return stats;
}
