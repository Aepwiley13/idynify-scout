/**
 * Recommendation copy — Sprint 2B presentation layer for recommendation titles.
 *
 * Single source of truth for how recommendation titles are rendered.
 * Receives raw engine recommendation objects (pre-normalization).
 */

export function formatRecommendationTitle(rec) {
  const type = rec.type;
  const contactName = rec.contactName || null;
  const missionName = rec.missionName || null;
  const campaignName = rec.campaignName || null;

  switch (type) {
    case 'next_step_overdue':
      return contactName ? `Complete the next step with ${contactName}` : 'Complete overdue step';

    case 'stalled_awaiting_reply':
      return contactName ? `Follow up with ${contactName}` : 'Follow up on stalled conversation';

    case 'stalled_mission_inactive':
      return missionName ? `Resume mission with ${missionName}` : 'Resume stalled mission';

    case 'stalled_outcome_not_recorded':
      return contactName ? `Record the outcome with ${contactName}` : 'Record missing outcome';

    case 'high_value_no_mission':
      return contactName ? `Start a mission with ${contactName}` : 'Start mission for key contact';

    case 'high_value_no_engagement':
      return contactName ? `Engage ${contactName}` : 'Engage key contact';

    case 'high_value_dormant':
      return contactName ? `Re-engage ${contactName}` : 'Re-engage dormant contact';

    case 'momentum_channel_switch':
      return contactName ? `Try another channel with ${contactName}` : 'Switch communication channel';

    case 'momentum_accelerate':
      return contactName ? `Accelerate outreach with ${contactName}` : 'Accelerate mission momentum';

    case 'momentum_compress':
      return contactName ? `Close the loop with ${contactName}` : 'Close the loop';

    case 'strategic_gap_no_engagement':
      return campaignName ? `Begin outreach with ${campaignName}` : 'Begin campaign outreach';

    case 'strategic_gap_never_contacted':
      return campaignName ? `Start a conversation with ${campaignName}` : 'Start campaign conversations';

    case 'strategic_gap_no_outcome':
      return campaignName ? `Record an outcome for ${campaignName}` : 'Record campaign outcomes';

    default: {
      const actionLabel = rec.action?.label || 'View';
      const entityName = contactName || missionName || campaignName;
      const reason = rec.reasoning?.observed || rec.reasoning?.whyItMatters || '';
      if (entityName) return `${actionLabel} — ${entityName}`;
      return reason || actionLabel;
    }
  }
}
