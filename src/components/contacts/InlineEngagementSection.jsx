import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
  getDocs, updateDoc, doc, addDoc
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  Zap, Mail, Phone, MessageSquare, Linkedin, Check,
  ArrowLeft, ArrowRight, Sparkles, Send, Loader, RefreshCw,
  ExternalLink, AlertCircle, Plus, ChevronDown, ChevronUp,
  Clock, Target, Bookmark, BookmarkCheck, History
} from 'lucide-react';
import {
  executeSendAction,
  checkGmailConnection,
  CHANNELS,
  SEND_RESULT
} from '../../utils/sendActionResolver';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS, getContactStatus } from '../../utils/contactStateMachine';
import LearningToast from '../LearningToast';
import './InlineEngagementSection.css';

/**
 * INLINE ENGAGEMENT SECTION
 *
 * Replaces the HunterContactDrawer modal with a persistent inline section
 * on the Contact Profile page — always visible, always resumable.
 *
 * Flow: intent input → relationship type → Barry generating →
 *       message selection → send method → history
 *
 * Completed engagements persist as a log (newest on top).
 * No modals. No overlays. No popups.
 */

const ENGAGEMENT_INTENTS = [
  { id: 'prospect', label: 'Prospect', description: 'Someone new I want to connect with' },
  { id: 'warm', label: 'Warm / Existing', description: 'Someone I already know' },
  { id: 'customer', label: 'Customer', description: 'An existing customer' },
  { id: 'partner', label: 'Partner', description: 'A business partner or collaborator' }
];

const CHANNEL_LABELS = {
  email: 'Email',
  text: 'Text',
  call: 'Call',
  linkedin: 'LinkedIn',
  calendar: 'Calendar'
};

function formatEngagementTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// ── Engagement History Log ─────────────────────────────────

function EngagementHistoryEntry({ event, index }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.metadata || {};
  const channel = meta.channel ? CHANNEL_LABELS[meta.channel] || meta.channel : null;
  const time = formatEngagementTime(event.createdAt || event.timestamp);
  const goal = event.preview || meta.userIntent || 'Engagement';
  const messagePreview = meta.messagePreview || meta.body || null;

  return (
    <div className="ies-history-entry">
      <div className="ies-history-entry-header">
        <div className="ies-history-entry-meta">
          <span className="ies-history-entry-index">#{index}</span>
          {channel && (
            <span className="ies-history-channel-badge">
              {channel === 'Email' && <Mail className="w-3 h-3" />}
              {channel === 'Text' && <MessageSquare className="w-3 h-3" />}
              {channel === 'LinkedIn' && <Linkedin className="w-3 h-3" />}
              {channel === 'Call' && <Phone className="w-3 h-3" />}
              {channel}
            </span>
          )}
          {meta.sendResult === 'sent' && (
            <span className="ies-badge-sent">Sent</span>
          )}
          {meta.sendResult === 'opened' && (
            <span className="ies-badge-opened">Opened</span>
          )}
          <span className="ies-history-time">
            <Clock className="w-3 h-3" />
            {time}
          </span>
        </div>
        {messagePreview && (
          <button
            className="ies-history-expand-btn"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <p className="ies-history-goal">{goal}</p>
      {expanded && messagePreview && (
        <div className="ies-history-message-preview">
          <p>{messagePreview}</p>
        </div>
      )}
    </div>
  );
}

// ── All History Entry ──────────────────────────────────────

const ALL_EVENT_LABELS = {
  message_sent: 'Message sent',
  message_generated: 'Barry generated messages',
  engage_session_started: 'Session started',
  engage_session_completed: 'Session completed',
  engage_session_abandoned: 'Session abandoned',
  engage_session_pivoted: 'Channel switched',
  next_step_queued: 'Next step queued',
  next_step_completed: 'Next step completed',
  contact_status_changed: 'Status updated',
  sequence_step_sent: 'Sequence step sent',
};

function AllHistoryEntry({ event }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.metadata || {};
  const label = ALL_EVENT_LABELS[event.type] || event.type?.replace(/_/g, ' ') || 'Activity';
  const time = formatEngagementTime(event.createdAt || event.timestamp);
  const preview = event.preview || meta.userIntent || meta.messagePreview || meta.body || null;

  return (
    <div className="ies-all-history-entry">
      <div className="ies-all-history-dot" />
      <div className="ies-all-history-body">
        <div className="ies-all-history-meta">
          <span className="ies-all-history-label">{label}</span>
          {time && <span className="ies-all-history-time"><Clock className="w-3 h-3" />{time}</span>}
          {preview && (
            <button
              className="ies-history-expand-btn"
              onClick={() => setExpanded(e => !e)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
        {expanded && preview && (
          <p className="ies-all-history-preview">{preview}</p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

const InlineEngagementSection = forwardRef(function InlineEngagementSection(
  { contact, onContactUpdate },
  ref
) {
  // History
  const [sentEvents, setSentEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Flow active state
  const [flowActive, setFlowActive] = useState(false);

  // Flow steps (stack vertically — steps don't replace each other)
  const [intentSubmitted, setIntentSubmitted] = useState(false);
  const [relationshipStep, setRelationshipStep] = useState(false); // true = show relationship selector
  const [generatingStep, setGeneratingStep] = useState(false);     // true = generating
  const [optionsStep, setOptionsStep] = useState(false);           // true = show options
  const [weaponStep, setWeaponStep] = useState(false);             // true = show weapon selector
  const [reviewStep, setReviewStep] = useState(false);             // true = show review
  const [resultStep, setResultStep] = useState(false);             // true = show result

  // Engagement data
  const [userIntent, setUserIntent] = useState('');
  const [engagementIntent, setEngagementIntent] = useState(contact?.engagementIntent || 'prospect');
  const [messageOptions, setMessageOptions] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [selectedWeapon, setSelectedWeapon] = useState(null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [generationError, setGenerationError] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Saved prompts
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  // Barry message → template saving
  const [savedMsgIndices, setSavedMsgIndices] = useState(new Set());
  const [savingMsgIdx, setSavingMsgIdx] = useState(null);

  // Section collapse / full history
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [allHistoryEvents, setAllHistoryEvents] = useState([]);
  const [allHistoryLoading, setAllHistoryLoading] = useState(false);

  // Expose trigger method to parent via ref
  useImperativeHandle(ref, () => ({
    triggerFlow() {
      activateFlow();
    }
  }));

  // Real-time listener: load message_sent events for history
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !contact?.id) {
      setHistoryLoading(false);
      return;
    }

    const timelineRef = collection(db, 'users', user.uid, 'contacts', contact.id, 'timeline');
    const q = query(timelineRef, orderBy('createdAt', 'desc'), limit(20));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const sent = allEvents.filter(e => e.type === 'message_sent');
      setSentEvents(sent);
      setHistoryLoading(false);
    }, () => {
      setHistoryLoading(false);
    });

    return () => unsubscribe();
  }, [contact?.id]);

  function activateFlow() {
    resetFlow();
    setFlowActive(true);
    loadSavedPrompts();

    const user = auth.currentUser;
    if (user && contact?.id) {
      // State Machine: contact_status → Engaged
      updateContactStatus({
        userId: user.uid,
        contactId: contact.id,
        trigger: STATUS_TRIGGERS.ENGAGE_CLICKED,
        currentStatus: getContactStatus(contact)
      });

      // Immediately move to Hunter so the contact is visible there while composing.
      // Barry will later promote to 'active_mission' when the mission is created.
      updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        hunter_status: 'engaged_pending',
        hunter_engaged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Check Gmail
    checkGmailStatus();
  }

  function resetFlow() {
    setUserIntent('');
    setEngagementIntent(contact?.engagementIntent || 'prospect');
    setIntentSubmitted(false);
    setRelationshipStep(false);
    setGeneratingStep(false);
    setOptionsStep(false);
    setWeaponStep(false);
    setReviewStep(false);
    setResultStep(false);
    setMessageOptions([]);
    setSelectedMessage(null);
    setSelectedWeapon(null);
    setMessage('');
    setSubject('');
    setGenerationError(null);
    setSendResult(null);
    setSavedMsgIndices(new Set());
    setSavingMsgIdx(null);
    setPromptSaved(false);
  }

  async function checkGmailStatus() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const status = await checkGmailConnection(user.uid);
      setGmailConnected(status.connected);
    } catch {
      setGmailConnected(false);
    }
  }

  // === Prompt Templates ===
  async function loadSavedPrompts() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const promptsRef = collection(db, 'users', user.uid, 'promptTemplates');
      const q = query(promptsRef, orderBy('createdAt', 'desc'), limit(8));
      const snap = await getDocs(q);
      setSavedPrompts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { /* non-blocking */ }
  }

  async function handleSavePrompt() {
    if (!userIntent.trim() || savingPrompt) return;
    setSavingPrompt(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      await addDoc(collection(db, 'users', user.uid, 'promptTemplates'), {
        text: userIntent.trim(),
        createdAt: new Date()
      });
      setPromptSaved(true);
      await loadSavedPrompts();
      setTimeout(() => setPromptSaved(false), 2500);
    } catch { /* non-blocking */ }
    finally { setSavingPrompt(false); }
  }

  // === Barry Message → Template ===
  async function handleSaveMessageAsTemplate(option, idx) {
    if (savingMsgIdx !== null || savedMsgIndices.has(idx)) return;
    setSavingMsgIdx(idx);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      const label = option.label || option.strategy || 'Barry Message';
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      await fetch('/.netlify/functions/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          template: {
            name: `${label} — ${dateStr}`,
            subject: option.subject || label,
            body: option.message,
            intent: engagementIntent || 'prospect'
          }
        })
      });
      setSavedMsgIndices(prev => new Set([...prev, idx]));
    } catch { /* non-blocking */ }
    finally { setSavingMsgIdx(null); }
  }

  // === Full History ===
  async function loadAllHistory() {
    if (allHistoryLoading) return;
    setAllHistoryLoading(true);
    const user = auth.currentUser;
    if (!user || !contact?.id) { setAllHistoryLoading(false); return; }
    try {
      const timelineRef = collection(db, 'users', user.uid, 'contacts', contact.id, 'timeline');
      const q = query(timelineRef, orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      setAllHistoryEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { /* non-blocking */ }
    finally { setAllHistoryLoading(false); }
  }

  // === Barry Auto-Context Refresh (fire-and-forget) ===
  function triggerBarryContextRefresh() {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;
    user.getIdToken().then(authToken => {
      fetch('/.netlify/functions/barryGenerateContext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contact: {
            id: contact.id,
            name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name,
            title: contact.title || contact.current_position_title,
            company_name: contact.company_name || contact.current_company_name,
            email: contact.email,
            linkedin_url: contact.linkedin_url
          }
        })
      }).catch(() => {});
    }).catch(() => {});
  }

  // === STEP 1: Intent Submission ===
  function handleIntentSubmit() {
    if (!userIntent.trim()) return;
    setIntentSubmitted(true);

    const hasExistingIntent = contact?.engagementIntent;
    if (!hasExistingIntent) {
      setRelationshipStep(true);
    } else {
      generateMessageOptions(userIntent, engagementIntent);
    }
  }

  function handleIntentKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleIntentSubmit();
    }
  }

  // === STEP 2: Relationship Type ===
  function handleSelectIntent(intent) {
    setEngagementIntent(intent.id);
    setRelationshipStep(false);
    saveIntentToContact(intent.id);
    generateMessageOptions(userIntent, intent.id);
  }

  function handleSkipRelationship() {
    setRelationshipStep(false);
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
    } catch {
      // Non-blocking
    }
  }

  // === STEP 3: Message Generation ===
  async function generateMessageOptions(intentText, relationshipIntent) {
    setGeneratingStep(true);
    setGenerationError(null);

    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          userIntent: intentText,
          engagementIntent: relationshipIntent,
          barryContext: contact.barryContext,
          contact: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name,
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

      if (data.success && data.messages && data.messages.length >= 3) {
        setMessageOptions(data.messages);
        setGeneratingStep(false);
        setOptionsStep(true);

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
      setGeneratingStep(false);
      setGenerationError(error.message || 'Something went wrong. Please try again.');
    }
  }

  // === STEP 4: Message Selection ===
  function handleSelectStrategy(option) {
    setSelectedMessage(option);
    setMessage(option.message);
    setSubject(option.subject || '');
    setOptionsStep(false);
    setWeaponStep(true);
  }

  // === STEP 5: Weapon Selection ===
  function handleSelectWeapon(weapon) {
    setSelectedWeapon(weapon);
    setWeaponStep(false);
    setReviewStep(true);
  }

  // === STEP 6: Send ===
  async function handleSendMessage() {
    setLoading(true);
    setSendResult(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const channelMap = {
        email: CHANNELS.EMAIL,
        text: CHANNELS.TEXT,
        call: CHANNELS.CALL,
        linkedin: CHANNELS.LINKEDIN,
        calendar: CHANNELS.CALENDAR
      };

      const channel = channelMap[selectedWeapon];
      if (!channel) throw new Error('Invalid channel selected');

      const result = await executeSendAction({
        channel,
        userId: user.uid,
        contact,
        subject,
        body: message,
        userIntent,
        engagementIntent,
        strategy: selectedMessage?.strategy
      });

      setSendResult(result);

      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        engagementIntent: engagementIntent
      });

      // Trigger Barry context auto-refresh in background so next engagement is smarter
      triggerBarryContextRefresh();

      setReviewStep(false);
      setResultStep(true);

    } catch (error) {
      setSendResult({ result: SEND_RESULT.FAILED, error: error.message });
      setReviewStep(false);
      setResultStep(true);
    } finally {
      setLoading(false);
    }
  }

  function handleDone() {
    setFlowActive(false);
    resetFlow();
  }

  function handleSendAnother() {
    resetFlow();
    setFlowActive(true);
    checkGmailStatus();
  }

  const hasEmail = !!(contact.email && contact.email.trim());
  const hasPhone = !!(contact.phone && contact.phone.trim());
  const firstName = contact.firstName || contact.name?.split(' ')[0] || 'this person';
  const characterCount = message.length;
  const smsCount = characterCount <= 160 ? 1 : Math.ceil(characterCount / 153);

  function isNativeHandoff() {
    if (selectedWeapon === 'email' && gmailConnected) return false;
    return true;
  }

  function getSendButtonLabel() {
    if (!selectedWeapon) return 'Send';
    if (selectedWeapon === 'email' && gmailConnected) return 'Send Email';
    if (selectedWeapon === 'email') return 'Open Email Draft';
    if (selectedWeapon === 'text') return 'Open Text Message';
    if (selectedWeapon === 'call') return 'Call Contact';
    if (selectedWeapon === 'linkedin') return 'Open LinkedIn';
    if (selectedWeapon === 'calendar') return 'Create Event';
    return 'Send';
  }

  return (
    <div className="ies-section" id="engagement-section">
      {toastMessage && (
        <LearningToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}

      {/* Section Header */}
      <div className="ies-section-header">
        <div className="ies-section-title-row">
          <Target className="w-5 h-5 ies-section-icon" />
          <h3 className="ies-section-title">Engagement</h3>
          {sentEvents.length > 0 && (
            <span className="ies-section-count">{sentEvents.length} sent</span>
          )}
        </div>
        <div className="ies-section-header-actions">
          {!flowActive && (
            <button className="ies-start-btn" onClick={activateFlow}>
              <Zap className="w-4 h-4" />
              Start New Engagement
            </button>
          )}
          <button
            className="ies-section-collapse-btn"
            onClick={() => setSectionCollapsed(c => !c)}
            aria-label={sectionCollapsed ? 'Expand section' : 'Collapse section'}
            title={sectionCollapsed ? 'Expand' : 'Collapse'}
          >
            {sectionCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── ENGAGEMENT HISTORY ── */}
      {!sectionCollapsed && !flowActive && (
        <div className="ies-history">
          {historyLoading ? (
            <div className="ies-history-loading">
              <Loader className="w-4 h-4 ies-spinner" />
              <span>Loading history...</span>
            </div>
          ) : sentEvents.length === 0 ? (
            <div className="ies-history-empty">
              <Sparkles className="w-8 h-8 ies-empty-icon" />
              <p className="ies-history-empty-title">No engagements yet</p>
              <p className="ies-history-empty-desc">
                Click "Start New Engagement" — Barry will craft tailored messages using everything he knows about {firstName}.
              </p>
              <button className="ies-start-btn-inline" onClick={activateFlow}>
                <Zap className="w-4 h-4" />
                Start Engagement with Barry
              </button>
            </div>
          ) : (
            <>
              <div className="ies-history-list">
                {sentEvents.map((event, idx) => (
                  <EngagementHistoryEntry
                    key={event.id}
                    event={event}
                    index={sentEvents.length - idx}
                  />
                ))}
              </div>

              {/* Full activity toggle */}
              <div className="ies-history-footer">
                <button
                  className="ies-history-expand-all-btn"
                  onClick={() => {
                    if (!historyExpanded) loadAllHistory();
                    setHistoryExpanded(h => !h);
                  }}
                >
                  <History className="w-3.5 h-3.5" />
                  {historyExpanded ? 'Hide full activity' : 'View full activity'}
                  {historyExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {historyExpanded && (
                <div className="ies-all-history">
                  {allHistoryLoading ? (
                    <div className="ies-history-loading">
                      <Loader className="w-4 h-4 ies-spinner" />
                      <span>Loading activity...</span>
                    </div>
                  ) : allHistoryEvents.length === 0 ? (
                    <p className="ies-all-history-empty">No activity recorded yet.</p>
                  ) : (
                    <div className="ies-all-history-list">
                      {allHistoryEvents.map((event, idx) => (
                        <AllHistoryEntry key={event.id || idx} event={event} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ACTIVE FLOW ── */}
      {!sectionCollapsed && flowActive && (
        <div className="ies-flow">
          {/* Flow header */}
          <div className="ies-flow-header">
            <div className="ies-flow-header-left">
              <Sparkles className="w-4 h-4 ies-flow-icon" />
              <span className="ies-flow-contact-name">{firstName}</span>
            </div>
            <button
              className="ies-collapse-btn"
              onClick={handleDone}
              disabled={loading}
            >
              Cancel
            </button>
          </div>

          {/* ── STEP 1: Intent Input ── */}
          {!intentSubmitted && (
            <div className="ies-step ies-step-intent">
              <div className="ies-barry-row">
                <div className="ies-barry-avatar">
                  <Sparkles className="w-4 h-4" />
                </div>
                <p className="ies-barry-question">
                  What do you want to do with {firstName}?
                </p>
              </div>
              <textarea
                className="ies-intent-input"
                value={userIntent}
                onChange={(e) => setUserIntent(e.target.value)}
                onKeyDown={handleIntentKeyDown}
                placeholder={`E.g., "Follow up on our conversation at the conference" or "Introduce myself and see if they need help with marketing automation"`}
                rows={3}
                autoFocus
              />
              {/* Saved prompts chips */}
              {savedPrompts.length > 0 && (
                <div className="ies-saved-prompts">
                  <span className="ies-saved-prompts-label">Saved prompts:</span>
                  <div className="ies-prompt-chips">
                    {savedPrompts.slice(0, 6).map(p => (
                      <button
                        key={p.id}
                        className="ies-prompt-chip"
                        onClick={() => setUserIntent(p.text)}
                        title={p.text}
                      >
                        {p.text.length > 45 ? p.text.slice(0, 42) + '…' : p.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Contact info at a glance */}
              <div className="ies-contact-channels">
                <span className={`ies-channel-chip ${hasEmail ? 'ies-chip-ok' : 'ies-chip-missing'}`}>
                  <Mail className="w-3 h-3" />
                  {hasEmail ? contact.email : 'No email'}
                  {!hasEmail && (
                    <button className="ies-add-link" onClick={() => setToastMessage('Edit contact info in the Details section below.')}>
                      Add
                    </button>
                  )}
                </span>
                <span className={`ies-channel-chip ${hasPhone ? 'ies-chip-ok' : 'ies-chip-missing'}`}>
                  <Phone className="w-3 h-3" />
                  {hasPhone ? contact.phone : 'No phone'}
                  {!hasPhone && (
                    <button className="ies-add-link" onClick={() => setToastMessage('Edit contact info in the Details section below.')}>
                      Add
                    </button>
                  )}
                </span>
              </div>
              <div className="ies-intent-actions">
                <button
                  className={`ies-save-prompt-btn ${promptSaved ? 'saved' : ''}`}
                  onClick={handleSavePrompt}
                  disabled={!userIntent.trim() || savingPrompt}
                  title="Save this prompt for future use"
                >
                  {promptSaved
                    ? <><BookmarkCheck className="w-4 h-4" /> Saved!</>
                    : <><Bookmark className="w-4 h-4" /> Save prompt</>
                  }
                </button>
                <button
                  className="ies-generate-btn"
                  onClick={handleIntentSubmit}
                  disabled={!userIntent.trim()}
                >
                  <Send className="w-4 h-4" />
                  Generate Messages
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Relationship Type ── */}
          {intentSubmitted && relationshipStep && (
            <div className="ies-step ies-step-relationship">
              <div className="ies-step-divider" />
              <div className="ies-submitted-intent">
                <span className="ies-submitted-label">Your goal:</span>
                <span className="ies-submitted-text">{userIntent}</span>
              </div>
              <div className="ies-barry-row">
                <div className="ies-barry-avatar">
                  <Sparkles className="w-4 h-4" />
                </div>
                <p className="ies-barry-question">
                  How would you describe your relationship with {firstName}?
                </p>
              </div>
              <div className="ies-intent-options">
                {ENGAGEMENT_INTENTS.map(intent => (
                  <button
                    key={intent.id}
                    className="ies-intent-option"
                    onClick={() => handleSelectIntent(intent)}
                  >
                    <span className="ies-intent-option-label">{intent.label}</span>
                    <span className="ies-intent-option-desc">{intent.description}</span>
                    <ArrowRight className="w-4 h-4 ies-intent-arrow" />
                  </button>
                ))}
              </div>
              <button className="ies-skip-btn" onClick={handleSkipRelationship}>
                Skip this step
              </button>
            </div>
          )}

          {/* ── STEP 3: Generating ── */}
          {intentSubmitted && generatingStep && (
            <div className="ies-step ies-step-generating">
              <div className="ies-step-divider" />
              <div className="ies-submitted-intent">
                <span className="ies-submitted-label">Your goal:</span>
                <span className="ies-submitted-text">{userIntent}</span>
              </div>
              <div className="ies-generating-state">
                <div className="ies-generating-icon-wrap">
                  <Loader className="w-6 h-6 ies-spinner" />
                </div>
                <p className="ies-generating-text">Barry is analyzing and crafting your messages...</p>
                <span className="ies-generating-hint">Using RECON data and contact intelligence</span>
              </div>
            </div>
          )}

          {/* ── STEP 3b: Generation Error ── */}
          {intentSubmitted && !generatingStep && generationError && !optionsStep && (
            <div className="ies-step ies-step-error">
              <div className="ies-step-divider" />
              <div className="ies-error-state">
                <AlertCircle className="w-6 h-6 ies-error-icon" />
                <p className="ies-error-text">{generationError}</p>
                <button
                  className="ies-retry-btn"
                  onClick={() => {
                    setGenerationError(null);
                    generateMessageOptions(userIntent, engagementIntent);
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Message Options ── */}
          {optionsStep && !weaponStep && !reviewStep && !resultStep && (
            <div className="ies-step ies-step-options">
              <div className="ies-step-divider" />
              <div className="ies-submitted-intent">
                <span className="ies-submitted-label">Your goal:</span>
                <span className="ies-submitted-text">{userIntent}</span>
              </div>
              <div className="ies-barry-row">
                <div className="ies-barry-avatar">
                  <Sparkles className="w-4 h-4" />
                </div>
                <p className="ies-barry-question">Here are three approaches. Pick one.</p>
              </div>
              <div className="ies-options-list">
                {messageOptions.map((option, index) => (
                  <div key={index} className="ies-option-card-wrap">
                    <button
                      className="ies-option-card"
                      onClick={() => handleSelectStrategy(option)}
                    >
                      <div className="ies-option-header">
                        <span className="ies-option-strategy">{option.label || option.strategy}</span>
                        <ArrowRight className="w-4 h-4 ies-option-arrow" />
                      </div>
                      {option.subject && (
                        <p className="ies-option-subject">Subject: {option.subject}</p>
                      )}
                      <p className="ies-option-preview">{option.message}</p>
                      {option.reasoning && (
                        <p className="ies-option-reasoning">{option.reasoning}</p>
                      )}
                    </button>
                    <button
                      className={`ies-save-template-btn ${savedMsgIndices.has(index) ? 'ies-save-template-btn--saved' : ''}`}
                      onClick={() => handleSaveMessageAsTemplate(option, index)}
                      disabled={savingMsgIdx !== null || savedMsgIndices.has(index)}
                      title={savedMsgIndices.has(index) ? 'Saved as template' : 'Save as template'}
                    >
                      {savingMsgIdx === index
                        ? <Loader className="w-3.5 h-3.5 ies-spinner" />
                        : savedMsgIndices.has(index)
                          ? <><BookmarkCheck className="w-3.5 h-3.5" /> Saved</>
                          : <><Bookmark className="w-3.5 h-3.5" /> Save</>
                      }
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 5: Weapon Selection ── */}
          {weaponStep && !reviewStep && !resultStep && (
            <div className="ies-step ies-step-weapon">
              <div className="ies-step-divider" />
              <div className="ies-selected-message-summary">
                <span className="ies-selected-strategy-label">
                  {selectedMessage?.label || selectedMessage?.strategy}
                </span>
                {selectedMessage?.reasoning && (
                  <div className="ies-selected-reasoning">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{selectedMessage.reasoning}</span>
                  </div>
                )}
              </div>
              {/* Editable message preview */}
              <div className="ies-message-preview">
                {subject && (
                  <>
                    <label className="ies-preview-label">Subject</label>
                    <input
                      type="text"
                      className="ies-subject-input"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </>
                )}
                <label className="ies-preview-label">Message</label>
                <textarea
                  className="ies-message-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />
              </div>
              <p className="ies-weapon-prompt">How do you want to send this?</p>
              <div className="ies-weapons-grid">
                <button
                  className={`ies-weapon-btn ${!hasEmail ? 'ies-weapon-disabled' : ''}`}
                  onClick={() => hasEmail && handleSelectWeapon('email')}
                  disabled={!hasEmail}
                >
                  <Mail className="w-5 h-5" />
                  <span>Email</span>
                  {!hasEmail && <span className="ies-weapon-note">No email</span>}
                  {hasEmail && gmailConnected && <span className="ies-weapon-badge">Gmail</span>}
                  {hasEmail && !gmailConnected && <span className="ies-weapon-badge-alt">Opens App</span>}
                </button>
                <button
                  className="ies-weapon-btn"
                  onClick={() => handleSelectWeapon('text')}
                >
                  <MessageSquare className="w-5 h-5" />
                  <span>Text</span>
                  <span className="ies-weapon-badge-alt">Opens App</span>
                </button>
                <button
                  className={`ies-weapon-btn ${!contact.linkedin_url ? 'ies-weapon-disabled' : ''}`}
                  onClick={() => contact.linkedin_url && handleSelectWeapon('linkedin')}
                  disabled={!contact.linkedin_url}
                >
                  <Linkedin className="w-5 h-5" />
                  <span>LinkedIn</span>
                  {!contact.linkedin_url && <span className="ies-weapon-note">No profile</span>}
                  {contact.linkedin_url && <span className="ies-weapon-badge-alt">Opens LinkedIn</span>}
                </button>
                <button
                  className={`ies-weapon-btn ${!hasPhone ? 'ies-weapon-disabled' : ''}`}
                  onClick={() => hasPhone && handleSelectWeapon('call')}
                  disabled={!hasPhone}
                >
                  <Phone className="w-5 h-5" />
                  <span>Call</span>
                  {!hasPhone && <span className="ies-weapon-note">No phone</span>}
                  {hasPhone && <span className="ies-weapon-badge-alt">Opens Dialer</span>}
                </button>
              </div>
              <button
                className="ies-back-btn"
                onClick={() => {
                  setWeaponStep(false);
                  setOptionsStep(true);
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                Back to message options
              </button>
            </div>
          )}

          {/* ── STEP 6: Review & Send ── */}
          {reviewStep && !resultStep && (
            <div className="ies-step ies-step-review">
              <div className="ies-step-divider" />
              <div className="ies-review-header">
                <span className="ies-review-title">
                  {isNativeHandoff() ? 'Review & Open' : 'Review & Send'}
                </span>
                <span className="ies-review-via">
                  via {selectedWeapon ? (CHANNEL_LABELS[selectedWeapon] || selectedWeapon) : ''}
                  {' '}to {firstName}
                </span>
              </div>

              {isNativeHandoff() && (
                <div className="ies-handoff-notice">
                  <ExternalLink className="w-4 h-4" />
                  <span>
                    {selectedWeapon === 'email' && !gmailConnected && 'This will open your email app. Connect Gmail for direct sending.'}
                    {selectedWeapon === 'text' && 'This will open your SMS app to send manually.'}
                    {selectedWeapon === 'call' && 'This will open your phone dialer.'}
                    {selectedWeapon === 'linkedin' && 'This will open LinkedIn. Message copied to clipboard.'}
                  </span>
                </div>
              )}

              {selectedWeapon === 'email' && gmailConnected && (
                <div className="ies-gmail-notice">
                  <Check className="w-4 h-4" />
                  <span>Gmail connected — email will send directly</span>
                </div>
              )}

              <div className="ies-message-preview">
                {selectedWeapon === 'email' && subject && (
                  <>
                    <label className="ies-preview-label">Subject</label>
                    <input
                      type="text"
                      className="ies-subject-input"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </>
                )}
                <label className="ies-preview-label">Message</label>
                <textarea
                  className="ies-message-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                />
                {selectedWeapon === 'text' && (
                  <span className="ies-char-count">
                    {characterCount} characters ({smsCount} SMS)
                  </span>
                )}
              </div>

              <div className="ies-review-actions">
                <button
                  className="ies-send-btn"
                  onClick={handleSendMessage}
                  disabled={!message || loading}
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 ies-spinner" />
                      {isNativeHandoff() ? 'Opening...' : 'Sending...'}
                    </>
                  ) : (
                    <>
                      {isNativeHandoff()
                        ? <ExternalLink className="w-4 h-4" />
                        : <Send className="w-4 h-4" />
                      }
                      {getSendButtonLabel()}
                    </>
                  )}
                </button>
                <button
                  className="ies-back-btn"
                  onClick={() => {
                    setReviewStep(false);
                    setWeaponStep(true);
                  }}
                  disabled={loading}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 7: Result ── */}
          {resultStep && (
            <div className="ies-step ies-step-result">
              <div className="ies-step-divider" />

              {sendResult?.result === SEND_RESULT.SENT && (
                <div className="ies-result-success">
                  <div className="ies-result-icon ies-result-icon-sent">
                    <Check className="w-8 h-8" />
                  </div>
                  <h4 className="ies-result-title">Email Sent</h4>
                  <p className="ies-result-desc">
                    Your email to {firstName} was sent via Gmail. Check your Sent folder to verify.
                  </p>
                </div>
              )}

              {sendResult?.result === SEND_RESULT.OPENED && (
                <div className="ies-result-success">
                  <div className="ies-result-icon ies-result-icon-opened">
                    <ExternalLink className="w-8 h-8" />
                  </div>
                  <h4 className="ies-result-title">
                    {selectedWeapon === 'email' && 'Email Draft Opened'}
                    {selectedWeapon === 'text' && 'SMS App Opened'}
                    {selectedWeapon === 'call' && 'Phone Dialer Opened'}
                    {selectedWeapon === 'linkedin' && 'LinkedIn Opened'}
                    {selectedWeapon === 'calendar' && 'Calendar Opened'}
                  </h4>
                  <p className="ies-result-desc">{sendResult.message}</p>
                  <p className="ies-result-detail">
                    {selectedWeapon === 'email' && 'Complete the send in your email app.'}
                    {selectedWeapon === 'text' && 'Complete the send in your SMS app.'}
                    {selectedWeapon === 'call' && 'Complete the call on your phone.'}
                    {selectedWeapon === 'linkedin' && 'Paste your message on LinkedIn.'}
                    {selectedWeapon === 'calendar' && 'Save the event in your calendar.'}
                  </p>
                </div>
              )}

              {sendResult?.result === SEND_RESULT.FAILED && (
                <div className="ies-result-failed">
                  <div className="ies-result-icon ies-result-icon-failed">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <h4 className="ies-result-title">Action Failed</h4>
                  <p className="ies-result-desc">{sendResult.error || 'Something went wrong. Please try again.'}</p>
                </div>
              )}

              {sendResult?.result === SEND_RESULT.UNAVAILABLE && (
                <div className="ies-result-failed">
                  <div className="ies-result-icon ies-result-icon-failed">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <h4 className="ies-result-title">Action Unavailable</h4>
                  <p className="ies-result-desc">{sendResult.reason}</p>
                </div>
              )}

              <div className="ies-result-actions">
                <button className="ies-done-btn" onClick={handleDone}>
                  <Check className="w-4 h-4" />
                  Done
                </button>
                <button className="ies-another-btn" onClick={handleSendAnother}>
                  <Plus className="w-4 h-4" />
                  Send Another
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default InlineEngagementSection;
