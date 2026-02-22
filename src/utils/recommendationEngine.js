/**
 * RECOMMENDATION ENGINE (Step 7)
 *
 * Barry's proactive intelligence layer. Derives contextual recommendations
 * at read time from existing data — no background jobs, no scheduled functions.
 *
 * Four recommendation categories:
 *   1. Stalled Engagement Alerts — contacts/missions going quiet
 *   2. High-Value Contact Alerts — high/critical contacts being neglected
 *   3. Mission Momentum Recommendations — missions needing repositioning
 *   4. Strategic Gap Alerts — campaign-level neglect patterns
 *
 * Every recommendation is advisory only. Barry never acts without user approval.
 *
 * Recommendations are derived per-query with targeted Firestore reads,
 * capped at 50 records per query for performance safety.
 *
 * Prioritization order:
 *   1. Critical contacts first
 *   2. Approaching deadlines second
 *   3. Stalled high-value contacts third
 *   4. General gaps fourth
 */

import {
  collection, query, where, getDocs, orderBy, limit, doc, getDoc, addDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { CONTACT_STATUSES } from './contactStateMachine';
import { getLabelById, STRATEGIC_VALUES, OBJECTIVE_TYPES, MISSION_TIMEFRAMES } from '../constants/structuredFields';

// ── Constants ───────────────────────────────────────────

const QUERY_CAP = 50;
const DASHBOARD_MAX_RECOMMENDATIONS = 5;

// Thresholds (in days)
const THRESHOLDS = {
  STALLED_AWAITING_REPLY: 14,        // Contact in Awaiting Reply with no activity
  STALLED_MISSION_ACTIVITY: 7,       // Mission with no activity
  STALLED_OUTCOME_RECORDING: 5,      // Step sent but no outcome recorded
  HIGH_VALUE_DORMANT: 30,            // Critical/High contact dormant
  HIGH_VALUE_NO_CAMPAIGN: 7,         // High-value contact from Scout with no campaign
  MOMENTUM_NO_REPLY_CONSECUTIVE: 2,  // Consecutive no-reply steps
  MOMENTUM_POSITIVE_NO_FOLLOWUP: 3,  // Positive reply but no next step approved
  MOMENTUM_DEADLINE_APPROACHING: 5,  // Mission deadline approaching (days)
  STRATEGIC_GAP_NO_ENGAGEMENT: 30,   // Campaign contact with no engagement
  DISMISSAL_SUPPRESSION: 7           // Days to suppress dismissed recommendations
};

// Timeframe → days mapping for mission deadline calculation
const TIMEFRAME_DAYS = {
  this_week: 7,
  this_month: 30,
  this_quarter: 90,
  no_deadline: null
};

// Recommendation types
export const RECOMMENDATION_TYPES = {
  STALLED_AWAITING_REPLY: 'stalled_awaiting_reply',
  STALLED_MISSION_INACTIVE: 'stalled_mission_inactive',
  STALLED_OUTCOME_NOT_RECORDED: 'stalled_outcome_not_recorded',
  HIGH_VALUE_NO_MISSION: 'high_value_no_mission',
  HIGH_VALUE_NO_ENGAGEMENT: 'high_value_no_engagement',
  HIGH_VALUE_DORMANT: 'high_value_dormant',
  MOMENTUM_CHANNEL_SWITCH: 'momentum_channel_switch',
  MOMENTUM_ACCELERATE: 'momentum_accelerate',
  MOMENTUM_COMPRESS: 'momentum_compress',
  STRATEGIC_GAP_NO_ENGAGEMENT: 'strategic_gap_no_engagement',
  STRATEGIC_GAP_NEVER_CONTACTED: 'strategic_gap_never_contacted',
  STRATEGIC_GAP_NO_OUTCOME: 'strategic_gap_no_outcome'
};

// CTA action types
export const RECOMMENDATION_ACTIONS = {
  START_MISSION: 'start_mission',
  APPROVE_NEXT_STEP: 'approve_next_step',
  RE_ENGAGE: 're_engage',
  RECORD_OUTCOME: 'record_outcome',
  ADD_TO_CAMPAIGN: 'add_to_campaign',
  SWITCH_CHANNEL: 'switch_channel',
  ACCELERATE_SEQUENCE: 'accelerate_sequence'
};

// Priority weights for sorting (lower = higher priority)
const PRIORITY_WEIGHTS = {
  critical_contact: 0,
  approaching_deadline: 1,
  stalled_high_value: 2,
  general_gap: 3
};

// ── Helpers ─────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const date = typeof dateStr === 'object' && dateStr.toDate
    ? dateStr.toDate()
    : new Date(dateStr);
  if (isNaN(date.getTime())) return Infinity;
  const now = new Date();
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

function daysUntilDeadline(createdAt, timeframe) {
  if (!createdAt || !timeframe) return null;
  const days = TIMEFRAME_DAYS[timeframe];
  if (days === null || days === undefined) return null;

  const created = typeof createdAt === 'object' && createdAt.toDate
    ? createdAt.toDate()
    : new Date(createdAt);
  if (isNaN(created.getTime())) return null;

  const deadline = new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
  const now = new Date();
  return Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
}

function generateRecommendationId(type, entityId) {
  return `${type}::${entityId}`;
}

/**
 * Check if a recommendation has been dismissed within the suppression window.
 */
function isDismissed(recommendationId, dismissals) {
  if (!dismissals || !dismissals.length) return false;
  const dismissal = dismissals.find(d => d.recommendationId === recommendationId);
  if (!dismissal) return false;

  const dismissedDaysAgo = daysSince(dismissal.dismissedAt);
  return dismissedDaysAgo < THRESHOLDS.DISMISSAL_SUPPRESSION;
}

/**
 * Build a recommendation object with Barry's reasoning.
 */
function buildRecommendation({
  id,
  type,
  category,
  priorityWeight,
  contactId,
  contactName,
  missionId,
  missionName,
  campaignId,
  campaignName,
  observed,
  whyItMatters,
  suggestion,
  rationale,
  actionType,
  actionLabel
}) {
  return {
    id,
    type,
    category,
    priorityWeight,
    contactId: contactId || null,
    contactName: contactName || null,
    missionId: missionId || null,
    missionName: missionName || null,
    campaignId: campaignId || null,
    campaignName: campaignName || null,
    reasoning: {
      observed,
      whyItMatters,
      suggestion,
      rationale
    },
    action: {
      type: actionType,
      label: actionLabel
    },
    createdAt: new Date().toISOString()
  };
}

// ── Category 1: Stalled Engagement Alerts ───────────────

/**
 * Detect contacts in Awaiting Reply beyond threshold,
 * missions with no activity, and steps awaiting outcome recording.
 */
async function deriveStalledEngagementAlerts(userId, dismissals) {
  const recommendations = [];

  try {
    // 1a. Contacts in Awaiting Reply beyond threshold
    const awaitingQuery = query(
      collection(db, 'users', userId, 'contacts'),
      where('contact_status', '==', CONTACT_STATUSES.AWAITING_REPLY),
      orderBy('contact_status_updated_at', 'asc'),
      limit(QUERY_CAP)
    );

    const awaitingSnap = await getDocs(awaitingQuery);
    for (const contactDoc of awaitingSnap.docs) {
      const contact = { id: contactDoc.id, ...contactDoc.data() };
      const days = daysSince(contact.contact_status_updated_at);

      if (days >= THRESHOLDS.STALLED_AWAITING_REPLY) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.STALLED_AWAITING_REPLY, contact.id);
        if (isDismissed(recId, dismissals)) continue;

        const contactName = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown';
        const isCritical = contact.strategic_value === 'critical';
        const isHigh = contact.strategic_value === 'high';

        recommendations.push(buildRecommendation({
          id: recId,
          type: RECOMMENDATION_TYPES.STALLED_AWAITING_REPLY,
          category: 'stalled_engagement',
          priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact
            : isHigh ? PRIORITY_WEIGHTS.stalled_high_value
            : PRIORITY_WEIGHTS.general_gap,
          contactId: contact.id,
          contactName,
          observed: `No engagement with ${contactName} in ${days} days`,
          whyItMatters: isCritical
            ? `They are a Critical contact in Awaiting Reply — silence risks losing a top-priority relationship`
            : isHigh
            ? `They are a High-value contact whose engagement has stalled`
            : `This contact has been waiting for a reply with no follow-up`,
          suggestion: `Re-engage with a value-led follow-up referencing your previous interaction`,
          rationale: `Contacts in Awaiting Reply respond better to follow-ups that add new value rather than simply checking in`,
          actionType: RECOMMENDATION_ACTIONS.RE_ENGAGE,
          actionLabel: 'Re-engage Now'
        }));
      }
    }

    // 1b. Missions with no activity beyond 7 days
    const missionsQuery = query(
      collection(db, 'users', userId, 'missions'),
      where('status', '==', 'autopilot'),
      orderBy('updatedAt', 'asc'),
      limit(QUERY_CAP)
    );

    const missionsSnap = await getDocs(missionsQuery);
    for (const missionDoc of missionsSnap.docs) {
      const mission = { id: missionDoc.id, ...missionDoc.data() };
      const days = daysSince(mission.updatedAt);

      if (days >= THRESHOLDS.STALLED_MISSION_ACTIVITY) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.STALLED_MISSION_INACTIVE, mission.id);
        if (isDismissed(recId, dismissals)) continue;

        // Count contacts with no activity
        const stalledContacts = (mission.contacts || []).filter(c => {
          const lastTouch = c.lastTouchDate || c.stepHistory?.[c.stepHistory.length - 1]?.sentAt;
          return daysSince(lastTouch) >= THRESHOLDS.STALLED_MISSION_ACTIVITY;
        });

        if (stalledContacts.length > 0) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.STALLED_MISSION_INACTIVE,
            category: 'stalled_engagement',
            priorityWeight: PRIORITY_WEIGHTS.general_gap,
            missionId: mission.id,
            missionName: mission.name || 'Unnamed Mission',
            observed: `Mission "${mission.name || 'Unnamed'}" has ${stalledContacts.length} contact${stalledContacts.length > 1 ? 's' : ''} with no activity in ${days}+ days`,
            whyItMatters: `Inactive missions lose momentum — contacts may disengage if too much time passes`,
            suggestion: `Review the mission and approve the next step for stalled contacts`,
            rationale: `Re-engaging within the original mission context preserves the narrative Barry built for each contact`,
            actionType: RECOMMENDATION_ACTIONS.APPROVE_NEXT_STEP,
            actionLabel: 'Review Mission'
          }));
        }
      }
    }

    // 1c. Steps sent but outcome not recorded within threshold
    // Derived from missions already loaded above
    for (const missionDoc of missionsSnap.docs) {
      const mission = { id: missionDoc.id, ...missionDoc.data() };

      for (const contact of (mission.contacts || [])) {
        if (contact.sequenceStatus !== 'awaiting_outcome') continue;

        const lastSentStep = [...(contact.stepHistory || [])].reverse().find(h => h.action === 'sent' && !h.outcome);
        if (!lastSentStep) continue;

        const daysSinceSent = daysSince(lastSentStep.sentAt);
        if (daysSinceSent >= THRESHOLDS.STALLED_OUTCOME_RECORDING) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.STALLED_OUTCOME_NOT_RECORDED, `${mission.id}_${contact.contactId}`);
          if (isDismissed(recId, dismissals)) continue;

          const contactName = contact.name || 'a contact';

          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.STALLED_OUTCOME_NOT_RECORDED,
            category: 'stalled_engagement',
            priorityWeight: PRIORITY_WEIGHTS.general_gap,
            contactId: contact.contactId,
            contactName,
            missionId: mission.id,
            missionName: mission.name || 'Unnamed Mission',
            observed: `Step was sent to ${contactName} ${daysSinceSent} days ago with no outcome recorded`,
            whyItMatters: `Without recording the outcome, Barry cannot adapt the next step in the sequence`,
            suggestion: `Record what happened — did they reply, ignore, or respond negatively?`,
            rationale: `Outcome data drives Barry's adaptation logic for the entire remaining sequence`,
            actionType: RECOMMENDATION_ACTIONS.RECORD_OUTCOME,
            actionLabel: 'Record Outcome'
          }));
        }
      }
    }
  } catch (error) {
    console.error('[RecommendationEngine] Stalled engagement alert error:', error);
  }

  return recommendations;
}

// ── Category 2: High-Value Contact Alerts ───────────────

/**
 * Detect high/critical contacts that are not in active campaigns or missions,
 * have been dormant, or were added from Scout with no engagement.
 */
async function deriveHighValueContactAlerts(userId, dismissals) {
  const recommendations = [];

  try {
    // 2a. High/Critical contacts in New or Dormant status (no active mission)
    const highValueQuery = query(
      collection(db, 'users', userId, 'contacts'),
      where('strategic_value', 'in', ['high', 'critical']),
      where('contact_status', 'in', [CONTACT_STATUSES.NEW, CONTACT_STATUSES.DORMANT]),
      limit(QUERY_CAP)
    );

    const highValueSnap = await getDocs(highValueQuery);
    for (const contactDoc of highValueSnap.docs) {
      const contact = { id: contactDoc.id, ...contactDoc.data() };
      const contactName = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown';
      const isCritical = contact.strategic_value === 'critical';
      const status = contact.contact_status || 'New';

      // 2a-i: High/Critical + New = never engaged
      if (status === CONTACT_STATUSES.NEW) {
        const daysSinceAdded = daysSince(contact.addedAt);

        if (daysSinceAdded >= THRESHOLDS.HIGH_VALUE_NO_CAMPAIGN) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.HIGH_VALUE_NO_MISSION, contact.id);
          if (isDismissed(recId, dismissals)) continue;

          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.HIGH_VALUE_NO_MISSION,
            category: 'high_value_contact',
            priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact : PRIORITY_WEIGHTS.stalled_high_value,
            contactId: contact.id,
            contactName,
            observed: `${contactName} is a ${isCritical ? 'Critical' : 'High'}-value contact with no active mission`,
            whyItMatters: isCritical
              ? `Critical contacts represent your most important relationships — leaving them unengaged risks missing high-value opportunities`
              : `High-value contacts added ${daysSinceAdded} days ago should have engagement activity by now`,
            suggestion: `Start a mission or add them to a campaign to begin structured engagement`,
            rationale: `${isCritical ? 'Critical' : 'High'}-value contacts benefit most from Barry's structured sequencing rather than ad-hoc outreach`,
            actionType: RECOMMENDATION_ACTIONS.START_MISSION,
            actionLabel: 'Start Mission'
          }));
        }
      }

      // 2a-ii: High/Critical + Dormant for 30+ days
      if (status === CONTACT_STATUSES.DORMANT) {
        const daysDormant = daysSince(contact.contact_status_updated_at);

        if (daysDormant >= THRESHOLDS.HIGH_VALUE_DORMANT) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.HIGH_VALUE_DORMANT, contact.id);
          if (isDismissed(recId, dismissals)) continue;

          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.HIGH_VALUE_DORMANT,
            category: 'high_value_contact',
            priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact : PRIORITY_WEIGHTS.stalled_high_value,
            contactId: contact.id,
            contactName,
            observed: `${contactName} was marked ${isCritical ? 'Critical' : 'High'}-value but has been Dormant for ${daysDormant} days`,
            whyItMatters: `Dormant ${isCritical ? 'Critical' : 'High'}-value contacts represent unrealized potential — the longer they stay dormant, the harder re-engagement becomes`,
            suggestion: `Re-engage with a value-led message referencing something relevant to their current situation`,
            rationale: `${isCritical ? 'Critical' : 'High'}-value contacts respond better to value-led re-engagement after a gap than direct asks`,
            actionType: RECOMMENDATION_ACTIONS.RE_ENGAGE,
            actionLabel: 'Re-engage Now'
          }));
        }
      }
    }

    // 2b. High-value contacts with no engagement history at all
    // (already covered by 2a when status is New, but also catch Engaged contacts
    //  that were opened but never had a mission)
    const engagedHighQuery = query(
      collection(db, 'users', userId, 'contacts'),
      where('strategic_value', 'in', ['high', 'critical']),
      where('contact_status', '==', CONTACT_STATUSES.ENGAGED),
      limit(QUERY_CAP)
    );

    const engagedHighSnap = await getDocs(engagedHighQuery);
    for (const contactDoc of engagedHighSnap.docs) {
      const contact = { id: contactDoc.id, ...contactDoc.data() };
      const daysSinceEngaged = daysSince(contact.contact_status_updated_at);

      if (daysSinceEngaged >= THRESHOLDS.HIGH_VALUE_NO_CAMPAIGN) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.HIGH_VALUE_NO_ENGAGEMENT, contact.id);
        if (isDismissed(recId, dismissals)) continue;

        const contactName = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown';
        const isCritical = contact.strategic_value === 'critical';

        recommendations.push(buildRecommendation({
          id: recId,
          type: RECOMMENDATION_TYPES.HIGH_VALUE_NO_ENGAGEMENT,
          category: 'high_value_contact',
          priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact : PRIORITY_WEIGHTS.stalled_high_value,
          contactId: contact.id,
          contactName,
          observed: `${contactName} is a ${isCritical ? 'Critical' : 'High'}-value contact who was opened but never sent a message`,
          whyItMatters: `The engagement drawer was opened ${daysSinceEngaged} days ago but no outreach followed`,
          suggestion: `Complete the engagement — add to a mission for structured follow-through`,
          rationale: `Contacts that stall after initial interest lose warmth quickly — structured missions prevent this`,
          actionType: RECOMMENDATION_ACTIONS.ADD_TO_CAMPAIGN,
          actionLabel: 'Add to Campaign'
        }));
      }
    }
  } catch (error) {
    console.error('[RecommendationEngine] High-value contact alert error:', error);
  }

  return recommendations;
}

// ── Category 3: Mission Momentum Recommendations ────────

/**
 * Detect mission patterns that suggest repositioning or acceleration:
 * - Two consecutive no-reply outcomes
 * - Positive reply with no follow-up
 * - Mission deadline approaching with incomplete sequence
 */
async function deriveMissionMomentumRecommendations(userId, dismissals) {
  const recommendations = [];

  try {
    const missionsQuery = query(
      collection(db, 'users', userId, 'missions'),
      where('status', '==', 'autopilot'),
      orderBy('updatedAt', 'asc'),
      limit(QUERY_CAP)
    );

    const missionsSnap = await getDocs(missionsQuery);

    for (const missionDoc of missionsSnap.docs) {
      const mission = { id: missionDoc.id, ...missionDoc.data() };
      const plan = mission.sequence;

      for (const contact of (mission.contacts || [])) {
        if (contact.sequenceStatus === 'completed') continue;

        const history = contact.stepHistory || [];
        const contactName = contact.name || 'a contact';

        // 3a. Two consecutive no-reply outcomes → suggest channel switch
        const lastTwoOutcomes = history
          .filter(h => h.outcome)
          .slice(-2);

        if (lastTwoOutcomes.length >= THRESHOLDS.MOMENTUM_NO_REPLY_CONSECUTIVE &&
            lastTwoOutcomes.every(h => h.outcome === 'no_reply')) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.MOMENTUM_CHANNEL_SWITCH, `${mission.id}_${contact.contactId}`);
          if (!isDismissed(recId, dismissals)) {
            const lastChannel = history[history.length - 1]?.generatedContent?.channel || 'email';

            recommendations.push(buildRecommendation({
              id: recId,
              type: RECOMMENDATION_TYPES.MOMENTUM_CHANNEL_SWITCH,
              category: 'mission_momentum',
              priorityWeight: PRIORITY_WEIGHTS.stalled_high_value,
              contactId: contact.contactId,
              contactName,
              missionId: mission.id,
              missionName: mission.name || 'Unnamed Mission',
              observed: `Two follow-ups to ${contactName} have gone unanswered`,
              whyItMatters: `Repeated no-reply on the same channel suggests the message isn't breaking through`,
              suggestion: `Switch from ${lastChannel} to a direct call or different channel`,
              rationale: `Channel switching after consecutive no-replies increases response rates by changing the pattern`,
              actionType: RECOMMENDATION_ACTIONS.SWITCH_CHANNEL,
              actionLabel: 'Switch Channel'
            }));
          }
        }

        // 3b. Positive reply with no next step approved within threshold
        const lastOutcomeEntry = [...history].reverse().find(h => h.outcome);
        if (lastOutcomeEntry?.outcome === 'replied_positive') {
          const daysSincePositive = daysSince(lastOutcomeEntry.outcomeRecordedAt);

          if (daysSincePositive >= THRESHOLDS.MOMENTUM_POSITIVE_NO_FOLLOWUP &&
              contact.sequenceStatus !== 'completed') {
            const recId = generateRecommendationId(RECOMMENDATION_TYPES.MOMENTUM_ACCELERATE, `${mission.id}_${contact.contactId}`);
            if (!isDismissed(recId, dismissals)) {
              const goalLabel = getLabelById(MISSION_TIMEFRAMES, mission.outcome_goal) || mission.outcome_goal || 'the mission goal';

              recommendations.push(buildRecommendation({
                id: recId,
                type: RECOMMENDATION_TYPES.MOMENTUM_ACCELERATE,
                category: 'mission_momentum',
                priorityWeight: PRIORITY_WEIGHTS.approaching_deadline,
                contactId: contact.contactId,
                contactName,
                missionId: mission.id,
                missionName: mission.name || 'Unnamed Mission',
                observed: `${contactName} replied positively ${daysSincePositive} days ago but no next step has been approved`,
                whyItMatters: `The mission goal is still open — positive momentum fades quickly without follow-through`,
                suggestion: `Accelerate to the next step while the positive energy is fresh`,
                rationale: `Contacts who reply positively are most receptive within 48 hours — every day of delay reduces conversion likelihood`,
                actionType: RECOMMENDATION_ACTIONS.APPROVE_NEXT_STEP,
                actionLabel: 'Approve Next Step'
              }));
            }
          }
        }

        // 3c. Mission deadline approaching with incomplete sequence
        const daysLeft = daysUntilDeadline(mission.createdAt || mission.startedAt, mission.timeframe);
        if (daysLeft !== null && daysLeft <= THRESHOLDS.MOMENTUM_DEADLINE_APPROACHING && daysLeft > 0) {
          const totalSteps = plan?.steps?.length || 0;
          const completedSteps = history.filter(h => h.action === 'sent' || h.action === 'skipped').length;
          const remainingSteps = totalSteps - completedSteps;

          if (remainingSteps > 0) {
            const recId = generateRecommendationId(RECOMMENDATION_TYPES.MOMENTUM_COMPRESS, `${mission.id}_${contact.contactId}`);
            if (!isDismissed(recId, dismissals)) {
              recommendations.push(buildRecommendation({
                id: recId,
                type: RECOMMENDATION_TYPES.MOMENTUM_COMPRESS,
                category: 'mission_momentum',
                priorityWeight: PRIORITY_WEIGHTS.approaching_deadline,
                contactId: contact.contactId,
                contactName,
                missionId: mission.id,
                missionName: mission.name || 'Unnamed Mission',
                observed: `Mission timeframe ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} with ${remainingSteps} step${remainingSteps !== 1 ? 's' : ''} remaining for ${contactName}`,
                whyItMatters: `The ${getLabelById(MISSION_TIMEFRAMES, mission.timeframe) || mission.timeframe} deadline is approaching and the sequence is not complete`,
                suggestion: `Compress the remaining sequence — approve and send the next step now`,
                rationale: `When deadlines approach, compressing the cadence maintains pressure without abandoning the sequence strategy`,
                actionType: RECOMMENDATION_ACTIONS.ACCELERATE_SEQUENCE,
                actionLabel: 'Compress Sequence'
              }));
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[RecommendationEngine] Mission momentum recommendation error:', error);
  }

  return recommendations;
}

// ── Category 4: Strategic Gap Alerts ────────────────────

/**
 * Detect campaign-level neglect patterns:
 * - Retain/Expand campaigns with contacts showing no engagement
 * - High-priority campaign contacts never contacted
 * - Sequences completed with no outcome recorded
 */
async function deriveStrategicGapAlerts(userId, dismissals) {
  const recommendations = [];

  try {
    // Get active campaigns
    const campaignsQuery = query(
      collection(db, 'users', userId, 'campaigns'),
      where('status', '==', 'active'),
      limit(QUERY_CAP)
    );

    const campaignsSnap = await getDocs(campaignsQuery);

    for (const campaignDoc of campaignsSnap.docs) {
      const campaign = { id: campaignDoc.id, ...campaignDoc.data() };
      const campaignName = campaign.name || 'Unnamed Campaign';

      // Get missions in this campaign
      const missionIds = campaign.missions || [];
      if (missionIds.length === 0) continue;

      // Load missions for this campaign
      const campaignMissions = [];
      for (const mId of missionIds.slice(0, 20)) {
        try {
          const mSnap = await getDoc(doc(db, 'users', userId, 'missions', mId));
          if (mSnap.exists()) {
            campaignMissions.push({ id: mSnap.id, ...mSnap.data() });
          }
        } catch (e) {
          // Skip individual mission load failures
        }
      }

      // Collect all contacts across this campaign's missions
      const campaignContacts = [];
      for (const mission of campaignMissions) {
        for (const mc of (mission.contacts || [])) {
          campaignContacts.push({
            ...mc,
            missionId: mission.id,
            missionName: mission.name
          });
        }
      }

      // 4a. Retain/Expand campaigns with contacts showing no engagement in 30 days
      if (['retain', 'expand'].includes(campaign.objective_type)) {
        const neglectedContacts = campaignContacts.filter(c => {
          const lastTouch = c.lastTouchDate || c.stepHistory?.[c.stepHistory.length - 1]?.sentAt;
          return daysSince(lastTouch) >= THRESHOLDS.STRATEGIC_GAP_NO_ENGAGEMENT;
        });

        if (neglectedContacts.length > 0) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.STRATEGIC_GAP_NO_ENGAGEMENT, campaign.id);
          if (!isDismissed(recId, dismissals)) {
            const objectiveLabel = getLabelById(OBJECTIVE_TYPES, campaign.objective_type) || campaign.objective_type;

            recommendations.push(buildRecommendation({
              id: recId,
              type: RECOMMENDATION_TYPES.STRATEGIC_GAP_NO_ENGAGEMENT,
              category: 'strategic_gap',
              priorityWeight: PRIORITY_WEIGHTS.general_gap,
              campaignId: campaign.id,
              campaignName,
              observed: `Your ${objectiveLabel} campaign "${campaignName}" has ${neglectedContacts.length} contact${neglectedContacts.length > 1 ? 's' : ''} with no engagement this month`,
              whyItMatters: `${objectiveLabel} campaigns require consistent touch — gaps in engagement undermine the campaign objective`,
              suggestion: `Review the campaign and re-engage neglected contacts`,
              rationale: `${objectiveLabel} relationships degrade without regular attention — proactive engagement prevents silent churn`,
              actionType: RECOMMENDATION_ACTIONS.RE_ENGAGE,
              actionLabel: 'Review Campaign'
            }));
          }
        }
      }

      // 4b. High-priority campaign contacts never contacted
      if (campaign.strategic_priority === 'high' || campaign.strategic_priority === 'critical') {
        const neverContacted = campaignContacts.filter(c => {
          const history = c.stepHistory || [];
          return history.length === 0 && !c.lastTouchDate;
        });

        if (neverContacted.length > 0) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.STRATEGIC_GAP_NEVER_CONTACTED, campaign.id);
          if (!isDismissed(recId, dismissals)) {
            recommendations.push(buildRecommendation({
              id: recId,
              type: RECOMMENDATION_TYPES.STRATEGIC_GAP_NEVER_CONTACTED,
              category: 'strategic_gap',
              priorityWeight: campaign.strategic_priority === 'critical'
                ? PRIORITY_WEIGHTS.critical_contact
                : PRIORITY_WEIGHTS.stalled_high_value,
              campaignId: campaign.id,
              campaignName,
              observed: `Your ${campaign.strategic_priority}-priority campaign "${campaignName}" has ${neverContacted.length} contact${neverContacted.length > 1 ? 's' : ''} who have never been contacted`,
              whyItMatters: `These contacts were added to a ${campaign.strategic_priority}-priority campaign but have received zero outreach`,
              suggestion: `Start sequences for uncontacted contacts to activate the campaign`,
              rationale: `Campaign contacts that never receive outreach represent planning without execution — the gap grows more costly every day`,
              actionType: RECOMMENDATION_ACTIONS.APPROVE_NEXT_STEP,
              actionLabel: 'Activate Contacts'
            }));
          }
        }
      }

      // 4c. Sequences completed with no outcome recorded
      const noOutcomeCompleted = campaignContacts.filter(c => {
        if (c.sequenceStatus !== 'completed') return false;
        const history = c.stepHistory || [];
        const sentSteps = history.filter(h => h.action === 'sent');
        return sentSteps.length > 0 && sentSteps.every(h => !h.outcome);
      });

      if (noOutcomeCompleted.length > 0) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.STRATEGIC_GAP_NO_OUTCOME, campaign.id);
        if (!isDismissed(recId, dismissals)) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.STRATEGIC_GAP_NO_OUTCOME,
            category: 'strategic_gap',
            priorityWeight: PRIORITY_WEIGHTS.general_gap,
            campaignId: campaign.id,
            campaignName,
            observed: `${noOutcomeCompleted.length} contact${noOutcomeCompleted.length > 1 ? 's' : ''} in campaign "${campaignName}" completed their sequences with no outcome recorded`,
            whyItMatters: `Without outcome data, Barry cannot evaluate campaign effectiveness or adapt future strategy`,
            suggestion: `Record outcomes for completed sequences so Barry can learn from the results`,
            rationale: `Outcome recording closes the feedback loop — it is the data Barry uses to improve future sequences`,
            actionType: RECOMMENDATION_ACTIONS.RECORD_OUTCOME,
            actionLabel: 'Record Outcomes'
          }));
        }
      }
    }
  } catch (error) {
    console.error('[RecommendationEngine] Strategic gap alert error:', error);
  }

  return recommendations;
}

// ── Main Entry Points ───────────────────────────────────

/**
 * Load user's recommendation dismissals within the suppression window.
 * Filters to only the last DISMISSAL_SUPPRESSION days to avoid unbounded reads.
 */
async function loadDismissals(userId) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - THRESHOLDS.DISMISSAL_SUPPRESSION);
    const cutoffStr = cutoff.toISOString();

    const dismissalsSnap = await getDocs(
      query(
        collection(db, 'users', userId, 'recommendation_dismissals'),
        where('dismissedAt', '>=', cutoffStr)
      )
    );
    return dismissalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[RecommendationEngine] Failed to load dismissals:', error);
    return [];
  }
}

/**
 * Generate all recommendations for the dashboard.
 * Returns the top 5 prioritized recommendations across all categories.
 */
export async function generateDashboardRecommendations(userId) {
  try {
    const dismissals = await loadDismissals(userId);

    // Run all four category derivations in parallel
    const [stalled, highValue, momentum, gaps] = await Promise.all([
      deriveStalledEngagementAlerts(userId, dismissals),
      deriveHighValueContactAlerts(userId, dismissals),
      deriveMissionMomentumRecommendations(userId, dismissals),
      deriveStrategicGapAlerts(userId, dismissals)
    ]);

    // Combine and sort by priority weight (lower = higher priority)
    const all = [...stalled, ...highValue, ...momentum, ...gaps];
    all.sort((a, b) => {
      if (a.priorityWeight !== b.priorityWeight) {
        return a.priorityWeight - b.priorityWeight;
      }
      // Within same priority, sort by creation time (doesn't matter much, just consistent)
      return 0;
    });

    // Return top 5
    return all.slice(0, DASHBOARD_MAX_RECOMMENDATIONS);
  } catch (error) {
    console.error('[RecommendationEngine] Failed to generate dashboard recommendations:', error);
    return [];
  }
}

/**
 * Generate recommendations for a specific contact.
 * Used in Contact Profile and HunterContactDrawer.
 * Returns all active recommendations for this contact (typically 1-2).
 */
export async function generateContactRecommendations(userId, contactId) {
  try {
    const dismissals = await loadDismissals(userId);

    // Load contact
    const contactSnap = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
    if (!contactSnap.exists()) return [];
    const contact = { id: contactSnap.id, ...contactSnap.data() };
    const contactName = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown';
    const isCritical = contact.strategic_value === 'critical';
    const isHighValue = contact.strategic_value === 'high' || isCritical;

    const recommendations = [];

    // Check stalled engagement for this contact
    if (contact.contact_status === CONTACT_STATUSES.AWAITING_REPLY) {
      const days = daysSince(contact.contact_status_updated_at);
      if (days >= THRESHOLDS.STALLED_AWAITING_REPLY) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.STALLED_AWAITING_REPLY, contact.id);
        if (!isDismissed(recId, dismissals)) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.STALLED_AWAITING_REPLY,
            category: 'stalled_engagement',
            priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact : PRIORITY_WEIGHTS.stalled_high_value,
            contactId: contact.id,
            contactName,
            observed: `No engagement with ${contactName} in ${days} days`,
            whyItMatters: `This contact has been in Awaiting Reply for ${days} days with no follow-up`,
            suggestion: `Re-engage with a value-led follow-up`,
            rationale: `Contacts in Awaiting Reply respond better to follow-ups that add new value rather than simply checking in`,
            actionType: RECOMMENDATION_ACTIONS.RE_ENGAGE,
            actionLabel: 'Re-engage Now'
          }));
        }
      }
    }

    // Check high-value + neglected
    if (isHighValue && [CONTACT_STATUSES.NEW, CONTACT_STATUSES.DORMANT, CONTACT_STATUSES.ENGAGED].includes(contact.contact_status)) {
      const daysSinceUpdate = daysSince(contact.contact_status_updated_at || contact.addedAt);
      const threshold = contact.contact_status === CONTACT_STATUSES.DORMANT
        ? THRESHOLDS.HIGH_VALUE_DORMANT
        : THRESHOLDS.HIGH_VALUE_NO_CAMPAIGN;

      if (daysSinceUpdate >= threshold) {
        const recId = generateRecommendationId(
          contact.contact_status === CONTACT_STATUSES.DORMANT
            ? RECOMMENDATION_TYPES.HIGH_VALUE_DORMANT
            : RECOMMENDATION_TYPES.HIGH_VALUE_NO_MISSION,
          contact.id
        );
        if (!isDismissed(recId, dismissals)) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: contact.contact_status === CONTACT_STATUSES.DORMANT
              ? RECOMMENDATION_TYPES.HIGH_VALUE_DORMANT
              : RECOMMENDATION_TYPES.HIGH_VALUE_NO_MISSION,
            category: 'high_value_contact',
            priorityWeight: isCritical ? PRIORITY_WEIGHTS.critical_contact : PRIORITY_WEIGHTS.stalled_high_value,
            contactId: contact.id,
            contactName,
            observed: contact.contact_status === CONTACT_STATUSES.DORMANT
              ? `${contactName} has been Dormant for ${daysSinceUpdate} days`
              : `${contactName} has no active mission or campaign`,
            whyItMatters: `They are a ${isCritical ? 'Critical' : 'High'}-value contact who needs structured engagement`,
            suggestion: contact.contact_status === CONTACT_STATUSES.DORMANT
              ? `Re-engage with a value-led message`
              : `Start a mission to begin structured outreach`,
            rationale: `${isCritical ? 'Critical' : 'High'}-value contacts benefit most from Barry's structured approach`,
            actionType: contact.contact_status === CONTACT_STATUSES.DORMANT
              ? RECOMMENDATION_ACTIONS.RE_ENGAGE
              : RECOMMENDATION_ACTIONS.START_MISSION,
            actionLabel: contact.contact_status === CONTACT_STATUSES.DORMANT ? 'Re-engage Now' : 'Start Mission'
          }));
        }
      }
    }

    // Check mission-level recommendations for this contact
    const missionsQuery = query(
      collection(db, 'users', userId, 'missions'),
      where('status', '==', 'autopilot'),
      limit(QUERY_CAP)
    );
    const missionsSnap = await getDocs(missionsQuery);

    for (const missionDoc of missionsSnap.docs) {
      const mission = { id: missionDoc.id, ...missionDoc.data() };
      const missionContact = (mission.contacts || []).find(c => c.contactId === contactId);
      if (!missionContact || missionContact.sequenceStatus === 'completed') continue;

      const history = missionContact.stepHistory || [];

      // Outcome not recorded
      const lastSentStep = [...history].reverse().find(h => h.action === 'sent' && !h.outcome);
      if (lastSentStep && daysSince(lastSentStep.sentAt) >= THRESHOLDS.STALLED_OUTCOME_RECORDING) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.STALLED_OUTCOME_NOT_RECORDED, `${mission.id}_${contactId}`);
        if (!isDismissed(recId, dismissals)) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.STALLED_OUTCOME_NOT_RECORDED,
            category: 'stalled_engagement',
            priorityWeight: PRIORITY_WEIGHTS.general_gap,
            contactId,
            contactName,
            missionId: mission.id,
            missionName: mission.name,
            observed: `Step sent ${daysSince(lastSentStep.sentAt)} days ago with no outcome recorded`,
            whyItMatters: `Barry needs outcome data to adapt the next step in the sequence`,
            suggestion: `Record what happened after the last step`,
            rationale: `Outcome data drives Barry's adaptation logic for the entire remaining sequence`,
            actionType: RECOMMENDATION_ACTIONS.RECORD_OUTCOME,
            actionLabel: 'Record Outcome'
          }));
        }
      }

      // Consecutive no-reply → channel switch
      const lastTwoOutcomes = history.filter(h => h.outcome).slice(-2);
      if (lastTwoOutcomes.length >= 2 && lastTwoOutcomes.every(h => h.outcome === 'no_reply')) {
        const recId = generateRecommendationId(RECOMMENDATION_TYPES.MOMENTUM_CHANNEL_SWITCH, `${mission.id}_${contactId}`);
        if (!isDismissed(recId, dismissals)) {
          recommendations.push(buildRecommendation({
            id: recId,
            type: RECOMMENDATION_TYPES.MOMENTUM_CHANNEL_SWITCH,
            category: 'mission_momentum',
            priorityWeight: PRIORITY_WEIGHTS.stalled_high_value,
            contactId,
            contactName,
            missionId: mission.id,
            missionName: mission.name,
            observed: `Two follow-ups have gone unanswered`,
            whyItMatters: `Repeated no-reply on the same channel suggests the message isn't breaking through`,
            suggestion: `Try a different channel — a direct call or LinkedIn message may work better`,
            rationale: `Channel switching after consecutive no-replies increases response rates`,
            actionType: RECOMMENDATION_ACTIONS.SWITCH_CHANNEL,
            actionLabel: 'Switch Channel'
          }));
        }
      }

      // Deadline approaching
      const daysLeft = daysUntilDeadline(mission.createdAt || mission.startedAt, mission.timeframe);
      if (daysLeft !== null && daysLeft <= THRESHOLDS.MOMENTUM_DEADLINE_APPROACHING && daysLeft > 0) {
        const totalSteps = mission.sequence?.steps?.length || 0;
        const completedSteps = history.filter(h => h.action === 'sent' || h.action === 'skipped').length;
        const remaining = totalSteps - completedSteps;

        if (remaining > 0) {
          const recId = generateRecommendationId(RECOMMENDATION_TYPES.MOMENTUM_COMPRESS, `${mission.id}_${contactId}`);
          if (!isDismissed(recId, dismissals)) {
            recommendations.push(buildRecommendation({
              id: recId,
              type: RECOMMENDATION_TYPES.MOMENTUM_COMPRESS,
              category: 'mission_momentum',
              priorityWeight: PRIORITY_WEIGHTS.approaching_deadline,
              contactId,
              contactName,
              missionId: mission.id,
              missionName: mission.name,
              observed: `Mission deadline in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} with ${remaining} step${remaining !== 1 ? 's' : ''} remaining`,
              whyItMatters: `The mission timeframe is closing and the sequence is not complete`,
              suggestion: `Compress the remaining sequence — approve and send the next step now`,
              rationale: `Compressing cadence near deadlines maintains pressure without abandoning strategy`,
              actionType: RECOMMENDATION_ACTIONS.ACCELERATE_SEQUENCE,
              actionLabel: 'Compress Sequence'
            }));
          }
        }
      }
    }

    // Sort by priority
    recommendations.sort((a, b) => a.priorityWeight - b.priorityWeight);

    return recommendations;
  } catch (error) {
    console.error('[RecommendationEngine] Failed to generate contact recommendations:', error);
    return [];
  }
}

/**
 * Dismiss a recommendation with a reason.
 * Stores the dismissal in Firestore for 7-day suppression.
 */
export async function dismissRecommendation(userId, recommendationId, reason) {
  try {
    await addDoc(collection(db, 'users', userId, 'recommendation_dismissals'), {
      recommendationId,
      reason,
      dismissedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('[RecommendationEngine] Failed to dismiss recommendation:', error);
    return false;
  }
}

// ── Exports ─────────────────────────────────────────────

export {
  THRESHOLDS,
  DASHBOARD_MAX_RECOMMENDATIONS,
  PRIORITY_WEIGHTS
};
