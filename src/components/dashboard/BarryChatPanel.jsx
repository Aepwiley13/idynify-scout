/**
 * BarryChatPanel — Barry Mission Control command interface.
 *
 * Sprint 5 full rebuild.
 *
 * On mount:
 *   1. Builds context stack (contacts + missions + RECON from Firestore)
 *   2. Calls barryOrientationBrief (cached 10 min in sessionStorage)
 *   3. Renders the orientation brief + suggested prompts
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
import { doc, setDoc, getDoc, collection, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { buildContextStack } from '../../utils/barryContextStack';
import { updateIcpFromChat } from '../../utils/updateIcpFromChat';
import MessageAngleBlock from '../shared/MessageAngleBlock';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useShell } from '../../context/ShellContext';
import { appendTurn, loadOrSeedRecentTurns } from '../../utils/barryCanonical';
import { BRAND, STATUS } from '../../theme/tokens';

const DEFAULT_TOKENS = {
  appBg:     '#000000',
  cardBg:    '#110e1e',
  cardBg2:   '#0b0818',
  surface:   '#ffffff08',
  surface2:  '#ffffff0d',
  border:    '#ffffff0d',
  border2:   '#ffffff18',
  text:      '#f0eaff',
  textMuted: '#9080b0',
  textFaint: '#4a3870',
  textGhost: '#2a1a50',
  input:     '#ffffff08',
  accent:    BRAND.pink,
  accentBg:  `${BRAND.pink}15`,
  accentBdr: `${BRAND.pink}35`,
  cyan:      BRAND.cyan,
  cyanBg:    `${BRAND.cyan}12`,
  cyanBdr:   `${BRAND.cyan}35`,
  isDark:    true,
  statBg:    '#ffffff06',
};

// ── Conversation persistence helpers ───────────────────────────────────────────

async function saveMissionControlState(userId, mode) {
  try {
    await setDoc(
      doc(db, 'users', userId, 'barryConversations', 'missionControl'),
      { mode, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[BarryChatPanel] Could not save MC state:', err.message);
  }
}

async function loadConversation(userId) {
  try {
    const turns = await loadOrSeedRecentTurns(db, userId, 30);
    if (turns.length > 0) {
      const mcSnap = await getDoc(doc(db, 'users', userId, 'barryConversations', 'missionControl'));
      const mode = mcSnap.exists() ? mcSnap.data().mode : null;
      return {
        messages: turns.map(t => ({
          role: t.role,
          content: t.content,
          kind: t.kind || undefined,
          has_message_angles: t.kind === 'angles',
        })),
        conversationHistory: turns.map(t => ({ role: t.role, content: t.content })),
        mode,
      };
    }
  } catch (err) {
    console.warn('[BarryChatPanel] Could not load conversation:', err.message);
  }
  return null;
}

// ── Per-session history (barry_sessions subcollection) ─────────────────────────
//
// ⚠️ NAME COLLISION — READ BEFORE TOUCHING THIS (P0A / defect A9)
// ───────────────────────────────────────────────────────────────
// "barry_sessions" names TWO UNRELATED COLLECTIONS with different parents and
// incompatible schemas:
//
//   users/{uid}/barry_sessions/{sessionId}
//       ← THIS ONE. Mission Control chat-panel transcripts.
//         Written here, read by BarrySessionHistoryPanel.
//         Shape: { type, module, summary, messages[], messageCount, ... }
//
//   users/{uid}/contacts/{contactId}/barry_sessions/{sessionId}
//       ← A DIFFERENT COLLECTION. Per-contact engagement session records.
//         Written by src/services/barryMemoryService.js, read by
//         netlify/functions/utils/barryContextAssembler.js.
//         Shape: { started_at, goal, generated_messages[], session_summary, ... }
//
// They are not two views of one thing. Writing this shape into the contact
// path would corrupt Barry's relationship memory, because the context
// assembler reads `session_summary` from those documents and injects it into
// every generation prompt for that contact.
//
// P0A isolates the collision by naming it. It does NOT rename or migrate —
// unifying the conversation store is Barry OS architecture work (ADR-005 says
// memory is keyed by contact with sessions beneath it, which this collection
// contradicts). Until then: never reuse this helper for a contact-scoped path.

/** Path for a Mission Control chat transcript. USER-scoped — see the note above. */
function missionControlSessionRef(userId, sessionId) {
  return doc(db, 'users', userId, 'barry_sessions', sessionId);
}

async function createSessionDoc(userId, sessionId, module) {
  try {
    await setDoc(missionControlSessionRef(userId, sessionId), {
      type: 'mission_control',
      module: module || 'mission-control',
      summary: null,
      messages: [],
      messageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[BarryChatPanel] Could not create session doc:', err.message);
  }
}

async function updateSessionDoc(userId, sessionId, messages, summary) {
  try {
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    const derivedSummary = summary
      || (assistantMsgs[0]?.content ? assistantMsgs[0].content.slice(0, 120) : null);
    await setDoc(missionControlSessionRef(userId, sessionId), {
      messages: messages.slice(-30).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 500) : '',
        has_message_angles: m.has_message_angles || false,
      })),
      messageCount: messages.length,
      summary: derivedSummary,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[BarryChatPanel] Could not update session doc:', err.message);
  }
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

/**
 * One id per user turn, sent with every function call that turn fans out to
 * (P0B / defect A2). A Mission Control message can hit barryActions and then
 * barryMissionChat; without this they land in apiLogs as unrelated rows and
 * the real cost of a single user action cannot be reconstructed.
 *
 * Format is constrained to what the server accepts: [A-Za-z0-9_-], max 64.
 */
function newTraceId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `mc-${Date.now().toString(36)}-${rand}`;
}

// ── Action intent detection (routes to barryActions instead of barryMissionChat) ──

const ACTION_PATTERNS = [
  /\b(send it|send this|go ahead(?: and send)?|yes[,.]?\s*send|send that|send (?:the )?(?:email|message))\b/i,
  /\b(check (?:my )?inbox|any (?:new )?(?:emails?|messages?|replies?)|what(?:'s| is) in my inbox|did .+ reply)\b/i,
  /\b(check (?:my )?calendar|what(?:'s| is) on my calendar|am i free|what do i have (?:today|this week|tomorrow))\b/i,
  /\b(book (?:a )?(?:call|meeting)|schedule (?:a )?(?:call|meeting|time)|set up (?:a )?(?:call|meeting))\b/i,
];

function isActionIntent(message) {
  const matched = ACTION_PATTERNS.some(p => p.test(message));
  if (!matched) return false;

  // Only treat as an action if the message is short (focused intent) or
  // the action phrase appears at the start. Long compound messages like
  // "look up Alexander Smart, I need to schedule a meeting" should go
  // through barryMissionChat's intent taxonomy instead.
  const wordCount = message.trim().split(/\s+/).length;
  if (wordCount <= 8) return true;

  // For longer messages, only match if an action pattern matches the beginning
  return ACTION_PATTERNS.some(p => {
    const m = message.match(p);
    return m && m.index !== undefined && m.index < 5;
  });
}

// ── Mode configuration ─────────────────────────────────────────────────────────

const MODE_CONFIG = {
  PRIORITIZE: {
    label: 'PRIORITIZE',
    pillStyle: { background: `${STATUS.red}33`, color: STATUS.red, border: `1px solid ${STATUS.red}4d` },
    dotColor: STATUS.red,
  },
  SUGGEST: {
    label: 'SUGGEST',
    pillStyle: { background: `${BRAND.cyan}33`, color: BRAND.cyan, border: `1px solid ${BRAND.cyan}4d` },
    dotColor: BRAND.cyan,
  },
  GROWTH: {
    label: 'GROWTH',
    pillStyle: { background: `${BRAND.purple}33`, color: BRAND.purple, border: `1px solid ${BRAND.purple}4d` },
    dotColor: BRAND.purple,
  },
};

const MODES = ['SUGGEST', 'PRIORITIZE', 'GROWTH'];

// ── PipelineMoveRow — single row in an ORGANIZE_PIPELINE response ─────────────

function PipelineMoveRow({ move, onExecute }) {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error

  const stageLabels = {
    scout: 'Scout', hunter: 'Hunter', sniper: 'Sniper',
    basecamp: 'Homebase', fallback: 'Fallback'
  };

  const handleMove = async () => {
    if (status !== 'idle') return;
    setStatus('loading');
    try {
      const actionType = move.action_type === 'engage_contact' ? 'engage_contact' : 'move_stage';
      const params = actionType === 'move_stage'
        ? { to_stage: move.recommended_stage, reason: 'organize_pipeline' }
        : {};
      const successText = `${move.contact_name} moved to ${stageLabels[move.recommended_stage] || move.recommended_stage}.`;
      await onExecute({
        action_type: actionType,
        contactId: move.contact_id,
        contactName: move.contact_name,
        params,
        successText
      });
      setStatus('done');
    } catch (_) {
      setStatus('error');
    }
  };

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl" style={{ background: `${BRAND.navy}66`, border: `1px solid ${BRAND.navy}66` }}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: '#f0eaff' }}>{move.contact_name}</div>
        <div className="text-xs mt-0.5" style={{ color: '#9080b0' }}>
          <span style={{ color: '#4a3870' }}>{stageLabels[move.current_stage] || move.current_stage}</span>
          <span className="mx-1" style={{ color: '#4a3870' }}>→</span>
          <span style={{ color: BRAND.cyan }}>{stageLabels[move.recommended_stage] || move.recommended_stage}</span>
          {move.reason && <span className="ml-2" style={{ color: '#4a3870' }}>· {move.reason}</span>}
        </div>
      </div>
      <div className="flex-shrink-0">
        {status === 'idle' && (
          <button
            onClick={handleMove}
            className="px-2.5 py-1 rounded-lg text-xs font-mono transition-all"
            style={{ background: `${BRAND.cyan}26`, border: `1px solid ${BRAND.cyan}4d`, color: BRAND.cyan }}
          >
            Move →
          </button>
        )}
        {status === 'loading' && (
          <span className="text-xs font-mono" style={{ color: '#4a3870' }}>Moving...</span>
        )}
        {status === 'done' && (
          <span className="text-xs font-mono" style={{ color: STATUS.green }}>✓ Done</span>
        )}
        {status === 'error' && (
          <span className="text-xs font-mono" style={{ color: STATUS.red }}>✗ Failed</span>
        )}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function BarryChatPanel({
  userId,
  kpiContext = {},
  kpiContextReady = false,
  T = DEFAULT_TOKENS,
  onOrientationChange = null,
  // Phase 7 navigation context contract, supplied by the shell. Tells Barry
  // where the user is, what they have open and what they are doing, so his
  // expertise follows them across modules WITHOUT starting a new thread.
  // Shape: src/context/ShellContext.jsx → navigationContext.
  navigationContext = null,
}) {
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
  const [pendingPipelineAction, setPendingPipelineAction] = useState(null);
  const [briefLoading, setBriefLoading] = useState(true);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const conversationHistoryRef = useRef(conversationHistory);
  const modeRef = useRef(mode);
  const sessionIdRef = useRef(null);

  const { barryOpen } = useShell();

  useEffect(() => { conversationHistoryRef.current = conversationHistory; }, [conversationHistory]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Reset textarea height after message is sent
  useEffect(() => {
    if (!inputValue && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [inputValue]);

  // ── On mount: build context stack + restore conversation ──────────────────

  useEffect(() => {
    const hasVisited = sessionStorage.getItem('barry_mission_visited');
    const isMobile = window.innerWidth < 768;
    if (hasVisited && isMobile) {
      setIsCollapsed(true);
    }
    sessionStorage.setItem('barry_mission_visited', 'true');

    initPanel();
  }, []);

  const prevBarryOpenRef = useRef(false);
  useEffect(() => {
    if (barryOpen && !prevBarryOpenRef.current && !loading) {
      syncFromCanonical();
    }
    prevBarryOpenRef.current = barryOpen;
  }, [barryOpen, loading]);

  async function syncFromCanonical() {
    const user = getEffectiveUser();
    if (!user) return;
    try {
      const saved = await loadConversation(user.uid);
      if (saved?.messages?.length > 0) {
        setMessages(saved.messages);
        setConversationHistory(saved.conversationHistory || []);
        if (saved.mode) setMode(saved.mode);
      }
    } catch (err) {
      console.warn('[BarryChatPanel] canonical sync failed (non-fatal):', err.message);
    }
  }

  // ── Gate orientation brief on KPI readiness ──────────────────────────────

  const hasRequestedOrientation = useRef(false);

  useEffect(() => {
    if (!userId || !kpiContextReady || hasRequestedOrientation.current) return;
    hasRequestedOrientation.current = true;
    loadOrientationBrief();
  }, [userId, kpiContextReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save conversation to Firestore whenever messages change ───────────

  useEffect(() => {
    if (messages.length === 0 || !userId) return;
    const timer = setTimeout(() => {
      saveMissionControlState(userId, modeRef.current);
      if (sessionIdRef.current) {
        updateSessionDoc(userId, sessionIdRef.current, messages, null);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [messages, userId]);

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

    // Create a new session doc for this visit
    const newSessionId = crypto.randomUUID();
    sessionIdRef.current = newSessionId;
    createSessionDoc(user.uid, newSessionId, 'mission-control');

    // Restore saved conversation before loading the fresh brief
    const saved = await loadConversation(user.uid);
    if (saved?.messages?.length > 0) {
      setMessages(saved.messages);
      setConversationHistory(saved.conversationHistory || []);
      if (saved.mode) setMode(saved.mode);
    }

    // Unblock the UI immediately — user can start typing while brief loads
    setLoading(false);

    // Build context stack in the background (non-blocking)
    try {
      const stack = await buildContextStack(user.uid);
      setContextStack(stack);
    } catch (err) {
      console.warn('[BarryChatPanel] Context stack build failed (non-fatal):', err.message);
    }
  }

  async function loadOrientationBrief() {
    const user = getEffectiveUser();
    if (!user) return;
    loadOpeningBrief(user, contextStack);
  }

  // ── Opening brief (orientation) ───────────────────────────────────────────

  const ORIENTATION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const orientationCacheKey = userId ? `barry_orientation_${userId}` : null;

  async function loadOpeningBrief(user, _stack) {
    setBriefLoading(true);
    onOrientationChange?.({ status: 'loading' });
    try {
      // Check sessionStorage cache — skip API call if still warm
      if (orientationCacheKey) {
        try {
          const cached = sessionStorage.getItem(orientationCacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.cachedAt < ORIENTATION_CACHE_TTL) {
              setBrief(parsed.brief);
              setSuggestedPrompts(parsed.suggestedPrompts);
              if (parsed.mode) setMode(parsed.mode);
              onOrientationChange?.({
                status: 'ready',
                brief: parsed.brief,
                suggestedPrompts: parsed.suggestedPrompts,
                mode: parsed.mode,
              });
              setBriefLoading(false);
              return;
            }
          }
        } catch (_) { /* cache miss — proceed to fresh load */ }
      }

      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (loadOpeningBrief):', tokenErr.message);
        setFallbackBrief();
        onOrientationChange?.({ status: 'error', error: tokenErr, brief: null, suggestedPrompts: [] });
        setBriefLoading(false); return;
      }

      const res = await fetch('/.netlify/functions/barryOrientationBrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, context: kpiContext, navigationContext }),
      });

      const data = await res.json();

      if (data.success) {
        const brief = data.brief || data.response_text || '';
        const prompts = data.suggestedPrompts || [];
        const mode = data.mode || data.barry_mode || null;

        setBrief(brief);
        setSuggestedPrompts(prompts);
        if (mode) setMode(mode);

        onOrientationChange?.({ status: 'ready', brief, suggestedPrompts: prompts, mode });

        // Cache the result
        if (orientationCacheKey) {
          try {
            sessionStorage.setItem(orientationCacheKey, JSON.stringify({
              cachedAt: Date.now(),
              brief,
              suggestedPrompts: prompts,
              mode,
            }));
          } catch (_) { /* storage full — non-fatal */ }
        }
      } else {
        setFallbackBrief();
        onOrientationChange?.({ status: 'error', error: 'orientation_failed', brief: null, suggestedPrompts: [] });
      }
    } catch (err) {
      console.error('[BarryChatPanel] Opening brief failed:', err);
      setFallbackBrief();
      onOrientationChange?.({ status: 'error', error: err, brief: null, suggestedPrompts: [] });
    } finally {
      setBriefLoading(false);
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
      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (processIcpUpdate):', tokenErr.message);
        setSending(false); return;
      }

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
        const result = await updateIcpFromChat(userId, data.icp_params, action, contextStack?.icpProfile);

        // An unresolved ICP identity is recoverable, not a crash. Each of the
        // three states gets its own answer — Barry never invents an ICP to
        // write into, and never reports a failed read as "you have no ICP".
        if (result?.status === 'unresolved') {
          const explanation = result.reason === 'no-profiles'
            ? "You don't have a target profile yet, so there's nothing for me to update. Tell me who you want to find and we'll set one up in ICP Settings."
            : result.reason === 'none-active'
            ? "You have more than one target profile and none is currently active. Pick the one this change applies to in ICP Settings and I'll update it."
            : "I couldn't load your target profile just now — try that again in a moment.";
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: explanation,
            has_message_angles: false,
            angles: []
          }]);
        } else {
          setContextStack(prev => ({ ...prev, icpProfile: result }));
          setMessages(prev => [...prev, {
            role: 'assistant',
            // G1-11 (C2): the ICP write is real, but no search follows — all three
          // search-companies call sites are GUI handlers. The queue keeps serving
          // companies found under the previous profile until the user refreshes.
          // Restore the original wording when discovery becomes a Barry action.
          content: "Got it — your ICP is updated. Open Scout and hit Refresh to pull new companies against it.",
            has_message_angles: false,
            angles: []
          }]);
        }
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
    // One trace for this whole turn, including the barryMissionChat fallback.
    const traceId = newTraceId();

    try {
      const user = getEffectiveUser();
      if (!user) { setSending(false); return; }
      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (handleActionMessage):', tokenErr.message);
        setSending(false); return;
      }

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
        body: JSON.stringify({ userId, authToken, message: userMessage, context, traceId })
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
      // IMPORTANT: swallow the barryActions error/summary — never render it to the user
      try {
        const user2 = getEffectiveUser();
        if (!user2) throw new Error('No user');
        let authToken2;
        try { authToken2 = await user2.getIdToken(); } catch (tokenErr) {
          throw new Error('Auth token refresh failed: ' + tokenErr.message);
        }
        const missionRes = await fetch('/.netlify/functions/barryMissionChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            authToken: authToken2,
            message: userMessage,
            conversationHistory,
            barryMode: mode,
            contextStack,
            traceId
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
          throw new Error('Mission chat returned failure');
        }
      } catch (fallbackErr) {
        console.warn('[BarryChatPanel] Action fallback to missionChat failed:', fallbackErr.message);
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
      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (executeConfirmedAction):', tokenErr.message);
        setSending(false); return;
      }

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

  // ── Pipeline action execution ──────────────────────────────────────────────

  async function executePipelineAction(pipelineAction) {
    setSending(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (executePipelineAction):', tokenErr.message);
        setSending(false); return;
      }

      const res = await fetch('/.netlify/functions/barryPipelineAction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          action_type: pipelineAction.action_type,
          contactId: pipelineAction.contactId,
          params: pipelineAction.params || {}
        })
      });
      const data = await res.json();

      if (data.success) {
        // Optimistically update the context stack so Barry's next message sees the change
        if (pipelineAction.contactId) {
          setContextStack(prev => {
            if (!prev?.contacts) return prev;
            return {
              ...prev,
              contacts: prev.contacts.map(c =>
                c.id === pipelineAction.contactId
                  ? { ...c, ...(data.updated_fields || {}) }
                  : c
              )
            };
          });
        }
        setMessages(prev => [...prev, {
          role: 'pipeline_result',
          success: true,
          text: pipelineAction.successText || 'Done.',
          contactName: pipelineAction.contactName,
          action_type: pipelineAction.action_type
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'pipeline_result',
          success: false,
          text: `Couldn't complete that — ${data.error || 'try again'}.`
        }]);
      }
    } catch (err) {
      console.error('[BarryChatPanel] executePipelineAction failed:', err);
      setMessages(prev => [...prev, {
        role: 'pipeline_result',
        success: false,
        text: 'Pipeline action failed — try again in a moment.'
      }]);
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

      appendTurn(db, user.uid, { role: 'user', content: userMessage, surface: 'workspace' })
        .catch(err => console.warn('[BarryChatPanel] canonical append failed:', err.message));

      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryChatPanel] getIdToken failed (sendMessage):', tokenErr.message);
        setMessages(prev => [...prev, {
          role: 'assistant', content: 'Session expired — please refresh the page.',
          has_message_angles: false, angles: []
        }]);
        setSending(false); return;
      }

      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: userMessage,
          conversationHistory,
          barryMode: mode,
          contextStack,
          // Where the user is standing when they ask. Sent with every message
          // so Barry's answer tracks the screen, not just the conversation.
          navigationContext
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

        // ── Pipeline action intents — route to barryPipelineAction ──────────

        // MOVE_TO_SNIPER — show confirm bubble (already exists in backend, now wired)
        if (data.intent === 'MOVE_TO_SNIPER' && data.contact_id && data.actions?.includes('move_to_sniper')) {
          const pipelineAction = {
            action_type: 'move_stage',
            contactId: data.contact_id,
            contactName: data.contact_name || 'this contact',
            params: { to_stage: 'sniper', reason: data.sniper_reason || 'barry_suggested' },
            successText: `${data.contact_name || 'Contact'} moved to Sniper. They're ready for the close.`
          };
          setMessages(prev => [...prev, {
            role: 'pipeline_confirm',
            pipelineAction,
            responseText: data.response_text,
            confirmLabel: `Move ${data.contact_name || 'contact'} to Sniper →`,
            intent: 'MOVE_TO_SNIPER'
          }]);
          setPendingPipelineAction(pipelineAction);
          setConversationHistory(data.updatedHistory || []);
          return;
        }

        // ENGAGE_CONTACT — show confirm bubble
        if (data.intent === 'ENGAGE_CONTACT' && data.contact_id && data.actions?.includes('engage_contact')) {
          const pipelineAction = {
            action_type: 'engage_contact',
            contactId: data.contact_id,
            contactName: data.contact_name || 'this contact',
            params: {},
            successText: `${data.contact_name || 'Contact'} is now engaged and in Hunter. Mission created — open Hunter to send the first message.`
          };
          setMessages(prev => [...prev, {
            role: 'pipeline_confirm',
            pipelineAction,
            responseText: data.response_text,
            confirmLabel: `Engage ${data.contact_name || 'contact'} →`,
            intent: 'ENGAGE_CONTACT'
          }]);
          setPendingPipelineAction(pipelineAction);
          setConversationHistory(data.updatedHistory || []);
          return;
        }

        // ORGANIZE_PIPELINE — multi-contact move list, no single pending action
        if (data.intent === 'ORGANIZE_PIPELINE' && data.pipeline_moves?.length > 0) {
          setMessages(prev => [...prev, {
            role: 'pipeline_organize',
            responseText: data.response_text,
            pipeline_moves: data.pipeline_moves
          }]);
          setConversationHistory(data.updatedHistory || []);
          return;
        }

        // LOG_OUTCOME — execute immediately, no confirm needed
        if (data.intent === 'LOG_OUTCOME' && data.contact_id && data.outcome) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.response_text || `Logged for ${data.contact_name || 'contact'}.`,
            has_message_angles: false,
            angles: []
          }]);
          setConversationHistory(data.updatedHistory || []);
          // Fire and forget — non-blocking
          executePipelineAction({
            action_type: 'log_outcome',
            contactId: data.contact_id,
            contactName: data.contact_name,
            params: {
              outcome: data.outcome,
              notes: data.outcome_note || null,
              status_update: data.status_update || null
            },
            successText: null
          }).catch(err => console.warn('[BarryChatPanel] LOG_OUTCOME silent fail:', err.message));
          return;
        }

        // COMPLETE_STEP — execute immediately, no confirm needed
        if (data.intent === 'COMPLETE_STEP' && data.contact_id) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.response_text || `Step marked complete for ${data.contact_name || 'contact'}.`,
            has_message_angles: false,
            angles: []
          }]);
          setConversationHistory(data.updatedHistory || []);
          executePipelineAction({
            action_type: 'complete_step',
            contactId: data.contact_id,
            contactName: data.contact_name,
            params: {
              missionId: data.mission_id || null,
              step_number: data.step_number || null,
              outcome: data.outcome || 'sent'
            },
            successText: null
          }).catch(err => console.warn('[BarryChatPanel] COMPLETE_STEP silent fail:', err.message));
          return;
        }

        // ADD_NOTE — execute immediately, no confirm needed
        if (data.intent === 'ADD_NOTE' && data.contact_id && data.note_text) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.response_text || `Note saved for ${data.contact_name || 'contact'}.`,
            has_message_angles: false,
            angles: []
          }]);
          setConversationHistory(data.updatedHistory || []);
          executePipelineAction({
            action_type: 'add_note',
            contactId: data.contact_id,
            contactName: data.contact_name,
            params: { note: data.note_text },
            successText: null
          }).catch(err => console.warn('[BarryChatPanel] ADD_NOTE silent fail:', err.message));
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

        // G2-D2 + G2-C2: Persist the assistant turn canonically. Angles-only
        // responses (no prose) get kind:'angles' and a clean summary so the
        // canonical store never contains internal bracketed speech.
        // G2-D3: Await the append so the turn is guaranteed persisted
        // before the UI settles.
        let canonicalContent = assistantMsg.content;
        let turnKind;
        if (!canonicalContent && assistantMsg.has_message_angles && assistantMsg.angles.length > 0) {
          const angleNames = assistantMsg.angles.map(a => a.label || a.subject || 'angle').join(', ');
          canonicalContent = `Message angles generated: ${angleNames}`;
          turnKind = 'angles';
        }
        try {
          await appendTurn(db, user.uid, { role: 'assistant', content: canonicalContent, surface: 'sidecar', kind: turnKind });
        } catch (err) {
          console.warn('[BarryChatPanel] canonical append failed:', err.message);
        }
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

  // ── Send email directly from angle block ─────────────────────────────────

  const handleSendEmail = async (subject, message, contactId) => {
    const user = getEffectiveUser();
    if (!user) return { success: false, error: 'no_user' };

    // Look up contact email
    let contactEmail = null;
    let contactName = null;
    try {
      const contactSnap = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
      if (contactSnap.exists()) {
        const data = contactSnap.data();
        contactEmail = data.email || null;
        contactName = data.name || data.first_name || null;
      }
    } catch (_) {}

    if (!contactEmail) return { success: false, error: 'no_email' };

    const authToken = await user.getIdToken();
    const res = await fetch('/.netlify/functions/barryActions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        authToken,
        confirm: true,
        pendingAction: {
          action_type: 'gmail_send',
          parameters: {
            to_email: contactEmail,
            to_name: contactName,
            subject,
            body: message
          }
        }
      })
    });

    const data = await res.json();
    if (!data.success) {
      // Check if Gmail not connected
      if (data.error?.includes('not_connected') || data.error?.includes('OAuth')) {
        return { success: false, error: 'not_connected' };
      }
      return { success: false, error: data.error || 'send_failed' };
    }

    // Show success in chat
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Email sent to ${contactName || contactEmail}. Check your sent folder to confirm delivery.`,
      has_message_angles: false,
      angles: []
    }]);

    return { success: true };
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
        className="flex items-center justify-between px-5 py-4 backdrop-blur-xl cursor-pointer select-none"
        style={{
          background: `${T.appBg}80`,
          border: `1px solid ${T.cyanBdr}`,
          borderRadius: isCollapsed ? '1rem' : '1rem 1rem 0 0',
          boxShadow: `0 0 20px ${T.cyanBg}`,
        }}
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        {/* Left: Barry identity */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            {briefLoading && !brief ? (
              <>
                <span className="text-4xl opacity-60 animate-pulse">🐻</span>
                <div className="absolute inset-0 rounded-full animate-ping" style={{ border: `2px solid ${T.cyanBdr}` }} />
              </>
            ) : (
              <span className="text-4xl">🐻</span>
            )}
          </div>

          <div>
            <div className="flex items-center flex-wrap gap-2">
              <span className="font-semibold text-sm font-mono" style={{ color: T.text }}>Barry</span>

              {/* Mode badge — clickable to cycle modes */}
              <button
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono cursor-pointer transition-opacity hover:opacity-80"
                style={modeConfig.pillStyle}
                onClick={handleModeClick}
                title="Click to change Barry's mode"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: modeConfig.dotColor }} />
                {modeConfig.label}
              </button>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: STATUS.green }} />
              <span className="text-xs font-mono" style={{ color: T.cyan }}>Online</span>

              {/* Collapsed: show last message preview */}
              {isCollapsed && lastMessage && lastMessage.content && (
                <span className="text-xs truncate max-w-xs ml-1" style={{ color: T.textMuted }}>
                  {lastMessage.content.length > 50
                    ? lastMessage.content.slice(0, 50) + '...'
                    : lastMessage.content}
                </span>
              )}
              {isCollapsed && briefLoading && !brief && (
                <span className="text-xs font-mono animate-pulse ml-1" style={{ color: T.textFaint }}>Loading...</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: collapse toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all text-lg font-mono flex-shrink-0"
          style={{ color: T.textMuted }}
          onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
          aria-label={isCollapsed ? 'Expand Barry panel' : 'Collapse Barry panel'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      </div>

      {/* ── Panel Body (collapsible) ── */}
      {!isCollapsed && (
        <div
          className="backdrop-blur-xl overflow-hidden"
          style={{
            background: `${T.appBg}66`,
            borderLeft: `1px solid ${T.cyanBdr}`,
            borderRight: `1px solid ${T.cyanBdr}`,
            borderBottom: `1px solid ${T.cyanBdr}`,
            borderRadius: '0 0 1rem 1rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          }}
        >

          {/* Opening Brief */}
          <div className="px-5 pt-5 pb-4">
            {briefLoading && !brief ? (
              <div className="space-y-2" aria-busy="true" aria-label="Barry is thinking">
                <div className="h-4 rounded-full animate-pulse w-3/4" style={{ background: T.surface2 }} />
                <div className="h-4 rounded-full animate-pulse w-full" style={{ background: T.surface2 }} />
                <div className="h-4 rounded-full animate-pulse w-2/3" style={{ background: T.surface2 }} />
              </div>
            ) : (
              <div className="text-sm leading-relaxed" style={{ color: T.text }}>
                <ReactMarkdown className="prose prose-invert prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0">
                  {brief || 'Your pipeline is ready. Tell me what you want to work on.'}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Suggested prompts (shown only when no conversation yet) */}
          {!briefLoading && !hasConversation && suggestedPrompts.length > 0 && (
            <div className="px-5 pb-4 flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  className="px-3 py-1.5 text-xs font-mono rounded-lg transition-all"
                  style={{ background: `${T.appBg}66`, border: `1px solid ${T.border2}`, color: T.textMuted }}
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
              <div className="mx-5" style={{ borderTop: `1px solid ${T.cyanBg}` }} />
              <div
                ref={threadRef}
                className="px-5 py-4 overflow-y-auto flex flex-col gap-3"
                style={{ maxHeight: '65vh' }}
                aria-live="polite"
                aria-label="Conversation with Barry"
              >
                {messages.map((msg, i) => {
                  // Mission-created confirmation bubble
                  if (msg.role === 'event' && msg.event === 'mission_created') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: `${STATUS.green}1a`, color: `${STATUS.green}cc`, border: `1px solid ${STATUS.green}40` }}>
                          ✓ Mission created for <strong>{msg.contactName}</strong>. Draft is ready in Active Missions.{' '}
                          <a href="/hunter" className="underline underline-offset-2 transition-colors" style={{ color: STATUS.green }}>
                            View in Hunter →
                          </a>
                        </div>
                      </div>
                    );
                  }

                  // ── Pipeline action confirm bubble (engage, move_to_sniper) ──
                  if (msg.role === 'pipeline_confirm') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-3 leading-relaxed rounded-2xl rounded-tl-sm max-w-[88%]" style={{ background: T.cyanBg, color: T.cyan, border: `1px solid ${T.cyanBdr}` }}>
                          {msg.responseText && (
                            <div className="mb-3" style={{ color: T.text }}>{msg.responseText}</div>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={async () => {
                                const saved = msg.pipelineAction;
                                setPendingPipelineAction(null);
                                await executePipelineAction(saved);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
                              style={{ background: `${T.cyan}33`, border: `1px solid ${T.cyan}66`, color: T.cyan }}
                            >
                              {msg.confirmLabel || 'Confirm →'}
                            </button>
                            <button
                              onClick={() => {
                                setPendingPipelineAction(null);
                                setMessages(prev => [...prev, {
                                  role: 'assistant',
                                  content: 'Got it — skipped for now.',
                                  has_message_angles: false,
                                  angles: []
                                }]);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
                              style={{ background: T.surface2, border: `1px solid ${T.border2}`, color: T.textMuted }}
                            >
                              Not yet
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Pipeline action result bubble ──
                  if (msg.role === 'pipeline_result') {
                    const resultColor = msg.success ? STATUS.green : STATUS.red;
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: `${resultColor}1a`, color: `${resultColor}cc`, border: `1px solid ${resultColor}40` }}>
                          {msg.success ? '✓ ' : '✗ '}{msg.text}
                          {msg.success && msg.action_type === 'engage_contact' && (
                            <>{' '}<a href="/hunter" className="underline transition-colors" style={{ color: STATUS.green }}>Open Hunter →</a></>
                          )}
                          {msg.success && msg.action_type === 'move_stage' && msg.text?.includes('Sniper') && (
                            <>{' '}<a href="/sniper" className="underline transition-colors" style={{ color: STATUS.green }}>Open Sniper →</a></>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // ── Pipeline organize bubble (multi-contact move list) ──
                  if (msg.role === 'pipeline_organize') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="flex flex-col gap-2 max-w-[92%]">
                          {msg.responseText && (
                            <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
                              {msg.responseText}
                            </div>
                          )}
                          {(msg.pipeline_moves || []).map((move, mi) => (
                            <PipelineMoveRow
                              key={mi}
                              move={move}
                              onExecute={executePipelineAction}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // ── Action confirmation bubble ──
                  if (msg.role === 'action_confirm') {
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-3 leading-relaxed rounded-2xl rounded-tl-sm max-w-[88%]" style={{ background: T.cyanBg, color: T.cyan, border: `1px solid ${T.cyanBdr}` }}>
                          <div className="mb-3">📧 {msg.summary}</div>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => { const saved = pendingAction; setPendingAction(null); await executeConfirmedAction(saved); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
                              style={{ background: `${T.cyan}33`, border: `1px solid ${T.cyan}66`, color: T.cyan }}
                            >
                              Yes, send →
                            </button>
                            <button
                              onClick={() => { setPendingAction(null); setMessages(prev => [...prev, { role: 'assistant', content: 'Got it — cancelled.', has_message_angles: false, angles: [] }]); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
                              style={{ background: T.surface2, border: `1px solid ${T.border2}`, color: T.textMuted }}
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
                    const resultColor = msg.success ? STATUS.green : STATUS.red;
                    return (
                      <div key={i} className="flex gap-2 flex-row">
                        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                        <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: `${resultColor}1a`, color: `${resultColor}cc`, border: `1px solid ${resultColor}40` }}>
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
                          <div className="text-xs font-mono px-1" style={{ color: T.textFaint }}>Recent inbox</div>
                          {msg.threads.length === 0 ? (
                            <div className="text-sm px-3 py-2 rounded-2xl rounded-tl-sm" style={{ background: T.cardBg, color: T.textMuted, border: `1px solid ${T.border}` }}>Inbox is empty.</div>
                          ) : msg.threads.map((thread, ti) => (
                            <div key={ti} className="text-sm px-3 py-2 rounded-xl" style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
                              <div className="font-medium truncate" style={{ color: T.text }}>{thread.subject || '(no subject)'}</div>
                              <div className="text-xs mt-0.5 truncate" style={{ color: T.textMuted }}>{thread.from}</div>
                              {thread.snippet && <div className="text-xs mt-1 line-clamp-1" style={{ color: T.textFaint }}>{thread.snippet}</div>}
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
                          <div className="text-xs font-mono px-1" style={{ color: T.textFaint }}>Upcoming calendar</div>
                          {msg.events.length === 0 ? (
                            <div className="text-sm px-3 py-2 rounded-2xl rounded-tl-sm" style={{ background: T.cardBg, color: T.textMuted, border: `1px solid ${T.border}` }}>Nothing scheduled.</div>
                          ) : msg.events.slice(0, 5).map((event, ei) => (
                            <div key={ei} className="text-sm px-3 py-2 rounded-xl" style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
                              <div className="font-medium" style={{ color: T.text }}>{event.title}</div>
                              <div className="text-xs mt-0.5" style={{ color: T.textMuted }}>
                                {event.start ? new Date(event.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Time TBD'}
                              </div>
                              {event.attendees?.length > 0 && (
                                <div className="text-xs mt-0.5" style={{ color: T.textFaint }}>With: {event.attendees.join(', ')}</div>
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
                        <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: `${STATUS.amber}1a`, color: `${STATUS.amber}cc`, border: `1px solid ${STATUS.amber}40` }}>
                          {msg.text}{' '}
                          <a href="/basecamp?tab=integrations" className="underline transition-colors" style={{ color: STATUS.amber }}>
                            Connect {msg.service} →
                          </a>
                        </div>
                      </div>
                    );
                  }

                  if (msg.role === 'user') {
                    return (
                      <div key={i} className="flex gap-2 flex-row-reverse">
                        <div className="text-sm px-3 py-2 max-w-[82%] leading-relaxed rounded-2xl rounded-tr-sm" style={{ background: `${T.cyan}33`, color: T.text, border: `1px solid ${T.cyanBdr}` }}>
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
                          <div className="text-sm px-3 py-2 leading-relaxed rounded-2xl rounded-tl-sm" style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
                            {msg.kind === 'angles' && !(msg.angles?.length > 0) && (
                              <span className="inline-block text-xs font-bold uppercase tracking-wide mr-1.5" style={{ color: T.cyan, letterSpacing: '0.04em' }}>Angles</span>
                            )}
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
                            onSendEmail={handleSendEmail}
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
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: T.cardBg, border: `1px solid ${T.border}` }}>
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T.textMuted, animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T.textMuted, animationDelay: '120ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T.textMuted, animationDelay: '240ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Input Area */}
          <div className="px-5 py-4" style={{ borderTop: `1px solid ${T.cyanBg}` }}>
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
                style={{ resize: 'none', overflowY: 'auto', background: `${T.appBg}80`, border: `1px solid ${T.border2}`, color: T.text }}
                className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors disabled:opacity-50 font-mono leading-relaxed"
              />
              <button
                onClick={() => sendMessage(inputValue)}
                disabled={sending || loading || !inputValue.trim()}
                aria-label="Send message"
                className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: `${T.cyan}33`, border: `1px solid ${T.cyanBdr}`, color: T.cyan }}
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
