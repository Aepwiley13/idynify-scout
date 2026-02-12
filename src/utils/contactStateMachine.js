/**
 * CONTACT STATE MACHINE
 *
 * System-controlled contact status engine.
 * Deterministic transitions triggered by user actions.
 *
 * This is a behavioral infrastructure layer — not a visual redesign.
 * contact_status is SEPARATE from lead_status (pipeline stage).
 *
 * Allowed statuses:
 *   New             — Contact just created
 *   Engaged         — User opened Engage drawer
 *   In Campaign     — Contact assigned to a campaign
 *   Active Mission  — Contact assigned to a mission
 *   Awaiting Reply  — Message sent, waiting for response
 *   In Conversation — Contact replied positively, dialogue active (Step 5)
 *   Mission Complete — User manually marked complete
 *   Dormant         — Reserved for future inactivity detection
 *
 * Transition triggers:
 *   Contact created        → New
 *   Engage clicked         → Engaged
 *   Campaign assigned      → In Campaign
 *   Mission assigned       → Active Mission
 *   Message sent           → Awaiting Reply
 *   Positive reply         → In Conversation (Step 5)
 *   Sequence completed     → Mission Complete (Step 5)
 *   Manual complete action → Mission Complete
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

// ── Allowed Statuses ────────────────────────────────────

export const CONTACT_STATUSES = {
  NEW: 'New',
  ENGAGED: 'Engaged',
  IN_CAMPAIGN: 'In Campaign',
  ACTIVE_MISSION: 'Active Mission',
  AWAITING_REPLY: 'Awaiting Reply',
  IN_CONVERSATION: 'In Conversation',
  MISSION_COMPLETE: 'Mission Complete',
  DORMANT: 'Dormant'
};

// Ordered list for validation
const VALID_STATUSES = Object.values(CONTACT_STATUSES);

// ── Transition Triggers ─────────────────────────────────

export const STATUS_TRIGGERS = {
  CONTACT_CREATED: 'contact_created',
  ENGAGE_CLICKED: 'engage_clicked',
  CAMPAIGN_ASSIGNED: 'campaign_assigned',
  MISSION_ASSIGNED: 'mission_assigned',
  MESSAGE_SENT: 'message_sent',
  POSITIVE_REPLY: 'positive_reply',
  SEQUENCE_COMPLETE: 'sequence_complete',
  MANUAL_COMPLETE: 'manual_complete'
};

// Trigger → target status mapping
const TRANSITION_MAP = {
  [STATUS_TRIGGERS.CONTACT_CREATED]: CONTACT_STATUSES.NEW,
  [STATUS_TRIGGERS.ENGAGE_CLICKED]: CONTACT_STATUSES.ENGAGED,
  [STATUS_TRIGGERS.CAMPAIGN_ASSIGNED]: CONTACT_STATUSES.IN_CAMPAIGN,
  [STATUS_TRIGGERS.MISSION_ASSIGNED]: CONTACT_STATUSES.ACTIVE_MISSION,
  [STATUS_TRIGGERS.MESSAGE_SENT]: CONTACT_STATUSES.AWAITING_REPLY,
  [STATUS_TRIGGERS.POSITIVE_REPLY]: CONTACT_STATUSES.IN_CONVERSATION,
  [STATUS_TRIGGERS.SEQUENCE_COMPLETE]: CONTACT_STATUSES.MISSION_COMPLETE,
  [STATUS_TRIGGERS.MANUAL_COMPLETE]: CONTACT_STATUSES.MISSION_COMPLETE
};

// ── Status priority (higher = more advanced in lifecycle) ──

const STATUS_PRIORITY = {
  [CONTACT_STATUSES.NEW]: 0,
  [CONTACT_STATUSES.ENGAGED]: 1,
  [CONTACT_STATUSES.IN_CAMPAIGN]: 2,
  [CONTACT_STATUSES.ACTIVE_MISSION]: 3,
  [CONTACT_STATUSES.AWAITING_REPLY]: 4,
  [CONTACT_STATUSES.IN_CONVERSATION]: 5,
  [CONTACT_STATUSES.MISSION_COMPLETE]: 6,
  [CONTACT_STATUSES.DORMANT]: 0 // Reserved — does not participate in priority
};

/**
 * Resolve the target status for a given trigger.
 * Returns null if the transition should be skipped (e.g., contact already
 * at a higher-priority status than the trigger would produce).
 *
 * Exception: MESSAGE_SENT and MANUAL_COMPLETE always apply regardless of
 * current status, because sending a message or completing are explicit actions.
 */
export function resolveTransition(currentStatus, trigger) {
  const targetStatus = TRANSITION_MAP[trigger];
  if (!targetStatus) return null;

  // These triggers always apply regardless of current status
  const alwaysApplyTriggers = [
    STATUS_TRIGGERS.MESSAGE_SENT,
    STATUS_TRIGGERS.POSITIVE_REPLY,
    STATUS_TRIGGERS.SEQUENCE_COMPLETE,
    STATUS_TRIGGERS.MANUAL_COMPLETE
  ];

  if (alwaysApplyTriggers.includes(trigger)) {
    return targetStatus;
  }

  // For other triggers, only advance forward (don't regress)
  const currentPriority = STATUS_PRIORITY[currentStatus] ?? 0;
  const targetPriority = STATUS_PRIORITY[targetStatus] ?? 0;

  if (targetPriority <= currentPriority) {
    return null; // Skip — already at or past this stage
  }

  return targetStatus;
}

/**
 * Get the default status for reading contacts that have no contact_status.
 * Used for backward compatibility with legacy contacts.
 */
export function getContactStatus(contact) {
  return contact?.contact_status || CONTACT_STATUSES.NEW;
}

/**
 * Update a contact's status based on a trigger.
 * Writes to Firestore and logs a timeline event.
 *
 * Non-blocking — catches errors silently.
 *
 * @param {Object} params
 * @param {string} params.userId       - Authenticated user ID
 * @param {string} params.contactId    - Contact document ID
 * @param {string} params.trigger      - One of STATUS_TRIGGERS
 * @param {string} [params.currentStatus] - Current contact_status (optional, avoids re-read)
 * @returns {Promise<string|null>} New status if updated, null if skipped or failed
 */
export async function updateContactStatus({ userId, contactId, trigger, currentStatus }) {
  try {
    if (!userId || !contactId || !trigger) {
      console.error('[StateMachine] Missing required fields:', { userId, contactId, trigger });
      return null;
    }

    const resolvedCurrentStatus = currentStatus || CONTACT_STATUSES.NEW;
    const newStatus = resolveTransition(resolvedCurrentStatus, trigger);

    if (!newStatus) {
      // Transition skipped — no update needed
      return null;
    }

    // Write to Firestore
    const contactRef = doc(db, 'users', userId, 'contacts', contactId);
    await updateDoc(contactRef, {
      contact_status: newStatus,
      contact_status_updated_at: new Date().toISOString()
    });

    // Log timeline event
    logTimelineEvent({
      userId,
      contactId,
      type: 'contact_status_changed',
      actor: ACTORS.SYSTEM,
      preview: `${resolvedCurrentStatus} → ${newStatus}`,
      metadata: {
        statusFrom: resolvedCurrentStatus,
        statusTo: newStatus,
        trigger
      }
    });

    return newStatus;
  } catch (error) {
    console.error('[StateMachine] Failed to update contact status:', error);
    // Non-blocking — never throw
    return null;
  }
}

export { VALID_STATUSES };
