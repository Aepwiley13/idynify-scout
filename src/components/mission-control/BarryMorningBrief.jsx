import ReactMarkdown from 'react-markdown';
import { BRAND, ASSETS } from '../../theme/tokens';
import { AlertCircle, MessageSquare } from 'lucide-react';

function SkeletonBrief({ T }) {
  return (
    <div className="mc-skeleton-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: '90%', height: 12, borderRadius: 6, background: T.surface2 }} />
      <div style={{ width: '70%', height: 12, borderRadius: 6, background: T.surface2 }} />
      <div style={{ width: '50%', height: 10, borderRadius: 6, background: T.surface2, marginTop: 4 }} />
    </div>
  );
}

export default function BarryMorningBrief({ orientation, openBarry, T }) {
  const safe = orientation ?? {
    status: 'loading',
    brief: null,
    suggestedPrompts: [],
    mode: null,
    error: null,
  };

  const isLoading = safe.status === 'loading';
  const isError = safe.status === 'error';
  const isReady = safe.status === 'ready';

  return (
    <div style={{
      borderRadius: 14,
      background: T.cardBg,
      border: `1px solid ${T.border}`,
      padding: '20px 20px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.cyan})`,
        opacity: isReady ? 1 : 0.4,
        transition: 'opacity 0.3s',
      }} />

      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
      }}>
        <img
          src={ASSETS.barryAvatar}
          alt=""
          style={{
            width: 32, height: 32, borderRadius: '50%',
            border: `2px solid ${BRAND.pink}40`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
            Barry's Brief
          </div>
          <div style={{ fontSize: 11, color: T.textMuted }}>
            {isLoading ? 'Analyzing your pipeline…' : isError ? 'Orientation unavailable' : 'Mission Control'}
          </div>
        </div>
        {isLoading && (
          <div className="mc-skeleton-pulse" style={{
            width: 8, height: 8, borderRadius: '50%',
            background: T.textMuted, flexShrink: 0,
          }} />
        )}
      </div>

      {/* Body */}
      {isLoading && <SkeletonBrief T={T} />}

      {isError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: T.textMuted, lineHeight: 1.5,
        }}>
          <AlertCircle size={14} color={T.textMuted} style={{ flexShrink: 0 }} />
          <span>Barry couldn't load the morning brief. Open the chat to continue.</span>
        </div>
      )}

      {isReady && safe.brief && (
        <div
          className="barry-brief-body"
          style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}
        >
          <ReactMarkdown>{safe.brief}</ReactMarkdown>
        </div>
      )}

      {/* Suggested prompts */}
      {isReady && safe.suggestedPrompts.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12,
        }}>
          {safe.suggestedPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => openBarry?.()}
              style={{
                fontSize: 11, fontWeight: 600,
                padding: '5px 10px', borderRadius: 8,
                background: `${T.accent}18`,
                color: T.accent,
                border: `1px solid ${T.accent}35`,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${T.accent}28`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${T.accent}18`; }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Error / loading fallback CTA */}
      {(isError || isLoading) && (
        <button
          onClick={() => openBarry?.()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 12, fontSize: 12, fontWeight: 600,
            padding: '6px 12px', borderRadius: 8,
            background: `${T.accent}18`, color: T.accent,
            border: `1px solid ${T.accent}35`,
            cursor: 'pointer',
          }}
        >
          <MessageSquare size={12} />
          Open Barry
        </button>
      )}
    </div>
  );
}
