/**
 * NEXT BEST STEP SERVICE — Team Alpha
 * Operation People First // Missions → Next Best Step
 *
 * Missions are dead. Next Best Step is born.
 *
 * Instead of pre-generated, abstract game-like missions, Barry now proposes
 * a single, contextual Next Best Step at the end of every engage session.
 * The user confirms. The app reminds them at the right time. Barry has context
 * loaded when they return. Relationships compound instead of reset.
 *
 * The NBS flow:
 *   1. Session ends → Barry proposes an NBS based on what just happened
 *   2. User confirms, edits, or dismisses
 *   3. NBS is saved to the contact and to the user-level queue
 *   4. User receives a pull notification at the proposed due time
 *   5. User opens the app → Barry already has context loaded → 90-second session
 *
 * NBS is NOT a mission. It is not a multi-step campaign.
 * It is the single most valuable next action for this specific person, right now.
 *
 * NBS types:
 *   follow_up       — "Follow up in 2 days — they haven't responded"
 *   channel_switch  — "Three no-replies on email. Try LinkedIn or call."
 *   referral_ask    — "Two profiles in your network align — consider asking for a referral"
 *   intro_offer     — "You could introduce this person to [other contact] — mutual value"
 *   check_in        — "It's been 3 weeks — a genuine check-in is overdue"
 *   close           — "Positive momentum — time to ask for the commitment"
 *   nurture_touch   — "Not ready yet — keep warm with a no-ask touch"
 *   record_outcome  — "You sent a message — record what happened to keep momentum"
 */

import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PEOPLE_PATHS, NBS_TYPES, NBS_STATUSES } from '../schemas/peopleSchema';
import { logTimelineEvent } from '../utils/engagementHistoryLogger';

// ── Constants ────────────────────────────────────────────

// Default due-time offsets per NBS type (in hours)
const NBS_DEFAULT_OFFSETS = {
  follow_up: 48,           // 2 days
  channel_switch: 24,      // 1 day
  referral_ask: 72,        // 3 days
  intro_offer: 72,
  check_in: 168,           // 1 week
  close: 24,
  nurture_touch: 336,      // 2 weeks
  record_outcome: 120      // 5 days (if outcome not recorded by then)
};

// How many days before Barry re-surfaces a dismissed NBS of the same type
const NBS_RESURFACE_AFTER_DAYS = 14;

// ─────────────────────────────────────────────────────────────────
// NBS DERIVATION — Barry generates the Next Best Step
// ─────────────────────────────────────────────────────────────────

/**
 * Derive the Next Best Step for a contact after a session ends.
 *
 * Barry uses the session outcome, engagement history, and brigade context
 * to propose the single best next action. This is never auto-applied —
 * user always confirms.
 *
 * @param {Object} params
 * @param {Object} params.contact          - Full contact record
 * @param {string} params.sessionOutcome   - 'message_sent' | 'channel_blocked' | 'abandoned' | 'pivoted_channel'
 * @param {string} params.channel          - Channel used in the session
 * @param {string} params.blockedChannel   - Channel that was blocked (if any)
 * @param {Object} params.brigadeDefinition - Brigade definition from brigadeSystem
 * @returns {Object} NBS proposal
 */
export function deriveNextBestStep({ contact, sessionOutcome, channel, blockedChannel, brigadeDefinition }) {
  const summary = contact.engagement_summary || {};
  const consecutiveNoReplies = summary.consecutive_no_replies || 0;
  const totalAttempts = summary.total_attempts || 0;
  const brigadeId = contact.brigade;
  const followUpHours = brigadeDefinition?.barryBehavior?.followUpCadence
    ? brigadeDefinition.barryBehavior.followUpCadence * 24
    : 48;

  // ── Channel blocked → suggest switch ──────────────────
  if (sessionOutcome === 'channel_blocked' || sessionOutcome === 'pivoted_channel') {
    const alternatives = getAlternativeChannels(channel || blockedChannel, summary.channel_history);
    return buildNbs({
      type: 'channel_switch',
      action: `Try ${alternatives[0] || 'a different channel'} — ${blockedChannel || channel} isn't available`,
      reasoning: `The ${blockedChannel || channel} channel is blocked. Switch to ${alternatives[0] || 'an alternative'} to keep momentum going without losing context.`,
      dueInHours: 24,
      metadata: {
        blocked_channel: blockedChannel || channel,
        suggested_channel: alternatives[0] || null,
        all_alternatives: alternatives
      }
    });
  }

  // ── Message sent → follow up based on brigade cadence ─
  if (sessionOutcome === 'message_sent') {
    if (consecutiveNoReplies >= 2) {
      // Multiple no-replies → suggest channel switch
      const alternatives = getAlternativeChannels(channel, summary.channel_history);
      return buildNbs({
        type: 'channel_switch',
        action: `${consecutiveNoReplies} attempts without a reply — try ${alternatives[0] || 'a different channel'}`,
        reasoning: `Same channel, no response. Barry recommends switching to ${alternatives[0] || 'an alternative channel'} to break the pattern.`,
        dueInHours: 48,
        metadata: {
          consecutive_no_replies: consecutiveNoReplies,
          suggested_channel: alternatives[0] || null,
          tried_channels: Object.keys(summary.channel_history || {})
        }
      });
    }

    // Standard follow-up
    return buildNbs({
      type: 'follow_up',
      action: `Follow up with ${contact.name || 'this person'}`,
      reasoning: `Message sent. Barry will remind you to follow up in ${Math.round(followUpHours / 24)} day${followUpHours > 24 ? 's' : ''} if there's no response.`,
      dueInHours: followUpHours,
      metadata: {
        channel_used: channel,
        follow_up_suggested_channel: channel  // Follow up on same channel
      }
    });
  }

  // ── No reply for a long time → check in ───────────────
  const daysSinceLast = daysSince(summary.last_contact_at);
  if (daysSinceLast >= 21) {
    return buildNbs({
      type: 'check_in',
      action: `Check in with ${contact.name || 'this person'} — it's been ${daysSinceLast} days`,
      reasoning: `Significant time has passed since your last interaction. A genuine, no-agenda check-in prevents this relationship from going cold.`,
      dueInHours: 24,
      metadata: { days_since_last_contact: daysSinceLast }
    });
  }

  // ── Abandoned session → remind to finish ──────────────
  if (sessionOutcome === 'abandoned') {
    return buildNbs({
      type: 'follow_up',
      action: `Pick up where you left off with ${contact.name || 'this person'}`,
      reasoning: `Session was saved without sending. All context is preserved — it'll take 90 seconds to pick up and finish.`,
      dueInHours: 24,
      metadata: { session_was_abandoned: true }
    });
  }

  // ── High-value contact → close ─────────────────────────
  if (['high', 'critical'].includes(contact.strategic_value) && summary.positive_replies > 0) {
    return buildNbs({
      type: 'close',
      action: `Move toward commitment with ${contact.name || 'this person'}`,
      reasoning: `This is a high-value contact with positive engagement history. Barry recommends advancing toward a concrete commitment or next step.`,
      dueInHours: 24,
      metadata: { positive_replies: summary.positive_replies }
    });
  }

  // ── Default: generic follow-up ────────────────────────
  return buildNbs({
    type: 'follow_up',
    action: `Follow up with ${contact.name || 'this person'}`,
    reasoning: `Staying consistent is how relationships compound. Barry recommends a follow-up in ${Math.round(followUpHours / 24)} days.`,
    dueInHours: followUpHours,
    metadata: {}
  });
}

/**
 * Generate referral-based NBS suggestions.
 * Called by the referral intelligence engine when an opportunity is detected.
 *
 * @param {Object} params
 * @param {string} params.contactName - Name of the contact to suggest the NBS for
 * @param {string} params.referralOpportunity - Description of the referral opportunity
 * @param {string} params.networkContactName  - Name of the network contact involved
 * @returns {Object} NBS proposal
 */
export function deriveReferralNbs({ contactName, referralOpportunity, networkContactName }) {
  return buildNbs({
    type: 'referral_ask',
    action: `Ask ${contactName} for a referral${networkContactName ? ` to ${networkContactName}` : ''}`,
    reasoning: referralOpportunity,
    dueInHours: 48,
    metadata: {
      network_contact_name: networkContactName || null,
      opportunity: referralOpportunity
    }
  });
}

/**
 * Generate intro-offer NBS.
 * Called when Barry detects two contacts that should meet each other.
 */
export function deriveIntroNbs({ contactName, introTargetName, introRationale }) {
  return buildNbs({
    type: 'intro_offer',
    action: `Offer to introduce ${contactName} to ${introTargetName}`,
    reasoning: introRationale,
    dueInHours: 72,
    metadata: {
      intro_target_name: introTargetName,
      rationale: introRationale
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// NBS PERSISTENCE — Save, confirm, complete, dismiss
// ─────────────────────────────────────────────────────────────────

/**
 * Save a proposed NBS to the contact document and the NBS queue.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} nbsProposal - From deriveNextBestStep()
 * @returns {Promise<string>} NBS ID
 */
export async function saveNextBestStep(userId, contactId, nbsProposal) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return null;

    const contact = snap.data();
    const now = new Date().toISOString();

    // Archive the current NBS if it exists
    const history = Array.isArray(contact.next_best_step_history)
      ? [...contact.next_best_step_history]
      : [];

    if (contact.next_best_step && contact.next_best_step.status === 'pending') {
      history.push({
        ...contact.next_best_step,
        superseded_at: now,
        status: 'superseded'
      });
    }

    // Write new NBS to contact.
    // next_step_due is the flat field Beta's PersistentEngageBar reads for the morning
    // briefing pull-back check — written at the top level of the contact document
    // so it can be queried directly without loading the nested next_best_step object.
    await updateDoc(contactRef, {
      next_best_step: nbsProposal,
      next_best_step_history: history,
      next_step_due: nbsProposal.due_at,      // Flat field — queryable, readable by briefing
      next_step_type: nbsProposal.type,        // Flat field — readable without nested access
      updatedAt: now
    });

    // Write to NBS queue for notification system
    const queueRef = collection(db, PEOPLE_PATHS.nbsQueue(userId));
    const queueDoc = await addDoc(queueRef, {
      contact_id: contactId,
      contact_name: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
      nbs: nbsProposal,
      status: 'pending',
      due_at: nbsProposal.due_at,
      created_at: now
    });

    // Log timeline event — canonical type is 'next_step_queued' (integration check #3)
    await logTimelineEvent({
      userId,
      contactId,
      type: 'next_step_queued',              // Canonical name — matches Beta's UI check
      actor: 'barry',
      preview: nbsProposal.action,
      metadata: {
        nbs_type: nbsProposal.type,
        due_at: nbsProposal.due_at,
        reasoning: nbsProposal.reasoning,
        queue_id: queueDoc.id
      }
    });

    return nbsProposal.id;
  } catch (error) {
    console.error('[NBS] Failed to save next best step:', error);
    return null;
  }
}

/**
 * Confirm a pending NBS.
 * User has reviewed Barry's suggestion and agreed to take the action.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} [editedAction] - If user modified the action text
 * @param {string} [editedDueAt]  - If user modified the due date
 */
export async function confirmNextBestStep(userId, contactId, editedAction, editedDueAt) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const nbs = snap.data().next_best_step;
    if (!nbs || nbs.status !== 'pending') return;

    const now = new Date().toISOString();
    const confirmedNbs = {
      ...nbs,
      status: 'confirmed',
      user_confirmed: true,
      confirmed_at: now,
      action: editedAction || nbs.action,
      due_at: editedDueAt || nbs.due_at
    };

    // Keep next_step_due in sync if user edited the due date
    const updates = {
      next_best_step: confirmedNbs,
      updatedAt: now
    };
    if (editedDueAt) {
      updates.next_step_due = editedDueAt;
    }
    await updateDoc(contactRef, updates);

    await logTimelineEvent({
      userId,
      contactId,
      type: 'next_step_confirmed',           // Canonical type
      actor: 'user',
      preview: confirmedNbs.action,
      metadata: {
        nbs_type: confirmedNbs.type,
        due_at: confirmedNbs.due_at,
        was_edited: !!(editedAction || editedDueAt)
      }
    });
  } catch (error) {
    console.error('[NBS] Failed to confirm next best step:', error);
  }
}

/**
 * Mark a confirmed NBS as completed.
 * Called when the user takes the action or starts the associated engage session.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} [completionNote] - Optional note about how it went
 */
export async function completeNextBestStep(userId, contactId, completionNote) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const contact = snap.data();
    const nbs = contact.next_best_step;
    if (!nbs) return;

    const now = new Date().toISOString();
    const completedNbs = {
      ...nbs,
      status: 'completed',
      completed_at: now,
      completion_note: completionNote || null
    };

    const history = Array.isArray(contact.next_best_step_history)
      ? [...contact.next_best_step_history, completedNbs]
      : [completedNbs];

    await updateDoc(contactRef, {
      next_best_step: null,             // Clear the current NBS — Barry will propose a new one
      next_best_step_history: history,
      next_step_due: null,              // Clear flat field — no active step
      next_step_type: null,
      updatedAt: now
    });

    await logTimelineEvent({
      userId,
      contactId,
      type: 'next_step_completed',      // Canonical type
      actor: 'user',
      preview: nbs.action,
      metadata: {
        nbs_type: nbs.type,
        completion_note: completionNote || null
      }
    });
  } catch (error) {
    console.error('[NBS] Failed to complete next best step:', error);
  }
}

/**
 * Dismiss a pending NBS without acting on it.
 * Does not delete — moves to history with 'dismissed' status.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} [reason] - Why dismissed
 */
export async function dismissNextBestStep(userId, contactId, reason) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const contact = snap.data();
    const nbs = contact.next_best_step;
    if (!nbs) return;

    const now = new Date().toISOString();
    const dismissedNbs = {
      ...nbs,
      status: 'dismissed',
      dismissed_at: now,
      dismissal_reason: reason || null
    };

    const history = Array.isArray(contact.next_best_step_history)
      ? [...contact.next_best_step_history, dismissedNbs]
      : [dismissedNbs];

    await updateDoc(contactRef, {
      next_best_step: null,
      next_best_step_history: history,
      next_step_due: null,              // Clear flat field
      next_step_type: null,
      updatedAt: now
    });

    await logTimelineEvent({
      userId,
      contactId,
      type: 'next_step_dismissed',      // Canonical type
      actor: 'user',
      preview: nbs.action,
      metadata: {
        nbs_type: nbs.type,
        reason: reason || null
      }
    });
  } catch (error) {
    console.error('[NBS] Failed to dismiss next best step:', error);
  }
}

// ─────────────────────────────────────────────────────────────────
// NBS QUEUE — User-level overdue and upcoming steps
// ─────────────────────────────────────────────────────────────────

/**
 * Load the user's NBS queue — all confirmed, pending steps sorted by due date.
 * Used by Barry's morning greeting ("You have 3 people waiting for follow-up").
 *
 * @param {string} userId
 * @param {number} [maxItems] - Maximum items to return
 * @returns {Promise<Array>} Array of NBS queue items, sorted by due_at
 */
export async function loadNbsQueue(userId, maxItems = 10) {
  try {
    const queueRef = collection(db, PEOPLE_PATHS.nbsQueue(userId));
    const q = query(
      queueRef,
      where('status', 'in', ['pending', 'confirmed']),
      orderBy('due_at', 'asc'),
      limit(maxItems)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[NBS] Failed to load NBS queue:', error);
    return [];
  }
}

/**
 * Load overdue NBS items (due_at has passed, not yet completed).
 * Used for Barry's proactive morning briefing.
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function loadOverdueNbs(userId) {
  try {
    const now = new Date().toISOString();
    const queueRef = collection(db, PEOPLE_PATHS.nbsQueue(userId));
    const q = query(
      queueRef,
      where('status', 'in', ['pending', 'confirmed']),
      where('due_at', '<=', now),
      orderBy('due_at', 'asc'),
      limit(20)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[NBS] Failed to load overdue NBS:', error);
    return [];
  }
}

/**
 * Generate Barry's morning briefing — the 11-star experience opening.
 * "Good morning — you have 3 people who haven't heard from you in over a week."
 *
 * @param {string} userId
 * @param {string} [userName] - User's first name for personalization
 * @returns {Promise<Object>} Morning briefing data
 */
export async function generateMorningBriefing(userId, userName) {
  try {
    const [overdue, upcoming] = await Promise.all([
      loadOverdueNbs(userId),
      loadNbsQueue(userId, 5)
    ]);

    const overdueCount = overdue.length;
    const upcomingToday = upcoming.filter(item => {
      const dueDate = new Date(item.due_at);
      const today = new Date();
      return dueDate.toDateString() === today.toDateString();
    });

    // Build greeting message
    let greeting = userName ? `Good morning, ${userName}` : 'Good morning';

    const messages = [];

    if (overdueCount > 0) {
      const names = overdue.slice(0, 3).map(i => i.contact_name).filter(Boolean);
      const nameStr = names.length > 0
        ? names.slice(0, 2).join(', ') + (names.length > 2 ? `, and ${overdueCount - 2} more` : '')
        : `${overdueCount} people`;

      messages.push(`${nameStr} ${overdueCount === 1 ? "hasn't" : "haven't"} heard from you — ${overdueCount === 1 ? 'a follow-up is overdue' : `${overdueCount} follow-ups are overdue`}.`);
    }

    if (upcomingToday.length > 0) {
      messages.push(`${upcomingToday.length} step${upcomingToday.length > 1 ? 's' : ''} due today.`);
    }

    // Check for high-priority referral opportunity
    const referralItem = overdue.find(i => i.nbs?.type === 'referral_ask');
    if (referralItem) {
      messages.push(`One of them asked for a referral last time you spoke. Want to start there?`);
    }

    const briefing = greeting + (messages.length > 0 ? ' — ' + messages.join(' ') : ', everything is clear today.');

    return {
      greeting: briefing,
      overdue_count: overdueCount,
      overdue_items: overdue,
      today_items: upcomingToday,
      priority_contact: overdue[0] || null,
      has_referral_opportunity: !!referralItem
    };
  } catch (error) {
    console.error('[NBS] Failed to generate morning briefing:', error);
    return {
      greeting: 'Good morning — let\'s get to work.',
      overdue_count: 0,
      overdue_items: [],
      today_items: [],
      priority_contact: null,
      has_referral_opportunity: false
    };
  }
}

// ── Helpers ──────────────────────────────────────────────

function buildNbs({ type, action, reasoning, dueInHours, metadata }) {
  const now = new Date();
  const dueAt = new Date(now.getTime() + (dueInHours || 48) * 60 * 60 * 1000);

  return {
    id: `nbs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: NBS_TYPES.includes(type) ? type : 'follow_up',
    action,
    reasoning,
    due_at: dueAt.toISOString(),
    proposed_at: now.toISOString(),
    status: 'pending',
    user_confirmed: false,
    confirmed_at: null,
    metadata: metadata || {}
  };
}

function getAlternativeChannels(blockedChannel, channelHistory) {
  const allChannels = ['email', 'phone', 'linkedin', 'text', 'calendar'];
  const triedChannels = new Set(Object.keys(channelHistory || {}));
  if (blockedChannel) triedChannels.add(blockedChannel);

  // Prefer channels not yet tried, then fall back to all alternatives
  const untried = allChannels.filter(c => !triedChannels.has(c));
  const alternatives = untried.length > 0
    ? untried
    : allChannels.filter(c => c !== blockedChannel);

  return alternatives;
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const date = typeof dateStr === 'object' && dateStr.toDate
    ? dateStr.toDate()
    : new Date(dateStr);
  if (isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}
