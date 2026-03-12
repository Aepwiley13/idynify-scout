import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../../../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { backfillMissionContactNames } from '../../../utils/backfillMissionContacts';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Target,
  Users,
  ChevronRight,
  Send,
  MessageSquare,
  Phone,
  Link,
  Eye,
  Flag,
  Filter,
  Sparkles,
  Zap,
  ArrowRight,
  RefreshCw,
  SkipForward
} from 'lucide-react';
import {
  getNeedsAttentionItems,
  groupContactsByStatus,
  buildCampaignSummaries,
  getRecentlyCompleted,
  HEALTH_LABELS,
  HEALTH_COLORS,
  ATTENTION_TYPE_LABELS,
  ATTENTION_TYPE_COLORS
} from '../../../utils/dashboardEngine';
import {
  getLabelById,
  OUTCOME_GOALS,
  OBJECTIVE_TYPES,
  STRATEGIC_PRIORITIES
} from '../../../constants/structuredFields';
import './DashboardSection.css';
import { getEffectiveUser } from '../../../context/ImpersonationContext';

/**
 * DASHBOARD SECTION (Step 6)
 *
 * Operational clarity layer for Hunter.
 * Shows: Needs Attention, Active Campaigns, Mission Status, Recently Completed.
 *
 * This is NOT analytics. It is a visibility and action surface.
 * Every item is a gateway to action — not a report.
 *
 * Props:
 *   missions  — Array of mission documents
 *   campaigns — Array of campaign documents
 */

const STEP_TYPE_ICONS = {
  message: Send,
  follow_up: MessageSquare,
  call: Phone,
  resource: Link,
  introduction: Users
};

const STATUS_GROUP_CONFIG = {
  active_mission: { label: 'Active Mission', icon: Zap, color: '#3b82f6' },
  awaiting_reply: { label: 'Awaiting Reply', icon: Clock, color: '#f59e0b' },
  in_conversation: { label: 'In Conversation', icon: MessageSquare, color: '#10b981' },
  stalled: { label: 'Stalled', icon: AlertCircle, color: '#ef4444' },
  mission_complete: { label: 'Mission Complete', icon: CheckCircle, color: '#8b5cf6' }
};

export default function DashboardSection({ missions = [], campaigns = [] }) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const backfillRan = useRef(false);

  // Step 6: One-time backfill for missions missing firstName/lastName
  useEffect(() => {
    if (backfillRan.current) return;
    const user = getEffectiveUser();
    if (!user || missions.length === 0) return;

    // Check if any mission contacts are missing firstName
    const needsBackfill = missions.some(m =>
      (m.contacts || []).some(c => !c.firstName && c.contactId)
    );

    if (needsBackfill) {
      backfillRan.current = true;
      backfillMissionContactNames(user.uid).then(stats => {
        if (stats.updated > 0) {
          console.log(`[Dashboard] Backfilled ${stats.updated} missions with contact names`);
        }
      });
    }
  }, [missions]);

  // ── Computed Data ───────────────────────────────────

  const activeMissions = useMemo(
    () => missions.filter(m => m.status !== 'completed'),
    [missions]
  );

  const attentionItems = useMemo(
    () => getNeedsAttentionItems(activeMissions),
    [activeMissions]
  );

  const statusGroups = useMemo(
    () => groupContactsByStatus(activeMissions),
    [activeMissions]
  );

  const campaignSummaries = useMemo(
    () => buildCampaignSummaries(campaigns, missions),
    [campaigns, missions]
  );

  const recentlyCompleted = useMemo(
    () => getRecentlyCompleted(missions),
    [missions]
  );

  // ── Filtered Mission Status View ────────────────────

  const filteredStatusGroups = useMemo(() => {
    const groups = { ...statusGroups };

    if (statusFilter !== 'all') {
      const filtered = {};
      filtered[statusFilter] = groups[statusFilter] || [];
      return filtered;
    }

    if (campaignFilter !== 'all') {
      const result = {};
      for (const [key, contacts] of Object.entries(groups)) {
        result[key] = contacts.filter(c => {
          const mission = missions.find(m => m.id === c.missionId);
          return mission?.campaignId === campaignFilter;
        });
      }
      return result;
    }

    return groups;
  }, [statusGroups, statusFilter, campaignFilter, missions]);

  // ── Navigation Helpers ──────────────────────────────

  function handleOpenContact(contactId) {
    if (contactId) {
      navigate(`/scout/contact/${contactId}`);
    }
  }

  function handleOpenMission(missionId) {
    if (missionId) {
      navigate(`/hunter/mission/${missionId}`);
    }
  }

  function handleReviewStep(item) {
    // Navigate to mission detail where user can access the SequencePanel
    navigate(`/hunter/mission/${item.missionId}`);
  }

  // ── Task 4.1: Barry check-in state + handlers ────────────────────────────
  // dismissedCheckins: Set of `${missionId}-${contactId}` keys the user has acted on this session
  const [dismissedCheckins, setDismissedCheckins] = useState(new Set());
  const [checkinSaving, setCheckinSaving] = useState(null);

  // Contacts stalled > 4 days that need a Barry check-in card
  const checkinItems = useMemo(() => {
    return attentionItems.filter(item =>
      (item.type === 'overdue_reply' || item.type === 'stalled_contact') &&
      !dismissedCheckins.has(`${item.missionId}-${item.contactId}`)
    );
  }, [attentionItems, dismissedCheckins]);

  // "Try a different angle" — navigate to mission detail; Barry will offer new personalization
  function handleTryDifferentAngle(item) {
    navigate(`/hunter/mission/${item.missionId}`);
    setDismissedCheckins(s => new Set([...s, `${item.missionId}-${item.contactId}`]));
  }

  // "Wait longer" — snooze: add 7 days to the step's effective timing (client-only dismiss this session)
  async function handleWaitLonger(item) {
    setDismissedCheckins(s => new Set([...s, `${item.missionId}-${item.contactId}`]));
  }

  // "Move on" — remove from mission
  async function handleMoveOn(item) {
    const user = getEffectiveUser();
    if (!user || checkinSaving) return;
    const key = `${item.missionId}-${item.contactId}`;
    setCheckinSaving(key);
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', item.missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).filter(c => c.contactId !== item.contactId);
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
      setDismissedCheckins(s => new Set([...s, key]));
    } catch (err) {
      console.error('[DashboardSection] handleMoveOn error:', err);
    } finally {
      setCheckinSaving(null);
    }
  }

  // ── Quick Stats ─────────────────────────────────────

  const totalActiveContacts = Object.values(statusGroups).reduce(
    (sum, group) => sum + group.length, 0
  );

  // ── Render ──────────────────────────────────────────

  return (
    <div className="dashboard-section">
      {/* Quick Stats Bar — Finding 17: Scout .kpi-card pattern */}
      <div className="dashboard-stats-bar">
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <AlertCircle />
          </div>
          <div className="dashboard-stat-content">
            <div className="dashboard-stat-label">Needs Attention</div>
            <div className="dashboard-stat-value">{attentionItems.length}</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Zap />
          </div>
          <div className="dashboard-stat-content">
            <div className="dashboard-stat-label">Active Missions</div>
            <div className="dashboard-stat-value">{activeMissions.length}</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Users />
          </div>
          <div className="dashboard-stat-content">
            <div className="dashboard-stat-label">Contacts in Play</div>
            <div className="dashboard-stat-value">{totalActiveContacts}</div>
          </div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <CheckCircle />
          </div>
          <div className="dashboard-stat-content">
            <div className="dashboard-stat-label">Completed (30d)</div>
            <div className="dashboard-stat-value">{recentlyCompleted.length}</div>
          </div>
        </div>
      </div>

      {/* ─── Task 4.1: Barry Check-In Cards ─── */}
      {checkinItems.length > 0 && (
        <div className="barry-checkin-panel">
          <div className="barry-checkin-header">
            <Sparkles className="w-4 h-4" />
            <span>Barry flagged {checkinItems.length} contact{checkinItems.length !== 1 ? 's' : ''} that may need a new approach</span>
          </div>
          {checkinItems.slice(0, 3).map((item, idx) => {
            const isSaving = checkinSaving === `${item.missionId}-${item.contactId}`;
            const dayLabel = item.daysSinceSent || item.daysSinceAdded;
            return (
              <div key={`${item.missionId}-${item.contactId}-${idx}`} className="barry-checkin-card">
                <div className="barry-checkin-voice">
                  <Sparkles className="w-3 h-3" style={{ color: '#a855f7' }} />
                  <p>
                    <strong>{item.contactName}</strong> hasn't responded
                    {item.stepIndex !== undefined ? ` to Step ${item.stepIndex + 1}` : ''}
                    {dayLabel ? ` in ${dayLabel} day${dayLabel !== 1 ? 's' : ''}` : ''}.
                    What do you want to do?
                  </p>
                </div>
                <div className="barry-checkin-actions">
                  <button
                    className="barry-checkin-btn"
                    onClick={() => handleTryDifferentAngle(item)}
                    disabled={isSaving}
                    title="Barry will generate a new approach for this contact"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Try a different angle
                  </button>
                  <button
                    className="barry-checkin-btn barry-checkin-btn--muted"
                    onClick={() => handleWaitLonger(item)}
                    disabled={isSaving}
                    title="Dismiss for now — check back in a few days"
                  >
                    <Clock className="w-3 h-3" />
                    Wait longer
                  </button>
                  <button
                    className="barry-checkin-btn barry-checkin-btn--danger"
                    onClick={() => handleMoveOn(item)}
                    disabled={isSaving}
                    title="Remove this contact from the mission"
                  >
                    <SkipForward className="w-3 h-3" />
                    Move on
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Section 1: Needs Attention ─── */}
      <div className="dashboard-panel dashboard-panel-attention">
        <div className="dashboard-panel-header">
          <div className="dashboard-panel-title">
            <AlertCircle className="w-5 h-5" style={{ color: '#f59e0b' }} />
            <h2>Needs Attention</h2>
            {attentionItems.length > 0 && (
              <span className="attention-count">{attentionItems.length}</span>
            )}
          </div>
        </div>

        {attentionItems.length === 0 ? (
          <div className="dashboard-empty">
            <CheckCircle className="w-8 h-8" style={{ color: '#10b981' }} />
            <p>All clear — nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="attention-list">
            {attentionItems.map((item, idx) => {
              const typeConfig = ATTENTION_TYPE_COLORS[item.type] || {};
              const typeLabel = ATTENTION_TYPE_LABELS[item.type] || item.type;
              const StepIcon = STEP_TYPE_ICONS[item.stepType] || Send;

              return (
                <div key={`${item.missionId}-${item.contactId}-${idx}`} className="attention-item">
                  <div className="attention-item-left">
                    <span
                      className="attention-type-badge"
                      style={{
                        background: typeConfig.bg,
                        color: typeConfig.text
                      }}
                    >
                      {typeLabel}
                    </span>
                    <div className="attention-item-info">
                      {item.contactName && (
                        <span
                          className="attention-contact-name"
                          onClick={() => handleOpenContact(item.contactId)}
                        >
                          {item.contactName}
                        </span>
                      )}
                      <span className="attention-message">{item.message}</span>
                      <span className="attention-mission-name">{item.missionName}</span>
                    </div>
                  </div>
                  <div className="attention-item-actions">
                    {(item.type === 'personalization_approval') && (
                      <button
                        className="btn-attention-action btn-attention-action--purple"
                        onClick={() => handleOpenMission(item.missionId)}
                      >
                        <Sparkles className="w-4 h-4" />
                        Review
                      </button>
                    )}
                    {(item.type === 'contact_replied') && (
                      <button
                        className="btn-attention-action btn-attention-action--blue"
                        onClick={() => handleOpenMission(item.missionId)}
                      >
                        <MessageSquare className="w-4 h-4" />
                        Respond
                      </button>
                    )}
                    {(item.type === 'step_ready' || item.type === 'outcome_needed' || item.type === 'overdue_reply' || item.type === 'stalled_contact') && (
                      <button
                        className="btn-attention-action"
                        onClick={() => handleReviewStep(item)}
                      >
                        <Eye className="w-4 h-4" />
                        Review
                      </button>
                    )}
                    {item.type === 'deadline_approaching' && (
                      <button
                        className="btn-attention-action"
                        onClick={() => handleOpenMission(item.missionId)}
                      >
                        <ArrowRight className="w-4 h-4" />
                        View Mission
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Section 2: Active Campaigns ─── */}
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="dashboard-panel-title">
            <Target className="w-5 h-5" style={{ color: '#8b5cf6' }} />
            <h2>Active Campaigns</h2>
          </div>
        </div>

        {campaignSummaries.length === 0 ? (
          <div className="dashboard-empty">
            <Target className="w-8 h-8" style={{ color: '#9ca3af' }} />
            <p>No campaigns yet. Create a campaign to organize your missions.</p>
          </div>
        ) : (
          <div className="campaign-cards">
            {campaignSummaries.map(campaign => {
              const healthColors = HEALTH_COLORS[campaign.health] || HEALTH_COLORS.on_track;
              const healthLabel = HEALTH_LABELS[campaign.health] || 'On Track';
              const objectiveLabel = getLabelById(OBJECTIVE_TYPES, campaign.objective_type);
              const priorityLabel = getLabelById(STRATEGIC_PRIORITIES, campaign.strategic_priority);

              return (
                <div
                  key={campaign.id}
                  className="campaign-card"
                  onClick={() => navigate(`/hunter/campaign/${campaign.id}`)}
                >
                  <div className="campaign-card-top">
                    <h3 className="campaign-card-name">{campaign.name}</h3>
                    <span
                      className="campaign-health-badge"
                      style={{
                        background: healthColors.bg,
                        borderColor: healthColors.border,
                        color: healthColors.text
                      }}
                    >
                      {healthLabel}
                    </span>
                  </div>

                  <div className="campaign-card-meta">
                    {objectiveLabel && (
                      <span className="campaign-meta-tag">{objectiveLabel}</span>
                    )}
                    {priorityLabel && (
                      <span className="campaign-meta-tag priority">{priorityLabel}</span>
                    )}
                  </div>

                  <div className="campaign-card-stats">
                    <div className="campaign-stat">
                      <Users className="w-4 h-4" />
                      <span>{campaign.totalContacts} contacts</span>
                    </div>
                    <div className="campaign-stat">
                      <Zap className="w-4 h-4" />
                      <span>{campaign.activeMissions} active</span>
                    </div>
                    <div className="campaign-stat">
                      <CheckCircle className="w-4 h-4" />
                      <span>{campaign.completedMissions} done</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Section 3: Mission Status View ─── */}
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="dashboard-panel-title">
            <Sparkles className="w-5 h-5" style={{ color: '#3b82f6' }} />
            <h2>Mission Status</h2>
          </div>
          <div className="dashboard-panel-filters">
            <select
              className="dashboard-filter-select"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setCampaignFilter('all'); }}
            >
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_GROUP_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
            {campaigns.length > 0 && (
              <select
                className="dashboard-filter-select"
                value={campaignFilter}
                onChange={e => { setCampaignFilter(e.target.value); setStatusFilter('all'); }}
              >
                <option value="all">All Campaigns</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="status-groups">
          {Object.entries(filteredStatusGroups).map(([groupKey, contacts]) => {
            const config = STATUS_GROUP_CONFIG[groupKey];
            if (!config || contacts.length === 0) return null;
            const GroupIcon = config.icon;

            return (
              <div key={groupKey} className="status-group">
                <div className="status-group-header">
                  <GroupIcon className="w-4 h-4" style={{ color: config.color }} />
                  <span className="status-group-label" style={{ color: config.color }}>
                    {config.label}
                  </span>
                  <span className="status-group-count">{contacts.length}</span>
                </div>
                <div className="status-group-contacts">
                  {contacts.map((contact, idx) => (
                    <div
                      key={`${contact.contactId}-${contact.missionId}-${idx}`}
                      className="status-contact-row"
                    >
                      <span
                        className="status-contact-name"
                        onClick={() => handleOpenContact(contact.contactId)}
                      >
                        {contact.contactName}
                      </span>
                      <span className="status-contact-mission">
                        {contact.missionName}
                      </span>
                      {contact.outcomeGoal && (
                        <span className="status-contact-goal">
                          {getLabelById(OUTCOME_GOALS, contact.outcomeGoal)}
                        </span>
                      )}
                      <button
                        className="btn-status-action"
                        onClick={() => handleOpenMission(contact.missionId)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Empty state when all groups are empty */}
          {Object.values(filteredStatusGroups).every(g => g.length === 0) && (
            <div className="dashboard-empty">
              <Target className="w-8 h-8" style={{ color: '#9ca3af' }} />
              <p>No contacts match the current filter.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Section 4: Recently Completed ─── */}
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="dashboard-panel-title">
            <CheckCircle className="w-5 h-5" style={{ color: '#10b981' }} />
            <h2>Recently Completed</h2>
          </div>
        </div>

        {recentlyCompleted.length === 0 ? (
          <div className="dashboard-empty">
            <CheckCircle className="w-8 h-8" style={{ color: '#9ca3af' }} />
            <p>No missions completed in the last 30 days.</p>
          </div>
        ) : (
          <div className="completed-list">
            {recentlyCompleted.map((item, idx) => (
              <div
                key={`${item.contactId}-${item.missionId}-${idx}`}
                className="completed-item"
              >
                <div className="completed-item-info">
                  <span
                    className="completed-contact-name"
                    onClick={() => handleOpenContact(item.contactId)}
                  >
                    {item.contactName}
                  </span>
                  <span className="completed-mission-name">{item.missionName}</span>
                  {item.outcomeGoal && (
                    <span className="completed-goal">
                      {getLabelById(OUTCOME_GOALS, item.outcomeGoal)}
                    </span>
                  )}
                </div>
                <div className="completed-item-date">
                  {new Date(item.completionDate).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
