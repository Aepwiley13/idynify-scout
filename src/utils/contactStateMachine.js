/**
 * CONTACT STATE MACHINE
 *
 * System-controlled contact status engine.
 * Deterministic transitions triggered by user actions.
 *
 * This is a behavioral infrastructure layer — not a visual redesign.
 * contact_status is SEPARATE from lead_status (pipeline stage).
 *
 * Operation People First — Updated Status Model:
 *
 * ── Lead Statuses (person_type === 'lead') ──────────────
 *   New             — Contact just created, never engaged
 *   Engaged         — User opened the Engage module on this profile
 *   Awaiting Reply  — Message sent, waiting for response
 *   In Conversation — Contact replied positively, dialogue active
 *   Dormant         — No activity for an extended period (auto or manual)
 *
 * ── Network/Relationship Statuses ───────────────────────
 *   Active Customer  — Current customer (person_type === 'customer')
 *   Past Customer    — Former customer (person_type === 'past_customer')
 *   Partner          — Active partner relationship (person_type === 'partner')
 *   Network          — Part of the relationship ecosystem (person_type === 'network')
 *
 * ── Legacy Statuses (maintained for backward compatibility) ─
 *   In Campaign     — Contact assigned to a campaign (legacy)
 *   Active Mission  — Contact assigned to a mission (legacy — missions deprecated)
 *   Mission Complete — Mission workflow completed (legacy)
 *
 * Transition triggers:
 *   Contact created        → New
 *   Engage clicked         → Engaged
 *   Message sent           → Awaiting Reply
 *   Positive reply         → In Conversation
 *   Person type → customer → Active Customer
 *   Person type → partner  → Partner
 *   Person type → network  → Network
 *   Person type → past_customer → Past Customer
 *   Manual complete action → Dormant (or user-set)
 *
 * Deprecated triggers (maintained for existing data):
 *   Campaign assigned      → In Campaign
 *   Mission assigned       → Active Mission
 *   Sequence completed     → Mission Complete
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

// ── Allowed Statuses ────────────────────────────────────

export const CONTACT_STATUSES = {
  // Active lead statuses
  NEW: 'New',
  ENGAGED: 'Engaged',
  AWAITING_REPLY: 'Awaiting Reply',
  IN_CONVERSATION: 'In Conversation',
  DORMANT: 'Dormant',

  // Relationship statuses (person_type-driven)
  ACTIVE_CUSTOMER: 'Active Customer',
  PAST_CUSTOMER: 'Past Customer',
  PARTNER: 'Partner',
  NETWORK: 'Network',

  // Legacy statuses (maintained for backward compatibility — do not use for new contacts)
  IN_CAMPAIGN: 'In Campaign',
  ACTIVE_MISSION: 'Active Mission',
  MISSION_COMPLETE: 'Mission Complete'
};

// Ordered list for validation
const VALID_STATUSES = Object.values(CONTACT_STATUSES);

// ── Transition Triggers ─────────────────────────────────

export const STATUS_TRIGGERS = {
  CONTACT_CREATED: 'contact_created',
  ENGAGE_CLICKED: 'engage_clicked',
  MESSAGE_SENT: 'message_sent',
  POSITIVE_REPLY: 'positive_reply',
  NEGATIVE_REPLY: 'negative_reply',
  NO_REPLY_EXTENDED: 'no_reply_extended',
  PERSON_TYPE_CUSTOMER: 'person_type_customer',
  PERSON_TYPE_PARTNER: 'person_type_partner',
  PERSON_TYPE_NETWORK: 'person_type_network',
  PERSON_TYPE_PAST_CUSTOMER: 'person_type_past_customer',
  MANUAL_DORMANT: 'manual_dormant',

  // Legacy triggers (maintained for backward compatibility)
  CAMPAIGN_ASSIGNED: 'campaign_assigned',
  MISSION_ASSIGNED: 'mission_assigned',
  SEQUENCE_COMPLETE: 'sequence_complete',
  MANUAL_COMPLETE: 'manual_complete'
};

// Trigger → target status mapping
const TRANSITION_MAP = {
  // Active lead lifecycle
  [STATUS_TRIGGERS.CONTACT_CREATED]: CONTACT_STATUSES.NEW,
  [STATUS_TRIGGERS.ENGAGE_CLICKED]: CONTACT_STATUSES.ENGAGED,
  [STATUS_TRIGGERS.MESSAGE_SENT]: CONTACT_STATUSES.AWAITING_REPLY,
  [STATUS_TRIGGERS.POSITIVE_REPLY]: CONTACT_STATUSES.IN_CONVERSATION,
  [STATUS_TRIGGERS.NEGATIVE_REPLY]: CONTACT_STATUSES.DORMANT,
  [STATUS_TRIGGERS.NO_REPLY_EXTENDED]: CONTACT_STATUSES.DORMANT,
  [STATUS_TRIGGERS.MANUAL_DORMANT]: CONTACT_STATUSES.DORMANT,

  // Person type → relationship status transitions
  [STATUS_TRIGGERS.PERSON_TYPE_CUSTOMER]: CONTACT_STATUSES.ACTIVE_CUSTOMER,
  [STATUS_TRIGGERS.PERSON_TYPE_PARTNER]: CONTACT_STATUSES.PARTNER,
  [STATUS_TRIGGERS.PERSON_TYPE_NETWORK]: CONTACT_STATUSES.NETWORK,
  [STATUS_TRIGGERS.PERSON_TYPE_PAST_CUSTOMER]: CONTACT_STATUSES.PAST_CUSTOMER,

  // Legacy triggers
  [STATUS_TRIGGERS.CAMPAIGN_ASSIGNED]: CONTACT_STATUSES.IN_CAMPAIGN,
  [STATUS_TRIGGERS.MISSION_ASSIGNED]: CONTACT_STATUSES.ACTIVE_MISSION,
  [STATUS_TRIGGERS.SEQUENCE_COMPLETE]: CONTACT_STATUSES.MISSION_COMPLETE,
  [STATUS_TRIGGERS.MANUAL_COMPLETE]: CONTACT_STATUSES.MISSION_COMPLETE
};

// ── Status priority (higher = more advanced in lifecycle) ──
// Priority only matters for lead lifecycle statuses.
// Person-type statuses (customer, partner, etc.) always override — they are set explicitly.

const STATUS_PRIORITY = {
  [CONTACT_STATUSES.NEW]: 0,
  [CONTACT_STATUSES.ENGAGED]: 1,
  [CONTACT_STATUSES.AWAITING_REPLY]: 2,
  [CONTACT_STATUSES.IN_CONVERSATION]: 3,
  [CONTACT_STATUSES.DORMANT]: 0,       // Does not participate in priority ordering

  // Relationship statuses — not part of the lead priority chain
  [CONTACT_STATUSES.ACTIVE_CUSTOMER]: -1,
  [CONTACT_STATUSES.PAST_CUSTOMER]: -1,
  [CONTACT_STATUSES.PARTNER]: -1,
  [CONTACT_STATUSES.NETWORK]: -1,

  // Legacy
  [CONTACT_STATUSES.IN_CAMPAIGN]: 2,
  [CONTACT_STATUSES.ACTIVE_MISSION]: 3,
  [CONTACT_STATUSES.MISSION_COMPLETE]: 6
};

/**
 * Resolve the target status for a given trigger.
 * Returns null if the transition should be skipped (e.g., contact already
 * at a higher-priority status than the trigger would produce).
 *
 * Person-type triggers always apply — they represent an explicit reclassification.
 * MESSAGE_SENT and reply triggers always apply — they represent explicit actions.
 */
export function resolveTransition(currentStatus, trigger) {
  const targetStatus = TRANSITION_MAP[trigger];
  if (!targetStatus) return null;

  // Person-type transitions always apply — explicit reclassification
  const personTypeTriggers = [
    STATUS_TRIGGERS.PERSON_TYPE_CUSTOMER,
    STATUS_TRIGGERS.PERSON_TYPE_PARTNER,
    STATUS_TRIGGERS.PERSON_TYPE_NETWORK,
    STATUS_TRIGGERS.PERSON_TYPE_PAST_CUSTOMER
  ];

  if (personTypeTriggers.includes(trigger)) {
    return targetStatus;
  }

  // These triggers always apply regardless of current lead status
  const alwaysApplyTriggers = [
    STATUS_TRIGGERS.MESSAGE_SENT,
    STATUS_TRIGGERS.POSITIVE_REPLY,
    STATUS_TRIGGERS.NEGATIVE_REPLY,
    STATUS_TRIGGERS.NO_REPLY_EXTENDED,
    STATUS_TRIGGERS.MANUAL_DORMANT,
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
 * Resolve the correct contact_status trigger for a person_type change.
 * Called when a user moves a person between lenses.
 *
 * @param {string} newPersonType - 'lead' | 'customer' | 'partner' | 'network' | 'past_customer'
 * @returns {string|null} STATUS_TRIGGERS value, or null if no automatic transition
 */
export function resolvePersonTypeStatusTrigger(newPersonType) {
  const map = {
    customer: STATUS_TRIGGERS.PERSON_TYPE_CUSTOMER,
    partner: STATUS_TRIGGERS.PERSON_TYPE_PARTNER,
    network: STATUS_TRIGGERS.PERSON_TYPE_NETWORK,
    past_customer: STATUS_TRIGGERS.PERSON_TYPE_PAST_CUSTOMER
  };
  return map[newPersonType] || null;
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
