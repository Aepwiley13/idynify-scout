/**
 * REFERRAL HEALTH PANEL
 *
 * 4-cell horizontal metric row rendered above the tab bar in ReferralHub.
 * All data comes from getContactReferralAnalytics() — no additional fetching needed.
 *
 * Cells:
 *   Intros Given | Converted | Conversion Rate | Reciprocal Balance
 */

import { useT } from '../../theme/ThemeContext';

function HealthCell({ label, value, valueColor }) {
  const T = useT();
  return (
    <div style={{
      flex: 1, padding: '10px 12px',
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 9,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{
        fontSize: 18, fontWeight: 800, lineHeight: 1,
        color: valueColor || T.text,
      }}>
        {value}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 600, color: T.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </span>
    </div>
  );
}

export default function ReferralHealthPanel({ data }) {
  const T = useT();

  if (!data) return null;

  const introsGiven   = data.referrals_sent_to_you ?? 0;
  const converted     = data.referrals_converted ?? 0;
  const convRate      = data.conversion_rate != null
    ? `${Math.round(data.conversion_rate)}%`
    : '—';

  const balance       = data.reciprocal_balance ?? 0;
  const balanceStr    = balance > 0 ? `+${balance}` : `${balance}`;
  const balanceColor  = balance > 0 ? '#22c55e' : balance < 0 ? '#f59e0b' : T.textMuted;

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      <HealthCell label="Intros Given"  value={introsGiven} />
      <HealthCell label="Converted"     value={converted}   />
      <HealthCell label="Conv. Rate"    value={convRate}    />
      <HealthCell label="Balance"       value={balanceStr}  valueColor={balanceColor} />
    </div>
  );
}
