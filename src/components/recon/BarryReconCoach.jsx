/**
 * BarryReconCoach — Conversational coaching panel for RECON.
 *
 * Used in two contexts:
 *   1. Section 0 (User Profile) — calls barryReconSection0
 *   2. Sections 1-10 (ICP coaching) — calls barryReconInterview with mode=ask
 *
 * Props:
 *   sectionId    — 0 for user profile, 1-10 for ICP sections
 *   sectionLabel — display label for the section
 *   existingAnswers — current saved answers for the section (sections 1-10)
 *   userId       — current user ID
 *   onClose      — called when panel should close
 *   onComplete   — called when Barry signals section is complete
 */

import { useState, useEffect, useRef } from 'react';
import { ArrowRight, X, Loader, CheckCircle } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const RECON_INDIGO = '#5A3FFF';

function BarryAvatar({ size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${RECON_INDIGO})`,
      border: `2px solid ${RECON_INDIGO}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
      boxShadow: `0 0 ${size * 0.5}px ${RECON_INDIGO}50`,
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

export default function BarryReconCoach({ sectionId, sectionLabel, existingAnswers = {}, userId, onClose, onComplete }) {
  const T = useT();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [sectionComplete, setSectionComplete] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isSection0 = sectionId === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  // On mount: load prior session or start fresh
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const user = getEffectiveUser();

      // Try to load prior coaching session for this section
      const sessionKey = `reconCoach_${sectionId}`;
      if (user) {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid, 'barryConversations', sessionKey));
          if (!cancelled && snap.exists() && (snap.data().messages || []).length > 0) {
            const saved = snap.data();
            const displayMsgs = saved.messages.map(h => ({
              role: (h.role === 'assistant' || h.role === 'barry') ? 'barry' : 'user',
              content: h.content,
            }));
            setMessages([
              { role: 'system', content: '— Resumed from last session —' },
              ...displayMsgs,
            ]);
            setConversationHistory(saved.messages.map(h => ({
              role: h.role === 'user' ? 'user' : 'assistant',
              content: h.content,
            })));
            return;
          }
        } catch (_) {}
      }

      if (!cancelled) {
        // Start fresh — call Barry for opening message
        await callBarry(null, [], true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const callBarry = async (userMessage, history, isOpening = false) => {
    setLoading(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      let res;
      if (isSection0) {
        // Section 0 — user profile coaching
        res = await fetch('/.netlify/functions/barryReconSection0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            mode: isOpening ? 'start' : 'message',
            message: userMessage,
            conversationHistory: history,
          }),
        });
      } else {
        // Sections 1-10 — ICP coaching via barryReconInterview
        res = await fetch('/.netlify/functions/barryReconInterview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            sectionId,
            mode: isOpening ? 'intro' : 'ask',
            question: userMessage,
            existingAnswers,
          }),
        });
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Barry error');

      const barryText = data.message || data.response_text;
      const barryMsg = { role: 'barry', content: barryText };
      setMessages(prev => [...prev, barryMsg]);

      if (!isOpening) {
        const newHistory = data.updatedHistory || [
          ...history,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: barryText },
        ];
        setConversationHistory(newHistory);

        // Persist session
        const sessionKey = `reconCoach_${sectionId}`;
        setDoc(
          doc(db, 'users', user.uid, 'barryConversations', sessionKey),
          { messages: newHistory, updatedAt: new Date() },
          { merge: false }
        ).catch(() => {});
      }

      // Check for section completion (Section 0 only — server signals it)
      if (data.sectionComplete) {
        setSectionComplete(true);
      }
    } catch (err) {
      console.error('[BarryReconCoach] error:', err);
      setMessages(prev => [...prev, { role: 'barry', content: "Something went wrong — try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    callBarry(msg, conversationHistory);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 498, background: 'rgba(0,0,0,0.45)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        zIndex: 499,
        background: T.cardBg,
        borderLeft: `1px solid ${RECON_INDIGO}30`,
        display: 'flex', flexDirection: 'column',
        boxShadow: `-8px 0 40px rgba(0,0,0,0.35)`,
        animation: 'reconCoachSlideIn 0.22s ease',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <style>{`
          @keyframes reconCoachSlideIn {
            from { opacity: 0; transform: translateX(20px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          @keyframes reconSpin { to { transform: rotate(360deg); } }
        `}</style>

        {/* Header */}
        <div style={{
          padding: '14px 18px', flexShrink: 0,
          background: `linear-gradient(135deg,${RECON_INDIGO}18,${RECON_INDIGO}08)`,
          borderBottom: `1px solid ${RECON_INDIGO}30`,
          display: 'flex', alignItems: 'center', gap: 11,
        }}>
          <BarryAvatar size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>Barry</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: RECON_INDIGO, marginTop: 1 }}>
              COACH — {isSection0 ? 'USER PROFILE' : sectionLabel?.toUpperCase()}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((msg, i) => (
            msg.role === 'system' ? (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, color: T.textFaint, padding: '2px 0' }}>
                {msg.content}
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
                {msg.role === 'barry' && <BarryAvatar size={24} />}
                <div style={{
                  maxWidth: '83%', padding: '9px 13px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user'
                    ? `linear-gradient(135deg,${RECON_INDIGO},${RECON_INDIGO}cc)`
                    : T.surface,
                  color: msg.role === 'user' ? '#fff' : T.text,
                  fontSize: 13, lineHeight: 1.6,
                  border: msg.role === 'barry' ? `1px solid ${T.border2}` : 'none',
                }}>
                  {msg.content}
                </div>
              </div>
            )
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarryAvatar size={24} />
              <div style={{ padding: '9px 13px', borderRadius: '16px 16px 16px 4px', background: T.surface, border: `1px solid ${T.border2}` }}>
                <Loader size={14} color={RECON_INDIGO} style={{ animation: 'reconSpin 1s linear infinite' }} />
              </div>
            </div>
          )}

          {/* Section complete CTA */}
          {sectionComplete && !loading && (
            <div style={{
              padding: '14px 16px', borderRadius: 14,
              background: `${RECON_INDIGO}12`, border: `1px solid ${RECON_INDIGO}35`,
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 8,
            }}>
              <CheckCircle size={20} color={RECON_INDIGO} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Profile saved</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>Barry has your profile locked in.</div>
              </div>
              <button
                onClick={onComplete}
                style={{
                  padding: '7px 14px', borderRadius: 10,
                  background: RECON_INDIGO, border: 'none',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${T.border}`,
          display: 'flex', gap: 8, flexShrink: 0,
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={loading ? 'Barry is thinking…' : 'Reply to Barry…'}
            disabled={loading || sectionComplete}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              border: `1px solid ${T.border2}`,
              background: T.surface, color: T.text,
              fontSize: 13, outline: 'none',
              opacity: (loading || sectionComplete) ? 0.6 : 1,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || sectionComplete}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: `linear-gradient(135deg,${RECON_INDIGO},${RECON_INDIGO}cc)`,
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
