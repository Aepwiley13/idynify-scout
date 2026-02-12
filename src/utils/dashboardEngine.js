/**
 * DASHBOARD ENGINE (Step 6)
 *
 * Computes derived display states for the Campaign Dashboard.
 * All health signals, overdue detection, and status grouping are
 * computed at read time from existing mission/contact data.
 *
 * No new Firestore writes. No persistent status fields.
 *
 * Key decisions:
 *   - "Stalled" is derived (7+ days no engagement), not a stored status
 *   - Overdue threshold derived from step suggestedTiming, fallback 3 days
 *   - Mission deadline alerts from mission timeframe field
 *   - Contact names read from denormalized mission.contacts[].name
 */

// ── Constants ───────────────────────────────────────────

const STALLED_THRESHOLD_DAYS = 7;
const DEFAULT_OVERDUE_DAYS = 3;

// Timeframe → deadline in days from mission creation
const TIMEFRAME_DEADLINE_DAYS = {
  this_week: 7,
  this_month: 30,
  this_quarter: 90,
  no_deadline: null
};

// ── Date Helpers ────────────────────────────────────────

function daysSince(dateString) {
  if (!dateString) return Infinity;
  const then = new Date(dateString);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function isToday(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isPast(dateString) {
  if (!dateString) return false;
  return new Date(dateString) < new Date();
}

/**
 * Parse suggestedTiming like "Day 3", "Day 7", "Day 1" into number of days.
 * Falls back to DEFAULT_OVERDUE_DAYS if unparseable.
 */
function parseTimingDays(suggestedTiming) {
  if (!suggestedTiming) return DEFAULT_OVERDUE_DAYS;
  const match = suggestedTiming.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : DEFAULT_OVERDUE_DAYS;
}

// ── Health Signal Computation ───────────────────────────

/**
 * Compute the health signal for a mission.
 * Returns: 'on_track' | 'needs_attention' | 'stalled'
 *
 * Logic:
 *   on_track     — missions progressing, no overdue steps
 *   needs_attention — one or more contacts stalled or overdue
 *   stalled      — no engagement activity in 7+ days across all contacts
 */
export function computeMissionHealth(mission) {
  const contacts = mission.contacts || [];
  if (contacts.length === 0) return 'on_track';

  // Find most recent engagement date across all contacts
  let mostRecentActivity = null;

  for (const contact of contacts) {
    const dates = [contact.lastTouchDate];

    // Check stepHistory for most recent activity
    if (contact.stepHistory) {
      for (const entry of contact.stepHistory) {
        if (entry.sentAt) dates.push(entry.sentAt);
        if (entry.outcomeRecordedAt) dates.push(entry.outcomeRecordedAt);
        if (entry.approvedAt) dates.push(entry.approvedAt);
      }
    }

    for (const d of dates) {
      if (d && (!mostRecentActivity || new Date(d) > new Date(mostRecentActivity))) {
        mostRecentActivity = d;
      }
    }
  }

  // Stalled: no activity in 7+ days
  if (daysSince(mostRecentActivity) >= STALLED_THRESHOLD_DAYS) {
    return 'stalled';
  }

  // Check if any contact needs attention (overdue steps)
  const hasOverdue = contacts.some(contact => {
    return isContactOverdue(contact, mission);
  });

  if (hasOverdue) return 'needs_attention';

  return 'on_track';
}

/**
 * Check if a contact within a mission is overdue on a sent step.
 * Overdue = step was sent, no outcome recorded, and time since send
 * exceeds the step's suggestedTiming (or 3-day default).
 */
export function isContactOverdue(contact, mission) {
  if (!contact.stepHistory || contact.stepHistory.length === 0) return false;

  const lastEntry = contact.stepHistory[contact.stepHistory.length - 1];

  // Only check sent steps without outcomes
  if (lastEntry.action !== 'sent' || lastEntry.outcome) return false;

  const sentAt = lastEntry.sentAt;
  if (!sentAt) return false;

  // Get the expected timing for this step from the sequence plan
  const plan = mission.sequence;
  const step = plan?.steps?.[lastEntry.stepIndex];
  const expectedDays = parseTimingDays(step?.suggestedTiming || step?.timing);

  return daysSince(sentAt) > expectedDays;
}

/**
 * Check if a mission is approaching its timeframe deadline.
 * Returns true if mission is within 20% of its deadline with incomplete sequences.
 */
export function isMissionApproachingDeadline(mission) {
  const deadlineDays = TIMEFRAME_DEADLINE_DAYS[mission.timeframe];
  if (!deadlineDays) return false; // no_deadline

  const elapsed = daysSince(mission.createdAt);
  const remaining = deadlineDays - elapsed;
  const threshold = deadlineDays * 0.2; // 20% of total timeframe

  if (remaining > threshold) return false;

  // Check if there are incomplete sequences
  const contacts = mission.contacts || [];
  const hasIncomplete = contacts.some(c =>
    c.sequenceStatus !== 'completed' && c.status !== 'completed'
  );

  return hasIncomplete;
}

// ── Needs Attention Items ───────────────────────────────

/**
 * Surface all items that need user attention from a list of missions.
 * Returns a flat array of action items sorted by urgency.
 *
 * Types:
 *   - step_ready: Sequence step ready for approval
 *   - outcome_needed: Step sent, outcome not recorded
 *   - overdue_reply: Contact awaiting reply beyond expected time
 *   - deadline_approaching: Mission approaching timeframe deadline
 */
export function getNeedsAttentionItems(missions) {
  const items = [];

  for (const mission of missions) {
    if (mission.status === 'completed') continue;

    const contacts = mission.contacts || [];
    const plan = mission.sequence;

    for (const contact of contacts) {
      if (contact.sequenceStatus === 'completed') continue;

      const history = contact.stepHistory || [];
      const lastEntry = history.length > 0 ? history[history.length - 1] : null;

      // Step ready for approval: active status, last entry is not 'sent'
      // (either no history, or last action was outcome-recorded/skipped meaning next step is ready)
      if (contact.sequenceStatus === 'active' || contact.sequenceStatus === 'pending') {
        const needsProposal = !lastEntry ||
          (lastEntry.action !== 'sent' && lastEntry.action !== 'approved') ||
          (lastEntry.action === 'approved' && !lastEntry.sentAt); // approved but not sent

        if (needsProposal && plan?.steps?.[contact.currentStepIndex ?? 0]) {
          const stepIndex = contact.currentStepIndex ?? 0;
          const step = plan.steps[stepIndex];

          items.push({
            type: 'step_ready',
            urgency: 2,
            missionId: mission.id,
            missionName: mission.name,
            contactId: contact.contactId,
            contactName: contact.name || 'Unknown',
            stepIndex,
            stepType: step.stepType || step.action,
            channel: step.channel,
            message: `Step ${stepIndex + 1} ready for approval`
          });
        }
      }

      // Outcome needed: step sent, no outcome recorded
      if (lastEntry && lastEntry.action === 'sent' && !lastEntry.outcome) {
        const isOverdue = isContactOverdue(contact, mission);

        items.push({
          type: isOverdue ? 'overdue_reply' : 'outcome_needed',
          urgency: isOverdue ? 3 : 1,
          missionId: mission.id,
          missionName: mission.name,
          contactId: contact.contactId,
          contactName: contact.name || 'Unknown',
          stepIndex: lastEntry.stepIndex,
          sentAt: lastEntry.sentAt,
          daysSinceSent: daysSince(lastEntry.sentAt),
          message: isOverdue
            ? `Awaiting reply — ${daysSince(lastEntry.sentAt)} days since sent`
            : `Record outcome for Step ${lastEntry.stepIndex + 1}`
        });
      }
    }

    // Mission deadline approaching
    if (isMissionApproachingDeadline(mission)) {
      items.push({
        type: 'deadline_approaching',
        urgency: 2,
        missionId: mission.id,
        missionName: mission.name,
        contactId: null,
        contactName: null,
        timeframe: mission.timeframe,
        message: `Mission deadline approaching (${mission.timeframe?.replace('_', ' ')})`
      });
    }
  }

  // Sort by urgency (higher = more urgent), then by type
  items.sort((a, b) => b.urgency - a.urgency);

  return items;
}

// ── Mission Status Grouping ─────────────────────────────

/**
 * Group mission contacts by their operational status for the Mission Status View.
 * Returns contacts grouped across all missions.
 *
 * Groups:
 *   active_mission   — sequence in progress (sequenceStatus === 'active')
 *   awaiting_reply   — step sent, outcome not yet recorded
 *   in_conversation  — positive reply received (contact_status or outcome)
 *   stalled          — no activity beyond threshold
 *   mission_complete — sequence completed
 */
export function groupContactsByStatus(missions) {
  const groups = {
    active_mission: [],
    awaiting_reply: [],
    in_conversation: [],
    stalled: [],
    mission_complete: []
  };

  for (const mission of missions) {
    const contacts = mission.contacts || [];

    for (const contact of contacts) {
      const entry = {
        contactId: contact.contactId,
        contactName: contact.name || 'Unknown',
        missionId: mission.id,
        missionName: mission.name,
        outcomeGoal: mission.outcome_goal,
        sequenceStatus: contact.sequenceStatus,
        lastOutcome: contact.lastOutcome,
        lastTouchDate: contact.lastTouchDate
      };

      // Completed
      if (contact.sequenceStatus === 'completed' || contact.status === 'completed') {
        groups.mission_complete.push(entry);
        continue;
      }

      // In conversation (positive reply)
      if (contact.lastOutcome === 'replied_positive') {
        groups.in_conversation.push(entry);
        continue;
      }

      // Stalled check
      const activityDates = [contact.lastTouchDate];
      if (contact.stepHistory) {
        for (const h of contact.stepHistory) {
          if (h.sentAt) activityDates.push(h.sentAt);
          if (h.outcomeRecordedAt) activityDates.push(h.outcomeRecordedAt);
        }
      }
      const mostRecent = activityDates
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0];

      if (daysSince(mostRecent) >= STALLED_THRESHOLD_DAYS) {
        groups.stalled.push(entry);
        continue;
      }

      // Awaiting reply
      const lastHistoryEntry = contact.stepHistory?.length > 0
        ? contact.stepHistory[contact.stepHistory.length - 1]
        : null;

      if (lastHistoryEntry?.action === 'sent' && !lastHistoryEntry?.outcome) {
        groups.awaiting_reply.push(entry);
        continue;
      }

      // Default: active mission
      groups.active_mission.push(entry);
    }
  }

  return groups;
}

// ── Campaign Health ─────────────────────────────────────

/**
 * Compute health for a campaign by aggregating mission health signals.
 * A campaign contains missions; its health is the worst signal among its missions.
 */
export function computeCampaignHealth(campaign, missions) {
  // Find missions associated with this campaign
  const campaignMissions = missions.filter(m => m.campaignId === campaign.id);

  if (campaignMissions.length === 0) {
    // Check if campaign has direct contacts (old model)
    const contacts = campaign.contacts || campaign.messages || [];
    if (contacts.length === 0) return 'on_track';

    // For old campaigns without missions, check last activity
    return 'on_track';
  }

  const healthSignals = campaignMissions.map(m => computeMissionHealth(m));

  if (healthSignals.includes('stalled')) return 'stalled';
  if (healthSignals.includes('needs_attention')) return 'needs_attention';
  return 'on_track';
}

/**
 * Build campaign summary cards with aggregated stats.
 */
export function buildCampaignSummaries(campaigns, missions) {
  return campaigns.map(campaign => {
    const campaignMissions = missions.filter(m => m.campaignId === campaign.id);
    const totalContacts = campaignMissions.reduce(
      (sum, m) => sum + (m.contacts?.length || 0), 0
    );
    const activeMissions = campaignMissions.filter(
      m => m.status !== 'completed'
    ).length;
    const completedMissions = campaignMissions.filter(
      m => m.status === 'completed'
    ).length;

    return {
      id: campaign.id,
      name: campaign.name,
      objective_type: campaign.objective_type,
      strategic_priority: campaign.strategic_priority,
      totalContacts: totalContacts || (campaign.contacts?.length || campaign.messages?.length || 0),
      activeMissions,
      completedMissions,
      totalMissions: campaignMissions.length,
      health: computeCampaignHealth(campaign, missions),
      createdAt: campaign.createdAt
    };
  });
}

// ── Recently Completed ──────────────────────────────────

/**
 * Get recently completed missions (last 30 days).
 * Returns contacts whose sequences completed within the window.
 */
export function getRecentlyCompleted(missions, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const completed = [];

  for (const mission of missions) {
    const contacts = mission.contacts || [];

    for (const contact of contacts) {
      if (contact.sequenceStatus !== 'completed' && contact.status !== 'completed') continue;

      // Find completion date from stepHistory
      const history = contact.stepHistory || [];
      const lastEntry = history.length > 0 ? history[history.length - 1] : null;
      const completionDate = lastEntry?.outcomeRecordedAt || lastEntry?.sentAt || mission.updatedAt;

      if (completionDate && new Date(completionDate) >= cutoff) {
        completed.push({
          contactId: contact.contactId,
          contactName: contact.name || 'Unknown',
          missionId: mission.id,
          missionName: mission.name,
          outcomeGoal: mission.outcome_goal,
          campaignId: mission.campaignId || null,
          completionDate
        });
      }
    }
  }

  // Sort by completion date, most recent first
  completed.sort((a, b) => new Date(b.completionDate) - new Date(a.completionDate));

  return completed;
}

// ── Export Constants ─────────────────────────────────────

export const HEALTH_SIGNALS = {
  ON_TRACK: 'on_track',
  NEEDS_ATTENTION: 'needs_attention',
  STALLED: 'stalled'
};

export const HEALTH_LABELS = {
  on_track: 'On Track',
  needs_attention: 'Needs Attention',
  stalled: 'Stalled'
};

export const HEALTH_COLORS = {
  on_track: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', text: '#10b981' },
  needs_attention: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', text: '#f59e0b' },
  stalled: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#ef4444' }
};

export const ATTENTION_TYPE_LABELS = {
  step_ready: 'Approve Step',
  outcome_needed: 'Record Outcome',
  overdue_reply: 'Overdue',
  deadline_approaching: 'Deadline'
};

export const ATTENTION_TYPE_COLORS = {
  step_ready: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
  outcome_needed: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
  overdue_reply: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  deadline_approaching: { bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' }
};
