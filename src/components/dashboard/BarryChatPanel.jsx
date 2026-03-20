/**
 * BarryChatPanel — Barry Mission Control command interface.
 *
 * Sprint 5 full rebuild.
 *
 * On mount:
 *   1. Builds context stack (contacts + missions + RECON from Firestore)
 *   2. Calls barryMissionChat with message='__OPENING_BRIEF__'
 *   3. Renders the opening brief + suggested prompts
 *
 * Conversation:
 *   - Free-text command input (Enter to send)
 *   - Context stack sent with every message
 *   - Barry mode auto-updates from response barry_mode field
 *   - Mode badge is clickable to manually cycle modes
 *   - When has_message_angles === true: renders MessageAngleBlock instead of text
 *   - Conversation history maintained in-session for multi-turn context
 *
 * Collapsible: collapses on mobile for returning users (sessionStorage flag).
 */

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { buildContextStack } from '../../utils/barryContextStack';
import { updateIcpFromChat } from '../../utils/updateIcpFromChat';
import MessageAngleBlock from '../shared/MessageAngleBlock';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// ── Conversation persistence helpers ───────────────────────────────────────────

async function saveConversation(userId, messages, conversationHistory, mode) {
  try {
    await setDoc(
      doc(db, 'users', userId, 'barryConversations', 'missionControl'),
      {
        messages: messages.slice(-30),
        conversationHistory: conversationHistory.slice(-20),
        mode,
        updatedAt: serverTimestamp()
      }
    );
  } catch (err) {
    console.warn('[BarryChatPanel] Could not save conversation:', err.message);
  }
}

async function loadConversation(userId) {
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'barryConversations', 'missionControl'));
    if (snap.exists()) return snap.data();
  } catch (err) {
    console.warn('[BarryChatPanel] Could not load conversation:', err.message);
  }
  return null;
}

// ── ICP intent helpers (pure, outside component) ───────────────────────────────

function detectIcpIntent(message) {
  const patterns = [
    // Explicit target verbs
    /i want to target\s+(.+)/i,
    /let'?s go after\s+(.+)/i,
    /start targeting\s+(.+)/i,
    /we should (?:be )?targeting\s+(.+)/i,
    /can we (?:target|go after|focus on)\s+(.+)/i,
    // Switch / pivot / replace
    /switch (?:our )?focus to\s+(.+)/i,
    /pivot to\s+(.+)/i,
    /try (?:targeting\s+)?(.+?)\s+instead/i,
    /forget .+?,?\s*(?:let'?s\s+)?(?:do|try|focus on)\s+(.+)/i,
    /forget .+?,?\s+let'?s (?:now )?focus on\s+(.+)/i,
    // Add / expand
    /add (.+?) to (?:our )?targeting/i,
    /^add\s+(.+?)(?:\s+to.+)?$/i,
    // Casual phrasing
    /what about (?:targeting\s+)?(.+?)(?:\?|$)/i,
    /what if we (?:target|focus on|go after)\s+(.+)/i,
    /(?:let'?s )?focus on\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return { detected: true, newTarget: match[1].replace(/[.!?]$/, '').trim() };
  }
  return { detected: false, newTarget: null };
}

function buildIcpSummary(icpProfile) {
  const parts = [];
  if (icpProfile.industries?.length) parts.push(icpProfile.industries.slice(0, 3).join(', '));
  if (icpProfile.companySizes?.length) parts.push(icpProfile.companySizes.slice(0, 2).join('/') + ' employees');
  if (icpProfile.isNationwide) parts.push('nationwide');
  else if (icpProfile.locations?.length) parts.push(icpProfile.locations.slice(0, 2).join(', '));
  return parts.length ? parts.join(' — ') : 'your current profile';
}

// ── Action intent detection (routes to barryActions instead of barryMissionChat) ──

const ACTION_PATTERNS = [
  /\b(send it|send this|go ahead(?: and send)?|yes[,.]?\s*send|send that|send (?:the )?(?:email|message))\b/i,
  /\b(check (?:my )?inbox|any (?:new )?(?:emails?|messages?|replies?)|what(?:'s| is) in my inbox|did .+ reply)\b/i,
  /\b(check (?:my )?calendar|what(?:'s| is) on my calendar|am i free|what do i have (?:today|this week|tomorrow))\b/i,
  /\b(book (?:a )?(?:call|meeting)|schedule (?:a )?(?:call|meeting|time)|set up (?:a )?(?:call|meeting))\b/i,
];

function isActionIntent(message) {
  return ACTION_PATTERNS.some(p => p.test(message));
}

// ── Mode configuration ─────────────────────────────────────────────────────────

const MODE_CONFIG = {
  PRIORITIZE: {
    label: 'PRIORITIZE',
    pillClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    dotClass: 'bg-red-500'
  },
  SUGGEST: {
    label: 'SUGGEST',
    pillClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    dotClass: 'bg-teal-500'
  },
  GROWTH: {
    label: 'GROWTH',
    pillClass: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    dotClass: 'bg-purple-500'
  }
};

const MODES = ['SUGGEST', 'PRIORITIZE', 'GROWTH'];

// ── Component ──────────────────────────────────────────────────────────────────

export default function BarryChatPanel({ userId }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('SUGGEST');
  const [brief, setBrief] = useState('');
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [contextStack, setContextStack] = useState(null);
  const [pendingIcpChange, setPendingIcpChange] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const conversationHistoryRef = useRef(conversationHistory);
  const modeRef = useRef(mode);

  useEffect(() => { conversationHistoryRef.current = conversationHistory; }, [conversationHistory]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Reset textarea height after message is sent
  useEffect(() => {
    if (!inputValue && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [inputValue]);

  // ── On mount: build context stack + load opening brief ────────────────────

  useEffect(() => {
    const hasVisited = sessionStorage.getItem('barry_mission_visited');
    const isMobile = window.innerWidth < 768;
    if (hasVisited && isMobile) {
      setIsCollapsed(true);
    }
    sessionStorage.setItem('barry_mission_visited', 'true');

    initPanel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save conversation to Firestore whenever messages change ───────────

  useEffect(() => {
    if (messages.length === 0 || !userId) return;
    const timer = setTimeout(() => {
      saveConversation(userId, messages, conversationHistoryRef.current, modeRef.current);
    }, 800);
    return () => clearTimeout(timer);
  }, [messages, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll conversation thread ───────────────────────────────────────

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // ── Init: build context stack, then load opening brief ────────────────────

  async function initPanel() {
    const user = getEffectiveUser();
    if (!user) { setLoading(false); return; }

    // Restore saved conversation before loading the fresh brief
    const saved = await loadConversation(user.uid);
    if (saved?.messages?.length > 0) {
      setMessages(saved.messages);
      setConversationHistory(saved.conversationHistory || []);
      if (saved.mode) setMode(saved.mode);
    }

    // Build context stack first (non-blocking for brief load)
    let stack = null;
    try {
      stack = await buildContextStack(user.uid);
      setContextStack(stack);
    } catch (err) {
      console.warn('[BarryChatPanel] Context stack build failed (non-fatal):', err.message);
    }

    await loadOpeningBrief(user, stack);
  }

  // ── Opening brief ─────────────────────────────────────────────────────────

  async function loadOpeningBrief(user, stack) {
    try {
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: '__OPENING_BRIEF__',
          contextStack: stack || null
        })
      });

      const data = await res.json();

      if (data.success) {
        // Update mode from server determination
        if (data.mode || data.barry_mode) {
          setMode(data.mode || data.barry_mode);
        }
        setBrief(data.brief || data.response_text || '');
        setSuggestedPrompts(data.suggestedPrompts || []);
      } else {
        setFallbackBrief();
      }
    } catch (err) {
      console.error('[BarryChatPanel] Opening brief failed:', err);
      setFallbackBrief();
    } finally {
      setLoading(false);
    }
  }

  function setFallbackBrief() {
    setBrief('Your pipeline is ready. Tell me what you want to work on.');
    setSuggestedPrompts([
      'What should I focus on today?',
      "Who haven't I followed up with?",
      'Help me write a follow-up message.'
    ]);
  }

  // ── ICP update: extract params from original message, write to Firestore ──

  async function processIcpUpdate(originalMessage, action) {
    try {
      const user = getEffectiveUser();
      if (!user) { setSending(false); return; }
      const authToken = await user.getIdToken();

      // Use the ICP reclarification backend path to extract icp_params
      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: originalMessage,
          icpMode: true,
          icpProfile: null,
          conversationHistory: []
        })
      });

      const data = await res.json();

      if (data.success && data.icp_params) {
        const newProfile = await updateIcpFromChat(userId, data.icp_params, action, contextStack?.icpProfile);
        setContextStack(prev => ({ ...prev, icpProfile: newProfile }));
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "Got it. I've updated your ICP. I'll use this for targeting going forward.",
          has_message_angles: false,
          angles: []
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I had trouble parsing that target — can you be more specific? (e.g. 'dental offices with 10–50 employees')",
          has_message_angles: false,
          angles: []
        }]);
      }
    } catch (err) {
      console.error('[BarryChatPanel] ICP update failed:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Had trouble updating your ICP — try again in a moment.',
        has_message_angles: false,
        angles: []
      }]);
    } finally {
      setSending(false);
    }
  }

  // ── Action execution via barryActions ─────────────────────────────────────

  async function handleActionMessage(userMessage) {
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const user = getEffectiveUser();
      if (!user) { setSending(false); return; }
      const authToken = await user.getIdToken();

      // Pull context from the last angle block Barry generated
      const lastAngleMsg = [...messages].reverse().find(m => m.has_message_angles && m.angles?.length > 0);
      const recommendedAngle = lastAngleMsg?.angles?.find(a => a.recommended) || lastAngleMsg?.angles?.[0];
      const lastContactId = lastAngleMsg?.contact_id || null;
      const lastContact = contextStack?.contacts?.find(c => c.id === lastContactId);

      // Fetch contact email from Firestore if we have a contactId
      let contactEmail = null;
      if (lastContactId) {
        try {
          const contactSnap = await getDoc(doc(db, 'users', userId, 'contacts', lastContactId));
          if (contactSnap.exists()) contactEmail = contactSnap.data()?.email || null;
        } catch (_) {}
      }

      const context = {
        ...(recommendedAngle && { subject: recommendedAngle.subject, body: recommendedAngle.message }),
        ...(lastContact && { to_name: lastContact.name }),
        ...(contactEmail && { to_email: contactEmail }),
      };

      const res = await fetch('/.netlify/functions/barryActions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, message: userMessage, context })
      });
      const data = await res.json();

      // Integration not connected
      if (!data.success && data.error === 'not_connected') {
        setMessages(prev => [...prev, { role: 'action_not_connected', service: data.service, text: data.message }]);
        return;
      }

      // Destructive action — show confirmation bubble
      if (data.requires_confirmation && data.action?.confidence >= 0.7) {
        setPendingAction(data.action);
        setMessages(prev => [...prev, { role: 'action_confirm', action: data.action, summary: data.action.summary }]);
        return;
      }

      // Non-destructive action executed immediately
      if (data.executed) {
        const { action, result } = data;
        if (action.action_type === 'gmail_read') {
          setMessages(prev => [...prev, { role: 'action_inbox', threads: result?.threads || [] }]);
        } else if (action.action_type === 'calendar_check') {
          setMessages(prev => [...prev, { role: 'action_calendar', events: result?.events || [] }]);
        } else if (action.action_type === 'gmail_draft') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Draft ready:\n\n**Subject:** ${result.draft?.subject || ''}\n\n${result.draft?.body || ''}`,
            has_message_angles: false, angles: []
          }]);
        }
        return;
      }

      // Barry couldn't parse a clear action — fall back to barryMissionChat for a conversational response
      const user2 = getEffectiveUser();
      if (user2) {
        const authToken2 = await user2.getIdToken();
        const missionRes = await fetch('/.netlify/functions/barryMissionChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            authToken: authToken2,
            message: userMessage,
            conversationHistory,
            barryMode: mode,
            contextStack
          })
        });
        const missionData = await missionRes.json();
        if (missionData.success) {
          if (missionData.barry_mode && missionData.barry_mode !== mode) setMode(missionData.barry_mode);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: missionData.response_text || missionData.response || '',
            has_message_angles: !!missionData.has_message_angles,
            angles: missionData.angles || [],
            contact_id: missionData.contact_id || null,
            intent: missionData.intent || null,
            step: missionData.step || null
          }]);
          setConversationHistory(missionData.updatedHistory || []);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: "I wasn't sure what to do with that — can you be more specific?",
            has_message_angles: false, angles: []
          }]);
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I wasn't sure what to do with that — can you be more specific?",
          has_message_angles: false, angles: []
        }]);
      }

    } catch (err) {
      console.error('[BarryChatPanel] handleActionMessage failed:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Action failed — try again in a moment.',
        has_message_angles: false, angles: []
      }]);
    } finally {
      setSending(false);
    }
  }

  async function executeConfirmedAction(action) {
    setSending(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryActions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, confirm: true, pendingAction: action })
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'action_result',
        success: !!(data.success && data.executed),
        text: data.message || data.error || 'Done.'
      }]);
    } catch (err) {
      console.error('[BarryChatPanel] executeConfirmedAction failed:', err);
      setMessages(prev => [...prev, { role: 'action_result', success: false, text: 'Failed — try again.' }]);
    } finally {
      setSending(false);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;

    const userMessage = text.trim();
    setInputValue('');

    // ── Action confirmation flow (user responding to a pending action) ──
    if (pendingAction) {
      const lower = userMessage.toLowerCase().trim();
      const isConfirm = /^(yes|yeah|yep|send|confirm|do it|go|ok|sure|absolutely)[!.]?$/i.test(lower);
      const isCancel = /^(no|nope|cancel|stop|don't|wait|nevermind|never mind)[!.]?$/i.test(lower);

      if (isConfirm) {
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        const saved = pendingAction;
        setPendingAction(null);
        await executeConfirmedAction(saved);
        return;
      }
      if (isCancel) {
        setMessages(prev => [...prev,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: 'Got it — cancelled.', has_message_angles: false, angles: [] }
        ]);
        setPendingAction(null);
        return;
      }
      // Ambiguous — clear pending and fall through
      setPendingAction(null);
    }

    // ── ICP confirmation flow (user responding to add vs. replace question) ──
    if (pendingIcpChange) {
      const lower = userMessage.toLowerCase();
      const isAdd = /\badd\b|merge|include|addition/.test(lower);
      const isReplace = /\breplace\b|swap|overwrite|switch|start fresh|start over/.test(lower);

      if (isAdd || isReplace) {
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setSending(true);
        const action = isReplace ? 'replace' : 'add';
        const saved = pendingIcpChange;
        setPendingIcpChange(null);
        await processIcpUpdate(saved.originalMessage, action);
        return;
      }
      // Ambiguous — clear pending and fall through to normal send
      setPendingIcpChange(null);
    }

    // ── ICP intent detection (user signals a new targeting focus) ──
    const icpIntent = detectIcpIntent(userMessage);
    if (icpIntent.detected && contextStack?.icpProfile) {
      const summary = buildIcpSummary(contextStack.icpProfile);
      setMessages(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        {
          role: 'assistant',
          content: `You're currently targeting ${summary}. Do you want to add "${icpIntent.newTarget}" to your current ICP, or replace it entirely?`,
          has_message_angles: false,
          angles: []
        }
      ]);
      setPendingIcpChange({ originalMessage: userMessage, newTarget: icpIntent.newTarget });
      return;
    }

    // ── Action intent (send email, check inbox, check calendar) ──
    if (isActionIntent(userMessage)) {
      await handleActionMessage(userMessage);
      return;
    }

    // ── Normal message path ──
    setSending(true);

    // Optimistically add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    // Scroll to the bottom instantly after user message
    setTimeout(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    }, 0);

    try {
      const user = getEffectiveUser();
      if (!user) { setSending(false); return; }

      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: userMessage,
          conversationHistory,
          barryMode: mode,
          contextStack
        })
      });

      const data = await res.json();

      if (data.success) {
        // Auto-update mode if Barry detected a shift
        if (data.barry_mode && data.barry_mode !== mode) {
          setMode(data.barry_mode);
        }

        // LLM-detected ICP change intent — trigger add/replace confirmation flow
        if (data.intent === 'ICP_CHANGE' && data.new_target && contextStack?.icpProfile) {
          // Log suppressed response for intent classification tuning
          console.warn('[BarryChatPanel] ICP_CHANGE intercepted — suppressed response_text:', data.response_text || '(empty)', '| new_target:', data.new_target);
          const summary = buildIcpSummary(contextStack.icpProfile);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `You're currently targeting ${summary}. Do you want to add "${data.new_target}" to your current ICP, or replace it entirely?`,
            has_message_angles: false,
            angles: []
          }]);
          setPendingIcpChange({ originalMessage: userMessage, newTarget: data.new_target });
          return;
        }

        // Build assistant message object with structured fields
        const assistantMsg = {
          role: 'assistant',
          content: data.response_text || data.response || '',
          has_message_angles: !!data.has_message_angles,
          angles: data.angles || [],
          contact_id: data.contact_id || null,
          intent: data.intent || null,
          step: data.step || null
        };

        setMessages(prev => [...prev, assistantMsg]);
        setConversationHistory(data.updatedHistory || []);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'I had trouble processing that. Try asking again.',
          has_message_angles: false,
          angles: []
        }]);
      }
    } catch (err) {
      console.error('[BarryChatPanel] Send message failed:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection issue — try again in a moment.',
        has_message_angles: false,
        angles: []
      }]);
    } finally {
      setSending(false);
    }
  };

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handlePromptClick = (prompt) => {
    sendMessage(prompt);
    if (isCollapsed) setIsCollapsed(false);
  };

  const handleModeClick = (e) => {
    e.stopPropagation();
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const modeConfig = MODE_CONFIG[mode] || MODE_CONFIG.SUGGEST;
  const hasConversation = messages.length > 0;
  const lastMessage = messages[messages.length - 1];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="mb-12" aria-label="Barry Mission Co-pilot">

      {/* ── Panel Header (always visible) ── */}
      <div
        className="flex items-center justify-between px-5 py-4 bg-black/50 backdrop-blur-xl border border-cyan-500/20 cursor-pointer select-none"
        style={{
          borderRadius: isCollapsed ? '1rem' : '1rem 1rem 0 0',
          boxShadow: '0 0 20px rgba(6, 182, 212, 0.1)'
        }}
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        {/* Left: Barry identity */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            {loading ? (
              <>
                <span className="text-4xl opacity-60 animate-pulse">🐻</span>
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/40 animate-ping" />
              </>
            ) : (
              <span className="text-4xl">🐻</span>
            )}
          </div>

          <div>
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-white font-semibold text-sm font-mono">Barry</span>

              {/* Mode badge — clickable to cycle modes */}
              <button
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-mono cursor-pointer transition-opacity hover:opacity-80 ${modeConfig.pillClass}`}
                onClick={handleModeClick}
                title="Click to change Barry's mode"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${modeConfig.dotClass}`} />
                {modeConfig.label}
              </button>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-cyan-400 font-mono">Online</span>

              {/* Collapsed: show last message preview */}
              {isCollapsed && lastMessage && lastMessage.content && (
                <span className="text-xs text-gray-400 truncate max-w-xs ml-1">
                  {lastMessage.content.length > 50
                    ? lastMessage.content.slice(0, 50) + '...'
                    : lastMessage.content}
                </span>
              )}
              {isCollapsed && loading && (
                <span className="text-xs text-gray-500 font-mono animate-pulse ml-1">Loading...</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: collapse toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all text-lg font-mono flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
          aria-label={isCollapsed ? 'Expand Barry panel' : 'Collapse Barry panel'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      </div>

      {/* ── Panel Body (collapsible) ── */}
      {!isCollapsed && (
        <div
          className="bg-black/40 backdrop-blur-xl border-x border-b border-cyan-500/20 overflow-hidden"
          style={{ borderRadius: '0 0 1rem 1rem', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}
        >

          {/* Opening Brief */}
          <div className="px-5 pt-5 pb-4">
            {loading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Barry is thinking">
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-3/4" />
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-full" />
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-2/3" />
              </div>
            ) : (
              <div className="text-gray-200 text-sm leading-relaxed">
                <ReactMarkdown className="prose prose-invert prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0">
                  {brief}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Suggested prompts (shown only when no conversation yet) */}
          {!loading && !hasConversation && suggestedPrompts.length > 0 && (
            <div className="px-5 pb-4 flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  className="px-3 py-1.5 text-xs font-mono bg-black/40 hover:bg-cyan-500/10 border border-gray-700/60 hover:border-cyan-500/30 text-gray-400 hover:text-cyan-300 rounded-lg transition-all"
                  onClick={() => handlePromptClick(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Conversation Thread */}
          {(hasConversation || sending) && (
            <>
              <div className="mx-5 border-t border-cyan-500/10" />
              <div
                ref={threadRef}
                className="px-5 py-4 overflow-y-auto flex flex-col gap-3"
                style={{ maxHeight: '40vh' }}
                aria-live="polite"
                aria-label="Conversation with Barry"
              >
                {messages.map((msg, i) => {
                  // Mission-created confirmation bubble
                  if (msg.role === 'event' && msg.event === 'mission_created') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-2 leading-relaxed bg-emerald-500/10 text-emerald-200 border border-emerald-500/25 rounded-2xl rounded-tl-sm">
                          ✓ Mission created for <strong>{msg.contactName}</strong>. Draft is ready in Active Missions.{' '}
                          <a
                            href="/hunter"
                            className="underline underline-offset-2 text-emerald-300 hover:text-emerald-100 transition-colors"
                          >
                            View in Hunter →
                          </a>
                        </div>
                      </div>
                    );
                  }

                  // ── Action confirmation bubble ──
                  if (msg.role === 'action_confirm') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-3 leading-relaxed bg-cyan-500/10 text-cyan-200 border border-cyan-500/30 rounded-2xl rounded-tl-sm max-w-[88%]">
                          <div className="mb-3">📧 {msg.summary}</div>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => { const saved = pendingAction; setPendingAction(null); await executeConfirmedAction(saved); }}
                              className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 rounded-lg text-xs font-mono transition-all"
                            >
                              Yes, send →
                            </button>
                            <button
                              onClick={() => { setPendingAction(null); setMessages(prev => [...prev, { role: 'assistant', content: 'Got it — cancelled.', has_message_angles: false, angles: [] }]); }}
                              className="px-3 py-1.5 bg-gray-700/40 hover:bg-gray-700/60 border border-gray-600/40 text-gray-400 rounded-lg text-xs font-mono transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Action result bubble ──
                  if (msg.role === 'action_result') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className={`text-sm px-3 py-2 leading-relaxed border rounded-2xl rounded-tl-sm ${
                          msg.success
                            ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25'
                            : 'bg-red-500/10 text-red-300 border-red-500/25'
                        }`}>
                          {msg.success ? '✓ ' : '✗ '}{msg.text}
                        </div>
                      </div>
                    );
                  }

                  // ── Gmail inbox bubble ──
                  if (msg.role === 'action_inbox') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="flex flex-col gap-1.5 max-w-[88%]">
                          <div className="text-xs text-gray-500 font-mono px-1">Recent inbox</div>
                          {msg.threads.length === 0 ? (
                            <div className="text-sm px-3 py-2 bg-gray-800/60 text-gray-400 border border-gray-700/50 rounded-2xl rounded-tl-sm">Inbox is empty.</div>
                          ) : msg.threads.map((thread, ti) => (
                            <div key={ti} className="text-sm px-3 py-2 bg-gray-800/60 text-gray-200 border border-gray-700/50 rounded-xl">
                              <div className="font-medium text-gray-100 truncate">{thread.subject || '(no subject)'}</div>
                              <div className="text-xs text-gray-400 mt-0.5 truncate">{thread.from}</div>
                              {thread.snippet && <div className="text-xs text-gray-500 mt-1 line-clamp-1">{thread.snippet}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // ── Calendar events bubble ──
                  if (msg.role === 'action_calendar') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="flex flex-col gap-1.5 max-w-[88%]">
                          <div className="text-xs text-gray-500 font-mono px-1">Upcoming calendar</div>
                          {msg.events.length === 0 ? (
                            <div className="text-sm px-3 py-2 bg-gray-800/60 text-gray-400 border border-gray-700/50 rounded-2xl rounded-tl-sm">Nothing scheduled.</div>
                          ) : msg.events.slice(0, 5).map((event, ei) => (
                            <div key={ei} className="text-sm px-3 py-2 bg-gray-800/60 text-gray-200 border border-gray-700/50 rounded-xl">
                              <div className="font-medium text-gray-100">{event.title}</div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {event.start ? new Date(event.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Time TBD'}
                              </div>
                              {event.attendees?.length > 0 && (
                                <div className="text-xs text-gray-500 mt-0.5">With: {event.attendees.join(', ')}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // ── Integration not connected bubble ──
                  if (msg.role === 'action_not_connected') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-2 leading-relaxed bg-amber-500/10 text-amber-200 border border-amber-500/25 rounded-2xl rounded-tl-sm">
                          {msg.text}{' '}
                          <a href="/basecamp?tab=integrations" className="underline text-amber-300 hover:text-amber-100 transition-colors">
                            Connect {msg.service} →
                          </a>
                        </div>
                      </div>
                    );
                  }

                  if (msg.role === 'user') {
                    return (
                      <div key={i} className="flex gap-2 flex-row-reverse">
                        <div className="text-sm px-3 py-2 max-w-[82%] leading-relaxed bg-cyan-500/20 text-cyan-100 border border-cyan-500/30 rounded-2xl rounded-tr-sm">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  // Assistant message
                  return (
                    <div key={i} className="flex gap-2 flex-row">
                      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                      <div className="flex flex-col gap-2 max-w-[88%]">
                        {/* Text portion — always shown if present */}
                        {msg.content && (
                          <div className="text-sm px-3 py-2 leading-relaxed bg-gray-800/60 text-gray-200 border border-gray-700/50 rounded-2xl rounded-tl-sm">
                            <ReactMarkdown className="prose prose-invert prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0">
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}

                        {/* Message angle block — shown when Barry generated 4 angles */}
                        {msg.has_message_angles && msg.angles && msg.angles.length > 0 && (
                          <MessageAngleBlock
                            angles={msg.angles}
                            contactId={msg.contact_id}
                            userId={userId}
                            onLoaded={(result) => {
                              if (result.created) {
                                setMessages(prev => [...prev, {
                                  role: 'event',
                                  event: 'mission_created',
                                  contactName: result.contactName,
                                  missionId: result.missionId
                                }]);
                              }
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Typing indicator */}
                {sending && (
                  <div className="flex gap-2" aria-label="Barry is typing">
                    <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Input Area */}
          <div className="px-5 py-4 border-t border-cyan-500/10">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                rows={1}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                }}
                onKeyDown={handleKeyDown}
                placeholder="Tell me what you want to work on..."
                disabled={sending || loading}
                aria-label="Message Barry"
                style={{ resize: 'none', overflowY: 'auto' }}
                className="flex-1 min-w-0 bg-black/50 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50 font-mono leading-relaxed"
              />
              <button
                onClick={() => sendMessage(inputValue)}
                disabled={sending || loading || !inputValue.trim()}
                aria-label="Send message"
                className="flex-shrink-0 px-4 py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 rounded-xl text-sm font-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send →
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
