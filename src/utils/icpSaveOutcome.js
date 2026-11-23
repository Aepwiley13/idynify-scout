/**
 * What saving an ICP actually did about discovery (#006.2).
 *
 * ICP Settings starts a search on save only when the profile is the ACTIVE one,
 * its targeting criteria changed, and no save-triggered search is already in
 * flight (handleSaveChanges). The message has to say which of those happened;
 * it used to say "Click Refresh Results to fetch new companies" every time,
 * including when a search had just started.
 */
export const SAVE_OUTCOME = Object.freeze({
  SEARCH_STARTED: 'search_started',
  SEARCH_ALREADY_RUNNING: 'search_already_running',
  SEARCH_FINISHED: 'search_finished',
  SEARCH_FAILED: 'search_failed',
  NO_TARGETING_CHANGE: 'no_targeting_change',
  PROFILE_NOT_ACTIVE: 'profile_not_active',
});

export function saveOutcomeFor({ isActiveProfile, changed, searchAlreadyRunning }) {
  if (!isActiveProfile) return SAVE_OUTCOME.PROFILE_NOT_ACTIVE;
  if (!changed) return SAVE_OUTCOME.NO_TARGETING_CHANGE;
  if (searchAlreadyRunning) return SAVE_OUTCOME.SEARCH_ALREADY_RUNNING;
  return SAVE_OUTCOME.SEARCH_STARTED;
}

export const SAVE_OUTCOME_COPY = Object.freeze({
  [SAVE_OUTCOME.SEARCH_STARTED]: { tone: 'success', link: true, text: 'Saved. Barry has started finding companies with your new targeting.' },
  [SAVE_OUTCOME.SEARCH_ALREADY_RUNNING]: { tone: 'success', link: true, text: 'Saved. Barry is already searching; your changes will apply to the next search.' },
  [SAVE_OUTCOME.SEARCH_FINISHED]: { tone: 'success', link: true, text: 'Saved. Barry finished searching with your new targeting.' },
  [SAVE_OUTCOME.SEARCH_FAILED]: { tone: 'error', link: false, text: "Saved, but Barry couldn't complete the search. Use Refresh Results to try again." },
  [SAVE_OUTCOME.NO_TARGETING_CHANGE]: { tone: 'success', link: false, text: 'Saved. Your targeting didn’t change, so Barry didn’t start a new search.' },
  [SAVE_OUTCOME.PROFILE_NOT_ACTIVE]: { tone: 'success', link: false, text: 'Saved. This profile isn’t active, so Barry won’t search with it until you activate it.' },
});
