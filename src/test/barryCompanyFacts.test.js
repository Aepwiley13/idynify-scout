/**
 * The one place Barry's two customer-facing flows (the Meet panel and draft
 * generation) read company facts, instead of each building its own —
 * see netlify/functions/utils/barryCompanyFacts.js for why.
 *
 * Covers: no company to look up, a company with nothing verified, a company
 * whose two sources (apolloEnrichment.snapshot vs the top-level mirror)
 * disagree (omitted, never guessed which to trust), a company with clean
 * verified facts, and the deciding ICP (`swipedForICPId`) being present or
 * absent. formatCompanyFactsBlock's guardrail wording is asserted directly,
 * since that's the text the model actually sees.
 */
import { describe, it, expect } from 'vitest';
import { loadCompanyFactsForBarry, formatCompanyFactsBlock } from '../../netlify/functions/utils/barryCompanyFacts.js';

const UID = 'u1';

function fakeDb(companies = {}) {
  return {
    collection(name) {
      if (name !== 'users') throw new Error(`unexpected top-level collection: ${name}`);
      return {
        doc(userId) {
          if (userId !== UID) throw new Error(`unexpected userId: ${userId}`);
          return {
            collection(sub) {
              if (sub !== 'companies') throw new Error(`unexpected subcollection: ${sub}`);
              return {
                doc(companyId) {
                  return {
                    async get() {
                      const data = companies[companyId];
                      return { exists: data !== undefined, data: () => data };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('loadCompanyFactsForBarry', () => {
  it('no companyId at all: every fact null, no Firestore read attempted', async () => {
    const db = fakeDb({ c1: { name: 'Should never be read' } });
    const { facts, icpId } = await loadCompanyFactsForBarry(db, UID, null);
    expect(facts).toEqual({ name: null, industry: null, hq_location: null, founded_year: null, description: null });
    expect(icpId).toBeNull();
  });

  it('companyId given but no such document: every fact null, not a throw', async () => {
    const db = fakeDb({});
    const { facts, icpId } = await loadCompanyFactsForBarry(db, UID, 'ghost');
    expect(facts.name).toBeNull();
    expect(facts.founded_year).toBeNull();
    expect(icpId).toBeNull();
  });

  it('a real company with clean, agreeing facts: every field verified', async () => {
    const db = fakeDb({
      c1: {
        name: 'Blip',
        industry: 'Software',
        location: 'Utah, US',
        founded_year: 2015,
        swipedForICPId: 'icp_sales',
        apolloEnrichment: { snapshot: { industry: 'Software', location: { full: 'Utah, US' }, founded_year: 2015, description: 'A scheduling tool.' } },
      },
    });
    const { facts, icpId } = await loadCompanyFactsForBarry(db, UID, 'c1');
    expect(facts).toEqual({
      name: 'Blip', industry: 'Software', hq_location: 'Utah, US', founded_year: 2015, description: 'A scheduling tool.',
    });
    expect(icpId).toBe('icp_sales');
  });

  it('two sources disagree on founding year and HQ: both omitted, neither guessed', async () => {
    // The exact shape of the bug report's root cause once a real conflict exists:
    // never pick a side, state neither.
    const db = fakeDb({
      c1: {
        name: 'Blip',
        founded_year: 2015, // top-level, the company's own record
        location: 'Utah, US',
        apolloEnrichment: { snapshot: { founded_year: 2011, location: { full: 'London, UK' } } }, // stale/wrong snapshot
      },
    });
    const { facts } = await loadCompanyFactsForBarry(db, UID, 'c1');
    expect(facts.founded_year).toBeNull();
    expect(facts.hq_location).toBeNull();
    expect(facts.name).toBe('Blip'); // not in dispute, still comes through
  });

  it('only one source has a field: that one is used, not treated as a conflict', async () => {
    const db = fakeDb({
      c1: { name: 'Blip', apolloEnrichment: { snapshot: { founded_year: 2015 } } }, // no top-level founded_year
    });
    const { facts } = await loadCompanyFactsForBarry(db, UID, 'c1');
    expect(facts.founded_year).toBe(2015);
  });

  it('placeholder strings ("Unknown", "N/A") are treated as absent, not as real values', async () => {
    const db = fakeDb({ c1: { name: 'Blip', industry: 'Unknown', location: 'n/a' } });
    const { facts } = await loadCompanyFactsForBarry(db, UID, 'c1');
    expect(facts.industry).toBeNull();
    expect(facts.hq_location).toBeNull();
  });

  it('no swipedForICPId on the company: icpId is null, never defaulted to a sentinel', async () => {
    const db = fakeDb({ c1: { name: 'Blip' } });
    const { icpId } = await loadCompanyFactsForBarry(db, UID, 'c1');
    expect(icpId).toBeNull();
  });
});

describe('formatCompanyFactsBlock: the exact text the model sees', () => {
  it('every field present: states each value, no "Unknown" anywhere', () => {
    const block = formatCompanyFactsBlock({ name: 'Blip', industry: 'Software', hq_location: 'Utah, US', founded_year: 2015, description: 'A scheduling tool.' });
    expect(block).toContain('Company: Blip');
    expect(block).toContain('Industry: Software');
    expect(block).toContain('Headquarters: Utah, US');
    expect(block).toContain('Founded: 2015');
    expect(block).toContain('Description: A scheduling tool.');
    expect(block).not.toMatch(/Unknown/);
  });

  it('every field absent: each line is an explicit, instructive "Unknown" — never silently dropped', () => {
    const block = formatCompanyFactsBlock({ name: null, industry: null, hq_location: null, founded_year: null, description: null });
    expect(block).toMatch(/Company: Unknown/);
    expect(block).toMatch(/Industry: Unknown — do not state or guess/);
    expect(block).toMatch(/Headquarters: Unknown — do not state or guess/);
    expect(block).toMatch(/Founded: Unknown — do not reference company age or founding year/);
    expect(block).not.toMatch(/Description:/); // nothing to describe, and no fact-shaped gap to guard
  });

  it('a mix: present fields state their value, absent ones still get their own guardrail line', () => {
    const block = formatCompanyFactsBlock({ name: 'Blip', industry: null, hq_location: 'Utah, US', founded_year: null, description: null });
    expect(block).toContain('Company: Blip');
    expect(block).toContain('Headquarters: Utah, US');
    expect(block).toMatch(/Industry: Unknown/);
    expect(block).toMatch(/Founded: Unknown — do not reference company age or founding year/);
  });
});
