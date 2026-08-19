/**
 * V-1 — a search launched from an ICP tab belongs to that ICP.
 *
 * DailyLeads shows a tab strip when a user has more than one non-pending ICP.
 * Tier 1 routed both search paths through the canonical resolver, which answers
 * "which ICP is ACTIVE" — not "which ICP is the user looking at". For a user on
 * ICP B's tab while A is active, that tagged the results `icpId: A`, and the
 * queue filter (`!c.icpId || c.icpId === activeId`) then hid them from the very
 * tab that asked for them. That is the invisible-results defect #565 fixed.
 *
 * The resolution order is: explicit tab selection → canonical resolver →
 * nothing. Selecting a tab is an explicit user act, not a silent fallback, and
 * it must not change which ICP is globally active.
 *
 * Asserted against the source: rendering DailyLeads mounts the whole Scout
 * queue, and what matters here is a property of the code — the same precedent
 * as dailyDiscoveriesIcpTargeting.test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

/** The body of a named arrow/callback declared in the component. */
function bodyOf(name) {
  const at = source.indexOf(`const ${name} =`);
  if (at === -1) throw new Error(`${name} not found`);
  const next = source.indexOf('\n  const ', at + 10);
  return source.slice(at, next === -1 ? at + 4000 : next);
}

/** Evaluate the real resolution order from the source against fixtures. */
function makeResolver({ activeICPId, icpList, resolverResult }) {
  const body = bodyOf('resolveSearchIcp');
  const inner = body.slice(body.indexOf('async (user) => {') + 'async (user) => {'.length);
  const fnBody = inner.slice(0, inner.lastIndexOf('}, ['));
  return new Function(
    'activeICPId', 'icpList', 'resolveActiveIcp', 'isResolved',
    `return (async (user) => {${fnBody}});`
  )(
    activeICPId,
    icpList,
    async () => resolverResult,
    r => r.status === 'resolved',
  );
}

const ICP_A = { id: 'icp_A', name: 'A', industries: ['Dental'], isActive: true, status: 'active' };
const ICP_B = { id: 'icp_B', name: 'B', industries: ['Legal'], isActive: false, status: 'inactive' };

/** The globally active ICP is A. */
const ACTIVE_A = { status: 'resolved', icpId: 'icp_A', profile: ICP_A, candidates: [ICP_A, ICP_B] };

const USER = { uid: 'u1' };

describe('V-1 — explicit tab selection decides where a search lands', () => {
  it('active is A, user selected B → the search uses B', async () => {
    const resolveSearchIcp = makeResolver({
      activeICPId: 'icp_B',
      icpList: [ICP_A, ICP_B],
      resolverResult: ACTIVE_A,
    });

    const result = await resolveSearchIcp(USER);

    expect(result.icpId).toBe('icp_B');
    expect(result.profile).toBe(ICP_B);
    expect(result.source).toBe('explicit-tab');
  });

  it('the profile sent with the search is B’s, not A’s', async () => {
    const resolveSearchIcp = makeResolver({
      activeICPId: 'icp_B',
      icpList: [ICP_A, ICP_B],
      resolverResult: ACTIVE_A,
    });

    const result = await resolveSearchIcp(USER);

    expect(result.profile.industries).toEqual(['Legal']);
  });

  it('no tab selected → falls back to the canonical resolver, not to a candidate', async () => {
    const resolveSearchIcp = makeResolver({
      activeICPId: null,
      icpList: [ICP_A, ICP_B],
      resolverResult: ACTIVE_A,
    });

    const result = await resolveSearchIcp(USER);

    expect(result.icpId).toBe('icp_A');
    expect(result.source).toBe('active-flag');
  });

  it('a stale tab id that matches no loaded ICP does not become an identity', async () => {
    const resolveSearchIcp = makeResolver({
      activeICPId: 'icp_deleted',
      icpList: [ICP_A, ICP_B],
      resolverResult: ACTIVE_A,
    });

    const result = await resolveSearchIcp(USER);

    expect(result.icpId).toBe('icp_A');
    expect(result.source).toBe('active-flag');
  });

  it.each([
    ['no-profiles', { status: 'unresolved', reason: 'no-profiles', candidates: [] }],
    ['none-active', { status: 'unresolved', reason: 'none-active', candidates: [ICP_A, ICP_B] }],
    ['read-failed', { status: 'unresolved', reason: 'read-failed', candidates: [] }],
  ])('no tab and %s → no identity, and the reason survives', async (reason, resolverResult) => {
    const resolveSearchIcp = makeResolver({ activeICPId: null, icpList: [], resolverResult });

    const result = await resolveSearchIcp(USER);

    expect(result.icpId).toBeNull();
    expect(result.reason).toBe(reason);
  });

  it('never falls back to a candidate even when candidates exist', async () => {
    const resolveSearchIcp = makeResolver({
      activeICPId: null,
      icpList: [ICP_A, ICP_B],
      resolverResult: { status: 'unresolved', reason: 'none-active', candidates: [ICP_A, ICP_B] },
    });

    const result = await resolveSearchIcp(USER);

    expect(result.icpId).toBeNull();
    expect(result.profile).toBeNull();
  });
});

describe('V-1 — both search paths use that order, and results stay visible in the tab', () => {
  it('manual refresh sends the selected ICP identity', () => {
    const body = bodyOf('handleManualRefresh');

    expect(body).toMatch(/const searchIcp = await resolveSearchIcp\(user\)/);
    expect(body).toMatch(/icpId: searchIcp\.icpId/);
    expect(body).not.toMatch(/icpId: resolution\.icpId/);
  });

  it('adaptive search sends the selected ICP identity', () => {
    const body = bodyOf('triggerAdaptiveSearch');

    expect(body).toMatch(/const searchIcp = await resolveSearchIcp\(user\)/);
    expect(body).toMatch(/icpId: searchIcp\.icpId/);
    expect(body).not.toMatch(/icpId: resolution\.icpId/);
  });

  it('both decline to search when no identity results', () => {
    for (const name of ['handleManualRefresh', 'triggerAdaptiveSearch']) {
      const body = bodyOf(name);
      expect(body, `${name} does not guard on a missing identity`)
        .toMatch(/if \(!searchIcp\.icpId\)[\s\S]{0,220}return;/);
    }
  });

  it('the queue filters on the same id the search was tagged with', () => {
    // search-companies stamps `icpId`; the tab filter accepts a company whose
    // icpId equals the selected tab. Same value on both sides ⇒ B's results
    // remain visible in B's queue.
    expect(bodyOf('handleICPSwitch')).toMatch(/filter\(c => !c\.icpId \|\| c\.icpId === icpId\)/);
  });

  it('selecting a tab does not mutate the globally active ICP', () => {
    const body = bodyOf('handleICPSwitch');

    // No Firestore write of any kind, and no activation call.
    expect(body).not.toMatch(/setDoc|updateDoc|writeBatch|setActiveIcpProfile/);
  });

  it('no implicit fallback survives anywhere in the order', () => {
    const body = bodyOf('resolveSearchIcp');

    expect(body).not.toMatch(/candidates\[0\]/);
    expect(body).not.toMatch(/icps\[0\]/);
    expect(body).not.toMatch(/DEFAULT_ICP_ID/);
  });
});
