import { useState, useEffect, useCallback, useRef } from 'react';

const LS_KEYS = {
  START: 'scout_game_session_start',
  PAUSE_DURATION: 'scout_game_pause_duration',
  LAST_ACTIVE: 'scout_game_last_active'
};

/**
 * useGameTimer — Session timer with pause/resume via visibilitychange.
 *
 * Timer pauses when the app goes to background and resumes on return.
 * State persists in localStorage so it survives page refresh.
 *
 * Implementation per discovery doc Section 8D/8E:
 *   elapsed = (Date.now() - sessionStart) - accumulatedPauseTime
 */
export default function useGameTimer() {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  // Calculate elapsed time from localStorage values
  const calcElapsed = useCallback(() => {
    const startStr = localStorage.getItem(LS_KEYS.START);
    if (!startStr) return 0;

    const startMs = new Date(startStr).getTime();
    const pauseMs = parseInt(localStorage.getItem(LS_KEYS.PAUSE_DURATION) || '0', 10);
    return Math.max(0, Date.now() - startMs - pauseMs);
  }, []);

  // Tick: update elapsed every second
  const startTicking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setElapsed(calcElapsed());
    }, 1000);
  }, [calcElapsed]);

  const stopTicking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Start the timer
  const start = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(LS_KEYS.START, now);
    localStorage.setItem(LS_KEYS.PAUSE_DURATION, '0');
    localStorage.removeItem(LS_KEYS.LAST_ACTIVE);
    setIsRunning(true);
    setIsPaused(false);
    setElapsed(0);
    startTicking();
  }, [startTicking]);

  // Stop the timer and clean up
  const stop = useCallback(() => {
    const finalElapsed = calcElapsed();
    stopTicking();
    setIsRunning(false);
    setIsPaused(false);
    setElapsed(finalElapsed);
    return finalElapsed;
  }, [calcElapsed, stopTicking]);

  // Restore timer from localStorage (e.g., after page refresh)
  const restore = useCallback(() => {
    const startStr = localStorage.getItem(LS_KEYS.START);
    if (!startStr) return false;

    setIsRunning(true);
    setIsPaused(document.hidden);
    setElapsed(calcElapsed());
    if (!document.hidden) startTicking();
    return true;
  }, [calcElapsed, startTicking]);

  // Format elapsed ms as "MM:SS"
  const getDisplayTime = useCallback(() => {
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [elapsed]);

  // Visibility change handler — pause on hidden, resume on visible
  useEffect(() => {
    const handler = () => {
      if (!localStorage.getItem(LS_KEYS.START)) return;

      if (document.hidden) {
        // Pause: record when we went inactive
        localStorage.setItem(LS_KEYS.LAST_ACTIVE, new Date().toISOString());
        stopTicking();
        setIsPaused(true);
      } else {
        // Resume: add pause duration
        const lastActive = localStorage.getItem(LS_KEYS.LAST_ACTIVE);
        if (lastActive) {
          const pauseMs = Date.now() - new Date(lastActive).getTime();
          const accumulated = parseInt(localStorage.getItem(LS_KEYS.PAUSE_DURATION) || '0', 10);
          localStorage.setItem(LS_KEYS.PAUSE_DURATION, String(accumulated + pauseMs));
          localStorage.removeItem(LS_KEYS.LAST_ACTIVE);
        }
        setIsPaused(false);
        setElapsed(calcElapsed());
        startTicking();
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      stopTicking();
    };
  }, [calcElapsed, startTicking, stopTicking]);

  return {
    elapsed,
    isRunning,
    isPaused,
    start,
    stop,
    restore,
    getDisplayTime
  };
}
