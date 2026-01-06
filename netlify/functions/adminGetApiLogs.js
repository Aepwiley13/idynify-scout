/**
 * Admin Get API Logs - Netlify Function
 *
 * Fetches API logs from Firestore for admin dashboard.
 * Uses Firebase Admin SDK with service account credentials.
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
    const { userId, authToken, filters } = JSON.parse(event.body);

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

    console.log('📊 Admin API Logs Request:', { userId, filters, timestamp: new Date().toISOString() });

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

    // Step 3: Fetch API logs from Firestore
    console.log('📊 Fetching API logs from Firestore...');

    let query = db.collection('apiLogs').orderBy('timestamp', 'desc');

    // Apply filters if provided
    if (filters) {
      if (filters.startDate) {
        query = query.where('timestamp', '>=', new Date(filters.startDate));
      }
      if (filters.endDate) {
        query = query.where('timestamp', '<=', new Date(filters.endDate));
      }
      if (filters.endpoint) {
        query = query.where('endpoint', '==', filters.endpoint);
      }
      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }
      if (filters.environment) {
        query = query.where('environment', '==', filters.environment);
      }
    }

    // Limit to 1000 logs (defensive cap)
    query = query.limit(1000);

    const logsSnapshot = await query.get();
    console.log(`✅ Found ${logsSnapshot.size} API logs`);

    // Transform logs to client format
    const logs = logsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        endpoint: data.endpoint,
        creditsUsed: data.creditsUsed,
        timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp,
        status: data.status,
        responseTime: data.responseTime || 0,
        environment: data.environment,
        errorCode: data.errorCode || null,
        metadata: data.metadata ? JSON.parse(data.metadata) : null
      };
    });

    console.log('✅ Successfully fetched API logs');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        logs,
        totalLogs: logs.length
      })
    };

  } catch (error) {
    console.error('❌ Error in admin-get-api-logs:', error);
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
