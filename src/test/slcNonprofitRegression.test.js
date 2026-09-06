/**
 * SLC nonprofit regression — locks the working flow before shared Barry code changes.
 *
 * The user's SLC-nonprofit ICP thread works correctly today:
 *   1. "Non-Profit" normalizes to "Non-Profit Organization Management"
 *   2. All three client writers (BarryICPPanel, DailyLeads, updateIcpFromChat)
 *      normalize before writing
 *   3. barryMissionChat post-validates against APOLLO_INDUSTRIES
 *   4. barryICPConversation post-validates against APOLLO_INDUSTRIES
 *   5. Canonical turns are shared across BarryChatPanel, BarryWorkspace,
 *      BarryICPPanel, and DailyLeads IcpReclarificationModal
 *   6. barryCanonical.stripIdentity blocks candidate PII from turn metadata
 *
 * This test suite must pass before AND after PR A (vocabulary normalization)
 * and PR B (Barry entry-point / session consistency). If any test fails after
 * a change, that change broke a working production flow.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeIndustry, normalizeCompanySize, normalizeLocation, MATCHED, AMBIGUOUS } from '../utils/normalizeTargeting.js';
import { normalizeIcpParams } from '../utils/normalizeIcpParams.js';
import { stripIdentity } from '../utils/barryCanonical.js';
import { APOLLO_INDUSTRIES, COMPANY_SIZE_OPTIONS } from '../constants/targetingCanon.js';

const here = import.meta.dirname || new URL('.', import.meta.url).pathname;
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

// ── T-1: "Non-Profit" normalizes to canonical Apollo name ────────────────────

describe('SLC nonprofit — T-1 normalization', () => {
  it('"Non-Profit" resolves to "Non-Profit Organization Management"', () => {
    const r = normalizeIndustry('Non-Profit');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Non-Profit Organization Management');
  });

  it('"nonprofit" (no hyphen) resolves to canonical', () => {
    const r = normalizeIndustry('nonprofit');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Non-Profit Organization Management');
  });

  it('"Non-Profit Organization Management" is an exact canonical match', () => {
    const r = normalizeIndustry('Non-Profit Organization Management');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Non-Profit Organization Management');
  });

  it('"Non-Profit Organization Management" exists in APOLLO_INDUSTRIES', () => {
    const names = APOLLO_INDUSTRIES.map(i => i.name);
    expect(names).toContain('Non-Profit Organization Management');
  });
});

// ── normalizeIcpParams deduplicates Non-Profit variants ──────────────────────

describe('SLC nonprofit — normalizeIcpParams', () => {
  it('deduplicates "Non-Profit" + "Non-Profit Organization Management"', () => {
    const result = normalizeIcpParams({
      industries: ['Non-Profit', 'Non-Profit Organization Management'],
    });
    expect(result.industries).toEqual(['Non-Profit Organization Management']);
  });

  it('normalizes a realistic SLC nonprofit ICP', () => {
    const result = normalizeIcpParams({
      industries: ['Non-Profit'],
      companySizes: ['51-100', '101-200'],
      locations: ['Utah'],
      targetTitles: ['Executive Director', 'Development Director'],
    });
    expect(result.industries).toEqual(['Non-Profit Organization Management']);
    expect(result.companySizes).toEqual(['51-100', '101-200']);
    expect(result.targetTitles).toEqual(['Executive Director', 'Development Director']);
  });

  it('passes through null/undefined without crashing', () => {
    expect(normalizeIcpParams(null)).toBe(null);
    expect(normalizeIcpParams(undefined)).toBe(undefined);
  });
});

// ── Canonical conversation store: all surfaces share one subcollection ───────

describe('SLC nonprofit — canonical conversation unity', () => {
  const barryCanonicalSrc = read('../utils/barryCanonical.js');

  it('barryCanonical reads/writes barryConversations/canonical/turns', () => {
    expect(barryCanonicalSrc).toMatch(/barryConversations.*canonical.*turns/);
  });

  it('BarryChatPanel uses barryCanonical for reads and writes', () => {
    const src = read('../components/dashboard/BarryChatPanel.jsx');
    expect(src).toMatch(/import\s*\{[^}]*loadOrSeedRecentTurns[^}]*\}\s*from\s*['"].*barryCanonical/);
    expect(src).toMatch(/import\s*\{[^}]*appendTurn[^}]*\}\s*from\s*['"].*barryCanonical/);
  });

  it('BarryWorkspace uses barryCanonical for reads and writes', () => {
    const src = read('../pages/Barry/BarryWorkspace.jsx');
    expect(src).toMatch(/import\s*\{[^}]*appendTurn[^}]*,\s*loadOrSeedRecentTurns[^}]*\}\s*from\s*['"].*barryCanonical/);
  });

  it('BarryICPPanel uses barryCanonical for reads and writes', () => {
    const src = read('../components/scout/BarryICPPanel.jsx');
    expect(src).toMatch(/import\s*\{[^}]*loadOrSeedRecentTurns[^}]*\}\s*from\s*['"].*barryCanonical/);
    expect(src).toMatch(/import\s*\{[^}]*appendTurn[^}]*\}\s*from\s*['"].*barryCanonical/);
  });
});

// ── Server-side post-validation: both backends validate against canonical ────

describe('SLC nonprofit — server-side post-validation', () => {
  it('barryMissionChat validates industries against APOLLO_INDUSTRIES', () => {
    const src = read('../../netlify/functions/barryMissionChat.js');
    expect(src).toMatch(/import\s*\{[^}]*APOLLO_INDUSTRIES[^}]*\}\s*from/);
    expect(src).toMatch(/APOLLO_INDUSTRIES/);
  });

  it('barryMissionChat validates companySizes against COMPANY_SIZE_OPTIONS', () => {
    const src = read('../../netlify/functions/barryMissionChat.js');
    expect(src).toMatch(/import\s*\{[^}]*COMPANY_SIZE_OPTIONS[^}]*\}\s*from/);
    expect(src).toMatch(/COMPANY_SIZE_OPTIONS/);
  });

  it('barryICPConversation validates industries against APOLLO_INDUSTRIES', () => {
    const src = read('../../netlify/functions/barryICPConversation.js');
    expect(src).toMatch(/understood\?\.industries[\s\S]{0,200}APOLLO_INDUSTRIES/);
  });

  it('barryICPConversation validates companySizes against COMPANY_SIZE_OPTIONS', () => {
    const src = read('../../netlify/functions/barryICPConversation.js');
    expect(src).toMatch(/understood\?\.companySizes[\s\S]{0,200}COMPANY_SIZE_OPTIONS/);
  });
});

// ── Client-side normalization: all three writers normalize before persisting ──

describe('SLC nonprofit — client-side normalization at write boundary', () => {
  it('BarryICPPanel normalizes before writing', () => {
    const src = read('../components/scout/BarryICPPanel.jsx');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpParams\)/);
  });

  it('DailyLeads IcpReclarificationModal normalizes before writing', () => {
    const src = read('../pages/Scout/DailyLeads.jsx');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpParams\)/);
  });

  it('updateIcpFromChat normalizes before writing', () => {
    const src = read('../utils/updateIcpFromChat.js');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpDelta\)/);
  });

  it('ICPSettings normalizes on load and save', () => {
    const src = read('../pages/Scout/ICPSettings.jsx');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(profile\)/);
    expect(src).toMatch(/normalizeIcpParams\(icp\)/);
  });
});

// ── Identity guard: candidate PII never reaches canonical turn metadata ──────

describe('SLC nonprofit — identity guard in canonical turns', () => {
  it('stripIdentity blocks email, phone, linkedin_url from meta', () => {
    const meta = {
      email: 'test@example.com',
      phone: '555-0100',
      linkedin_url: 'https://linkedin.com/in/test',
      sessionRef: 'sr_abc123',
      count: 5,
    };
    const clean = stripIdentity(meta);
    expect(clean).not.toHaveProperty('email');
    expect(clean).not.toHaveProperty('phone');
    expect(clean).not.toHaveProperty('linkedin_url');
    expect(clean).toHaveProperty('sessionRef', 'sr_abc123');
    expect(clean).toHaveProperty('count', 5);
  });

  it('stripIdentity blocks name, candidates, results, payloads', () => {
    const meta = {
      name: 'Jane Doe',
      candidates: [{ id: 1 }],
      results: [{ id: 2 }],
      payloads: [{ id: 3 }],
      count: 10,
    };
    const clean = stripIdentity(meta);
    expect(clean).not.toHaveProperty('name');
    expect(clean).not.toHaveProperty('candidates');
    expect(clean).not.toHaveProperty('results');
    expect(clean).not.toHaveProperty('payloads');
    expect(clean).toHaveProperty('count', 10);
  });
});

// ── Location normalization: Utah resolves for SLC targeting ──────────────────

describe('SLC nonprofit — location normalization', () => {
  it('"Utah" resolves as a canonical state', () => {
    const r = normalizeLocation('Utah');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Utah');
  });

  it('"UT" resolves to "Utah"', () => {
    const r = normalizeLocation('UT');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Utah');
  });

  it('"Salt Lake City, Utah" resolves to "Utah"', () => {
    const r = normalizeLocation('Salt Lake City, Utah');
    expect(r.status).toBe(MATCHED);
    expect(r.value).toBe('Utah');
  });

  it('"Salt Lake City" alone is unsupported (city without state)', () => {
    const r = normalizeLocation('Salt Lake City');
    expect(r.status).not.toBe(MATCHED);
  });
});

// ── Company size normalization: typical nonprofit ranges ─────────────────────

describe('SLC nonprofit — company size normalization', () => {
  it('"51-100" is a canonical bucket', () => {
    const r = normalizeCompanySize('51-100');
    expect(r.status).toBe(MATCHED);
    expect(r.values).toContain('51-100');
  });

  it('"50-200 employees" maps to overlapping canonical buckets', () => {
    const r = normalizeCompanySize('50-200 employees');
    expect(r.status).toBe(MATCHED);
    expect(r.values).toContain('51-100');
    expect(r.values).toContain('101-200');
    expect(r.values.every(v => COMPANY_SIZE_OPTIONS.includes(v))).toBe(true);
  });

  it('"mid-market" is ambiguous (no defensible employee count)', () => {
    const r = normalizeCompanySize('mid-market');
    expect(r.status).toBe(AMBIGUOUS);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

// ── BarryWorkspace suppresses sidecar when on /barry ─────────────────────────

describe('SLC nonprofit — no competing Barry surfaces', () => {
  it('MainLayout hides sidecar panel when on /barry', () => {
    const src = read('../components/layout/MainLayout.jsx');
    expect(src).toMatch(/onBarryPage.*=.*location\.pathname\s*===\s*['"]\/barry['"]/);
    expect(src).toMatch(/hidden.*=.*!barryOpen\s*\|\|\s*onBarryPage/);
  });

  it('BarryWorkspace declares one canonical conversation', () => {
    const src = read('../pages/Barry/BarryWorkspace.jsx');
    expect(src).toMatch(/Same canonical conversation as the Sidecar panel/);
    expect(src).toMatch(/One Barry, one conversation, different presentations/);
  });
});
