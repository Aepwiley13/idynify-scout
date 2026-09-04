/**
 * Targeting canon contract — every ICP writer persists the same vocabulary.
 *
 * Tests that:
 * - normalizeIcpParams translates Barry free-form to canonical
 * - barryMissionChat post-validates icp_params against canonical lists
 * - all client-side writers call normalizeIcpParams before writing
 * - duplicate semantic values (e.g. "Non-Profit" + "Non-Profit Organization Management")
 *   cannot coexist in one ICP
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeIcpParams } from '../utils/normalizeIcpParams.js';
import { COMPANY_SIZE_OPTIONS } from '../constants/targetingCanon.js';

const here = import.meta.dirname || new URL('.', import.meta.url).pathname;
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

// ── normalizeIcpParams unit tests ─────────────────────────────────────────────

describe('normalizeIcpParams', () => {
  it('passes through null/undefined', () => {
    expect(normalizeIcpParams(null)).toBe(null);
    expect(normalizeIcpParams(undefined)).toBe(undefined);
  });

  it('translates free-form industry aliases to canonical Apollo names', () => {
    const result = normalizeIcpParams({
      industries: ['saas', 'healthcare', 'marketing'],
    });
    expect(result.industries).toEqual([
      'Computer Software',
      'Hospital & Health Care',
      'Marketing and Advertising',
    ]);
  });

  it('preserves already-canonical industry names', () => {
    const result = normalizeIcpParams({
      industries: ['Non-Profit Organization Management', 'Real Estate'],
    });
    expect(result.industries).toEqual([
      'Non-Profit Organization Management',
      'Real Estate',
    ]);
  });

  it('drops unsupported industry values silently', () => {
    const result = normalizeIcpParams({
      industries: ['Computer Software', 'totally-made-up-industry'],
    });
    expect(result.industries).toEqual(['Computer Software']);
  });

  it('deduplicates industries after normalization', () => {
    const result = normalizeIcpParams({
      industries: ['saas', 'Computer Software', 'software'],
    });
    expect(result.industries).toEqual(['Computer Software']);
  });

  it('translates non-canonical company sizes via bucket overlap', () => {
    const result = normalizeIcpParams({
      companySizes: ['501-1000'],
    });
    expect(result.companySizes).toContain('501-1,000');
    expect(result.companySizes.every(s => COMPANY_SIZE_OPTIONS.includes(s))).toBe(true);
  });

  it('preserves already-canonical company sizes', () => {
    const result = normalizeIcpParams({
      companySizes: ['501-1,000', '1,001-2,000'],
    });
    expect(result.companySizes).toEqual(['501-1,000', '1,001-2,000']);
  });

  it('drops unsupported company size values', () => {
    const result = normalizeIcpParams({
      companySizes: ['501-1,000', 'mid-market'],
    });
    expect(result.companySizes).toEqual(['501-1,000']);
  });

  it('passes through non-targeting fields untouched', () => {
    const result = normalizeIcpParams({
      industries: ['saas'],
      targetTitles: ['VP of Sales'],
      companyKeywords: ['b2b', 'enterprise'],
    });
    expect(result.targetTitles).toEqual(['VP of Sales']);
    expect(result.companyKeywords).toEqual(['b2b', 'enterprise']);
  });
});

// ── "Non-Profit" coexistence test ─────────────────────────────────────────────

describe('duplicate semantic values', () => {
  it('"Non-Profit" and "Non-Profit Organization Management" normalize to the same value', () => {
    const result = normalizeIcpParams({
      industries: ['Non-Profit', 'Non-Profit Organization Management'],
    });
    const unique = [...new Set(result.industries)];
    expect(unique.length).toBe(1);
  });

  it('onboarding "Non-Profit" normalizes to canonical Apollo name', () => {
    const result = normalizeIcpParams({ industries: ['Non-Profit'] });
    expect(result.industries).toEqual(['Non-Profit Organization Management']);
  });
});

// ── barryMissionChat server-side validation ───────────────────────────────────

describe('barryMissionChat post-validation', () => {
  const src = read('../../netlify/functions/barryMissionChat.js');

  it('imports canonical targeting vocabulary', () => {
    expect(src).toMatch(/import\s*\{[^}]*APOLLO_INDUSTRIES[^}]*\}\s*from/);
    expect(src).toMatch(/import\s*\{[^}]*COMPANY_SIZE_OPTIONS[^}]*\}\s*from/);
  });

  it('validates icp_params.industries against APOLLO_INDUSTRIES', () => {
    expect(src).toMatch(/icp_params[\s\S]{0,200}industries[\s\S]{0,400}APOLLO_INDUSTRIES/);
  });

  it('validates icp_params.companySizes against COMPANY_SIZE_OPTIONS', () => {
    expect(src).toMatch(/icp_params[\s\S]{0,200}companySizes[\s\S]{0,400}COMPANY_SIZE_OPTIONS/);
  });

  it('provides Claude the canonical industry list in the prompt', () => {
    expect(src).toMatch(/EXACT industry names from this list/);
    expect(src).toMatch(/APOLLO_INDUSTRIES\.map/);
  });

  it('provides Claude the canonical size list in the prompt', () => {
    expect(src).toMatch(/EXACT values from this list.*COMPANY_SIZE_OPTIONS/);
  });
});

// ── Client-side writers use normalizeIcpParams ───────────────────────────────

describe('client writers normalize before persisting', () => {
  it('BarryICPPanel imports and calls normalizeIcpParams', () => {
    const src = read('../components/scout/BarryICPPanel.jsx');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpParams\)/);
  });

  it('DailyLeads IcpReclarificationModal imports and calls normalizeIcpParams', () => {
    const src = read('../pages/Scout/DailyLeads.jsx');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpParams\)/);
  });

  it('updateIcpFromChat imports and calls normalizeIcpParams', () => {
    const src = read('../utils/updateIcpFromChat.js');
    expect(src).toMatch(/import\s*\{[^}]*normalizeIcpParams[^}]*\}/);
    expect(src).toMatch(/normalizeIcpParams\(icpDelta\)/);
  });

  it('BarryICPPanel merges normalized.industries, not raw icpParams.industries', () => {
    const src = read('../components/scout/BarryICPPanel.jsx');
    const mergeBlock = src.slice(
      src.indexOf('const mergedProfile'),
      src.indexOf('// Authoritative first')
    );
    expect(mergeBlock).toMatch(/normalized\.industries/);
    expect(mergeBlock).not.toMatch(/icpParams\.industries/);
  });

  it('DailyLeads merges normalized.industries, not raw icpParams.industries', () => {
    const src = read('../pages/Scout/DailyLeads.jsx');
    const mergeAt = src.indexOf('const mergedProfile', src.indexOf('IcpReclarificationModal'));
    const authAt = src.indexOf('// Authoritative first', mergeAt);
    const mergeBlock = src.slice(mergeAt, authAt);
    expect(mergeBlock).toMatch(/normalized\.industries/);
    expect(mergeBlock).not.toMatch(/icpParams\.industries/);
  });
});

// ── ICPSettings already uses canonical vocabulary ────────────────────────────

describe('ICPSettings writes canonical vocabulary', () => {
  const src = read('../pages/Scout/ICPSettings.jsx');

  it('imports APOLLO_INDUSTRIES from apolloIndustries.js', () => {
    expect(src).toMatch(/import\s*\{[^}]*APOLLO_INDUSTRIES[^}]*\}\s*from\s*['"].*apolloIndustries/);
  });

  it('does not import INDUSTRIES from icpOptions.js', () => {
    expect(src).not.toMatch(/import\s*\{[^}]*\bINDUSTRIES\b[^}]*\}\s*from\s*['"].*icpOptions/);
  });
});

// ── barryICPConversation already validates (regression guard) ─────────────────

describe('barryICPConversation validation (regression guard)', () => {
  const src = read('../../netlify/functions/barryICPConversation.js');

  it('post-validates industries against APOLLO_INDUSTRIES', () => {
    expect(src).toMatch(/understood\?\.industries[\s\S]{0,200}APOLLO_INDUSTRIES/);
  });

  it('post-validates companySizes against COMPANY_SIZE_OPTIONS', () => {
    expect(src).toMatch(/understood\?\.companySizes[\s\S]{0,200}COMPANY_SIZE_OPTIONS/);
  });
});
