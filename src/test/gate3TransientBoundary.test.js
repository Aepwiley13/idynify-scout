/**
 * GATE 3 — the persistence boundary.
 * Proves the selection experience persists NO candidate identity, and that a
 * structured turn cannot smuggle identity into Firestore via `meta`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  holdResultSet, getResultSet, releaseResultSet, _clearAll, _size,
} from '../utils/barryTransientCandidates.js';
import { stripIdentity } from '../utils/barryCanonical.js';
import { previewSentence, summarise, OUTCOME } from '../utils/resolutionContract.js';
import { mintClientRef } from '../utils/candidatePayload.js';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults.js';

const fixture = () => MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

beforeEach(() => _clearAll());

describe('candidates are transient', () => {
  it('lives in memory and is released on action', () => {
    const ref = holdResultSet({ kind: 'person', source: MOCK_SOURCE, results: fixture() });
    expect(_size()).toBe(1);
    releaseResultSet(ref);
    expect(getResultSet(ref)).toBeNull();
  });

  it('an unknown sessionRef returns null rather than throwing — the reload case', () => {
    expect(getResultSet('rs_gone')).toBeNull();
  });
});

describe('turn meta cannot carry identity', () => {
  it('strips every identity field', () => {
    const clean = stripIdentity({
      sessionRef: 'rs_1', count: 8,
      email: 'a@b.com', name: 'Sarah', phone: '123',
      linkedin_url: 'x', apollo_person_id: 'y', apollo_organization_id: 'z',
      company_name: 'Acme', title: 'VP',
    });
    expect(clean).toEqual({ sessionRef: 'rs_1', count: 8 });
  });

  it('strips whole result arrays', () => {
    expect(stripIdentity({ sessionRef: 'rs_1', results: fixture(), candidates: [1], payloads: [2] }))
      .toEqual({ sessionRef: 'rs_1' });
  });

  it('keeps counts, which are not identity', () => {
    const clean = stripIdentity({ sessionRef: 'rs_2', total: 8, existing: 5, new: 2, ambiguous: 1 });
    expect(clean.total).toBe(8);
    expect(clean.ambiguous).toBe(1);
  });
});

// The 'mocked dry-run shape' block was removed when the real resolver was
// wired — those shapes are now asserted against the server contract in
// gate3RealIntegration.test.js using fixtures/resolveSaveFixtures.js.

describe("Barry's sentence", () => {
  it('reports only what is true', () => {
    const s = previewSentence(summarise([
      { outcome: OUTCOME.MATCHED }, { outcome: OUTCOME.MATCHED }, { outcome: OUTCOME.CREATED },
    ]));
    expect(s).toContain('2 are already in IDYNIFY');
    expect(s).toContain('1 would be new');
    expect(s).not.toMatch(/need your help/);   // nothing ambiguous — do not mention it
  });

  it('uses singular phrasing for one ambiguous person', () => {
    expect(previewSentence(summarise([{ outcome: OUTCOME.AMBIGUOUS }]))).toContain('1 needs your help');
  });
});
