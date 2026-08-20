/**
 * B9 — the legacy First Experience is gone, and nothing went with it.
 *
 * Deletion tests are worth writing for one reason: they are the only thing that
 * distinguishes "retired because nothing reached it" from "removed because it
 * was in the way". Each assertion below either proves a component was
 * unreachable before it went, or proves that something which must survive did.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { COMPANY_SIZES } from '../constants/icpOptions.js';
import { COMPANY_SIZE_OPTIONS } from '../constants/targetingCanon.js';
import { normalizeCompanySize, MATCHED } from '../utils/normalizeTargeting.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const exists = rel => existsSync(resolve(here, rel));
/** Source with comments removed — comments name the things code must not do. */
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every source file in the app, so "no reference anywhere" is literal. */
function allSources(dir = resolve(here, '..'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      allSources(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push([full.slice(full.indexOf('/src/') + 1), readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

const SOURCES = allSources();

describe('1 — OnboardingFlow is retired, and was unreachable first', () => {
  it('the file is gone', () => {
    expect(exists('../pages/Onboarding/OnboardingFlow.jsx')).toBe(false);
  });

  it('no source file imports or renders it', () => {
    for (const [path, src] of SOURCES) {
      expect(src, `${path} still references OnboardingFlow`).not.toMatch(/import\s+OnboardingFlow|<OnboardingFlow/);
    }
  });

  it('no route element resolves to it', () => {
    const app = read('../App.jsx');
    expect(app).not.toMatch(/OnboardingFlow/);
  });

  it('the legacy URLs still redirect — the paths are compatibility, not the component', () => {
    // Someone with a bookmark to /onboarding/flow must still land somewhere
    // useful. Retiring the component is not the same as breaking the address.
    const app = read('../App.jsx');
    for (const path of ['/onboarding/flow', '/onboarding/recon', '/onboarding/barry', '/onboarding/company-profile']) {
      expect(app, `${path} no longer redirects`).toMatch(
        new RegExp(`path="${path}"[^>]*<Navigate to="/onboarding" replace`)
      );
    }
  });

  it('the canonical route still resolves to the First Experience', () => {
    expect(read('../App.jsx')).toMatch(/path="\/onboarding" element=\{<ProtectedRoute><FirstExperience \/><\/ProtectedRoute>\}/);
  });
});

describe('2 — the four smart questions no longer participate', () => {
  const FIELDS = ['excludedIndustries', 'idealCustomerTypes', 'perfectCustomer'];

  it.each(FIELDS)('%s is collected nowhere', (field) => {
    for (const [path, src] of SOURCES) {
      expect(src, `${path} still collects ${field}`).not.toContain(field);
    }
  });

  it('valueProposition is never collected — only read where it already exists', () => {
    // A field of the same name survives in two legitimate places: the website
    // accelerator reads it out of analyze-website's output, and RECON's
    // alignment brief displays a stored value. Neither asks anyone anything.
    // What must not exist anywhere is a form binding that collects it.
    for (const [path, src] of SOURCES) {
      if (path.includes('ImprovedScoutQuestionnaire')) continue; // unroutable — asserted below
      expect(src, `${path} collects valueProposition`).not.toMatch(
        /handleInputChange\('valueProposition'|answers\.valueProposition|name="valueProposition"/
      );
    }
  });

  it('the questionnaire that asked for it is unroutable', () => {
    const app = read('../App.jsx');
    expect(app).not.toMatch(/ImprovedScoutQuestionnaire/);
    expect(app).toMatch(/path="\/scout-questionnaire" element=\{<Navigate/);
  });

  it('no First Experience surface asks any of them', () => {
    for (const rel of [
      '../pages/Onboarding/FirstExperience.jsx',
      '../pages/Onboarding/BarryOnboarding.jsx',
      '../components/onboarding/TargetingProposal.jsx',
      '../components/onboarding/RelationshipFirstValue.jsx',
    ]) {
      const src = read(rel);
      for (const field of [...FIELDS, 'valueProposition']) {
        expect(src, `${rel} asks for ${field}`).not.toContain(field);
      }
    }
  });
});

describe('3 — historical stored values are untouched', () => {
  it('nothing deletes, migrates or rewrites the retired fields', () => {
    for (const [path, src] of SOURCES) {
      expect(src, `${path} migrates retired fields`).not.toMatch(
        /deleteField\(\)[\s\S]{0,120}(excludedIndustries|idealCustomerTypes|perfectCustomer)/
      );
      expect(code(src), `${path} backfills retired fields`).not.toMatch(/migrateRecon|rewriteRecon|backfillRecon/i);
    }
  });

  it('the compatibility flags all still exist', () => {
    // Retiring a screen must not retire the routing state that decides whether
    // anyone sees it.
    const app = read('../App.jsx');
    expect(app).toMatch(/onboardingComplete/);
    expect(app).toMatch(/onboarding\?\.completed/);

    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    expect(onboarding).toMatch(/onboardingComplete: true/);
    expect(onboarding).toMatch(/onboardingSource: 'barry_onboarding'/);
    expect(onboarding).toMatch(/hasSeenMCWelcome: false/);
    expect(onboarding).toMatch(/barryState:/);
  });
});

describe('4 — ICPConfirmationCard is deleted, and was unreachable first', () => {
  it('both files are gone', () => {
    expect(exists('../components/onboarding/ICPConfirmationCard.jsx')).toBe(false);
    expect(exists('../components/onboarding/ICPConfirmationCard.css')).toBe(false);
  });

  it('no source file references it', () => {
    for (const [path, src] of SOURCES) {
      expect(src, `${path} still references ICPConfirmationCard`).not.toContain('ICPConfirmationCard');
    }
  });

  it('the confirmation experience that replaced it is still wired', () => {
    // The card went because a proposal took its place, not because
    // confirmation stopped mattering.
    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    expect(onboarding).toContain('TargetingProposal');
    expect(onboarding).toMatch(/onConfirm=\{handleConfirm\}/);
  });
});

describe('5 — DATA-1: one targeting-size vocabulary for new writes', () => {
  it('the editor vocabulary is the canonical one', () => {
    expect(COMPANY_SIZES).toEqual(COMPANY_SIZE_OPTIONS);
  });

  it('every value an editor can now write is accepted by the normalizer', () => {
    for (const size of COMPANY_SIZES) {
      const r = normalizeCompanySize(size);
      expect(r.status, size).toBe(MATCHED);
      expect(r.values, size).toEqual([size]);
    }
  });

  it('the coarse buckets are no longer offered anywhere', () => {
    // '11-50', '51-200', '201-1000' and '1000+' are not Apollo employee ranges;
    // the conversational path would have rejected every one of them.
    for (const stale of ['11-50', '51-200', '201-1000', '1000+']) {
      expect(COMPANY_SIZES, `${stale} is still offered`).not.toContain(stale);
    }
  });

  it('there is one definition, not two', () => {
    const src = read('../constants/icpOptions.js');
    expect(src).toMatch(/export \{ COMPANY_SIZE_OPTIONS as COMPANY_SIZES \} from '\.\/targetingCanon\.js'/);
    expect(code(src)).not.toMatch(/'11-50'|'51-200'|'201-1000'|'1000\+'/);
  });

  it('nothing on the targeting path reinterprets a stored coarse value on read', () => {
    // Reading '201-1000' and silently answering '201-500' would rewrite the
    // user's targeting without anyone deciding to. Scoped to the files that
    // actually reach a query — an unreachable module carrying its own stale
    // vocabulary is recorded as CLEANUP-3, not silently edited here.
    const targetingPath = SOURCES.filter(([, src]) =>
      /targetingCanon|normalizeTargeting|icpOptions|targetingProposal/.test(src)
    );
    expect(targetingPath.length).toBeGreaterThan(3);
    for (const [path, src] of targetingPath) {
      expect(code(src), `${path} maps legacy sizes on read`).not.toMatch(/'201-1000'\s*:|'1000\+'\s*:|LEGACY_SIZE/);
    }
  });
});

describe('6 — the retirement removed no capability that still had one', () => {
  it('the canonical First Experience is intact end to end', () => {
    const shell = read('../pages/Onboarding/FirstExperience.jsx');
    expect(shell).toContain('resolveWho');
    expect(shell).toContain('OPENING_QUESTION');
    expect(shell).toContain('routeIntent');
    expect(shell).toContain('BarryOnboarding');
    expect(shell).toContain('RelationshipFirstValue');
  });

  it('the Phase 1B confirmation sequence is untouched', () => {
    const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
    expect(onboarding).toMatch(/const resolution = await resolveActiveIcp\(user\.uid\)/);
    expect(onboarding).toMatch(/reason === 'read-failed'[\s\S]{0,400}throw new Error/);
    expect(onboarding).toContain('setActiveIcpProfile(user.uid, icpId)');
    expect(onboarding).toMatch(/icpId, icpIdSource: 'barry_onboarding_confirmed'/);
    expect(onboarding).toMatch(/const canSearch = hasRetrievalConstraint\(icpProfile\)/);
    expect(onboarding).toMatch(/canSearch \? 'SEARCHING' : 'NEEDS_TARGETING'/);
  });

  it('the website accelerator still reaches analyze-website', () => {
    expect(read('../pages/Onboarding/BarryOnboarding.jsx')).toContain('/.netlify/functions/analyze-website');
  });
});
