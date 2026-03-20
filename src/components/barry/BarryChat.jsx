/**
 * BarryChat — Unified Barry drawer component.
 *
 * Replaces all per-module embedded Barry chat surfaces.
 * Triggered by BarryTrigger (bottom-left global icon).
 *
 * Props:
 *   module   — string key from MODULE_CONFIG (drives chakra accent color + mode label)
 *   context  — structured object injected into Barry's system prompt at session start
 *   onClose  — called when drawer should close
 *
 * Module → chakra color map follows the brief's chakra alignment spec.
 *
 * EXCLUDED from: Mission Control routes (handled by BarryChatPanel — not this component).
 */

import { useState, useEffect, useRef } from 'react';
import { ArrowRight, X, Loader, RotateCcw, Crosshair, Check } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { moveContactToSniper } from '../../utils/moveToSniper';

// ─── Module → chakra config ───────────────────────────────────────────────────
export const MODULE_CONFIG = {
  recon:            { color: '#5A3FFF', label: 'COACH',     opening: "Let's build your intelligence. What do you want to work on today?" },
  scout:            { color: '#00A3FF', label: 'TARGETING', opening: "I'm scanning your ICP. What company or contact do you want to evaluate?" },
  hunter:           { color: '#FFD400', label: 'PURSUE',    opening: "Goal is a booked meeting. Who's the next target and what's their status?" },
  sniper:           { color: '#00FF9C', label: 'CLOSE',     opening: "You're in the close zone. Which deal do you want to move forward today?" },
  'command-center': { color: '#B026FF', label: 'SUGGEST',   opening: "I see your full pipeline. Who's at risk of going cold?" },
  homebase:         { color: '#FF2A2A', label: 'GUIDE',     opening: "What do you need to set up or configure today?" },
  reinforcements:   { color: '#FF7A00', label: 'CONNECT',   opening: "Let's find warm intro paths. Who are you trying to reach?" },
  fallback:         { color: '#6b7280', label: 'RECOVER',   opening: "Which closed-lost account should we look at re-engaging?" },
  default:          { color: BRAND.cyan, label: 'ASSIST',   opening: "What can I help you with?" },
};

// ─── BarryAvatar ─────────────────────────────────────────────────────────────
function BarryAvatar({ size = 28, chakraColor }) {
  const T = useT();
  const color = chakraColor || T.cyan || BRAND.cyan;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${color})`,
      border: `2px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
      boxShadow: `0 0 ${size * 0.5}px ${color}50`,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BarryChat({ module = 'default', context = {}, onClose }) {
  const T = useT();
  const cfg = MODULE_CONFIG[module] || MODULE_CONFIG.default;
  const chakra = cfg.color;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chips, setChips] = useState([]);
  const [pendingAction, setPendingAction] = useState(null); // { type, contactId, contactName, sniper_reason }
  const [actionLoading, setActionLoading] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  // Auto-resize textarea as user types
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  // Load prior session + show opening message
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const user = getEffectiveUser();

      // Try to load prior session for this module
      if (user) {
        try {
          const sessionRef = doc(db, 'users', user.uid, 'barryConversations', `drawer_${module}`);
          const snap = await getDoc(sessionRef);
          if (!cancelled && snap.exists()) {
            const saved = snap.data();
            if ((saved.messages || []).length > 0) {
              const displayMsgs = saved.messages.map(h => ({
                role: (h.role === 'assistant' || h.role === 'barry') ? 'barry' : 'user',
                content: h.content,
              }));
              const apiHistory = saved.messages.map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.content,
              }));
              setMessages([
                { role: 'system', content: '— Resumed from last session —' },
                ...displayMsgs,
              ]);
              setConversationHistory(apiHistory);
              return;
            }
          }
        } catch (_) { /* fall through to opening */ }
      }

      if (!cancelled) {
        // No prior session — show opening message + chips
        setMessages([{ role: 'barry', content: cfg.opening }]);
        setChips(getChips(module, context));
      }
    }
    init().finally(() => { setInitLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendToBarry = async (msg, history) => {
    setLoading(true);
    setChips([]);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          message: msg,
          conversationHistory: history,
          module,
          barryMode: cfg.label,
          contextStack: Object.keys(context).length > 0 ? context : null,
          moduleContext: context,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const barryMsg = { role: 'barry', content: data.response_text };
        setMessages(prev => [...prev, barryMsg]);

        // Handle MOVE_TO_SNIPER intent — surface a confirm card
        if (data.intent === 'MOVE_TO_SNIPER' && data.contact_id) {
          setPendingAction({
            type: 'move_to_sniper',
            contactId: data.contact_id,
            contactName: data.contact_name || 'this contact',
            sniper_reason: data.sniper_reason || 'barry_suggested',
          });
          setActionDone(false);
        }
        const newHistory = data.updatedHistory || [
          ...history,
          { role: 'user', content: msg },
          { role: 'assistant', content: data.response_text },
        ];
        setConversationHistory(newHistory);

        // Persist session
        if (user) {
          setDoc(
            doc(db, 'users', user.uid, 'barryConversations', `drawer_${module}`),
            { messages: newHistory, updatedAt: new Date() },
            { merge: false }
          ).catch(() => {});
        }
      } else {
        setMessages(prev => [...prev, { role: 'barry', content: "Something went wrong — try again." }]);
      }
    } catch (err) {
      console.error('[BarryChat] error:', err);
      setMessages(prev => [...prev, { role: 'barry', content: "Something went wrong — try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    sendToBarry(msg, conversationHistory);
  };

  const handleConfirmMoveToSniper = async () => {
    if (!pendingAction || actionLoading) return;
    try {
      setActionLoading(true);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      await moveContactToSniper({
        userId: user.uid,
        contactId: pendingAction.contactId,
        reason: pendingAction.sniper_reason,
        actor: 'barry',
      });
      setActionDone(true);
      setMessages(prev => [...prev, {
        role: 'barry',
        content: `Done — ${pendingAction.contactName} has been moved to Sniper. You'll find them in the close zone.`,
      }]);
    } catch (err) {
      console.error('[BarryChat] Move to Sniper failed:', err);
      setMessages(prev => [...prev, { role: 'barry', content: 'Move failed — try again from the contact profile.' }]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    const user = getEffectiveUser();
    if (user) {
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'barryConversations', `drawer_${module}`),
          { messages: [], updatedAt: new Date() }
        );
      } catch (_) {}
    }
    setMessages([{ role: 'barry', content: cfg.opening }]);
    setConversationHistory([]);
    setChips(getChips(module, context));
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1998, background: 'rgba(0,0,0,0.4)' }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
        zIndex: 1999,
        background: T.cardBg,
        borderLeft: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: `-8px 0 40px rgba(0,0,0,0.35)`,
        animation: 'barryChatSlideIn 0.22s ease',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <style>{`
          @keyframes barryChatSlideIn {
            from { opacity: 0; transform: translateX(20px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          @keyframes barrySpin { to { transform: rotate(360deg); } }
        `}</style>

        {/* Header */}
        <div style={{
          padding: '14px 18px', flexShrink: 0,
          background: `linear-gradient(135deg, ${chakra}18, ${chakra}08)`,
          borderBottom: `1px solid ${chakra}30`,
          display: 'flex', alignItems: 'center', gap: 11,
        }}>
          <BarryAvatar size={36} chakraColor={chakra} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>Barry</div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
              color: chakra, marginTop: 1,
            }}>
              {cfg.label}
            </div>
          </div>
          <button
            onClick={handleReset}
            title="Start over"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center' }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: '2px 4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Initial load skeleton */}
        {initLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarryAvatar size={24} chakraColor={chakra} />
            <div style={{ padding: '9px 13px', borderRadius: '16px 16px 16px 4px', background: T.surface, border: `1px solid ${T.border2}` }}>
              <style>{`
                @keyframes barryDotPulse {
                  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
                  40% { opacity: 1; transform: scale(1); }
                }
              `}</style>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 0.2, 0.4].map((delay, i) => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%', background: chakra,
                    animation: `barryDotPulse 1.2s ease-in-out ${delay}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {!initLoading && messages.map((msg, i) => (
            msg.role === 'system' ? (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, color: T.textFaint, padding: '2px 0' }}>
                {msg.content}
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
                {msg.role === 'barry' && <BarryAvatar size={24} chakraColor={chakra} />}
                <div style={{
                  maxWidth: '82%', padding: '9px 13px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user'
                    ? `linear-gradient(135deg,${chakra},${chakra}cc)`
                    : T.surface,
                  color: msg.role === 'user' ? '#fff' : T.text,
                  fontSize: 13, lineHeight: 1.55,
                  border: msg.role === 'barry' ? `1px solid ${T.border2}` : 'none',
                }}>
                  {msg.content}
                </div>
              </div>
            )
          ))}

          {/* MOVE_TO_SNIPER confirm card */}
          {pendingAction?.type === 'move_to_sniper' && !actionDone && !loading && (
            <div style={{
              borderRadius: 12,
              border: '1px solid rgba(20,184,166,0.35)',
              background: 'rgba(20,184,166,0.07)',
              padding: '13px 15px',
              display: 'flex', flexDirection: 'column', gap: 9,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Crosshair size={14} color="#14b8a6" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#14b8a6', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Move to Sniper</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
                Move <strong>{pendingAction.contactName}</strong> to the Sniper close zone?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleConfirmMoveToSniper}
                  disabled={actionLoading}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    background: actionLoading ? 'rgba(20,184,166,0.4)' : 'linear-gradient(135deg,#14b8a6,#0d9488)',
                    border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {actionLoading
                    ? <Loader size={12} style={{ animation: 'barrySpin 1s linear infinite' }} />
                    : <><Crosshair size={12} />Confirm</>
                  }
                </button>
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border2}`,
                    color: T.textMuted, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarryAvatar size={24} chakraColor={chakra} />
              <div style={{ padding: '9px 13px', borderRadius: '16px 16px 16px 4px', background: T.surface, border: `1px solid ${T.border2}` }}>
                <Loader size={14} color={chakra} style={{ animation: 'barrySpin 1s linear infinite' }} />
              </div>
            </div>
          )}

          {/* Suggested prompt chips */}
          {chips.length > 0 && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, paddingTop: 4 }}>
              {chips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(chip)}
                  style={{
                    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    border: `1px solid ${chakra}40`, background: `${chakra}12`,
                    color: chakra, cursor: 'pointer', transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${chakra}25`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${chakra}12`; }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${T.border}`,
          display: 'flex', gap: 8, flexShrink: 0,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={loading ? 'Barry is thinking…' : 'Ask Barry anything…'}
            disabled={loading}
            rows={1}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              border: `1px solid ${T.border2}`,
              background: T.surface, color: T.text,
              fontSize: 13, outline: 'none',
              opacity: loading ? 0.6 : 1,
              resize: 'none',
              minHeight: 40,
              maxHeight: 120,
              overflowY: 'auto',
              lineHeight: 1.5,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: `linear-gradient(135deg,${chakra},${chakra}cc)`,
              border: 'none', color: '#fff',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.45 : 1,
              display: 'flex', alignItems: 'center',
            }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Suggested chips per module ───────────────────────────────────────────────
function getChips(module, context) {
  const name = context?.contactName || context?.companyName;
  switch (module) {
    case 'recon':
      return ['Review my ICP', 'Update my target profile', 'What should I focus on?'];
    case 'scout':
      return name
        ? [`Evaluate ${name}`, 'Why is this a match?', 'Find similar companies']
        : ['Find my best targets', 'What companies should I add?'];
    case 'hunter':
      return name
        ? [`Draft a follow-up for ${name}`, `What's the next step with ${name}?`, 'Who needs action today?']
        : ['Who needs action today?', 'Draft a cold open', 'Review my pipeline'];
    case 'sniper':
      return name
        ? [`Draft a close email for ${name}`, `How do I move ${name} forward?`]
        : ['Who is closest to closing?', 'Draft a trust-first follow-up'];
    case 'command-center':
      return ['Who is going cold?', 'Surface re-engagement opportunities', 'Review relationship health'];
    case 'reinforcements':
      return ['Find warm intro paths', 'Who can refer me in?', 'Review my network'];
    default:
      return [];
  }
}
