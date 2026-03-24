/**
 * BarryReconGuide — Barry's live panel inside the RECON section editor.
 *
 * Features:
 *  - Barry avatar with online indicator
 *  - Auto-fetches section intro when mounted
 *  - Typing animation → message appears
 *  - "Ask Barry" input for freeform questions
 *  - Transitions to show coaching response after section save
 *  - Fully theme-aware via useT()
 */

import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown, ChevronRight, AlertTriangle, Sparkles } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// ─── Barry typing indicator ───────────────────────────────────────────────────
function BarryTyping() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 2px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: BRAND.cyan,
          animation: `brg-bounce 1.2s ease-in-out infinite`,
          animationDelay: `${i * 0.2}s`,
          opacity: 0.8,
        }} />
      ))}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ message, T, isUser = false }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 8,
      marginBottom: 10,
      animation: 'brg-slide-up 0.2s ease',
    }}>
      {!isUser && (
        <div style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
          border: `1.5px solid ${BRAND.cyan}40`,
          overflow: 'hidden',
          boxShadow: `0 0 8px ${BRAND.cyan}30`,
        }}>
          <img src={ASSETS.barryAvatar} alt="Barry"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
          />
        </div>
      )}
      <div style={{
        flex: 1,
        background: isUser
          ? `${BRAND.pink}15`
          : T.isDark ? `${BRAND.cyan}0d` : `${BRAND.cyan}08`,
        border: `1px solid ${isUser ? `${BRAND.pink}25` : `${BRAND.cyan}20`}`,
        borderRadius: isUser ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
        padding: '10px 12px',
        fontSize: 12.5,
        lineHeight: 1.6,
        color: T.text,
      }}>
        {message}
      </div>
    </div>
  );
}

// ─── Coaching response inside guide ──────────────────────────────────────────
function CoachingCard({ coaching, T }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!coaching?.quality || !coaching?.mirror) return null;

  const qualityColor = coaching.quality === 'strong'
    ? BRAND.cyan
    : coaching.quality === 'weak'
    ? '#f59e0b'
    : '#dc2626';

  const qualityBg = coaching.quality === 'strong'
    ? `${BRAND.cyan}0d`
    : coaching.quality === 'weak'
    ? '#f59e0b0d'
    : '#dc26260d';

  const isGap = coaching.quality === 'incomplete' && coaching.gap_warning;

  return (
    <div style={{
      marginTop: 8,
      background: qualityBg,
      border: `1px solid ${qualityColor}25`,
      borderLeft: `3px solid ${qualityColor}`,
      borderRadius: '0 8px 8px 0',
      padding: '10px 12px',
      animation: 'brg-slide-up 0.25s ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: qualityColor,
        }}>
          Barry
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: T.text, flex: 1, lineHeight: 1.4 }}>
          {coaching.headline}
        </span>
        {coaching.confidenceImpact !== 0 && coaching.confidenceImpact != null && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
            color: coaching.confidenceImpact > 0 ? '#065f46' : '#92400e',
            background: coaching.confidenceImpact > 0 ? '#d1fae5' : '#fde68a',
          }}>
            {coaching.confidenceImpact > 0 ? `↑ context` : `↓ context`}
          </span>
        )}
      </div>

      {isGap ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AlertTriangle size={12} color="#dc2626" />
          <p style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.6, margin: 0 }}>
            {coaching.gap_warning}
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, margin: '0 0 6px' }}>
            {coaching.mirror}
          </p>
          {coaching.inference && (
            <>
              <div style={{ height: 1, background: `${qualityColor}20`, margin: '8px 0' }} />
              <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, margin: 0,
                fontStyle: 'italic',
                color: coaching.quality === 'weak' ? '#78350f' : T.textMuted,
              }}>
                {coaching.inference}
              </p>
            </>
          )}
          {coaching.output_preview && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setPreviewOpen(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 600, color: BRAND.cyan,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                }}
              >
                {previewOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                See what Barry says in the field
              </button>
              {previewOpen && (
                <div style={{
                  marginTop: 8, background: T.surface, borderRadius: 6,
                  padding: '9px 11px', animation: 'brg-slide-up 0.2s ease',
                }}>
                  <p style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.65, margin: 0, fontStyle: 'italic' }}>
                    {coaching.output_preview}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BarryReconGuide({
  sectionId,
  sectionTitle,
  formData,
  coachingData,
  coachingLoading,
}) {
  const T = useT();
  const [introMessage, setIntroMessage] = useState(null);
  const [introLoading, setIntroLoading] = useState(true);
  const [askInput, setAskInput] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [conversation, setConversation] = useState([]); // [{role:'barry'|'user', text:string}]
  const [isOnline] = useState(true);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch Barry's intro when section opens
  useEffect(() => {
    setIntroLoading(true);
    setIntroMessage(null);
    setConversation([]);
    fetchIntro();
  }, [sectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll only within the Barry messages container — never the whole page
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [conversation, coachingData, introMessage]);

  const fetchIntro = async () => {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryReconInterview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          sectionId,
          mode: 'intro',
          existingAnswers: formData || {},
        }),
      });

      if (!res.ok) throw new Error('Intro fetch failed');
      const { message } = await res.json();
      setIntroMessage(message);
    } catch (err) {
      console.error('[BarryReconGuide] intro error:', err);
      setIntroMessage(null);
    } finally {
      setIntroLoading(false);
    }
  };

  const handleAsk = async () => {
    const q = askInput.trim();
    if (!q || askLoading) return;

    setAskInput('');
    setConversation(prev => [...prev, { role: 'user', text: q }]);
    setAskLoading(true);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryReconInterview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          sectionId,
          mode: 'ask',
          question: q,
          existingAnswers: formData || {},
        }),
      });

      if (!res.ok) throw new Error('Ask failed');
      const { message } = await res.json();
      setConversation(prev => [...prev, { role: 'barry', text: message }]);
    } catch (err) {
      console.error('[BarryReconGuide] ask error:', err);
      setConversation(prev => [...prev, { role: 'barry', text: "I hit an issue there — try again." }]);
    } finally {
      setAskLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: T.cardBg,
      border: `1px solid ${T.border2}`,
      borderRadius: 14,
      overflow: 'hidden',
      height: '100%',
      minHeight: 320,
    }}>
      <style>{`
        @keyframes brg-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes brg-slide-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes brg-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px',
        borderBottom: `1px solid ${T.border}`,
        background: T.isDark ? `${BRAND.cyan}08` : `${BRAND.cyan}06`,
        flexShrink: 0,
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
            border: `2px solid ${BRAND.cyan}40`,
            overflow: 'hidden',
            boxShadow: `0 0 12px ${BRAND.cyan}35`,
          }}>
            <img src={ASSETS.barryAvatar} alt="Barry"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
            />
          </div>
          {/* Online dot */}
          <div style={{
            position: 'absolute', bottom: 1, right: 1,
            width: 8, height: 8, borderRadius: '50%',
            background: '#10b981',
            border: `1.5px solid ${T.cardBg}`,
            animation: introLoading ? 'brg-pulse 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Barry</div>
          <div style={{ fontSize: 10, color: T.textFaint }}>
            {introLoading ? 'Thinking...' : 'Your training guide'}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: BRAND.cyan, opacity: 0.8,
        }}>
          <Sparkles size={10} />
          RECON
        </div>
      </div>

      {/* ── Messages area ── */}
      <div ref={messagesContainerRef} style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Intro from Barry */}
        {introLoading ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
              overflow: 'hidden',
            }}>
              <img src={ASSETS.barryAvatar} alt="Barry"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
              />
            </div>
            <div style={{
              background: T.isDark ? `${BRAND.cyan}0d` : `${BRAND.cyan}08`,
              border: `1px solid ${BRAND.cyan}20`,
              borderRadius: '10px 10px 10px 2px',
              padding: '10px 12px',
            }}>
              <BarryTyping />
            </div>
          </div>
        ) : introMessage && (
          <MessageBubble message={introMessage} T={T} />
        )}

        {/* Conversation history */}
        {conversation.map((msg, i) => (
          <MessageBubble key={i} message={msg.text} T={T} isUser={msg.role === 'user'} />
        ))}

        {/* Barry typing during ask */}
        {askLoading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
              overflow: 'hidden',
            }}>
              <img src={ASSETS.barryAvatar} alt="Barry"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
              />
            </div>
            <div style={{
              background: T.isDark ? `${BRAND.cyan}0d` : `${BRAND.cyan}08`,
              border: `1px solid ${BRAND.cyan}20`,
              borderRadius: '10px 10px 10px 2px',
              padding: '10px 12px',
            }}>
              <BarryTyping />
            </div>
          </div>
        )}

        {/* Coaching response after save */}
        {coachingLoading && !coachingData && (
          <div style={{
            marginTop: 8, padding: '8px 10px',
            background: T.surface,
            borderRadius: 8,
            fontSize: 11, color: BRAND.cyan,
            animation: 'brg-pulse 1.5s ease-in-out infinite',
          }}>
            Barry is reviewing your training data...
          </div>
        )}
        {coachingData && (
          <>
            <div style={{
              height: 1, background: T.border, margin: '10px 0',
            }} />
            <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Section Review
            </div>
            <CoachingCard coaching={coachingData} T={T} />
          </>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Ask Barry input ── */}
      <div style={{
        padding: '10px 12px',
        borderTop: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <input
            ref={inputRef}
            type="text"
            value={askInput}
            onChange={e => setAskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Barry about this section..."
            disabled={askLoading || introLoading}
            style={{
              flex: 1,
              background: T.cardBg,
              border: `1px solid ${T.border2}`,
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              color: T.text,
              outline: 'none',
              transition: 'border-color 0.15s',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
            onFocus={e => { e.target.style.borderColor = BRAND.cyan; }}
            onBlur={e => { e.target.style.borderColor = T.border2; }}
          />
          <button
            onClick={handleAsk}
            disabled={!askInput.trim() || askLoading || introLoading}
            title="Ask Barry"
            style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: askInput.trim() && !askLoading ? `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})` : T.surface,
              border: `1px solid ${askInput.trim() ? BRAND.cyan : T.border2}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: askInput.trim() && !askLoading ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
              opacity: askInput.trim() && !askLoading ? 1 : 0.4,
            }}
          >
            <Send size={13} color={askInput.trim() && !askLoading ? '#fff' : T.textFaint} />
          </button>
        </div>
        <p style={{ fontSize: 9.5, color: T.textFaint, marginTop: 4, marginBottom: 0 }}>
          Ask why a question matters, what to write, or anything about this section
        </p>
      </div>
    </div>
  );
}
