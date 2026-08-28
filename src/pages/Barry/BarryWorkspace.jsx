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
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useShell } from '../../context/ShellContext';
import { useLocation } from 'react-router-dom';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS, AUTH_ASSETS } from '../../theme/tokens';
import { appendTurn, loadOrSeedRecentTurns } from '../../utils/barryCanonical';
import { resolveWho } from '../../utils/resolveWho';
import { buildContextStack } from '../../utils/barryContextStack';
import { intentLabel } from '../../utils/firstValueRouting';
import ConversationCard from '../../components/conversation/ConversationCard';
import useFirstExperienceController from '../../hooks/useFirstExperienceController';
import BarryOnboarding from '../Onboarding/BarryOnboarding';
import RelationshipFirstValue from '../../components/onboarding/RelationshipFirstValue';
import CompanyResultsCard from '../../components/onboarding/CompanyResultsCard';
import { useOnboardingState } from '../../hooks/useOnboardingState';
import { calculateICPScore } from '../../utils/icpScoring';
import BarryResultSet from '../../components/barry/BarryResultSet';
import BarryResolutionPreview from '../../components/barry/BarryResolutionPreview';
import { buildCandidatePayloads, mintClientRef } from '../../utils/candidatePayload';
import { holdResultSet, getResultSet, mintSessionRef, releaseResultSet } from '../../utils/barryTransientCandidates';
import { previewSentence, mintOperationId } from '../../utils/resolutionContract';
import { resolveSave, link, linkSentence } from '../../utils/resolveSaveClient';
// NOTE: the mock resolver and its fake people are NOT imported here. They are
// reached only through dynamic import() inside an import.meta.env.DEV branch,
// so a production build drops them from the module graph entirely rather than
// relying on nobody calling them. Production must fail closed.
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
  // Structured-turn UI state. Deliberately local: selection, previews and
  // approval are conversation-scoped interactions, not stored entities.
  // `settled` records that a turn has been acted on so it renders as history
  // instead of staying live.
  const [settled, setSettled] = useState({});   // sessionRef -> {...}
  const [resolving, setResolving] = useState(false);
  // "Put these into Scout" — offered after a successful commit, in-thread.
  const [pendingLink, setPendingLink] = useState(null);
  const [who, setWho] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [contextStack, setContextStack] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [barryMode, setBarryMode] = useState('SUGGEST');

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const onboardingRef = useRef(null);
  const [prospectingBusy, setProspectingBusy] = useState(false);
  const [prospectingStep, setProspectingStep] = useState(null);
  const [resultCompanies, setResultCompanies] = useState(null);
  const resultsDeliveredRef = useRef(false);

  const { barryState, companiesFoundCount } = useOnboardingState();
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

  // First Value: when barryState flips to READY after ICP confirmation,
  // load the top-scoring pending companies and present them conversationally.
  useEffect(() => {
    if (barryState !== 'READY') return;
    if (resultsDeliveredRef.current) return;
    if (!isFirstExperience) return;

    resultsDeliveredRef.current = true;

    (async () => {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) return;

      try {
        const companiesSnap = await getDocs(
          query(collection(db, 'users', user.uid, 'companies'), where('status', '==', 'pending'))
        );

        if (companiesSnap.empty) {
          feCtrl.addTurn({
            role: 'assistant',
            content: "The search finished but didn't find companies that match closely enough. We can refine your targeting — tell me more about who you're looking for, or try a different industry or location.",
          });
          return;
        }

        const icpSnap = await getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'));
        const icpProfile = icpSnap.exists() ? icpSnap.data() : null;

        let scored = companiesSnap.docs.map(d => {
          const data = d.data();
          const score = icpProfile ? calculateICPScore(data, icpProfile) : 50;
          return { ...data, id: d.id, _fitScore: score };
        });

        scored.sort((a, b) => b._fitScore - a._fitScore);
        const top = scored.slice(0, 5);
        setResultCompanies(top);

        const total = companiesSnap.size;
        const resultsMessage = total <= 5
          ? `I found ${total} ${total === 1 ? 'company' : 'companies'} that match what we talked about.`
          : `I found ${total} companies that match what we talked about. Here are a few I think are worth starting with.`;

        feCtrl.addTurn({
          role: 'assistant',
          content: resultsMessage,
          _feCard: 'results',
        });
      } catch (err) {
        console.warn('[BarryWorkspace] First Value results load failed:', err.message);
      }
    })();
  }, [barryState, isFirstExperience]);

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
  }, [conversationTurns, sending, feCtrl.turns, feCtrl.classifying, feCtrl.phase, prospectingBusy, resultCompanies]);

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
      if (isFirstExperience) {
        handleFirstExperienceSubmit();
      } else {
        sendMessage(inputValue);
      }
    }
  }

  function handleFirstExperienceSubmit() {
    if (!inputValue.trim()) return;
    const text = inputValue.trim();
    const delivering = feCtrl.phase === 'delivering';
    const prospecting = delivering && feCtrl.decision?.kind === 'in-place';

    if (prospecting && onboardingRef.current) {
      feCtrl.addTurn({ role: 'user', content: text });
      onboardingRef.current.submit(text);
      setInputValue('');
    } else if (!feCtrl.classifying) {
      feCtrl.handleUserInput(text);
      setInputValue('');
    }
  }

  if (loading) {
    return (
      <div className="barry-workspace">
        <div className="barry-workspace-loading">
          <div className="barry-workspace-loading-avatar">
            <img src={ASSETS.barryAvatar} alt="" width={64} height={64} onError={e => { e.target.style.display = 'none'; }} />
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
    const isBusy = feCtrl.classifying || prospectingBusy;
    const isProspecting = isDelivering && feCtrl.decision?.kind === 'in-place';
    const prospectingReady = isProspecting && prospectingStep && ['asking', 'clarifying'].includes(prospectingStep);
    const placeholder = isProspecting ? 'Tell Barry about your target market...'
      : 'Reply to Barry...';
    const composerDisabled = isBusy || (isDelivering && !isProspecting) || (isProspecting && !prospectingReady);

    return (
      <div className="barry-workspace barry-workspace--first-experience" style={{ background: T.cardBg }}>
        <div className="barry-workspace-header" style={{ borderColor: T.border, background: T.cardBg }}>
          <div className="barry-workspace-header-left">
            <img
              src={ASSETS.barryAvatar}
              alt="Barry"
              className="barry-workspace-avatar"
              width={44}
              height={44}
              onError={e => { e.target.style.display = 'none'; }}
            />
            <div>
              <h1 className="barry-workspace-title" style={{ color: T.text }}>Barry</h1>
              <span className="barry-workspace-subtitle" style={{ color: T.textMuted }}>
                Relationship intelligence, built around you
              </span>
            </div>
          </div>
        </div>

        <div className="barry-fe-layout">
          {/* ── Primary column: hero + conversation + composer ── */}
          <div className="barry-fe-primary">
            <div className="barry-fe-scroll" ref={threadRef}>
              {/* Hero welcome */}
              <div className="barry-fe-hero">
                <h2 className="barry-fe-hero-heading" style={{ color: T.text }}>
                  Welcome to <span style={{ color: BRAND.purple || '#6d4aff' }}>IDYNIFY</span>
                </h2>
                <p className="barry-fe-hero-sub" style={{ color: T.textMuted }}>
                  I'm Barry, the intelligence inside IDYNIFY.
                  <br />
                  I'll help you know who matters, why they matter, and what to do next.
                </p>
              </div>

              {/* Conversation divider */}
              <div className="barry-fe-divider" style={{ borderColor: T.border }}>
                <span className="barry-fe-divider-label" style={{ color: T.textMuted, background: T.cardBg }}>Barry</span>
              </div>

              {/* Conversation thread */}
              <div className="barry-fe-thread">
                {feTurns.map((turn, i) => {
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
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        )}
                        <div
                          className="barry-workspace-msg-bubble"
                          style={{
                            background: turn.role === 'user' ? `${BRAND.pink}12` : T.surface,
                            borderColor: turn.role === 'user' ? `${BRAND.pink}25` : T.border,
                            color: T.text,
                          }}
                        >
                          <p>{turn.content}</p>
                        </div>
                      </div>

                      {hasCard && turn._feCard === 'prospecting' && (
                        <div className="barry-workspace-fe-card">
                          <BarryOnboarding
                            ref={onboardingRef}
                            embedded
                            knownName={feCtrl.who?.name || null}
                            goal={feCtrl.pending?.restatement || null}
                            onBarryMessage={(content) => feCtrl.addTurn({ role: 'assistant', content })}
                            onProcessing={setProspectingBusy}
                            onStepChange={setProspectingStep}
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

                      {hasCard && turn._feCard === 'results' && resultCompanies && (
                        <div className="barry-workspace-fe-card">
                          <CompanyResultsCard
                            companies={resultCompanies}
                            totalCount={companiesFoundCount || resultCompanies.length}
                            onAccept={(company) => {
                              feCtrl.addTurn({
                                role: 'assistant',
                                content: `Got it — I'll keep ${company.name || company.company_name}. We can look at the right people there next.`,
                              });
                            }}
                          />
                          <div className="barry-workspace-fe-actions" style={{ marginTop: 12 }}>
                            <button
                              className="barry-workspace-fe-btn barry-workspace-fe-btn--go"
                              style={{ background: BRAND.pink, color: '#fff' }}
                              onClick={() => navigate('/scout', { state: { activeTab: 'daily-leads' } })}
                            >
                              Review these in Scout
                            </button>
                          </div>
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
                      className="barry-workspace-skip-chip"
                      style={{ color: T.textMuted, borderColor: T.border }}
                    >
                      Skip for now
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
                      onError={e => { e.target.style.display = 'none'; }}
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
            </div>

            {/* Composer — anchored at bottom of primary column */}
            <div className="barry-fe-composer" style={{ borderColor: T.border, background: T.cardBg }}>
              <div className="barry-fe-composer-inner">
                <img
                  src={ASSETS.barryAvatar}
                  alt=""
                  className="barry-fe-composer-avatar"
                  width={36}
                  height={36}
                  onError={e => { e.target.style.display = 'none'; }}
                />
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
                  aria-label="Message Barry"
                  className="barry-workspace-input"
                  style={{
                    background: T.cardBg,
                    borderColor: 'transparent',
                    color: T.text,
                  }}
                />
                <button
                  onClick={handleFirstExperienceSubmit}
                  disabled={composerDisabled || !inputValue.trim()}
                  aria-label="Send"
                  className="barry-workspace-send barry-fe-send"
                  style={{
                    background: inputValue.trim() ? BRAND.pink : T.surface,
                    color: inputValue.trim() ? '#fff' : T.textMuted,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          {/* ── Barry presence column ── */}
          <div className="barry-fe-presence" style={{ background: T.surface }}>
            <picture>
              <source srcSet={AUTH_ASSETS.barry.signup.avif} type="image/avif" />
              <source srcSet={AUTH_ASSETS.barry.signup.webp} type="image/webp" />
              <img
                src={AUTH_ASSETS.barry.signup.png}
                alt={AUTH_ASSETS.barry.signup.alt}
                className="barry-fe-presence-img"
                onError={e => { e.target.style.display = 'none'; }}
              />
            </picture>
          </div>
        </div>
      </div>
    );
  }

  // Post-onboarding (or first-experience controller still loading): conversation UI

  // ── Structured-turn handlers ────────────────────────────────────────────
  // These cross NO persistence boundary. The only writes are canonical
  // conversation turns (Barry talking) — never a Person, Company or Candidate.

  /**
   * @param {boolean} [persist=true]  When false the turn renders in the thread
   *   but is NOT written to Firestore.
   *
   * C2: the dev seed runs against LIVE Firebase — there is one project and it is
   * the production one. Persisting a mocked turn would write a fabricated Barry
   * statement ("I found 8 people who look relevant") into a real user's
   * canonical conversation, where it would be indistinguishable from something
   * Barry actually did. Every turn produced by the mocked flow is therefore
   * local-only; only real turns persist.
   */
  async function appendStructuredTurn({ content, kind, meta, persist = true }) {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    const turn = { role: 'assistant', content, kind, meta, surface: 'workspace' };
    setConversationTurns(prev => [...prev, { ...turn, id: `local_${Date.now()}`, ephemeral: !persist }]);
    if (!persist) return;
    await appendTurn(db, user.uid, turn).catch(err =>
      console.warn('[BarryWorkspace] structured turn append failed:', err.message));
  }

  /**
   * RESOLVE_SAVE — real, Gate 2 Phase 3. The mock is gone from this path.
   *
   * commit:false resolves fully and writes nothing. `resolutions` carries the
   * user's ambiguity answers on the commit pass; on the preview pass it is empty.
   */
  async function callResolveSave({ payloads, operationId, commit, resolutions }) {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) throw new Error('not_authenticated');
    const authToken = await user.getIdToken();
    return resolveSave({
      userId: user.uid,
      authToken,
      operationId,
      candidates: payloads,
      resolutions,
      commit,
      actor: 'user',
    });
  }

  /**
   * User picked people. Build CandidatePayloads and run the resolution dry-run.
   *
   * The payloads are built here and handed straight to the resolver — they are
   * never stored, and no contactId/companyId is minted anywhere on this path.
   */
  async function handleSelectionConfirmed(sessionRef, selectedRefs) {
    const held = getResultSet(sessionRef);
    if (!held || resolving) return;

    setSettled(prev => ({ ...prev, [sessionRef]: { count: selectedRefs.length } }));
    setResolving(true);

    const payloads = buildCandidatePayloads(held.results, selectedRefs, {
      kind: held.kind,
      source: held.source,
    });

    if (import.meta.env.DEV) {
      console.info('[Gate3] CandidatePayload[] emitted to resolver:', payloads);
    }

    // C1: minted ONCE, here. RESOLVE_SAVE is idempotent on operationId, and the
    // commit must be the same operation as the preview the user approved — so
    // this id travels preview → ambiguity answers → approval unchanged. It is
    // deliberately NOT re-minted in handleApprove.
    const operationId = mintOperationId();

    try {
      const preview = await callResolveSave({ payloads, operationId, commit: false, resolutions: {} });

      const previewRef = mintSessionRef();
      holdResultSet({ sessionRef: previewRef, kind: held.kind, source: held.source, results: preview.results });
      // The preview, the payloads it came from, and the operation it belongs to
      // ride together in memory. The payloads are kept because commit re-sends
      // the SAME candidates alongside the user's resolutions.
      // operationId is NOT written to the turn — it identifies a write
      // operation, and a turn records a conversation.
      const stored = getResultSet(previewRef);
      stored.preview = preview;
      stored.payloads = payloads;
      stored.operationId = preview.operationId || operationId;

      await appendStructuredTurn({
        content: previewSentence(preview.summary),
        kind: 'resolution_preview',
        meta: { sessionRef: previewRef, ...preview.summary },   // counts only
      });   // persists: this is a real resolution Barry actually performed
    } catch (err) {
      console.error('[BarryWorkspace] resolve dry-run failed:', err);
      // Say what actually went wrong rather than implying it half-worked.
      // commit:false writes nothing, so "nothing was saved" is literally true.
      await appendStructuredTurn({
        content: err.serverError
          ? `I couldn't check those against your existing people — ${err.serverError}. Nothing was saved.`
          : "I couldn't reach the part of me that checks against your existing people. Nothing was saved — want me to try again?",
        kind: 'message',
      });
    } finally {
      setResolving(false);
    }
  }

  /**
   * Approval. THE PERSISTENCE BOUNDARY STOPS HERE.
   * Team A's RESOLVE_SAVE(commit:true) attaches at this point; until then Barry
   * states plainly that nothing was written rather than implying it was.
   */
  /**
   * Approval → RESOLVE_SAVE(commit:true). THIS IS THE PERSISTENCE BOUNDARY.
   *
   * The same operationId the preview ran under, the same candidates, plus the
   * user's ambiguity answers as `resolutions: { [clientRef]: contactId }`.
   *
   * Every contactId in `resolutions` came from the candidate list the RESOLVER
   * offered for that clientRef — the UI never mints one and never chooses one.
   * The resolver re-validates that the id was actually offered, so a stale or
   * invented answer comes back as ambiguous with a reason rather than writing.
   */
  async function handleApprove(sessionRef, decision) {
    const stored = getResultSet(sessionRef);
    if (!stored || resolving) return;

    const operationId = stored.operationId;
    // decision.choices is { clientRef: contactId | 'neither' }. 'neither' means
    // "none of these is the person" — it is the ABSENCE of a resolution, which
    // lets the resolver fall through to create. It must not be sent as an id.
    const resolutions = {};
    for (const [clientRef, choice] of Object.entries(decision.choices || {})) {
      if (choice && choice !== 'neither') resolutions[clientRef] = choice;
    }

    setResolving(true);
    try {
      const committed = await callResolveSave({
        payloads: stored.payloads,
        operationId,
        commit: true,
        resolutions,
      });

      const s = committed.summary;
      const contactIds = committed.results.map(r => r.contactId).filter(Boolean);

      setSettled(prev => ({ ...prev, [sessionRef]: { approved: true, operationId, contactIds } }));

      // Report what happened, including what did NOT happen. ambiguous and
      // refused are never written, so claiming a clean save would be a lie.
      const parts = [];
      if (s.matched) parts.push(`${s.matched} linked to people you already had`);
      if (s.created) parts.push(`${s.created} added as new`);
      const trailer = [];
      if (s.ambiguous) trailer.push(`${s.ambiguous} I still can't place`);
      if (s.refused) trailer.push(`${s.refused} I couldn't save`);

      await appendStructuredTurn({
        content: parts.length
          ? `Done — ${parts.join(' and ')}.${trailer.length ? ` ${trailer.join(', ')}, so I left ${s.ambiguous + s.refused === 1 ? 'that one' : 'those'} out.` : ''}`
          : `I couldn't save any of those.${trailer.length ? ` ${trailer.join(' and ')}.` : ''}`,
        kind: 'message',
        meta: { matched: s.matched, created: s.created, ambiguous: s.ambiguous, refused: s.refused },
      });

      // Offer the workflow placement as the natural next step, not a new screen.
      if (contactIds.length) {
        holdResultSet({ sessionRef: `${sessionRef}_saved`, kind: 'person', source: 'resolve_save', results: [] });
        const saved = getResultSet(`${sessionRef}_saved`);
        saved.contactIds = contactIds;
        saved.operationId = operationId;
        setPendingLink({ sessionRef: `${sessionRef}_saved`, count: contactIds.length });
      }
    } catch (err) {
      console.error('[BarryWorkspace] commit failed:', err);
      await appendStructuredTurn({
        content: err.serverError
          ? `I couldn't save those — ${err.serverError}.`
          : "I couldn't save those just now. Nothing was written — want me to try again?",
        kind: 'message',
      });
      setSettled(prev => ({ ...prev, [sessionRef]: { approved: false } }));
    } finally {
      setResolving(false);
    }
  }

  /**
   * LINK — "put these into Scout".
   *
   * Scout is a LENS over the canonical person, not a copy. A contact already at
   * the target stage returns changed:false, which is a valid no-op — reporting
   * it as a failure, or reporting the write count, would both be wrong. The
   * sentence describes the FINAL STATE.
   */
  async function handleLinkToScout(sessionRef) {
    const stored = getResultSet(sessionRef);
    if (!stored?.contactIds?.length || resolving) return;

    setPendingLink(null);
    setResolving(true);
    try {
      const user = getEffectiveUser() || auth.currentUser;
      const authToken = await user.getIdToken();
      const res = await link({
        userId: user.uid,
        authToken,
        operationId: stored.operationId,   // same operation, end to end
        contactIds: stored.contactIds,
        targetStage: 'scout',
        actor: 'user',
      });
      releaseResultSet(sessionRef);
      await appendStructuredTurn({
        content: linkSentence(res.summary, res.targetStage),
        kind: 'message',
        meta: { ...res.summary, targetStage: res.targetStage },
      });
    } catch (err) {
      console.error('[BarryWorkspace] link failed:', err);
      await appendStructuredTurn({
        content: err.serverError
          ? `They're saved, but I couldn't move them into Scout — ${err.serverError}.`
          : "They're saved, but I couldn't move them into Scout just now.",
        kind: 'message',
      });
    } finally {
      setResolving(false);
    }
  }

  async function handleCancelPreview(sessionRef) {
    setSettled(prev => ({ ...prev, [sessionRef]: { approved: false } }));
    releaseResultSet(sessionRef);
    await appendStructuredTurn({
      content: "No problem — I haven't saved anything. Tell me when you want to pick these up again.",
      kind: 'message',
    });
  }

  /** DEV ONLY. Seeds a mocked people result set so the flow can be walked. */
  async function seedMockResultSet() {
    if (!import.meta.env.DEV) return;   // unreachable in production by construction
    const { MOCK_PEOPLE, MOCK_SOURCE } = await import('../../utils/mockPersonResults');
    const results = MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));
    const sessionRef = holdResultSet({ kind: 'person', source: MOCK_SOURCE, results });
    await appendStructuredTurn({
      content: `I found ${results.length} people who look relevant.`,
      kind: 'result_set',
      meta: { sessionRef, count: results.length, entity: 'person' },
      // C2: fabricated people must never reach the canonical conversation, and
      // dev runs against live Firebase.
      persist: false,
    });
  }

  return (
    <div className="barry-workspace">
      <div className="barry-workspace-header" style={{ borderColor: T.border }}>
        <div className="barry-workspace-header-left">
          <img
            src={ASSETS.barryAvatar}
            alt="Barry"
            className="barry-workspace-avatar"
            width={44}
            height={44}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <div>
            <h1 className="barry-workspace-title" style={{ color: T.text }}>Barry</h1>
            <span className="barry-workspace-subtitle" style={{ color: T.textMuted }}>
              Relationship intelligence, built around you
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
              onError={e => { e.target.style.display = 'none'; }}
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
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              <div
                className="barry-workspace-msg-bubble"
                style={{
                  background: turn.role === 'user' ? `${BRAND.pink}12` : T.cardBg,
                  borderColor: turn.role === 'user' ? `${BRAND.pink}25` : T.border,
                  color: T.text,
                }}
              >
                {turn.role === 'assistant' ? (
                  turn.kind === 'result_set' ? (
                    <ConversationCard kind={turn.kind}>
                      <ReactMarkdown className="barry-workspace-prose">{turn.content}</ReactMarkdown>
                      <BarryResultSet
                        resultSet={getResultSet(turn.meta?.sessionRef)}
                        disabled={resolving}
                        settled={settled[turn.meta?.sessionRef] || null}
                        onConfirmSelection={(refs) => handleSelectionConfirmed(turn.meta?.sessionRef, refs)}
                      />
                    </ConversationCard>
                  ) : turn.kind === 'resolution_preview' ? (
                    <ConversationCard kind={turn.kind}>
                      <ReactMarkdown className="barry-workspace-prose">{turn.content}</ReactMarkdown>
                      <BarryResolutionPreview
                        preview={getResultSet(turn.meta?.sessionRef)?.preview || null}
                        settled={settled[turn.meta?.sessionRef] || null}
                        onApprove={(d) => handleApprove(turn.meta?.sessionRef, d)}
                        onCancel={() => handleCancelPreview(turn.meta?.sessionRef)}
                      />
                    </ConversationCard>
                  ) : turn.kind && turn.kind !== 'message' ? (
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
              onError={e => { e.target.style.display = 'none'; }}
            />
            <div
              className="barry-workspace-msg-bubble barry-workspace-typing"
              style={{ background: T.cardBg, borderColor: T.border }}
            >
              <span className="barry-typing-dot" />
              <span className="barry-typing-dot" />
              <span className="barry-typing-dot" />
            </div>
          </div>
        )}
      </div>

      {pendingLink && (
        <div className="barry-workspace-linkoffer">
          <button
            type="button"
            onClick={() => handleLinkToScout(pendingLink.sessionRef)}
            disabled={resolving}
            style={{ background: BRAND.pink, color: '#fff' }}
          >
            Put {pendingLink.count === 1 ? 'them' : `all ${pendingLink.count}`} into Scout
          </button>
          <button type="button" className="quiet" onClick={() => setPendingLink(null)} style={{ color: T.textFaint }}>
            Not now
          </button>
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="barry-workspace-devbar">
          <button type="button" onClick={seedMockResultSet} disabled={sending || resolving}>
            dev · seed mocked person results
          </button>
        </div>
      )}

      <div className="barry-workspace-composer" style={{ borderColor: T.border, background: T.cardBg }}>
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
              background: T.cardBg,
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
              background: inputValue.trim() ? BRAND.pink : 'transparent',
              color: inputValue.trim() ? '#fff' : T.textMuted,
              border: inputValue.trim() ? 'none' : `1px solid ${T.border}`,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
