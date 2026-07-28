import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STATUS } from '../../theme/tokens';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const URGENCY_COLOR = { high: STATUS.red, medium: STATUS.amber, low: STATUS.green };
const DEFAULT_VISIBLE = 3;
const MAX_VISIBLE = 5;

function SkeletonCard({ T }) {
  return (
    <div style={{
      padding: 16, borderRadius: 12, background: T.cardBg,
      border: `1px solid ${T.border}`, minHeight: 100,
    }}>
      <div style={{ width: 60, height: 14, borderRadius: 6, background: T.surface2, marginBottom: 12 }} />
      <div style={{ width: '80%', height: 12, borderRadius: 6, background: T.surface2, marginBottom: 8 }} />
      <div style={{ width: '60%', height: 10, borderRadius: 6, background: T.surface2, marginBottom: 16 }} />
      <div style={{ width: 90, height: 28, borderRadius: 8, background: T.surface2 }} />
    </div>
  );
}

function PriorityCard({ item, T }) {
  const navigate = useNavigate();
  const color = URGENCY_COLOR[item.urgency] || URGENCY_COLOR.low;

  return (
    <div style={{
      padding: 16, borderRadius: 12, background: T.cardBg,
      border: `1px solid ${T.border}`, position: 'relative',
    }}>
      <span style={{
        position: 'absolute', top: 12, right: 12,
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        padding: '2px 8px', borderRadius: 6,
        background: `${color}22`, color, border: `1px solid ${color}44`,
      }}>
        {item.urgency}
      </span>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4, paddingRight: 70 }}>
        {item.title}
      </div>
      <div style={{
        fontSize: 12, color: T.textMuted, lineHeight: 1.4, marginBottom: 14,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.reason}
      </div>
      <button
        onClick={() => navigate(item.route)}
        style={{
          fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
          background: `${T.accent}18`, color: T.accent, border: `1px solid ${T.accent}35`,
          cursor: 'pointer',
        }}
      >
        {item.actionLabel}
      </button>
    </div>
  );
}

export default function TodaysPriorities({ recommendations, loading, T }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 14 }}>
          Today's Priorities
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} T={T} />)}
        </div>
      </div>
    );
  }

  if (!recommendations.length) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 14 }}>
          Today's Priorities
        </div>
        <div style={{
          padding: '24px 20px', borderRadius: 12, background: T.cardBg,
          border: `1px solid ${T.border}`, textAlign: 'center',
        }}>
          <AlertCircle size={20} color={T.textFaint} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: T.textMuted }}>
            You're all caught up for now.
          </div>
        </div>
      </div>
    );
  }

  const visibleCount = expanded ? MAX_VISIBLE : DEFAULT_VISIBLE;
  const visible = recommendations.slice(0, visibleCount);
  const hasMore = recommendations.length > DEFAULT_VISIBLE;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
          Today's Priorities
        </div>
        {hasMore && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              fontSize: 12, fontWeight: 600, color: T.textMuted, background: 'none',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {expanded ? 'Show less' : `View all (${recommendations.length})`}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {visible.map(item => <PriorityCard key={item.id} item={item} T={T} />)}
      </div>
    </div>
  );
}
