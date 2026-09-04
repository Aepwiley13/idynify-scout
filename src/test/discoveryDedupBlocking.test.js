/**
 * Discovery dedup blocking-set contract.
 *
 * The dedup gate in search-companies must block only companies the user has
 * actively acted on (accepted, rejected) or that are still queued (pending).
 * Retired records (replaced, archived) and legacy documents with no status
 * field must be eligible for rediscovery.
 *
 * The blocking set is built by getExistingCompanyIds via a Firestore IN query
 * against DEDUP_BLOCKING_STATUSES. These tests pin the contract from both
 * sides: the exported constant, and source-level assertions that the query
 * uses IN (not NOT_IN or unfiltered).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn() }));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: vi.fn().mockResolvedValue({ tokenUserId: 'user-1' }),
}));

const { DEDUP_BLOCKING_STATUSES } = await import('../../netlify/functions/search-companies.js');

const here = dirname(fileURLToPath(import.meta.url));
const searchSource = readFileSync(resolve(here, '../../netlify/functions/search-companies.js'), 'utf8');

// ── Contract: the blocking-status set ───────────────────────────────────────

describe('DEDUP_BLOCKING_STATUSES contract', () => {
  it('blocks pending, accepted, and rejected', () => {
    expect(DEDUP_BLOCKING_STATUSES).toContain('pending');
    expect(DEDUP_BLOCKING_STATUSES).toContain('accepted');
    expect(DEDUP_BLOCKING_STATUSES).toContain('rejected');
  });

  it('does NOT block replaced', () => {
    expect(DEDUP_BLOCKING_STATUSES).not.toContain('replaced');
  });

  it('does NOT block archived', () => {
    expect(DEDUP_BLOCKING_STATUSES).not.toContain('archived');
  });

  it('contains exactly three statuses', () => {
    expect(DEDUP_BLOCKING_STATUSES).toHaveLength(3);
  });
});

// ── Source-level: getExistingCompanyIds uses IN, never NOT_IN or unfiltered ──

describe('getExistingCompanyIds query structure', () => {
  const fnBody = (() => {
    const start = searchSource.indexOf('async function getExistingCompanyIds');
    if (start === -1) throw new Error('getExistingCompanyIds not found in source');
    let depth = 0;
    let bodyStart = -1;
    for (let i = start; i < searchSource.length; i++) {
      if (searchSource[i] === '{') {
        if (bodyStart === -1) bodyStart = i;
        depth++;
      }
      if (searchSource[i] === '}') {
        depth--;
        if (depth === 0) return searchSource.slice(bodyStart, i + 1);
      }
    }
    throw new Error('Could not extract getExistingCompanyIds body');
  })();

  it('uses IN operator to build the blocking set', () => {
    expect(fnBody).toMatch(/op:\s*'IN'/);
  });

  it('does NOT use NOT_IN', () => {
    expect(fnBody).not.toMatch(/NOT_IN/);
  });

  it('does NOT use NOT_EQUAL', () => {
    expect(fnBody).not.toMatch(/NOT_EQUAL/);
  });

  it('references DEDUP_BLOCKING_STATUSES for the filter values', () => {
    expect(fnBody).toMatch(/DEDUP_BLOCKING_STATUSES/);
  });

  it('selects apollo_organization_id', () => {
    expect(fnBody).toMatch(/apollo_organization_id/);
  });
});

// ── Behavioral: which statuses produce which blocking outcomes ──────────────

describe('dedup blocking-set semantics', () => {
  function isBlocked(status) {
    return DEDUP_BLOCKING_STATUSES.includes(status);
  }

  it('pending org remains excluded from new searches', () => {
    expect(isBlocked('pending')).toBe(true);
  });

  it('accepted org remains excluded', () => {
    expect(isBlocked('accepted')).toBe(true);
  });

  it('rejected org remains excluded', () => {
    expect(isBlocked('rejected')).toBe(true);
  });

  it('replaced org can be returned again', () => {
    expect(isBlocked('replaced')).toBe(false);
  });

  it('archived org can be returned again', () => {
    expect(isBlocked('archived')).toBe(false);
  });

  it('missing-status legacy org can be returned again (Firestore IN excludes absent fields)', () => {
    expect(isBlocked(undefined)).toBe(false);
    expect(isBlocked(null)).toBe(false);
  });

  it('mixed-status collection builds the expected blocking-ID set', () => {
    const companies = [
      { apollo_organization_id: 'org-1', status: 'pending' },
      { apollo_organization_id: 'org-2', status: 'accepted' },
      { apollo_organization_id: 'org-3', status: 'rejected' },
      { apollo_organization_id: 'org-4', status: 'replaced' },
      { apollo_organization_id: 'org-5', status: 'archived' },
      { apollo_organization_id: 'org-6' }, // legacy, no status
    ];

    const blockedIds = new Set(
      companies
        .filter(c => DEDUP_BLOCKING_STATUSES.includes(c.status))
        .map(c => c.apollo_organization_id)
    );

    expect(blockedIds).toEqual(new Set(['org-1', 'org-2', 'org-3']));
    expect(blockedIds.has('org-4')).toBe(false);
    expect(blockedIds.has('org-5')).toBe(false);
    expect(blockedIds.has('org-6')).toBe(false);
  });

  it('same Apollo org present only as replaced is reinsertable', () => {
    const companies = [
      { apollo_organization_id: 'org-reuse', status: 'replaced' },
    ];

    const blockedIds = new Set(
      companies
        .filter(c => DEDUP_BLOCKING_STATUSES.includes(c.status))
        .map(c => c.apollo_organization_id)
    );

    expect(blockedIds.has('org-reuse')).toBe(false);
  });
});
