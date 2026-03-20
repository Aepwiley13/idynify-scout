/**
 * BarryHUD.jsx — Persistent phase-aware coaching strip for Go To War.
 *
 * Sits at the top of the Go To War view across all 8 phases.
 * Shows Barry's avatar, current phase label, and a coaching line
 * specific to what the user is doing right now.
 *
 * Usage:
 *   <BarryHUD phase={currentPhase} />
 *
 * phase is 0-indexed (0 = Brief, 7 = Debrief).
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '../theme/ThemeContext';
import { BRAND, ASSETS } from '../theme/tokens';

// ─── 8-phase coaching lines ───────────────────────────────────────────────────
// Each line tells the user exactly what they need to do and why — no fluff.
export const PHASE_LABELS = [
  'Brief',
  'Roster',
  'ICP & Companies',
  'Contacts',
  'Sequence',
  'Launch',
  'Monitor',
  'Debrief',
];

export const PHASE_COACHING = [
  // Phase 1 — Brief
  "Define your objective. The cleaner the goal, the sharper the plan I'll build.",
  // Phase 2 — Roster
  "Pick your targets. Choose the contacts you want in this wave.",
  // Phase 3 — ICP & Companies
  "Describe your ideal target. I'll pull matching companies and contacts from your saved list.",
  // Phase 4 — Contacts
  "Click a company to see decision makers. Add the right people to this mission.",
  // Phase 5 — Sequence
  "Configure the engagement. I'll build a multi-step sequence you can review and approve.",
  // Phase 6 — Launch
  "Ready to fire. Review the send schedule, then send each step manually.",
  // Phase 7 — Monitor
  "You're live. Track who's been sent, who's replied, and who needs a follow-up.",
  // Phase 8 — Debrief
  "Mark how each one landed. This trains me to do better on the next wave.",
];

const HUD_ACCENT = BRAND.cyan;

// ─── BarryHUD ─────────────────────────────────────────────────────────────────
export default function BarryHUD({ phase = 0, totalPhases = 8 }) {
  const T = useT();
  const [collapsed, setCollapsed] = useState(false);

  const phaseIndex = Math.max(0, Math.min(phase, totalPhases - 1));
  const label      = PHASE_LABELS[phaseIndex] ?? `Phase ${phaseIndex + 1}`;
  const coaching   = PHASE_COACHING[phaseIndex] ?? '';
  const progress   = ((phaseIndex + 1) / totalPhases) * 100;

  return (
    <div
      style={{
        background: T.cardBg,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        transition: 'background 0.2s',
      }}
    >
      {/* Main HUD row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: collapsed ? '8px 16px' : '10px 16px 8px',
        }}
      >
        {/* Barry avatar */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.cyan})`,
            border: `2px solid ${HUD_ACCENT}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            boxShadow: `0 0 10px ${HUD_ACCENT}30`,
          }}
        >
          <img
            src={ASSETS.barryAvatar}
            alt="Barry"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentNode.textContent = '🐻';
            }}
          />
        </div>

        {/* Phase label + coaching text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 2 }}>
            {/* Phase badge */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: HUD_ACCENT,
                background: `${HUD_ACCENT}15`,
                border: `1px solid ${HUD_ACCENT}30`,
                padding: '2px 7px',
                borderRadius: 20,
                flexShrink: 0,
              }}
            >
              {phaseIndex + 1} / {totalPhases} — {label.toUpperCase()}
            </span>
          </div>
          {!collapsed && (
            <div
              style={{
                fontSize: 13,
                color: T.text,
                lineHeight: 1.45,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {coaching}
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <div
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand Barry HUD' : 'Collapse Barry HUD'}
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: `1px solid ${T.border2}`,
            background: T.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = T.cardBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = T.surface; }}
        >
          {collapsed
            ? <ChevronDown size={13} color={T.textFaint} />
            : <ChevronUp size={13} color={T.textFaint} />
          }
        </div>
      </div>

      {/* Phase progress bar */}
      {!collapsed && (
        <div
          style={{
            height: 3,
            background: T.border2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${BRAND.pink}, ${HUD_ACCENT})`,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      )}
    </div>
  );
}
