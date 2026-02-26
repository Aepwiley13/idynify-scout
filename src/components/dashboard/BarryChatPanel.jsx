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
import { auth } from '../../firebase/config';
import { buildContextStack } from '../../utils/barryContextStack';
import MessageAngleBlock from '../shared/MessageAngleBlock';

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

  const threadRef = useRef(null);
  const inputRef = useRef(null);

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

  // ── Auto-scroll conversation thread ───────────────────────────────────────

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // ── Init: build context stack, then load opening brief ────────────────────

  async function initPanel() {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }

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

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;

    const userMessage = text.trim();
    setInputValue('');
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
      const user = auth.currentUser;
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
              {isCollapsed && lastMessage && (
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
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell me what you want to work on..."
                disabled={sending || loading}
                aria-label="Message Barry"
                className="flex-1 min-w-0 bg-black/50 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50 font-mono"
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
