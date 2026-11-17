/**
 * useCardDraft — the My Card editor's draft, held in memory.
 *
 * A thin hook over cardDraftReducer. It reads nothing, writes nothing and
 * knows no route; the page that uses it decides when to start the draft
 * (after the card has loaded), what a Save does, and calls `reset(card)` with
 * the saved card afterwards.
 */
import { useCallback, useMemo, useReducer } from 'react';
import { cardDraftReducer, createDraft, isDirty, isValid, visibleErrors } from './cardDraft';

/**
 * @param {object|null} initialCard  where the draft starts (a loaded card, or a new one).
 *   Read once: to start over from another card, call `reset(card)`.
 */
export function useCardDraft(initialCard) {
  const [state, dispatch] = useReducer(cardDraftReducer, initialCard, createDraft);

  const actions = useMemo(() => ({
    edit: (field, value) => dispatch({ type: 'edit', field, value }),
    blur: (field) => dispatch({ type: 'blur', field }),
    setShare: (field, value) => dispatch({ type: 'share', field, value }),
    useSuggestion: (field, suggestion) => dispatch({ type: 'useSuggestion', field, suggestion }),
    showAllErrors: () => dispatch({ type: 'showAllErrors' }),
    reset: (card) => dispatch({ type: 'reset', card }),
  }), []);

  const errors = useMemo(() => visibleErrors(state), [state]);
  const dirty = useMemo(() => isDirty(state), [state]);
  const valid = useMemo(() => isValid(state), [state]);
  const reset = useCallback((card) => actions.reset(card), [actions]);

  return { card: state.card, errors, dirty, valid, ...actions, reset };
}

export default useCardDraft;
