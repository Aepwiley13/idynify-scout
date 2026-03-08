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
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
}

const auth = getAuth();
const db = getFirestore();

export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    // Extract auth token from Authorization header (fallback: request body)
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    let authToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      authToken = authHeader.slice(7);
    }
    const body = JSON.parse(event.body || '{}');
    const userId = body.userId;
    // Fallback: also check body for authToken (backward compatibility)
    if (!authToken && body.authToken) {
      authToken = body.authToken;
    }

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

    // Step 4: Aggregate data for each user in parallel batches
    const BATCH_SIZE = 10;
    const userDocs = usersSnapshot.docs;
    const usersWithData = [];
    const errors = [];

    for (let i = 0; i < userDocs.length; i += BATCH_SIZE) {
      const batch = userDocs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(userDoc => aggregateUserData(userDoc.id))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          usersWithData.push(result.value);
        } else {
          const uid = batch[idx].id;
          console.error(`❌ Error aggregating data for user ${uid}:`, result.reason?.message);
          errors.push({ userId: uid, error: result.reason?.message });
        }
      });
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
    console.error('❌ Error in adminGetUsers:', error);
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
  // Check environment variable first (fast path)
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
 * Aggregate all data for a single user — runs all Firestore reads in parallel.
 */
async function aggregateUserData(uid) {
  const userRef = db.collection('users').doc(uid);

  // Fire all reads concurrently
  const [
    authUser,
    usageDoc,
    icpDoc,
    progressDoc,
    companiesTotal,
    companiesPending,
    companiesAccepted,
    companiesRejected,
    contactsCount,
    leadsCount
  ] = await Promise.allSettled([
    auth.getUser(uid),
    userRef.collection('apiUsage').doc('summary').get(),
    userRef.collection('companyProfile').doc('current').get(),
    userRef.collection('scoutProgress').doc('swipes').get(),
    userRef.collection('companies').count().get(),
    userRef.collection('companies').where('status', '==', 'pending').count().get(),
    userRef.collection('companies').where('status', '==', 'accepted').count().get(),
    userRef.collection('companies').where('status', '==', 'rejected').count().get(),
    userRef.collection('contacts').count().get(),
    userRef.collection('leads').count().get()
  ]);

  // Helper: safely extract fulfilled value
  const val = (settled) => settled.status === 'fulfilled' ? settled.value : null;

  const authData = val(authUser);
  const usageData = val(usageDoc);
  const icpData = val(icpDoc);
  const progressData = val(progressDoc);

  // Build user object
  const userData = {
    uid,
    email: authData?.email || null,
    signupDate: authData?.metadata?.creationTime || null,
    lastLogin: authData?.metadata?.lastSignInTime || null,

    scout: {
      companiesTotal: val(companiesTotal)?.data().count ?? 0,
      companiesPending: val(companiesPending)?.data().count ?? 0,
      companiesAccepted: val(companiesAccepted)?.data().count ?? 0,
      companiesRejected: val(companiesRejected)?.data().count ?? 0,
      contactsTotal: val(contactsCount)?.data().count ?? 0,
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
      leadsTotal: val(leadsCount)?.data().count ?? 0,
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

  // Populate credits
  if (usageData?.exists) {
    const d = usageData.data();
    userData.credits = {
      total: d.totalCredits || 0,
      enrichContact: d.enrichContact || 0,
      enrichCompany: d.enrichCompany || 0,
      searchPeople: d.searchPeople || 0,
      searchCompanies: d.searchCompanies || 0,
      lastUsed: d.lastUpdated ? d.lastUpdated.toDate().toISOString() : null
    };
  }

  // Populate ICP / scout fields
  if (icpData?.exists) {
    const d = icpData.data();
    const industries = d.industries || [];
    const companySizes = d.companySizes || [];
    const locations = d.locations || [];
    const targetTitles = d.targetTitles || [];

    userData.scout.icpConfigured = industries.length > 0 || companySizes.length > 0;
    userData.scout.icpIndustries = industries.length;
    userData.scout.icpCompanySizes = companySizes.length;
    userData.scout.icpLocations = locations.length;
    userData.scout.targetTitles = targetTitles.length;
  }

  // Populate daily swipe count
  if (progressData?.exists) {
    userData.scout.dailySwipeCount = progressData.data().dailySwipeCount || 0;
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
    stats.totalCredits += user.credits?.total ?? 0;
    stats.totalCompanies += user.scout?.companiesTotal ?? 0;
    stats.totalContacts += user.scout?.contactsTotal ?? 0;
  });

  return stats;
}
