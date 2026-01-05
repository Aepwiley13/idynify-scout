/**
 * Admin Get Users - Netlify Function
 *
 * Fetches all users with aggregated data from Firestore for admin dashboard.
 * Uses Firebase Admin SDK with application default credentials.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev'
  });
}

const auth = getAuth();
const db = getFirestore();

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

    console.log('📊 Admin API Call:', { userId, timestamp: new Date().toISOString() });

    // Step 1: Verify Firebase Auth token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(authToken);
    } catch (error) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid authentication token'
        })
      };
    }

    if (decodedToken.uid !== userId) {
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
    const isAdmin = await checkAdminAccess(userId);

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
    const usersSnapshot = await db.collection('users').get();
    console.log(`✅ Found ${usersSnapshot.size} users in Firestore`);

    // Step 4: Aggregate data for each user
    const usersWithData = [];
    const errors = [];

    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = await aggregateUserData(userDoc.id);
        usersWithData.push(userData);
      } catch (error) {
        console.error(`❌ Error aggregating data for user ${userDoc.id}:`, error.message);
        errors.push({
          userId: userDoc.id,
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
 * Check if user has admin access
 */
async function checkAdminAccess(userId) {
  // Check environment variable
  const adminUserIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

  if (adminUserIds.includes(userId)) {
    console.log('🔑 Admin access granted via ADMIN_USER_IDS env var');
    return true;
  }

  // Check Firestore role
  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (userDoc.exists) {
      const role = userDoc.data().role;

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
 * Aggregate all data for a single user
 */
async function aggregateUserData(uid) {
  // Fetch auth data for this user
  let email = null;
  let signupDate = null;
  let lastLogin = null;

  try {
    const authUser = await auth.getUser(uid);
    email = authUser.email || null;
    signupDate = authUser.metadata.creationTime || null;
    lastLogin = authUser.metadata.lastSignInTime || null;
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
    const usageDoc = await db.collection('users').doc(uid).collection('apiUsage').doc('summary').get();

    if (usageDoc.exists) {
      const data = usageDoc.data();
      userData.credits = {
        total: data.totalCredits || 0,
        enrichContact: data.enrichContact || 0,
        enrichCompany: data.enrichCompany || 0,
        searchPeople: data.searchPeople || 0,
        searchCompanies: data.searchCompanies || 0,
        lastUsed: data.lastUpdated ? data.lastUpdated.toDate().toISOString() : null
      };
    }
  } catch (error) {
    console.error(`Failed to fetch API usage for ${uid}:`, error);
  }

  // Fetch ICP profile
  try {
    const icpDoc = await db.collection('users').doc(uid).collection('companyProfile').doc('current').get();

    if (icpDoc.exists) {
      const data = icpDoc.data();
      const industries = data.industries || [];
      const companySizes = data.companySizes || [];
      const locations = data.locations || [];
      const targetTitles = data.targetTitles || [];

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
    const progressDoc = await db.collection('users').doc(uid).collection('scoutProgress').doc('swipes').get();

    if (progressDoc.exists) {
      const data = progressDoc.data();
      userData.scout.dailySwipeCount = data.dailySwipeCount || 0;
    }
  } catch (error) {
    console.error(`Failed to fetch Scout progress for ${uid}:`, error);
  }

  // Count companies by status
  try {
    const companiesSnapshot = await db.collection('users').doc(uid).collection('companies').get();
    const companies = companiesSnapshot.docs;

    userData.scout.companiesTotal = companies.length;
    userData.scout.companiesPending = companies.filter(doc => doc.data().status === 'pending').length;
    userData.scout.companiesAccepted = companies.filter(doc => doc.data().status === 'accepted').length;
    userData.scout.companiesRejected = companies.filter(doc => doc.data().status === 'rejected').length;

    // Find last activity
    let lastActivityTimestamp = null;
    companies.forEach(doc => {
      const data = doc.data();
      const swipedAt = data.swipedAt;
      const createdAt = data.createdAt;
      const timestamp = swipedAt || createdAt;

      if (timestamp && (!lastActivityTimestamp || timestamp.toDate() > lastActivityTimestamp)) {
        lastActivityTimestamp = timestamp.toDate();
      }
    });

    userData.scout.lastActivity = lastActivityTimestamp ? lastActivityTimestamp.toISOString() : null;
  } catch (error) {
    console.error(`Failed to fetch companies for ${uid}:`, error);
  }

  // Count contacts
  try {
    const contactsSnapshot = await db.collection('users').doc(uid).collection('contacts').get();
    userData.scout.contactsTotal = contactsSnapshot.size;
  } catch (error) {
    console.error(`Failed to fetch contacts for ${uid}:`, error);
  }

  // Count Recon leads
  try {
    const leadsSnapshot = await db.collection('users').doc(uid).collection('leads').get();
    userData.recon.leadsTotal = leadsSnapshot.size;
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
