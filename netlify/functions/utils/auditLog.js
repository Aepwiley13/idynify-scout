/**
 * Audit Logging Utility
 *
 * Provides centralized logging for all admin actions, user actions, and system events.
 * All logs are written to the adminAuditLogs Firestore collection with immutable records.
 *
 * Usage:
 *   await logAuditEvent({
 *     action: 'view_user_detail',
 *     logType: 'admin_action',
 *     actorUserId: adminUid,
 *     targetUserId: userId,
 *     status: 'success'
 *   });
 */

import { db } from '../firebase-admin.js';

/**
 * Log an audit event to Firestore
 *
 * @param {Object} eventData - Event data to log
 * @param {string} eventData.action - Action name (e.g., 'view_user_detail', 'user_login')
 * @param {string} eventData.logType - Log type: 'admin_action', 'user_action', or 'system_event'
 * @param {string} [eventData.actorUserId] - UID of user performing action
 * @param {string} [eventData.actorEmail] - Email of user performing action
 * @param {string} [eventData.targetUserId] - UID of user being affected
 * @param {string} [eventData.targetUserEmail] - Email of user being affected
 * @param {string} [eventData.targetResource] - Resource accessed (e.g., 'user_account', 'contacts')
 * @param {string} [eventData.resourceId] - Specific resource ID (e.g., contactId)
 * @param {string} [eventData.status] - Result status: 'success', 'failed', or 'partial'
 * @param {string} [eventData.ipAddress] - IP address of request
 * @param {string} [eventData.userAgent] - User agent string
 * @param {Object} [eventData.metadata] - Additional action-specific data
 * @param {string} [eventData.errorMessage] - Error message if status is 'failed'
 * @returns {Promise<string>} - Document ID of created log entry
 */
export async function logAuditEvent(eventData) {
  try {
    // Validate required fields
    if (!eventData.action) {
      console.error('❌ logAuditEvent: action is required');
      return null;
    }

    if (!eventData.logType || !['admin_action', 'user_action', 'system_event'].includes(eventData.logType)) {
      console.error('❌ logAuditEvent: logType must be admin_action, user_action, or system_event');
      return null;
    }

    // Default status to success if not provided
    const status = eventData.status || 'success';

    // Prepare log entry
    const logEntry = {
      action: eventData.action,
      logType: eventData.logType,
      actorUserId: eventData.actorUserId || null,
      actorEmail: eventData.actorEmail || null,
      targetUserId: eventData.targetUserId || null,
      targetUserEmail: eventData.targetUserEmail || null,
      targetResource: eventData.targetResource || null,
      resourceId: eventData.resourceId || null,
      status: status,
      ipAddress: eventData.ipAddress || null,
      userAgent: eventData.userAgent || null,
      metadata: eventData.metadata || null,
      errorMessage: eventData.errorMessage || null,
      timestamp: new Date() // Firestore will convert to Timestamp
    };

    // Write to Firestore
    const docRef = await db.collection('adminAuditLogs').add(logEntry);

    console.log(`✅ Audit log created: ${eventData.action} (${docRef.id})`);
    return docRef.id;

  } catch (error) {
    // Audit logging should never break the main operation
    // Log error but don't throw
    console.error('❌ Failed to create audit log:', error);
    console.error('Event data:', eventData);
    return null;
  }
}

/**
 * Helper function to extract IP address from request
 * Handles x-forwarded-for header for proxies/load balancers
 *
 * @param {Object} event - Netlify function event object
 * @returns {string|null} - IP address or null
 */
export function getIpAddress(event) {
  if (!event || !event.headers) return null;

  // Check x-forwarded-for first (Netlify sets this)
  const forwardedFor = event.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can be comma-separated list, take first IP
    return forwardedFor.split(',')[0].trim();
  }

  // Fallback to client IP
  return event.headers['client-ip'] || null;
}

/**
 * Helper function to extract user agent from request
 *
 * @param {Object} event - Netlify function event object
 * @returns {string|null} - User agent string or null
 */
export function getUserAgent(event) {
  if (!event || !event.headers) return null;
  return event.headers['user-agent'] || null;
}

/**
 * Action name constants for consistency across the application
 */
export const AUDIT_ACTIONS = {
  // Admin actions
  VIEW_USER_DETAIL: 'view_user_detail',
  VIEW_USER_CONTACTS: 'view_user_contacts',
  VIEW_CONTACT_DETAIL: 'view_contact_detail',
  EXPORT_USER_CONTACTS: 'export_user_contacts',
  START_IMPERSONATION: 'start_impersonation',
  END_IMPERSONATION: 'end_impersonation',
  PASSWORD_RESET_TRIGGERED: 'password_reset_triggered',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_REACTIVATED: 'account_reactivated',
  VIEW_EMAIL_LOGS: 'view_email_logs',
  RETRY_EMAIL_SEND: 'retry_email_send',
  EXPORT_USER_DATA: 'export_user_data',
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  EXPORT_AUDIT_LOGS: 'export_audit_logs',

  // User actions
  USER_SIGNUP: 'user_signup',
  USER_LOGIN: 'user_login',
  USER_LOGIN_FAILED: 'user_login_failed',
  USER_LOGOUT: 'user_logout',
  PASSWORD_CHANGE: 'password_change',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  EMAIL_VERIFIED: 'email_verified',
  EMAIL_CHANGE: 'email_change',
  TWO_FACTOR_ENABLED: 'two_factor_enabled',
  TWO_FACTOR_DISABLED: 'two_factor_disabled',
  ACCOUNT_DELETION_REQUESTED: 'account_deletion_requested',
  SUBSCRIPTION_UPGRADED: 'subscription_upgraded',
  SUBSCRIPTION_DOWNGRADED: 'subscription_downgraded',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  PAYMENT_METHOD_ADDED: 'payment_method_added',
  PAYMENT_METHOD_REMOVED: 'payment_method_removed',

  // System events
  EMAIL_SENT: 'email_sent',
  EMAIL_DELIVERED: 'email_delivered',
  EMAIL_BOUNCED: 'email_bounced',
  SUBSCRIPTION_RENEWED: 'subscription_renewed',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  PAYMENT_FAILED: 'payment_failed',
  SESSION_EXPIRED: 'session_expired',
  AUTO_LOGOUT: 'auto_logout'
};

/**
 * Human-readable labels for actions (for UI display)
 */
export const ACTION_LABELS = {
  [AUDIT_ACTIONS.VIEW_USER_DETAIL]: 'Viewed User',
  [AUDIT_ACTIONS.VIEW_USER_CONTACTS]: 'Viewed User Contacts',
  [AUDIT_ACTIONS.VIEW_CONTACT_DETAIL]: 'Viewed Contact Detail',
  [AUDIT_ACTIONS.EXPORT_USER_CONTACTS]: 'Exported User Contacts',
  [AUDIT_ACTIONS.START_IMPERSONATION]: 'Started Impersonation',
  [AUDIT_ACTIONS.END_IMPERSONATION]: 'Ended Impersonation',
  [AUDIT_ACTIONS.PASSWORD_RESET_TRIGGERED]: 'Reset Password',
  [AUDIT_ACTIONS.ACCOUNT_SUSPENDED]: 'Suspended Account',
  [AUDIT_ACTIONS.ACCOUNT_REACTIVATED]: 'Reactivated Account',
  [AUDIT_ACTIONS.VIEW_EMAIL_LOGS]: 'Viewed Email Logs',
  [AUDIT_ACTIONS.RETRY_EMAIL_SEND]: 'Retried Email Send',
  [AUDIT_ACTIONS.EXPORT_USER_DATA]: 'Exported User Data',
  [AUDIT_ACTIONS.VIEW_AUDIT_LOGS]: 'Viewed Audit Logs',
  [AUDIT_ACTIONS.EXPORT_AUDIT_LOGS]: 'Exported Audit Logs',
  [AUDIT_ACTIONS.USER_SIGNUP]: 'User Signup',
  [AUDIT_ACTIONS.USER_LOGIN]: 'User Login',
  [AUDIT_ACTIONS.USER_LOGIN_FAILED]: 'Login Failed',
  [AUDIT_ACTIONS.USER_LOGOUT]: 'User Logout',
  [AUDIT_ACTIONS.PASSWORD_CHANGE]: 'Password Changed',
  [AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED]: 'Password Reset Requested',
  [AUDIT_ACTIONS.EMAIL_VERIFIED]: 'Email Verified',
  [AUDIT_ACTIONS.EMAIL_CHANGE]: 'Email Changed',
  [AUDIT_ACTIONS.TWO_FACTOR_ENABLED]: '2FA Enabled',
  [AUDIT_ACTIONS.TWO_FACTOR_DISABLED]: '2FA Disabled',
  [AUDIT_ACTIONS.ACCOUNT_DELETION_REQUESTED]: 'Account Deletion Requested',
  [AUDIT_ACTIONS.SUBSCRIPTION_UPGRADED]: 'Subscription Upgraded',
  [AUDIT_ACTIONS.SUBSCRIPTION_DOWNGRADED]: 'Subscription Downgraded',
  [AUDIT_ACTIONS.SUBSCRIPTION_CANCELED]: 'Subscription Canceled',
  [AUDIT_ACTIONS.PAYMENT_METHOD_ADDED]: 'Payment Method Added',
  [AUDIT_ACTIONS.PAYMENT_METHOD_REMOVED]: 'Payment Method Removed',
  [AUDIT_ACTIONS.EMAIL_SENT]: 'Email Sent',
  [AUDIT_ACTIONS.EMAIL_DELIVERED]: 'Email Delivered',
  [AUDIT_ACTIONS.EMAIL_BOUNCED]: 'Email Bounced',
  [AUDIT_ACTIONS.SUBSCRIPTION_RENEWED]: 'Subscription Renewed',
  [AUDIT_ACTIONS.SUBSCRIPTION_EXPIRED]: 'Subscription Expired',
  [AUDIT_ACTIONS.PAYMENT_SUCCEEDED]: 'Payment Succeeded',
  [AUDIT_ACTIONS.PAYMENT_FAILED]: 'Payment Failed',
  [AUDIT_ACTIONS.SESSION_EXPIRED]: 'Session Expired',
  [AUDIT_ACTIONS.AUTO_LOGOUT]: 'Auto Logout'
};
