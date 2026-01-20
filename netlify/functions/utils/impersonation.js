/**
 * Impersonation Utilities
 *
 * Manages admin impersonation sessions for "View as User" functionality.
 * Features:
 * - 30-minute session timeout
 * - Session validation and cleanup
 * - Security checks and audit logging
 */

import { db } from '../firebase-admin.js';

// Session timeout: 30 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Create a new impersonation session
 * @param {string} adminUserId - The admin's user ID
 * @param {string} targetUserId - The user to impersonate
 * @param {string} reason - Reason for impersonation
 * @param {string} ipAddress - Admin's IP address
 * @returns {Promise<Object>} Session data
 */
export async function createImpersonationSession(adminUserId, targetUserId, reason, ipAddress) {
  try {
    // Check if admin already has an active session
    const existingSession = await getActiveImpersonationSession(adminUserId);
    if (existingSession) {
      throw new Error('Admin already has an active impersonation session. Please end it first.');
    }

    // Check if target user exists
    const targetUserDoc = await db.collection('users').doc(targetUserId).get();
    if (!targetUserDoc.exists) {
      throw new Error('Target user not found');
    }

    // Check if target user is also an admin (prevent admin-to-admin impersonation)
    const targetUserData = targetUserDoc.data();
    if (targetUserData.role === 'admin') {
      throw new Error('Cannot impersonate another admin user');
    }

    // Calculate expiration time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

    // Create session document
    const sessionData = {
      adminUserId,
      targetUserId,
      targetUserEmail: targetUserData.email || '',
      reason: reason || 'Support troubleshooting',
      status: 'active',
      startedAt: now,
      expiresAt: expiresAt,
      lastActivityAt: now,
      ipAddress: ipAddress || null,
      endedAt: null,
      endReason: null
    };

    const sessionRef = await db.collection('impersonationSessions').add(sessionData);

    return {
      sessionId: sessionRef.id,
      ...sessionData,
      startedAt: sessionData.startedAt.toISOString(),
      expiresAt: sessionData.expiresAt.toISOString(),
      lastActivityAt: sessionData.lastActivityAt.toISOString()
    };

  } catch (error) {
    console.error('❌ Error creating impersonation session:', error);
    throw error;
  }
}

/**
 * Get active impersonation session for an admin
 * @param {string} adminUserId - The admin's user ID
 * @returns {Promise<Object|null>} Session data or null
 */
export async function getActiveImpersonationSession(adminUserId) {
  try {
    const now = new Date();

    // Query for active sessions
    const snapshot = await db.collection('impersonationSessions')
      .where('adminUserId', '==', adminUserId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const sessionData = doc.data();

    // Check if session has expired
    const expiresAt = sessionData.expiresAt.toDate();
    if (now > expiresAt) {
      // Auto-expire the session
      await endImpersonationSession(doc.id, 'Session expired (30 minutes)');
      return null;
    }

    // Update last activity timestamp
    await doc.ref.update({
      lastActivityAt: now
    });

    return {
      sessionId: doc.id,
      ...sessionData,
      startedAt: sessionData.startedAt?.toDate ? sessionData.startedAt.toDate().toISOString() : sessionData.startedAt,
      expiresAt: sessionData.expiresAt?.toDate ? sessionData.expiresAt.toDate().toISOString() : sessionData.expiresAt,
      lastActivityAt: now.toISOString()
    };

  } catch (error) {
    console.error('❌ Error getting active impersonation session:', error);
    return null; // Fail open - don't block requests if there's an error
  }
}

/**
 * Get impersonation session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session data or null
 */
export async function getImpersonationSessionById(sessionId) {
  try {
    const doc = await db.collection('impersonationSessions').doc(sessionId).get();

    if (!doc.exists) {
      return null;
    }

    const sessionData = doc.data();

    return {
      sessionId: doc.id,
      ...sessionData,
      startedAt: sessionData.startedAt?.toDate ? sessionData.startedAt.toDate().toISOString() : sessionData.startedAt,
      expiresAt: sessionData.expiresAt?.toDate ? sessionData.expiresAt.toDate().toISOString() : sessionData.expiresAt,
      lastActivityAt: sessionData.lastActivityAt?.toDate ? sessionData.lastActivityAt.toDate().toISOString() : sessionData.lastActivityAt,
      endedAt: sessionData.endedAt?.toDate ? sessionData.endedAt.toDate().toISOString() : sessionData.endedAt
    };

  } catch (error) {
    console.error('❌ Error getting impersonation session by ID:', error);
    return null;
  }
}

/**
 * End an impersonation session
 * @param {string} sessionId - Session ID
 * @param {string} endReason - Reason for ending session
 * @returns {Promise<boolean>} Success status
 */
export async function endImpersonationSession(sessionId, endReason = 'Manually ended by admin') {
  try {
    const sessionRef = db.collection('impersonationSessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      throw new Error('Session not found');
    }

    const sessionData = sessionDoc.data();

    // Only end active sessions
    if (sessionData.status !== 'active') {
      throw new Error('Session is not active');
    }

    await sessionRef.update({
      status: 'ended',
      endedAt: new Date(),
      endReason: endReason
    });

    return true;

  } catch (error) {
    console.error('❌ Error ending impersonation session:', error);
    throw error;
  }
}

/**
 * Validate impersonation session and return target user ID
 * @param {string} adminUserId - The admin's user ID
 * @returns {Promise<string|null>} Target user ID or null
 */
export async function validateImpersonationSession(adminUserId) {
  try {
    const session = await getActiveImpersonationSession(adminUserId);
    if (!session) {
      return null;
    }

    return session.targetUserId;

  } catch (error) {
    console.error('❌ Error validating impersonation session:', error);
    return null;
  }
}

/**
 * Cleanup expired impersonation sessions (run periodically)
 * @returns {Promise<number>} Number of sessions cleaned up
 */
export async function cleanupExpiredSessions() {
  try {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - SESSION_TIMEOUT_MS);

    // Find expired active sessions
    const snapshot = await db.collection('impersonationSessions')
      .where('status', '==', 'active')
      .where('expiresAt', '<=', now)
      .get();

    let count = 0;

    const batch = db.batch();

    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'ended',
        endedAt: now,
        endReason: 'Auto-expired (30 minutes)'
      });
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(`✅ Cleaned up ${count} expired impersonation sessions`);
    }

    return count;

  } catch (error) {
    console.error('❌ Error cleaning up expired sessions:', error);
    return 0;
  }
}

/**
 * Get impersonation session history for a user (target or admin)
 * @param {string} userId - User ID (can be admin or target)
 * @param {string} role - 'admin' or 'target'
 * @param {number} limit - Max number of sessions to return
 * @returns {Promise<Array>} Array of session objects
 */
export async function getImpersonationHistory(userId, role = 'admin', limit = 50) {
  try {
    const field = role === 'admin' ? 'adminUserId' : 'targetUserId';

    const snapshot = await db.collection('impersonationSessions')
      .where(field, '==', userId)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();

    const sessions = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      sessions.push({
        sessionId: doc.id,
        ...data,
        startedAt: data.startedAt?.toDate ? data.startedAt.toDate().toISOString() : data.startedAt,
        expiresAt: data.expiresAt?.toDate ? data.expiresAt.toDate().toISOString() : data.expiresAt,
        lastActivityAt: data.lastActivityAt?.toDate ? data.lastActivityAt.toDate().toISOString() : data.lastActivityAt,
        endedAt: data.endedAt?.toDate ? data.endedAt.toDate().toISOString() : data.endedAt
      });
    });

    return sessions;

  } catch (error) {
    console.error('❌ Error getting impersonation history:', error);
    return [];
  }
}

/**
 * Calculate remaining time for a session
 * @param {Object} session - Session object
 * @returns {number} Remaining milliseconds
 */
export function getRemainingTime(session) {
  if (!session || session.status !== 'active') {
    return 0;
  }

  const expiresAt = new Date(session.expiresAt);
  const now = new Date();
  const remaining = expiresAt.getTime() - now.getTime();

  return Math.max(0, remaining);
}

/**
 * Format remaining time as human-readable string
 * @param {number} milliseconds - Remaining time in milliseconds
 * @returns {string} Formatted time string
 */
export function formatRemainingTime(milliseconds) {
  if (milliseconds <= 0) {
    return 'Expired';
  }

  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}
