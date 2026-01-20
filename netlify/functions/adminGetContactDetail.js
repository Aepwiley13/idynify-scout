/**
 * Admin Get Contact Detail
 *
 * Fetches complete details for a specific contact including all metadata.
 *
 * Endpoint: /.netlify/functions/adminGetContactDetail
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { authToken, userId, contactId } = JSON.parse(event.body);

    // Verify auth token
    if (!authToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch (error) {
      console.error('Token verification failed:', error);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const adminUserId = decodedToken.uid;

    // Check admin access
    const isAdmin = await checkAdminAccess(adminUserId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    // Get admin email for audit logging
    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    // Validate parameters
    if (!userId || !contactId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'userId and contactId are required' })
      };
    }

    // Get target user info
    let targetUserEmail = '';
    try {
      const targetUser = await admin.auth().getUser(userId);
      targetUserEmail = targetUser.email;
    } catch (error) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    // Fetch contact document
    const contactDoc = await db
      .collection('users')
      .doc(userId)
      .collection('contacts')
      .doc(contactId)
      .get();

    if (!contactDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Contact not found' })
      };
    }

    const contactData = contactDoc.data();

    // Convert Firestore Timestamps to ISO strings
    const contact = {
      contactId: contactDoc.id,
      ...contactData,
      addedAt: contactData.addedAt?.toDate ? contactData.addedAt.toDate().toISOString() : contactData.addedAt,
      lastEnrichedAt: contactData.lastEnrichedAt?.toDate ? contactData.lastEnrichedAt.toDate().toISOString() : contactData.lastEnrichedAt,
      updatedAt: contactData.updatedAt?.toDate ? contactData.updatedAt.toDate().toISOString() : contactData.updatedAt
    };

    // Fetch associated company if companyId exists
    let companyData = null;
    if (contactData.companyId) {
      try {
        const companyDoc = await db
          .collection('users')
          .doc(userId)
          .collection('companies')
          .doc(contactData.companyId)
          .get();

        if (companyDoc.exists) {
          const company = companyDoc.data();
          companyData = {
            companyId: companyDoc.id,
            name: company.name,
            domain: company.domain,
            industry: company.industry,
            employeeCount: company.employeeCount,
            location: company.location
          };
        }
      } catch (error) {
        console.error('Error fetching associated company:', error);
      }
    }

    // Log audit event (viewing contact detail)
    await logAuditEvent({
      action: AUDIT_ACTIONS.VIEW_USER_CONTACTS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetUserId: userId,
      targetUserEmail: targetUserEmail,
      targetResource: 'contact',
      resourceId: contactId,
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        contactName: contactData.name || 'Unknown',
        contactEmail: contactData.email || null,
        companyId: contactData.companyId || null
      }
    });

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          contact: contact,
          company: companyData
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching contact detail:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch contact detail',
        details: error.message
      })
    };
  }
};
