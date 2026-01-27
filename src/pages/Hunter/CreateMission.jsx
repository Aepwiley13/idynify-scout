import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, Users, Sparkles, Rocket, CheckCircle, Edit2, Trash2 } from 'lucide-react';
import { getAllGoals, createMissionFromTemplate } from '../../utils/missionTemplates';
import './CreateMission.css';

/**
 * CREATE MISSION WIZARD
 *
 * Intent-driven mission builder for Hunter.
 * Philosophy: User declares goal → Barry proposes orchestration → User approves → Autopilot
 *
 * Steps:
 * 1. Choose Goal (book meetings, warm conversations, re-engage)
 * 2. Review Barry's Orchestration (sequence of touchpoints)
 * 3. Edit Messages (optional tweaks to each step)
 * 4. Select Contacts (who to add to mission)
 * 5. Launch Mission (name it and put on autopilot)
 */

export default function CreateMission() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [missionData, setMissionData] = useState(null);
  const [allContacts, setAllContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [missionName, setMissionName] = useState('');
  const [loading, setLoading] = useState(false);

  const goals = getAllGoals();

  useEffect(() => {
    loadContacts();
  }, []);

  async function loadContacts() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setAllContacts(contactsList);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  }

  function handleSelectGoal(goal) {
    setSelectedGoal(goal);

    // Generate initial mission structure from template
    const mission = createMissionFromTemplate(goal.id, goal.defaultName);
    setMissionData(mission);
    setMissionName(mission.name);

    setCurrentStep(2);
  }

  function handleToggleStep(stepIndex) {
    const updated = { ...missionData };
    updated.steps[stepIndex].enabled = !updated.steps[stepIndex].enabled;
    setMissionData(updated);
  }

  function handleRemoveStep(stepIndex) {
    const updated = { ...missionData };
    updated.steps = updated.steps.filter((_, index) => index !== stepIndex);
    setMissionData(updated);
  }

  function handleEditStep(stepIndex) {
    // TODO: Open modal or inline editor for this step
    alert(`Edit step ${stepIndex + 1} - Coming soon: AI message generation`);
  }

  function toggleContactSelection(contactId) {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  async function handleLaunchMission() {
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Get selected contacts with full data
      const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));

      // Create final mission data
      const finalMission = {
        ...missionData,
        name: missionName || missionData.name,
        userId: user.uid,
        contacts: selectedContacts.map(contact => ({
          contactId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          email: contact.email || null,
          phone: contact.phone || null,
          currentStepIndex: 0,
          lastTouchDate: null,
          status: 'active',
          outcomes: []
        })),
        status: 'autopilot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to Firestore
      const docRef = await addDoc(collection(db, 'users', user.uid, 'missions'), finalMission);

      // Navigate to mission detail
      navigate(`/hunter/mission/${docRef.id}`);
    } catch (error) {
      console.error('Error launching mission:', error);
      alert('Failed to launch mission. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const canProceedToStep3 = missionData && missionData.steps.some(s => s.enabled);
  const canProceedToStep4 = canProceedToStep3; // Can skip message editing
  const canLaunch = selectedContactIds.length > 0 && missionName.trim() !== '';

  return (
    <div className="create-mission">
      {/* Header */}
      <div className="create-mission-header">
        <button className="btn-back" onClick={() => navigate('/hunter')}>
          <ArrowLeft className="w-5 h-5" />
          Back to Hunter
        </button>
        <div className="create-mission-progress">
          <span className={`progress-dot ${currentStep >= 1 ? 'active' : ''}`}>1</span>
          <div className={`progress-connector ${currentStep > 1 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 2 ? 'active' : ''}`}>2</span>
          <div className={`progress-connector ${currentStep > 2 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 3 ? 'active' : ''}`}>3</span>
          <div className={`progress-connector ${currentStep > 3 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 4 ? 'active' : ''}`}>4</span>
          <div className={`progress-connector ${currentStep > 4 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 5 ? 'active' : ''}`}>5</span>
        </div>
      </div>

      {/* Step 1: Choose Goal */}
      {currentStep === 1 && (
        <div className="mission-step">
          <div className="step-header">
            <Target className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">What's your goal?</h1>
            <p className="step-description">Choose the outcome you want to achieve</p>
          </div>

          <div className="goals-grid">
            {goals.map(goal => (
              <div
                key={goal.id}
                className="goal-card"
                onClick={() => handleSelectGoal(goal)}
              >
                <div className="goal-icon">{goal.icon}</div>
                <h3 className="goal-name">{goal.name}</h3>
                <p className="goal-description">{goal.description}</p>
                <div className="goal-steps-preview">
                  {goal.steps.length} touchpoints
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Review Orchestration */}
      {currentStep === 2 && missionData && (
        <div className="mission-step">
          <div className="step-header">
            <Sparkles className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Barry's Proposed Orchestration</h1>
            <p className="step-description">
              Review the sequence below. You can toggle steps on/off or remove them.
            </p>
          </div>

          <div className="orchestration-timeline">
            {missionData.steps.map((step, index) => (
              <div
                key={step.id}
                className={`timeline-step ${!step.enabled ? 'disabled' : ''}`}
              >
                <div className="timeline-marker">
                  <div className="timeline-dot"></div>
                  {index < missionData.steps.length - 1 && <div className="timeline-line"></div>}
                </div>
                <div className="timeline-content">
                  <div className="timeline-header">
                    <div className="timeline-info">
                      <span className="timeline-timing">{step.timing}</span>
                      <span className="timeline-label">{step.label}</span>
                    </div>
                    <div className="timeline-actions">
                      <button
                        className="btn-icon"
                        onClick={() => handleToggleStep(index)}
                        title={step.enabled ? 'Disable step' : 'Enable step'}
                      >
                        <CheckCircle className={`w-5 h-5 ${step.enabled ? 'text-green-400' : 'text-gray-500'}`} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => handleEditStep(index)}
                        title="Edit message"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => handleRemoveStep(index)}
                        title="Remove step"
                      >
                        <Trash2 className="w-5 h-5 text-red-400" />
                      </button>
                    </div>
                  </div>
                  <p className="timeline-description">{step.description}</p>
                  <div className="timeline-meta">
                    <span className="weapon-badge">{step.weapon}</span>
                    <span className="type-badge">{step.type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(1)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(4)} // Skip step 3 (message editing) for MVP
              disabled={!canProceedToStep3}
            >
              Next: Select Contacts →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Edit Messages (Placeholder - skip for MVP) */}
      {currentStep === 3 && (
        <div className="mission-step">
          <div className="step-header">
            <Edit2 className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Edit Messages</h1>
            <p className="step-description">Coming soon: AI-powered message generation</p>
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(4)}
              disabled={!canProceedToStep4}
            >
              Next: Select Contacts →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Select Contacts */}
      {currentStep === 4 && (
        <div className="mission-step">
          <div className="step-header">
            <Users className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Who should enter this mission?</h1>
            <p className="step-description">
              Selected: {selectedContactIds.length} contact{selectedContactIds.length !== 1 ? 's' : ''}
            </p>
          </div>

          {allContacts.length === 0 ? (
            <div className="empty-state">
              <Users className="w-12 h-12 text-gray-500" />
              <p>No contacts found. Add contacts in Scout first.</p>
              <button className="btn-primary-hunter" onClick={() => navigate('/scout')}>
                Go to Scout
              </button>
            </div>
          ) : (
            <div className="contacts-list">
              {allContacts.map(contact => (
                <div
                  key={contact.id}
                  className={`contact-item ${selectedContactIds.includes(contact.id) ? 'selected' : ''}`}
                  onClick={() => toggleContactSelection(contact.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedContactIds.includes(contact.id)}
                    onChange={() => {}}
                    className="contact-checkbox"
                  />
                  <div className="contact-info">
                    <div className="contact-name">{contact.firstName} {contact.lastName}</div>
                    <div className="contact-meta">
                      {contact.email && contact.email}
                      {contact.phone && ` • ${contact.phone}`}
                      {contact.title && ` • ${contact.title}`}
                      {contact.company_name && ` • ${contact.company_name}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(5)}
              disabled={selectedContactIds.length === 0}
            >
              Next: Launch Mission →
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Name & Launch */}
      {currentStep === 5 && (
        <div className="mission-step">
          <div className="step-header">
            <Rocket className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Ready to Launch</h1>
            <p className="step-description">Give your mission a name and put it on autopilot</p>
          </div>

          <div className="mission-summary">
            <div className="summary-card">
              <h3>Mission Summary</h3>
              <div className="summary-row">
                <span className="summary-label">Goal:</span>
                <span className="summary-value">{selectedGoal?.name}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Touchpoints:</span>
                <span className="summary-value">
                  {missionData.steps.filter(s => s.enabled).length} active steps
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Contacts:</span>
                <span className="summary-value">{selectedContactIds.length} people</span>
              </div>
            </div>

            <div className="mission-name-input">
              <label>Mission Name</label>
              <input
                type="text"
                value={missionName}
                onChange={(e) => setMissionName(e.target.value)}
                placeholder="e.g., Q1 Warm Outreach"
                className="form-input"
              />
            </div>
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={handleLaunchMission}
              disabled={!canLaunch || loading}
            >
              {loading ? 'Launching...' : (
                <>
                  <Rocket className="w-5 h-5" />
                  Launch Mission
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
