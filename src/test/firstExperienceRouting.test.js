/**
 * One canonical Barry First Experience route.
 *
 * Two first-run flows used to exist, and which one a user got depended on how
 * they arrived: checkout sent them to BarryOnboarding, which created an ICP and
 * ran a search; visiting the site root sent them to OnboardingFlow, which
 * created neither. Both marked the user onboarded. Every legacy path now
 * redirects into one route.
 *
 * The redirects include three existing-user affordances ("Review ICP with
 * Barry"). That is only correct because the route resumes rather than
 * restarts — asserted in firstExperienceResume.test.
 *
 * Asserted against the source: App.jsx mounts the whole application, and what
 * matters here is a property of the route table.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const app = read('../App.jsx');

describe('the canonical route', () => {
  it('/onboarding redirects to /barry', () => {
    expect(app).toMatch(/<Route path="\/onboarding" element=\{<Navigate to="\/barry" replace \/>\}/);
  });

  it('/barry renders the Barry Workspace', () => {
    expect(app).toMatch(/path="\/barry"\s+element=\{<BarryWorkspace/);
  });

  it('no onboarding route renders a component — all redirect to /barry', () => {
    const onboardingRoutes = [...app.matchAll(/<Route path="(\/onboarding[^"]*)" element=\{([^}]*)\}/g)];

    const withComponent = onboardingRoutes.filter(m => !m[2].includes('Navigate'));
    expect(withComponent).toHaveLength(0);
  });
});

describe('every legacy onboarding path redirects into it', () => {
  it.each([
    '/onboarding/flow',
    '/onboarding/recon',
    '/onboarding/barry',
    '/onboarding/company-profile',
  ])('%s redirects', (path) => {
    const pattern = new RegExp(`<Route path="${path}" element=\\{<Navigate to="/barry" replace />\\}`);
    expect(app).toMatch(pattern);
  });

  it('the retired flows are no longer imported', () => {
    expect(app).not.toMatch(/import OnboardingFlow/);
    expect(app).not.toMatch(/import ReconOnboardingWizard/);
    expect(app).not.toMatch(/import CompanyQuestionnaire/);
    expect(app).not.toMatch(/import BarryOnboarding/);
  });
});

describe('every entry point lands on the canonical route', () => {
  it.each([
    ['../pages/CheckoutSuccessPage.jsx', 'checkout success'],
    ['../pages/Scout/MissionControlDashboardV2.jsx', 'Mission Control'],
    ['../pages/Scout/DailyLeads.jsx', 'Daily Leads'],
    ['../pages/ScoutDashboardPage.jsx', 'Scout dashboard'],
  ])('%s no longer points at a retired path', (rel) => {
    const src = read(rel);

    expect(src).not.toMatch(/\/onboarding\/barry/);
    expect(src).not.toMatch(/\/onboarding\/company-profile/);
    expect(src).not.toMatch(/\/onboarding\/flow/);
  });

  it('checkout success sends new users to the canonical route', () => {
    expect(read('../pages/CheckoutSuccessPage.jsx')).toMatch(/navigate\('\/onboarding'\)/);
  });

  it('the existing-user affordances point there too, declaring why they came', () => {
    // They navigate to the same canonical route, carrying transient arrival
    // intent so an explicit review outranks generic resume state. Precedence
    // itself is covered in firstExperienceResume.test.
    for (const rel of ['../pages/Scout/MissionControlDashboardV2.jsx', '../pages/Scout/DailyLeads.jsx']) {
      expect(read(rel)).toMatch(/navigate\('\/onboarding', \{ state: \{ arrival: ARRIVAL_REVIEW_ICP \} \}\)/);
    }
  });

  it('SmartRedirect targets /barry directly', () => {
    expect(app).toMatch(/return <Navigate to="\/barry" \/>/);
  });
});

describe('the shell', () => {
  const shell = read('../pages/Onboarding/FirstExperience.jsx');

  it('resolves WHO through the shared contract', () => {
    expect(shell).toMatch(/import \{ resolveWho, rememberName, WHO_PROMPT \}/);
  });

  it('asks the WHO question at most once per session, without a persisted flag', () => {
    expect(shell).toMatch(/sessionStorage/);
    // A stored "we asked already" field would be a completion state in
    // disguise, which is exactly what this phase removes.
    expect(shell).not.toMatch(/whoAsked|askedName|onboardingWho/);
  });

  it('never blocks on the name — skipping continues', () => {
    expect(shell).toMatch(/function skipName/);
    expect(shell).toMatch(/setAskingName\(false\)/);
  });

  it('a failed user-document read does not stop the experience', () => {
    expect(shell).toMatch(/user document read failed/);
  });

  it('passes the resolved name to the conversation rather than re-asking', () => {
    expect(shell).toMatch(/<BarryOnboarding knownName=/);
  });
});

describe('the delegated conversation stays intact', () => {
  const barry = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('accepts the name additively, defaulting to previous behaviour', () => {
    // B5 added `goal` — the transient restatement of the intent turn, so the
    // proposal can open with what Barry thinks the user wants rather than a
    // field list. Both props default to null, so the component still behaves
    // exactly as before when neither is supplied.
    expect(barry).toMatch(/function BarryOnboarding\(\{ knownName = null, goal = null \} = \{\}\)/);
  });

  it('greets by name when one is known', () => {
    expect(barry).toMatch(/Good to meet you, \$\{knownName\}/);
  });

  it('the Phase 1B confirmation sequence is untouched', () => {
    // resolve → authoritative write → activate → projection → D7 → attributed search
    expect(barry).toMatch(/resolveActiveIcp\(user\.uid\)/);
    expect(barry).toMatch(/'icpProfiles', icpId/);
    expect(barry).toMatch(/setActiveIcpProfile\(user\.uid, icpId\)/);
    expect(barry).toMatch(/icpIdSource: 'barry_onboarding_confirmed'/);
    expect(barry).toMatch(/hasRetrievalConstraint/);
  });
});
