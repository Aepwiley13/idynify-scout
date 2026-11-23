/**
 * #006.2 — ICP Settings says what a save actually did about discovery, and never
 * starts a second search while one is running.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SAVE_OUTCOME, SAVE_OUTCOME_COPY, saveOutcomeFor } from '../utils/icpSaveOutcome';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../pages/Scout/ICPSettings.jsx'), 'utf8');

describe('saveOutcomeFor mirrors the save handler’s own condition', () => {
  it.each([
    [{ isActiveProfile: true, changed: true, searchAlreadyRunning: false }, SAVE_OUTCOME.SEARCH_STARTED],
    [{ isActiveProfile: true, changed: true, searchAlreadyRunning: true }, SAVE_OUTCOME.SEARCH_ALREADY_RUNNING],
    [{ isActiveProfile: true, changed: false, searchAlreadyRunning: false }, SAVE_OUTCOME.NO_TARGETING_CHANGE],
    [{ isActiveProfile: false, changed: true, searchAlreadyRunning: false }, SAVE_OUTCOME.PROFILE_NOT_ACTIVE],
  ])('%o → %s', (input, expected) => {
    expect(saveOutcomeFor(input)).toBe(expected);
  });

  it('the handler starts a search exactly when the outcome says it did', () => {
    expect(src).toMatch(/if \(isActiveProfile && !discoveryInFlightRef\.current && changed\) \{/);
    expect(src).toMatch(/saveOutcomeFor\(\{ isActiveProfile, changed, searchAlreadyRunning: discoveryInFlightRef\.current \}\)/);
  });
});

describe('the copy is accurate', () => {
  it('only "started", "already running" and "finished" talk about a search happening', () => {
    expect(SAVE_OUTCOME_COPY[SAVE_OUTCOME.SEARCH_STARTED].text).toMatch(/started finding companies/);
    expect(SAVE_OUTCOME_COPY[SAVE_OUTCOME.NO_TARGETING_CHANGE].text).toMatch(/didn’t start a new search/);
    expect(SAVE_OUTCOME_COPY[SAVE_OUTCOME.PROFILE_NOT_ACTIVE].text).toMatch(/won’t search with it until you activate it/);
  });
  it('a failed search is an error, with Refresh Results as the retry', () => {
    const c = SAVE_OUTCOME_COPY[SAVE_OUTCOME.SEARCH_FAILED];
    expect(c.tone).toBe('error');
    expect(c.text).toMatch(/Refresh Results to try again/);
  });
  it('no message tells the user to refresh after a search has just started', () => {
    for (const k of [SAVE_OUTCOME.SEARCH_STARTED, SAVE_OUTCOME.SEARCH_ALREADY_RUNNING, SAVE_OUTCOME.SEARCH_FINISHED]) {
      expect(SAVE_OUTCOME_COPY[k].text).not.toMatch(/Refresh Results/);
    }
    expect(src).not.toMatch(/Click "Refresh Results" to fetch new companies/);
    expect(src).not.toMatch(/Save your changes first, then click "Refresh Results"/);
  });
});

describe('no duplicate searches', () => {
  it('both Refresh Results buttons are disabled while a save-triggered search runs', () => {
    expect(src).toMatch(/disabled=\{refreshing \|\| saving \|\| autoSearching\}/);
    expect(src).toMatch(/disabled=\{refreshing \|\| saving \|\| autoSearching \|\| !profile\}/);
  });
  it('and the handler itself refuses to start while one is in flight', () => {
    expect(src).toMatch(/async function handleRefreshResults\(\) \{[\s\S]{0,120}if \(refreshing \|\| discoveryInFlightRef\.current\) return;/);
  });
  it('the save path still issues one search request, unchanged', () => {
    const save = src.slice(src.indexOf('const changed = criteriaChanged('), src.indexOf('savedCriteriaRef.current = updatedProfile;'));
    expect(save.match(/fetch\('\/\.netlify\/functions\/search-companies'/g)).toHaveLength(1);
    expect(save).toMatch(/forceRefresh: true/);
  });
  it('the search result clears the running state, success or failure', () => {
    expect(src).toMatch(/\.then\(\(res\) => \{\s*discoveryInFlightRef\.current = false;\s*setAutoSearching\(false\);/);
    expect(src).toMatch(/\.catch\(\(\) => \{\s*discoveryInFlightRef\.current = false;\s*setAutoSearching\(false\);\s*setSaveOutcome\(\{ kind: SAVE_OUTCOME\.SEARCH_FAILED \}\);/);
  });
});
