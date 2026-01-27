import { BarChart3, TrendingUp, Target, Award } from 'lucide-react';
import './OutcomesSection.css';

/**
 * HUNTER WEAPON ROOM - Outcomes Section
 *
 * Purpose: Campaign performance analytics
 * Philosophy: Data-driven insights to improve outreach
 */

export default function OutcomesSection({ campaigns }) {
  // Calculate aggregate stats
  function calculateStats() {
    let totalSent = 0;
    let totalReplied = 0;
    let totalMeetings = 0;
    let totalOpportunities = 0;
    let totalNoResponse = 0;

    campaigns.forEach(campaign => {
      const items = campaign.contacts || campaign.messages || [];
      totalSent += items.filter(item => item.status === 'sent').length;

      if (campaign.contacts) {
        campaign.contacts.forEach(contact => {
          if (contact.outcome === 'replied') totalReplied++;
          if (contact.outcome === 'meeting_booked') totalMeetings++;
          if (contact.outcome === 'opportunity_created') totalOpportunities++;
          if (contact.outcome === 'no_response') totalNoResponse++;
        });
      }
    });

    const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : 0;
    const meetingRate = totalSent > 0 ? ((totalMeetings / totalSent) * 100).toFixed(1) : 0;
    const opportunityRate = totalSent > 0 ? ((totalOpportunities / totalSent) * 100).toFixed(1) : 0;

    return {
      totalSent,
      totalReplied,
      totalMeetings,
      totalOpportunities,
      totalNoResponse,
      replyRate,
      meetingRate,
      opportunityRate
    };
  }

  const stats = calculateStats();

  if (campaigns.length === 0) {
    return (
      <div className="hunter-empty-state">
        <div className="hunter-empty-icon">
          <BarChart3 className="w-10 h-10 text-purple-400" />
        </div>
        <h3 className="hunter-empty-title">No Data Yet</h3>
        <p className="hunter-empty-text">
          Launch campaigns and track outcomes to see analytics here
        </p>
      </div>
    );
  }

  return (
    <div className="outcomes-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Mission Outcomes</h2>
          <p className="section-description">
            Performance across {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="outcomes-metrics">
        <div className="outcome-metric-card">
          <div className="metric-icon" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
            <Target className="w-6 h-6" style={{ color: '#60a5fa' }} />
          </div>
          <div className="metric-info">
            <div className="metric-value">{stats.totalSent}</div>
            <div className="metric-label">Emails Sent</div>
          </div>
        </div>

        <div className="outcome-metric-card">
          <div className="metric-icon" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
            <TrendingUp className="w-6 h-6" style={{ color: '#60a5fa' }} />
          </div>
          <div className="metric-info">
            <div className="metric-value">{stats.totalReplied}</div>
            <div className="metric-label">Replies ({stats.replyRate}%)</div>
          </div>
        </div>

        <div className="outcome-metric-card">
          <div className="metric-icon" style={{ background: 'rgba(16, 185, 129, 0.2)' }}>
            <Award className="w-6 h-6" style={{ color: '#10b981' }} />
          </div>
          <div className="metric-info">
            <div className="metric-value">{stats.totalMeetings}</div>
            <div className="metric-label">Meetings ({stats.meetingRate}%)</div>
          </div>
        </div>

        <div className="outcome-metric-card">
          <div className="metric-icon" style={{ background: 'rgba(139, 92, 246, 0.2)' }}>
            <BarChart3 className="w-6 h-6" style={{ color: '#a78bfa' }} />
          </div>
          <div className="metric-info">
            <div className="metric-value">{stats.totalOpportunities}</div>
            <div className="metric-label">Opportunities ({stats.opportunityRate}%)</div>
          </div>
        </div>
      </div>

      {/* Breakdown by Intent (if available) */}
      <div className="outcomes-breakdown">
        <h3 className="breakdown-title">Performance by Intent</h3>
        <div className="breakdown-content">
          {['cold', 'warm', 'hot', 'followup'].map(intent => {
            const intentCampaigns = campaigns.filter(c => c.engagementIntent === intent);
            if (intentCampaigns.length === 0) return null;

            let intentSent = 0;
            let intentReplied = 0;

            intentCampaigns.forEach(campaign => {
              const items = campaign.contacts || campaign.messages || [];
              intentSent += items.filter(item => item.status === 'sent').length;

              if (campaign.contacts) {
                campaign.contacts.forEach(contact => {
                  if (contact.outcome === 'replied') intentReplied++;
                });
              }
            });

            const intentReplyRate = intentSent > 0 ? ((intentReplied / intentSent) * 100).toFixed(1) : 0;

            return (
              <div key={intent} className="intent-breakdown-card">
                <div className="intent-breakdown-header">
                  <span className="intent-badge" data-intent={intent}>{intent}</span>
                  <span className="intent-campaigns">{intentCampaigns.length} campaigns</span>
                </div>
                <div className="intent-breakdown-stats">
                  <div className="intent-stat">
                    <span className="intent-stat-value">{intentSent}</span>
                    <span className="intent-stat-label">Sent</span>
                  </div>
                  <div className="intent-stat">
                    <span className="intent-stat-value">{intentReplied}</span>
                    <span className="intent-stat-label">Replied</span>
                  </div>
                  <div className="intent-stat">
                    <span className="intent-stat-value">{intentReplyRate}%</span>
                    <span className="intent-stat-label">Reply Rate</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
