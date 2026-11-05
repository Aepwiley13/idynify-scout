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
 *   Engaged         — A confirmed outbound/inbound interaction happened, or
 *                     one was explicitly logged after the fact
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
 *   Contact created          → New
 *   Message sent             → Awaiting Reply
 *   Positive reply           → In Conversation
 *   Manual interaction logged → Engaged
 *   Person type → customer   → Active Customer
 *   Person type → partner    → Partner
 *   Person type → network    → Network
 *   Person type → past_customer → Past Customer
 *   Manual complete action   → Dormant (or user-set)
 *
 * NOT a trigger here, deliberately: opening an engagement composer,
 * generating or saving a draft, creating a Barry mission, planning
 * outreach, or moving a workflow stage. None of those is a confirmed
 * interaction — see engagementHistoryLogger.js's logEngageSessionStarted
 * for how that activity is still recorded, just not as a status change.
 *
 * Deprecated triggers (maintained for existing data):
 *   Campaign assigned      → In Campaign
 *   Mission assigned       → Active Mission
 *   Sequence completed     → Mission Complete
 */

import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';
import {
  engagementPromotionFields,
  isEngagedRecord,
} from '../constants/statusModel';

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
  MESSAGE_SENT: 'message_sent',
  POSITIVE_REPLY: 'positive_reply',
  NEGATIVE_REPLY: 'negative_reply',
  NO_REPLY_EXTENDED: 'no_reply_extended',
  // A real interaction, confirmed after the fact rather than observed live —
  // a call, a meeting, anything that happened outside the app. Reuses the
  // existing "Brief Barry" manual-logging flow (PersistentEngageBar.jsx);
  // see its header for why that flow and not a new one.
  MANUAL_INTERACTION_LOGGED: 'manual_interaction_logged',
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
  [STATUS_TRIGGERS.MESSAGE_SENT]: CONTACT_STATUSES.AWAITING_REPLY,
  [STATUS_TRIGGERS.POSITIVE_REPLY]: CONTACT_STATUSES.IN_CONVERSATION,
  [STATUS_TRIGGERS.NEGATIVE_REPLY]: CONTACT_STATUSES.DORMANT,
  [STATUS_TRIGGERS.NO_REPLY_EXTENDED]: CONTACT_STATUSES.DORMANT,
  [STATUS_TRIGGERS.MANUAL_DORMANT]: CONTACT_STATUSES.DORMANT,
  // Deliberately NOT in alwaysApplyTriggers below: a manual log of one past
  // interaction can advance a contact that's never had one, but must not be
  // able to regress one already at Awaiting Reply/In Conversation the way
  // MESSAGE_SENT legitimately can (a real new send resets the waiting
  // clock; a backfilled note about an old interaction should not).
  [STATUS_TRIGGERS.MANUAL_INTERACTION_LOGGED]: CONTACT_STATUSES.ENGAGED,

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

// ── Idempotency guard ───────────────────────────────────────────────────────
//
// Same shape as companyDecision.js's `inFlight` Set, for the same class of
// problem: an engagement surface can remount (close/reopen the composer, a
// stray re-render) before an earlier write for the SAME contact and trigger
// has resolved, and each independent call then has no way to know the other
// one is already in flight. Scoped to `userId/contactId/trigger` rather than
// just the subject — two DIFFERENT triggers for the same contact (a reply
// landing while a manual log is being saved, say) are two real events and
// must both proceed; only a trigger racing itself is a duplicate.
//
// Shared by updateContactStatus below AND the composer-open call sites that
// log `engage_session_started` directly (never through this function, since
// that's no longer a status-producing trigger) — both need the same
// protection against the same remount race.

const inFlightEngagementKeys = new Set();

/** Test seam: forget every in-flight claim. */
export function resetEngagementGuards() {
  inFlightEngagementKeys.clear();
}

/**
 * Runs `fn` only if no call with this exact `key` is already in flight.
 * A duplicate call while one is pending resolves to `null` immediately,
 * without waiting for the first — it's not queued, it's dropped, which is
 * correct here: the first call already represents this trigger having
 * happened once, and there's nothing for a second, overlapping call to add.
 */
export async function withEngagementGuard(key, fn) {
  if (inFlightEngagementKeys.has(key)) return null;
  inFlightEngagementKeys.add(key);
  try {
    return await fn();
  } finally {
    inFlightEngagementKeys.delete(key);
  }
}

/** The guard key `updateContactStatus` uses — exported so callers that need
 * to guard a related, non-status write (logging `engage_session_started`)
 * with the same key shape can stay consistent with it. */
export function engagementGuardKey(userId, contactId, trigger) {
  return `${userId}/${contactId}/${trigger}`;
}

/**
 * Update a contact's status based on a trigger.
 * Writes to Firestore and logs a timeline event.
 *
 * Non-blocking — catches errors silently.
 *
 * DURABILITY, not just the in-memory guard: the decision (what the current
 * status actually is, and what the trigger should do to it) and the write
 * both happen inside ONE Firestore transaction that reads the document
 * fresh at commit time. `currentStatus`/`contact`, below, are accepted for
 * backward compatibility with every existing caller's signature but are no
 * longer consulted for the decision — the transaction's own read is always
 * authoritative, so a stale closure, a second browser tab, or a second
 * device cannot make this function act on data it already knows is old.
 * `withEngagementGuard` (this module) still exists alongside the
 * transaction: it is a same-runtime fast-skip for the common case
 * (remounting the same component before its last call resolved), cheaper
 * than a Firestore round trip; the transaction is what makes the OUTCOME
 * correct even when the guard can't see the other caller at all — a
 * second tab has no way to know about this tab's in-memory Set, but both
 * tabs' transactions still serialize correctly against the same document.
 *
 * What this does NOT claim: it is not "global idempotency" in the sense of
 * deduplicating two genuinely separate real-world events that each
 * legitimately request the same transition (e.g. two actual replies). That
 * is not a race to resolve — it is two real events, and the existing
 * priority check already decides each on its own merits, same as before.
 * What the transaction specifically closes is the stale-read class of bug:
 * two concurrent callers racing on the SAME transition, where without a
 * fresh read the second one could overwrite based on data it already knew
 * was superseded. On a genuine conflict, Firestore retries the losing
 * transaction against the document the winner just committed; this
 * function's own priority check then correctly reads that as
 * already-satisfied and writes nothing — not two statuses, not two
 * timeline events.
 *
 * @param {Object} params
 * @param {string} params.userId       - Authenticated user ID
 * @param {string} params.contactId    - Contact document ID
 * @param {string} params.trigger      - One of STATUS_TRIGGERS
 * @param {string} [params.currentStatus] - Accepted, not consulted — see above
 * @param {Object} [params.contact]       - Accepted, not consulted — see above
 * @returns {Promise<string|null>} New status if updated, null if skipped or failed
 */
export async function updateContactStatus({ userId, contactId, trigger }) {
  if (!userId || !contactId || !trigger) {
    console.error('[StateMachine] Missing required fields:', { userId, contactId, trigger });
    return null;
  }

  return withEngagementGuard(engagementGuardKey(userId, contactId, trigger), async () => {
    try {
      const contactRef = doc(db, 'users', userId, 'contacts', contactId);
      let resolvedCurrentStatus;
      let newStatus;

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(contactRef);
        const freshContact = snap.exists() ? snap.data() : null;
        resolvedCurrentStatus = freshContact?.contact_status || CONTACT_STATUSES.NEW;
        newStatus = resolveTransition(resolvedCurrentStatus, trigger);

        if (!newStatus) return; // Transition skipped — no write, this transaction does nothing

        const patch = {
          contact_status: newStatus,
          contact_status_updated_at: new Date().toISOString()
        };

        // A contact the user has actually engaged is no longer a discovery
        // suggestion, and must not be left as one. Auto-discovery writes
        // `status: 'suggested'` and nothing used to clear it, so an emailed
        // contact could keep that marker forever — at which point Saved
        // Companies dropped it for being suggested and People dropped it
        // for being engaged, and it appeared in neither surface while
        // cadences kept running against it. Promoting in the SAME write
        // means the two dimensions can never disagree about a contact this
        // path has touched. Reads the SAME fresh snapshot this transaction
        // already has — never a second, separately-timed read.
        if (isEngagedRecord({ contact_status: newStatus })) {
          Object.assign(patch, engagementPromotionFields(freshContact, { reason: trigger }));
        }

        tx.update(contactRef, patch);
      });

      if (!newStatus) return null;

      // Log timeline event — fail-soft, after the authoritative write has
      // committed. A failure here never undoes or retries the status
      // change; it is activity history, not the system of record.
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
  });
}

export { VALID_STATUSES };
