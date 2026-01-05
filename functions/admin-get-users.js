/**
 * Admin Dashboard - Get All Users (Firebase Function)
 *
 * Aggregates user data from Firebase Auth and Firestore for admin dashboard.
 * Requires admin authentication.
 *
 * Architecture: Firebase Functions with Admin SDK (no service account keys needed)
 */

import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK (uses default credentials in Cloud Functions)
initializeApp();
const auth = getAuth();
const db = getFirestore();

/**
 * Admin Get Users - HTTP Cloud Function
 *
 * Fetches all users with aggregated data from Firestore
 * Supports pagination (optional limit and cursor)
 */
export const adminGetUsers = onRequest(
  {
    region: 'us-central1',
    cors: ['https://idynify.com', 'http://localhost:5173'],
    maxInstances: 10,
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const { userId, authToken, limit, cursor } = req.body;

      if (!userId || !authToken) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: userId and authToken'
        });
      }

      // Log request for observability
      console.log('📊 Admin API Call:', {
        function: 'adminGetUsers',
        callerUid: userId,
        timestamp: new Date().toISOString(),
        hasPagination: !!limit
      });

      // Step 1: Verify Firebase Auth token
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(authToken);
      } catch (error) {
        console.error('❌ Invalid auth token:', error.message);
        return res.status(401).json({
          success: false,
          error: 'Invalid authentication token'
        });
      }

      if (decodedToken.uid !== userId) {
        console.error('❌ Token UID mismatch');
        return res.status(401).json({
          success: false,
          error: 'Token does not match user ID'
        });
      }

      console.log('✅ Auth token verified for user:', userId);

      // Step 2: Check if user is admin
      const isAdmin = await checkAdminAccess(userId);

      if (!isAdmin) {
        console.warn('⚠️ Unauthorized admin access attempt by:', userId);
        return res.status(403).json({
          success: false,
          error: 'Unauthorized - Admin access required'
        });
      }

      console.log('✅ Admin access confirmed for:', userId);

      // Step 3: Fetch all users from Firebase Auth
      console.log('📊 Fetching all users from Firebase Auth...');
      const allUsers = await fetchAllAuthUsers(limit);
      console.log(`✅ Found ${allUsers.length} users`);

      // Step 4: Aggregate data for each user
      const usersWithData = [];
      const errors = [];

      for (const authUser of allUsers) {
        try {
          const userData = await aggregateUserData(authUser);
          usersWithData.push(userData);
        } catch (error) {
          console.error(`❌ Error aggregating data for user ${authUser.uid}:`, error.message);
          errors.push({
            userId: authUser.uid,
            email: authUser.email,
            error: error.message
          });
        }
      }

      // Step 5: Calculate platform-wide stats
      const platformStats = calculatePlatformStats(usersWithData);

      console.log('✅ Successfully aggregated data for all users');

      return res.status(200).json({
        success: true,
        users: usersWithData,
        platformStats,
        totalUsers: allUsers.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('❌ Error in adminGetUsers:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }
);

/**
 * Check if user has admin access
 *
 * Checks both:
 * 1. Environment variable (ADMIN_USER_IDS) - for bootstrap access
 * 2. Firestore users/{uid}/role === 'admin' - source of truth
 *
 * Either grants access, but Firestore is preferred.
 */
async function checkAdminAccess(userId) {
  // Check environment variable (bootstrap access)
  const adminUserIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (adminUserIds.includes(userId)) {
    console.log('🔑 Admin access granted via ADMIN_USER_IDS env var');
    return true;
  }

  // Check Firestore role (source of truth)
  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (userDoc.exists) {
      const role = userDoc.data().role;
      const isAdmin = role === 'admin';

      if (isAdmin) {
        console.log('🔑 Admin access granted via Firestore role');
      }

      return isAdmin;
    }
  } catch (error) {
    console.error('⚠️ Error checking Firestore for admin role:', error);
  }

  return false;
}

/**
 * Fetch all users from Firebase Auth
 *
 * Supports pagination via limit parameter (for future use)
 */
async function fetchAllAuthUsers(limit = null) {
  const users = [];
  let pageToken;

  do {
    const listUsersResult = await auth.listUsers(1000, pageToken);

    users.push(...listUsersResult.users);
    pageToken = listUsersResult.pageToken;

    // If limit specified, stop when reached
    if (limit && users.length >= limit) {
      return users.slice(0, limit);
    }
  } while (pageToken);

  return users;
}

/**
 * Aggregate all data for a single user
 *
 * Fetches data from multiple Firestore collections and combines with Auth data
 */
async function aggregateUserData(authUser) {
  const uid = authUser.uid;

  // Base user info from Firebase Auth
  const userData = {
    uid,
    email: authUser.email || null,
    signupDate: authUser.metadata.creationTime || null,
    lastLogin: authUser.metadata.lastSignInTime || null,

    // Scout metrics
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

    // Recon metrics
    recon: {
      leadsTotal: 0,
      icpBriefGenerated: false,
      lastActivity: null
    },

    // API credits
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
    const usageSummaryDoc = await db
      .collection('users')
      .doc(uid)
      .collection('apiUsage')
      .doc('summary')
      .get();

    if (usageSummaryDoc.exists) {
      const data = usageSummaryDoc.data();
      userData.credits = {
        total: data.totalCredits || 0,
        enrichContact: data.enrichContact || 0,
        enrichCompany: data.enrichCompany || 0,
        searchPeople: data.searchPeople || 0,
        searchCompanies: data.searchCompanies || 0,
        lastUsed: data.lastUpdated?.toDate().toISOString() || null
      };
    }
  } catch (error) {
    console.error(`Failed to fetch API usage for ${uid}:`, error);
  }

  // Fetch ICP profile
  try {
    const icpDoc = await db
      .collection('users')
      .doc(uid)
      .collection('companyProfile')
      .doc('current')
      .get();

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
    const progressDoc = await db
      .collection('users')
      .doc(uid)
      .collection('scoutProgress')
      .doc('swipes')
      .get();

    if (progressDoc.exists) {
      const data = progressDoc.data();
      userData.scout.dailySwipeCount = data.dailySwipeCount || 0;
    }
  } catch (error) {
    console.error(`Failed to fetch Scout progress for ${uid}:`, error);
  }

  // Count companies by status
  try {
    const companiesSnapshot = await db
      .collection('users')
      .doc(uid)
      .collection('companies')
      .get();

    const companies = companiesSnapshot.docs;
    userData.scout.companiesTotal = companies.length;

    companies.forEach(doc => {
      const data = doc.data();
      const status = data.status;

      if (status === 'pending') userData.scout.companiesPending++;
      if (status === 'accepted') userData.scout.companiesAccepted++;
      if (status === 'rejected') userData.scout.companiesRejected++;

      // Find last activity
      const swipedAt = data.swipedAt?.toDate();
      const createdAt = data.createdAt?.toDate();
      const timestamp = swipedAt || createdAt;

      if (timestamp) {
        const timestampISO = timestamp.toISOString();
        if (!userData.scout.lastActivity || timestampISO > userData.scout.lastActivity) {
          userData.scout.lastActivity = timestampISO;
        }
      }
    });
  } catch (error) {
    console.error(`Failed to fetch companies for ${uid}:`, error);
  }

  // Count contacts
  try {
    const contactsSnapshot = await db
      .collection('users')
      .doc(uid)
      .collection('contacts')
      .get();

    userData.scout.contactsTotal = contactsSnapshot.size;
  } catch (error) {
    console.error(`Failed to fetch contacts for ${uid}:`, error);
  }

  // Count Recon leads
  try {
    const leadsSnapshot = await db
      .collection('users')
      .doc(uid)
      .collection('leads')
      .get();

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
