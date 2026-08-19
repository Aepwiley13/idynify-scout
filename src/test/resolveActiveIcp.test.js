/**
 * The canonical active-ICP resolution contract.
 *
 * Nine mechanisms used to answer "which ICP is active?", disagreeing through
 * four different fallback tiebreaks, and four of them answered `'default'` when
 * they did not know. That fabricated identity was the root of the platform's
 * ICP attribution problems: Hunter read icpProfiles/default, found nothing, and
 * generated outreach with no ICP messaging and no error anywhere.
 *
 * These tests hold the replacement to its contract. The most important one is
 * that the three unresolved reasons stay distinct — "you have never made an
 * ICP", "you have ICPs but none is selected" and "I could not read your ICPs"
 * are three different facts, and collapsing them is how a transient read
 * failure gets reported to a user as "you have no ICP".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocsMock = vi.fn();

vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (...args) => ({ path: args.slice(1).join('/') }),
  getDocs: (...args) => getDocsMock(...args),
}));

const {
  resolveActiveIcp,
  isResolved,
  explainUnresolved,
  ICP_RESOLVED,
  ICP_UNRESOLVED,
  ICP_NO_PROFILES,
  ICP_NONE_ACTIVE,
  ICP_READ_FAILED,
  ICP_NO_USER,
} = await import('../utils/resolveActiveIcp');

/** Shape a Firestore query snapshot from plain objects. */
function snapshot(profiles) {
  return { docs: profiles.map(({ id, ...data }) => ({ id, data: () => data })) };
}

const ACTIVE = { id: 'icp_alpha', name: 'Alpha', isActive: true, status: 'active', createdAt: '2026-02-01' };
const IDLE = { id: 'icp_beta', name: 'Beta', isActive: false, status: 'inactive', createdAt: '2026-01-01' };

beforeEach(() => {
  getDocsMock.mockReset();
});

describe('resolveActiveIcp — RESOLVED', () => {
  it('returns the ICP flagged active, with its identity and profile', async () => {
    getDocsMock.mockResolvedValue(snapshot([IDLE, ACTIVE]));

    const result = await resolveActiveIcp('u1');

    expect(result.status).toBe(ICP_RESOLVED);
    expect(result.icpId).toBe('icp_alpha');
    expect(result.profile.name).toBe('Alpha');
    expect(result.source).toBe('active-flag');
    expect(isResolved(result)).toBe(true);
  });

  it('requires BOTH isActive and status — a half-flagged profile is not active', async () => {
    getDocsMock.mockResolvedValue(snapshot([
      { id: 'icp_half', isActive: true, status: 'pending', createdAt: '2026-01-01' },
    ]));

    const result = await resolveActiveIcp('u1');

    expect(result.status).toBe(ICP_UNRESOLVED);
    expect(result.reason).toBe(ICP_NONE_ACTIVE);
  });
});

describe('resolveActiveIcp — no-profiles', () => {
  it('reports no-profiles when the user has never created an ICP', async () => {
    getDocsMock.mockResolvedValue(snapshot([]));

    const result = await resolveActiveIcp('u1');

    expect(result.status).toBe(ICP_UNRESOLVED);
    expect(result.reason).toBe(ICP_NO_PROFILES);
    expect(result.icpId).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('is a valid product state, not an error — zero ICPs resolves cleanly', async () => {
    getDocsMock.mockResolvedValue(snapshot([]));

    await expect(resolveActiveIcp('u1')).resolves.toBeDefined();
  });
});

describe('resolveActiveIcp — none-active', () => {
  it('reports none-active and returns the candidates, without choosing one', async () => {
    getDocsMock.mockResolvedValue(snapshot([ACTIVE_OFF(IDLE), ACTIVE_OFF(ACTIVE)]));

    const result = await resolveActiveIcp('u1');

    expect(result.status).toBe(ICP_UNRESOLVED);
    expect(result.reason).toBe(ICP_NONE_ACTIVE);
    expect(result.icpId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('orders candidates oldest-first so continuity rendering is stable', async () => {
    getDocsMock.mockResolvedValue(snapshot([
      { id: 'newer', isActive: false, status: 'inactive', createdAt: '2026-05-01' },
      { id: 'older', isActive: false, status: 'inactive', createdAt: '2026-01-01' },
    ]));

    const result = await resolveActiveIcp('u1');

    expect(result.candidates.map(c => c.id)).toEqual(['older', 'newer']);
  });

  it('orders Firestore Timestamps and ISO strings by the same rule', async () => {
    getDocsMock.mockResolvedValue(snapshot([
      { id: 'iso_late', isActive: false, status: 'inactive', createdAt: '2026-06-01' },
      { id: 'ts_early', isActive: false, status: 'inactive', createdAt: { toDate: () => new Date('2026-01-01') } },
    ]));

    const result = await resolveActiveIcp('u1');

    expect(result.candidates.map(c => c.id)).toEqual(['ts_early', 'iso_late']);
  });
});

describe('resolveActiveIcp — read-failed', () => {
  it('reports read-failed when the read throws — failure is not emptiness', async () => {
    getDocsMock.mockRejectedValue(new Error('permission-denied'));

    const result = await resolveActiveIcp('u1');

    expect(result.status).toBe(ICP_UNRESOLVED);
    expect(result.reason).toBe(ICP_READ_FAILED);
  });

  it('never reports a failed read as no-profiles', async () => {
    getDocsMock.mockRejectedValue(new Error('offline'));

    const result = await resolveActiveIcp('u1');

    expect(result.reason).not.toBe(ICP_NO_PROFILES);
  });

  it('reports no-user without touching Firestore', async () => {
    const result = await resolveActiveIcp(undefined);

    expect(result.reason).toBe(ICP_NO_USER);
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});

describe('resolveActiveIcp — the fabrication invariant', () => {
  it('never returns DEFAULT_ICP_ID for any unresolved state', async () => {
    const cases = [
      () => getDocsMock.mockResolvedValue(snapshot([])),
      () => getDocsMock.mockResolvedValue(snapshot([ACTIVE_OFF(IDLE)])),
      () => getDocsMock.mockRejectedValue(new Error('boom')),
    ];

    for (const setup of cases) {
      getDocsMock.mockReset();
      setup();
      const result = await resolveActiveIcp('u1');
      expect(result.icpId).toBeNull();
      expect(JSON.stringify(result)).not.toMatch(/"icpId":\s*"default"/);
    }
  });

  it('never reads the bridge — identity comes only from icpProfiles', async () => {
    getDocsMock.mockResolvedValue(snapshot([]));

    await resolveActiveIcp('u1');

    const paths = getDocsMock.mock.calls.map(c => JSON.stringify(c[0]));
    expect(paths.join(' ')).not.toMatch(/companyProfile/);
  });

  it('gives each unresolved state its own explanation', async () => {
    const messages = [ICP_NO_PROFILES, ICP_NONE_ACTIVE, ICP_READ_FAILED]
      .map(reason => explainUnresolved({ reason }));

    expect(new Set(messages).size).toBe(3);
    messages.forEach(m => expect(m).toBeTruthy());
  });
});

/** Strip the active flags from a fixture. */
function ACTIVE_OFF(profile) {
  return { ...profile, isActive: false, status: 'inactive' };
}
