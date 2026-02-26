/**
 * STRUCTURED FIELDS — QA Unit Tests
 *
 * Tests the CTA label engine and outcome goal mapping.
 * The dynamic CTA label on Hunter cards drives the UX signal
 * that tells the user what kind of move to make next.
 * Wrong labels here means Barry's intent is lost in the UI.
 */

import { describe, it, expect } from 'vitest';
import {
  getCTAForContact,
  getDefaultOutcomeGoal,
  HUNTER_STATUSES,
  CTA_LABEL_MAP,
  OUTCOME_GOALS,
  OUTCOME_GOALS_BY_CATEGORY,
  OUTCOME_GOAL_CATEGORIES,
  RELATIONSHIP_STATES
} from '../constants/structuredFields';

// ── getCTAForContact ─────────────────────────────────────────────────────────

describe('getCTAForContact — dynamic CTA label per relationship state', () => {

  it('returns Start Conversation for unaware contacts', () => {
    const result = getCTAForContact('unaware');
    expect(result.label).toBe('Start Conversation');
    expect(result.outcomeGoal).toBe('enter_conversation');
  });

  it('returns Build Rapport for aware contacts', () => {
    const result = getCTAForContact('aware');
    expect(result.label).toBe('Build Rapport');
    expect(result.outcomeGoal).toBe('build_rapport');
  });

  it('returns Reconnect for dormant contacts', () => {
    const result = getCTAForContact('dormant');
    expect(result.label).toBe('Reconnect');
    expect(result.outcomeGoal).toBe('reconnect');
  });

  it('returns Rebuild Trust for strained contacts', () => {
    const result = getCTAForContact('strained');
    expect(result.label).toBe('Rebuild Trust');
    expect(result.outcomeGoal).toBe('rebuild_relationship');
  });

  it('returns Request Introduction for trusted contacts', () => {
    const result = getCTAForContact('trusted');
    expect(result.label).toBe('Request Introduction');
    expect(result.outcomeGoal).toBe('get_introduction');
  });

  it('overrides all states with Advance Mission when hasActiveMission is true', () => {
    const states = ['unaware', 'aware', 'warm', 'trusted', 'dormant', 'strained', 'strategic_partner'];
    states.forEach(state => {
      const result = getCTAForContact(state, true);
      expect(result.label).toBe('Advance Mission');
      expect(result.outcomeGoal).toBe('define_next_step');
    });
  });

  it('returns a safe fallback for an unmapped/unknown state', () => {
    const result = getCTAForContact('completely_unknown_state');
    expect(result.label).toBeTruthy();           // never undefined
    expect(result.outcomeGoal).toBeTruthy();     // never undefined
  });

  it('returns a safe fallback for undefined state', () => {
    const result = getCTAForContact(undefined);
    expect(result.label).toBeTruthy();
    expect(result.outcomeGoal).toBeTruthy();
  });

  it('returns a safe fallback for null state', () => {
    const result = getCTAForContact(null);
    expect(result.label).toBeTruthy();
    expect(result.outcomeGoal).toBeTruthy();
  });

  it('every mapped state returns an object with both label and outcomeGoal', () => {
    Object.keys(CTA_LABEL_MAP).forEach(state => {
      const result = getCTAForContact(state);
      expect(result.label, `state: ${state}`).toBeTruthy();
      expect(result.outcomeGoal, `state: ${state}`).toBeTruthy();
    });
  });
});

// ── getDefaultOutcomeGoal ────────────────────────────────────────────────────

describe('getDefaultOutcomeGoal — auto-select outcome for mission setup', () => {

  it('returns enter_conversation for unaware (first outreach goal)', () => {
    expect(getDefaultOutcomeGoal('unaware')).toBe('enter_conversation');
  });

  it('returns reconnect for dormant contacts', () => {
    expect(getDefaultOutcomeGoal('dormant')).toBe('reconnect');
  });

  it('returns rebuild_relationship for strained contacts', () => {
    expect(getDefaultOutcomeGoal('strained')).toBe('rebuild_relationship');
  });

  it('returns get_introduction for trusted contacts', () => {
    expect(getDefaultOutcomeGoal('trusted')).toBe('get_introduction');
  });

  it('returns a valid outcome_goal id for every known relationship state', () => {
    const knownOutcomeGoalIds = OUTCOME_GOALS.map(g => g.id);
    Object.keys(CTA_LABEL_MAP).forEach(state => {
      const goal = getDefaultOutcomeGoal(state);
      expect(knownOutcomeGoalIds, `goal '${goal}' for state '${state}' must be in OUTCOME_GOALS`).toContain(goal);
    });
  });

  it('returns a safe fallback for unknown state', () => {
    const result = getDefaultOutcomeGoal('unknown_state');
    expect(result).toBeTruthy();
  });
});

// ── HUNTER_STATUSES ──────────────────────────────────────────────────────────

describe('HUNTER_STATUSES — four-state lifecycle', () => {

  it('includes all four required states', () => {
    expect(HUNTER_STATUSES).toContain('deck');
    expect(HUNTER_STATUSES).toContain('engaged_pending');
    expect(HUNTER_STATUSES).toContain('active_mission');
    expect(HUNTER_STATUSES).toContain('archived');
  });

  it('has exactly four states', () => {
    expect(HUNTER_STATUSES).toHaveLength(4);
  });
});

// ── OUTCOME_GOALS ────────────────────────────────────────────────────────────

describe('OUTCOME_GOALS — 60+ goals across 8 categories', () => {

  it('has at least 60 outcome goals', () => {
    expect(OUTCOME_GOALS.length).toBeGreaterThanOrEqual(60);
  });

  it('every goal has id, label, category, and description', () => {
    OUTCOME_GOALS.forEach(goal => {
      expect(goal.id, `goal missing id: ${JSON.stringify(goal)}`).toBeTruthy();
      expect(goal.label, `goal ${goal.id} missing label`).toBeTruthy();
      expect(goal.category, `goal ${goal.id} missing category`).toBeTruthy();
      expect(goal.description, `goal ${goal.id} missing description`).toBeTruthy();
    });
  });

  it('no duplicate goal ids', () => {
    const ids = OUTCOME_GOALS.map(g => g.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all goal categories are in OUTCOME_GOAL_CATEGORIES', () => {
    const validCategoryIds = OUTCOME_GOAL_CATEGORIES.map(c => c.id);
    OUTCOME_GOALS.forEach(goal => {
      expect(validCategoryIds, `unknown category '${goal.category}' on goal '${goal.id}'`).toContain(goal.category);
    });
  });
});

// ── OUTCOME_GOALS_BY_CATEGORY ─────────────────────────────────────────────────

describe('OUTCOME_GOALS_BY_CATEGORY — grouped view for UI', () => {

  it('has all 8 expected categories', () => {
    const expectedCategories = ['awareness', 'engagement', 'strategic', 'maintenance', 'expansion', 'validation', 'transactional', 'meta'];
    expectedCategories.forEach(cat => {
      expect(Object.keys(OUTCOME_GOALS_BY_CATEGORY)).toContain(cat);
    });
  });

  it('every goal in OUTCOME_GOALS appears in exactly one category group', () => {
    const allGroupedGoalIds = Object.values(OUTCOME_GOALS_BY_CATEGORY).flat().map(g => g.id);
    expect(allGroupedGoalIds.length).toBe(OUTCOME_GOALS.length);
  });
});

// ── RELATIONSHIP_STATES ──────────────────────────────────────────────────────

describe('RELATIONSHIP_STATES — nine-state arc', () => {

  it('has all nine required states', () => {
    const stateIds = RELATIONSHIP_STATES.map(s => s.id);
    const required = ['unaware', 'aware', 'engaged', 'warm', 'trusted', 'advocate', 'dormant', 'strained', 'strategic_partner'];
    required.forEach(id => {
      expect(stateIds, `missing state: ${id}`).toContain(id);
    });
  });

  it('every state has id, label, and description', () => {
    RELATIONSHIP_STATES.forEach(state => {
      expect(state.id, `state missing id`).toBeTruthy();
      expect(state.label, `state ${state.id} missing label`).toBeTruthy();
      expect(state.description, `state ${state.id} missing description`).toBeTruthy();
    });
  });
});
