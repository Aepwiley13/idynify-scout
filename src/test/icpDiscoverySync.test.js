/**
 * ICP → Discovery sync (David's incident).
 *
 * Editing an ICP mutates the profile document IN PLACE, so `icpId` does not
 * change. The original queue-full check counted every pending company
 * regardless of ICP, and the first fix keyed that count on `icpId` — which an
 * edit also leaves untouched. Neither can detect an edit, so a full queue of
 * companies discovered under the OLD criteria kept the new criteria from ever
 * taking effect.
 *
 * The queue is therefore keyed on the ICP CRITERIA, not its identity. These
 * tests pin that: an edit must invalidate the queue, a non-edit must not, and a
 * criteria change must be deterministic rather than dependent on which refresh
 * button was pressed.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn() }));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: vi.fn().mockResolvedValue({ tokenUserId: 'user-1' }),
}));

const { computeIcpCriteriaFingerprint, partitionPendingQueue } =
  await import('../../netlify/functions/search-companies.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');

const BASE = {
  industries: ['Construction', 'Real Estate'],
  companyKeywords: ['contractor'],
  companySizes: ['11-20'],
  locations: ['Texas'],
  revenueRanges: ['$1M-$10M'],
};

describe('computeIcpCriteriaFingerprint', () => {
  it('is stable for the same criteria', () => {
    expect(computeIcpCriteriaFingerprint(BASE)).toBe(computeIcpCriteriaFingerprint({ ...BASE }));
  });

  it('ignores array order and casing — a re-save that changed nothing must not invalidate the queue', () => {
    const reordered = {
      ...BASE,
      industries: ['real estate', 'CONSTRUCTION'],
    };
    expect(computeIcpCriteriaFingerprint(reordered)).toBe(computeIcpCriteriaFingerprint(BASE));
  });

  it('CHANGES when industries change — this is David\'s edit', () => {
    const edited = { ...BASE, industries: ['Publishing'] };
    expect(computeIcpCriteriaFingerprint(edited)).not.toBe(computeIcpCriteriaFingerprint(BASE));
  });

  it('changes for every other criterion that reaches Apollo', () => {
    const base = computeIcpCriteriaFingerprint(BASE);
    expect(computeIcpCriteriaFingerprint({ ...BASE, companyKeywords: ['roofing'] })).not.toBe(base);
    expect(computeIcpCriteriaFingerprint({ ...BASE, companySizes: ['201-500'] })).not.toBe(base);
    expect(computeIcpCriteriaFingerprint({ ...BASE, locations: ['Ohio'] })).not.toBe(base);
    expect(computeIcpCriteriaFingerprint({ ...BASE, foundedAgeRange: { minAge: 0, maxAge: 5 } })).not.toBe(base);
  });

  it('does NOT change for targetTitles — a person filter that never reaches the organisation search', () => {
    const withTitles = { ...BASE, targetTitles: ['VP Sales', 'CRO'] };
    expect(computeIcpCriteriaFingerprint(withTitles)).toBe(computeIcpCriteriaFingerprint(BASE));
  });

  it('normalises criteria through the flag that gates them', () => {
    // Revenue is ignored while skipRevenue is on, so editing it must be a no-op...
    const skipA = { ...BASE, skipRevenue: true, revenueRanges: ['$1M-$10M'] };
    const skipB = { ...BASE, skipRevenue: true, revenueRanges: ['$50M-$100M'] };
    expect(computeIcpCriteriaFingerprint(skipA)).toBe(computeIcpCriteriaFingerprint(skipB));
    // ...but toggling the flag itself is a real change.
    expect(computeIcpCriteriaFingerprint(skipA)).not.toBe(computeIcpCriteriaFingerprint(BASE));

    const natA = { ...BASE, isNationwide: true, locations: ['Texas'] };
    const natB = { ...BASE, isNationwide: true, locations: ['Ohio'] };
    expect(computeIcpCriteriaFingerprint(natA)).toBe(computeIcpCriteriaFingerprint(natB));
    expect(computeIcpCriteriaFingerprint(natA)).not.toBe(computeIcpCriteriaFingerprint(BASE));
  });

  it('handles an empty/absent profile without throwing', () => {
    expect(typeof computeIcpCriteriaFingerprint(undefined)).toBe('string');
    expect(computeIcpCriteriaFingerprint({})).toBe(computeIcpCriteriaFingerprint(undefined));
  });
});

describe('partitionPendingQueue', () => {
  const FP_NEW = 'newfingerprint01';
  const FP_OLD = 'oldfingerprint99';

  it('THE REGRESSION: same icpId, superseded criteria → stale, so the queue is not "full"', () => {
    const queue = Array.from({ length: 50 }, (_, i) => ({
      name: `c${i}`, icpId: 'icp_1', icpCriteriaFingerprint: FP_OLD,
    }));
    const { current, stale } = partitionPendingQueue(queue, 'icp_1', FP_NEW);
    expect(stale).toHaveLength(50);
    expect(current).toHaveLength(0);
  });

  it('keeps companies that still match the current criteria', () => {
    const queue = [
      { name: 'a', icpId: 'icp_1', icpCriteriaFingerprint: FP_NEW },
      { name: 'b', icpId: 'icp_1', icpCriteriaFingerprint: FP_NEW },
    ];
    const { current, stale } = partitionPendingQueue(queue, 'icp_1', FP_NEW);
    expect(current).toHaveLength(2);
    expect(stale).toHaveLength(0);
  });

  it('never touches another ICP\'s queue — no tenant/profile bleed', () => {
    const queue = [
      { name: 'mine', icpId: 'icp_1', icpCriteriaFingerprint: FP_OLD },
      { name: 'theirs', icpId: 'icp_2', icpCriteriaFingerprint: FP_OLD },
    ];
    const { relevant, stale } = partitionPendingQueue(queue, 'icp_1', FP_NEW);
    expect(relevant.map(c => c.name)).toEqual(['mine']);
    expect(stale.map(c => c.name)).toEqual(['mine']);
  });

  it('counts legacy companies (no icpId) as relevant, matching Scout\'s display filter', () => {
    // DailyLeads renders `!c.icpId || c.icpId === activeId`. If the count did
    // not mirror that, 50 displayed legacy companies would be counted as 0 and
    // the queue would be refilled to 100 on screen.
    const queue = [{ name: 'legacy', icpCriteriaFingerprint: undefined }];
    const { relevant, stale, current } = partitionPendingQueue(queue, 'icp_1', FP_NEW);
    expect(relevant).toHaveLength(1);
    expect(stale).toHaveLength(1);   // no fingerprint → discovered under unknown criteria
    expect(current).toHaveLength(0);
  });

  it('treats a missing fingerprint as stale rather than current', () => {
    const queue = [{ name: 'a', icpId: 'icp_1' }];
    expect(partitionPendingQueue(queue, 'icp_1', FP_NEW).current).toHaveLength(0);
  });

  it('handles an empty queue', () => {
    const { relevant, current, stale } = partitionPendingQueue([], 'icp_1', FP_NEW);
    expect(relevant).toHaveLength(0);
    expect(current).toHaveLength(0);
    expect(stale).toHaveLength(0);
  });
});

describe('wiring invariants', () => {
  const fn = read('../../netlify/functions/search-companies.js');

  it('the queue count is reconciled against criteria before the queue-full check', () => {
    const reconcileAt = fn.indexOf('reconcilePendingQueue(');
    const gateAt = fn.indexOf('pendingCount >= TARGET_QUEUE_SIZE');
    expect(reconcileAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(reconcileAt);
  });

  it('discovered companies are stamped with the criteria that found them', () => {
    expect(fn).toMatch(/icpCriteriaFingerprint:\s*\{\s*stringValue/);
  });

  it('a failed queue read is never treated as an empty queue', () => {
    expect(fn).toMatch(/pendingCount === null/);
  });

  it('retirement writes are field-scoped, so a concurrent swipe cannot be clobbered', () => {
    expect(fn).toMatch(/updateMask:\s*\{\s*fieldPaths:\s*\['status',\s*'replacedAt'\]/);
  });

  it('Mission Control does not surface companies retired by a criteria change', () => {
    const mc = read('../pages/Scout/MissionControl.jsx');
    const negativeFilters = mc.match(/status !== 'replaced'/g) || [];
    // Both the getCategory predicate and the SAM filter must exclude it.
    expect(negativeFilters.length).toBeGreaterThanOrEqual(2);
  });

  it('Refresh re-reads the selected ICP instead of trusting the mounted copy', () => {
    const dl = read('../pages/Scout/DailyLeads.jsx');
    const at = dl.indexOf('const resolveSearchIcp');
    expect(at).toBeGreaterThan(-1);
    expect(dl.slice(at, at + 900)).toMatch(/getDoc\(doc\(db, 'users', user\.uid, 'icpProfiles'/);
  });
});

describe('completing a profile never strands the workspace in none-active', () => {
  const s9 = read('../components/icp/Section9MessagingFlow.jsx');

  it('checks for an active ICP when messaging reaches 100%', () => {
    expect(s9).toMatch(/progressPct >= 100[\s\S]{0,120}ensureWorkspaceHasActiveIcp/);
  });

  it('activates only when nothing else is active, and never on a failed read', () => {
    const at = s9.indexOf('async function ensureWorkspaceHasActiveIcp');
    const body = s9.slice(at, at + 800);
    expect(body).toMatch(/isResolved\(resolution\)\s*\|\|\s*resolution\.reason === 'read-failed'/);
    expect(body).toMatch(/setActiveIcpProfile\(/);
  });

  it('reports auto-activation to the parent so local state cannot diverge', () => {
    expect(s9).toMatch(/onComplete\?\.\(\{ activated: autoActivated/);
  });
});
