/**
 * Campaign cards — extracted from DashboardSection's "Active Campaigns" panel
 * so Hunter → Campaigns and the dashboard render the same cards.
 *
 * Badge:
 *   - Mission health, when the campaign has linked missions in `summaries`
 *     (totalMissions > 0). Health is computed from those missions.
 *   - Otherwise, with `showStatus`, the campaign's own status. Campaigns from
 *     the wizard never link missions, so their "health" would always read
 *     On Track whatever state they were in.
 *   - Without `showStatus` (the dashboard), health always — unchanged behaviour.
 *
 * Props:
 *   summaries  — from buildCampaignSummaries(); may carry `status`
 *   showStatus — prefer campaign status when there is no mission data
 */
import { useNavigate } from 'react-router-dom';
import { Users, Zap, CheckCircle, Calendar } from 'lucide-react';
import { HEALTH_LABELS, HEALTH_COLORS } from '../../../utils/dashboardEngine';
import {
  getLabelById,
  OBJECTIVE_TYPES,
  STRATEGIC_PRIORITIES
} from '../../../constants/structuredFields';
import './DashboardSection.css';

// Campaign-level statuses written today: draft (wizard), in_progress, completed.
const STATUS_BADGES = {
  draft:       { bg: 'var(--bg-secondary)',      border: 'var(--border-2)',            text: 'var(--text-secondary)' },
  in_progress: { bg: 'var(--accent-bg)',         border: 'var(--accent-border)',       text: 'var(--text-primary)' },
  completed:   { bg: 'var(--status-success-bg)', border: 'rgba(16, 185, 129, 0.3)',    text: 'var(--text-primary)' },
};

// Same wording as CampaignDetail's status pill.
export function campaignStatusLabel(status) {
  if (!status) return 'Draft';
  if (status === 'in_progress') return 'In Progress';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function CampaignCards({ summaries, showStatus = false }) {
  const navigate = useNavigate();

  return (
    <div className="campaign-cards">
      {summaries.map(campaign => {
        const hasMissions = campaign.totalMissions > 0;
        const useHealth = hasMissions || !showStatus;

        const badge = useHealth
          ? {
              label: HEALTH_LABELS[campaign.health] || 'On Track',
              colors: HEALTH_COLORS[campaign.health] || HEALTH_COLORS.on_track,
            }
          : {
              label: campaignStatusLabel(campaign.status),
              colors: STATUS_BADGES[campaign.status || 'draft'] || STATUS_BADGES.draft,
            };

        const objectiveLabel = getLabelById(OBJECTIVE_TYPES, campaign.objective_type);
        const priorityLabel = getLabelById(STRATEGIC_PRIORITIES, campaign.strategic_priority);
        const created = toDate(campaign.createdAt);
        const open = () => navigate(`/hunter/campaign/${campaign.id}`);

        return (
          <div
            key={campaign.id}
            className="campaign-card"
            role="link"
            tabIndex={0}
            aria-label={`Open campaign ${campaign.name || 'Untitled campaign'}`}
            onClick={open}
            onKeyDown={e => { if (e.key === 'Enter') open(); }}
          >
            <div className="campaign-card-top">
              <h3 className="campaign-card-name">{campaign.name || 'Untitled campaign'}</h3>
              <span
                className="campaign-health-badge"
                style={{
                  background: badge.colors.bg,
                  borderColor: badge.colors.border,
                  color: badge.colors.text
                }}
              >
                {badge.label}
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
              {useHealth ? (
                <>
                  <div className="campaign-stat">
                    <Zap className="w-4 h-4" />
                    <span>{campaign.activeMissions} active</span>
                  </div>
                  <div className="campaign-stat">
                    <CheckCircle className="w-4 h-4" />
                    <span>{campaign.completedMissions} done</span>
                  </div>
                </>
              ) : created && (
                <div className="campaign-stat">
                  <Calendar className="w-4 h-4" />
                  <span>{created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
