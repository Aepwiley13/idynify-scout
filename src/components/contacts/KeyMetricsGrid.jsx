/**
 * KEY METRICS GRID
 *
 * 2×2 grid showing four relationship health metrics:
 *   Touchpoints      |  Referrals Out
 *   Replies Received |  Days in Stage
 *
 * Data sourced from contact.engagement_summary and referral analytics.
 *
 * "Replies Received" is a plain count (getReplyCount), not a rate or
 * ratio. This card is per contact, and reply_count has no pairing to
 * which specific outbound message each reply answered — the data model
 * cannot support a "fraction of my messages that got a reply" (as a
 * capped percentage implied) or a meaningful per-send ratio (which still
 * invites reading "2.0x" as some kind of responsiveness score a single
 * contact's count doesn't actually represent). A count is the one claim
 * this data straightforwardly supports. Reply-to-send ratios belong at
 * the campaign/cadence level (aggregate analytics), not here.
 */

import { useT } from '../../theme/ThemeContext';
import { getReplyCount } from '../../utils/relationshipRead.js';

function MetricCell({ label, value, subtext }) {
  const T = useT();
  return (
    <div style={{
      padding: '12px 14px',
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      {subtext && (
        <span style={{ fontSize: 9, color: T.textFaint }}>{subtext}</span>
      )}
    </div>
  );
}

export default function KeyMetricsGrid({ contact, referralData }) {
  const touchpoints = contact?.engagement_summary?.total_messages_sent || 0;
  // See the file header for why this is a plain count, not a rate/ratio.
  const repliesReceived = getReplyCount(contact);
  const referralsOut = referralData?.referrals_sent_to_you || 0;

  // Days in current stage — derived from stage-specific move timestamps.
  // stage_entered_at (added Sprint 2) is authoritative for future transitions;
  // stage-specific timestamps (hunter_moved_at, etc.) cover existing contacts.
  function getStageEnteredAt(c) {
    if (c?.stage_entered_at) return c.stage_entered_at;
    const map = {
      scout:          c?.scout_reactivated_at  || c?.created_at,
      hunter:         c?.hunter_moved_at,
      sniper:         c?.sniper_moved_at,
      basecamp:       c?.basecamp_moved_at,
      reinforcements: c?.reinforcements_activated_at,
    };
    return map[c?.stage] || null;
  }
  let daysInStage = '—';
  const stageEnteredAt = getStageEnteredAt(contact);
  if (stageEnteredAt) {
    const days = Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 86_400_000);
    daysInStage = `${days}d`;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
    }}>
      <MetricCell label="Touchpoints"      value={touchpoints}      />
      <MetricCell label="Referrals Out"    value={referralsOut}     />
      <MetricCell label="Replies Received" value={repliesReceived} />
      <MetricCell label="In Stage"         value={daysInStage}      />
    </div>
  );
}
