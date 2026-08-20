/**
 * Tier 1 ICP identity invariants, asserted against the source.
 *
 * These guard rules that are easy to re-break by adding one new call site. The
 * precedent is dailyDiscoveriesIcpTargeting.test — rendering these surfaces
 * means mounting the entire Scout queue and opening Firestore connections, and
 * what matters here is a property of the code, not of one rendered instance.
 *
 * The rules, in one sentence each:
 *   1. No path converts an unresolved ICP identity into DEFAULT_ICP_ID.
 *   2. Onboarding creates an ICP only inside the explicit confirmation handler.
 *   3. Every search-companies caller carries an explicit identity or declines.
 *   4. The scheduled refresh skips a user it cannot resolve; it does not fail.
 *   5. Relationship-oriented Barry keeps working with no ICP at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');

/** Source with block and line comments removed — comments may name what code must not do. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('1 — unresolved identity is never converted to DEFAULT_ICP_ID', () => {
  const resolvers = [
    'the client resolver',
    'the server resolver',
  ];

  it.each([
    ['../utils/resolveActiveIcp.js', resolvers[0]],
    ['../../netlify/functions/utils/resolveActiveIcp.js', resolvers[1]],
  ])('%s contains no default-id fallback', (path) => {
    expect(code(read(path))).not.toMatch(/DEFAULT_ICP_ID|['"]default['"]/);
  });

  it('search-companies no longer stamps discovered companies with a default id', () => {
    const src = code(read('../../netlify/functions/search-companies.js'));

    expect(src).not.toMatch(/icpId\s*\|\|\s*DEFAULT_ICP_ID/);
    expect(src).not.toMatch(/import .*DEFAULT_ICP_ID/);
  });

  it('the ICP resolution path in every rerouted caller is the canonical one', () => {
    const rerouted = [
      '../utils/getActiveIcpId.js',
      '../utils/updateIcpFromChat.js',
      '../utils/barryContextStack.js',
      '../pages/Scout/DailyLeads.jsx',
      '../pages/Scout/MissionControlDashboardV2.jsx',
      '../pages/Scout/ICPSettings.jsx',
    ];

    for (const path of rerouted) {
      const src = code(read(path));
      expect(src, `${path} does not use the canonical resolver`).toMatch(/resolveActiveIcp/);
      expect(src, `${path} still references a default ICP id`).not.toMatch(/DEFAULT_ICP_ID/);
    }
  });

  it('no client surface re-derives the active ICP with its own tiebreak', () => {
    const surfaces = [
      '../pages/Scout/DailyLeads.jsx',
      '../pages/Scout/MissionControlDashboardV2.jsx',
      '../pages/Scout/ICPSettings.jsx',
    ];

    for (const path of surfaces) {
      // `icps.find(i => i.isActive && i.status === 'active') || icps[0]` — the
      // silent promotion that made three surfaces disagree with the resolver.
      expect(code(read(path)), `${path} still promotes a candidate silently`)
        .not.toMatch(/isActive\s*&&\s*\w+\.status\s*===\s*'active'\s*\)\s*\|\|/);
    }
  });
});

describe('2 — onboarding creates an ICP only on explicit confirmation', () => {
  const src = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('writes icpProfiles only inside handleConfirm', () => {
    const confirmAt = src.indexOf('async function handleConfirm()');
    expect(confirmAt).toBeGreaterThan(-1);

    const writes = [...src.matchAll(/'icpProfiles'/g)].map(m => m.index);
    expect(writes.length).toBeGreaterThan(0);
    writes.forEach(at => expect(at).toBeGreaterThan(confirmAt));
  });

  it('creates the ICP before projecting it to the bridge', () => {
    const icpWrite = src.indexOf("'icpProfiles'");
    const bridgeWrite = src.indexOf("'companyProfile', 'current'\n      ),");

    // The bridge write that follows creation carries the identity.
    expect(src).toMatch(/icpId,\s*icpIdSource: 'barry_onboarding_confirmed'/);
    if (bridgeWrite > -1) expect(icpWrite).toBeLessThan(bridgeWrite);
  });

  it('a failed read does not cause a duplicate ICP', () => {
    expect(src).toMatch(/reason === 'read-failed'[\s\S]{0,220}throw new Error/);
  });

  it('the first search after confirmation carries the new ICP identity', () => {
    const searchAt = src.indexOf("'/.netlify/functions/search-companies'");
    expect(searchAt).toBeGreaterThan(-1);

    const body = src.slice(searchAt, searchAt + 500);
    expect(body).toMatch(/\bicpId\b/);
  });

  it('does not search when the confirmed ICP carries no retrieval constraint', () => {
    expect(src).toMatch(/hasRetrievalConstraint/);
    expect(src).toMatch(/if \(canSearch\) \{[\s\S]{0,400}search-companies/);
  });
});

describe('3 — every search-companies caller carries identity or declines', () => {
  // CompanyQuestionnaire was here in Tier 1, when it resolved an identity and
  // passed it. Tier 3 found that identity could only ever be some *other* ICP's
  // — the criteria come from this form, which no ICP holds — so the search was
  // removed entirely rather than mis-attributed. It is asserted separately
  // below: no call at all satisfies "carries identity or declines" strictly
  // more than declining at the guard did.
  const callers = [
    ['../pages/Scout/DailyLeads.jsx', 'DailyLeads'],
    ['../pages/Scout/MissionControlDashboardV2.jsx', 'MissionControlDashboardV2'],
    ['../components/scout/BarryICPPanel.jsx', 'BarryICPPanel'],
    ['../pages/Onboarding/BarryOnboarding.jsx', 'BarryOnboarding'],
  ];

  it.each(callers)('%s resolves before searching', (path, name) => {
    const src = code(read(path));

    expect(src, `${name} does not resolve an ICP`).toMatch(/resolveActiveIcp/);

    const at = src.indexOf("'/.netlify/functions/search-companies'");
    expect(at, `${name} has no search call`).toBeGreaterThan(-1);

    // The identity may be assembled into a payload object just above the call
    // (CompanyQuestionnaire) or inlined in the body (everywhere else).
    const around = src.slice(Math.max(0, at - 900), at + 600);
    expect(around, `${name} searches without icpId`).toMatch(/\bicpId\b/);
  });

  it('CompanyQuestionnaire declines by not searching at all', () => {
    const src = code(read('../components/scout/CompanyQuestionnaire.jsx'));

    expect(src).toMatch(/resolveActiveIcp/);
    expect(src).not.toMatch(/'\/\.netlify\/functions\/search-companies'/);
  });

  it('search-companies refuses a request with no ICP identity', () => {
    const src = read('../../netlify/functions/search-companies.js');
    expect(src).toMatch(/if \(!icpId\)[\s\S]{0,400}ICP_REQUIRED/);
  });
});

describe('4 — the scheduled refresh skips, it does not fail', () => {
  const src = read('../../netlify/functions/daily-leads-refresh.js');

  it('resolves each user through the contract, not the bridge', () => {
    expect(src).toMatch(/resolveActiveIcpViaRest\(projectId, user\.userId\)/);
    expect(code(src)).not.toMatch(/DEFAULT_ICP_ID/);
  });

  it('continues the job for the remaining users', () => {
    expect(src).toMatch(/resolution\.status !== 'resolved'[\s\S]{0,400}continue;/);
  });

  it('records which of the three states caused each skip', () => {
    expect(src).toMatch(/skippedReasons\[resolution\.reason\]/);
  });

  it('distinguishes an empty subcollection from a failed read', () => {
    expect(src).toMatch(/status === 404[\s\S]{0,200}'no-profiles'/);
    expect(src).toMatch(/'read-failed'/);
  });

  it('passes the resolved identity through to the search', () => {
    expect(src).toMatch(/refreshUserQueue\(user\.userId, authToken, profile, resolution\.icpId\)/);
  });
});

describe('5 — relationship-oriented Barry works with no ICP', () => {
  it.each([
    ['../../netlify/functions/barryGenerateSequenceStep.js'],
    ['../../netlify/functions/barryHunterGenerateStep.js'],
    ['../../netlify/functions/barryHunterProcessEngage.js'],
  ])('%s reads the ICP profile only when an id was supplied', (path) => {
    const src = code(read(path));

    // .doc(undefined) throws, which would take the whole RECON block down with
    // it — the context these surfaces DO need would be lost along with the ICP.
    expect(src).toMatch(/icpId \? db\.collection\('users'\)[\s\S]{0,120}: null/);
    expect(src).toMatch(/icpDoc\?\.exists/);

    // An absent identity must stay absent all the way in. These three used to
    // widen it to DEFAULT_ICP_ID at the top of the handler, before any guard.
    expect(src).not.toMatch(/DEFAULT_ICP_ID/);
  });

  it('the four Hunter callers omit icpId rather than inventing one', () => {
    const callers = [
      '../components/hunter/SequencePanel.jsx',
      '../components/hunter/QuickMissionAssignModal.jsx',
      '../components/hunter/HunterContactDrawer.jsx',
      '../components/hunter/MissionCard.jsx',
    ];

    for (const path of callers) {
      const src = code(read(path));
      expect(src, `${path} sends a bare icpId`).toMatch(
        /\.\.\.\(activeIcpId \? \{ icpId: activeIcpId \} : \{ icpAttribution: 'unresolved' \}\)/
      );
    }
  });

  it('getActiveIcpId returns null rather than a fabricated id', () => {
    const src = code(read('../utils/getActiveIcpId.js'));
    expect(src).toMatch(/isResolved\(resolution\) \? resolution\.icpId : null/);
  });

  it('first touch proceeds without ICP messaging', () => {
    const src = read('../../netlify/functions/barryFirstTouch.js');
    expect(src).toMatch(/isResolved\(icpResolution\)[\s\S]{0,200}: null/);
    expect(code(src)).not.toMatch(/throw[^\n]*icp/i);
  });

  it('Barry context keeps the bridge criteria but drops the false identity', () => {
    const src = read('../utils/barryContextStack.js');
    expect(src).toMatch(/id: null,\s*\n\s*icpAttribution: 'unverified-projection'/);
  });
});

describe('6 — implicit ICP creation is gone', () => {
  it('the migration creates nothing when there is nothing to promote', () => {
    const src = read('../utils/dashboardUtils.js');
    expect(src).toMatch(/hasPromotableCriteria/);
    expect(src).toMatch(/if \(!hasPromotableCriteria\)[\s\S]{0,600}migratedMultiICP: true/);
  });

  it('ICP Settings no longer creates a profile on page load', () => {
    const src = read('../pages/Scout/ICPSettings.jsx');
    const loadAt = src.indexOf('async function loadICPProfiles()');
    const applyAt = src.indexOf('function applyICPToState');

    expect(src.slice(loadAt, applyAt)).not.toMatch(/setDoc\(/);
  });

  it('the empty state exposes the existing explicit create action', () => {
    const src = read('../pages/Scout/ICPSettings.jsx');
    expect(src).toMatch(/icp-empty[\s\S]{0,700}onClick=\{handleCreateICP\}/);
  });

  it('chat refinement refuses to write when identity is unresolved', () => {
    const src = read('../utils/updateIcpFromChat.js');
    expect(src).toMatch(/if \(!isResolved\(resolution\)\)[\s\S]{0,200}return \{ status: 'unresolved', reason: resolution\.reason \}/);
    expect(code(src)).not.toMatch(/DEFAULT_ICP_ID/);
  });

  it('the admin ICP editor syncs the bridge for the active ICP, not the oldest', () => {
    const src = read('../../netlify/functions/adminUpdateUserICP.js');
    expect(src).toMatch(/isResolved\(icpResolution\) && icpResolution\.icpId === icpId/);
    expect(code(src)).not.toMatch(/allProfiles\[0\]\.id === icpId/);
  });
});
