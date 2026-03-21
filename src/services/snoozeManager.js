/**
 * snoozeManager.js — Snooze write/read/expiry logic.
 *
 * Spec ref: v1.2 Section 5 — Snooze System
 *
 * Allows CSM users to temporarily suppress a contact from attention queues.
 * Snooze is stored on the contact document, not in a separate collection.
 *
 * Fields on contact:
 *   snooze_until      — ISO timestamp when snooze expires
 *   snooze_reason     — 'vacation' | 'pending_renewal' | 'no_budget' | 'custom'
 *   snooze_note       — optional free text
 *   snoozed_at        — ISO timestamp when snooze was set
 *   snoozed_by        — 'user' | 'barry'
 *
 * Firestore path: users/{userId}/contacts/{contactId}
 */

import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from '../utils/timelineLogger';

// ─── Snooze Presets ───────────────────────────────────────────────────────────
export const SNOOZE_PRESETS = [
  { id: '1d',   label: '1 day',    days: 1   },
  { id: '3d',   label: '3 days',   days: 3   },
  { id: '1w',   label: '1 week',   days: 7   },
  { id: '2w',   label: '2 weeks',  days: 14  },
  { id: '1m',   label: '1 month',  days: 30  },
  { id: '3m',   label: '3 months', days: 90  },
];

export const SNOOZE_REASONS = [
  { id: 'vacation',        label: 'On vacation'       },
  { id: 'pending_renewal', label: 'Pending renewal'   },
  { id: 'no_budget',       label: 'No budget right now'},
  { id: 'onboarding',      label: 'Still onboarding'  },
  { id: 'custom',          label: 'Other'             },
];

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Snooze a contact for a specified number of days.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} opts
 * @param {number} opts.days — how many days to snooze
 * @param {string} opts.reason — one of SNOOZE_REASONS ids
 * @param {string} [opts.note] — optional free text
 * @param {string} [opts.actor='user'] — 'user' | 'barry'
 * @returns {Promise<{ snooze_until: string }>}
 */
export async function snoozeContact(userId, contactId, { days, reason, note = '', actor = 'user' }) {
  const snoozeUntil = new Date(Date.now() + days * 86400_000).toISOString();
  const now = new Date().toISOString();

  const ref = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(ref, {
    snooze_until:  snoozeUntil,
    snooze_reason: reason,
    snooze_note:   note,
    snoozed_at:    now,
    snoozed_by:    actor,
  });

  // Log to timeline
  await logTimelineEvent({
    userId,
    contactId,
    type: 'contact_status_changed',
    actor: actor === 'barry' ? ACTORS.barry : ACTORS.user,
    preview: `Snoozed for ${days} day${days === 1 ? '' : 's'} — ${reason}`,
    metadata: {
      action: 'snooze',
      snooze_until: snoozeUntil,
      reason,
      note,
      days,
    },
  });

  return { snooze_until: snoozeUntil };
}

/**
 * Unsnooze a contact immediately.
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<void>}
 */
export async function unsnoozeContact(userId, contactId) {
  const ref = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(ref, {
    snooze_until:  null,
    snooze_reason: null,
    snooze_note:   null,
    snoozed_at:    null,
    snoozed_by:    null,
  });

  await logTimelineEvent({
    userId,
    contactId,
    type: 'contact_status_changed',
    actor: ACTORS.user,
    preview: 'Snooze removed',
    metadata: { action: 'unsnooze' },
  });
}

/**
 * Check if a contact is currently snoozed.
 *
 * @param {Object} contact — contact document (must have snooze_until field)
 * @returns {{ snoozed: boolean, expiresAt: Date|null, reason: string|null, daysRemaining: number|null }}
 */
export function isContactSnoozed(contact) {
  const until = contact.snooze_until;
  if (!until) return { snoozed: false, expiresAt: null, reason: null, daysRemaining: null };

  const expiresAt = new Date(until);
  if (expiresAt.getTime() <= Date.now()) {
    // Expired — treat as unsnoozed (cleanup will clear the fields)
    return { snoozed: false, expiresAt: null, reason: null, daysRemaining: null };
  }

  const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / 86400_000);
  return {
    snoozed: true,
    expiresAt,
    reason: contact.snooze_reason || null,
    daysRemaining,
  };
}

/**
 * Filter out snoozed contacts from a list.
 * Use this before rendering attention queues / overdue lists.
 *
 * @param {Array} contacts
 * @returns {Array} — contacts that are NOT currently snoozed
 */
export function filterOutSnoozed(contacts) {
  return contacts.filter(c => !isContactSnoozed(c).snoozed);
}

/**
 * Get all snoozed contacts from a list (for the snooze management view).
 *
 * @param {Array} contacts
 * @returns {Array<{ contact, expiresAt, reason, daysRemaining }>}
 */
export function getSnoozedContacts(contacts) {
  return contacts
    .map(c => {
      const info = isContactSnoozed(c);
      if (!info.snoozed) return null;
      return { contact: c, ...info };
    })
    .filter(Boolean)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}
