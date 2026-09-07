/**
 * Containment: ingestion must never fabricate an industry.
 *
 * Two fabrications were persisted as canonical company data:
 *
 *   1. `companyProfile.industries?.[0]` — stamped the user's OWN target
 *      industry onto a company the provider gave no industry for. That value
 *      then exact-matched the same ICP and scored 100 at full confidence: the
 *      system invented the evidence and then matched against it.
 *   2. the literal 'Unknown' — a truthy string, so icpScoring's
 *      honest-unknown branch never fired and the company scored 0 on the
 *      heaviest dimension while reporting the dimension as observed.
 *
 * Absent provider data must now be null, at every writer and in the Firestore
 * payload. These are source-level assertions because the writers are inside a
 * handler that needs live Apollo and Firestore credentials to execute.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');

const search = read('../../netlify/functions/search-companies.js');
const manual = read('../../netlify/functions/search-companies-manual.js');

/** Source with comments stripped, so prose about the defect is not mistaken for the defect. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const searchCode = code(search);
const manualCode = code(manual);

describe('no ICP echo — the company must not inherit the ICP it was searched against', () => {
  it('search-companies never reads companyProfile.industries[0] as a company industry', () => {
    expect(searchCode).not.toMatch(/companyProfile\.industries\?\.\[0\]/);
  });

  it('search-companies-manual never does either', () => {
    expect(manualCode).not.toMatch(/companyProfile\.industries\?\.\[0\]/);
  });
});

describe("no literal 'Unknown' industry", () => {
  it('the canonical writer resolves provider industry or null', () => {
    expect(searchCode).toMatch(
      /const industry = company\.industry \|\| company\.primary_industry \|\| null;/
    );
  });

  it('the manual writer resolves provider industry or null', () => {
    expect(manualCode).toMatch(
      /industry: company\.industry \|\| company\.primary_industry \|\| null,/
    );
  });

  it("neither live writer assigns the literal 'Unknown' to industry", () => {
    // Guards the exact regression, without tripping on unrelated 'Unknown'
    // usages such as the manual writer's `location` fallback.
    expect(searchCode).not.toMatch(/industry[^\n]*\|\|\s*'Unknown'/);
    expect(manualCode).not.toMatch(/industry[^\n]*\|\|\s*'Unknown'/);
  });
});

describe('the Firestore payload preserves absence', () => {
  it("writes nullValue rather than the string 'null'", () => {
    // String(null) === 'null' would swap one fabricated value for another.
    expect(searchCode).not.toMatch(/industry:\s*\{\s*stringValue:\s*String\(company\.industry\)\s*\}/);
    expect(searchCode).toMatch(/industry:\s*company\.industry[\s\S]{0,120}nullValue:\s*null/);
  });
});

describe('persisted narrative carries no fabricated industry either', () => {
  it('buildBarryIntel does not fall back to the ICP industry', () => {
    const at = searchCode.indexOf('function buildBarryIntel');
    expect(at).toBeGreaterThan(-1);
    const body = searchCode.slice(at, at + 600);
    expect(body).not.toMatch(/companyProfile\.industries/);
  });
});

describe('scoring treats the new null as unmeasured, not as a value', () => {
  it('resolveIndustry rejects null/empty and returns null', async () => {
    const { calculateICPScore, computeCoverage, generateMatchReasons } =
      await import('../utils/icpScoring.js');

    const icp = { industries: ['Publishing'], states: [], companySizes: [], revenueRanges: [] };
    const company = { name: 'Acme', industry: null, revenue: '$3B' };

    // Not evaluated at all: out of numerator AND denominator.
    expect(calculateICPScore(company, icp)).toBeNull();

    const cov = computeCoverage(company, icp);
    expect(cov.unknown).toContain('industry');
    expect(cov.observed).not.toContain('industry');
    expect(cov.complete).toBe(false);

    // And it must not claim the company is outside the target industries.
    expect(generateMatchReasons(company, icp).join(' ')).not.toMatch(/Outside your target/);
  });

  it("the old 'Unknown' string would have been scored as real evidence — the regression this prevents", async () => {
    const { calculateICPScore, computeCoverage } = await import('../utils/icpScoring.js');
    const icp = { industries: ['Publishing'], states: [], companySizes: [], revenueRanges: [] };

    const fabricated = { name: 'Acme', industry: 'Unknown' };
    expect(calculateICPScore(fabricated, icp)).toBe(0);
    expect(computeCoverage(fabricated, icp).observed).toContain('industry');

    const honest = { name: 'Acme', industry: null };
    expect(calculateICPScore(honest, icp)).toBeNull();
    expect(computeCoverage(honest, icp).unknown).toContain('industry');
  });
});
