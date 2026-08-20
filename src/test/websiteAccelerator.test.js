/**
 * B7 — the website accelerator.
 *
 * The website is a shortcut, never a step. What is under test is mostly what
 * Barry must NOT do with it: claim facts the source does not produce, turn
 * free text into structured targeting by approximation, or let anything it
 * found become authoritative without the user saying yes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APOLLO_INDUSTRIES, COMPANY_SIZE_OPTIONS, US_STATES } from '../constants/targetingCanon.js';
import { readWebsite, acceleratorQuestion, WEBSITE_FIELDS } from '../utils/websiteAccelerator.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const INDUSTRY_NAMES = APOLLO_INDUSTRIES.map(i => i.name);

const ok = (over = {}) => ({
  success: true,
  data: {
    companyName: 'Northwind Roofing',
    description: 'Commercial roofing across the Gulf Coast.',
    whatTheySell: 'Roof replacement and maintenance',
    whoTheyServeTo: 'Commercial property managers',
    targetIndustry: 'Construction',
    targetCompanySize: '50-200 employees',
    valueProposition: 'Fewer surprises on the roof line.',
    icpSummary: 'Property managers of mid-size commercial portfolios.',
    confidence: 78,
    ...over,
  },
});

describe('1 — the contract matches what analyze-website actually returns', () => {
  it('names exactly the eight fields the function produces', () => {
    const fn = read('../../netlify/functions/analyze-website.js');
    const declared = fn.slice(fn.indexOf('export const EXTRACTION_FIELDS'), fn.indexOf(']', fn.indexOf('export const EXTRACTION_FIELDS')));
    for (const field of WEBSITE_FIELDS) {
      expect(declared, `analyze-website does not produce ${field}`).toContain(`'${field}'`);
    }
    expect(WEBSITE_FIELDS).toHaveLength(8);
  });

  it('reads no field the source does not produce', () => {
    const src = code(read('../utils/websiteAccelerator.js'));
    for (const invented of ['headquarters', 'employeeCount', 'competitors', 'revenue', 'role', 'teamSize', 'location']) {
      expect(src, `reads data.${invented}`).not.toMatch(new RegExp(`data\\.${invented}`));
    }
  });
});

describe('2 — website free text goes through T-1, and only supported values survive', () => {
  it('a canonical industry comes through', () => {
    const r = readWebsite(ok());
    expect(r.proposed.industries).toEqual(['Construction']);
  });

  it('a stated headcount range becomes real buckets', () => {
    const r = readWebsite(ok());
    for (const v of r.proposed.companySizes) expect(COMPANY_SIZE_OPTIONS).toContain(v);
    expect(r.proposed.companySizes.length).toBeGreaterThan(0);
  });

  it('"Mid-market" never becomes an employee filter', () => {
    // This is the common case for website copy, and the one where a guess
    // would put a fabricated size filter on a real search.
    const r = readWebsite(ok({ targetCompanySize: 'Mid-market' }));
    expect(r.proposed.companySizes).toEqual([]);
    expect(r.questions.some(q => q.field === 'companySize')).toBe(true);
  });

  it('an unsupported industry phrase is dropped, not approximated', () => {
    const r = readWebsite(ok({ targetIndustry: 'vibes-based commerce' }));
    expect(r.proposed.industries).toEqual([]);
    expect(r.dropped.some(d => d.input === 'vibes-based commerce')).toBe(true);
  });

  it('a partially mappable phrase keeps the half that mapped', () => {
    const r = readWebsite(ok({ targetIndustry: 'healthcare and adjacent services' }));
    expect(r.proposed.industries).toEqual(['Hospital & Health Care']);
    expect(r.dropped.some(d => d.input === 'adjacent services')).toBe(true);
  });

  it('every emitted value is canonical, across a spread of real-looking copy', () => {
    const phrases = [
      'Construction', 'healthcare and adjacent services', 'SaaS companies', 'manufacturing',
      'vibes-based commerce', '', 'law firms and accounting practices',
    ];
    const sizes = ['50-200 employees', 'Mid-market', 'SMB', 'enterprise', '', '10-50', '5000+'];
    for (const targetIndustry of phrases) {
      for (const targetCompanySize of sizes) {
        const r = readWebsite(ok({ targetIndustry, targetCompanySize }));
        for (const v of r.proposed.industries) expect(INDUSTRY_NAMES).toContain(v);
        for (const v of r.proposed.companySizes) expect(COMPANY_SIZE_OPTIONS).toContain(v);
        for (const v of r.proposed.locations) expect(US_STATES).toContain(v);
      }
    }
  });
});

describe('3 — nothing the source does not produce is ever claimed', () => {
  it('no location is ever derived from a website', () => {
    // analyze-website does not produce the user's location, and inferring
    // their market from their own address would be a fabrication.
    for (const copy of ['Serving the Gulf Coast from Houston, Texas', 'Nationwide coverage', '']) {
      const r = readWebsite(ok({ description: copy, valueProposition: copy }));
      expect(r.proposed.locations).toEqual([]);
      expect(r.proposed.isNationwide).toBe(false);
    }
  });

  it('the accelerator asks T-1 for industry and size only', () => {
    const src = read('../utils/websiteAccelerator.js');
    const call = src.slice(src.indexOf('normalizeTargetingText({'), src.indexOf('});', src.indexOf('normalizeTargetingText({')));
    expect(call).toContain('industry:');
    expect(call).toContain('companySize:');
    expect(call).not.toContain('location:');
  });

  it('says nothing rather than something generic when the read is thin', () => {
    const r = readWebsite(ok({ whoTheyServeTo: '', whatTheySell: '' }));
    expect(r.recognition).toBeNull();
  });

  it('flags a low-confidence read rather than presenting it as settled', () => {
    expect(readWebsite(ok({ confidence: 20 })).lowConfidence).toBe(true);
    expect(readWebsite(ok({ confidence: 78 })).lowConfidence).toBe(false);
  });
});

describe('4 — a failed read is a normal outcome, not an error to resolve', () => {
  it.each([
    ['a blocked site', { success: false, message: "That site is blocking automated visitors." }],
    ['no payload', null],
    ['a malformed payload', { success: true }],
  ])('%s carries on without targeting', (_label, payload) => {
    const r = readWebsite(payload);
    expect(r.ok).toBe(false);
    expect(r.proposed).toEqual({ industries: [], companySizes: [], locations: [], isNationwide: false });
  });

  it('passes the function\'s own friendly sentence through', () => {
    const r = readWebsite({ success: false, message: 'That site took too long to respond.' });
    expect(r.message).toBe('That site took too long to respond.');
  });
});

describe('5 — the user never learns that translation happened', () => {
  it('the recognition line is about their business, not about fields', () => {
    const r = readWebsite(ok());
    expect(r.recognition).toBe('It looks like you help commercial property managers with roof replacement and maintenance.');
    expect(r.recognition).not.toMatch(/industry|field|map|normaliz|bucket|Apollo/i);
  });

  it('the clarification asks about the business, not about an unmapped field', () => {
    const q = acceleratorQuestion(readWebsite(ok({ targetCompanySize: 'Mid-market' })));
    expect(q).toMatch(/how big are the companies/i);
    expect(q).not.toMatch(/mid-market|bucket|range|supported|couldn't map/i);
  });

  it('there is no question when nothing needs asking', () => {
    expect(acceleratorQuestion(readWebsite(ok()))).toBeNull();
    expect(acceleratorQuestion(null)).toBeNull();
  });

  it('no user-facing string exposes implementation language', () => {
    const banned = /normaliz|canonical|enumerat|Apollo|T-1|retrieval constraint|\bD7\b/i;
    for (const size of ['Mid-market', '50-200 employees', 'SMB']) {
      const r = readWebsite(ok({ targetCompanySize: size }));
      const copy = [r.recognition, r.summary, r.message, acceleratorQuestion(r)].filter(Boolean).join(' ');
      expect(copy).not.toMatch(banned);
    }
  });
});

describe('6 — it is an accelerator, not a step', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('is offered once, before the conversation starts, and never returns', () => {
    expect(onboarding).toMatch(/step === 'asking' && conversationHistory\.length === 0 && !reading/);
  });

  it('nothing is gated on having used it', () => {
    const body = code(onboarding);
    // No branch anywhere requires a website read to proceed.
    expect(body).not.toMatch(/if \(!reading\)[\s\S]{0,80}return;/);
    expect(body).not.toMatch(/websiteRequired|mustAnalyze|requireWebsite/);
  });

  it('a failed read returns the user to the conversation', () => {
    expect(onboarding).toMatch(/if \(!result\.ok\)[\s\S]{0,500}setStep\('asking'\)/);
  });

  it('conversation always wins over the site', () => {
    // Anything the user established by talking is not overwritten by a later
    // read of their own marketing copy.
    expect(onboarding).toMatch(/prior\.industries\?\.length \? prior\.industries : result\.proposed\.industries/);
  });
});

describe('7 — no website-derived targeting bypasses confirmation', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
  const accelerator = read('../utils/websiteAccelerator.js');

  it('the accelerator module cannot persist or search', () => {
    const body = code(accelerator);
    expect(body).not.toMatch(/setDoc|updateDoc|addDoc|icpProfiles|companyProfile|search-companies|setActiveIcpProfile/);
  });

  it('a website read proposes and then waits', () => {
    // It may reach the proposal, and the proposal's only forward action is the
    // confirmation event.
    expect(onboarding).toMatch(/if \(hasRetrievalConstraint\(next\)\)[\s\S]{0,200}setStep\('confirming'\)/);
    const handler = onboarding.slice(onboarding.indexOf('async function analyzeSite'), onboarding.indexOf('async function saveConversationState'));
    expect(handler).not.toMatch(/setDoc|search-companies|icpProfiles|setActiveIcpProfile|handleConfirm/);
  });

  it('the creation event is still reached only from confirm', () => {
    expect(onboarding).toMatch(/onConfirm=\{handleConfirm\}/);
    expect(onboarding).toMatch(/const resolution = await resolveActiveIcp\(user\.uid\)/);
  });

  it('a site that yields no supported constraint asks instead of proposing', () => {
    expect(onboarding).toMatch(/const question = acceleratorQuestion\(result\)[\s\S]{0,300}setStep\('asking'\)/);
  });

  it('and the search is still gated on the floor with an explicit identity', () => {
    expect(onboarding).toMatch(/const canSearch = hasRetrievalConstraint\(icpProfile\)/);
    expect(onboarding).toMatch(/canSearch \? 'SEARCHING' : 'NEEDS_TARGETING'/);
  });
});
