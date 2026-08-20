/**
 * B5 — Barry proposes, the user confirms, then Scout searches.
 *
 * Two rules carry the weight here. The quality floor is one supported
 * retrieval constraint — no more, and never zero. And confirmation is the only
 * event at which a proposal becomes authoritative: everything before it is a
 * sentence Barry said.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SUPPORTED_CONSTRAINTS,
  retrievalConstraints,
  hasRetrievalConstraint,
  buildProposal,
  CLARIFY_QUESTION,
} from '../utils/targetingProposal.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROOFING = {
  industries: ['Construction'],
  companyKeywords: ['roofing contractors'],
  companySizes: ['11-20'],
  locations: ['Texas'],
  targetTitles: ['Operations Manager'],
  lookalikeSeed: { name: 'Beaumont Roofing' },
  confidenceScore: 0.85,
};

describe('1 — the quality floor is exactly one supported constraint', () => {
  it.each([
    ['industries', { industries: ['Accounting'] }],
    ['companyKeywords', { companyKeywords: ['agency'] }],
    ['companySizes', { companySizes: ['11-20'] }],
    ['locations', { locations: ['Texas'] }],
    ['nationwide', { isNationwide: true }],
    ['foundedAgeRange', { foundedAgeRange: { minAge: null, maxAge: 5 } }],
  ])('%s alone is enough to propose and to search', (_label, icp) => {
    expect(hasRetrievalConstraint(icp)).toBe(true);
    expect(buildProposal({ icp }).canPropose).toBe(true);
  });

  it.each([
    ['target titles', { targetTitles: ['CEO', 'CTO'] }],
    ['revenue ranges', { revenueRanges: ['1M-10M'] }],
    ['a lookalike seed alone', { lookalikeSeed: { name: 'Acme' } }],
  ])('%s is not a retrieval constraint', (_label, icp) => {
    // Each of these is real intelligence and none of them reaches the company
    // search: titles are a person filter, revenue is never sent, and the query
    // builder receives the seed and logs it without turning it into a
    // parameter. Counting any of them would let an unfiltered search wear an
    // ICP label.
    expect(hasRetrievalConstraint(icp)).toBe(false);
  });

  it('an empty or absent definition carries nothing', () => {
    for (const icp of [null, undefined, {}, { industries: [], locations: [] }]) {
      expect(hasRetrievalConstraint(icp)).toBe(false);
    }
  });

  it('adds no count, percentage or completeness rule on top', () => {
    // Two constraints must not be treated as better than one for the purpose
    // of being allowed to start.
    expect(hasRetrievalConstraint({ industries: ['Accounting'] })).toBe(true);
    expect(hasRetrievalConstraint(ROOFING)).toBe(true);
  });

  it('reports which constraints are present, from the declared set', () => {
    for (const name of retrievalConstraints(ROOFING)) {
      expect(SUPPORTED_CONSTRAINTS).toContain(name);
    }
    expect(retrievalConstraints(ROOFING)).toEqual(
      expect.arrayContaining(['industries', 'companyKeywords', 'companySizes', 'locations'])
    );
  });

  it('nationwide counts once, however it is expressed', () => {
    expect(retrievalConstraints({ locations: 'nationwide' })).toEqual(['isNationwide']);
    expect(retrievalConstraints({ isNationwide: true })).toEqual(['isNationwide']);
    expect(retrievalConstraints({ locations: 'nationwide', isNationwide: true })).toEqual(['isNationwide']);
  });
});

describe('2 — with nothing defensible, Barry asks once', () => {
  const p = buildProposal({ icp: { targetTitles: ['CEO'] }, name: 'Dana' });

  it('asks one question rather than presenting a form', () => {
    expect(p.canPropose).toBe(false);
    expect(p.question).toBe(CLARIFY_QUESTION);
    expect(p.target).toBeNull();
    expect(p.plan).toBeNull();
  });

  it('does not list the fields it is missing', () => {
    // A list of blanks is the same questionnaire in a different costume.
    const copy = `${p.greeting} ${p.question}`;
    expect(copy).not.toMatch(/industr|company size|location|employee|field/i);
  });

  it('asks for a direction, not a value from an enumeration', () => {
    expect(CLARIFY_QUESTION).toMatch(/rough direction/i);
  });
});

describe('3 — the proposal shows the work', () => {
  const p = buildProposal({ icp: ROOFING, goal: 'win more commercial roofing work', name: 'Dana' });

  it('says what it believes the user is trying to accomplish', () => {
    expect(p.goal).toBe('win more commercial roofing work');
  });

  it('says who it will go looking for, in one readable phrase', () => {
    expect(p.target).toBe('roofing contractors in Texas with 11-20 employees');
  });

  it('says what it worked out that the user did not spell out', () => {
    expect(p.learned.join(' ')).toContain('Beaumont Roofing');
    expect(p.learned.join(' ')).toMatch(/narrower than Construction/);
  });

  it('says what it intends to do if confirmed', () => {
    expect(p.plan).toContain('roofing contractors in Texas');
    expect(p.plan).toMatch(/Scout/);
  });

  it('greets by name when one is known, and works without one', () => {
    expect(p.greeting).toContain('Dana');
    expect(buildProposal({ icp: ROOFING }).greeting.length).toBeGreaterThan(0);
  });

  it('states uncertainty where it exists', () => {
    const thin = buildProposal({ icp: { industries: ['Accounting'], confidenceScore: 0.3 } });
    const copy = thin.uncertain.join(' ');
    expect(copy).toMatch(/first pass/i);
    expect(copy).toMatch(/size/i);
    expect(copy).toMatch(/everywhere in the US/i);
  });

  it('says titles are still unknown without making them a blocker', () => {
    const noTitles = buildProposal({ icp: { industries: ['Accounting'] } });
    expect(noTitles.canPropose).toBe(true);
    expect(noTitles.uncertain.join(' ')).toMatch(/who you'd want to talk to/i);
  });

  it('says a single-constraint search will be broad rather than refusing it', () => {
    const broad = buildProposal({ icp: { industries: ['Accounting'] } });
    expect(broad.broad).toBe(true);
    expect(broad.canPropose).toBe(true);
    expect(buildProposal({ icp: ROOFING }).broad).toBe(false);
  });
});

describe('4 — no implementation language reaches the user', () => {
  const banned = /proto-targeting|\bD7\b|attribution|retrieval constraint|ICP architecture|barryState|icpId|Apollo|enumeration|normaliz/i;

  it.each([
    ['a full proposal', ROOFING],
    ['a single-constraint proposal', { industries: ['Accounting'] }],
    ['nothing to go on', { targetTitles: ['CEO'] }],
    ['nationwide', { isNationwide: true, companySizes: ['1-10'] }],
    ['an age range', { foundedAgeRange: { minAge: 2, maxAge: 10 } }],
  ])('%s speaks plainly', (_label, icp) => {
    const p = buildProposal({ icp, goal: 'grow', name: 'Dana' });
    const copy = [p.greeting, p.goal, p.target, p.plan, p.question, ...p.learned, ...p.uncertain]
      .filter(Boolean).join(' ');
    expect(copy).not.toMatch(banned);
  });

  it('the rendered component adds no field-list vocabulary of its own', () => {
    const src = code(read('../components/onboarding/TargetingProposal.jsx'));
    expect(src).not.toMatch(/Not specified|Any size|confident|% confidence/);
  });
});

describe('5 — the confirmation sequence is unchanged', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('still resolves before it writes, and refuses on a failed read', () => {
    expect(onboarding).toMatch(/const resolution = await resolveActiveIcp\(user\.uid\)/);
    expect(onboarding).toMatch(/reason === 'read-failed'[\s\S]{0,400}throw new Error/);
  });

  it('still writes the authoritative profile before the projection', () => {
    const authoritative = onboarding.indexOf("'icpProfiles', icpId");
    const projection = onboarding.indexOf("'companyProfile', 'current'", authoritative);
    expect(authoritative).toBeGreaterThan(-1);
    expect(projection).toBeGreaterThan(authoritative);
  });

  it('still activates a newly created profile', () => {
    expect(onboarding).toContain('setActiveIcpProfile(user.uid, icpId)');
  });

  it('still projects the bridge carrying the identity it just wrote', () => {
    expect(onboarding).toMatch(/icpId, icpIdSource: 'barry_onboarding_confirmed'/);
  });

  it('still gates the search on the floor, and carries the identity into it', () => {
    expect(onboarding).toMatch(/const canSearch = hasRetrievalConstraint\(icpProfile\)/);
    expect(onboarding).toMatch(/if \(canSearch\)[\s\S]{0,600}search-companies/);
    expect(onboarding).toMatch(/search-companies[\s\S]{0,400}icpId\s*\n/);
  });

  it('still reports NEEDS_TARGETING rather than searching unfiltered', () => {
    expect(onboarding).toMatch(/canSearch \? 'SEARCHING' : 'NEEDS_TARGETING'/);
  });

  it('the floor is now one rule rather than two copies', () => {
    // The inline predicate and the proposal's predicate were the same rule
    // written twice. The copy that drifts is the one that lets an unfiltered
    // search call itself targeted.
    expect(onboarding).toContain("from '../../utils/targetingProposal'");
    const body = code(onboarding);
    expect(body.match(/industries\?\.length > 0\) \|\|/g)).toBeNull();
  });
});

describe('6 — nothing crosses the line before confirmation', () => {
  const proposal = read('../utils/targetingProposal.js');
  const component = read('../components/onboarding/TargetingProposal.jsx');

  it('the proposal module writes nothing and searches nothing', () => {
    for (const src of [proposal, component]) {
      expect(src).not.toMatch(/setDoc|updateDoc|addDoc|search-companies|icpProfiles|setActiveIcpProfile/);
    }
  });

  it('the proposal module makes no network call at all', () => {
    expect(proposal).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
  });

  it('confirming is the only thing wired to the creation event', () => {
    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    expect(onboarding).toMatch(/onConfirm=\{handleConfirm\}/);
    // Refining and answering both go back to the conversation, never forward.
    expect(onboarding).toMatch(/onRefine=\{handleRefine\}/);
    expect(onboarding).toMatch(/onAnswer=\{handleRefine\}/);
  });

  it('no provisional identity is minted for a proposal', () => {
    expect(code(proposal)).not.toMatch(/icp_\$\{|provisional|tempIcp|draftIcp|DEFAULT_ICP_ID/);
  });
});

describe('7 — titles no longer hold up a defensible proposal', () => {
  const server = read('../../netlify/functions/barryICPConversation.js');

  it('the server reports missing titles instead of forcing a turn', () => {
    expect(server).toContain('barryResponse.missingTargetTitles');
    expect(code(server)).not.toMatch(/needsClarification = true/);
    expect(code(server)).not.toMatch(/readyToConfirm = false/);
  });

  it('the client proposes as soon as the floor is met', () => {
    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    expect(onboarding).toMatch(/hasRetrievalConstraint\(merged\)[\s\S]{0,80}setStep\('confirming'\)/);
  });

  it('and the canonical validation the server does keep is untouched', () => {
    // Industry, size and state filtering against the supported sets is the
    // behaviour that must survive: it is what stops an unsupported value
    // reaching a query.
    expect(server).toMatch(/APOLLO_INDUSTRIES\.some\(ai => ai\.name\.toLowerCase\(\) === ind\.toLowerCase\(\)\)/);
    expect(server).toMatch(/COMPANY_SIZE_OPTIONS\.includes\(size\)/);
    expect(server).toMatch(/US_STATES\.includes\(loc\)/);
  });
});
