/**
 * Admin Get User Contacts
 *
 * Fetches paginated contacts for a specific user with filtering and search.
 * Returns complete contact metadata including enrichment data.
 *
 * Endpoint: /.netlify/functions/adminGetUserContacts
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
    const { authToken, userId, pagination, filters, search } = JSON.parse(event.body);

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

    // Validate userId
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'userId is required' })
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

    // Parse pagination parameters
    const page = pagination?.page || 1;
    const pageSize = Math.min(pagination?.pageSize || 50, 100); // Max 100 per page

    // Fetch all contacts from user's subcollection
    const contactsRef = db.collection('users').doc(userId).collection('contacts');
    const snapshot = await contactsRef.get();

    let allContacts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      allContacts.push({
        contactId: doc.id,
        ...data,
        addedAt: data.addedAt?.toDate ? data.addedAt.toDate().toISOString() : data.addedAt,
        lastEnrichedAt: data.lastEnrichedAt?.toDate ? data.lastEnrichedAt.toDate().toISOString() : data.lastEnrichedAt
      });
    });

    // Apply filters
    let filteredContacts = allContacts;

    if (filters) {
      // Filter by status (has_email, enriched, etc.)
      if (filters.status === 'has_email') {
        filteredContacts = filteredContacts.filter(c => c.email && c.email.trim() !== '');
      } else if (filters.status === 'no_email') {
        filteredContacts = filteredContacts.filter(c => !c.email || c.email.trim() === '');
      } else if (filters.status === 'enriched') {
        filteredContacts = filteredContacts.filter(c => c.lastEnrichedAt);
      }

      // Filter by seniority
      if (filters.seniority && filters.seniority !== 'all') {
        filteredContacts = filteredContacts.filter(c =>
          c.seniority && c.seniority.toLowerCase() === filters.seniority.toLowerCase()
        );
      }

      // Filter by department
      if (filters.department && filters.department !== 'all') {
        filteredContacts = filteredContacts.filter(c =>
          c.departments && c.departments.some(d =>
            d.toLowerCase().includes(filters.department.toLowerCase())
          )
        );
      }

      // Filter by company
      if (filters.companyId) {
        filteredContacts = filteredContacts.filter(c => c.companyId === filters.companyId);
      }
    }

    // Search filter (search in name, email, title, company)
    if (search && search.trim() !== '') {
      const searchLower = search.toLowerCase();
      filteredContacts = filteredContacts.filter(c => {
        return (
          (c.name && c.name.toLowerCase().includes(searchLower)) ||
          (c.email && c.email.toLowerCase().includes(searchLower)) ||
          (c.title && c.title.toLowerCase().includes(searchLower)) ||
          (c.organization_name && c.organization_name.toLowerCase().includes(searchLower))
        );
      });
    }

    // Sort by addedAt (most recent first)
    filteredContacts.sort((a, b) => {
      const dateA = a.addedAt ? new Date(a.addedAt) : new Date(0);
      const dateB = b.addedAt ? new Date(b.addedAt) : new Date(0);
      return dateB - dateA;
    });

    // Calculate pagination
    const totalCount = filteredContacts.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Slice to get current page
    const offset = (page - 1) * pageSize;
    const paginatedContacts = filteredContacts.slice(offset, offset + pageSize);

    // Calculate statistics
    const stats = {
      totalContacts: totalCount,
      withEmail: filteredContacts.filter(c => c.email && c.email.trim() !== '').length,
      withoutEmail: filteredContacts.filter(c => !c.email || c.email.trim() === '').length,
      enriched: filteredContacts.filter(c => c.lastEnrichedAt).length,
      withLinkedIn: filteredContacts.filter(c => c.linkedin_url && c.linkedin_url.trim() !== '').length,
      withPhone: filteredContacts.filter(c => c.phone_numbers && c.phone_numbers.length > 0).length
    };

    // Log audit event (viewing user contacts)
    await logAuditEvent({
      action: AUDIT_ACTIONS.VIEW_USER_CONTACTS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetUserId: userId,
      targetUserEmail: targetUserEmail,
      targetResource: 'user_contacts',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        totalContacts: totalCount,
        filters: filters || {},
        search: search || null
      }
    });

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          contacts: paginatedContacts,
          stats: stats,
          pagination: {
            page,
            pageSize,
            totalCount,
            totalPages,
            hasNextPage,
            hasPreviousPage
          }
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching user contacts:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch user contacts',
        details: error.message
      })
    };
  }
};
