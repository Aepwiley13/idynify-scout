import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import {
  executeSendAction,
  checkGmailConnection,
  CHANNELS,
  SEND_RESULT
} from '../../utils/sendActionResolver';
import {
  buildAutoIntent,
  getEngagementIntent,
  buildContactPayload,
  GAME_CONSTANTS,
  bucketToSessionMode
} from '../../utils/buildAutoIntent';
import useScoutGameSession from '../../hooks/useScoutGameSession';
import useGameTimer from '../../hooks/useGameTimer';
import useGamePrefetch from '../../hooks/useGamePrefetch';
import GameSessionStart from '../../components/scout-game/GameSessionStart';
import GameCardStack from '../../components/scout-game/GameCardStack';
import GameSessionBar from '../../components/scout-game/GameSessionBar';
import GameMessageSelector from '../../components/scout-game/GameMessageSelector';
import GameWeaponSelector, { getDefaultWeapon } from '../../components/scout-game/GameWeaponSelector';
import GameReviewSend from '../../components/scout-game/GameReviewSend';
import GameSessionSummary from '../../components/scout-game/GameSessionSummary';
import { Loader, ArrowLeft } from 'lucide-react';
import './ScoutGame.css';
import { getEffectiveUser } from '../context/ImpersonationContext';

/**
 * SCOUT GAME — Main Page Component (PIVOTED)
 *
 * Data source: All Leads contacts filtered by game_bucket.
 * Cards are individual CONTACTS, not companies.
 * Bucket selection replaces abstract mode selection.
 *
 * Flow:
 *   1. Session start → user picks a bucket with live contact counts
 *   2. Card stack loads contacts from selected bucket
 *   3. Per card: view messages → pick strategy → pick channel → review → send
 *   4. Session summary on exit
 *
 * G8: All sends go through executeSendAction() — identical engagement events.
 */
export default function ScoutGame() {
  const navigate = useNavigate();

  // Game phase: start → playing → engage → review → summary
  const [gamePhase, setGamePhase] = useState('start');

  // Card data — now individual contacts, not companies
  const [cards, setCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);

  // Selected bucket for current session
  const [selectedBucket, setSelectedBucket] = useState(null);

  // Engagement flow state (per-card, ephemeral)
  const [engageCard, setEngageCard] = useState(null);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState(null);
  const [selectedWeapon, setSelectedWeapon] = useState(null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const cardOpenedAt = useRef(null);

  // Hooks
  const session = useScoutGameSession();
  const timer = useGameTimer();
  const prefetch = useGamePrefetch(cards, session.sessionMode);

  // Check Gmail connection on mount
  useEffect(() => {
    const check = async () => {
      const user = getEffectiveUser();
      if (!user) return;
      try {
        const status = await checkGmailConnection(user.uid);
        setGmailConnected(status.connected);
      } catch {
        setGmailConnected(false);
      }
    };
    check();
  }, []);

  // Try to restore existing session on mount
  useEffect(() => {
    const restored = session.restoreSession();
    if (restored) {
      timer.restore();
      setGamePhase('playing');
      // Restore bucket from localStorage
      const storedBucket = localStorage.getItem('scout_game_bucket');
      if (storedBucket) {
        setSelectedBucket(storedBucket);
        loadCards(storedBucket);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track card open time for engagement duration
  useEffect(() => {
    if (gamePhase === 'playing') {
      cardOpenedAt.current = Date.now();
    }
  }, [gamePhase, session.cardIndex]);

  // Check prefetch refill when card index changes
  useEffect(() => {
    if (session.isActive) {
      prefetch.checkRefill(session.cardIndex);
    }
  }, [session.cardIndex, session.isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Load contacts from the selected bucket.
   * NEW DATA SOURCE: contacts where game_bucket == selectedBucket
   * Filtered client-side: exclude contacts with message_sent event
   * Ordered by: created_at desc (newest saved leads first)
   */
  const loadCards = useCallback(async (bucketId) => {
    const user = getEffectiveUser();
    if (!user) return;

    setLoadingCards(true);
    try {
      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const snapshot = await getDocs(contactsRef);

      const allContacts = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.game_bucket === bucketId);

      // Filter out engaged contacts (those with message_sent in activity_log)
      const readyContacts = allContacts.filter(c => {
        if (!c.activity_log || c.activity_log.length === 0) return true;
        return !c.activity_log.some(e =>
          e.type === 'message_sent' || e.type === 'email_sent'
        );
      });

      // Order by created_at desc (newest saved leads first)
      readyContacts.sort((a, b) => {
        const dateA = a.saved_at || a.addedAt || a.created_at || '';
        const dateB = b.saved_at || b.addedAt || b.created_at || '';
        return String(dateB).localeCompare(String(dateA));
      });

      // Limit to DAILY_CARD_LIMIT
      const limited = readyContacts.slice(0, GAME_CONSTANTS.DAILY_CARD_LIMIT);

      // Build card data — cards are now contacts, not companies
      // Each card needs: id, contact, company (optional lookup data)
      const cardData = limited.map(contact => ({
        id: contact.id,
        contact,
        company: {
          name: contact.company_name || contact.current_company_name || '',
          industry: contact.company_industry || contact.industry || '',
          id: contact.company_id || null
        },
        contacts: [contact]
      }));

      setCards(cardData);
    } catch (err) {
      console.error('Error loading game cards:', err);
    } finally {
      setLoadingCards(false);
    }
  }, []);

  // === SESSION LIFECYCLE ===

  const handleSelectBucket = async (bucketId) => {
    const sessionMode = bucketToSessionMode(bucketId);
    setSelectedBucket(bucketId);
    localStorage.setItem('scout_game_bucket', bucketId);
    session.startSession(sessionMode);
    timer.start();
    setGamePhase('playing');
    await loadCards(bucketId);
  };

  const handleEndSession = () => {
    const finalElapsed = timer.stop();
    const summary = session.endSession(finalElapsed);
    setGamePhase('summary');
    return summary;
  };

  const handleNewSession = () => {
    session.clearSession();
    localStorage.removeItem('scout_game_bucket');
    setSelectedBucket(null);
    setCards([]);
    setGamePhase('start');
    resetEngageState();
  };

  const handleExit = () => {
    session.clearSession();
    localStorage.removeItem('scout_game_bucket');
    navigate('/scout');
  };

  // === ENGAGEMENT FLOW ===

  const resetEngageState = () => {
    setEngageCard(null);
    setSelectedStrategyIdx(null);
    setSelectedWeapon(null);
    setMessage('');
    setSubject('');
    setSendLoading(false);
  };

  const handleEngage = (card) => {
    setEngageCard(card);
    setGamePhase('engage');

    // Pre-select message and weapon if messages are ready
    const cached = prefetch.getMessages(card.id);
    if (cached?.messages) {
      // Auto-select default weapon
      const defaultWeapon = getDefaultWeapon(card.contact, gmailConnected);
      if (defaultWeapon) setSelectedWeapon(defaultWeapon);
    }
  };

  const handleSelectStrategy = (idx) => {
    setSelectedStrategyIdx(idx);
    const cached = prefetch.getMessages(engageCard?.id);
    const msg = cached?.messages?.[idx];
    if (msg) {
      setMessage(msg.message || '');
      setSubject(msg.subject || '');
    }
  };

  const handleGoToReview = () => {
    if (selectedStrategyIdx === null || !selectedWeapon) return;
    setGamePhase('review');
  };

  const handleBackFromReview = () => {
    setGamePhase('engage');
  };

  // G8: Send via executeSendAction — identical to HunterContactDrawer.jsx:352-362
  const handleSend = async () => {
    if (!engageCard || !message) return;
    setSendLoading(true);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const channelMap = {
        email: CHANNELS.EMAIL,
        text: CHANNELS.TEXT,
        call: CHANNELS.CALL,
        linkedin: CHANNELS.LINKEDIN
      };

      const channel = channelMap[selectedWeapon];
      if (!channel) throw new Error('Invalid weapon');

      const contact = engageCard.contact;
      const userIntent = buildAutoIntent(contact || {}, engageCard.company || {}, session.sessionMode);
      const engagementIntent = getEngagementIntent(session.sessionMode);
      const cached = prefetch.getMessages(engageCard.id);
      const strategyLabel = cached?.messages?.[selectedStrategyIdx]?.strategy || 'direct';

      // executeSendAction — same call as HunterContactDrawer.jsx:353-362
      await executeSendAction({
        channel,
        userId: user.uid,
        contact,
        subject,
        body: message,
        userIntent,
        engagementIntent,
        strategy: strategyLabel
      });

      // Update engagement intent on contact (mirrors HunterContactDrawer:368-370)
      if (contact?.id) {
        await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
          engagementIntent
        });
      }

      // Record engagement metrics
      const durationMs = cardOpenedAt.current ? Date.now() - cardOpenedAt.current : 0;
      session.recordEngagement(durationMs);

      // Advance to next card
      session.advanceCard();
      resetEngageState();
      setGamePhase('playing');
      cardOpenedAt.current = Date.now();

      // Check if we've completed all cards
      if (session.cardIndex + 1 >= cards.length) {
        handleEndSession();
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setSendLoading(false);
    }
  };

  // === SKIP / DEFER ===

  /**
   * SKIP — Soft defer. Moves contact to end of in-memory queue.
   * Does NOT reject or write any permanent status change.
   * Increments skip_count on the contact for analytics.
   */
  const handleSkip = async (card) => {
    const user = getEffectiveUser();
    if (!user) return;

    try {
      // Increment skip_count on contact (lightweight, non-blocking)
      if (card.contact?.id) {
        const contactRef = doc(db, 'users', user.uid, 'contacts', card.contact.id);
        updateDoc(contactRef, {
          skip_count: (card.contact.skip_count || 0) + 1
        }).catch(() => {}); // Non-blocking
      }

      // Move card to end of in-memory array (soft defer)
      setCards(prev => {
        const newCards = [...prev];
        const currentIdx = session.cardIndex;
        if (currentIdx < newCards.length) {
          const [skipped] = newCards.splice(currentIdx, 1);
          newCards.push(skipped);
        }
        return newCards;
      });

      session.recordSkip();
      cardOpenedAt.current = Date.now();

      // Check if we've cycled through all cards
      if (session.cardIndex >= cards.length - 1) {
        handleEndSession();
      }
    } catch (err) {
      console.error('Error skipping card:', err);
    }
  };

  // Defer: save for later — unchanged behavior
  const handleDefer = async (card) => {
    session.recordDefer();
    session.advanceCard();
    cardOpenedAt.current = Date.now();

    if (session.cardIndex + 1 >= cards.length) {
      handleEndSession();
    }
  };

  // Intent override — invalidate prefetched messages and re-fetch
  const handleIntentOverride = (cardId, newIntent) => {
    prefetch.invalidateCard(cardId);
  };

  // === RENDER ===

  // Loading state
  if (loadingCards && gamePhase !== 'start') {
    return (
      <div className="scout-game-page">
        <div className="scout-game-loading">
          <Loader className="w-6 h-6 spin" />
          <p>Loading your card stack...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scout-game-page">
      {/* Session bar (visible during play + engage + review) */}
      {session.isActive && gamePhase !== 'start' && gamePhase !== 'summary' && (
        <GameSessionBar
          displayTime={timer.getDisplayTime()}
          elapsed={timer.elapsed}
          engagements={session.engagements}
          streak={session.currentStreak}
          isPaused={timer.isPaused}
        />
      )}

      {/* Phase: Start — Live bucket cards */}
      {gamePhase === 'start' && (
        <GameSessionStart onSelectBucket={handleSelectBucket} />
      )}

      {/* Phase: Playing (card stack) */}
      {gamePhase === 'playing' && (
        <div className="scout-game-play">
          <GameCardStack
            cards={cards}
            currentIndex={session.cardIndex}
            prefetchBuffer={prefetch.buffer}
            sessionMode={session.sessionMode}
            onEngage={handleEngage}
            onSkip={handleSkip}
            onDefer={handleDefer}
            onIntentOverride={handleIntentOverride}
          />

          {/* End session button */}
          <button className="scout-game-end-btn" onClick={handleEndSession}>
            End Session
          </button>
        </div>
      )}

      {/* Phase: Engage (message selection + weapon selection) */}
      {gamePhase === 'engage' && engageCard && (() => {
        const cached = prefetch.getMessages(engageCard.id);
        const messagesReady = cached?.messages && cached.messages.length > 0;
        const hasError = cached?.error;

        return (
          <div className="scout-game-engage">
            <button className="scout-game-back-btn" onClick={() => { resetEngageState(); setGamePhase('playing'); }}>
              <ArrowLeft className="w-4 h-4" />
              Back to cards
            </button>

            <div className="scout-game-engage-contact">
              <h3>{engageCard.contact?.name || `${engageCard.contact?.firstName || ''} ${engageCard.contact?.lastName || ''}`.trim() || 'Contact'}</h3>
              <p>{engageCard.contact?.title} at {engageCard.company?.name}</p>
            </div>

            {/* Messages loading */}
            {!messagesReady && !hasError && (
              <div className="game-card-loading">
                <Loader className="w-5 h-5 spin" />
                <span>Barry is preparing messages...</span>
              </div>
            )}

            {/* Error state — Edge Case 1 & 7 */}
            {hasError && (
              <div className="game-card-error">
                <span>{cached.error}</span>
                <button className="game-card-retry-btn" onClick={() => prefetch.retryCard(engageCard.id)}>
                  Retry
                </button>
              </div>
            )}

            {/* Messages ready */}
            {messagesReady && (
              <>
                <GameMessageSelector
                  messages={cached.messages}
                  selectedStrategy={selectedStrategyIdx}
                  onSelect={handleSelectStrategy}
                />

                <GameWeaponSelector
                  contact={engageCard.contact}
                  selectedWeapon={selectedWeapon}
                  onSelect={setSelectedWeapon}
                  gmailConnected={gmailConnected}
                />

                {/* Proceed to review */}
                <button
                  className="scout-game-review-btn"
                  onClick={handleGoToReview}
                  disabled={selectedStrategyIdx === null || !selectedWeapon}
                >
                  Review & Send
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* Phase: Review + Send */}
      {gamePhase === 'review' && engageCard && (
        <GameReviewSend
          message={message}
          subject={subject}
          weapon={selectedWeapon}
          contact={engageCard.contact}
          gmailConnected={gmailConnected}
          loading={sendLoading}
          onMessageChange={setMessage}
          onSubjectChange={setSubject}
          onSend={handleSend}
          onBack={handleBackFromReview}
        />
      )}

      {/* Phase: Summary */}
      {gamePhase === 'summary' && (
        <GameSessionSummary
          engagements={session.engagements}
          elapsed={timer.elapsed}
          bestStreak={session.bestStreak}
          fastest={session.fastestEngagement}
          average={session.averageEngagement}
          skipped={session.skipped}
          deferred={session.deferred}
          goalReached={session.engagements >= GAME_CONSTANTS.SESSION_GOAL}
          onNewSession={handleNewSession}
          onExit={handleExit}
        />
      )}
    </div>
  );
}
