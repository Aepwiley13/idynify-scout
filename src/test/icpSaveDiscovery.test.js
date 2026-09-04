/**
 * ICP Save → Discovery trigger contract.
 *
 * Saving a material targeting change to the ACTIVE ICP must trigger
 * search-companies automatically. The user should not need to click a
 * separate Refresh button after saving.
 *
 * Asserted against source because ICPSettings mounts with Firebase auth,
 * Firestore, and navigation context.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const icpSettings = readFileSync(resolve(here, '../pages/Scout/ICPSettings.jsx'), 'utf8');
const normalizeModule = readFileSync(resolve(here, '../utils/normalizeIcpCriteria.js'), 'utf8');

// ── normalizeIcpCriteria unit tests ──────────────────────────────────────────

import { normalizeIcpCriteria, criteriaChanged } from '../utils/normalizeIcpCriteria.js';

const BASE = {
  industries: ['Construction', 'Real Estate'],
  companyKeywords: ['contractor'],
  companySizes: ['11-20'],
  locations: ['Texas'],
  revenueRanges: ['$1M-$10M'],
};

describe('normalizeIcpCriteria', () => {
  it('is stable for identical criteria', () => {
    const a = normalizeIcpCriteria(BASE);
    const b = normalizeIcpCriteria({ ...BASE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('ignores array order and casing', () => {
    const reordered = { ...BASE, industries: ['real estate', 'CONSTRUCTION'] };
    expect(JSON.stringify(normalizeIcpCriteria(reordered)))
      .toBe(JSON.stringify(normalizeIcpCriteria(BASE)));
  });

  it('detects industry change', () => {
    const edited = { ...BASE, industries: ['Publishing'] };
    expect(JSON.stringify(normalizeIcpCriteria(edited)))
      .not.toBe(JSON.stringify(normalizeIcpCriteria(BASE)));
  });

  it('excludes targetTitles from comparison', () => {
    const withTitles = { ...BASE, targetTitles: ['VP Sales'] };
    expect(JSON.stringify(normalizeIcpCriteria(withTitles)))
      .toBe(JSON.stringify(normalizeIcpCriteria(BASE)));
  });

  it('normalises criteria through skip flags', () => {
    const skipA = { ...BASE, skipRevenue: true, revenueRanges: ['$1M-$10M'] };
    const skipB = { ...BASE, skipRevenue: true, revenueRanges: ['$50M-$100M'] };
    expect(JSON.stringify(normalizeIcpCriteria(skipA)))
      .toBe(JSON.stringify(normalizeIcpCriteria(skipB)));
  });

  it('handles empty/absent profile', () => {
    expect(normalizeIcpCriteria(undefined)).toBeDefined();
    expect(JSON.stringify(normalizeIcpCriteria({}))).toBe(JSON.stringify(normalizeIcpCriteria(undefined)));
  });
});

describe('criteriaChanged', () => {
  it('returns false for identical criteria', () => {
    expect(criteriaChanged(BASE, { ...BASE })).toBe(false);
  });

  it('returns false for cosmetic-only changes (name, notes)', () => {
    expect(criteriaChanged(
      { ...BASE, name: 'Old Name', notes: 'old notes' },
      { ...BASE, name: 'New Name', notes: 'new notes' }
    )).toBe(false);
  });

  it('returns true for material industry change', () => {
    expect(criteriaChanged(BASE, { ...BASE, industries: ['Publishing'] })).toBe(true);
  });

  it('returns true for location change', () => {
    expect(criteriaChanged(BASE, { ...BASE, locations: ['Ohio'] })).toBe(true);
  });

  it('returns true for company size change', () => {
    expect(criteriaChanged(BASE, { ...BASE, companySizes: ['201-500'] })).toBe(true);
  });

  it('returns false for targetTitles-only change', () => {
    expect(criteriaChanged(BASE, { ...BASE, targetTitles: ['CRO'] })).toBe(false);
  });

  it('returns false for reordered arrays', () => {
    expect(criteriaChanged(
      BASE,
      { ...BASE, industries: ['Real Estate', 'Construction'] }
    )).toBe(false);
  });
});

// ── Source-level: ICPSettings wiring ─────────────────────────────────────────

describe('ICPSettings — save triggers discovery', () => {
  it('imports criteriaChanged from normalizeIcpCriteria', () => {
    expect(icpSettings).toMatch(/import\s*\{[^}]*criteriaChanged[^}]*\}\s*from\s*['"].*normalizeIcpCriteria['"]/);
  });

  it('captures saved criteria via savedCriteriaRef', () => {
    expect(icpSettings).toMatch(/savedCriteriaRef/);
    expect(icpSettings).toMatch(/useRef\(null\)/);
  });

  it('guards against duplicate concurrent searches with discoveryInFlightRef', () => {
    expect(icpSettings).toMatch(/discoveryInFlightRef/);
    expect(icpSettings).toMatch(/discoveryInFlightRef\.current\s*=/);
  });

  it('only triggers for the active profile', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    expect(saveHandler).toMatch(/isActiveProfile\s*&&/);
  });

  it('only triggers when criteria materially changed', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    expect(saveHandler).toMatch(/criteriaChanged\(savedCriteriaRef\.current,\s*updatedProfile\)/);
  });

  it('sets barryState to SEARCHING before firing search-companies', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    const searchingAt = saveHandler.indexOf("barryState: 'SEARCHING'");
    const fetchAt = saveHandler.indexOf('search-companies');
    expect(searchingAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(searchingAt);
  });

  it('fires search-companies as fire-and-forget with forceRefresh', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    expect(saveHandler).toMatch(/fetch\('\/\.netlify\/functions\/search-companies'/);
    expect(saveHandler).toMatch(/forceRefresh:\s*true/);
  });

  it('persists before triggering discovery (setDoc before fetch)', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    const persistAt = saveHandler.indexOf("await setDoc(\n        doc(db, 'users', user.uid, 'icpProfiles'");
    const discoveryAt = saveHandler.indexOf("criteriaChanged(savedCriteriaRef.current");
    expect(persistAt).toBeGreaterThan(-1);
    expect(discoveryAt).toBeGreaterThan(persistAt);
  });

  it('updates savedCriteriaRef after save completes', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    expect(saveHandler).toMatch(/savedCriteriaRef\.current\s*=\s*updatedProfile/);
  });

  it('resets discoveryInFlightRef on both success and failure', () => {
    const saveHandler = icpSettings.slice(
      icpSettings.indexOf('async function handleSaveChanges'),
      icpSettings.indexOf('recalculateAllScores was removed')
    );
    const thenReset = (saveHandler.match(/discoveryInFlightRef\.current\s*=\s*false/g) || []).length;
    expect(thenReset).toBeGreaterThanOrEqual(2);
  });
});

// ── ICPSettings Refresh message uses currentQueueSize ──────────────────────

describe('ICPSettings — Refresh message distinguishes queue-full from no-results', () => {
  it('captures currentQueueSize from server response', () => {
    expect(icpSettings).toMatch(/currentQueueSize:\s*data\.currentQueueSize/);
  });

  it('shows queue-full message only when currentQueueSize > 0', () => {
    expect(icpSettings).toMatch(/currentQueueSize\s*>\s*0/);
    expect(icpSettings).toMatch(/Queue is already full/);
  });

  it('shows no-matches message when currentQueueSize is 0', () => {
    expect(icpSettings).toMatch(/No new matches found/);
  });

  it('has three branches: added, queue-full, no-matches', () => {
    const refreshBlock = icpSettings.slice(
      icpSettings.indexOf('header-refresh-success'),
      icpSettings.indexOf('header-refresh-error')
    );
    expect(refreshBlock).toMatch(/refreshResult\.count\s*>\s*0/);
    expect(refreshBlock).toMatch(/refreshResult\.currentQueueSize\s*>\s*0/);
    expect(refreshBlock).toMatch(/No new matches found/);
  });
});

// ── normalizeIcpCriteria mirrors server fingerprint normalization ─────────

describe('normalizeIcpCriteria mirrors server', () => {
  it('includes the same fields as computeIcpCriteriaFingerprint', () => {
    const normalized = normalizeIcpCriteria(BASE);
    const keys = Object.keys(normalized).sort();
    expect(keys).toEqual([
      'companyKeywords', 'companySizes', 'foundedAgeRange', 'industries',
      'isNationwide', 'locations', 'lookalikeSeed', 'revenueRanges',
      'searchStrategy', 'skipRevenue',
    ]);
  });

  it('module exports both normalizeIcpCriteria and criteriaChanged', () => {
    expect(normalizeModule).toMatch(/export function normalizeIcpCriteria/);
    expect(normalizeModule).toMatch(/export function criteriaChanged/);
  });
});
