/**
 * MilestoneGapReport.jsx — Portfolio milestone gap analysis.
 *
 * Spec ref: v1.2 Section 10 — Milestone Gap Report
 *
 * Shows a cross-portfolio view of which customers are behind on
 * milestones, grouped by milestone type with overdue indicators.
 *
 * Features:
 *   - Grouped by milestone template (e.g. "Onboarding complete")
 *   - Customers sorted by how overdue they are
 *   - Quick action: open playbook or draft check-in
 *   - Summary KPIs: total gaps, most common gap, avg days overdue
 *
 * Props:
 *   contacts     — array of customer contact documents (with milestones + csm_enrolled_at)
 *   onOpenPlaybook — (contact) → open InterventionPlaybook for this contact
 *   onClose       — close handler
 */

import { useMemo } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, X,
  ChevronRight, Users, TrendingDown,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';

const RED    = '#dc2626';
const AMBER  = '#f59e0b';
const GREEN  = '#22c55e';
const TEAL   = '#14b8a6';

// ─── Gap Analysis Engine ──────────────────────────────────────────────────────

function analyzeGaps(contacts) {
  const gaps = []; // { contact, milestone, daysOverdue }
  const milestoneGroups = new Map(); // milestoneId → [{ contact, milestone, daysOverdue }]

  contacts.forEach(c => {
    if (!c.milestones || !Array.isArray(c.milestones) || !c.csm_enrolled_at) return;
    const enrolledAt = new Date(c.csm_enrolled_at).getTime();
    const now = Date.now();
    const daysSinceEnroll = (now - enrolledAt) / 86400_000;

    c.milestones.forEach(m => {
      if (m.completed) return; // skip completed milestones
      if (m.target_days > daysSinceEnroll) return; // not due yet

      const daysOverdue = Math.floor(daysSinceEnroll - m.target_days);
      const gap = { contact: c, milestone: m, daysOverdue };
      gaps.push(gap);

      const groupKey = m.id || m.label;
      if (!milestoneGroups.has(groupKey)) {
        milestoneGroups.set(groupKey, { label: m.label, items: [] });
      }
      milestoneGroups.get(groupKey).items.push(gap);
    });
  });

  // Sort each group by overdue days (most overdue first)
  milestoneGroups.forEach(group => {
    group.items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  });

  // Sort groups by total gap count (most gaps first)
  const sortedGroups = [...milestoneGroups.values()].sort((a, b) => b.items.length - a.items.length);

  // KPIs
  const totalGaps = gaps.length;
  const mostCommonGap = sortedGroups[0]?.label || 'None';
  const avgDaysOverdue = gaps.length > 0
    ? Math.round(gaps.reduce((s, g) => s + g.daysOverdue, 0) / gaps.length)
    : 0;

  return { gaps, groups: sortedGroups, totalGaps, mostCommonGap, avgDaysOverdue };
}

// ─── MilestoneGapReport ───────────────────────────────────────────────────────
export default function MilestoneGapReport({ contacts = [], onOpenPlaybook, onClose }) {
  const T = useT();
  const { groups, totalGaps, mostCommonGap, avgDaysOverdue } = useMemo(
    () => analyzeGaps(contacts),
    [contacts]
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 580,
        background: T.cardBg, borderRadius: 16,
        border: `1px solid ${T.border}`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingDown size={18} color={RED} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Milestone Gap Report</div>
              <div style={{ fontSize: 11, color: T.textFaint }}>
                {contacts.length} customers analyzed
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color={T.textFaint} />
          </button>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', flexWrap: 'wrap' }}>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 8,
            background: totalGaps > 0 ? `${RED}08` : `${GREEN}08`,
            border: `1px solid ${totalGaps > 0 ? `${RED}20` : `${GREEN}20`}`,
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: totalGaps > 0 ? RED : GREEN }}>{totalGaps}</div>
            <div style={{ fontSize: 9, color: T.textFaint }}>Total Gaps</div>
          </div>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mostCommonGap}
            </div>
            <div style={{ fontSize: 9, color: T.textFaint }}>Most Common Gap</div>
          </div>
          <div style={{
            flex: 1, minWidth: 100, padding: '8px 12px', borderRadius: 8,
            background: avgDaysOverdue > 14 ? `${RED}08` : `${AMBER}08`,
            border: `1px solid ${avgDaysOverdue > 14 ? `${RED}20` : `${AMBER}20`}`,
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: avgDaysOverdue > 14 ? RED : AMBER }}>
              {avgDaysOverdue}d
            </div>
            <div style={{ fontSize: 9, color: T.textFaint }}>Avg Days Overdue</div>
          </div>
        </div>

        {/* Gap groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {totalGaps === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <CheckCircle2 size={32} color={GREEN} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>No Milestone Gaps</div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                All customers are on track with their milestones.
              </div>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label} style={{ marginBottom: 16 }}>
                {/* Group header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                  padding: '6px 0', borderBottom: `1px solid ${T.border}`,
                }}>
                  <AlertTriangle size={12} color={AMBER} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{group.label}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                    background: `${RED}15`, color: RED, marginLeft: 'auto',
                  }}>
                    {group.items.length} behind
                  </span>
                </div>

                {/* Gap items */}
                {group.items.map((gap, i) => (
                  <div
                    key={`${gap.contact.id}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 8, marginBottom: 4,
                      background: T.surface, border: `1px solid ${T.border}`,
                      cursor: onOpenPlaybook ? 'pointer' : 'default',
                    }}
                    onClick={() => onOpenPlaybook && onOpenPlaybook(gap.contact)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: T.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {gap.contact.name}
                      </div>
                      {gap.contact.company_name && (
                        <div style={{ fontSize: 10, color: T.textFaint }}>{gap.contact.company_name}</div>
                      )}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      fontSize: 11, fontWeight: 600,
                      color: gap.daysOverdue > 30 ? RED : gap.daysOverdue > 14 ? AMBER : T.textMuted,
                    }}>
                      <Clock size={10} />
                      {gap.daysOverdue}d overdue
                    </div>
                    {onOpenPlaybook && <ChevronRight size={14} color={T.textFaint} />}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
