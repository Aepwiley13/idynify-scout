/**
 * ScoutEngagementPanel — Stage-specific engagement context for Scout-stage contacts.
 *
 * Goal: Start the conversation — first touch, cold or warm.
 * Primary CTA: Move to Hunter (engaged, worth pursuing)
 * Skip CTA:    Move straight to Sniper (already booked a meeting)
 */

import { useState } from 'react';
import { Radar, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { moveContactToHunter, HUNTER_MOVE_REASONS } from '../../utils/moveToHunter';
import { moveContactToSniper, SNIPER_MOVE_REASONS } from '../../utils/moveToSniper';

const STAGE_COLOR = '#e8197d';

const REASON_OPTIONS = [
  { value: 'initial_engagement',       label: 'Initial engagement made' },
  { value: 'relationship_established', label: 'Relationship established' },
  { value: 'manual',                   label: 'Manually moving them' },
];

export default function ScoutEngagementPanel({ contact, onMoved }) {
  const T = useT();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('initial_engagement');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!contact || contact.stage !== 'scout') return null;
  if (done) return null;

  async function handleMoveToHunter() {
    try {
      setLoading(true);
      setError(null);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      await moveContactToHunter({
        userId: user.uid,
        contactId: contact.id,
        reason,
        note: note.trim() || null,
        actor: 'user',
      });

      setDone(true);
      if (onMoved) onMoved({ stageTo: 'hunter', reason, note });
    } catch (err) {
      console.error('[ScoutEngagementPanel] Move to Hunter failed:', err);
      setError('Failed to move contact. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSkipToSniper() {
    try {
      setLoading(true);
      setError(null);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      await moveContactToSniper({
        userId: user.uid,
        contactId: contact.id,
        reason: 'meeting_booked',
        note: note.trim() || null,
        actor: 'user',
      });

      setDone(true);
      if (onMoved) onMoved({ stageTo: 'sniper', reason: 'meeting_booked', note });
    } catch (err) {
      console.error('[ScoutEngagementPanel] Skip to Sniper failed:', err);
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
          <Radar size={15} color={STAGE_COLOR} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Start the Conversation</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
            Open the door — make the first move
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
            This is your first touch — keep it curious, not salesy.
          </div>

          {/* Reason selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Why are you moving to Hunter?
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
                  <input type="radio" name="scout-reason" value={opt.value} checked={reason === opt.value} onChange={() => setReason(opt.value)} style={{ display: 'none' }} />
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
              placeholder="e.g. Connected on LinkedIn, seemed interested in what we do…"
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

          {/* Primary CTA */}
          <button
            onClick={handleMoveToHunter}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 9,
              background: loading ? `${STAGE_COLOR}60` : `linear-gradient(135deg, ${STAGE_COLOR}, #c0146a)`,
              border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? <><Loader size={14} style={{ animation: 'scoutSpin 1s linear infinite' }} />Moving…</>
              : <><Radar size={14} />Move to Hunter</>
            }
          </button>

          {/* Skip CTA */}
          {!loading && (
            <button
              onClick={handleSkipToSniper}
              style={{
                background: 'none', border: 'none', color: T.textMuted, fontSize: 11,
                cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
                padding: '2px 0', textAlign: 'center',
              }}
            >
              Already booked a meeting? → Move straight to Sniper
            </button>
          )}

          <style>{`@keyframes scoutSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}
