import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  X, Target, Plus, Mail, MessageSquare, Phone, Edit2, Check,
  ArrowLeft, ArrowRight, Sparkles, Linkedin, Calendar, Send, Loader
} from 'lucide-react';
import { getAllGoals } from '../../utils/missionTemplates';
import './HunterContactDrawer.css';

/**
 * HUNTER CONTACT DRAWER - Intent-Driven Engagement
 *
 * Two Primary Paths:
 * 1. Quick Engage: User picks Barry's suggestion → weapon → send
 * 2. Custom Engage: User sets goal → Barry generates → weapon → send
 *
 * Philosophy: User can always act. No blocking states.
 */

export default function HunterContactDrawer({ contact, isOpen, onClose, onContactUpdate }) {
  const navigate = useNavigate();

  // View states
  const [activeView, setActiveView] = useState('main');
  // Possible views: 'main', 'quick-weapon', 'quick-review', 'engage-goal', 'engage-message',
  // 'engage-weapon', 'engage-review', 'success', 'add-mission', 'edit-info'

  // Data
  const [missions, setMissions] = useState([]);
  const [contactMissions, setContactMissions] = useState([]);
  const [barrySuggestions, setBarrySuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Engagement flow state
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [selectedWeapon, setSelectedWeapon] = useState(null);
  const [message, setMessage] = useState('');
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [userInput, setUserInput] = useState('');

  // Edit info state
  const [editedContact, setEditedContact] = useState(contact);

  const goals = getAllGoals();

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActiveView('main');
      resetEngagementState();
    }
  }, [isOpen, contact]);

  function resetEngagementState() {
    setSelectedSuggestion(null);
    setSelectedWeapon(null);
    setMessage('');
    setSelectedGoal(null);
    setUserInput('');
  }

  async function loadData() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Load missions
      const missionsRef = collection(db, 'users', user.uid, 'missions');
      const missionsSnapshot = await getDocs(missionsRef);
      const missionsList = missionsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(m => m.status === 'autopilot' || m.status === 'draft');
      setMissions(missionsList);

      // Find missions contact is in
      const inMissions = missionsList.filter(mission =>
        mission.contacts?.some(c => c.contactId === contact.id)
      );
      setContactMissions(inMissions);

      // Load Barry suggestions
      if (contact.barryContext?.icebreakers) {
        setBarrySuggestions(contact.barryContext.icebreakers);
      } else if (contact.barryContext?.conversationStarters) {
        setBarrySuggestions(contact.barryContext.conversationStarters);
      }

      setEditedContact(contact);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  // === QUICK ENGAGE FLOW ===

  function handleQuickEngage(suggestion) {
    setSelectedSuggestion(suggestion);
    setMessage(suggestion);
    setActiveView('quick-weapon');
  }

  function handleSelectWeapon(weapon) {
    setSelectedWeapon(weapon);
    if (activeView === 'quick-weapon') {
      setActiveView('quick-review');
    } else if (activeView === 'engage-weapon') {
      setActiveView('engage-review');
    }
  }

  async function handleSendMessage() {
    setLoading(true);
    try {
      const user = auth.currentUser;

      // Save to activity log
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        activity_log: arrayUnion({
          type: `${selectedWeapon}_sent`,
          timestamp: new Date().toISOString(),
          message: message,
          weapon: selectedWeapon
        }),
        last_contacted: new Date().toISOString()
      });

      setActiveView('success');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // === CUSTOM ENGAGE FLOW ===

  function handleSelectGoal(goal) {
    setSelectedGoal(goal);
    setActiveView('engage-message');
  }

  async function handleGenerateMessage() {
    setLoading(true);
    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      // Call AI to generate message
      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          goal: selectedGoal.id,
          userInput: userInput,
          barryContext: contact.barryContext
        })
      });

      if (!response.ok) throw new Error('Failed to generate message');

      const data = await response.json();
      setMessage(data.message);
      setActiveView('engage-weapon');
    } catch (error) {
      console.error('Error generating message:', error);
      // Fallback: use user input
      setMessage(userInput || 'Hello, I wanted to reach out...');
      setActiveView('engage-weapon');
    } finally {
      setLoading(false);
    }
  }

  // === ADD TO MISSION ===

  async function handleAddToMission(missionId) {
    setLoading(true);
    try {
      const user = auth.currentUser;
      const mission = missions.find(m => m.id === missionId);

      const updatedContacts = [
        ...(mission.contacts || []),
        {
          contactId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          email: contact.email || null,
          phone: contact.phone || null,
          currentStepIndex: 0,
          lastTouchDate: null,
          status: 'active',
          outcomes: []
        }
      ];

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString()
      });

      alert(`${contact.firstName} added to mission!`);
      loadData();
      setActiveView('main');
    } catch (error) {
      console.error('Error adding to mission:', error);
      alert('Failed to add to mission. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // === EDIT INFO ===

  async function handleSaveContactInfo() {
    setLoading(true);
    try {
      const user = auth.currentUser;
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        email: editedContact.email,
        phone: editedContact.phone,
        updatedAt: new Date().toISOString()
      });

      onContactUpdate(editedContact);
      alert('Contact info updated!');
      setActiveView('main');
    } catch (error) {
      console.error('Error updating contact:', error);
      alert('Failed to update contact. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const hasEmail = contact.email && contact.email.trim() !== '';
  const hasPhone = contact.phone && contact.phone.trim() !== '';
  const characterCount = message.length;
  const smsCount = characterCount <= 160 ? 1 : Math.ceil(characterCount / 153);

  return (
    <div className="hunter-contact-drawer-overlay" onClick={onClose}>
      <div className="hunter-contact-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title-section">
            <Target className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="drawer-title">Hunter</h2>
              <p className="drawer-subtitle">
                {contact.firstName} {contact.lastName}
              </p>
            </div>
          </div>
          <button className="btn-close-drawer" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="drawer-content">

          {/* === MAIN VIEW === */}
          {activeView === 'main' && (
            <div className="drawer-main-view">
              {/* Contact Info Status */}
              <div className="contact-info-status">
                <div className="info-item">
                  <Mail className="w-4 h-4" />
                  <span>{hasEmail ? contact.email : 'No email'}</span>
                  {!hasEmail && (
                    <button
                      className="btn-add-info"
                      onClick={() => setActiveView('edit-info')}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  )}
                </div>
                <div className="info-item">
                  <Phone className="w-4 h-4" />
                  <span>{hasPhone ? contact.phone : 'No phone'}</span>
                  {!hasPhone && (
                    <button
                      className="btn-add-info"
                      onClick={() => setActiveView('edit-info')}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  )}
                </div>
                <button
                  className="btn-edit-info"
                  onClick={() => setActiveView('edit-info')}
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Info
                </button>
              </div>

              {/* Barry's Quick Engage Section */}
              <div className="drawer-section barry-suggestions-section">
                <h3 className="section-title">
                  <Sparkles className="w-5 h-5" />
                  Barry Suggests
                </h3>

                {barrySuggestions.length > 0 ? (
                  <div className="barry-suggestions">
                    {barrySuggestions.slice(0, 3).map((suggestion, index) => (
                      <button
                        key={index}
                        className="suggestion-button"
                        onClick={() => handleQuickEngage(suggestion)}
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>{suggestion}</span>
                        <ArrowRight className="w-4 h-4 ml-auto" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="barry-fallback">
                    <p className="barry-thinking">Barry is analyzing this contact...</p>
                  </div>
                )}
              </div>

              {/* Current Missions */}
              {contactMissions.length > 0 && (
                <div className="drawer-section">
                  <h3 className="section-title">Active Missions</h3>
                  <div className="missions-list">
                    {contactMissions.map(mission => (
                      <div key={mission.id} className="mission-item">
                        <div className="mission-item-header">
                          <span className="mission-name">{mission.name}</span>
                          <span className="mission-goal">{mission.goalName}</span>
                        </div>
                        <div className="mission-item-status">
                          <Check className="w-3 h-3" />
                          <span>
                            {mission.contacts?.find(c => c.contactId === contact.id)?.currentStepIndex || 0} / {mission.steps?.length || 0} steps
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="drawer-section">
                <div className="action-buttons">
                  <button
                    className="action-btn primary"
                    onClick={() => setActiveView('engage-goal')}
                  >
                    <Target className="w-5 h-5" />
                    <span>Engage</span>
                  </button>

                  {missions.length > 0 && (
                    <button
                      className="action-btn secondary"
                      onClick={() => setActiveView('add-mission')}
                    >
                      <Plus className="w-5 h-5" />
                      <span>Add to Mission</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === QUICK ENGAGE: WEAPON SELECTION === */}
          {activeView === 'quick-weapon' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">How do you want to send this?</h3>

              <div className="message-preview-box">
                <p className="message-preview-label">Message:</p>
                <textarea
                  className="message-preview-text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />
                <button className="btn-edit-inline" onClick={() => {}}>
                  <Edit2 className="w-4 h-4" />
                  Edit Message
                </button>
              </div>

              <div className="weapons-grid">
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('email')}
                  disabled={!hasEmail}
                >
                  <Mail className="w-6 h-6" />
                  <span>Email</span>
                  {!hasEmail && <span className="weapon-disabled">No email</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('text')}
                  disabled={!hasPhone}
                >
                  <MessageSquare className="w-6 h-6" />
                  <span>Text Message</span>
                  {!hasPhone && <span className="weapon-disabled">No phone</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('linkedin')}
                  disabled
                >
                  <Linkedin className="w-6 h-6" />
                  <span>LinkedIn</span>
                  <span className="weapon-disabled">Coming soon</span>
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('call')}
                  disabled={!hasPhone}
                >
                  <Calendar className="w-6 h-6" />
                  <span>Call (reminder)</span>
                  {!hasPhone && <span className="weapon-disabled">No phone</span>}
                </button>
              </div>
            </div>
          )}

          {/* === QUICK ENGAGE: REVIEW & SEND === */}
          {activeView === 'quick-review' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('quick-weapon')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">Review & Send</h3>
              <p className="view-description">
                Sending via {selectedWeapon} to {contact.firstName} {contact.lastName}
              </p>

              <div className="message-review">
                <label>Your Message</label>
                <textarea
                  className="message-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                />
                {selectedWeapon === 'text' && (
                  <span className="character-count">
                    {characterCount} characters ({smsCount} SMS)
                  </span>
                )}
              </div>

              <button
                className="btn-primary-hunter btn-send"
                onClick={handleSendMessage}
                disabled={!message || loading}
              >
                {loading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Message
                  </>
                )}
              </button>
            </div>
          )}

          {/* === CUSTOM ENGAGE: GOAL SELECTION === */}
          {activeView === 'engage-goal' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">What's your goal?</h3>

              <div className="goals-grid-drawer">
                {goals.map(goal => (
                  <button
                    key={goal.id}
                    className="goal-card-drawer"
                    onClick={() => handleSelectGoal(goal)}
                  >
                    <span className="goal-icon-drawer">{goal.icon}</span>
                    <span className="goal-name-drawer">{goal.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* === CUSTOM ENGAGE: MESSAGE INPUT === */}
          {activeView === 'engage-message' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('engage-goal')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">What do you want to say?</h3>
              <p className="view-description">
                Goal: {selectedGoal?.name}
              </p>

              <div className="message-input-section">
                <label>Your message or key points</label>
                <textarea
                  className="message-textarea"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  rows={5}
                  placeholder="E.g., I'd like to discuss how we can help with employee training..."
                />
              </div>

              {barrySuggestions.length > 0 && (
                <div className="suggestions-fallback">
                  <p className="suggestions-label">Or use a suggestion:</p>
                  {barrySuggestions.slice(0, 2).map((suggestion, index) => (
                    <button
                      key={index}
                      className="suggestion-chip"
                      onClick={() => setUserInput(suggestion)}
                    >
                      {suggestion.substring(0, 60)}...
                    </button>
                  ))}
                </div>
              )}

              <button
                className="btn-primary-hunter"
                onClick={handleGenerateMessage}
                disabled={!userInput || loading}
              >
                {loading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Message
                  </>
                )}
              </button>
            </div>
          )}

          {/* === CUSTOM ENGAGE: WEAPON SELECTION === */}
          {activeView === 'engage-weapon' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('engage-message')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">How do you want to send this?</h3>

              <div className="message-preview-box">
                <p className="message-preview-label">Generated Message:</p>
                <textarea
                  className="message-preview-text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />
              </div>

              <div className="weapons-grid">
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('email')}
                  disabled={!hasEmail}
                >
                  <Mail className="w-6 h-6" />
                  <span>Email</span>
                  {!hasEmail && <span className="weapon-disabled">No email</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('text')}
                  disabled={!hasPhone}
                >
                  <MessageSquare className="w-6 h-6" />
                  <span>Text Message</span>
                  {!hasPhone && <span className="weapon-disabled">No phone</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('linkedin')}
                  disabled
                >
                  <Linkedin className="w-6 h-6" />
                  <span>LinkedIn</span>
                  <span className="weapon-disabled">Coming soon</span>
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('call')}
                  disabled={!hasPhone}
                >
                  <Calendar className="w-6 h-6" />
                  <span>Call (reminder)</span>
                  {!hasPhone && <span className="weapon-disabled">No phone</span>}
                </button>
              </div>
            </div>
          )}

          {/* === CUSTOM ENGAGE: REVIEW & SEND === */}
          {activeView === 'engage-review' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('engage-weapon')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">Review & Send</h3>
              <p className="view-description">
                Sending via {selectedWeapon} to {contact.firstName} {contact.lastName}
              </p>

              <div className="message-review">
                <label>Your Message</label>
                <textarea
                  className="message-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                />
                {selectedWeapon === 'text' && (
                  <span className="character-count">
                    {characterCount} characters ({smsCount} SMS)
                  </span>
                )}
              </div>

              <button
                className="btn-primary-hunter btn-send"
                onClick={handleSendMessage}
                disabled={!message || loading}
              >
                {loading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Message
                  </>
                )}
              </button>
            </div>
          )}

          {/* === SUCCESS VIEW === */}
          {activeView === 'success' && (
            <div className="drawer-view success-view">
              <div className="success-icon">
                <Check className="w-16 h-16" />
              </div>
              <h3 className="success-title">Message Sent!</h3>
              <p className="success-description">
                Your message to {contact.firstName} {contact.lastName} has been sent via {selectedWeapon}.
              </p>

              <div className="success-actions">
                <button
                  className="btn-primary-hunter"
                  onClick={() => {
                    resetEngagementState();
                    setActiveView('main');
                  }}
                >
                  Send Another Message
                </button>
                {missions.length > 0 && (
                  <button
                    className="btn-secondary"
                    onClick={() => setActiveView('add-mission')}
                  >
                    <Plus className="w-5 h-5" />
                    Add to Mission
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* === ADD TO MISSION === */}
          {activeView === 'add-mission' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">Add to Mission</h3>

              <div className="missions-list">
                {missions.map(mission => (
                  <div
                    key={mission.id}
                    className="mission-select-item"
                    onClick={() => handleAddToMission(mission.id)}
                  >
                    <div className="mission-info">
                      <span className="mission-name">{mission.name}</span>
                      <span className="mission-goal">{mission.goalName}</span>
                    </div>
                    <div className="mission-stats">
                      <span>{mission.contacts?.length || 0} contacts</span>
                      <span>•</span>
                      <span>{mission.steps?.filter(s => s.enabled !== false).length || 0} steps</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* === EDIT INFO === */}
          {activeView === 'edit-info' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">Edit Contact Info</h3>

              <div className="edit-form">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={editedContact.email || ''}
                    onChange={(e) => setEditedContact({ ...editedContact, email: e.target.value })}
                    placeholder="email@example.com"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={editedContact.phone || ''}
                    onChange={(e) => setEditedContact({ ...editedContact, phone: e.target.value })}
                    placeholder="+1 (555) 123-4567"
                    className="form-input"
                  />
                </div>
                <button
                  className="btn-primary-hunter"
                  onClick={handleSaveContactInfo}
                  disabled={loading}
                >
                  <Check className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
