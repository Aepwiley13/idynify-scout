/**
 * BarryWorkspace — full-page Barry conversation surface.
 *
 * This is the primary place a user intentionally works with Barry:
 *   - First Experience (onboarding) renders here, inside the app shell
 *   - Post-onboarding, this is the persistent Barry conversation page
 *   - Same canonical conversation as the Sidecar panel
 *
 * The page reads and writes the same canonical subcollection that every
 * other renderer uses (barryConversations/canonical/turns), so moving
 * between Workspace and Sidecar never loses turns.
 *
 * The composer calls barryMissionChat — the same reasoning path as the
 * Sidecar. One Barry, one conversation, different presentations.
 *
 * During First Experience, the conversation UI is continuous — Barry's
 * WHO → INTENT conversation and the First Value delivery (targeting,
 * relationship snapshot, navigation) all render as conversation objects
 * inside the same thread. The user never leaves the workspace.
 */

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useShell } from '../../context/ShellContext';
import { useLocation } from 'react-router-dom';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { appendTurn, loadOrSeedRecentTurns } from '../../utils/barryCanonical';
import { resolveWho } from '../../utils/resolveWho';
import { buildContextStack } from '../../utils/barryContextStack';
import { intentLabel } from '../../utils/firstValueRouting';
import ConversationCard from '../../components/conversation/ConversationCard';
import useFirstExperienceController from '../../hooks/useFirstExperienceController';
import BarryOnboarding from '../Onboarding/BarryOnboarding';
import RelationshipFirstValue from '../../components/onboarding/RelationshipFirstValue';
import './BarryWorkspace.css';

export default function BarryWorkspace() {
  const T = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const arrival = location.state?.arrival || null;
  const { closeBarry, setFirstExperience } = useShell();
  const [loading, setLoading] = useState(true);
  const [isFirstExperience, setIsFirstExperienceLocal] = useState(false);
  const [conversationTurns, setConversationTurns] = useState([]);
  const [who, setWho] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [contextStack, setContextStack] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [barryMode, setBarryMode] = useState('SUGGEST');

  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const feCtrl = useFirstExperienceController(arrival);
  const feTurnCountRef = useRef(0);

  // B2-C1: Persist FE conversation turns to the canonical store so they
  // survive refresh and remain visible after handoff.
  useEffect(() => {
    const turns = feCtrl.turns;
    const prevCount = feTurnCountRef.current;
    if (turns.length <= prevCount) return;

    const newTurns = turns.slice(prevCount);
    feTurnCountRef.current = turns.length;

    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;

    (async () => {
      for (const turn of newTurns) {
        if (!turn.content) continue;
        try {
          await appendTurn(db, user.uid, {
            role: turn.role,
            content: turn.content,
            surface: 'workspace',
            kind: 'first-experience',
          });
        } catch (err) {
          console.warn('[BarryWorkspace] FE canonical append failed:', err.message);
        }
      }
    })();
  }, [feCtrl.turns]);

  async function init() {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) { setLoading(false); return; }

    try {
      const [userSnap, turns, mcSnap] = await Promise.all([
        getDoc(doc(db, 'users', user.uid)).catch(() => null),
        loadOrSeedRecentTurns(db, user.uid, 30),
        getDoc(doc(db, 'users', user.uid, 'barryConversations', 'missionControl')).catch(() => null),
      ]);

      const persistedMode = mcSnap?.exists() ? mcSnap.data().mode : null;
      if (persistedMode) setBarryMode(persistedMode);

      const userData = userSnap?.exists() ? userSnap.data() : null;
      const onboardingComplete = userData?.onboardingComplete || userData?.onboarding?.completed;

      const firstExp = !onboardingComplete;
      setIsFirstExperienceLocal(firstExp);
      setFirstExperience?.(firstExp);

      setConversationTurns(turns);
      setConversationHistory(turns.map(t => ({ role: t.role, content: t.content })));
      setWho(resolveWho(user, userData));
    } catch (err) {
      console.warn('[BarryWorkspace] init failed:', err.message);
    }
    setLoading(false);

    try {
      const user = getEffectiveUser() || auth.currentUser;
      if (user) {
        const stack = await buildContextStack(user.uid);
        setContextStack(stack);
      }
    } catch (err) {
      console.warn('[BarryWorkspace] context stack build failed (non-fatal):', err.message);
    }
  }

  useEffect(() => {
    closeBarry();
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [conversationTurns, sending, feCtrl.turns, feCtrl.classifying, feCtrl.phase]);

  useEffect(() => {
    return () => { setFirstExperience?.(false); };
  }, [setFirstExperience]);

  async function sendMessage(text) {
    if (!text.trim() || sending) return;
    const userMessage = text.trim();
    setInputValue('');
    setSending(true);

    const userTurn = { role: 'user', content: userMessage };
    setConversationTurns(prev => [...prev, userTurn]);

    setTimeout(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    }, 0);

    try {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) { setSending(false); return; }

      await appendTurn(db, user.uid, { role: 'user', content: userMessage, surface: 'workspace' });

      let authToken;
      try { authToken = await user.getIdToken(); } catch (tokenErr) {
        console.warn('[BarryWorkspace] getIdToken failed:', tokenErr.message);
        setConversationTurns(prev => [...prev, {
          role: 'assistant', content: 'Session expired — please refresh the page.',
        }]);
        setSending(false); return;
      }

      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          message: userMessage,
          conversationHistory,
          barryMode,
          contextStack,
        }),
      });

      const data = await res.json();

      if (data.success) {
        if (data.barry_mode && data.barry_mode !== barryMode) {
          setBarryMode(data.barry_mode);
        }

        const hasAngles = !!data.has_message_angles && data.angles?.length > 0;
        const responseContent = data.response_text || data.response || '';

        const assistantTurn = {
          role: 'assistant',
          content: responseContent,
          kind: hasAngles && !responseContent ? 'angles' : undefined,
          has_message_angles: hasAngles,
          angles: data.angles || [],
        };

        setConversationTurns(prev => [...prev, assistantTurn]);
        setConversationHistory(data.updatedHistory || [...conversationHistory, userTurn, { role: 'assistant', content: responseContent }]);

        let canonicalContent = responseContent;
        let turnKind;
        if (!canonicalContent && hasAngles) {
          const angleNames = data.angles.map(a => a.label || a.subject || 'angle').join(', ');
          canonicalContent = `Message angles generated: ${angleNames}`;
          turnKind = 'angles';
        }

        try {
          await appendTurn(db, user.uid, { role: 'assistant', content: canonicalContent, surface: 'workspace', kind: turnKind });
        } catch (err) {
          console.warn('[BarryWorkspace] canonical append failed:', err.message);
        }
      } else {
        setConversationTurns(prev => [...prev, {
          role: 'assistant',
          content: 'I had trouble processing that. Try asking again.',
        }]);
      }
    } catch (err) {
      console.error('[BarryWorkspace] send failed:', err);
      setConversationTurns(prev => [...prev, {
        role: 'assistant',
        content: 'Connection issue — try again in a moment.',
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isFirstExperience && feCtrl.phase !== 'handoff') {
        handleFirstExperienceSubmit();
      } else {
        sendMessage(inputValue);
      }
    }
  }

  function handleFirstExperienceSubmit() {
    if (!inputValue.trim() || feCtrl.classifying) return;
    feCtrl.handleUserInput(inputValue.trim());
    setInputValue('');
  }

  if (loading) {
    return (
      <div className="barry-workspace">
        <div className="barry-workspace-loading">
          <div className="barry-workspace-loading-avatar">
            <img src={ASSETS.barryAvatar} alt="" width={64} height={64} />
          </div>
          <p style={{ color: T.textMuted }}>Loading Barry...</p>
        </div>
      </div>
    );
  }

  // First Experience — all phases render inside the same workspace shell.
  // The 'delivering' phase keeps the conversation visible and renders
  // structured cards (targeting, relationship, navigation) inline.
  if (isFirstExperience && feCtrl.phase !== 'loading') {
    const fePhase = feCtrl.phase;
    const feTurns = feCtrl.turns;
    const isWhoPhase = fePhase === 'who';
    const isDelivering = fePhase === 'delivering';
    const isBusy = feCtrl.classifying;
    const isProspecting = isDelivering && feCtrl.decision?.kind === 'in-place';
    const placeholder = isWhoPhase ? 'Your name'
      : isProspecting ? 'Tell Barry about your target market...'
      : 'Type your answer...';
    const composerDisabled = isBusy || (isDelivering && !isProspecting);

    return (
      <div className="barry-workspace">
        <div className="barry-workspace-header" style={{ borderColor: T.border }}>
          <div className="barry-workspace-header-left">
            <img
              src={ASSETS.barryAvatar}
              alt="Barry"
              className="barry-workspace-avatar"
              width={40}
              height={40}
            />
            <div>
              <h1 className="barry-workspace-title" style={{ color: T.text }}>Barry</h1>
              <span className="barry-workspace-subtitle" style={{ color: T.textMuted }}>
                Your sales intelligence co-pilot
              </span>
            </div>
          </div>
        </div>

        <div className="barry-workspace-thread" ref={threadRef}>
          {feTurns.map((turn, i) => {
            // Structured card turns render their card below the message bubble
            const hasCard = turn._feCard && i === feTurns.length - 1;

            return (
              <div key={i}>
                <div
                  className={`barry-workspace-message ${turn.role === 'user' ? 'user' : 'assistant'}`}
                >
                  {turn.role === 'assistant' && (
                    <img
                      src={ASSETS.barryAvatar}
                      alt=""
                      className="barry-workspace-msg-avatar"
                      width={28}
                      height={28}
                    />
                  )}
                  <div
                    className="barry-workspace-msg-bubble"
                    style={{
                      background: turn.role === 'user' ? `${BRAND.pink}18` : T.surface,
                      borderColor: turn.role === 'user' ? `${BRAND.pink}30` : T.border,
                      color: T.text,
                    }}
                  >
                    <p>{turn.content}</p>
                  </div>
                </div>

                {hasCard && turn._feCard === 'prospecting' && (
                  <div className="barry-workspace-fe-card">
                    <BarryOnboarding
                      knownName={feCtrl.who?.name || null}
                      goal={feCtrl.pending?.restatement || null}
                    />
                  </div>
                )}

                {hasCard && turn._feCard === 'relationship' && (
                  <div className="barry-workspace-fe-card">
                    <RelationshipFirstValue
                      decision={feCtrl.decision}
                      knownName={feCtrl.who?.name || null}
                    />
                  </div>
                )}

                {hasCard && turn._feCard === 'navigate' && feCtrl.decision?.destination && (
                  <div className="barry-workspace-fe-actions">
                    <button
                      className="barry-workspace-fe-btn barry-workspace-fe-btn--go"
                      style={{ background: BRAND.pink, color: '#fff' }}
                      onClick={() => navigate(feCtrl.decision.destination.path)}
                    >
                      Take me there
                    </button>
                    {feCtrl.held && (
                      <button
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--quiet"
                        style={{ borderColor: T.border, color: T.text }}
                        onClick={() => feCtrl.chooseIntent(feCtrl.held)}
                      >
                        Then {intentLabel(feCtrl.held)}
                      </button>
                    )}
                  </div>
                )}

                {hasCard && turn._feCard === 'blocked' && (
                  <div className="barry-workspace-fe-actions">
                    {feCtrl.decision?.destination && (
                      <button
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--go"
                        style={{ background: BRAND.pink, color: '#fff' }}
                        onClick={() => navigate(feCtrl.decision.destination.path)}
                      >
                        Set that up
                      </button>
                    )}
                    {(feCtrl.decision?.options || []).map(o => (
                      <button
                        key={o.id}
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--quiet"
                        style={{ borderColor: T.border, color: T.text }}
                        onClick={() => feCtrl.chooseIntent(o.intent)}
                      >
                        {o.label}
                      </button>
                    ))}
                    {feCtrl.held && (
                      <button
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--quiet"
                        style={{ borderColor: T.border, color: T.text }}
                        onClick={() => feCtrl.chooseIntent(feCtrl.held)}
                      >
                        Then {intentLabel(feCtrl.held)}
                      </button>
                    )}
                  </div>
                )}

                {hasCard && turn._feCard === 'action' && (
                  <div className="barry-workspace-fe-actions">
                    {feCtrl.decision?.destination && (
                      <button
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--go"
                        style={{ background: BRAND.pink, color: '#fff' }}
                        onClick={() => navigate(feCtrl.decision.destination.path)}
                      >
                        Take me there
                      </button>
                    )}
                    {(feCtrl.decision?.options || []).map(o => (
                      <button
                        key={o.id}
                        className="barry-workspace-fe-btn barry-workspace-fe-btn--quiet"
                        style={{ borderColor: T.border, color: T.text }}
                        onClick={() => feCtrl.chooseIntent(o.intent)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {isWhoPhase && (
            <div className="barry-workspace-fe-skip">
              <button
                onClick={feCtrl.skipName}
                className="barry-workspace-skip-btn"
                style={{ color: T.textMuted }}
              >
                Skip
              </button>
            </div>
          )}

          {isBusy && (
            <div className="barry-workspace-message assistant">
              <img
                src={ASSETS.barryAvatar}
                alt=""
                className="barry-workspace-msg-avatar"
                width={28}
                height={28}
              />
              <div
                className="barry-workspace-msg-bubble barry-workspace-typing"
                style={{ background: T.surface, borderColor: T.border }}
              >
                <span className="barry-typing-dot" />
                <span className="barry-typing-dot" />
                <span className="barry-typing-dot" />
              </div>
            </div>
          )}
        </div>

        <div className="barry-workspace-composer" style={{ borderColor: T.border }}>
          <div className="barry-workspace-composer-row">
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
              placeholder={placeholder}
              disabled={composerDisabled}
              aria-label={isWhoPhase ? 'Your name' : 'Message Barry'}
              className="barry-workspace-input"
              style={{
                background: T.surface,
                borderColor: T.border,
                color: T.text,
              }}
            />
            <button
              onClick={handleFirstExperienceSubmit}
              disabled={composerDisabled || !inputValue.trim()}
              aria-label="Send"
              className="barry-workspace-send"
              style={{
                background: inputValue.trim() ? BRAND.pink : T.surface2,
                color: inputValue.trim() ? '#fff' : T.textMuted,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Post-onboarding (or first-experience controller still loading): conversation UI
  return (
    <div className="barry-workspace">
      <div className="barry-workspace-header" style={{ borderColor: T.border }}>
        <div className="barry-workspace-header-left">
          <img
            src={ASSETS.barryAvatar}
            alt="Barry"
            className="barry-workspace-avatar"
            width={40}
            height={40}
          />
          <div>
            <h1 className="barry-workspace-title" style={{ color: T.text }}>Barry</h1>
            <span className="barry-workspace-subtitle" style={{ color: T.textMuted }}>
              Your sales intelligence co-pilot
            </span>
          </div>
        </div>
      </div>

      <div className="barry-workspace-thread" ref={threadRef}>
        {conversationTurns.length === 0 ? (
          <div className="barry-workspace-empty">
            <img
              src={ASSETS.barryAvatar}
              alt=""
              className="barry-workspace-empty-avatar"
              width={80}
              height={80}
            />
            <p style={{ color: T.text, fontWeight: 600, fontSize: 18 }}>
              {who?.name ? `Hey ${who.name}!` : 'Hey there!'}
            </p>
            <p style={{ color: T.textMuted, maxWidth: 440, textAlign: 'center', lineHeight: 1.6 }}>
              This is your workspace with Barry. Ask anything about your pipeline,
              contacts, or strategy — your conversation continues wherever you go.
            </p>
          </div>
        ) : (
          conversationTurns.map((turn, i) => (
            <div
              key={turn.id || i}
              className={`barry-workspace-message ${turn.role === 'user' ? 'user' : 'assistant'}`}
            >
              {turn.role === 'assistant' && (
                <img
                  src={ASSETS.barryAvatar}
                  alt=""
                  className="barry-workspace-msg-avatar"
                  width={28}
                  height={28}
                />
              )}
              <div
                className="barry-workspace-msg-bubble"
                style={{
                  background: turn.role === 'user' ? `${BRAND.pink}18` : T.surface,
                  borderColor: turn.role === 'user' ? `${BRAND.pink}30` : T.border,
                  color: T.text,
                }}
              >
                {turn.role === 'assistant' ? (
                  turn.kind && turn.kind !== 'message' ? (
                    <ConversationCard kind={turn.kind}>
                      <ReactMarkdown className="barry-workspace-prose">
                        {turn.content}
                      </ReactMarkdown>
                    </ConversationCard>
                  ) : (
                    <ReactMarkdown className="barry-workspace-prose">
                      {turn.content}
                    </ReactMarkdown>
                  )
                ) : (
                  <p>{turn.content}</p>
                )}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="barry-workspace-message assistant">
            <img
              src={ASSETS.barryAvatar}
              alt=""
              className="barry-workspace-msg-avatar"
              width={28}
              height={28}
            />
            <div
              className="barry-workspace-msg-bubble barry-workspace-typing"
              style={{ background: T.surface, borderColor: T.border }}
            >
              <span className="barry-typing-dot" />
              <span className="barry-typing-dot" />
              <span className="barry-typing-dot" />
            </div>
          </div>
        )}
      </div>

      <div className="barry-workspace-composer" style={{ borderColor: T.border }}>
        <div className="barry-workspace-composer-row">
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
            placeholder="Ask Barry anything..."
            disabled={sending}
            aria-label="Message Barry"
            className="barry-workspace-input"
            style={{
              background: T.surface,
              borderColor: T.border,
              color: T.text,
            }}
          />
          <button
            onClick={() => sendMessage(inputValue)}
            disabled={sending || !inputValue.trim()}
            aria-label="Send message"
            className="barry-workspace-send"
            style={{
              background: inputValue.trim() ? BRAND.pink : T.surface2,
              color: inputValue.trim() ? '#fff' : T.textMuted,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
