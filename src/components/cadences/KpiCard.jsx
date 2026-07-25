import { useT } from '../../theme/ThemeContext';
import { STATUS } from '../../theme/tokens';

/**
 * Reusable KPI card for the Cadences Dashboard.
 *
 * Visual style matches the stat cards on CadenceDetail.jsx: white card with
 * a subtle border/shadow, an icon inside a tinted colored circle, a large
 * primary value, a label beneath it, and optional small-gray subtitle.
 *
 * Props:
 * @param {React.ComponentType} icon    - lucide-react icon component
 * @param {string}              label   - metric label (e.g. "Active Cadences")
 * @param {string|number}       value   - primary value (e.g. 14 or "Coming soon")
 * @param {string}              color   - accent color for the icon + circle tint
 * @param {string}  [subtitle]          - optional small gray subtitle
 * @param {string}  [trend]             - optional trend text (Phase 2; omit for now)
 */
export default function KpiCard({ icon: Icon, label, value, color, subtitle, trend }) {
  const T = useT();
  const accent = color || T.textMuted;

  return (
    <div style={{
      padding: '16px 20px',
      background: T.cardBg,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {Icon && (
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `${accent}12`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon size={18} color={accent} />
          </div>
        )}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700,
        color: T.text,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{subtitle}</div>
      )}
      {trend && (
        <div style={{ fontSize: 11, color: STATUS.green, marginTop: 2 }}>{trend}</div>
      )}
    </div>
  );
}
