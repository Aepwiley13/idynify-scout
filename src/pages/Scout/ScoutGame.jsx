import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';
import {
  executeSendAction,
  checkGmailConnection,
  CHANNELS,
  SEND_RESULT
} from '../../utils/sendActionResolver';
import { buildAutoIntent, getEngagementIntent, buildContactPayload, GAME_CONSTANTS } from '../../utils/buildAutoIntent';
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

/**
 * SCOUT GAME — Main Page Component
 *
 * Gamified, time-boxed engagement workflow. Additive UI layer (G6) on top
 * of the existing Scout/Hunter system. Zero backend changes (G1).
 *
 * Flow:
 *   1. Session start → user picks mode (one tap)
 *   2. Card stack loads → auto-intent + Barry prefetch
 *   3. Per card: view messages → pick strategy → pick channel → review → send
 *   4. Session summary on exit
 *
 * G8: All sends go through executeSendAction() — identical engagement events.
 */
export default function ScoutGame() {
  const navigate = useNavigate();

  // Game phase: start → playing → engage → review → summary
  const [gamePhase, setGamePhase] = useState('start');

  // Card data
  const [cards, setCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);

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
      const user = auth.currentUser;
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
      loadCards();
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

  // Load pending companies + their contacts — mirrors DailyLeads.jsx:56-67
  const loadCards = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    setLoadingCards(true);
    try {
      // Load pending companies sorted by fit_score
      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);

      const companies = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0))
        .slice(0, GAME_CONSTANTS.DAILY_CARD_LIMIT);

      // Load contacts for each company
      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const cardData = [];

      for (const company of companies) {
        // Find contacts associated with this company
        const contactQuery = query(contactsRef, where('company_name', '==', company.name));
        const contactSnap = await getDocs(contactQuery);
        const contacts = contactSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Use the first contact (highest relevance) or create a minimal card
        const primaryContact = contacts[0] || null;

        cardData.push({
          id: company.id,
          company,
          contact: primaryContact,
          contacts
        });
      }

      setCards(cardData);
    } catch (err) {
      console.error('Error loading game cards:', err);
    } finally {
      setLoadingCards(false);
    }
  }, []);

  // === SESSION LIFECYCLE ===

  const handleSelectMode = async (mode) => {
    session.startSession(mode);
    timer.start();
    setGamePhase('playing');
    await loadCards();
  };

  const handleEndSession = () => {
    const finalElapsed = timer.stop();
    const summary = session.endSession(finalElapsed);
    setGamePhase('summary');
    return summary;
  };

  const handleNewSession = () => {
    session.clearSession();
    setCards([]);
    setGamePhase('start');
    resetEngageState();
  };

  const handleExit = () => {
    session.clearSession();
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
    const cached = prefetch.getMessages(card.id);
    if (!cached?.messages) {
      // Messages not ready — stay on card, they'll load
      return;
    }
    setEngageCard(card);
    setGamePhase('engage');

    // Auto-select default weapon
    const defaultWeapon = getDefaultWeapon(card.contact, gmailConnected);
    if (defaultWeapon) setSelectedWeapon(defaultWeapon);
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
      const user = auth.currentUser;
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
      // Show error but don't crash — user can retry
      setSendLoading(false);
    }
  };

  // === SKIP / DEFER ===

  // G7: Skip = existing reject. updateDoc status: 'rejected' — identical to DailyLeads.jsx:184
  const handleSkip = async (card) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', card.company.id);
      await updateDoc(companyRef, {
        status: 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: 'left'
      });

      session.recordSkip();
      session.advanceCard();
      cardOpenedAt.current = Date.now();

      if (session.cardIndex + 1 >= cards.length) {
        handleEndSession();
      }
    } catch (err) {
      console.error('Error skipping card:', err);
    }
  };

  // Defer: set status: 'deferred' — new value on existing field (CTO approved, G1 compliant)
  const handleDefer = async (card) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', card.company.id);
      await updateDoc(companyRef, {
        status: 'deferred',
        deferredAt: new Date().toISOString()
      });

      session.recordDefer();
      session.advanceCard();
      cardOpenedAt.current = Date.now();

      if (session.cardIndex + 1 >= cards.length) {
        handleEndSession();
      }
    } catch (err) {
      console.error('Error deferring card:', err);
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

      {/* Phase: Start */}
      {gamePhase === 'start' && (
        <GameSessionStart onSelectMode={handleSelectMode} />
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
      {gamePhase === 'engage' && engageCard && (
        <div className="scout-game-engage">
          <button className="scout-game-back-btn" onClick={() => { resetEngageState(); setGamePhase('playing'); }}>
            <ArrowLeft className="w-4 h-4" />
            Back to cards
          </button>

          <div className="scout-game-engage-contact">
            <h3>{engageCard.contact?.firstName} {engageCard.contact?.lastName}</h3>
            <p>{engageCard.contact?.title} at {engageCard.company?.name}</p>
          </div>

          <GameMessageSelector
            messages={prefetch.getMessages(engageCard.id)?.messages}
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
        </div>
      )}

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
