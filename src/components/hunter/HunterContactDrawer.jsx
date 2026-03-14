import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, updateDoc, doc, arrayUnion, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  X, Target, Plus, Mail, MessageSquare, Phone, Check,
  ArrowLeft, ArrowRight, Sparkles, Linkedin, Send, Loader, RefreshCw,
  ExternalLink, Calendar, AlertCircle, Lock
} from 'lucide-react';
import { useSubscription } from '../../hooks/useSubscription';
import {
  executeSendAction,
  resolveSendMethod,
  checkGmailConnection,
  checkCalendarConnection,
  CHANNELS,
  SEND_RESULT,
  getActionLabels
} from '../../utils/sendActionResolver';
import ContactCalendarView from './ContactCalendarView';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS, getContactStatus } from '../../utils/contactStateMachine';
import { getSequencePlan } from '../../utils/sequenceEngine';
import { generateContactRecommendations, dismissRecommendation } from '../../utils/recommendationEngine';
import BarryRecommendationCard from './BarryRecommendationCard';
import BarryWarningCard from './BarryWarningCard';
import BarryInsightsCard from './BarryInsightsCard';
import SequencePanel from './SequencePanel';
import LearningToast from '../LearningToast';
import { EmailDraftCard } from '../shared/EmailDraftCard';
import './HunterContactDrawer.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

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
  const { isProTier } = useSubscription();

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

  // Gmail connection status
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailChecking, setGmailChecking] = useState(false);

  // Google Calendar connection status
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState('');
  const [showCalendarView, setShowCalendarView] = useState(false);

  // Send result tracking (for honest UX)
  const [sendResult, setSendResult] = useState(null); // { result, message, method }

  // Barry proactive recommendations (Step 7)
  const [drawerRecommendations, setDrawerRecommendations] = useState([]);

  // Barry relationship guardrail (Sprint 2)
  const [barryWarning, setBarryWarning] = useState(null);

  // Barry strategy recommendation (Sprint 4)
  const [barryRecommendation, setBarryRecommendation] = useState(null);

  // Toast notification state (replaces native alert())
  const [toastMessage, setToastMessage] = useState(null);

  // Task 1.3: Per-contact Barry personalization
  const [personalizingMissionId, setPersonalizingMissionId] = useState(null);
  const [personalizingStepCount, setPersonalizingStepCount] = useState(0);
  const [personalizedSteps, setPersonalizedSteps] = useState([]);
  const [personalizationError, setPersonalizationError] = useState(null);

  // Sprint 2.2: Reply thread viewer
  const [replyThread, setReplyThread] = useState(null);   // [{ id, from, to, subject, body, date, isInbound }]
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActiveView('main');
      resetEngagementState();
      // If contact has replied, load the thread automatically
      setReplyThread(null);
      setThreadError(null);
      if (contact?.hunter_status === 'in_conversation' && contact?.gmail_thread_id) {
        loadReplyThread(contact.gmail_thread_id);
      }
      // Load existing intent from contact
      setEngagementIntent(contact?.engagementIntent || 'prospect');

      // State Machine: Engage clicked → Engaged
      const user = getEffectiveUser();
      if (user && contact?.id) {
        updateContactStatus({
          userId: user.uid,
          contactId: contact.id,
          trigger: STATUS_TRIGGERS.ENGAGE_CLICKED,
          currentStatus: getContactStatus(contact)
        });
      }
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
    setSendResult(null);
  }

  // Check Gmail connection status
  async function checkGmailStatus() {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      setGmailChecking(true);
      const status = await checkGmailConnection(user.uid);
      setGmailConnected(status.connected);
    } catch (error) {
      console.error('Error checking Gmail status:', error);
      setGmailConnected(false);
    } finally {
      setGmailChecking(false);
    }
  }

  async function checkCalendarStatus() {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const status = await checkCalendarConnection(user.uid);
      setCalendarConnected(status.connected);
      if (status.connected && status.email) setCalendarEmail(status.email);
    } catch (error) {
      console.error('Error checking Calendar status:', error);
      setCalendarConnected(false);
    }
  }

  async function loadData() {
    try {
      const user = getEffectiveUser();
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

      // Check Gmail connection status
      checkGmailStatus();

      // Check Google Calendar connection
      checkCalendarStatus();

      // Load Barry's proactive recommendations (Step 7, non-blocking)
      loadDrawerRecommendations(user.uid, contact.id);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async function loadDrawerRecommendations(userId, contactId) {
    try {
      const recs = await generateContactRecommendations(userId, contactId);
      setDrawerRecommendations(recs);
    } catch (error) {
      console.error('[HunterContactDrawer] Failed to load recommendations:', error);
    }
  }

  // Sprint 2.2: Load Gmail thread so the reply is readable inside the app
  async function loadReplyThread(threadId) {
    const user = getEffectiveUser();
    if (!user || !threadId) return;
    setThreadLoading(true);
    setThreadError(null);
    try {
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/gmail-get-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, threadId }),
      });
      const data = await res.json();
      if (data.code === 'GMAIL_NOT_CONNECTED' || data.code === 'NEEDS_RECONNECT') {
        setThreadError('Gmail not connected — reconnect to view the reply thread.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to load thread');
      setReplyThread(data.messages || []);
    } catch (err) {
      console.error('[HunterContactDrawer] loadReplyThread error:', err);
      setThreadError('Could not load reply thread.');
    } finally {
      setThreadLoading(false);
    }
  }

  async function handleDrawerDismissRecommendation(recommendationId, reason) {
    const user = getEffectiveUser();
    if (!user) return;
    const success = await dismissRecommendation(user.uid, recommendationId, reason);
    if (success) {
      setDrawerRecommendations(prev => prev.filter(r => r.id !== recommendationId));
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
      const user = getEffectiveUser();
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
    setBarryWarning(null);
    setBarryRecommendation(null);
    setActiveView('options');

    try {
      const user = getEffectiveUser();
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

        // Capture Barry guardrail warning if present (Sprint 2)
        if (data.barry_warning) {
          setBarryWarning(data.barry_warning);
        }

        // Capture Barry strategy recommendation if present (Sprint 4)
        if (data.barry_recommendation) {
          setBarryRecommendation(data.barry_recommendation);
        }

        // Log timeline event: message_generated
        const user2 = auth.currentUser;
        if (user2) {
          logTimelineEvent({
            userId: user2.uid,
            contactId: contact.id,
            type: 'message_generated',
            actor: ACTORS.BARRY,
            preview: intentText ? intentText.substring(0, 120) : null,
            metadata: {
              strategyCount: data.messages.length,
              strategies: data.messages.map(m => m.strategy),
              engagementIntent: relationshipIntent || null
            }
          });
        }
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

  // === SEND MESSAGE (REAL EXECUTION) ===

  async function handleSendMessage() {
    setLoading(true);
    setSendResult(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      // Map weapon to channel
      const channelMap = {
        email: CHANNELS.EMAIL,
        text: CHANNELS.TEXT,
        call: CHANNELS.CALL,
        linkedin: CHANNELS.LINKEDIN,
        calendar: CHANNELS.CALENDAR
      };

      const channel = channelMap[selectedWeapon];
      if (!channel) throw new Error('Invalid weapon selected');

      // Execute the send action (real send or native handoff)
      const result = await executeSendAction({
        channel,
        userId: user.uid,
        contact,
        subject,
        body: message,
        userIntent,
        engagementIntent,
        strategy: selectedStrategy
      });

      // Store result for success view
      setSendResult(result);

      // Update engagement intent on contact
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        engagementIntent: engagementIntent
      });

      // Show success/result view
      setActiveView('success');

    } catch (error) {
      console.error('Error executing send action:', error);
      setSendResult({
        result: SEND_RESULT.FAILED,
        error: error.message
      });
      setActiveView('success'); // Show result (even if failed)
    } finally {
      setLoading(false);
    }
  }

  // Get button label based on weapon and integration status
  function getSendButtonLabel() {
    if (!selectedWeapon) return 'Send';

    const user = getEffectiveUser();
    if (!user) return 'Send';

    // Determine if this will be a real send or native handoff
    if (selectedWeapon === 'email' && gmailConnected) {
      return 'Send Email';
    } else if (selectedWeapon === 'email') {
      return 'Open Email Draft';
    } else if (selectedWeapon === 'text') {
      return 'Open Text Message';
    } else if (selectedWeapon === 'call') {
      return 'Call Contact';
    } else if (selectedWeapon === 'linkedin') {
      return 'Open LinkedIn';
    } else if (selectedWeapon === 'calendar') {
      return 'Create Event';
    }

    return 'Send';
  }

  // Check if action will be native handoff
  function isNativeHandoff() {
    if (selectedWeapon === 'email' && gmailConnected) return false;
    return true; // All other actions are native handoffs for now
  }

  // === ADD TO MISSION ===

  async function handleAddToMission(missionId) {
    if (loading) return; // prevent double-click while in flight
    setLoading(true);
    try {
      const user = getEffectiveUser();
      const mission = missions.find(m => m.id === missionId);
      if (!mission) {
        setToastMessage('Mission not found. Please try again.');
        setLoading(false);
        return;
      }

      const newContactEntry = {
        contactId: contact.id,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || '',
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        email: contact.email || null,
        phone: contact.phone || null,
        currentStepIndex: 0,
        lastTouchDate: null,
        status: 'active',
        outcomes: [],
        sequenceStatus: 'pending',
        stepHistory: [],
        lastOutcome: null,
        personalizationStatus: 'generating',
        personalizedSteps: null
      };

      const updatedContacts = [...(mission.contacts || []), newContactEntry];

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString()
      });

      // Log timeline event
      logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'mission_assigned',
        actor: ACTORS.USER,
        preview: mission.name || mission.goalName || 'Mission',
        metadata: { missionId, missionName: mission.name || null, goalName: mission.goalName || null }
      });

      // State Machine: Mission assigned → Active Mission
      updateContactStatus({
        userId: user.uid,
        contactId: contact.id,
        trigger: STATUS_TRIGGERS.MISSION_ASSIGNED,
        currentStatus: getContactStatus(contact)
      });

      // Transition to personalizing view and start Barry generation
      const stepsToGenerate = _getStepsFromMission(mission);
      setPersonalizingMissionId(missionId);
      setPersonalizingStepCount(stepsToGenerate.length);
      setPersonalizedSteps([]);
      setPersonalizationError(null);
      setLoading(false);
      setActiveView('personalizing');

      await _generatePersonalizedSteps(user, missionId, mission, updatedContacts, stepsToGenerate);

    } catch (error) {
      console.error('Error adding to mission:', error);
      setToastMessage('Failed to add to mission. Please try again.');
      setLoading(false);
    }
  }

  // Extract steps from mission (sequence or template)
  function _getStepsFromMission(mission) {
    if (mission.sequence?.steps?.length) {
      return mission.sequence.steps.map((s, i) => ({
        stepNumber: s.stepNumber || i + 1,
        channel: s.channel,
        stepType: s.stepType || 'message',
        action: s.action,
        purpose: s.purpose
      }));
    }
    return (mission.steps || [])
      .filter(s => s.enabled !== false)
      .map((s, i) => ({
        stepNumber: i + 1,
        channel: s.weapon,
        stepType: s.type || 'message',
        action: s.label,
        purpose: s.description
      }));
  }

  async function _generatePersonalizedSteps(user, missionId, mission, currentContacts, stepsToGenerate) {
    try {
      if (!stepsToGenerate.length) {
        setPersonalizedSteps([]);
        setActiveView('personalization-done');
        return;
      }

      const token = await user.getIdToken();
      const missionFields = {
        outcome_goal: mission.outcome_goal || null,
        engagement_style: mission.engagement_style || null,
        timeframe: mission.timeframe || null,
        next_step_type: mission.next_step_type || null
      };
      const contactData = {
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || '',
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        title: contact.title || contact.current_position_title || null,
        company_name: contact.company_name || contact.current_company_name || null,
        engagementIntent: contact.engagementIntent || 'prospect',
        relationship_type: contact.relationship_type || null,
        warmth_level: contact.warmth_level || null,
        strategic_value: contact.strategic_value || null
      };

      const generatedSteps = [];
      for (let i = 0; i < stepsToGenerate.length; i++) {
        const stepPlan = stepsToGenerate[i];
        try {
          const response = await fetch('/.netlify/functions/barryGenerateSequenceStep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.uid,
              authToken: token,
              contact: contactData,
              missionFields,
              stepPlan,
              stepIndex: i,
              stepHistory: [],
              previousOutcome: null
            })
          });
          const data = await response.json();
          if (data.success && data.generatedContent) {
            generatedSteps.push({
              stepIndex: i,
              stepNumber: stepPlan.stepNumber,
              channel: data.generatedContent.channel || stepPlan.channel,
              subject: data.generatedContent.subject || null,
              body: data.generatedContent.body,
              toneNote: data.generatedContent.toneNote || null,
              status: 'pending_approval',
              generatedAt: data.generatedContent.generatedAt || new Date().toISOString()
            });
          }
        } catch (stepErr) {
          console.warn(`Step ${i + 1} generation failed (non-fatal):`, stepErr);
        }
      }

      // Update the contact's entry in Firestore with generated steps
      const updatedContacts = currentContacts.map(c =>
        c.contactId === contact.id
          ? {
              ...c,
              personalizationStatus: generatedSteps.length > 0 ? 'pending_approval' : 'failed',
              personalizedSteps: generatedSteps.length > 0 ? generatedSteps : null
            }
          : c
      );

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString()
      });

      setPersonalizedSteps(generatedSteps);
      setActiveView('personalization-done');

    } catch (error) {
      console.error('Error in personalization:', error);
      setPersonalizationError('Barry had trouble generating steps. You can review them in the mission.');
      setPersonalizedSteps([]);
      setActiveView('personalization-done');
    }
  }

  async function handleApproveAllSteps() {
    const user = getEffectiveUser();
    if (!user || !personalizingMissionId) return;
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', personalizingMissionId);
      const missionSnap = await getDoc(missionRef);
      if (!missionSnap.exists()) return;
      const missionData = missionSnap.data();
      const updatedContacts = (missionData.contacts || []).map(c =>
        c.contactId === contact.id && c.personalizedSteps
          ? {
              ...c,
              personalizationStatus: 'approved',
              personalizedSteps: c.personalizedSteps.map(s => ({ ...s, status: 'approved' }))
            }
          : c
      );
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
      loadData();
      setActiveView('main');
      const name = contact.firstName || 'Contact';
      setToastMessage(`${name} added and steps approved!`);
    } catch (err) {
      console.error('Error approving steps:', err);
      setToastMessage('Approval failed. Please try from the mission page.');
    }
  }

  // === EDIT INFO ===

  async function handleSaveContactInfo() {
    setLoading(true);
    try {
      const user = getEffectiveUser();
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        email: editedContact.email,
        phone: editedContact.phone,
        updatedAt: new Date().toISOString()
      });

      onContactUpdate(editedContact);
      setToastMessage('Contact info updated!');
      setActiveView('main');
    } catch (error) {
      console.error('Error updating contact:', error);
      setToastMessage('Failed to update contact. Please try again.');
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
        {/* Toast notification */}
        {toastMessage && (
          <LearningToast
            message={toastMessage}
            onDismiss={() => setToastMessage(null)}
          />
        )}
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
              {/* Step 7: Barry's Pre-Engagement Recommendation */}
              {drawerRecommendations.length > 0 && (
                <div className="drawer-barry-recommendation">
                  <div className="drawer-barry-rec-header">
                    <span className="text-sm">🐻</span>
                    <span className="drawer-barry-rec-label">Before you engage — here's what Barry noticed</span>
                  </div>
                  {drawerRecommendations.slice(0, 2).map(rec => (
                    <BarryRecommendationCard
                      key={rec.id}
                      recommendation={rec}
                      onAction={() => {}}
                      onDismiss={handleDrawerDismissRecommendation}
                      compact={true}
                      showCategory={false}
                    />
                  ))}
                </div>
              )}

              {/* Sprint 3: Barry's Outcome-Based Insights */}
              <BarryInsightsCard contactId={contact?.id} />

              {/* Sprint 2.2: Reply Thread Viewer — shown when contact has replied */}
              {contact.hunter_status === 'in_conversation' && (
                <div className="reply-thread-panel">
                  <div className="reply-thread-header">
                    <MessageSquare className="w-4 h-4" />
                    <span className="reply-thread-label">Reply from {firstName}</span>
                    {contact.last_reply_at && (
                      <span className="reply-thread-time">
                        {new Date(contact.last_reply_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {threadLoading && (
                    <div className="reply-thread-loading">
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>Loading reply...</span>
                    </div>
                  )}

                  {threadError && (
                    <div className="reply-thread-error">
                      <AlertCircle className="w-4 h-4" />
                      <span>{threadError}</span>
                    </div>
                  )}

                  {!threadLoading && !threadError && replyThread && replyThread.length > 0 && (
                    <div className="reply-thread-messages">
                      {replyThread.map((msg, idx) => (
                        <div
                          key={msg.id || idx}
                          className={`thread-message ${msg.isInbound ? 'thread-message--inbound' : 'thread-message--outbound'}`}
                        >
                          <div className="thread-message-meta">
                            <span className="thread-message-from">{msg.from}</span>
                            {msg.date && (
                              <span className="thread-message-date">
                                {new Date(msg.date).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {msg.subject && idx === 0 && (
                            <div className="thread-message-subject">Re: {msg.subject}</div>
                          )}
                          <p className="thread-message-body">{msg.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {!threadLoading && !threadError && !replyThread && contact.gmail_thread_id && (
                    <button
                      className="btn-load-thread"
                      onClick={() => loadReplyThread(contact.gmail_thread_id)}
                    >
                      <RefreshCw className="w-4 h-4" />
                      Load reply thread
                    </button>
                  )}

                  {/* Ask Barry how to respond CTA */}
                  <button
                    className="btn-ask-barry-reply"
                    onClick={() => {
                      const latestReply = replyThread?.filter(m => m.isInbound).slice(-1)[0];
                      const prePrompt = latestReply
                        ? `${firstName} replied: "${latestReply.body.slice(0, 200).trim()}..." — help me respond`
                        : `${firstName} replied to my outreach — help me craft a response`;
                      setUserIntent(prePrompt);
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    Ask Barry how to respond
                  </button>
                </div>
              )}

              {/* Barry's Question - Single line */}
              <div className="barry-question-section">
                <div className="barry-avatar">
                  <Sparkles className="w-5 h-5" />
                </div>
                <p className="barry-question">
                  {contact.hunter_status === 'in_conversation'
                    ? `${firstName} replied — how do you want to respond?`
                    : `What do you want to do with ${firstName}?`}
                </p>
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

              {/* Google Calendar — upcoming meetings with this contact */}
              <div className="contact-calendar-section" style={{ marginTop: '12px' }}>
                <div
                  className="calendar-section-toggle"
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: calendarConnected ? '#6ee7b7' : '#6b7280', marginBottom: showCalendarView ? '8px' : '0' }}
                  onClick={() => setShowCalendarView(v => !v)}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  {calendarConnected
                    ? (showCalendarView ? 'Hide calendar' : 'View meetings & schedule')
                    : 'Connect Calendar to schedule meetings'
                  }
                </div>
                {showCalendarView && (
                  <ContactCalendarView
                    contact={contact}
                    calendarConnected={calendarConnected}
                    calendarEmail={calendarEmail}
                  />
                )}
              </div>

              {/* Active Missions (if any) */}
              {contactMissions.length > 0 && (
                <div className="active-missions-subtle">
                  <span className="missions-label">In {contactMissions.length} active mission{contactMissions.length > 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Step 5: Sequence Panel — shown for missions with active sequences */}
              {contactMissions
                .filter(m => getSequencePlan(m) !== null)
                .map(m => (
                  <SequencePanel
                    key={m.id}
                    contact={contact}
                    mission={m}
                    missionId={m.id}
                    onStepSent={() => loadData()}
                  />
                ))
              }

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

                  {/* Barry relationship guardrail (Sprint 2) */}
                  {barryWarning && (
                    <BarryWarningCard
                      warning={barryWarning}
                      contactId={contact?.id}
                      onAction={(actionId) => {
                        // Handle guardrail actions
                        if (actionId === 'warm_up') {
                          // Re-generate with warm intent
                          setBarryWarning(null);
                          generateMessageOptions(userIntent, 'warm');
                        } else if (actionId === 'reference_history') {
                          // Re-generate with follow-up context
                          setBarryWarning(null);
                          generateMessageOptions(`Follow up on our previous conversation: ${userIntent}`, engagementIntent);
                        } else if (actionId === 'classify_known') {
                          // Update intent to warm and regenerate
                          setBarryWarning(null);
                          setEngagementIntent('warm');
                          generateMessageOptions(userIntent, 'warm');
                        } else if (actionId === 'classify_prospect') {
                          // Keep as-is, dismiss warning
                          setBarryWarning(null);
                        } else {
                          // keep_professional, send_anyway, start_fresh, skip — dismiss and proceed
                          setBarryWarning(null);
                        }
                      }}
                      onDismiss={() => setBarryWarning(null)}
                    />
                  )}

                  <div className="message-options-list">
                    {messageOptions.map((option, index) => {
                      const isRecommended = barryRecommendation?.strategy &&
                        option.strategy === barryRecommendation.strategy;
                      const isAvoided = barryRecommendation?.avoidStrategies?.includes(option.strategy);
                      return (
                      <button
                        key={index}
                        className={`message-option-card${isRecommended ? ' message-option-card--recommended' : ''}`}
                        onClick={() => handleSelectStrategy(option)}
                      >
                        <div className="option-header">
                          <span className="option-strategy-label">
                            {option.label || option.strategy}
                            {isRecommended && (
                              <span className="barry-rec-badge" title={barryRecommendation.reasons?.[0] || 'Based on past results'}>
                                Barry's pick
                              </span>
                            )}
                            {isAvoided && (
                              <span className="barry-avoid-badge" title="This approach has underperformed">
                                Low success
                              </span>
                            )}
                          </span>
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
                      );
                    })}
                  </div>

                  <div className="options-mission-cta">
                    <button
                      className="btn-add-mission-options"
                      onClick={() => setActiveView('add-mission')}
                    >
                      <Plus className="w-4 h-4" />
                      Add {firstName} to Mission →
                    </button>
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

              {/* Sprint 4: Best channel hint from outcome attribution */}
              {barryRecommendation?.bestChannel && (
                <div className="barry-channel-hint">
                  <Sparkles className="w-3 h-3" />
                  <span>Barry's data: <strong>{barryRecommendation.bestChannel.name}</strong> has your best response rate ({barryRecommendation.bestChannel.rate}%)</span>
                </div>
              )}

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
                  {hasEmail && gmailConnected && <span className="weapon-badge">Gmail</span>}
                  {hasEmail && !gmailConnected && <span className="weapon-badge-alt">Opens App</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => isProTier ? handleSelectWeapon('text') : navigate('/checkout?tier=pro')}
                  title={!isProTier ? 'Upgrade to Pro to send texts' : undefined}
                >
                  <MessageSquare className="w-6 h-6" />
                  <span>Text</span>
                  {!isProTier
                    ? <span className="weapon-badge" style={{ background: 'rgba(167,139,250,0.2)', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}><Lock size={10} /> Pro</span>
                    : <span className="weapon-badge-alt">Opens App</span>
                  }
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => handleSelectWeapon('linkedin')}
                  disabled={!contact.linkedin_url}
                >
                  <Linkedin className="w-6 h-6" />
                  <span>LinkedIn</span>
                  {!contact.linkedin_url && <span className="weapon-disabled">No profile</span>}
                  {contact.linkedin_url && <span className="weapon-badge-alt">Opens LinkedIn</span>}
                </button>
                <button
                  className="weapon-btn"
                  onClick={() => isProTier ? handleSelectWeapon('call') : navigate('/checkout?tier=pro')}
                  disabled={isProTier && !hasPhone}
                  title={!isProTier ? 'Upgrade to Pro to call contacts' : undefined}
                >
                  <Phone className="w-6 h-6" />
                  <span>Call</span>
                  {!isProTier
                    ? <span className="weapon-badge" style={{ background: 'rgba(167,139,250,0.2)', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}><Lock size={10} /> Pro</span>
                    : !hasPhone
                      ? <span className="weapon-disabled">No phone</span>
                      : <span className="weapon-badge-alt">Opens Dialer</span>
                  }
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

              <h3 className="view-title">Review & {isNativeHandoff() ? 'Open' : 'Send'}</h3>
              <p className="view-description">
                {isNativeHandoff() ? 'Opening' : 'Sending'} via {selectedWeapon} to {contact.firstName} {contact.lastName}
              </p>

              {/* Show native handoff notice */}
              {isNativeHandoff() && (
                <div className="handoff-notice">
                  <ExternalLink className="w-4 h-4" />
                  <span>
                    {selectedWeapon === 'email' && !gmailConnected && 'This will open your email app. Connect Gmail for direct sending.'}
                    {selectedWeapon === 'text' && 'This will open your SMS app to send manually.'}
                    {selectedWeapon === 'call' && 'This will open your phone dialer.'}
                    {selectedWeapon === 'linkedin' && 'This will open LinkedIn. Message copied to clipboard.'}
                  </span>
                </div>
              )}

              {/* Gmail connected indicator */}
              {selectedWeapon === 'email' && gmailConnected && (
                <div className="gmail-connected-notice">
                  <Check className="w-4 h-4" />
                  <span>Gmail connected - email will be sent directly</span>
                </div>
              )}

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
                    {isNativeHandoff() ? 'Opening...' : 'Sending...'}
                  </>
                ) : (
                  <>
                    {isNativeHandoff() ? <ExternalLink className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                    {getSendButtonLabel()}
                  </>
                )}
              </button>

              {/* EmailDraftCard — additional Gmail path for email weapon */}
              {selectedWeapon === 'email' && subject && message && (
                <div className="email-draft-card-wrapper">
                  <div className="email-draft-divider">
                    <span>or open in Gmail directly</span>
                  </div>
                  <EmailDraftCard
                    subject={subject}
                    body={message}
                    preamble={null}
                    userId={auth.currentUser?.uid}
                    contactName={`${contact.firstName || ''} ${contact.lastName || ''}`.trim() || null}
                    theme="light"
                  />
                </div>
              )}
            </div>
          )}

          {/* === SUCCESS VIEW (HONEST RESULTS) === */}
          {activeView === 'success' && (
            <div className="drawer-view success-view">
              {/* REAL SEND SUCCESS */}
              {sendResult?.result === SEND_RESULT.SENT && (
                <>
                  <div className="success-icon success-icon-sent">
                    <Check className="w-16 h-16" />
                  </div>
                  <h3 className="success-title">Email Sent!</h3>
                  <p className="success-description">
                    Your email to {contact.firstName} {contact.lastName} has been sent via Gmail.
                  </p>
                  <p className="success-detail">
                    Check your Gmail Sent folder to verify.
                  </p>
                </>
              )}

              {/* NATIVE APP OPENED */}
              {sendResult?.result === SEND_RESULT.OPENED && (
                <>
                  <div className="success-icon success-icon-opened">
                    <ExternalLink className="w-16 h-16" />
                  </div>
                  <h3 className="success-title">
                    {selectedWeapon === 'email' && 'Email Draft Opened'}
                    {selectedWeapon === 'text' && 'SMS App Opened'}
                    {selectedWeapon === 'call' && 'Phone Dialer Opened'}
                    {selectedWeapon === 'linkedin' && 'LinkedIn Opened'}
                    {selectedWeapon === 'calendar' && 'Calendar Opened'}
                  </h3>
                  <p className="success-description">
                    {sendResult.message}
                  </p>
                  <p className="success-detail">
                    {selectedWeapon === 'email' && 'Complete the send in your email app.'}
                    {selectedWeapon === 'text' && 'Complete the send in your SMS app.'}
                    {selectedWeapon === 'call' && 'Complete the call on your phone.'}
                    {selectedWeapon === 'linkedin' && 'Complete your message on LinkedIn.'}
                    {selectedWeapon === 'calendar' && 'Save the event in your calendar.'}
                  </p>
                  {sendResult.fallbackReason && (
                    <p className="fallback-reason">
                      <AlertCircle className="w-4 h-4" />
                      {sendResult.fallbackReason}
                    </p>
                  )}
                </>
              )}

              {/* FAILED */}
              {sendResult?.result === SEND_RESULT.FAILED && (
                <>
                  <div className="success-icon success-icon-failed">
                    <AlertCircle className="w-16 h-16" />
                  </div>
                  <h3 className="success-title error-title">Action Failed</h3>
                  <p className="success-description error-description">
                    {sendResult.error || 'Something went wrong. Please try again.'}
                  </p>
                </>
              )}

              {/* UNAVAILABLE */}
              {sendResult?.result === SEND_RESULT.UNAVAILABLE && (
                <>
                  <div className="success-icon success-icon-unavailable">
                    <AlertCircle className="w-16 h-16" />
                  </div>
                  <h3 className="success-title">Action Unavailable</h3>
                  <p className="success-description">
                    {sendResult.reason}
                  </p>
                </>
              )}

              <div className="success-actions">
                <button
                  className="btn-primary-hunter"
                  onClick={() => {
                    resetEngagementState();
                    setActiveView('main');
                  }}
                >
                  {sendResult?.result === SEND_RESULT.FAILED ? 'Try Again' : 'Send Another Message'}
                </button>
                {missions.length > 0 && sendResult?.result !== SEND_RESULT.FAILED && (
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
                {missions.length === 0 ? (
                  <p className="missions-empty-hint">No active missions yet. Create one to start running sequences.</p>
                ) : (
                  missions.map(mission => (
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
                        <span>{
                          mission.sequence?.steps?.length ||
                          mission.microSequence?.steps?.length ||
                          mission.steps?.filter(s => s.enabled !== false).length ||
                          0
                        } steps</span>
                      </div>
                    </div>
                  ))
                )}
                <button
                  className="mission-create-new"
                  onClick={() => navigate(`/hunter/create-mission?contactId=${contact.id}`)}
                >
                  <Plus className="w-4 h-4" />
                  Create new mission
                </button>
              </div>
            </div>
          )}

          {/* === BARRY PERSONALIZING (loading) === */}
          {activeView === 'personalizing' && (
            <div className="drawer-view personalization-loading-view">
              <div className="personalization-barry-avatar">
                <Sparkles className="w-6 h-6 text-purple-400 animate-pulse" />
              </div>
              <h3 className="personalization-title">Barry is personalizing your steps</h3>
              <p className="personalization-subtitle">
                Generating {personalizingStepCount} message{personalizingStepCount !== 1 ? 's' : ''} for {contact.firstName || 'this contact'} using their RECON profile...
              </p>
              <div className="personalization-steps-loading">
                {Array.from({ length: personalizingStepCount }).map((_, i) => (
                  <div key={i} className="personalization-step-skeleton">
                    <div className="skeleton-step-num">Step {i + 1}</div>
                    <div className="skeleton-bar" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* === PERSONALIZATION DONE (hybrid confirm) === */}
          {activeView === 'personalization-done' && (
            <div className="drawer-view personalization-done-view">
              {personalizationError ? (
                <div className="personalization-error-banner">
                  <AlertCircle className="w-5 h-5" />
                  <span>{personalizationError}</span>
                </div>
              ) : (
                <div className="personalization-success-icon">
                  <Check className="w-8 h-8 text-green-400" />
                </div>
              )}

              <h3 className="personalization-title">
                {personalizationError || personalizedSteps.length === 0
                  ? `${contact.firstName || 'Contact'} added to mission`
                  : `Barry personalized ${personalizedSteps.length} step${personalizedSteps.length !== 1 ? 's' : ''} for ${contact.firstName || 'this contact'}`
                }
              </h3>

              {!personalizationError && personalizedSteps.length > 0 && (
                <div className="personalized-steps-preview">
                  {personalizedSteps.map((step, i) => (
                    <div key={i} className="personalized-step-card">
                      <div className="ps-step-header">
                        <span className="ps-step-num">Step {step.stepNumber}</span>
                        <span className="ps-step-channel">{step.channel}</span>
                      </div>
                      {step.subject && (
                        <p className="ps-step-subject">Subject: {step.subject}</p>
                      )}
                      <p className="ps-step-body">{step.body?.substring(0, 120)}{step.body?.length > 120 ? '...' : ''}</p>
                      {step.toneNote && (
                        <p className="ps-tone-note">
                          <Sparkles className="w-3 h-3" />
                          {step.toneNote}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="personalization-actions">
                {!personalizationError && personalizedSteps.length > 0 && (
                  <button
                    className="btn-primary-hunter"
                    onClick={handleApproveAllSteps}
                    disabled={loading}
                  >
                    <Check className="w-4 h-4" />
                    Approve & Close
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => {
                    onClose();
                    navigate(`/hunter/mission/${personalizingMissionId}`);
                  }}
                >
                  <ArrowRight className="w-4 h-4" />
                  Review in Mission →
                </button>
                <button className="btn-secondary" onClick={onClose}>
                  Close
                </button>
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
