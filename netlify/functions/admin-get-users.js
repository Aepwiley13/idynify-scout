/**
 * Admin Dashboard - Get All Users
 *
 * Aggregates user data from Firebase Auth and Firestore for admin dashboard.
 * Requires admin authentication.
 */

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken } = JSON.parse(event.body);

    if (!userId || !authToken) {
      throw new Error('Missing required parameters');
    }

    // Validate environment variables
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || 'idynify-mission-control';
    const adminUserIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

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
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth token verified for user:', userId);

    // Check if user is admin (environment variable OR Firestore role)
    let isAdmin = adminUserIds.includes(userId);

    if (!isAdmin) {
      // Check Firestore for admin role
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;
      const userDocResponse = await fetch(firestoreUrl);

      if (userDocResponse.ok) {
        const userDoc = await userDocResponse.json();
        const role = userDoc.fields?.role?.stringValue;
        isAdmin = role === 'admin';
      }
    }

    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized - Admin access required'
        })
      };
    }

    console.log('✅ Admin access confirmed');

    // Fetch all Firebase Auth users
    console.log('📊 Fetching all users from Firebase Auth...');
    const allUsers = await fetchAllAuthUsers(firebaseApiKey);
    console.log(`✅ Found ${allUsers.length} users`);

    // Aggregate data for each user
    const usersWithData = [];
    const errors = [];

    for (const authUser of allUsers) {
      try {
        const userData = await aggregateUserData(authUser, projectId);
        usersWithData.push(userData);
      } catch (error) {
        console.error(`Error aggregating data for user ${authUser.localId}:`, error);
        errors.push({
          userId: authUser.localId,
          email: authUser.email,
          error: error.message
        });
      }
    }

    // Calculate platform-wide stats
    const platformStats = calculatePlatformStats(usersWithData);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        users: usersWithData,
        platformStats,
        totalUsers: allUsers.length,
        errors: errors.length > 0 ? errors : undefined
      })
    };

  } catch (error) {
    console.error('❌ Error in admin-get-users:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

/**
 * Fetch all users from Firebase Auth
 */
async function fetchAllAuthUsers(firebaseApiKey) {
  const users = [];
  let nextPageToken = null;

  do {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Empty body returns all users
        ...(nextPageToken && { nextPageToken })
      })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Firebase Auth users');
    }

    const data = await response.json();
    if (data.users) {
      users.push(...data.users);
    }

    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return users;
}

/**
 * Aggregate all data for a single user
 */
async function aggregateUserData(authUser, projectId) {
  const uid = authUser.localId;
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // Base user info from Firebase Auth
  const userData = {
    uid,
    email: authUser.email || null,
    signupDate: authUser.createdAt ? new Date(parseInt(authUser.createdAt)).toISOString() : null,
    lastLogin: authUser.lastLoginAt ? new Date(parseInt(authUser.lastLoginAt)).toISOString() : null,

    // Scout metrics (to be populated)
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

    // Recon metrics (to be populated)
    recon: {
      leadsTotal: 0,
      icpBriefGenerated: false,
      lastActivity: null
    },

    // API credits (to be populated)
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

      // Find last activity (most recent swipedAt or createdAt)
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
    activeUsers: 0, // logged in within last 7 days
    totalCredits: 0,
    totalCompanies: 0,
    totalContacts: 0
  };

  users.forEach(user => {
    // Count active users (last login within 7 days)
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
