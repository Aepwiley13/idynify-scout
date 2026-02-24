/**
 * ENGAGEMENT HISTORY LOGGER — Team Alpha
 * Operation People First // Persistent History Layer
 *
 * Extended timeline logger for the new engagement system.
 * Every action — sent or unsent, selected or not — creates a permanent record.
 * No dead ends. No context loss. Ever.
 *
 * This extends (not replaces) the existing timelineLogger.js.
 * New event types added by Operation People First:
 *
 *   ── Engage Module Events ─────────────────────────────
 *   engage_session_started       User opens the Engage module on a profile
 *   engage_session_completed     Session ended with a message sent
 *   engage_session_abandoned     Session ended without sending (context preserved)
 *   engage_session_pivoted       Session ended with channel switch
 *   message_generated_all_types  All 4 Barry message types generated (stores all, not just selected)
 *   channel_blocked              A channel attempt was blocked or unavailable
 *   channel_pivot_started        User is switching channels mid-session
 *
 *   ── Next Best Step Events ────────────────────────────
 *   next_best_step_proposed      Barry proposes an NBS at session end
 *   next_best_step_confirmed     User confirms the NBS
 *   next_best_step_completed     User completes the NBS action
 *   next_best_step_dismissed     User dismisses the NBS
 *
 *   ── Brigade Events ───────────────────────────────────
 *   brigade_assigned             Initial brigade set
 *   brigade_transition_suggested Barry suggests a brigade change
 *   brigade_transition_confirmed User confirms the brigade change
 *   brigade_transition_dismissed User declines the brigade change
 *
 *   ── Referral Events ──────────────────────────────────
 *   referral_received            This contact referred someone to the user
 *   referral_sent                User referred someone to this contact
 *   referral_converted           A referred contact converted
 *   referral_opportunity_flagged Barry flagged a referral opportunity
 *
 *   ── Person Type Events ───────────────────────────────
 *   person_type_changed          Person moved between lenses (lead → customer, etc.)
 *
 *   ── Existing Events (from original timelineLogger.js) ─
 *   message_generated
 *   message_sent
 *   mission_assigned
 *   campaign_assigned
 *   lead_status_changed
 *   contact_status_changed
 *   sequence_step_proposed
 *   sequence_step_approved
 *   sequence_step_sent
 *   sequence_step_skipped
 *   sequence_completed
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// ── All event types (original + new) ────────────────────

const ALL_TIMELINE_EVENT_TYPES = [
  // Original events (from timelineLogger.js)
  'message_generated',
  'message_sent',
  'mission_assigned',
  'campaign_assigned',
  'lead_status_changed',
  'contact_status_changed',
  'sequence_step_proposed',
  'sequence_step_approved',
  'sequence_step_sent',
  'sequence_step_skipped',
  'sequence_completed',

  // Engage Module Events
  'engage_session_started',
  'engage_session_completed',
  'engage_session_abandoned',
  'engage_session_pivoted',
  'message_generated_all_types',
  'channel_blocked',
  'channel_pivot_started',

  // Next Best Step Events
  // Canonical name used by integration checks and Beta's UI: next_step_queued
  // next_best_step_proposed is kept as an alias for backward compatibility
  'next_step_queued',             // Canonical: NBS proposed by Barry and saved to queue
  'next_step_confirmed',          // Canonical: User confirmed the NBS
  'next_step_completed',          // Canonical: User took the action
  'next_step_dismissed',          // Canonical: User dismissed without acting
  'next_best_step_proposed',      // Legacy alias → maps to next_step_queued
  'next_best_step_confirmed',     // Legacy alias → maps to next_step_confirmed
  'next_best_step_completed',     // Legacy alias → maps to next_step_completed
  'next_best_step_dismissed',     // Legacy alias → maps to next_step_dismissed

  // Brigade Events
  'brigade_assigned',
  'brigade_transition_suggested',
  'brigade_transition_confirmed',
  'brigade_transition_dismissed',

  // Referral Events
  'referral_received',
  'referral_sent',
  'referral_converted',
  'referral_opportunity_flagged',

  // Person Type Events
  'person_type_changed'
];

// Actor constants
export const ACTORS = {
  USER: 'user',
  BARRY: 'barry',
  SYSTEM: 'system'
};

// ── Core Logger ──────────────────────────────────────────

/**
 * Log a structured timeline event to the contact's timeline subcollection.
 * This is the single entry point for all timeline event creation.
 *
 * Non-blocking — never throws. Returns event ID or null on failure.
 *
 * @param {Object} params
 * @param {string} params.userId       - Authenticated user ID
 * @param {string} params.contactId    - Contact document ID
 * @param {string} params.type         - One of ALL_TIMELINE_EVENT_TYPES
 * @param {string} params.actor        - 'user' | 'barry' | 'system'
 * @param {string} [params.preview]    - Short preview snippet shown in the timeline
 * @param {Object} [params.metadata]   - Type-specific structured metadata
 *
 * @returns {Promise<string|null>} Document ID of the created event, or null
 */
export async function logTimelineEvent({ userId, contactId, type, actor, preview, metadata }) {
  if (!userId || !contactId || !type || !actor) {
    console.error('[EngagementHistory] Missing required fields:', { userId, contactId, type, actor });
    return null;
  }

  if (!ALL_TIMELINE_EVENT_TYPES.includes(type)) {
    console.error('[EngagementHistory] Invalid event type:', type);
    return null;
  }

  try {
    const timelineRef = collection(db, 'users', userId, 'contacts', contactId, 'timeline');

    // DUAL-WRITE: Both createdAt (legacy reads) and timestamp (ordered queries).
    // This matches Beta's PersistentEngageBar which queries by timestamp.
    // Historical docs missing timestamp are backfilled by:
    //   src/scripts/backfillTimelineTimestamp.js
    const now = Timestamp.now();
    const event = {
      type,
      actor,
      createdAt: now,
      timestamp: now,             // Required for orderBy('timestamp') queries
      ...(preview ? { preview } : {}),
      ...(metadata ? { metadata } : {})
    };

    const docRef = await addDoc(timelineRef, event);
    return docRef.id;
  } catch (error) {
    console.error('[EngagementHistory] Failed to log event:', error);
    return null;
  }
}

// ── Typed Logger Helpers ─────────────────────────────────
// Convenience functions for common event patterns.
// Each enforces the correct metadata shape for its event type.

/**
 * Log engage session started.
 */
export async function logEngageSessionStarted(userId, contactId, { sessionId, goal, brigade, channel }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'engage_session_started',
    actor: ACTORS.USER,
    preview: goal ? `Goal: ${goal}` : 'Engage session started',
    metadata: { sessionId, goal, brigade, channel }
  });
}

/**
 * Log engage session completed (message sent).
 */
export async function logEngageSessionCompleted(userId, contactId, { sessionId, channel, messageTone, messagePreview }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'engage_session_completed',
    actor: ACTORS.USER,
    preview: messagePreview || 'Message sent',
    metadata: { sessionId, channel, messageTone, messagePreview }
  });
}

/**
 * Log engage session abandoned (saved without sending).
 * Context is preserved — user can resume from where they left off.
 */
export async function logEngageSessionAbandoned(userId, contactId, { sessionId, reason }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'engage_session_abandoned',
    actor: ACTORS.USER,
    preview: 'Session saved — context preserved',
    metadata: { sessionId, reason: reason || 'no_reason_given' }
  });
}

/**
 * Log all four Barry message types generated.
 * ALL types are stored — selected or not. This is the key to "no dead ends."
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.channel
 * @param {Array}  params.messages - Array of { type, subject, bodyPreview }
 */
export async function logAllMessagesGenerated(userId, contactId, { sessionId, channel, messages }) {
  const types = messages.map(m => m.type);
  const preview = `${messages.length} message${messages.length > 1 ? 's' : ''} generated (${types.join(', ')})`;

  return logTimelineEvent({
    userId, contactId,
    type: 'message_generated_all_types',
    actor: ACTORS.BARRY,
    preview,
    metadata: {
      sessionId,
      channel,
      message_count: messages.length,
      types,
      messages: messages.map(m => ({
        type: m.type,
        subject: m.subject || null,
        body_preview: m.bodyPreview ? m.bodyPreview.slice(0, 120) : null
      }))
    }
  });
}

/**
 * Log a channel being blocked.
 * Ensures no dead end — always records why and what the alternative is.
 */
export async function logChannelBlocked(userId, contactId, { sessionId, blockedChannel, reason, alternativeChannel }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'channel_blocked',
    actor: ACTORS.SYSTEM,
    preview: `${blockedChannel} unavailable — ${alternativeChannel ? `switching to ${alternativeChannel}` : 'pivoting to alternative'}`,
    metadata: { sessionId, blockedChannel, reason, alternativeChannel: alternativeChannel || null }
  });
}

/**
 * Log channel pivot initiated.
 */
export async function logChannelPivot(userId, contactId, { sessionId, fromChannel, toChannel }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'channel_pivot_started',
    actor: ACTORS.USER,
    preview: `Switching from ${fromChannel} to ${toChannel}`,
    metadata: { sessionId, fromChannel, toChannel }
  });
}

/**
 * Log brigade assigned (initial assignment).
 */
export async function logBrigadeAssigned(userId, contactId, { brigadeId, brigadeLabel, reasoning, confidence }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'brigade_assigned',
    actor: ACTORS.BARRY,
    preview: `Brigade set: ${brigadeLabel}`,
    metadata: { brigadeId, brigadeLabel, reasoning, confidence }
  });
}

/**
 * Log a brigade transition suggestion from Barry.
 */
export async function logBrigadeTransitionSuggested(userId, contactId, {
  fromBrigadeId, fromBrigadeLabel, toBrigadeId, toBrigadeLabel, trigger, suggestion
}) {
  return logTimelineEvent({
    userId, contactId,
    type: 'brigade_transition_suggested',
    actor: ACTORS.BARRY,
    preview: `Barry suggests: ${fromBrigadeLabel} → ${toBrigadeLabel}`,
    metadata: { fromBrigadeId, fromBrigadeLabel, toBrigadeId, toBrigadeLabel, trigger, suggestion }
  });
}

/**
 * Log a confirmed brigade transition.
 */
export async function logBrigadeTransitionConfirmed(userId, contactId, {
  fromBrigadeId, toBrigadeId, toBrigadeLabel
}) {
  return logTimelineEvent({
    userId, contactId,
    type: 'brigade_transition_confirmed',
    actor: ACTORS.USER,
    preview: `Brigade updated: ${toBrigadeLabel}`,
    metadata: { fromBrigadeId, toBrigadeId, toBrigadeLabel }
  });
}

/**
 * Log a referral received from this contact.
 */
export async function logReferralReceived(userId, contactId, { referralId, referredContactName, context }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'referral_received',
    actor: ACTORS.USER,
    preview: `Referred ${referredContactName} to you`,
    metadata: { referralId, referredContactName, context }
  });
}

/**
 * Log a referral you sent to this contact.
 */
export async function logReferralSent(userId, contactId, { referralId, referredContactName, context }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'referral_sent',
    actor: ACTORS.USER,
    preview: `You referred ${referredContactName} to them`,
    metadata: { referralId, referredContactName, context }
  });
}

/**
 * Log a referral conversion.
 */
export async function logReferralConverted(userId, contactId, { referralId, referredContactName }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'referral_converted',
    actor: ACTORS.USER,
    preview: `${referredContactName} converted — referral success`,
    metadata: { referralId, referredContactName }
  });
}

/**
 * Log person type change (lead → customer, etc.).
 */
export async function logPersonTypeChanged(userId, contactId, { fromType, toType, reason }) {
  return logTimelineEvent({
    userId, contactId,
    type: 'person_type_changed',
    actor: ACTORS.USER,
    preview: `Moved from ${fromType} to ${toType}`,
    metadata: { fromType, toType, reason: reason || null }
  });
}

// ── Export event type list for validation ────────────────

export { ALL_TIMELINE_EVENT_TYPES as TIMELINE_EVENT_TYPES };
