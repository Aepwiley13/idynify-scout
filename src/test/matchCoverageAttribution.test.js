/**
 * Tier 2 — Match is Company × ICP, and Coverage is separate from it.
 *
 * Two things had to stop being true:
 *   1. Match was persisted per company, as though it were a property a company
 *      carries on its own. Saving one ICP overwrote every company's stored
 *      score using that ICP — including companies discovered under a different
 *      one — while leaving `icpId` alone, so the row claimed one ICP's identity
 *      and carried another's score.
 *   2. Surfaces read that stored number and presented it as current, with no way
 *      to know which ICP produced it.
 *
 * Match is now derived on demand against the ICP actually in use, and a null
 * score is an explicit unattributed state rather than a zero.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeCoverage, calculateICPScore, DEFAULT_WEIGHTS } from '../utils/icpScoring';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ICP_A = { industries: ['Dental'], locations: ['Texas'], companySizes: ['11-20'], scoringWeights: DEFAULT_WEIGHTS };
const ICP_B = { industries: ['Legal'], locations: ['Oregon'], companySizes: ['201-500'], scoringWeights: DEFAULT_WEIGHTS };
const COMPANY = { name: 'Acme Dental', industry: 'Dental', location: 'Austin, Texas', employee_count: 15 };

describe('Match — subject is Company × ICP', () => {
  it('the same company scores differently against different ICPs', () => {
    const againstA = calculateICPScore(COMPANY, ICP_A, DEFAULT_WEIGHTS);
    const againstB = calculateICPScore(COMPANY, ICP_B, DEFAULT_WEIGHTS);

    expect(againstA).not.toBe(againstB);
    expect(againstA).toBeGreaterThan(againstB);
  });

  it('a company alone has no Match', () => {
    expect(calculateICPScore(COMPANY, null, DEFAULT_WEIGHTS)).toBe(0);
  });
});

describe('Match — cross-ICP persistence is gone', () => {
  const icpSettings = read('../pages/Scout/ICPSettings.jsx');

  it('recalculateAllScores no longer exists', () => {
    expect(icpSettings).not.toMatch(/async function recalculateAllScores/);
    expect(code(icpSettings)).not.toMatch(/recalculateAllScores\(/);
  });

  it('saving an ICP writes no company documents at all', () => {
    // Comments stripped first: the note left where recalculateAllScores used to
    // live names the fields it used to write, and that must not read as code.
    const stripped = code(icpSettings);
    const at = stripped.indexOf('async function handleSaveChanges()');
    const end = stripped.indexOf('\n  async function', at + 10);
    const body = stripped.slice(at, end === -1 ? at + 4000 : end);

    expect(body).not.toMatch(/'companies'/);
    expect(body).not.toMatch(/fit_score/);
  });

  it('no surface writes fit_score to Firestore any more', () => {
    for (const rel of [
      '../pages/Scout/ICPSettings.jsx',
      '../pages/Scout/DailyLeads.jsx',
      '../pages/Scout/MissionControlDashboardV2.jsx',
      '../pages/Scout/SavedCompanies.jsx',
      '../pages/Onboarding/OnboardingFlow.jsx',
    ]) {
      const src = code(read(rel));
      // In-memory derivation (`fit_score:` inside a .map) is fine; a Firestore
      // write of it is what carried the contamination.
      expect(src, `${rel} persists fit_score`).not.toMatch(/updateDoc\([^)]*\)[\s\S]{0,200}fit_score:/);
      expect(src, `${rel} persists fit_score`).not.toMatch(/setDoc\([^)]*\)[\s\S]{0,200}fit_score:/);
    }
  });

  it('the server discovery writer never stamps a Match either', () => {
    const src = read('../../netlify/functions/search-companies.js');
    const at = src.indexOf('async function saveCompaniesToFirestore');
    const body = src.slice(at, src.indexOf('\nfunction ', at));

    expect(body).not.toMatch(/fit_score/);
  });
});

describe('Match — every consumer derives against a known ICP or shows nothing', () => {
  it.each([
    ['../pages/Scout/SavedCompanies.jsx', 'Saved Companies'],
    ['../pages/Scout/CompanyDetail.jsx', 'Company Detail'],
    ['../pages/Onboarding/OnboardingFlow.jsx', 'Onboarding'],
    ['../pages/Scout/MissionControlDashboardV2.jsx', 'Mission Control V2'],
  ])('%s resolves an ICP before showing Match', (rel, name) => {
    const src = code(read(rel));

    expect(src, `${name} does not resolve an ICP`).toMatch(/resolveActiveIcp/);
    expect(src, `${name} still falls back to the stored score`)
      .not.toMatch(/c\.fit_score \|\| c\.icpScore/);
  });

  it('unattributed Match is null, never a zero, at each display', () => {
    // Each surface expresses the same thing: an ICP produces a score, its
    // absence produces null. The shape differs (ternary vs branch) by file.
    expect(code(read('../pages/Scout/SavedCompanies.jsx'))).toMatch(/fit_score: null/);
    expect(code(read('../pages/Onboarding/OnboardingFlow.jsx')))
      .toMatch(/fit_score: matchIcp[\s\S]{0,140}: null/);
    expect(code(read('../pages/Scout/MissionControlDashboardV2.jsx')))
      .toMatch(/fit_score: activeProfile[\s\S]{0,160}: null/);
    expect(code(read('../pages/Scout/CompanyDetail.jsx')))
      .toMatch(/const fitScore = matchIcp[\s\S]{0,160}: null/);
  });

  it('sorting puts unattributed rows last instead of treating them as 0', () => {
    for (const rel of [
      '../pages/Scout/SavedCompanies.jsx',
      '../pages/Scout/MissionControlDashboardV2.jsx',
      '../pages/Onboarding/OnboardingFlow.jsx',
    ]) {
      expect(code(read(rel)), `${rel} sorts nulls as zero`).toMatch(/fit_score \?\? -1/);
    }
  });

  it('score-band filters exclude unattributed rows rather than banding them', () => {
    expect(read('../pages/Scout/MissionControlDashboardV2.jsx'))
      .toMatch(/scoreFilter !== 'all' && c\.fit_score == null/);
  });

  it('badges render an explicit marker, not a rounded zero', () => {
    expect(read('../pages/Scout/MissionControlDashboardV2.jsx')).toMatch(/unattributed \? '—'/);
    expect(read('../components/mission-control/MobileCompanyCard.jsx')).toMatch(/No active ICP/);
    expect(read('../pages/Onboarding/OnboardingFlow.jsx')).toMatch(/unattributed \? 'no ICP'/);
    expect(read('../pages/Scout/SavedCompanies.jsx')).toMatch(/No active ICP/);
  });
});

describe('Coverage — evidentiary completeness, separate from Match', () => {
  it('reports which relevant dimensions were observed and which were unknown', () => {
    const coverage = computeCoverage({ industry: 'Dental' }, ICP_A);

    expect(coverage.relevant).toEqual(['industry', 'location', 'employeeSize']);
    expect(coverage.observed).toEqual(['industry']);
    expect(coverage.unknown).toEqual(['location', 'employeeSize']);
    expect(coverage.complete).toBe(false);
  });

  it('is complete when every relevant dimension was observable', () => {
    const coverage = computeCoverage(COMPANY, ICP_A);

    expect(coverage.unknown).toEqual([]);
    expect(coverage.complete).toBe(true);
  });

  it('counts only dimensions the ICP configures — unconfigured is not "missing evidence"', () => {
    // ICP_A configures no revenue range, so revenue is in none of the lists.
    const coverage = computeCoverage(COMPANY, ICP_A);

    expect(coverage.relevant).not.toContain('revenue');
    expect(coverage.observed).not.toContain('revenue');
    expect(coverage.unknown).not.toContain('revenue');
  });

  it('two identical Match scores can carry very different Coverage', () => {
    const thin = { industry: 'Dental' };
    const full = COMPANY;

    const thinCoverage = computeCoverage(thin, ICP_A);
    const fullCoverage = computeCoverage(full, ICP_A);

    expect(thinCoverage.unknown.length).toBeGreaterThan(fullCoverage.unknown.length);
    // …and Coverage said so without altering either score.
    expect(typeof calculateICPScore(thin, ICP_A, DEFAULT_WEIGHTS)).toBe('number');
  });

  it('is a structured result, not a percentage', () => {
    const coverage = computeCoverage(COMPANY, ICP_A);

    expect(Array.isArray(coverage.relevant)).toBe(true);
    expect(Array.isArray(coverage.observed)).toBe(true);
    expect(Array.isArray(coverage.unknown)).toBe(true);
    expect(coverage).not.toHaveProperty('percentage');
    expect(coverage).not.toHaveProperty('score');
  });

  it('does not modify Match', () => {
    const before = calculateICPScore(COMPANY, ICP_A, DEFAULT_WEIGHTS);
    computeCoverage(COMPANY, ICP_A);
    const after = calculateICPScore(COMPANY, ICP_A, DEFAULT_WEIGHTS);

    expect(after).toBe(before);
  });

  it('is not persisted and not blended anywhere', () => {
    const scoring = code(read('../utils/icpScoring.js'));

    // calculateICPScore must not consult Coverage.
    const at = scoring.indexOf('export function calculateICPScore');
    const body = scoring.slice(at, scoring.indexOf('\nexport function', at + 10));
    expect(body).not.toMatch(/computeCoverage|coverage/i);

    for (const rel of ['../pages/Scout/SavedCompanies.jsx', '../pages/Scout/MissionControlDashboardV2.jsx']) {
      expect(code(read(rel)), `${rel} persists coverage`).not.toMatch(/coverage/i);
    }
  });

  it('handles a missing company or ICP without inventing evidence', () => {
    expect(computeCoverage(null, ICP_A)).toEqual({ relevant: [], observed: [], unknown: [], complete: false });
    expect(computeCoverage(COMPANY, null)).toEqual({ relevant: [], observed: [], unknown: [], complete: false });
  });
});

describe('User Judgment stays distinct from Match', () => {
  it('the two live on different fields and different scales', () => {
    const dailyLeads = read('../pages/Scout/DailyLeads.jsx');

    // User Judgment is written as barryFeedback; Match is never written at all.
    expect(dailyLeads).toMatch(/barryFeedback: feedback/);
  });

  it('the Barry prompt names the 1-10 ratings as User Judgment, not Match', () => {
    const src = read('../../netlify/functions/barryMissionChat.js');

    expect(src).toMatch(/USER JUDGMENT, NOT COMPUTED MATCH/);
    expect(src).toMatch(/Never compare the two scales/);
  });

  it('no computed Match reaches any Barry prompt, so they cannot be conflated there', () => {
    for (const rel of [
      '../../netlify/functions/barryMissionChat.js',
      '../../netlify/functions/utils/barryContextAssembler.js',
      '../../netlify/functions/utils/barryStrategyRecommender.js',
    ]) {
      expect(read(rel), `${rel} carries fit_score into a prompt`).not.toMatch(/fit_score/);
    }
  });
});
