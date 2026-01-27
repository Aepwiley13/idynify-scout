import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Target, Zap, Mail, MessageSquare, Calendar, ArrowRight } from 'lucide-react';
import './ContactHunterActivity.css';

/**
 * CONTACT HUNTER ACTIVITY
 *
 * Shows Hunter activity for this contact directly in their profile.
 * User can see missions, messages, and next touchpoints without leaving the contact.
 */

export default function ContactHunterActivity({ contactId }) {
  const navigate = useNavigate();
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHunterActivity();
  }, [contactId]);

  async function loadHunterActivity() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Load missions where this contact is involved
      const missionsRef = collection(db, 'users', user.uid, 'missions');
      const missionsSnapshot = await getDocs(missionsRef);

      const contactMissions = missionsSnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(mission =>
          mission.contacts?.some(c => c.contactId === contactId)
        );

      setMissions(contactMissions);
      setLoading(false);
    } catch (error) {
      console.error('Error loading Hunter activity:', error);
      setLoading(false);
    }
  }

  function getContactInMission(mission) {
    return mission.contacts?.find(c => c.contactId === contactId);
  }

  function getNextStep(mission, contact) {
    const currentStepIndex = contact.currentStepIndex || 0;
    return mission.steps?.[currentStepIndex] || null;
  }

  function getStepIcon(weapon) {
    switch (weapon) {
      case 'email':
        return Mail;
      case 'text':
        return MessageSquare;
      case 'phone':
        return Calendar;
      default:
        return Target;
    }
  }

  if (loading) {
    return (
      <div className="contact-hunter-activity">
        <div className="activity-loading">Loading Hunter activity...</div>
      </div>
    );
  }

  if (missions.length === 0) {
    return null; // Don't show section if no activity
  }

  return (
    <div className="contact-hunter-activity">
      <div className="activity-header">
        <div className="activity-header-title">
          <Target className="w-5 h-5" />
          <h3>Hunter Activity</h3>
        </div>
        <span className="activity-count">{missions.length} mission{missions.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="activity-missions">
        {missions.map(mission => {
          const contact = getContactInMission(mission);
          const nextStep = getNextStep(mission, contact);
          const StepIcon = nextStep ? getStepIcon(nextStep.weapon) : Target;
          const progress = contact.currentStepIndex || 0;
          const totalSteps = mission.steps?.filter(s => s.enabled !== false).length || 0;
          const progressPercent = totalSteps > 0 ? (progress / totalSteps) * 100 : 0;

          return (
            <div
              key={mission.id}
              className="activity-mission-card"
              onClick={() => navigate(`/hunter/mission/${mission.id}`)}
            >
              <div className="mission-card-header">
                <div className="mission-card-info">
                  <h4 className="mission-card-name">{mission.name}</h4>
                  <span className="mission-card-goal">{mission.goalName}</span>
                </div>
                {mission.status === 'autopilot' && (
                  <div className="mission-status-badge autopilot">
                    <Zap className="w-3 h-3" />
                    <span>Autopilot</span>
                  </div>
                )}
              </div>

              <div className="mission-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <span className="progress-text">
                  {progress} / {totalSteps} steps completed
                </span>
              </div>

              {nextStep && (
                <div className="next-step">
                  <StepIcon className="w-4 h-4" />
                  <span className="next-step-label">Next:</span>
                  <span className="next-step-value">{nextStep.label}</span>
                  <span className="next-step-timing">{nextStep.timing}</span>
                </div>
              )}

              {contact.outcomes && contact.outcomes.length > 0 && (
                <div className="contact-outcomes">
                  {contact.outcomes.map((outcome, index) => (
                    <span key={index} className={`outcome-tag ${outcome}`}>
                      {outcome.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              )}

              <div className="view-mission-link">
                <span>View Mission</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
