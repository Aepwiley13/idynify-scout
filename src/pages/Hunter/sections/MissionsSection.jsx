import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle, Clock, Sparkles, Target } from 'lucide-react';
import './MissionsSection.css';

/**
 * HUNTER WEAPON ROOM - Missions Section
 *
 * Purpose: View and manage active campaigns (missions)
 * Philosophy: Campaign list with stats and quick actions
 */

export default function MissionsSection({ campaigns, loading }) {
  const navigate = useNavigate();

  function getCampaignStats(campaign) {
    const items = campaign.contacts || campaign.messages || [];
    const total = items.length;
    const sent = items.filter(item => item.status === 'sent').length;
    const pending = total - sent;

    // Outcome stats (only for Phase 1+ campaigns with contacts)
    let outcomes = { replied: 0, meeting_booked: 0, opportunity_created: 0, no_response: 0 };
    if (campaign.contacts) {
      campaign.contacts.forEach(contact => {
        if (contact.outcome) {
          outcomes[contact.outcome] = (outcomes[contact.outcome] || 0) + 1;
        }
      });
    }

    return { total, sent, pending, outcomes };
  }

  if (loading) {
    return (
      <div className="hunter-loading">
        <div className="hunter-loading-spinner"></div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="hunter-empty-state">
        <div className="hunter-empty-icon">
          <Target className="w-10 h-10 text-purple-400" />
        </div>
        <h3 className="hunter-empty-title">No Active Missions</h3>
        <p className="hunter-empty-text">
          Build your first outreach mission using the Weapons tab
        </p>
      </div>
    );
  }

  return (
    <div className="missions-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Active Missions</h2>
          <p className="section-description">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} in progress</p>
        </div>
      </div>

      <div className="missions-grid">
        {campaigns.map(campaign => {
          const stats = getCampaignStats(campaign);
          const statusColor = {
            draft: 'text-slate-400 bg-slate-700/50',
            in_progress: 'text-blue-400 bg-blue-500/20',
            completed: 'text-green-400 bg-green-500/20'
          }[campaign.status] || 'text-slate-400 bg-slate-700/50';

          return (
            <div
              key={campaign.id}
              className="mission-card"
              onClick={() => navigate(`/hunter/campaign/${campaign.id}`)}
            >
              <div className="mission-card-header">
                <div className="mission-info">
                  <h3 className="mission-name">{campaign.name}</h3>
                  <div className="mission-badges">
                    <span className={`mission-status-badge ${statusColor}`}>
                      {campaign.status === 'in_progress' ? 'In Progress' : campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                    </span>
                    {campaign.reconUsed && (
                      <span className="mission-recon-badge">
                        <Sparkles className="w-3 h-3" />
                        RECON
                      </span>
                    )}
                    {campaign.engagementIntent && (
                      <span className="mission-intent-badge">
                        {campaign.engagementIntent}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mission-date">
                  {new Date(campaign.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div className="mission-card-stats">
                <div className="mission-stat">
                  <Mail className="w-4 h-4" />
                  <span>{stats.total} contacts</span>
                </div>
                <div className="mission-stat success">
                  <CheckCircle className="w-4 h-4" />
                  <span>{stats.sent} sent</span>
                </div>
                <div className="mission-stat pending">
                  <Clock className="w-4 h-4" />
                  <span>{stats.pending} pending</span>
                </div>
              </div>

              {/* Show outcomes if available */}
              {campaign.contacts && (stats.outcomes.replied > 0 || stats.outcomes.meeting_booked > 0 || stats.outcomes.opportunity_created > 0) && (
                <div className="mission-outcomes">
                  {stats.outcomes.replied > 0 && (
                    <span className="outcome-badge replied">{stats.outcomes.replied} replied</span>
                  )}
                  {stats.outcomes.meeting_booked > 0 && (
                    <span className="outcome-badge meeting">{stats.outcomes.meeting_booked} meetings</span>
                  )}
                  {stats.outcomes.opportunity_created > 0 && (
                    <span className="outcome-badge opportunity">{stats.outcomes.opportunity_created} opportunities</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
