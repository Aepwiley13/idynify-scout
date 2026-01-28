import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  X, Target, Plus, Mail, MessageSquare, Phone, Check,
  ArrowLeft, ArrowRight, Sparkles, Linkedin, Send, Loader, RefreshCw
} from 'lucide-react';
import './HunterContactDrawer.css';

/**
 * HUNTER CONTACT DRAWER - Intent-Driven Engagement (v3)
 *
 * CANONICAL HUNTER MODEL:
 * 1. Barry asks: "What do you want to do with [FirstName]?"
 * 2. User types their intent in FREE-FORM chat input (REQUIRED)
 * 3. Barry takes over - pulls RECON data, barryContext, enrichment
 * 4. Barry generates 3 REAL AI-powered message strategies
 * 5. User REACTS - picks a strategy, refines if needed
 * 6. User selects weapon (email/text/etc) and sends
 *
 * Philosophy: User leads with intent, Barry takes over with intelligence.
 * NO fallback templates - AI only.
 */

// Engagement Intents - relationship context (not pipeline stages)
const ENGAGEMENT_INTENTS = [
  { id: 'prospect', label: 'Prospect', description: 'Someone new I want to connect with' },
  { id: 'warm', label: 'Warm / Existing', description: 'Someone I already know' },
  { id: 'customer', label: 'Customer', description: 'An existing customer' },
  { id: 'partner', label: 'Partner', description: 'A business partner or collaborator' }
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
  const [userIntent, setUserIntent] = useState(''); // FREE-FORM user input (REQUIRED)
  const [engagementIntent, setEngagementIntent] = useState(contact?.engagementIntent || 'prospect');
  const [messageOptions, setMessageOptions] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [selectedMessage, setSelectedMessage] = useState(null); // Full message object with subject, body, reasoning
  const [selectedWeapon, setSelectedWeapon] = useState(null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [generationError, setGenerationError] = useState(null);

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
    setUserIntent('');
    setSelectedStrategy(null);
    setSelectedMessage(null);
    setSelectedWeapon(null);
    setMessage('');
    setSubject('');
    setMessageOptions([]);
    setGenerationError(null);
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

  // === USER INTENT SUBMISSION ===

  function handleIntentSubmit() {
    if (!userIntent.trim()) return;

    // Check if we need relationship context
    const hasExistingIntent = contact?.engagementIntent;
    if (!hasExistingIntent) {
      // Ask about relationship before generating
      setActiveView('intent');
    } else {
      // Go straight to generating with existing intent
      generateMessageOptions(userIntent, engagementIntent);
    }
  }

  // Handle Enter key in intent input
  function handleIntentKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleIntentSubmit();
    }
  }

  // === ENGAGEMENT INTENT ===

  function handleSelectIntent(intent) {
    setEngagementIntent(intent.id);
    // Save intent to contact (lightweight, non-blocking)
    saveIntentToContact(intent.id);
    // Generate messages with selected intent
    generateMessageOptions(userIntent, intent.id);
  }

  function handleSkipIntent() {
    // Use default (prospect) and continue
    generateMessageOptions(userIntent, 'prospect');
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

  // === MESSAGE GENERATION ===

  async function generateMessageOptions(intentText, relationshipIntent) {
    setLoading(true);
    setGenerationError(null);
    setActiveView('options');

    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      // Call Barry AI to generate 3 message strategies
      // This pulls RECON data, barryContext, and enrichment from the backend
      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          userIntent: intentText,           // FREE-FORM: What the user wants to do (PRIMARY DRIVER)
          engagementIntent: relationshipIntent, // Relationship context: prospect, warm, customer, partner
          barryContext: contact.barryContext,
          contact: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            title: contact.title || contact.current_position_title,
            company_name: contact.company_name || contact.current_company_name,
            company_industry: contact.company_industry || contact.industry,
            seniority: contact.seniority,
            email: contact.email,
            phone: contact.phone || contact.phone_mobile,
            linkedin_url: contact.linkedin_url
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate messages');
      }

      const data = await response.json();

      // Expect 3 message options with strategy, label, subject, message, and reasoning
      if (data.success && data.messages && data.messages.length >= 3) {
        setMessageOptions(data.messages);
      } else {
        throw new Error('Barry could not generate messages. Please try again.');
      }
    } catch (error) {
      console.error('Error generating messages:', error);
      setGenerationError(error.message || 'Something went wrong. Please try again.');
      // NO FALLBACK - AI only
    } finally {
      setLoading(false);
    }
  }

  // === STRATEGY & WEAPON SELECTION ===

  function handleSelectStrategy(option) {
    setSelectedStrategy(option.strategy);
    setSelectedMessage(option);
    setMessage(option.message);
    setSubject(option.subject || '');
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
          subject: subject || null,
          weapon: selectedWeapon,
          userIntent: userIntent,
          engagementIntent: engagementIntent,
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

          {/* === MAIN VIEW: Barry's Question + Chat Input === */}
          {activeView === 'main' && (
            <div className="drawer-main-view">
              {/* Barry's Question - Single line */}
              <div className="barry-question-section">
                <div className="barry-avatar">
                  <Sparkles className="w-5 h-5" />
                </div>
                <p className="barry-question">What do you want to do with {firstName}?</p>
              </div>

              {/* FREE-FORM Chat Input - THIS IS THE PRIMARY INTERFACE */}
              <div className="intent-input-section">
                <textarea
                  className="intent-input"
                  value={userIntent}
                  onChange={(e) => setUserIntent(e.target.value)}
                  onKeyDown={handleIntentKeyDown}
                  placeholder={`E.g., "I want to introduce myself and see if they need help with marketing automation" or "Follow up on our conversation at the conference last week"`}
                  rows={3}
                  autoFocus
                />
                <button
                  className="btn-primary-hunter btn-submit-intent"
                  onClick={handleIntentSubmit}
                  disabled={!userIntent.trim()}
                >
                  <Send className="w-5 h-5" />
                  Generate Messages
                </button>
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

          {/* === MESSAGE OPTIONS (3 AI-Generated Strategies) === */}
          {activeView === 'options' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => {
                setActiveView('main');
                setGenerationError(null);
              }}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              {loading ? (
                <div className="loading-state">
                  <Loader className="w-8 h-8 animate-spin" />
                  <p>Barry is analyzing and crafting your messages...</p>
                  <span className="loading-hint">Using RECON data and contact intelligence</span>
                </div>
              ) : generationError ? (
                <div className="error-state">
                  <div className="error-icon">!</div>
                  <p className="error-message">{generationError}</p>
                  <button
                    className="btn-primary-hunter"
                    onClick={() => generateMessageOptions(userIntent, engagementIntent)}
                  >
                    <RefreshCw className="w-5 h-5" />
                    Try Again
                  </button>
                </div>
              ) : (
                <>
                  <div className="barry-question-section">
                    <div className="barry-avatar">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <p className="barry-question">Here are three approaches. Pick one.</p>
                  </div>

                  {/* Show what user asked for */}
                  <div className="user-intent-summary">
                    <span className="intent-label-small">Your goal:</span>
                    <span className="intent-text-small">{userIntent}</span>
                  </div>

                  <div className="message-options-list">
                    {messageOptions.map((option, index) => (
                      <button
                        key={index}
                        className="message-option-card"
                        onClick={() => handleSelectStrategy(option)}
                      >
                        <div className="option-header">
                          <span className="option-strategy-label">{option.label || option.strategy}</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                        {option.subject && (
                          <p className="option-subject">Subject: {option.subject}</p>
                        )}
                        <p className="option-preview">{option.message}</p>
                        {option.reasoning && (
                          <p className="option-reasoning">{option.reasoning}</p>
                        )}
                      </button>
                    ))}
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

              {/* Show reasoning for selected strategy */}
              {selectedMessage?.reasoning && (
                <div className="strategy-reasoning">
                  <Sparkles className="w-4 h-4" />
                  <span>{selectedMessage.reasoning}</span>
                </div>
              )}

              <div className="message-preview-box">
                {subject && (
                  <>
                    <p className="message-preview-label">Subject:</p>
                    <input
                      type="text"
                      className="subject-input"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </>
                )}
                <p className="message-preview-label">Message:</p>
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
                {/* Show subject line for email */}
                {selectedWeapon === 'email' && subject && (
                  <>
                    <label>Subject</label>
                    <input
                      type="text"
                      className="subject-input-review"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </>
                )}
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
