/**
 * BlitzMode.jsx — Rapid engagement queue for Hunter contacts
 *
 * Goal: Go through 2-10 engagement emails in under a minute.
 *
 * Architecture:
 *  1. Loads up to 20 contacts from the user's Hunter contacts (need engagement)
 *  2. Pre-fetches Barry message options for contacts 1-3 in parallel on load
 *  3. As user acts on contact N, pre-fetches contact N+3 in background
 *  4. Shows one BlitzCard at a time — full engagement flow on screen, no modals
 *  5. Send → auto-advance → next card already loaded
 *
 * Pre-fetch strategy:
 *  - PREFETCH_AHEAD = 3: always keep 3 contacts' messages ready
 *  - Uses a Set to prevent duplicate in-flight requests
 *  - Falls back gracefully if prefetch fails (user can retry)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import {
  Zap, ChevronLeft, CheckCircle, Trophy,
  SkipForward, Mail, Users
} from 'lucide-react';

import BlitzCard from '../../components/hunter/BlitzCard';
import {
  executeSendAction,
  CHANNELS,
} from '../../utils/sendActionResolver';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS, getContactStatus } from '../../utils/contactStateMachine';

const PREFETCH_AHEAD = 3;
const MAX_QUEUE = 20;

// Default auto-intent used when pre-generating (before user customizes)
function buildDefaultIntent(contact) {
  const name = contact.firstName || contact.first_name || 'this contact';
  const status = contact.contact_status;
  if (status === 'Awaiting Reply' || status === 'In Conversation') {
    return `Follow up with ${name} who hasn't replied yet — gentle check-in`;
  }
  if (contact.last_interaction_at) {
    return `Re-engage with ${name} and keep the conversation going`;
  }
  return `Reach out to ${name} for the first time with a warm, personalized intro`;
}

export default function BlitzMode() {
  const navigate = useNavigate();
  const T = useT();

  // Queue state
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(null);

  // Pre-fetched message cache: { [contactId]: { messages, loading, error } }
  const [messageCache, setMessageCache] = useState({});

  // Session tracking
  const [stats, setStats] = useState({ sent: 0, skipped: 0 });
  const [sessionDone, setSessionDone] = useState(false);

  // Track in-flight prefetch requests to avoid duplicates
  const prefetchingRef = useRef(new Set());

  // ── Load queue ──────────────────────────────────────────

  useEffect(() => {
    loadQueue();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadQueue() {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const snap = await getDocs(query(contactsRef, limit(MAX_QUEUE * 3))); // over-fetch then filter

      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Priority 1: contacts that are overdue / in follow-up
      // Priority 2: contacts with no engagement yet (deck)
      // Only include contacts that have an email address
      const withEmail = all.filter(c =>
        (c.email || c.emails?.length) &&
        (c.hunter_status !== 'archived')
      );

      // Sort: follow_up_due first, then by last interaction (oldest first)
      const sorted = withEmail.sort((a, b) => {
        // Overdue contacts at top
        const aOverdue = a.follow_up_due_at && new Date(a.follow_up_due_at) <= new Date();
        const bOverdue = b.follow_up_due_at && new Date(b.follow_up_due_at) <= new Date();
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        // Then oldest last-contact first (most neglected)
        const aLast = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
        const bLast = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
        return aLast - bLast;
      });

      const contacts = sorted.slice(0, MAX_QUEUE);
      setQueue(contacts);
    } catch (err) {
      console.error('[BlitzMode] loadQueue error:', err);
      setQueueError('Failed to load your contacts. Please try again.');
    } finally {
      setQueueLoading(false);
    }
  }

  // ── Pre-fetch orchestration ─────────────────────────────

  useEffect(() => {
    if (queue.length === 0) return;
    prefetchAhead(currentIndex);
  }, [currentIndex, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  async function prefetchAhead(fromIdx) {
    const toFetch = [];
    for (let i = fromIdx; i < Math.min(fromIdx + PREFETCH_AHEAD, queue.length); i++) {
      const contact = queue[i];
      if (!contact) continue;
      if (messageCache[contact.id]) continue;         // already cached
      if (prefetchingRef.current.has(contact.id)) continue; // in flight
      toFetch.push(contact);
    }
    // Fire all in parallel — don't block UI
    await Promise.all(toFetch.map(c => fetchMessages(c, buildDefaultIntent(c))));
  }

  async function fetchMessages(contact, intentText) {
    prefetchingRef.current.add(contact.id);
    setMessageCache(prev => ({
      ...prev,
      [contact.id]: { messages: null, loading: true, error: null }
    }));

    try {
      const user = getEffectiveUser();
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          userIntent: intentText,
          engagementIntent: contact.engagementIntent || 'prospect',
          contact: {
            firstName: contact.firstName || contact.first_name,
            lastName: contact.lastName || contact.last_name,
            name: contact.name || `${contact.firstName || contact.first_name || ''} ${contact.lastName || contact.last_name || ''}`.trim(),
            title: contact.title || contact.current_position_title,
            company_name: contact.company_name || contact.current_company_name,
            company_industry: contact.company_industry || contact.industry,
            seniority: contact.seniority,
            email: contact.email,
            linkedin_url: contact.linkedin_url
          }
        })
      });

      const data = await res.json();

      if (data.success && data.messages?.length >= 1) {
        setMessageCache(prev => ({
          ...prev,
          [contact.id]: { messages: data.messages, loading: false, error: null }
        }));
      } else {
        throw new Error(data.error || 'Barry returned no messages');
      }
    } catch (err) {
      console.error(`[BlitzMode] fetchMessages failed for ${contact.id}:`, err);
      setMessageCache(prev => ({
        ...prev,
        [contact.id]: { messages: null, loading: false, error: 'Barry had trouble generating. Try regenerating below.' }
      }));
    } finally {
      prefetchingRef.current.delete(contact.id);
    }
  }

  // ── Card actions ─────────────────────────────────────────

  async function handleSend({ contact, subject, message, channel, strategy, userIntent }) {
    try {
      const user = getEffectiveUser();

      const channelMap = {
        email: CHANNELS.EMAIL,
        linkedin: CHANNELS.LINKEDIN,
        text: CHANNELS.TEXT
      };

      await executeSendAction({
        channel: channelMap[channel] || CHANNELS.EMAIL,
        userId: user.uid,
        contact,
        subject,
        body: message,
        userIntent: userIntent || buildDefaultIntent(contact),
        engagementIntent: contact.engagementIntent || 'prospect',
        strategy: strategy || null
      });

      // Log to timeline
      await logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'message_sent',
        actor: ACTORS.USER,
        preview: subject || (message ? message.substring(0, 120) : null),
        metadata: {
          channel,
          strategy,
          source: 'blitz_mode',
          engagementIntent: contact.engagementIntent || 'prospect'
        }
      });

      // Update contact state machine
      updateContactStatus({
        userId: user.uid,
        contactId: contact.id,
        trigger: STATUS_TRIGGERS.MESSAGE_SENT,
        currentStatus: getContactStatus(contact)
      });

      setStats(s => ({ ...s, sent: s.sent + 1 }));
      // Brief delay so user sees "Sent!" feedback before auto-advance
      setTimeout(advance, 600);
    } catch (err) {
      console.error('[BlitzMode] handleSend error:', err);
      // Don't block — let user retry or skip
    }
  }

  function handleSkip() {
    setStats(s => ({ ...s, skipped: s.skipped + 1 }));
    advance();
  }

  function advance() {
    const next = currentIndex + 1;
    if (next >= queue.length) {
      setSessionDone(true);
    } else {
      setCurrentIndex(next);
    }
  }

  // Re-generate messages with a custom intent (from "Tell Barry" input)
  function handleRegenerate(contact, customIntent) {
    // Clear cached entry so it re-fetches
    prefetchingRef.current.delete(contact.id);
    setMessageCache(prev => {
      const updated = { ...prev };
      delete updated[contact.id];
      return updated;
    });
    fetchMessages(contact, customIntent);
  }

  // ── Render ────────────────────────────────────────────────

  const currentContact = queue[currentIndex];
  const currentCache = currentContact ? messageCache[currentContact.id] : null;
  const progress = queue.length > 0 ? (currentIndex / queue.length) * 100 : 0;

  // Loading queue
  if (queueLoading) {
    return (
      <div style={shell(T)}>
        <BlitzHeader onBack={() => navigate('/hunter')} T={T} />
        <div style={centerContent}>
          <Zap size={32} color={BRAND.purple} style={{ marginBottom: 12, opacity: 0.8 }} />
          <p style={{ color: T.text, fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
            Loading your engagement queue...
          </p>
          <p style={{ color: T.textFaint, fontSize: 13, margin: 0 }}>Barry is getting ready</p>
        </div>
      </div>
    );
  }

  // Error loading queue
  if (queueError) {
    return (
      <div style={shell(T)}>
        <BlitzHeader onBack={() => navigate('/hunter')} T={T} />
        <div style={centerContent}>
          <p style={{ color: '#f87171', fontSize: 14, marginBottom: 16 }}>{queueError}</p>
          <button onClick={loadQueue} style={primaryBtn(T)}>Retry</button>
        </div>
      </div>
    );
  }

  // Empty queue
  if (queue.length === 0) {
    return (
      <div style={shell(T)}>
        <BlitzHeader onBack={() => navigate('/hunter')} T={T} />
        <div style={centerContent}>
          <CheckCircle size={48} color="#34d399" style={{ marginBottom: 16 }} />
          <p style={{ color: T.text, fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
            No contacts to engage!
          </p>
          <p style={{ color: T.textFaint, fontSize: 14, margin: '0 0 24px' }}>
            Add contacts with email addresses in Scout to get started.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => navigate('/scout')} style={primaryBtn(T)}>
              <Users size={14} /> Go to Scout
            </button>
            <button onClick={() => navigate('/hunter')} style={secondaryBtn(T)}>
              Back to Hunter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Session complete
  if (sessionDone) {
    const total = stats.sent + stats.skipped;
    return (
      <div style={shell(T)}>
        <BlitzHeader onBack={() => navigate('/hunter')} T={T} />
        <div style={centerContent}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⚡</div>
          <h2 style={{ color: T.text, fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            Blitz complete!
          </h2>
          <p style={{ color: T.textFaint, fontSize: 14, margin: '0 0 4px' }}>
            {stats.sent} sent · {stats.skipped} skipped · {total} total
          </p>
          {stats.sent > 0 && (
            <p style={{ color: '#34d399', fontSize: 13, margin: '0 0 24px' }}>
              🎯 {stats.sent} contact{stats.sent !== 1 ? 's' : ''} engaged
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => {
                setCurrentIndex(0);
                setStats({ sent: 0, skipped: 0 });
                setSessionDone(false);
                loadQueue();
              }}
              style={primaryBtn(T)}
            >
              <Zap size={14} /> Run Another Blitz
            </button>
            <button onClick={() => navigate('/hunter')} style={secondaryBtn(T)}>
              Back to Hunter
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell(T)}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        button, input, textarea { font-family: Inter, system-ui, sans-serif; }
        input::placeholder, textarea::placeholder { color: ${T.textFaint}; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <BlitzHeader onBack={() => navigate('/hunter')} T={T} progress={progress} current={currentIndex + 1} total={queue.length} />

      {/* Progress bar */}
      <div style={{ height: 3, background: T.border, flexShrink: 0 }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${BRAND.purple}, ${BRAND.cyan})`,
          transition: 'width 0.4s ease'
        }} />
      </div>

      {/* Stats strip */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '6px 16px',
        flexShrink: 0,
        borderBottom: `1px solid ${T.border}`,
        background: T.navBg
      }}>
        <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>✓ {stats.sent} sent</span>
        <span style={{ color: T.textFaint, fontSize: 12 }}>↷ {stats.skipped} skipped</span>
        <span style={{ color: T.textFaint, fontSize: 12, marginLeft: 'auto' }}>
          {queue.length - currentIndex} remaining
        </span>
      </div>

      {/* Card area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 32px' }}>
        <BlitzCard
          key={currentContact.id}
          contact={currentContact}
          messagesState={currentCache}
          onSend={handleSend}
          onSkip={handleSkip}
          onRegenerate={handleRegenerate}
        />

        {/* Peek: next contact */}
        {queue[currentIndex + 1] && (
          <div style={{
            maxWidth: 620,
            width: '100%',
            margin: '12px auto 0',
            padding: '10px 14px',
            background: T.surface,
            border: `1px solid ${T.border2}`,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: 0.6
          }}>
            <span style={{ fontSize: 11, color: T.textFaint }}>Up next:</span>
            <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>
              {queue[currentIndex + 1].name ||
                `${queue[currentIndex + 1].firstName || queue[currentIndex + 1].first_name || ''} ${queue[currentIndex + 1].lastName || queue[currentIndex + 1].last_name || ''}`.trim()
              }
            </span>
            <span style={{ fontSize: 11, color: T.textFaint }}>
              · {queue[currentIndex + 1].company_name || queue[currentIndex + 1].current_company_name || ''}
            </span>
            {messageCache[queue[currentIndex + 1].id]?.messages && (
              <span style={{ fontSize: 10, color: '#34d399', marginLeft: 'auto' }}>Ready ✓</span>
            )}
            {messageCache[queue[currentIndex + 1].id]?.loading && (
              <span style={{ fontSize: 10, color: BRAND.purple, marginLeft: 'auto' }}>Barry loading...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function BlitzHeader({ onBack, T, progress, current, total }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '11px 16px',
      borderBottom: `1px solid ${T.border}`,
      background: T.railBg,
      flexShrink: 0,
      gap: 8,
    }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: 'none',
        color: T.textMuted, cursor: 'pointer', fontSize: 13, padding: '4px 8px', borderRadius: 6,
      }}>
        <ChevronLeft size={16} /> Hunter
      </button>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <Zap size={15} color={BRAND.purple} />
        <span style={{ color: T.text, fontWeight: 700, fontSize: 14 }}>Blitz Mode</span>
      </div>

      {current != null && total != null && (
        <span style={{
          fontSize: 12,
          color: T.textFaint,
          background: T.surface,
          padding: '3px 9px',
          borderRadius: 12,
          border: `1px solid ${T.border2}`,
          flexShrink: 0,
        }}>
          {current} / {total}
        </span>
      )}
    </div>
  );
}

// ── Inline style helpers ────────────────────────────────────

const shell = T => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  background: T.appBg,
  fontFamily: 'Inter, system-ui, sans-serif',
  color: T.text,
  overflow: 'hidden',
});

const centerContent = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  textAlign: 'center',
};

const primaryBtn = T => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 22px',
  borderRadius: 10,
  background: `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.cyan})`,
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'Inter, system-ui, sans-serif',
});

const secondaryBtn = T => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 22px',
  borderRadius: 10,
  background: T.surface,
  border: `1px solid ${T.border}`,
  color: T.textMuted,
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'Inter, system-ui, sans-serif',
});
