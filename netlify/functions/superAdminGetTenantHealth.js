/**
 * Super Admin - Get Tenant Health
 *
 * Returns a comprehensive health snapshot for a specific tenant account:
 * users, companies, integrations, sync status, recent errors.
 *
 * Endpoint: /.netlify/functions/superAdminGetTenantHealth
 * Method: POST
 * Auth: Requires Firebase auth token + super_admin role + global_read permission
 *
 * Body: { tenantUserId: string }
 */

import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkSuperAdminAccess, hasSuperAdminPermission, SUPER_ADMIN_PERMISSIONS } from './utils/superAdminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://idynify.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const ipAddress = getIpAddress(event);
  const userAgent = getUserAgent(event);

  try {
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Authentication required' }) };
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Invalid authentication token' }) };
    }

    const actorUserId = decodedToken.uid;

    const isSuperAdmin = await checkSuperAdminAccess(actorUserId);
    if (!isSuperAdmin) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Super admin access required' }) };
    }

    const hasReadPermission = await hasSuperAdminPermission(actorUserId, SUPER_ADMIN_PERMISSIONS.GLOBAL_READ);
    if (!hasReadPermission) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'global_read permission required' }) };
    }

    const { tenantUserId } = JSON.parse(event.body || '{}');
    if (!tenantUserId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'tenantUserId is required' }) };
    }

    // Fetch Firebase Auth profile
    let authProfile;
    try {
      authProfile = await admin.auth().getUser(tenantUserId);
    } catch {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Tenant user not found' }) };
    }

    // Fetch Firestore user document
    const userDoc = await db.collection('users').doc(tenantUserId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Subcollection counts
    const [companiesSnap, contactsSnap, leadsSnap, missionsSnap, eventsSnap] = await Promise.all([
      db.collection('users').doc(tenantUserId).collection('companies').count().get(),
      db.collection('users').doc(tenantUserId).collection('contacts').count().get(),
      db.collection('users').doc(tenantUserId).collection('leads').count().get(),
      db.collection('users').doc(tenantUserId).collection('missions').count().get(),
      db.collection('users').doc(tenantUserId).collection('events').orderBy('timestamp', 'desc').limit(10).get()
    ]);

    // Recent events (credit usage / errors)
    const recentEvents = [];
    eventsSnap.forEach(doc => {
      const d = doc.data();
      recentEvents.push({
        id: doc.id,
        type: d.type || d.eventType || 'unknown',
        timestamp: d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : d.timestamp,
        details: d.details || d.description || null
      });
    });

    // Recent audit log entries for this tenant
    const recentAuditSnap = await db.collection('adminAuditLogs')
      .where('targetUserId', '==', tenantUserId)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    const recentAdminActions = [];
    recentAuditSnap.forEach(doc => {
      const d = doc.data();
      recentAdminActions.push({
        id: doc.id,
        action: d.action,
        actorEmail: d.actorEmail,
        status: d.status,
        timestamp: d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : d.timestamp
      });
    });

    // Recent impersonation sessions for this tenant
    const recentImpersonationSnap = await db.collection('impersonationSessions')
      .where('targetUserId', '==', tenantUserId)
      .orderBy('startedAt', 'desc')
      .limit(5)
      .get();

    const impersonationHistory = [];
    recentImpersonationSnap.forEach(doc => {
      const d = doc.data();
      impersonationHistory.push({
        sessionId: doc.id,
        adminUserId: d.adminUserId,
        status: d.status,
        startedAt: d.startedAt?.toDate ? d.startedAt.toDate().toISOString() : d.startedAt,
        endedAt: d.endedAt?.toDate ? d.endedAt.toDate().toISOString() : d.endedAt,
        endReason: d.endReason
      });
    });

    // Check for active impersonation session
    const activeSessionSnap = await db.collection('impersonationSessions')
      .where('targetUserId', '==', tenantUserId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    const hasActiveImpersonation = !activeSessionSnap.empty;

    // Integration health (Gmail, Calendar tokens presence)
    const integrations = {
      gmail: !!(userData.gmailAccessToken || userData.gmail_access_token),
      calendar: !!(userData.calendarAccessToken || userData.calendar_access_token),
      crm: !!(userData.crmConnected || userData.hubspot || userData.salesforce)
    };

    const health = {
      tenant: {
        uid: tenantUserId,
        email: authProfile.email || '',
        displayName: authProfile.displayName || '',
        emailVerified: authProfile.emailVerified,
        disabled: authProfile.disabled,
        createdAt: authProfile.metadata?.creationTime || null,
        lastSignIn: authProfile.metadata?.lastSignInTime || null
      },
      account: {
        role: userData.role || 'user',
        status: userData.status || 'unknown',
        subscriptionTier: userData.subscriptionTier || userData.selectedTier || null,
        hasCompletedPayment: userData.hasCompletedPayment || false,
        credits: userData.credits ?? null,
        monthlyCredits: userData.monthlyCredits ?? null,
        lastCreditReset: userData.lastCreditReset?.toDate
          ? userData.lastCreditReset.toDate().toISOString()
          : userData.lastCreditReset || null
      },
      data: {
        companies: companiesSnap.data().count,
        contacts: contactsSnap.data().count,
        leads: leadsSnap.data().count,
        missions: missionsSnap.data().count
      },
      integrations,
      recentEvents,
      recentAdminActions,
      impersonationHistory,
      hasActiveImpersonation
    };

    // Log audit event
    const actorAuthUser = await admin.auth().getUser(actorUserId);
    await logAuditEvent({
      action: 'super_admin_view_tenant_health',
      logType: 'admin_action',
      actorUserId,
      actorEmail: actorAuthUser.email,
      targetUserId: tenantUserId,
      targetUserEmail: authProfile.email,
      targetResource: 'tenant_health',
      resourceId: tenantUserId,
      status: 'success',
      ipAddress,
      userAgent
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, health })
    };

  } catch (error) {
    console.error('❌ superAdminGetTenantHealth error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
