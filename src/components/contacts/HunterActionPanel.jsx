/**
 * HunterActionPanel — Hunter stage action block in ContactProfile.
 *
 * Shown when a contact is in the Hunter stage.
 * Lets the user log a Hunter outcome and move the contact to Sniper
 * when a meeting is booked or a demo is completed.
 *
 * Trigger paths:
 *   1. User clicks "Move to Sniper" button here
 *   2. Barry detects a calendar event and suggests it in chat
 *   3. User tells Barry to move someone
 */

import { useState } from 'react';
import { Crosshair, ChevronDown, ChevronUp, Loader, Check } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { moveContactToSniper, SNIPER_MOVE_REASONS } from '../../utils/moveToSniper';

const REASON_OPTIONS = [
  { value: 'meeting_booked',      label: 'Meeting booked' },
  { value: 'demo_completed',      label: 'Demo completed' },
  { value: 'positive_discussion', label: 'Positive discussion' },
  { value: 'manual',              label: 'Manually moving them' },
];

export default function HunterActionPanel({ contact, onMoved }) {
  const T = useT();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('meeting_booked');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // Only show for Hunter-stage contacts
  if (!contact || contact.stage !== 'hunter') return null;
  // Hide after successful move
  if (done) return null;

  async function handleMove() {
    try {
      setLoading(true);
      setError(null);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      await moveContactToSniper({
        userId: user.uid,
        contactId: contact.id,
        reason,
        note: note.trim() || null,
        actor: 'user',
      });

      setDone(true);
      if (onMoved) onMoved({ reason, note });
    } catch (err) {
      console.error('[HunterActionPanel] Move failed:', err);
      setError('Failed to move contact. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      margin: '0 0 16px',
      borderRadius: 12,
      border: `1px solid rgba(20, 184, 166, 0.3)`,
      background: 'rgba(20, 184, 166, 0.06)',
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
          background: 'rgba(20, 184, 166, 0.15)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Crosshair size={15} color="#14b8a6" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Hunter Action</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
            Log an outcome or move to Sniper when ready to close
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

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(20, 184, 166, 0.15)', marginBottom: 2 }} />

          {/* Reason selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Why are you moving to Sniper?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REASON_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: reason === opt.value ? '#14b8a6' : T.text }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: `2px solid ${reason === opt.value ? '#14b8a6' : T.border2}`,
                    background: reason === opt.value ? '#14b8a6' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'all 0.15s',
                  }}>
                    {reason === opt.value && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                  <input
                    type="radio"
                    name="sniper-reason"
                    value={opt.value}
                    checked={reason === opt.value}
                    onChange={() => setReason(opt.value)}
                    style={{ display: 'none' }}
                  />
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
              placeholder="e.g. Demo went well, they asked about pricing…"
              rows={2}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${T.border2}`,
                background: T.surface,
                color: T.text,
                fontSize: 13,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 7 }}>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleMove}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '10px 18px',
              borderRadius: 9,
              background: loading ? 'rgba(20,184,166,0.4)' : 'linear-gradient(135deg, #14b8a6, #0d9488)',
              border: 'none',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? <><Loader size={14} style={{ animation: 'hunterSpin 1s linear infinite' }} />Moving…</>
              : <><Crosshair size={14} />Move to Sniper</>
            }
          </button>
          <style>{`@keyframes hunterSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}
