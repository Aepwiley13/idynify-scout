/**
 * B6 / T-1 — free text becomes supported targeting, or it becomes a question.
 *
 * The invariant under test is a negative one: no value this module emits was
 * invented. Everything it proposes is either an exact canonical name or a
 * curated alias a human wrote down; everything merely similar asks; everything
 * unsupported is dropped and named as dropped.
 *
 * A missing field is acceptable. A fabricated field is not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APOLLO_INDUSTRIES, COMPANY_SIZE_OPTIONS, US_STATES } from '../constants/targetingCanon.js';
import {
  normalizeIndustry,
  normalizeCompanySize,
  normalizeLocation,
  normalizeTargetingText,
  MATCHED,
  AMBIGUOUS,
  UNSUPPORTED,
  EMPTY,
} from '../utils/normalizeTargeting.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
/** Source with comments removed — the file's own prose names what it must not do. */
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const INDUSTRY_NAMES = APOLLO_INDUSTRIES.map(i => i.name);

describe('1 — exact canonical match', () => {
  it.each(['Accounting', 'Construction', 'Computer Software', 'Hospital & Health Care'])(
    '%s matches itself',
    (name) => {
      const r = normalizeIndustry(name);
      expect(r.status).toBe(MATCHED);
      expect(r.value).toBe(name);
    }
  );

  it('matches regardless of case, spacing and & vs and', () => {
    expect(normalizeIndustry('  computer   software ').value).toBe('Computer Software');
    expect(normalizeIndustry('Hospital and Health Care').value).toBe('Hospital & Health Care');
    expect(normalizeIndustry('MARKETING AND ADVERTISING').value).toBe('Marketing and Advertising');
  });

  it('every canonical name round-trips', () => {
    for (const name of INDUSTRY_NAMES) {
      expect(normalizeIndustry(name).value, name).toBe(name);
    }
    for (const bucket of COMPANY_SIZE_OPTIONS) {
      expect(normalizeCompanySize(bucket).values, bucket).toEqual([bucket]);
    }
    for (const state of US_STATES) {
      expect(normalizeLocation(state).value, state).toBe(state);
    }
  });
});

describe('2 — common synonyms', () => {
  it.each([
    ['healthcare', 'Hospital & Health Care'],
    ['SaaS', 'Computer Software'],
    ['law firms', 'Legal Services'],
    ['staffing', 'Staffing and Recruiting'],
    ['financial services', 'Financial Services'],
    ['contractors', 'Construction'],
    ['MSP', 'Information Technology and Services'],
  ])('%s → %s', (input, expected) => {
    const r = normalizeIndustry(input);
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe(expected);
  });

  it('state abbreviations are an exact, reversible mapping', () => {
    expect(normalizeLocation('TX').value).toBe('Texas');
    expect(normalizeLocation('ca').value).toBe('California');
  });
});

describe('3 — ambiguous input asks, and never approximates', () => {
  it('a unique near-match still asks', () => {
    // "manufacturing" contains exactly one canonical name, and a user who says
    // it almost never means Electrical/Electronic Manufacturing. Uniqueness is
    // not evidence of correctness.
    const r = normalizeIndustry('manufacturing');
    expect(r.status).toBe(AMBIGUOUS);
    expect(r.value).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('vague market language never becomes an employee filter', () => {
    for (const vague of ['mid-market', 'SMB', 'enterprise', 'small businesses', 'startups']) {
      const r = normalizeCompanySize(vague);
      expect(r.status, vague).toBe(AMBIGUOUS);
      expect(r.values, vague).toEqual([]);
    }
  });

  it('offers real candidates to choose from rather than a guess', () => {
    expect(normalizeCompanySize('mid-market').candidates).toEqual(COMPANY_SIZE_OPTIONS);
  });
});

describe('4 — unsupported input is dropped and named', () => {
  it.each(['blockchain gaming', 'vibes', 'quantum floristry'])('%s is unsupported', (input) => {
    const r = normalizeIndustry(input);
    expect(r.status).toBe(UNSUPPORTED);
    expect(r.value).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it('regions are not silently expanded into states', () => {
    // Turning "the Southwest" into a list of states would be Barry deciding
    // which states the user meant.
    for (const region of ['the Southwest', 'West Coast', 'the Midwest', 'New England']) {
      expect(normalizeLocation(region).status, region).toBe(UNSUPPORTED);
    }
  });

  it('a country other than the US is unsupported, not coerced', () => {
    expect(normalizeLocation('Ontario, Canada').status).toBe(UNSUPPORTED);
  });

  it('the caller is told what was dropped', () => {
    const { dropped } = normalizeTargetingText({ industry: 'blockchain gaming' });
    expect(dropped).toEqual([{ field: 'industry', input: 'blockchain gaming' }]);
  });
});

describe('5 — multiple possible mappings', () => {
  it.each([
    ['education', 3],
    ['media', 3],
    ['health', 3],
  ])('%s offers several candidates and picks none', (input, atLeast) => {
    const r = normalizeIndustry(input);
    expect(r.status).toBe(AMBIGUOUS);
    expect(r.value).toBeNull();
    expect(r.candidates.length).toBeGreaterThanOrEqual(atLeast);
  });

  it('every candidate offered is itself canonical', () => {
    for (const input of ['education', 'media', 'health', 'security', 'manufacturing', 'technology']) {
      for (const candidate of normalizeIndustry(input).candidates) {
        expect(INDUSTRY_NAMES, `${input} → ${candidate}`).toContain(candidate);
      }
    }
  });
});

describe('6 — empty input', () => {
  it.each([undefined, null, '', '   ', 0, {}])('%s is empty, not unsupported', (input) => {
    expect(normalizeIndustry(input).status).toBe(EMPTY);
    expect(normalizeCompanySize(input).status).toBe(EMPTY);
    expect(normalizeLocation(input).status).toBe(EMPTY);
  });

  it('an empty description proposes nothing and asks nothing', () => {
    const r = normalizeTargetingText({});
    expect(r.proposed).toEqual({ industries: [], companySizes: [], locations: [], isNationwide: false });
    expect(r.questions).toEqual([]);
    expect(r.dropped).toEqual([]);
  });
});

describe('7 — mixed industry, geography and size language', () => {
  it('reads a whole sentence of website copy', () => {
    const { proposed } = normalizeTargetingText({
      industry: 'healthcare and adjacent services',
      companySize: '50-200 employees',
      location: 'Texas and California',
    });
    expect(proposed.industries).toEqual(['Hospital & Health Care']);
    expect(proposed.companySizes).toEqual(['21-50', '51-100', '101-200']);
    expect(proposed.locations).toEqual(['Texas', 'California']);
    expect(proposed.isNationwide).toBe(false);
  });

  it('a stated range maps to the buckets it overlaps — arithmetic, not judgment', () => {
    expect(normalizeCompanySize('about 20 people').values).toEqual(['11-20']);
    expect(normalizeCompanySize('under 10').values).toEqual(['1-10']);
    expect(normalizeCompanySize('5000+').values).toEqual(['2,001-5,000', '5,001-10,000', '10,001+']);
  });

  it('a city keeps its state and loses the city', () => {
    const { proposed, dropped } = normalizeTargetingText({ location: 'Austin, TX' });
    expect(proposed.locations).toEqual(['Texas']);
    expect(dropped.some(d => d.input === 'Austin')).toBe(true);
  });

  it('a named state beats a nationwide phrase in the same breath', () => {
    const { proposed } = normalizeTargetingText({ location: 'nationwide, mostly Texas' });
    expect(proposed.locations).toEqual(['Texas']);
    expect(proposed.isNationwide).toBe(false);
  });
});

describe('8 — partially mappable input', () => {
  it('keeps what mapped and drops the rest', () => {
    const { proposed, dropped } = normalizeTargetingText({
      industry: 'accounting and blockchain gaming',
    });
    expect(proposed.industries).toEqual(['Accounting']);
    expect(dropped.map(d => d.input)).toContain('blockchain gaming');
  });

  it('does not ask about an ambiguous fragment when something already landed', () => {
    // Barry has something defensible to propose; asking anyway is the
    // questionnaire this phase removes.
    const { proposed, questions } = normalizeTargetingText({ industry: 'accounting and manufacturing' });
    expect(proposed.industries).toEqual(['Accounting']);
    expect(questions.filter(q => q.field === 'industry')).toEqual([]);
  });

  it('asks when nothing at all landed', () => {
    const { proposed, questions } = normalizeTargetingText({ industry: 'manufacturing' });
    expect(proposed.industries).toEqual([]);
    expect(questions[0].field).toBe('industry');
  });

  it('one unusable field never discards the usable ones', () => {
    const { proposed, questions } = normalizeTargetingText({
      industry: 'Accounting',
      companySize: 'mid-market',
      location: 'the Southwest',
    });
    expect(proposed.industries).toEqual(['Accounting']);
    expect(proposed.companySizes).toEqual([]);
    expect(questions.some(q => q.field === 'companySize')).toBe(true);
  });
});

describe('9 — property: every emitted value is canonical', () => {
  const PHRASES = [
    'healthcare', 'SaaS', 'law firms', 'manufacturing', 'technology', 'education',
    'blockchain gaming', 'Accounting', 'marketing agencies', 'trucking companies',
    'accounting and blockchain gaming', 'restaurants, hotels and retail', '', '   ',
    'Hospital and Health Care', 'msp', 'consulting firms', 'banks and credit unions',
  ];
  const SIZES = [
    '', 'mid-market', '50-200 employees', '10-50', 'about 20 people', '5000+',
    'under 10', 'enterprise', '1-10', '10,001+', 'roughly one hundred', 'SMB',
  ];
  const PLACES = [
    '', 'Texas', 'TX', 'Austin, TX', 'the Southwest', 'nationwide', 'United States',
    'Ontario, Canada', 'Texas and California', 'new york', 'Paris', 'anywhere in the US',
  ];

  it('holds across every combination', () => {
    for (const industry of PHRASES) {
      for (const companySize of SIZES) {
        for (const location of PLACES) {
          const { proposed } = normalizeTargetingText({ industry, companySize, location });

          for (const v of proposed.industries) {
            expect(INDUSTRY_NAMES, `industry "${industry}" emitted ${v}`).toContain(v);
          }
          for (const v of proposed.companySizes) {
            expect(COMPANY_SIZE_OPTIONS, `size "${companySize}" emitted ${v}`).toContain(v);
          }
          for (const v of proposed.locations) {
            expect(US_STATES, `location "${location}" emitted ${v}`).toContain(v);
          }
          expect(typeof proposed.isNationwide).toBe('boolean');
        }
      }
    }
  });

  it('never emits a duplicate', () => {
    const { proposed } = normalizeTargetingText({
      industry: 'healthcare, health care, hospitals',
      location: 'Texas, TX, texas',
    });
    expect(proposed.industries).toEqual(['Hospital & Health Care']);
    expect(proposed.locations).toEqual(['Texas']);
  });

  it('every curated alias points at a canonical name', () => {
    const src = read('../utils/normalizeTargeting.js');
    const block = src.slice(src.indexOf('const INDUSTRY_ALIASES'), src.indexOf('/** Canonical names that merely'));
    const targets = [...block.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
    expect(targets.length).toBeGreaterThan(20);
    for (const target of targets) {
      // Aliases are written with "and" where the canonical name uses "&"; the
      // normalizer resolves that, so assert through it rather than by string.
      expect(normalizeIndustry(target).status, target).toBe(MATCHED);
    }
  });
});

describe('10 — T-1 proposes and nothing more', () => {
  const full = read('../utils/normalizeTargeting.js');
  const src = code(full);

  it('cannot search', () => {
    expect(src).not.toMatch(/search-companies|fetch\(|apollo\.io|APOLLO_ENDPOINTS/i);
  });

  it('cannot write authoritative ICP intelligence', () => {
    expect(src).not.toMatch(/icpProfiles|setActiveIcpProfile|setDoc|updateDoc|addDoc/);
  });

  it('cannot write the compatibility bridge', () => {
    expect(src).not.toMatch(/companyProfile|icpIdSource/);
  });

  it('does not touch the quality floor', () => {
    expect(src).not.toMatch(/hasRetrievalConstraint|barryState|NEEDS_TARGETING/);
  });

  it('imports nothing that could persist or search', () => {
    const imports = full.slice(0, full.indexOf('export const MATCHED'));
    expect(imports).not.toMatch(/firebase|firestore|netlify/);
    expect(imports).toContain("from '../constants/targetingCanon.js'");
  });

  it('reads the canonical sets rather than restating them', () => {
    // Three copies of these lists used to exist. The copy that drifts is the
    // one that lets an unsupported value reach a query.
    expect(full).not.toMatch(/5567cd4773696439b10b/);
    expect(full.match(/'Alabama'/g) || []).toHaveLength(1); // the abbreviation map only
  });

  it('the server validator reads the same source', () => {
    const server = read('../../netlify/functions/barryICPConversation.js');
    expect(server).toContain("from '../../src/constants/targetingCanon.js'");
    expect(server).not.toMatch(/5567cd4773696439b10b0000/);
  });
});

describe('11 — confirmation remains the authority boundary', () => {
  it('normalized targeting is proposed, and only handleConfirm makes it real', () => {
    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    // The creation event is still the one Phase 1B verified, and it is still
    // reached only from the confirm action.
    expect(onboarding).toMatch(/onConfirm=\{handleConfirm\}/);
    expect(onboarding).toMatch(/const resolution = await resolveActiveIcp\(user\.uid\)/);
    expect(onboarding).not.toMatch(/normalizeTargetingText[\s\S]{0,200}setDoc/);
  });
});
