/**
 * The `|| 0` must not come back.
 *
 * ScorePip now distinguishes null from 0 (see scorePipNullDisplay.test.jsx),
 * but that only holds if its callers stop destroying the distinction before it
 * is handed over. `co.fit_score || co.score || 0` coerces null to 0 at the call
 * site, so no amount of correctness inside the component can recover it.
 *
 * Read from source rather than by rendering, because what is being guarded is
 * the shape of every call site — including one added later by someone who
 * copied a neighbouring line. That is the same reason
 * dailyDiscoveriesIcpTargeting.test.js reads source: rendering DailyLeads
 * mounts the entire Scout queue and still would not catch a new call site.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dailyLeads = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

describe('no score-display site coerces null to zero', () => {
  it('every ScorePip call passes a nullish-coalesced score', () => {
    const calls = dailyLeads.match(/<ScorePip[^>]*>/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain('??');
      expect(call).not.toContain('|| 0');
    }
  });

  it('no ScorePip call uses the `|| co.score || 0` chain that caused this', () => {
    expect(dailyLeads).not.toMatch(/<ScorePip[^>]*fit_score\s*\|\|/);
  });

  it('the TOP MATCH figure is not rendered through `fit_score || 0`', () => {
    expect(dailyLeads).not.toMatch(/\{topMatch\.fit_score\s*\|\|\s*0\}/);
  });

  it('the saved-today list is not rendered through `fit_score || 0`', () => {
    expect(dailyLeads).not.toMatch(/\{co\.fit_score\s*\|\|\s*0\}\/100/);
  });

  it('the saved-today site branches on null explicitly', () => {
    expect(dailyLeads).toMatch(/co\.fit_score == null/);
  });

  it('TOP MATCH has no unscored branch, because pickTopMatch cannot return one', () => {
    // Not an omission: a null branch here would be unreachable code asserting a
    // case the selector rules out. The guarantee is tested in fitRanking.test.js
    // ("is never awarded to an unscored company").
    expect(dailyLeads).not.toMatch(/topMatch\.fit_score == null/);
    expect(dailyLeads).toContain('{topMatch.fit_score}');
  });

  it('the unscored copy comes from the shared vocabulary, not a local string', () => {
    expect(dailyLeads).toContain('co.fit_score == null ? UNSCORED_LABEL');
    expect(dailyLeads).toMatch(/import \{[^}]*UNSCORED_LABEL[^}]*\} from '\.\.\/\.\.\/utils\/scoreDisplay'/);
    // No surface may hand-roll the sentence — that is how two screens end up
    // disagreeing about what an unscored company is called.
    expect(dailyLeads).not.toContain("'Not enough data to score this company'");
  });

  it('ScorePip is imported rather than redefined inline', () => {
    expect(dailyLeads).toMatch(/import ScorePip from '\.\.\/\.\.\/components\/scout\/ScorePip'/);
    expect(dailyLeads).not.toMatch(/const ScorePip\s*=\s*\(/);
  });
});

describe('ranking goes through the shared comparator', () => {
  it('both queue sorts use compareByFit rather than an inline comparator', () => {
    const sorts = dailyLeads.match(/\.sort\(compareByFit\)/g) || [];
    expect(sorts.length).toBe(2);
  });

  it('no inline `?? 0` score comparator survives', () => {
    expect(dailyLeads).not.toMatch(/\(b\.fit_score \?\? 0\) - \(a\.fit_score \?\? 0\)/);
  });

  it('TOP MATCH is chosen by pickTopMatch, not by a reduce over coerced scores', () => {
    expect(dailyLeads).toContain('pickTopMatch(savedCompanies)');
    expect(dailyLeads).not.toMatch(/reduce\(\(best, c\) => \(\(c\.fit_score \|\| 0\)/);
  });

  it('imports the ranking helpers from the shared module', () => {
    expect(dailyLeads).toMatch(
      /import \{ compareByFit, pickTopMatch \} from '\.\.\/\.\.\/utils\/fitRanking'/,
    );
  });
});
