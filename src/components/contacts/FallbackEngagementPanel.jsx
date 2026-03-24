/**
 * FallbackEngagementPanel — Stage-specific engagement context for Fallback-stage contacts.
 *
 * Goal: Win them back — re-engage dormant or closed-lost contacts.
 * Primary CTA: Re-activate to Scout
 */

import { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { moveContactToScout } from '../../utils/moveToScout';

const STAGE_COLOR = '#f59e0b';

const REASON_OPTIONS = [
  { value: 're_engaged',     label: 'Re-engaged' },
  { value: 'new_angle',      label: 'New angle or opportunity' },
  { value: 'trigger_event',  label: 'Trigger event detected' },
  { value: 'manual',         label: 'Manually re-activating' },
];

export default function FallbackEngagementPanel({ contact, onMoved }) {
  const T = useT();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('re_engaged');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!contact || contact.stage !== 'fallback') return null;
  if (done) return null;

  async function handleMove() {
    try {
      setLoading(true);
      setError(null);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      await moveContactToScout({
        userId: user.uid,
        contactId: contact.id,
        reason,
        note: note.trim() || null,
        actor: 'user',
      });

      setDone(true);
      if (onMoved) onMoved({ stageTo: 'scout', reason, note });
    } catch (err) {
      console.error('[FallbackEngagementPanel] Re-activate to Scout failed:', err);
      setError('Failed to move contact. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      margin: '0 0 16px',
      borderRadius: 12,
      border: `1px solid ${STAGE_COLOR}35`,
      background: `${STAGE_COLOR}06`,
      overflow: 'hidden',
    }}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${STAGE_COLOR}18`,
          border: `1px solid ${STAGE_COLOR}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <RefreshCw size={15} color={STAGE_COLOR} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Win Them Back</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
            The timing might be right now
          </div>
        </div>
        {expanded
          ? <ChevronUp size={15} color={T.textFaint} />
          : <ChevronDown size={15} color={T.textFaint} />
        }
      </button>

      {/* Expanded form */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 1, background: `${STAGE_COLOR}18`, marginBottom: 2 }} />

          {/* Barry framing blurb */}
          <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: '6px 10px', background: `${STAGE_COLOR}08`, borderRadius: 7, borderLeft: `3px solid ${STAGE_COLOR}40` }}>
            Circumstances change — a genuine, no-pressure check-in opens more doors than you'd think.
          </div>

          {/* Reason selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Why are you re-activating?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REASON_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: reason === opt.value ? STAGE_COLOR : T.text }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: `2px solid ${reason === opt.value ? STAGE_COLOR : T.border2}`,
                    background: reason === opt.value ? STAGE_COLOR : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'all 0.15s',
                  }}>
                    {reason === opt.value && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                  <input type="radio" name="fallback-eng-reason" value={opt.value} checked={reason === opt.value} onChange={() => setReason(opt.value)} style={{ display: 'none' }} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Optional note */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Note <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. They just changed jobs, good time to reconnect…"
              rows={2}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                border: `1px solid ${T.border2}`, background: T.surface, color: T.text,
                fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 7 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleMove}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 9,
              background: loading ? `${STAGE_COLOR}60` : `linear-gradient(135deg, ${STAGE_COLOR}, #d97706)`,
              border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? <><Loader size={14} style={{ animation: 'fallbackEngSpin 1s linear infinite' }} />Re-activating…</>
              : <><RefreshCw size={14} />Re-activate to Scout</>
            }
          </button>

          <style>{`@keyframes fallbackEngSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}
