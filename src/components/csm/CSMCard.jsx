/**
 * CSMCard.jsx — Individual CSM card for the customer success grid.
 *
 * Spec ref: v1.2 Section 3 — CSM Card Anatomy
 *
 * Displays:
 *   - Health score ring (0–100, color-coded)
 *   - Customer name + company
 *   - Milestone progress bar
 *   - Days since last contact
 *   - Snooze indicator (if snoozed)
 *   - Quick-action button (Check In / Intervene / View)
 *
 * Props:
 *   contact       — Firestore contact document
 *   healthResult  — { score, bucket, label, color } from computeHealthScore
 *   onClick       — card click handler
 *   onCheckIn     — check-in button handler
 *   onSnooze      — snooze button handler
 */

import { Clock, Pause, MessageSquare, AlertTriangle, ChevronRight } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { isContactSnoozed } from '../../services/snoozeManager';

// ─── Health Ring ──────────────────────────────────────────────────────────────
function HealthRing({ score, color, size = 44 }) {
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={`${color}20`} strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color,
      }}>
        {score}
      </div>
    </div>
  );
}

// ─── Milestone Progress ───────────────────────────────────────────────────────
function MilestoneBar({ milestones, T }) {
  if (!milestones || !Array.isArray(milestones) || milestones.length === 0) return null;
  const total = milestones.length;
  const done = milestones.filter(m => m.completed).length;
  const pct = Math.round((done / total) * 100);

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: T.textFaint }}>Milestones</span>
        <span style={{ fontSize: 9, color: T.textFaint }}>{done}/{total}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: pct === 100 ? '#22c55e' : '#14b8a6',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

// ─── CSMCard ──────────────────────────────────────────────────────────────────
export default function CSMCard({
  contact,
  healthResult,
  onClick,
  onCheckIn,
  onSnooze,
}) {
  const T = useT();
  const snoozeInfo = isContactSnoozed(contact);
  const lastContactAt = contact.engagement_summary?.last_contact_at;
  const daysSince = lastContactAt
    ? Math.floor((Date.now() - new Date(lastContactAt).getTime()) / 86400_000)
    : null;

  const { score, bucket, label, color } = healthResult || {
    score: 0, bucket: 'at_risk', label: 'No Data', color: '#6b7280',
  };

  // Action button config
  const actionConfig = bucket === 'at_risk'
    ? { label: 'Intervene', icon: AlertTriangle, bg: '#dc2626' }
    : bucket === 'neutral'
    ? { label: 'Check In', icon: MessageSquare, bg: '#f59e0b' }
    : { label: 'View', icon: ChevronRight, bg: '#22c55e' };

  const ActionIcon = actionConfig.icon;

  return (
    <div
      onClick={onClick}
      style={{
        background: T.cardBg,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 12,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = T.borderHov;
        e.currentTarget.style.borderLeftColor = color;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.borderLeftColor = color;
      }}
    >
      {/* Snooze badge */}
      {snoozeInfo.snoozed && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 10,
          background: '#f59e0b18', border: '1px solid #f59e0b30',
          fontSize: 9, color: '#f59e0b', fontWeight: 600,
        }}>
          <Pause size={8} />
          {snoozeInfo.daysRemaining}d
        </div>
      )}

      {/* Top row: health ring + identity */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <HealthRing score={score} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: T.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {contact.name}
          </div>
          {contact.company_name && (
            <div style={{
              fontSize: 11, color: T.textMuted, marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {contact.company_name}
            </div>
          )}
          <div style={{
            display: 'inline-block', marginTop: 4,
            padding: '1px 6px', borderRadius: 8,
            background: `${color}15`, border: `1px solid ${color}30`,
            fontSize: 9, fontWeight: 600, color,
          }}>
            {label}
          </div>
        </div>
      </div>

      {/* Days since contact */}
      {daysSince !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, marginTop: 8,
          fontSize: 11, color: daysSince > 14 ? '#dc2626' : daysSince > 7 ? '#f59e0b' : T.textFaint,
        }}>
          <Clock size={10} />
          <span>{daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince} days ago`}</span>
        </div>
      )}

      {/* Milestone progress */}
      <MilestoneBar milestones={contact.milestones} T={T} />

      {/* Action row */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={e => { e.stopPropagation(); onCheckIn && onCheckIn(contact); }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '6px 0', borderRadius: 6, border: 'none',
            background: actionConfig.bg, color: '#fff',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <ActionIcon size={11} />
          {actionConfig.label}
        </button>
        {!snoozeInfo.snoozed && (
          <button
            onClick={e => { e.stopPropagation(); onSnooze && onSnooze(contact); }}
            title="Snooze"
            style={{
              width: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Pause size={11} color={T.textFaint} />
          </button>
        )}
      </div>
    </div>
  );
}
