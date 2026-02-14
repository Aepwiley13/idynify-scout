import { useState, useCallback, useRef, useEffect } from 'react';
import { auth } from '../firebase/config';
import { buildAutoIntent, buildContactPayload, getEngagementIntent, GAME_CONSTANTS } from '../utils/buildAutoIntent';

/**
 * useGamePrefetch — Background Barry message pre-generation.
 *
 * This is the performance unlock. With ~120s per engagement and 3-8s Barry
 * generation, a 10-card prefetch buffer provides ~1200s of runway — messages
 * are always ready before the user sees the card.
 *
 * CTO WARNING: "The prefetch buffer is the most architecturally novel piece.
 * Watch for: message cache invalidation on intent override, concurrent Barry
 * calls exceeding 3 simultaneous, buffer behavior on session resume."
 *
 * Backpressure: MAX_CONCURRENT_BARRY_CALLS limits parallel API calls.
 * Cache invalidation: invalidateCard() clears and re-fetches on override.
 * Session resume: Don't re-fetch cards that already have cached messages.
 */
export default function useGamePrefetch(cards, sessionMode) {
  // Map<cardId, { messages: Array | null, error: string | null }>
  const [buffer, setBuffer] = useState(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const activeCallsRef = useRef(0);
  const queueRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Generate messages for a single card
  const fetchSingleCard = useCallback(async (card) => {
    const user = auth.currentUser;
    if (!user) return { cardId: card.id, messages: null, error: 'Not authenticated' };

    try {
      const authToken = await user.getIdToken();
      const intent = buildAutoIntent(card.contact || {}, card.company || {}, sessionMode);
      const contactPayload = buildContactPayload(card.contact || {});
      const engagementIntent = getEngagementIntent(sessionMode);

      // Call generate-engagement-message — identical to HunterContactDrawer.jsx:251-274
      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: card.contact?.id || null,
          userIntent: intent,
          engagementIntent,
          barryContext: card.contact?.barryContext,
          contact: contactPayload
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { cardId: card.id, messages: null, error: errorData.error || 'Generation failed' };
      }

      const data = await response.json();

      if (data.success && data.messages && data.messages.length >= 3) {
        return { cardId: card.id, messages: data.messages, error: null };
      }

      return { cardId: card.id, messages: null, error: 'Barry returned insufficient messages' };
    } catch (err) {
      return { cardId: card.id, messages: null, error: err.message };
    }
  }, [sessionMode]);

  // Process queue with backpressure
  const processQueue = useCallback(async () => {
    while (queueRef.current.length > 0 && activeCallsRef.current < GAME_CONSTANTS.MAX_CONCURRENT_BARRY_CALLS) {
      const card = queueRef.current.shift();
      if (!card) break;

      // Skip if already in buffer (don't re-fetch on session resume)
      if (buffer.has(card.id)) continue;

      activeCallsRef.current++;
      setIsLoading(true);

      fetchSingleCard(card).then((result) => {
        activeCallsRef.current--;

        if (mountedRef.current) {
          setBuffer(prev => {
            const next = new Map(prev);
            next.set(result.cardId, {
              messages: result.messages,
              error: result.error
            });
            return next;
          });

          // Continue processing queue
          processQueue();
        }
      });
    }

    // Check if all done
    if (queueRef.current.length === 0 && activeCallsRef.current === 0) {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [buffer, fetchSingleCard]);

  // Prefetch a batch of cards
  const prefetchBatch = useCallback((startIndex, count) => {
    if (!cards || cards.length === 0) return;

    const batch = cards.slice(startIndex, startIndex + count);
    const newCards = batch.filter(card => !buffer.has(card.id));

    if (newCards.length === 0) return;

    queueRef.current.push(...newCards);
    processQueue();
  }, [cards, buffer, processQueue]);

  // Initial prefetch on mount / cards change
  useEffect(() => {
    if (cards && cards.length > 0 && sessionMode) {
      prefetchBatch(0, GAME_CONSTANTS.PREFETCH_BATCH_SIZE);
    }
  }, [cards, sessionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get messages for a specific card
  const getMessages = useCallback((cardId) => {
    return buffer.get(cardId) || null;
  }, [buffer]);

  // Retry a failed card
  const retryCard = useCallback(async (cardId) => {
    const card = cards?.find(c => c.id === cardId);
    if (!card) return;

    // Remove from buffer so it can be re-fetched
    setBuffer(prev => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });

    queueRef.current.push(card);
    processQueue();
  }, [cards, processQueue]);

  // Invalidate a card (for intent override) and re-fetch
  const invalidateCard = useCallback((cardId) => {
    setBuffer(prev => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });

    const card = cards?.find(c => c.id === cardId);
    if (card) {
      queueRef.current.unshift(card); // Priority: put at front of queue
      processQueue();
    }
  }, [cards, processQueue]);

  // Check if we need to refill buffer based on current card index
  const checkRefill = useCallback((currentIndex) => {
    if (!cards) return;

    const remaining = cards.length - currentIndex;
    const buffered = Array.from(buffer.keys()).filter(id => {
      const idx = cards.findIndex(c => c.id === id);
      return idx >= currentIndex;
    }).length;

    if (buffered < GAME_CONSTANTS.PREFETCH_REFILL_THRESHOLD && remaining > buffered) {
      const nextStart = currentIndex + buffered;
      prefetchBatch(nextStart, GAME_CONSTANTS.PREFETCH_REFILL_BATCH);
    }
  }, [cards, buffer, prefetchBatch]);

  return {
    buffer,
    isLoading,
    getMessages,
    retryCard,
    invalidateCard,
    checkRefill,
    prefetchProgress: {
      loaded: buffer.size,
      total: cards?.length || 0
    }
  };
}
