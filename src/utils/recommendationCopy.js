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
      return contactName ? `Follow up with ${contactName}` : 'Complete overdue step';

    case 'stalled_awaiting_reply':
      return contactName ? `Follow up with ${contactName}` : 'Follow up on stalled conversation';

    case 'stalled_mission_inactive':
      return missionName ? `Review stalled mission with ${missionName}` : 'Review stalled mission';

    case 'stalled_outcome_not_recorded':
      return contactName ? `Record outcome for ${contactName}` : 'Record missing outcome';

    case 'high_value_no_mission':
      return contactName ? `Start a mission with ${contactName}` : 'Start mission for key contact';

    case 'high_value_no_engagement':
      return contactName ? `Engage ${contactName}` : 'Engage key contact';

    case 'high_value_dormant':
      return contactName ? `Re-engage ${contactName}` : 'Re-engage dormant contact';

    case 'momentum_channel_switch':
      return contactName ? `Try a new channel with ${contactName}` : 'Switch communication channel';

    case 'momentum_accelerate':
      return contactName ? `Follow up with ${contactName}` : 'Accelerate mission momentum';

    case 'momentum_compress':
      return contactName ? `Compress sequence for ${contactName}` : 'Compress mission sequence';

    case 'strategic_gap_no_engagement':
      return campaignName ? `Re-engage contacts in ${campaignName}` : 'Re-engage campaign contacts';

    case 'strategic_gap_never_contacted':
      return campaignName ? `Activate contacts in ${campaignName}` : 'Activate uncontacted members';

    case 'strategic_gap_no_outcome':
      return campaignName ? `Record outcomes for ${campaignName}` : 'Record campaign outcomes';

    default: {
      const actionLabel = rec.action?.label || 'View';
      const entityName = contactName || missionName || campaignName;
      const reason = rec.reasoning?.observed || rec.reasoning?.whyItMatters || '';
      if (entityName) return `${actionLabel} — ${entityName}`;
      return reason || actionLabel;
    }
  }
}
