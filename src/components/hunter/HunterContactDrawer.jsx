import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  X, Target, Plus, Mail, MessageSquare, Phone, Edit2, Check,
  ArrowLeft, ArrowRight, Sparkles, Linkedin, Calendar, Send, Loader,
  UserPlus, CalendarCheck, RefreshCw, MessageCircle, PenTool
} from 'lucide-react';
import './HunterContactDrawer.css';

/**
 * HUNTER CONTACT DRAWER - Intent-Driven Engagement (v2)
 *
 * Flow:
 * 1. Barry asks: "What do you want to do with [Name]?"
 * 2. User picks quick action (Introduce, Book meeting, Follow up, Re-engage, Custom)
 * 3. (Optional) Engagement Intent confirmation if needed
 * 4. Barry generates 3 message strategies
 * 5. User picks strategy → weapon → review → send
 *
 * Philosophy: Barry leads, user reacts. Fewer questions > more intelligence.
 */

// Quick Actions - what user wants to accomplish
const QUICK_ACTIONS = [
  { id: 'introduce', label: 'Introduce myself', icon: UserPlus, inferredIntent: 'prospect' },
  { id: 'meeting', label: 'Book a meeting', icon: CalendarCheck, inferredIntent: null },
  { id: 'followup', label: 'Follow up', icon: MessageCircle, inferredIntent: 'warm' },
  { id: 'reengage', label: 'Re-engage', icon: RefreshCw, inferredIntent: 'warm' },
  { id: 'custom', label: 'Custom goal', icon: PenTool, inferredIntent: null }
];

// Engagement Intents - relationship context (not pipeline stages)
const ENGAGEMENT_INTENTS = [
  { id: 'prospect', label: 'Prospect', description: 'Someone new I want to connect with' },
  { id: 'warm', label: 'Warm / Existing', description: 'Someone I already know' },
  { id: 'customer', label: 'Customer', description: 'An existing customer' },
  { id: 'partner', label: 'Partner', description: 'A business partner or collaborator' }
];

// Message Strategy Labels
const MESSAGE_STRATEGIES = [
  { id: 'direct', label: 'Direct & Short', description: 'Gets to the point quickly' },
  { id: 'warm', label: 'Warm & Personal', description: 'Builds connection first' },
  { id: 'value', label: 'Value-Led', description: 'Leads with what you can offer' }
];

export default function HunterContactDrawer({ contact, isOpen, onClose, onContactUpdate }) {
  const navigate = useNavigate();

  // View states
  const [activeView, setActiveView] = useState('main');
  // Views: 'main', 'intent', 'options', 'weapon', 'review', 'success', 'add-mission', 'edit-info'

  // Data
  const [missions, setMissions] = useState([]);
  const [contactMissions, setContactMissions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Engagement flow state
  const [selectedAction, setSelectedAction] = useState(null);
  const [engagementIntent, setEngagementIntent] = useState(contact?.engagementIntent || 'prospect');
  const [messageOptions, setMessageOptions] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [selectedWeapon, setSelectedWeapon] = useState(null);
  const [message, setMessage] = useState('');
  const [customGoal, setCustomGoal] = useState('');

  // Edit info state
  const [editedContact, setEditedContact] = useState(contact);

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActiveView('main');
      resetEngagementState();
      // Load existing intent from contact
      setEngagementIntent(contact?.engagementIntent || 'prospect');
    }
  }, [isOpen, contact]);

  function resetEngagementState() {
    setSelectedAction(null);
    setSelectedStrategy(null);
    setSelectedWeapon(null);
    setMessage('');
    setMessageOptions([]);
    setCustomGoal('');
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

      setEditedContact(contact);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  // === QUICK ACTION SELECTION ===

  function handleSelectAction(action) {
    setSelectedAction(action);

    // Infer intent if action implies it
    if (action.inferredIntent) {
      setEngagementIntent(action.inferredIntent);
    }

    // Decide next step
    const hasExistingIntent = contact?.engagementIntent;
    const needsIntentPrompt = !hasExistingIntent && !action.inferredIntent;

    if (action.id === 'custom') {
      // Custom goal needs more input
      setActiveView('custom-goal');
    } else if (needsIntentPrompt) {
      // Need to ask about relationship
      setActiveView('intent');
    } else {
      // Go straight to generating options
      generateMessageOptions(action.id, action.inferredIntent || engagementIntent);
    }
  }

  // === ENGAGEMENT INTENT ===

  function handleSelectIntent(intent) {
    setEngagementIntent(intent.id);
    // Save intent to contact (lightweight, non-blocking)
    saveIntentToContact(intent.id);
    // Generate messages with selected intent
    generateMessageOptions(selectedAction.id, intent.id);
  }

  function handleSkipIntent() {
    // Use default (prospect) and continue
    generateMessageOptions(selectedAction.id, 'prospect');
  }

  async function saveIntentToContact(intentId) {
    try {
      const user = auth.currentUser;
      if (!user) return;

      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        engagementIntent: intentId,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error saving intent:', error);
      // Non-blocking - don't interrupt flow
    }
  }

  // === CUSTOM GOAL ===

  function handleCustomGoalSubmit() {
    if (!customGoal.trim()) return;

    const needsIntentPrompt = !contact?.engagementIntent;
    if (needsIntentPrompt) {
      setActiveView('intent');
    } else {
      generateMessageOptions('custom', engagementIntent);
    }
  }

  // === MESSAGE GENERATION ===

  async function generateMessageOptions(actionId, intentId) {
    setLoading(true);
    setActiveView('options');

    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      // Call AI to generate 3 message strategies
      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          action: actionId,
          intent: intentId,
          customGoal: customGoal || null,
          barryContext: contact.barryContext,
          contact: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title,
            company: contact.company_name,
            email: contact.email,
            phone: contact.phone
          }
        })
      });

      if (!response.ok) throw new Error('Failed to generate messages');

      const data = await response.json();

      // Expect 3 message options with strategy labels
      if (data.messages && data.messages.length > 0) {
        setMessageOptions(data.messages);
      } else {
        // Fallback: generate basic options
        setMessageOptions(generateFallbackMessages(actionId, intentId));
      }
    } catch (error) {
      console.error('Error generating messages:', error);
      // Use fallback messages
      setMessageOptions(generateFallbackMessages(actionId, intentId));
    } finally {
      setLoading(false);
    }
  }

  function generateFallbackMessages(actionId, intentId) {
    const firstName = contact.firstName || 'there';
    const isWarm = intentId === 'warm' || intentId === 'customer' || intentId === 'partner';

    const templates = {
      introduce: [
        { strategy: 'direct', message: `Hi ${firstName}, I wanted to reach out and introduce myself. Would love to connect.` },
        { strategy: 'warm', message: `Hi ${firstName}, I've been meaning to reach out. Your work at ${contact.company_name || 'your company'} caught my attention, and I'd love to connect.` },
        { strategy: 'value', message: `Hi ${firstName}, I help professionals like yourself with [your value prop]. Thought it might be worth a quick conversation.` }
      ],
      meeting: [
        { strategy: 'direct', message: `Hi ${firstName}, do you have 15 minutes this week to connect?` },
        { strategy: 'warm', message: `Hi ${firstName}, I'd love to catch up and hear what you're working on. Any time this week work for a quick call?` },
        { strategy: 'value', message: `Hi ${firstName}, I have some ideas that might help with [their challenge]. Would you be open to a brief chat?` }
      ],
      followup: [
        { strategy: 'direct', message: `Hi ${firstName}, just following up on my previous message. Let me know if you have any questions.` },
        { strategy: 'warm', message: `Hi ${firstName}, wanted to circle back and see how things are going. Hope all is well!` },
        { strategy: 'value', message: `Hi ${firstName}, I came across something that made me think of our conversation. Thought you might find it useful.` }
      ],
      reengage: [
        { strategy: 'direct', message: `Hi ${firstName}, it's been a while! Wanted to reconnect and see if there's anything I can help with.` },
        { strategy: 'warm', message: `Hi ${firstName}, I was thinking about you recently and wanted to reach out. How have you been?` },
        { strategy: 'value', message: `Hi ${firstName}, a lot has changed since we last connected. I'd love to share some updates that might be relevant for you.` }
      ],
      custom: [
        { strategy: 'direct', message: customGoal || `Hi ${firstName}, I wanted to reach out about something specific.` },
        { strategy: 'warm', message: `Hi ${firstName}, ${customGoal || "I've been thinking about reaching out and finally decided to do it."}` },
        { strategy: 'value', message: customGoal || `Hi ${firstName}, I have something that might be valuable for you.` }
      ]
    };

    return templates[actionId] || templates.introduce;
  }

  // === STRATEGY & WEAPON SELECTION ===

  function handleSelectStrategy(option) {
    setSelectedStrategy(option.strategy);
    setMessage(option.message);
    setActiveView('weapon');
  }

  function handleSelectWeapon(weapon) {
    setSelectedWeapon(weapon);
    setActiveView('review');
  }

  // === SEND MESSAGE ===

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
          weapon: selectedWeapon,
          action: selectedAction?.id,
          intent: engagementIntent,
          strategy: selectedStrategy
        }),
        last_contacted: new Date().toISOString(),
        engagementIntent: engagementIntent
      });

      setActiveView('success');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
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
  const firstName = contact.firstName || 'this person';

  return (
    <div className="hunter-contact-drawer-overlay" onClick={onClose}>
      <div className="hunter-contact-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title-section">
            <Target className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="drawer-title">Engage</h2>
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

          {/* === MAIN VIEW: Barry's Question === */}
          {activeView === 'main' && (
            <div className="drawer-main-view">
              {/* Barry's Question - Single line, no extras */}
              <div className="barry-question-section">
                <div className="barry-avatar">
                  <Sparkles className="w-5 h-5" />
                </div>
                <p className="barry-question">What do you want to do with {firstName}?</p>
              </div>

              {/* Quick Actions */}
              <div className="quick-actions-grid">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.id}
                    className="quick-action-btn"
                    onClick={() => handleSelectAction(action)}
                  >
                    <action.icon className="w-5 h-5" />
                    <span>{action.label}</span>
                    <ArrowRight className="w-4 h-4 action-arrow" />
                  </button>
                ))}
              </div>

              {/* Contact Info (Subtle) */}
              <div className="contact-info-subtle">
                <div className="info-row-subtle">
                  <Mail className="w-4 h-4" />
                  <span>{hasEmail ? contact.email : 'No email'}</span>
                  {!hasEmail && (
                    <button className="btn-add-subtle" onClick={() => setActiveView('edit-info')}>
                      Add
                    </button>
                  )}
                </div>
                <div className="info-row-subtle">
                  <Phone className="w-4 h-4" />
                  <span>{hasPhone ? contact.phone : 'No phone'}</span>
                  {!hasPhone && (
                    <button className="btn-add-subtle" onClick={() => setActiveView('edit-info')}>
                      Add
                    </button>
                  )}
                </div>
              </div>

              {/* Active Missions (if any) */}
              {contactMissions.length > 0 && (
                <div className="active-missions-subtle">
                  <span className="missions-label">In {contactMissions.length} active mission{contactMissions.length > 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Add to Mission (if missions exist) */}
              {missions.length > 0 && (
                <button
                  className="btn-add-mission-subtle"
                  onClick={() => setActiveView('add-mission')}
                >
                  <Plus className="w-4 h-4" />
                  Add to Mission
                </button>
              )}
            </div>
          )}

          {/* === CUSTOM GOAL INPUT === */}
          {activeView === 'custom-goal' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="barry-question-section">
                <div className="barry-avatar">
                  <Sparkles className="w-5 h-5" />
                </div>
                <p className="barry-question">What would you like to accomplish?</p>
              </div>

              <textarea
                className="custom-goal-input"
                value={customGoal}
                onChange={(e) => setCustomGoal(e.target.value)}
                placeholder="E.g., Ask about their new product launch, reconnect after the conference..."
                rows={3}
              />

              <button
                className="btn-primary-hunter"
                onClick={handleCustomGoalSubmit}
                disabled={!customGoal.trim()}
              >
                <ArrowRight className="w-5 h-5" />
                Continue
              </button>
            </div>
          )}

          {/* === INTENT SELECTION (Lightweight, Skippable) === */}
          {activeView === 'intent' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <div className="barry-question-section">
                <div className="barry-avatar">
                  <Sparkles className="w-5 h-5" />
                </div>
                <p className="barry-question">How would you describe your relationship with {firstName}?</p>
              </div>

              <div className="intent-options">
                {ENGAGEMENT_INTENTS.map(intent => (
                  <button
                    key={intent.id}
                    className="intent-option-btn"
                    onClick={() => handleSelectIntent(intent)}
                  >
                    <span className="intent-label">{intent.label}</span>
                    <span className="intent-description">{intent.description}</span>
                  </button>
                ))}
              </div>

              <button className="btn-skip" onClick={handleSkipIntent}>
                Skip this step
              </button>
            </div>
          )}

          {/* === MESSAGE OPTIONS (3 Strategies) === */}
          {activeView === 'options' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              {loading ? (
                <div className="loading-state">
                  <Loader className="w-8 h-8 animate-spin" />
                  <p>Barry is crafting your messages...</p>
                </div>
              ) : (
                <>
                  <div className="barry-question-section">
                    <div className="barry-avatar">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <p className="barry-question">Here are three approaches. Pick one.</p>
                  </div>

                  <div className="message-options-list">
                    {messageOptions.map((option, index) => {
                      const strategyInfo = MESSAGE_STRATEGIES.find(s => s.id === option.strategy) || MESSAGE_STRATEGIES[index];
                      return (
                        <button
                          key={index}
                          className="message-option-card"
                          onClick={() => handleSelectStrategy(option)}
                        >
                          <div className="option-header">
                            <span className="option-strategy-label">{strategyInfo?.label || option.strategy}</span>
                            <ArrowRight className="w-4 h-4" />
                          </div>
                          <p className="option-preview">{option.message}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* === WEAPON SELECTION === */}
          {activeView === 'weapon' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('options')}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <h3 className="view-title">How do you want to send this?</h3>

              <div className="message-preview-box">
                <p className="message-preview-label">Your message:</p>
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
                  <span>Text</span>
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
                  <Phone className="w-6 h-6" />
                  <span>Call</span>
                  {!hasPhone && <span className="weapon-disabled">No phone</span>}
                </button>
              </div>
            </div>
          )}

          {/* === REVIEW & SEND === */}
          {activeView === 'review' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('weapon')}>
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
