/**
 * HUNTER WEAPON ROOM - Outcomes Section (Sprint 4 updated)
 *
 * Task 4.2: Mission performance signal — aggregate reply rate by
 * engagement style, surface a Barry insight card when one style
 * is clearly outperforming others.
 */
import { useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Target, Award, Sparkles, ArrowRight, Check } from 'lucide-react';
import './OutcomesSection.css';

// Engagement style labels used in mission.engagement_style
const STYLE_LABELS = {
  direct:    'Direct',
  warm:      'Warm',
  value_led: 'Value-Led',
  story:     'Story',
  question:  'Question',
  referral:  'Referral',
  cold:      'Cold',
  followup:  'Follow-Up',
};

export default function OutcomesSection({ campaigns = [], missions = [], onSetDefaultStyle }) {
  // ── Aggregate stats from old campaigns ──────────────────────────────────
  const campaignStats = useMemo(() => {
    let totalSent = 0, totalReplied = 0, totalMeetings = 0, totalOpportunities = 0;

    campaigns.forEach(campaign => {
      const items = campaign.contacts || campaign.messages || [];
      totalSent += items.filter(item => item.status === 'sent').length;
      if (campaign.contacts) {
        campaign.contacts.forEach(contact => {
          if (contact.outcome === 'replied') totalReplied++;
          if (contact.outcome === 'meeting_booked') totalMeetings++;
          if (contact.outcome === 'opportunity_created') totalOpportunities++;
        });
      }
    });

    const replyRate     = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : 0;
    const meetingRate   = totalSent > 0 ? ((totalMeetings / totalSent) * 100).toFixed(1) : 0;
    const opportunityRate = totalSent > 0 ? ((totalOpportunities / totalSent) * 100).toFixed(1) : 0;

    return { totalSent, totalReplied, totalMeetings, totalOpportunities, replyRate, meetingRate, opportunityRate };
  }, [campaigns]);

  // ── Task 4.2: Reply rate by engagement style (from missions) ──────────────
  const stylePerformance = useMemo(() => {
    const styleMap = {}; // style → { sent, replied }

    missions.forEach(mission => {
      const style = mission.engagement_style || mission.engagementStyle;
      if (!style) return;

      if (!styleMap[style]) styleMap[style] = { sent: 0, replied: 0 };

      (mission.contacts || []).forEach(contact => {
        const stepHistory = contact.stepHistory || [];
        const sent = stepHistory.filter(h => h.action === 'sent').length;
        const replied = contact.replyStatus === 'replied' ||
          contact.lastOutcome === 'replied_positive' ||
          (stepHistory.some(h => h.outcome === 'replied')) ? 1 : 0;

        styleMap[style].sent += sent;
        styleMap[style].replied += replied > 0 ? 1 : 0;
      });
    });

    return Object.entries(styleMap)
      .map(([style, data]) => ({
        style,
        label: STYLE_LABELS[style] || style,
        sent: data.sent,
        replied: data.replied,
        rate: data.sent > 0 ? data.replied / data.sent : 0,
        rateDisplay: data.sent > 0 ? ((data.replied / data.sent) * 100).toFixed(0) + '%' : '—',
      }))
      .filter(s => s.sent > 0)
      .sort((a, b) => b.rate - a.rate);
  }, [missions]);

  // Barry insight: surface if top style is at least 2x the next style
  const barryInsight = useMemo(() => {
    if (stylePerformance.length < 2) return null;
    const [top, second] = stylePerformance;
    if (top.rate <= 0 || second.rate <= 0) return null;
    const multiplier = (top.rate / second.rate).toFixed(1);
    if (multiplier < 1.5) return null;
    return { top, second, multiplier };
  }, [stylePerformance]);

  // Barry insight dismiss / apply state
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [insightApplied, setInsightApplied] = useState(false);

  function handleUseDefaultStyle() {
    setInsightApplied(true);
    if (onSetDefaultStyle && barryInsight) {
      onSetDefaultStyle(barryInsight.top.style);
    }
    setTimeout(() => setInsightDismissed(true), 1500);
  }

  function handleKeepSettings() {
    setInsightDismissed(true);
  }

  const hasData = campaigns.length > 0 || missions.length > 0;

  if (!hasData) {
    return (
      <div className="hunter-empty-state">
        <div className="hunter-empty-icon">
          <BarChart3 className="w-10 h-10" style={{ color: '#a78bfa' }} />
        </div>
        <h2 className="hunter-empty-title">No Data Yet</h2>
        <p className="hunter-empty-text">
          Launch missions and track outcomes to see analytics here
        </p>
      </div>
    );
  }

  return (
    <div className="outcomes-section">
      {/* ── Task 4.2: Barry Performance Insight Card ── */}
      {barryInsight && !insightDismissed && (
        <div className="barry-insight-card">
          <div className="barry-insight-header">
            <Sparkles className="w-4 h-4" />
            <span>Barry noticed something</span>
          </div>
          <p className="barry-insight-text">
            Your <strong>{barryInsight.top.label}</strong> approach is getting{' '}
            <strong>{barryInsight.multiplier}× more replies</strong> than{' '}
            {barryInsight.second.label} — want me to default to that style
            for new contacts going forward?
          </p>
          <div className="barry-insight-meta">
            <span className="barry-insight-stat">{barryInsight.top.label}: {barryInsight.top.rateDisplay} reply rate</span>
            <span className="barry-insight-stat">{barryInsight.second.label}: {barryInsight.second.rateDisplay} reply rate</span>
          </div>
          <div className="barry-insight-actions">
            <button className="barry-insight-btn" onClick={handleUseDefaultStyle} disabled={insightApplied}>
              {insightApplied ? <Check className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
              {insightApplied ? `${barryInsight.top.label} set as default` : `Use ${barryInsight.top.label} by default`}
            </button>
            <button className="barry-insight-btn barry-insight-btn--dismiss" onClick={handleKeepSettings}>
              Keep current settings
            </button>
          </div>
        </div>
      )}

      <div className="section-header">
        <div>
          <h2 className="section-title">Mission Outcomes</h2>
          <p className="section-description">
            Performance across {missions.length} mission{missions.length !== 1 ? 's' : ''}
            {campaigns.length > 0 ? ` and ${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      {/* Key Metrics (from campaigns — legacy model) */}
      {campaignStats.totalSent > 0 && (
        <div className="outcomes-metrics">
          <div className="outcome-metric-card">
            <div className="metric-icon" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
              <Target className="w-6 h-6" style={{ color: '#60a5fa' }} />
            </div>
            <div className="metric-info">
              <div className="metric-value">{campaignStats.totalSent}</div>
              <div className="metric-label">Emails Sent</div>
            </div>
          </div>
          <div className="outcome-metric-card">
            <div className="metric-icon" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
              <TrendingUp className="w-6 h-6" style={{ color: '#60a5fa' }} />
            </div>
            <div className="metric-info">
              <div className="metric-value">{campaignStats.totalReplied}</div>
              <div className="metric-label">Replies ({campaignStats.replyRate}%)</div>
            </div>
          </div>
          <div className="outcome-metric-card">
            <div className="metric-icon" style={{ background: 'rgba(16, 185, 129, 0.2)' }}>
              <Award className="w-6 h-6" style={{ color: '#10b981' }} />
            </div>
            <div className="metric-info">
              <div className="metric-value">{campaignStats.totalMeetings}</div>
              <div className="metric-label">Meetings ({campaignStats.meetingRate}%)</div>
            </div>
          </div>
          <div className="outcome-metric-card">
            <div className="metric-icon" style={{ background: 'rgba(139, 92, 246, 0.2)' }}>
              <BarChart3 className="w-6 h-6" style={{ color: '#a78bfa' }} />
            </div>
            <div className="metric-info">
              <div className="metric-value">{campaignStats.totalOpportunities}</div>
              <div className="metric-label">Opportunities ({campaignStats.opportunityRate}%)</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Task 4.2: Reply Rate by Approach Style ── */}
      {stylePerformance.length > 0 && (
        <div className="outcomes-breakdown">
          <h3 className="breakdown-title">Reply Rate by Approach Style</h3>
          <div className="breakdown-content">
            {stylePerformance.map((s, idx) => (
              <div key={s.style} className={`style-breakdown-card ${idx === 0 ? 'style-breakdown-card--top' : ''}`}>
                <div className="style-breakdown-header">
                  <span className="style-badge">{s.label}</span>
                  {idx === 0 && <span className="style-top-badge">Top performer</span>}
                </div>
                <div className="style-breakdown-bar">
                  <div
                    className="style-breakdown-fill"
                    style={{ width: `${Math.min(s.rate * 100, 100)}%` }}
                  />
                </div>
                <div className="style-breakdown-stats">
                  <span className="style-stat-rate">{s.rateDisplay}</span>
                  <span className="style-stat-counts">{s.replied} / {s.sent} contacts replied</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
