import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle, Clock, Sparkles, Target, Plus, Zap } from 'lucide-react';
import './MissionsSection.css';

/**
 * HUNTER WEAPON ROOM - Missions Section
 *
 * Purpose: View and manage active missions (intent-driven orchestrations)
 * Philosophy: Goal-first mission management, not weapon-first campaigns
 */

export default function MissionsSection({ missions, loading }) {
  const navigate = useNavigate();

  function getMissionStats(mission) {
    const contacts = mission.contacts || [];
    const total = contacts.length;
    const active = contacts.filter(c => c.status === 'active').length;
    const completed = contacts.filter(c => c.status === 'completed').length;
    const activeSteps = mission.steps?.filter(s => s.enabled !== false).length || 0;

    // Outcome stats
    let outcomes = { replied: 0, meeting_booked: 0, opportunity_created: 0, no_response: 0 };
    contacts.forEach(contact => {
      if (contact.outcomes && contact.outcomes.length > 0) {
        contact.outcomes.forEach(outcome => {
          outcomes[outcome] = (outcomes[outcome] || 0) + 1;
        });
      }
    });

    return { total, active, completed, activeSteps, outcomes };
  }

  if (loading) {
    return (
      <div className="hunter-loading">
        <div className="hunter-loading-spinner"></div>
      </div>
    );
  }

  if (missions.length === 0) {
    return (
      <div className="hunter-empty-state">
        <div className="hunter-empty-icon">
          <Target className="w-10 h-10 text-purple-400" />
        </div>
        <h3 className="hunter-empty-title">No Active Missions</h3>
        <p className="hunter-empty-text">
          Create your first intent-driven mission. Tell Barry your goal, and he'll orchestrate the rest.
        </p>
        <button
          className="btn-primary-hunter"
          onClick={() => navigate('/hunter/create-mission')}
        >
          <Plus className="w-5 h-5" />
          Create Mission
        </button>
      </div>
    );
  }

  return (
    <div className="missions-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Active Missions</h2>
          <p className="section-description">{missions.length} mission{missions.length !== 1 ? 's' : ''} in progress</p>
        </div>
        <button
          className="btn-primary-hunter"
          onClick={() => navigate('/hunter/create-mission')}
        >
          <Plus className="w-5 h-5" />
          Create Mission
        </button>
      </div>

      <div className="missions-grid">
        {missions.map(mission => {
          const stats = getMissionStats(mission);
          const statusColor = {
            draft: 'text-slate-400 bg-slate-700/50',
            autopilot: 'text-green-400 bg-green-500/20',
            paused: 'text-yellow-400 bg-yellow-500/20',
            completed: 'text-blue-400 bg-blue-500/20'
          }[mission.status] || 'text-slate-400 bg-slate-700/50';

          const statusLabel = {
            draft: 'Draft',
            autopilot: 'Autopilot',
            paused: 'Paused',
            completed: 'Completed'
          }[mission.status] || 'Draft';

          return (
            <div
              key={mission.id}
              className="mission-card"
              onClick={() => navigate(`/hunter/mission/${mission.id}`)}
            >
              <div className="mission-card-header">
                <div className="mission-info">
                  <h3 className="mission-name">{mission.name}</h3>
                  <div className="mission-badges">
                    <span className={`mission-status-badge ${statusColor}`}>
                      {mission.status === 'autopilot' && <Zap className="w-3 h-3" />}
                      {statusLabel}
                    </span>
                    {mission.goalName && (
                      <span className="mission-goal-badge">
                        <Target className="w-3 h-3" />
                        {mission.goalName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mission-date">
                  {new Date(mission.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div className="mission-card-stats">
                <div className="mission-stat">
                  <Mail className="w-4 h-4" />
                  <span>{stats.total} contacts</span>
                </div>
                <div className="mission-stat success">
                  <CheckCircle className="w-4 h-4" />
                  <span>{stats.active} active</span>
                </div>
                <div className="mission-stat">
                  <Target className="w-4 h-4" />
                  <span>{stats.activeSteps} steps</span>
                </div>
              </div>

              {/* Show outcomes if available */}
              {(stats.outcomes.replied > 0 || stats.outcomes.meeting_booked > 0 || stats.outcomes.opportunity_created > 0) && (
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
