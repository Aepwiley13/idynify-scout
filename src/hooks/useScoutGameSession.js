import { useState, useCallback } from 'react';
import { GAME_CONSTANTS } from '../utils/buildAutoIntent';

const LS_PREFIX = 'scout_game_';

const LS_KEYS = {
  SESSION_ID: `${LS_PREFIX}session_id`,
  SESSION_MODE: `${LS_PREFIX}session_mode`,
  CARD_INDEX: `${LS_PREFIX}card_index`,
  ENGAGEMENTS: `${LS_PREFIX}engagements`,
  STREAK: `${LS_PREFIX}streak`,
  BEST_STREAK: `${LS_PREFIX}best_streak`,
  FASTEST_MS: `${LS_PREFIX}fastest_ms`,
  TIMINGS: `${LS_PREFIX}timings`,
  SKIPPED: `${LS_PREFIX}skipped`,
  DEFERRED: `${LS_PREFIX}deferred`
};

function generateSessionId() {
  return `sg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lsGet(key, fallback) {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  if (typeof fallback === 'number') return parseInt(val, 10) || fallback;
  return val;
}

function lsSet(key, value) {
  localStorage.setItem(key, String(value));
}

/**
 * useScoutGameSession — Manages all session state in localStorage + React state.
 *
 * Per discovery doc Section 8C:
 * - Card position, engagement count, streaks persist via localStorage
 * - Per-card ephemeral state (selected strategy, weapon) stays in React state at component level
 * - Session clears on explicit end
 *
 * Per CTO directive: "Do not start P4 before P1 and P2 are solid."
 */
export default function useScoutGameSession() {
  const [sessionId, setSessionId] = useState(null);
  const [sessionMode, setSessionMode] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [engagements, setEngagements] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [fastestEngagement, setFastestEngagement] = useState(Infinity);
  const [skipped, setSkipped] = useState(0);
  const [deferred, setDeferred] = useState(0);
  const [timings, setTimings] = useState([]);

  // Average engagement time in ms
  const averageEngagement = timings.length > 0
    ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)
    : 0;

  // Start a new session
  const startSession = useCallback((mode) => {
    const id = generateSessionId();

    // Persist to localStorage
    lsSet(LS_KEYS.SESSION_ID, id);
    lsSet(LS_KEYS.SESSION_MODE, mode);
    lsSet(LS_KEYS.CARD_INDEX, 0);
    lsSet(LS_KEYS.ENGAGEMENTS, 0);
    lsSet(LS_KEYS.STREAK, 0);
    lsSet(LS_KEYS.BEST_STREAK, 0);
    lsSet(LS_KEYS.FASTEST_MS, '');
    lsSet(LS_KEYS.TIMINGS, '[]');
    lsSet(LS_KEYS.SKIPPED, 0);
    lsSet(LS_KEYS.DEFERRED, 0);

    // Set React state
    setSessionId(id);
    setSessionMode(mode);
    setIsActive(true);
    setCardIndex(0);
    setEngagements(0);
    setCurrentStreak(0);
    setBestStreak(0);
    setFastestEngagement(Infinity);
    setSkipped(0);
    setDeferred(0);
    setTimings([]);
  }, []);

  // Record a completed engagement
  const recordEngagement = useCallback((durationMs) => {
    setEngagements(prev => {
      const next = prev + 1;
      lsSet(LS_KEYS.ENGAGEMENTS, next);
      return next;
    });

    setCurrentStreak(prev => {
      const next = prev + 1;
      lsSet(LS_KEYS.STREAK, next);

      // Update best streak if needed
      setBestStreak(best => {
        const newBest = Math.max(best, next);
        lsSet(LS_KEYS.BEST_STREAK, newBest);
        return newBest;
      });

      return next;
    });

    if (typeof durationMs === 'number' && durationMs > 0) {
      setFastestEngagement(prev => {
        const next = Math.min(prev, durationMs);
        if (next !== Infinity) lsSet(LS_KEYS.FASTEST_MS, next);
        return next;
      });

      setTimings(prev => {
        const next = [...prev, durationMs];
        lsSet(LS_KEYS.TIMINGS, JSON.stringify(next));
        return next;
      });
    }
  }, []);

  // Record a skip
  const recordSkip = useCallback(() => {
    setCurrentStreak(0);
    lsSet(LS_KEYS.STREAK, 0);

    setSkipped(prev => {
      const next = prev + 1;
      lsSet(LS_KEYS.SKIPPED, next);
      return next;
    });
  }, []);

  // Record a defer
  const recordDefer = useCallback(() => {
    // Defer does not break streak (it's "save for later", not "reject")
    setDeferred(prev => {
      const next = prev + 1;
      lsSet(LS_KEYS.DEFERRED, next);
      return next;
    });
  }, []);

  // Advance to next card
  const advanceCard = useCallback(() => {
    setCardIndex(prev => {
      const next = prev + 1;
      lsSet(LS_KEYS.CARD_INDEX, next);
      return next;
    });
  }, []);

  // Restore session from localStorage (returns true if session restored)
  const restoreSession = useCallback(() => {
    const storedId = localStorage.getItem(LS_KEYS.SESSION_ID);
    if (!storedId) return false;

    const storedMode = localStorage.getItem(LS_KEYS.SESSION_MODE);
    if (!storedMode) return false;

    const storedTimings = (() => {
      try { return JSON.parse(localStorage.getItem(LS_KEYS.TIMINGS) || '[]'); }
      catch { return []; }
    })();

    const storedFastest = parseInt(localStorage.getItem(LS_KEYS.FASTEST_MS) || '', 10);

    setSessionId(storedId);
    setSessionMode(storedMode);
    setIsActive(true);
    setCardIndex(lsGet(LS_KEYS.CARD_INDEX, 0));
    setEngagements(lsGet(LS_KEYS.ENGAGEMENTS, 0));
    setCurrentStreak(lsGet(LS_KEYS.STREAK, 0));
    setBestStreak(lsGet(LS_KEYS.BEST_STREAK, 0));
    setFastestEngagement(isNaN(storedFastest) ? Infinity : storedFastest);
    setSkipped(lsGet(LS_KEYS.SKIPPED, 0));
    setDeferred(lsGet(LS_KEYS.DEFERRED, 0));
    setTimings(storedTimings);

    return true;
  }, []);

  // End session and return summary
  const endSession = useCallback((finalElapsedMs) => {
    const summary = {
      sessionId,
      sessionMode,
      engagements,
      skipped,
      deferred,
      bestStreak,
      fastestEngagement: fastestEngagement === Infinity ? null : fastestEngagement,
      averageEngagement: timings.length > 0
        ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)
        : null,
      elapsed: finalElapsedMs,
      goalReached: engagements >= GAME_CONSTANTS.SESSION_GOAL
    };

    setIsActive(false);
    return summary;
  }, [sessionId, sessionMode, engagements, skipped, deferred, bestStreak, fastestEngagement, timings]);

  // Clear all session data from localStorage
  const clearSession = useCallback(() => {
    Object.values(LS_KEYS).forEach(key => localStorage.removeItem(key));
    // Also clear timer keys
    localStorage.removeItem('scout_game_session_start');
    localStorage.removeItem('scout_game_pause_duration');
    localStorage.removeItem('scout_game_last_active');

    setSessionId(null);
    setSessionMode(null);
    setIsActive(false);
    setCardIndex(0);
    setEngagements(0);
    setCurrentStreak(0);
    setBestStreak(0);
    setFastestEngagement(Infinity);
    setSkipped(0);
    setDeferred(0);
    setTimings([]);
  }, []);

  return {
    // State
    sessionId,
    sessionMode,
    isActive,
    cardIndex,
    engagements,
    currentStreak,
    bestStreak,
    fastestEngagement: fastestEngagement === Infinity ? null : fastestEngagement,
    averageEngagement,
    skipped,
    deferred,
    goal: GAME_CONSTANTS.SESSION_GOAL,
    timeLimit: GAME_CONSTANTS.SESSION_WINDOW_MINUTES * 60 * 1000,

    // Actions
    startSession,
    recordEngagement,
    recordSkip,
    recordDefer,
    advanceCard,
    endSession,
    restoreSession,
    clearSession
  };
}
