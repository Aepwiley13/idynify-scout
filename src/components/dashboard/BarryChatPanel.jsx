import { useState, useEffect, useRef } from 'react';
import { auth } from '../../firebase/config';

// ── Mode configuration ────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────

/**
 * BarryChatPanel — Barry's Mission Control chat interface.
 *
 * On mount, calls barryMissionChat for an opening brief grounded in real
 * pipeline data. Supports free-text multi-turn conversation with session
 * history. Collapsible with sessionStorage-based visit detection.
 */
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

  const threadRef = useRef(null);
  const inputRef = useRef(null);

  // ── On mount: load opening brief, handle collapse state ──

  useEffect(() => {
    // Collapse on mobile for returning users
    const hasVisited = sessionStorage.getItem('barry_mission_visited');
    const isMobile = window.innerWidth < 768;
    if (hasVisited && isMobile) {
      setIsCollapsed(true);
    }
    sessionStorage.setItem('barry_mission_visited', 'true');

    loadOpeningBrief();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll conversation thread ──

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // ── API calls ─────────────────────────────────────────────

  const loadOpeningBrief = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken })
      });

      const data = await response.json();

      if (data.success) {
        setMode(data.mode || 'SUGGEST');
        setBrief(data.brief || '');
        setSuggestedPrompts(data.suggestedPrompts || []);
      } else {
        setFallbackBrief();
      }
    } catch (error) {
      console.error('[BarryChatPanel] Failed to load opening brief:', error);
      setFallbackBrief();
    } finally {
      setLoading(false);
    }
  };

  const setFallbackBrief = () => {
    setBrief('Your pipeline is ready. Ask me anything about your contacts, missions, or next steps.');
    setSuggestedPrompts([
      'What should I focus on today?',
      'How is my pipeline doing?',
      'Help me find new leads.'
    ]);
  };

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;

    const userMessage = text.trim();
    setInputValue('');
    setSending(true);

    // Optimistically add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: userMessage,
          conversationHistory,
          mode
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
        setConversationHistory(data.updatedHistory);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'I had trouble processing that. Try asking again.'
        }]);
      }
    } catch (error) {
      console.error('[BarryChatPanel] Failed to send message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection issue — try again in a moment.'
      }]);
    } finally {
      setSending(false);
    }
  };

  // ── Event handlers ────────────────────────────────────────

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleChipClick = (prompt) => {
    sendMessage(prompt);
    // Expand panel if collapsed
    if (isCollapsed) setIsCollapsed(false);
  };

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev);
  };

  // ── Derived values ────────────────────────────────────────

  const modeConfig = MODE_CONFIG[mode] || MODE_CONFIG.SUGGEST;
  const lastMessage = messages[messages.length - 1];
  const hasConversation = messages.length > 0;

  // ── Render ────────────────────────────────────────────────

  return (
    <section className="mb-12" aria-label="Barry Mission Co-pilot">

      {/* ── Panel Header (always visible) ── */}
      <div
        className="flex items-center justify-between px-5 py-4 bg-black/50 backdrop-blur-xl border border-cyan-500/20 cursor-pointer select-none"
        style={{
          borderRadius: isCollapsed ? '1rem' : '1rem 1rem 0 0',
          boxShadow: '0 0 20px rgba(6, 182, 212, 0.1)'
        }}
        onClick={toggleCollapse}
      >
        {/* Left: Barry identity */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            {loading ? (
              <>
                <span className="text-4xl opacity-60 animate-pulse">🐻</span>
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/40 animate-ping"></div>
              </>
            ) : (
              <span className="text-4xl">🐻</span>
            )}
          </div>

          <div>
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-white font-semibold text-sm font-mono">Barry</span>

              {/* Mode badge */}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-mono ${modeConfig.pillClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${modeConfig.dotClass}`}></span>
                {modeConfig.label}
              </span>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs text-cyan-400 font-mono">Online</span>

              {/* Last message preview when collapsed */}
              {isCollapsed && lastMessage && (
                <span className="text-xs text-gray-400 truncate max-w-xs ml-1">
                  {lastMessage.content.length > 50
                    ? lastMessage.content.slice(0, 50) + '...'
                    : lastMessage.content}
                </span>
              )}

              {/* Loading indicator */}
              {isCollapsed && loading && (
                <span className="text-xs text-gray-500 font-mono animate-pulse ml-1">Loading...</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: collapse toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all text-lg font-mono flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}
          aria-label={isCollapsed ? 'Expand Barry panel' : 'Collapse Barry panel'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      </div>

      {/* ── Panel Body (collapsible) ── */}
      {!isCollapsed && (
        <div
          className="bg-black/40 backdrop-blur-xl border-x border-b border-cyan-500/20 overflow-hidden"
          style={{
            borderRadius: '0 0 1rem 1rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
          }}
        >

          {/* Opening Brief */}
          <div className="px-5 pt-5 pb-4">
            {loading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Barry is thinking">
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-3/4"></div>
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-full"></div>
                <div className="h-4 bg-gray-700/50 rounded-full animate-pulse w-2/3"></div>
              </div>
            ) : (
              <p className="text-gray-200 text-sm leading-relaxed">{brief}</p>
            )}
          </div>

          {/* Suggested Prompt Chips */}
          {!loading && suggestedPrompts.length > 0 && (
            <div className="px-5 pb-4 flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleChipClick(prompt)}
                  disabled={sending}
                  className="text-xs px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-400/60 transition-all font-mono disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Conversation Thread */}
          {(hasConversation || sending) && (
            <>
              <div className="mx-5 border-t border-cyan-500/10"></div>

              <div
                ref={threadRef}
                className="px-5 py-4 overflow-y-auto flex flex-col gap-3"
                style={{ maxHeight: '30vh' }}
                aria-live="polite"
                aria-label="Conversation with Barry"
              >
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.role === 'assistant' && (
                      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                    )}
                    <div
                      className={`text-sm px-3 py-2 max-w-[82%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30 rounded-2xl rounded-tr-sm'
                          : 'bg-gray-800/60 text-gray-200 border border-gray-700/50 rounded-2xl rounded-tl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {sending && (
                  <div className="flex gap-2" aria-label="Barry is typing">
                    <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🐻</span>
                    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }}></span>
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
                placeholder="Ask Barry..."
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
