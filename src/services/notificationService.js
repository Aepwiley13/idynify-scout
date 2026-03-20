/**
 * NOTIFICATION SERVICE — Team Alpha
 * Operation People First // Persistent Notification Center
 *
 * Manages two categories of notifications:
 *   1. task         — Actionable items with due dates (follow_up_due, reminder_notification)
 *   2. relationship — Informational events about relationship changes (referral_received,
 *                     referral_converted, contact_status_change, contact_going_cold)
 *
 * Design:
 *   - Task notifications have "Mark as Done" actions
 *   - Relationship notifications have "View Profile" actions
 *   - Both stored in users/{userId}/notifications
 *   - Relationship events are additive — they build context, not urgency
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';

// ── Notification Types ───────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = {
  TASK: 'task',
  RELATIONSHIP: 'relationship'
};

export const NOTIFICATION_TYPES = {
  // Task category (existing)
  FOLLOW_UP_DUE: 'follow_up_due',
  REMINDER: 'reminder_notification',

  // Relationship category (new)
  REFERRAL_RECEIVED: 'referral_received',
  REFERRAL_CONVERTED: 'referral_converted',
  CONTACT_STATUS_CHANGE: 'contact_status_change',
  CONTACT_GOING_COLD: 'contact_going_cold'
};

const TYPE_TO_CATEGORY = {
  [NOTIFICATION_TYPES.FOLLOW_UP_DUE]: NOTIFICATION_CATEGORIES.TASK,
  [NOTIFICATION_TYPES.REMINDER]: NOTIFICATION_CATEGORIES.TASK,
  [NOTIFICATION_TYPES.REFERRAL_RECEIVED]: NOTIFICATION_CATEGORIES.RELATIONSHIP,
  [NOTIFICATION_TYPES.REFERRAL_CONVERTED]: NOTIFICATION_CATEGORIES.RELATIONSHIP,
  [NOTIFICATION_TYPES.CONTACT_STATUS_CHANGE]: NOTIFICATION_CATEGORIES.RELATIONSHIP,
  [NOTIFICATION_TYPES.CONTACT_GOING_COLD]: NOTIFICATION_CATEGORIES.RELATIONSHIP,
};

// ── Query Notifications ──────────────────────────────────────────────

/**
 * Subscribe to unread notifications in real-time.
 * Returns an unsubscribe function.
 */
export function subscribeToNotifications(userId, callback) {
  const q = query(
    collection(db, 'users', userId, 'notifications'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  return onSnapshot(q, (snap) => {
    const notifications = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        category: TYPE_TO_CATEGORY[data.type] || NOTIFICATION_CATEGORIES.TASK
      };
    });
    callback(notifications);
  }, (error) => {
    console.error('[NotificationService] Subscription error:', error);
    callback([]);
  });
}

/**
 * Get all notifications (read and unread) for the notification center.
 */
export async function getRecentNotifications(userId, maxResults = 30) {
  try {
    const q = query(
      collection(db, 'users', userId, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        category: TYPE_TO_CATEGORY[data.type] || NOTIFICATION_CATEGORIES.TASK
      };
    });
  } catch (error) {
    console.error('[NotificationService] Failed to get notifications:', error);
    return [];
  }
}

// ── Create Notifications ─────────────────────────────────────────────

/**
 * Create a relationship notification (referral received, converted, etc.)
 */
export async function createRelationshipNotification(userId, {
  type,
  contactId,
  contactName,
  relatedContactId,
  relatedContactName,
  message,
  metadata = {}
}) {
  try {
    const notifData = {
      type,
      category: NOTIFICATION_CATEGORIES.RELATIONSHIP,
      contactId: contactId || null,
      contactName: contactName || null,
      relatedContactId: relatedContactId || null,
      relatedContactName: relatedContactName || null,
      message: message || null,
      metadata,
      read: false,
      resolvedAt: null,
      createdAt: Timestamp.now()
    };

    const ref = collection(db, 'users', userId, 'notifications');
    await addDoc(ref, notifData);
  } catch (error) {
    console.error('[NotificationService] Failed to create notification:', error);
  }
}

// ── Mark as Read ─────────────────────────────────────────────────────

export async function markNotificationRead(userId, notificationId) {
  try {
    const ref = doc(db, 'users', userId, 'notifications', notificationId);
    await updateDoc(ref, { read: true, resolvedAt: Timestamp.now() });
  } catch (error) {
    console.error('[NotificationService] Failed to mark read:', error);
  }
}

export async function markAllNotificationsRead(userId) {
  try {
    const q = query(
      collection(db, 'users', userId, 'notifications'),
      where('read', '==', false)
    );
    const snap = await getDocs(q);
    const now = Timestamp.now();
    const updates = snap.docs.map(d =>
      updateDoc(doc(db, 'users', userId, 'notifications', d.id), { read: true, resolvedAt: now })
    );
    await Promise.all(updates);
  } catch (error) {
    console.error('[NotificationService] Failed to mark all read:', error);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Format a notification into a display-ready object.
 */
export function formatNotification(notification) {
  const { type, contactName, relatedContactName, message } = notification;

  switch (type) {
    case NOTIFICATION_TYPES.REFERRAL_RECEIVED:
      return {
        icon: 'referral',
        title: `${contactName || 'Someone'} referred ${relatedContactName || 'a contact'} to you`,
        subtitle: message || null,
        action: 'view_profile',
        actionLabel: 'View Profile',
        color: '#8b5cf6'
      };
    case NOTIFICATION_TYPES.REFERRAL_CONVERTED:
      return {
        icon: 'converted',
        title: `Referral converted: ${relatedContactName || 'Contact'}`,
        subtitle: contactName ? `Referred by ${contactName}` : null,
        action: 'view_profile',
        actionLabel: 'View Profile',
        color: '#10b981'
      };
    case NOTIFICATION_TYPES.CONTACT_STATUS_CHANGE:
      return {
        icon: 'status',
        title: `${contactName || 'Contact'} moved to ${notification.metadata?.newStatus || 'new status'}`,
        subtitle: message || null,
        action: 'view_profile',
        actionLabel: 'View Profile',
        color: '#3b82f6'
      };
    case NOTIFICATION_TYPES.CONTACT_GOING_COLD:
      return {
        icon: 'cold',
        title: `${contactName || 'Contact'} is going cold`,
        subtitle: message || 'No engagement recently',
        action: 'view_profile',
        actionLabel: 'View Profile',
        color: '#6b7280'
      };
    case NOTIFICATION_TYPES.FOLLOW_UP_DUE:
      return {
        icon: 'followup',
        title: `Follow up with ${contactName || 'contact'}`,
        subtitle: notification.reason || null,
        action: 'mark_done',
        actionLabel: 'Mark Done',
        color: '#f59e0b'
      };
    case NOTIFICATION_TYPES.REMINDER:
      return {
        icon: 'reminder',
        title: `Reminder: ${contactName || 'Contact'}`,
        subtitle: message || notification.reason || null,
        action: 'mark_done',
        actionLabel: 'Mark Done',
        color: '#f59e0b'
      };
    default:
      return {
        icon: 'default',
        title: message || 'Notification',
        subtitle: null,
        action: null,
        actionLabel: null,
        color: '#6b7280'
      };
  }
}
