/**
 * ReinforcementsEngagementPanel — Stage-specific context for Reinforcements-stage contacts.
 *
 * Goal: Activate the network — ask for introductions and referrals.
 * Terminal stage — no pipeline progression CTA.
 */

import { useState } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';

const STAGE_COLOR = '#6366f1';

export default function ReinforcementsEngagementPanel({ contact }) {
  const T = useT();
  const [expanded, setExpanded] = useState(false);

  if (!contact || contact.stage !== 'reinforcements') return null;

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
          <Users size={15} color={STAGE_COLOR} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Activate the Network</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
            Ask for introductions and referrals
          </div>
        </div>
        {expanded
          ? <ChevronUp size={15} color={T.textFaint} />
          : <ChevronDown size={15} color={T.textFaint} />
        }
      </button>

      {/* Expanded content — framing only, no move CTA */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 1, background: `${STAGE_COLOR}18`, marginBottom: 2 }} />

          {/* Barry framing blurb */}
          <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: '6px 10px', background: `${STAGE_COLOR}08`, borderRadius: 7, borderLeft: `3px solid ${STAGE_COLOR}40` }}>
            The ask is natural here — they're already an advocate.
          </div>

          {/* Suggested action chips */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Suggested actions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Ask for a specific referral', 'Request an introduction', 'Offer reciprocal value'].map(action => (
                <span
                  key={action}
                  style={{
                    padding: '5px 10px', borderRadius: 20,
                    background: `${STAGE_COLOR}12`, border: `1px solid ${STAGE_COLOR}30`,
                    color: STAGE_COLOR, fontSize: 11, fontWeight: 500,
                  }}
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
