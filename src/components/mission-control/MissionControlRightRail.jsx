import { useNavigate } from 'react-router-dom';
import BarryMorningBrief from './BarryMorningBrief';
import HunterReadinessBanner from './HunterReadinessBanner';
import { STATUS } from '../../theme/tokens';

const URGENCY_COLOR = { high: STATUS.red, medium: STATUS.amber, low: STATUS.green };

function QuickActionCard({ item, T }) {
  const navigate = useNavigate();
  const color = URGENCY_COLOR[item.urgency] || URGENCY_COLOR.low;

  return (
    <div style={{
      padding: 12, borderRadius: 10, background: T.cardBg,
      border: `1px solid ${T.border}`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 8, marginBottom: 6,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: T.text,
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {item.title}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          padding: '2px 6px', borderRadius: 4,
          background: `${color}22`, color, border: `1px solid ${color}44`,
          flexShrink: 0, lineHeight: 1.3,
        }}>
          {item.urgency}
        </span>
      </div>
      {item.reason && (
        <div style={{
          fontSize: 11, color: T.textMuted, lineHeight: 1.4, marginBottom: 8,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.reason}
        </div>
      )}
      {item.route && (
        <button
          onClick={() => navigate(item.route)}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
            background: `${T.accent}18`, color: T.accent,
            border: `1px solid ${T.accent}35`, cursor: 'pointer',
          }}
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  );
}

function QuickActions({ recommendations, loading, T }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2].map((i) => (
          <div key={i} style={{
            padding: 12, borderRadius: 10, background: T.cardBg,
            border: `1px solid ${T.border}`,
          }}>
            <div style={{ width: '70%', height: 12, borderRadius: 6, background: T.surface2, marginBottom: 8 }} />
            <div style={{ width: '50%', height: 10, borderRadius: 6, background: T.surface2 }} />
          </div>
        ))}
      </div>
    );
  }

  const top3 = (recommendations || []).slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {top3.map((item) => (
        <QuickActionCard key={item.id} item={item} T={T} />
      ))}
    </div>
  );
}

export default function MissionControlRightRail({
  orientation,
  openBarry,
  recommendations,
  recsLoading,
  acceptedCompanies,
  cadenceReplies,
  cadencesSent,
  subscriptionTier,
  T,
}) {
  return (
    <aside className="mc-right-rail">
      {/* Section 1: Barry's Morning Brief */}
      <BarryMorningBrief orientation={orientation} openBarry={openBarry} T={T} />

      {/* Section 2: Quick Actions (top 3 recommendations) */}
      <div style={{ marginTop: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: T.textMuted, marginBottom: 10,
        }}>
          Quick Actions
        </div>
        <QuickActions recommendations={recommendations} loading={recsLoading} T={T} />
      </div>

      {/* Section 3: Hunter Recommendation */}
      <div className="mc-rail-hunter-wrapper" style={{ marginTop: 16 }}>
        <HunterReadinessBanner
          acceptedCompanies={acceptedCompanies}
          totalReplies={cadenceReplies}
          cadencesSent={cadencesSent}
          subscriptionTier={subscriptionTier}
          T={T}
        />
      </div>
    </aside>
  );
}
