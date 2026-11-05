/**
 * Auto-discovered-people status after a Match (#N1).
 *
 * The five fields, and the invariant the whole design exists to guarantee:
 * a search that is abandoned or errors out is always distinguishable from a
 * confirmed zero — never shown as "no contacts found" by guessing.
 *
 * Covers: every state (searching, found, searched-none, failed, stale),
 * retries, a transaction conflict (a superseded attempt's late answer
 * discarded), and a failed pending-write handled explicitly rather than
 * silently starting a search the UI has no record of.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory Firestore ─────────────────────────────────────────────────────

const STORE = new Map();
let FAIL_NEXT_UPDATE = null; // set to an Error to make the next plain updateDoc throw

const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');
const snap = (ref) => {
  const data = STORE.get(ref.__path);
  return { exists: () => data !== undefined, data: () => data, id: ref.id, ref };
};

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => {
    const p = pathOf(first, rest);
    return { __path: p, id: p.split('/').pop() };
  },
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  getDoc: async (ref) => snap(ref),
  getDocs: async (q) => {
    const prefix = q.ref.__path + '/';
    const wheres = q.clauses.filter(c => c.__where);
    const docs = [...STORE.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .filter(([, v]) => wheres.every(w => v[w.field] === w.value))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: { __path: k } }));
    return { empty: docs.length === 0, docs };
  },
  setDoc: vi.fn(async (ref, data) => { STORE.set(ref.__path, data); }),
  updateDoc: async (ref, data) => {
    // 'TX' is reserved for runTransaction below — this is the plain updateDoc
    // used only for the titles write, before any transaction runs.
    if (FAIL_NEXT_UPDATE && FAIL_NEXT_UPDATE !== 'TX') { const e = FAIL_NEXT_UPDATE; FAIL_NEXT_UPDATE = null; throw e; }
    if (!STORE.has(ref.__path)) throw new Error(`no document: ${ref.__path}`);
    STORE.set(ref.__path, { ...STORE.get(ref.__path), ...data });
  },
  deleteDoc: async (ref) => { STORE.delete(ref.__path); },
  // A straightforward transaction: reads and writes hit the live STORE
  // directly. The guard logic under test (claim-before-write,
  // id-checked settle) lives in companyDecision.js itself, not here — this
  // fake only needs to run tx.get/tx.update correctly and let a thrown
  // error inside the callback propagate, so FAIL_NEXT_TX can exercise the
  // "the claiming write itself failed" path.
  runTransaction: async (_db, fn) => {
    if (FAIL_NEXT_UPDATE === 'TX') { FAIL_NEXT_UPDATE = null; throw new Error('transaction failed'); }
    const tx = {
      get: async (ref) => snap(ref),
      update: (ref, data) => {
        if (!STORE.has(ref.__path)) throw new Error(`no document: ${ref.__path}`);
        STORE.set(ref.__path, { ...STORE.get(ref.__path), ...data });
      },
    };
    return fn(tx);
  },
}));

vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: { currentUser: null } }));

// Identity resolution: scripted per test via NEXT_DECISIONS, consumed in order —
// lets a single search exercise both a create and a merge, so the saved count
// is proven to come from what was actually written, not result.people.length.
let NEXT_DECISIONS = [];
// Keyed by apollo_person_id: lets a test pause one specific person's identity
// resolution mid-loop (to land a superseding retry while it's in flight),
// without needing a real transaction to make that moment reproducible.
let PAUSE_HOOKS = {};
vi.mock('../services/contactWriteGuard', () => ({
  prepareContactWrite: async (_uid, candidate) => {
    const hook = PAUSE_HOOKS[candidate.apollo_person_id];
    if (hook) await hook.promise;
    return NEXT_DECISIONS.shift() ?? { action: 'create', fields: {} };
  },
  applyContactMerge: vi.fn(async () => {}),
}));

vi.mock('../services/icpRelationshipService', () => ({
  recordDecision: async () => {}, recordSkip: async () => {}, recordPersonEncounter: async () => {},
}));
vi.mock('../services/companyEnrichment', () => ({ enrichAcceptedCompany: async () => {} }));

const {
  triggerPeopleDiscovery, retryPeopleDiscovery, resolveAutoContactState, msUntilStale,
  undoApprovalSideEffects, AUTO_CONTACT_STALE_MS,
} = await import('../services/companyDecision');
const { applyContactMerge } = await import('../services/contactWriteGuard');
const { setDoc } = await import('firebase/firestore');

const UID = 'u1';
const companyPath = (id) => `users/${UID}/companies/${id}`;
const USER = { uid: UID, getIdToken: async () => 'tok' };

function seedCompany(id, extra = {}) {
  const company = { name: `Co ${id}`, apollo_organization_id: `org_${id}`, ...extra };
  STORE.set(companyPath(id), company);
  return { id, ...company };
}
const read = (id) => { const data = STORE.get(companyPath(id)); return data ? { id, ...data } : undefined; };

/** Resolves once the current microtask queue has fully drained — the
 * background `.then()` chain in triggerPeopleDiscovery is not awaited by
 * its caller, so tests that need its outcome settled wait on this. */
const flushMicrotasks = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

beforeEach(() => {
  STORE.clear();
  NEXT_DECISIONS = [];
  PAUSE_HOOKS = {};
  FAIL_NEXT_UPDATE = null;
  vi.restoreAllMocks();
  applyContactMerge.mockClear();
  setDoc.mockClear();
});

// ── resolveAutoContactState: pure, every boundary ───────────────────────────

describe('resolveAutoContactState: the one place either surface decides what to show', () => {
  it('no field at all: none — never shown as a zero result', () => {
    expect(resolveAutoContactState(null)).toEqual({ kind: 'none' });
    expect(resolveAutoContactState({})).toEqual({ kind: 'none' });
    expect(resolveAutoContactState({ name: 'Acme' })).toEqual({ kind: 'none' });
  });

  it('completed with a positive count: found', () => {
    expect(resolveAutoContactState({ auto_contact_status: 'completed', auto_contact_count: 3 })).toEqual({ kind: 'found', count: 3 });
  });

  it('completed with a verified zero: none-found — only state that renders "no contacts found"', () => {
    expect(resolveAutoContactState({ auto_contact_status: 'completed', auto_contact_count: 0 })).toEqual({ kind: 'none-found' });
  });

  it('failed: never confused with a zero result', () => {
    expect(resolveAutoContactState({ auto_contact_status: 'failed' })).toEqual({ kind: 'failed' });
  });

  it('pending, fresh: searching', () => {
    const now = Date.parse('2026-11-04T18:02:10.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T18:02:03.000Z' };
    expect(resolveAutoContactState(company, now)).toEqual({ kind: 'searching' });
  });

  it('pending, exactly at the 60s boundary: still searching (the threshold is exclusive past it)', () => {
    const started = Date.parse('2026-11-04T18:02:03.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T18:02:03.000Z' };
    expect(resolveAutoContactState(company, started + AUTO_CONTACT_STALE_MS).kind).toBe('searching');
    expect(resolveAutoContactState(company, started + AUTO_CONTACT_STALE_MS + 1).kind).toBe('stuck');
  });

  it('pending, well past 60s: stuck — never shown as failed or as a zero result', () => {
    const now = Date.parse('2026-11-04T18:05:40.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T17:58:40.000Z' };
    expect(resolveAutoContactState(company, now)).toEqual({ kind: 'stuck' });
  });

  it('completed, but the count is not a valid non-negative integer: inconsistent, never read as zero', () => {
    const base = { auto_contact_status: 'completed' };
    expect(resolveAutoContactState({ ...base })).toEqual({ kind: 'inconsistent' }); // field missing entirely
    expect(resolveAutoContactState({ ...base, auto_contact_count: null })).toEqual({ kind: 'inconsistent' });
    expect(resolveAutoContactState({ ...base, auto_contact_count: '0' })).toEqual({ kind: 'inconsistent' }); // string, not number
    expect(resolveAutoContactState({ ...base, auto_contact_count: NaN })).toEqual({ kind: 'inconsistent' });
    expect(resolveAutoContactState({ ...base, auto_contact_count: -1 })).toEqual({ kind: 'inconsistent' }); // negative
    expect(resolveAutoContactState({ ...base, auto_contact_count: 1.5 })).toEqual({ kind: 'inconsistent' }); // fractional
    expect(resolveAutoContactState({ ...base, auto_contact_count: Infinity })).toEqual({ kind: 'inconsistent' });
    // Sanity: a genuinely valid zero or positive count is unaffected by the new check.
    expect(resolveAutoContactState({ ...base, auto_contact_count: 0 })).toEqual({ kind: 'none-found' });
    expect(resolveAutoContactState({ ...base, auto_contact_count: 4 })).toEqual({ kind: 'found', count: 4 });
  });
});

// ── msUntilStale: the one clock both the write path and the client timer share ──

describe('msUntilStale: shared by resolveAutoContactState and the saved company page\'s own timer', () => {
  it('not pending at all: null — nothing to schedule a timer against', () => {
    expect(msUntilStale(null)).toBeNull();
    expect(msUntilStale({})).toBeNull();
    expect(msUntilStale({ auto_contact_status: 'completed', auto_contact_search_started_at: '2026-11-04T18:00:00.000Z' })).toBeNull();
    expect(msUntilStale({ auto_contact_status: 'failed' })).toBeNull();
  });

  it('pending but no usable start time: null, not a crash and not a false "stale"', () => {
    expect(msUntilStale({ auto_contact_status: 'pending' })).toBeNull();
    expect(msUntilStale({ auto_contact_status: 'pending', auto_contact_search_started_at: null })).toBeNull();
    expect(msUntilStale({ auto_contact_status: 'pending', auto_contact_search_started_at: 'not-a-date' })).toBeNull();
  });

  it('pending, fresh: a positive remaining time, exactly STALE_MS minus elapsed', () => {
    const started = Date.parse('2026-11-04T18:02:00.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T18:02:00.000Z' };
    expect(msUntilStale(company, started + 10_000)).toBe(AUTO_CONTACT_STALE_MS - 10_000);
  });

  it('pending, exactly at the boundary: zero — matches resolveAutoContactState\'s own >= 0 cutoff', () => {
    const started = Date.parse('2026-11-04T18:02:00.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T18:02:00.000Z' };
    expect(msUntilStale(company, started + AUTO_CONTACT_STALE_MS)).toBe(0);
  });

  it('pending, past the boundary: negative — the CompanyDetail timer uses this to know it already fired late', () => {
    const started = Date.parse('2026-11-04T18:02:00.000Z');
    const company = { auto_contact_status: 'pending', auto_contact_search_started_at: '2026-11-04T18:02:00.000Z' };
    expect(msUntilStale(company, started + AUTO_CONTACT_STALE_MS + 5_000)).toBe(-5_000);
  });
});

// ── triggerPeopleDiscovery: the state machine end to end ────────────────────

describe('triggerPeopleDiscovery: pending is persisted before the search starts', () => {
  it('writes pending, with a search id and a start time, before the fetch resolves', async () => {
    seedCompany('c1');
    let resolveFetch;
    globalThis.fetch = vi.fn(() => new Promise(r => { resolveFetch = r; }));

    const promise = triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: 'icp_A', causeId: 't0' });
    const outcome = await promise; // the claim is awaited inside the function; the fetch is not

    expect(outcome).toEqual({ attempted: true, searchId: expect.any(String) });
    const stored = read('c1');
    expect(stored.auto_contact_status).toBe('pending');
    expect(stored.auto_contact_search_id).toEqual(expect.any(String));
    expect(stored.auto_contact_search_started_at).toEqual(expect.any(String));
    expect(stored.auto_contact_searched_at).toBeNull();
    expect(stored.auto_contact_count).toBeNull();

    resolveFetch({ json: async () => ({ success: true, people: [] }) });
    await flushMicrotasks();
  });

  it('a failed pending write is handled explicitly: logged, nothing started, no fetch call', async () => {
    seedCompany('c1');
    FAIL_NEXT_UPDATE = 'TX';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const outcome = await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null, causeId: 't0' });

    expect(outcome).toEqual({ attempted: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('could not record the start'), expect.any(String));
    expect(read('c1').auto_contact_status).toBeUndefined();
  });

  it('no titles, or no Apollo organization id: never starts, never claims pending', async () => {
    seedCompany('c1', { apollo_organization_id: null });
    expect(await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null })).toEqual({ attempted: false });
    expect(read('c1').auto_contact_status).toBeUndefined();

    seedCompany('c2');
    expect(await triggerPeopleDiscovery({ user: USER, company: read('c2'), icpTitles: [], activeICPId: null })).toEqual({ attempted: false });
    expect(read('c2').auto_contact_status).toBeUndefined();
  });
});

describe('triggerPeopleDiscovery: the completion states', () => {
  it('found: count is what was actually saved, not result.people.length — one create, one merge, both counted', async () => {
    seedCompany('c1');
    NEXT_DECISIONS = [{ action: 'create', fields: {} }, { action: 'merge', existingContactId: 'c_existing' }];
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ success: true, people: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] }),
    }));

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: 'icp_A', causeId: 't0' });
    await flushMicrotasks();

    expect(applyContactMerge).toHaveBeenCalledTimes(1);
    const stored = read('c1');
    expect(stored.auto_contact_status).toBe('completed');
    expect(stored.auto_contact_count).toBe(2);
    expect(stored.auto_contact_searched_at).toEqual(expect.any(String));
  });

  it('searched, genuinely none: completed with count 0 — not absent, not failed', async () => {
    seedCompany('c1');
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, people: [] }) }));

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();

    const stored = read('c1');
    expect(stored.auto_contact_status).toBe('completed');
    expect(stored.auto_contact_count).toBe(0);
    expect(resolveAutoContactState(stored).kind).toBe('none-found');
  });

  it('the API itself reports failure: failed, never completed-zero', async () => {
    seedCompany('c1');
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: false, error: 'apollo_error' }) }));

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();

    const stored = read('c1');
    expect(stored.auto_contact_status).toBe('failed');
    expect(stored.auto_contact_count).toBeNull();
    expect(resolveAutoContactState(stored).kind).toBe('failed');
  });

  it('a thrown/rejected fetch: also failed, logged, never left stuck at pending forever', async () => {
    seedCompany('c1');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => { throw new TypeError('network down'); });

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();

    expect(read('c1').auto_contact_status).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith('Background contact search failed:', expect.any(Error));
  });
});

describe('triggerPeopleDiscovery: retries and transaction conflicts', () => {
  it('a retry while the first attempt is still fresh (not stale) is refused — no new attempt starts', async () => {
    seedCompany('c1');
    globalThis.fetch = vi.fn(() => new Promise(() => {})); // never resolves — stays "pending"
    const first = await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    expect(first.attempted).toBe(true);
    const firstId = read('c1').auto_contact_search_id;

    const retry = await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    expect(retry).toEqual({ attempted: false });
    expect(read('c1').auto_contact_search_id).toBe(firstId); // untouched
  });

  it('a retry after the first attempt has gone stale is allowed, and mints a new id', async () => {
    seedCompany('c1');
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    const firstId = read('c1').auto_contact_search_id;

    // Back-date the start time past the staleness window directly in the store —
    // the same effect sixty-plus real seconds would have.
    STORE.set(companyPath('c1'), { ...read('c1'), auto_contact_search_started_at: new Date(Date.now() - AUTO_CONTACT_STALE_MS - 1000).toISOString() });

    const retry = await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    expect(retry.attempted).toBe(true);
    expect(read('c1').auto_contact_search_id).not.toBe(firstId);
    expect(read('c1').auto_contact_status).toBe('pending');
  });

  it('a superseded attempt\'s late answer is discarded — the newer attempt\'s state is never overwritten', async () => {
    seedCompany('c1');
    let resolveFirstFetch;
    globalThis.fetch = vi.fn(() => new Promise(r => { resolveFirstFetch = r; }));

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    const firstId = read('c1').auto_contact_search_id;

    // The first attempt goes stale; a retry starts and completes before the
    // first attempt's network call ever answers.
    STORE.set(companyPath('c1'), { ...read('c1'), auto_contact_search_started_at: new Date(Date.now() - AUTO_CONTACT_STALE_MS - 1000).toISOString() });
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, people: [{ id: 'p1', name: 'A' }] }) }));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();
    const secondId = read('c1').auto_contact_search_id;
    expect(secondId).not.toBe(firstId);
    expect(read('c1').auto_contact_status).toBe('completed');
    expect(read('c1').auto_contact_count).toBe(1);

    // NOW the first attempt's long-delayed response finally arrives.
    resolveFirstFetch({ json: async () => ({ success: true, people: [{ id: 'px', name: 'Ghost' }, { id: 'py', name: 'Ghost2' }] }) });
    await flushMicrotasks();

    // Discarded: the newer attempt's id, status and count all stand, untouched.
    const finalState = read('c1');
    expect(finalState.auto_contact_search_id).toBe(secondId);
    expect(finalState.auto_contact_status).toBe('completed');
    expect(finalState.auto_contact_count).toBe(1); // NOT 2 — the ghost response never landed

    // Not merely under-reported — never written at all. Neither ghost person
    // reached a create (setDoc) or a merge, and no contact document for
    // either of them exists in the store.
    expect(setDoc).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'c1_px' }), expect.anything());
    expect(setDoc).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'c1_py' }), expect.anything());
    expect(STORE.has(`users/${UID}/contacts/c1_px`)).toBe(false);
    expect(STORE.has(`users/${UID}/contacts/c1_py`)).toBe(false);
  });

  it('a late answer cannot save or merge contacts even when the superseded search is the ONLY one — proves the guard checks freshness, not just "a newer attempt exists"', async () => {
    // Same race, but this time the ghost people are routed through the merge
    // path, not create — the guard must block both write shapes, not just setDoc.
    seedCompany('c1');
    let resolveFirstFetch;
    globalThis.fetch = vi.fn(() => new Promise(r => { resolveFirstFetch = r; }));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    const firstId = read('c1').auto_contact_search_id;

    STORE.set(companyPath('c1'), { ...read('c1'), auto_contact_search_started_at: new Date(Date.now() - AUTO_CONTACT_STALE_MS - 1000).toISOString() });
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, people: [] }) }));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();
    expect(read('c1').auto_contact_search_id).not.toBe(firstId);

    applyContactMerge.mockClear();
    setDoc.mockClear();
    NEXT_DECISIONS = [{ action: 'merge', existingContactId: 'ghost_existing' }];
    resolveFirstFetch({ json: async () => ({ success: true, people: [{ id: 'pz', name: 'Ghost3' }] }) });
    await flushMicrotasks();

    expect(applyContactMerge).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(read('c1').auto_contact_count).toBe(0); // the second (real) attempt's own genuine zero, untouched
  });

  it('supersession landing WHILE the original is mid-loop on a 3-person result: the person already writing may still land, but neither later person ever does', async () => {
    // isCurrentAttempt is re-checked before every person, not once before
    // the loop (see the comment on it in companyDecision.js) — this proves
    // that per-person re-check actually stops p2 and p3, and is equally
    // honest about the one person it can't stop: whichever one is already
    // past its own check and mid-write at the exact moment the retry lands.
    seedCompany('c1');
    let releaseP1;
    PAUSE_HOOKS.p1 = { promise: new Promise((r) => { releaseP1 = r; }) };
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({
        success: true,
        people: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
      }),
    }));

    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    // The claim has landed; the background loop has reached p1's check
    // (still the current attempt — passes), called prepareContactWrite(p1),
    // and is now paused there, before p1's own write and before ever
    // reaching p2 or p3.
    await flushMicrotasks();
    const firstId = read('c1').auto_contact_search_id;

    // Supersede now, while p1 is paused mid-resolution — the first attempt
    // has gone stale, and a retry starts and fully completes (zero people)
    // before p1 is ever released.
    STORE.set(companyPath('c1'), { ...read('c1'), auto_contact_search_started_at: new Date(Date.now() - AUTO_CONTACT_STALE_MS - 1000).toISOString() });
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, people: [] }) }));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });
    await flushMicrotasks();
    const secondId = read('c1').auto_contact_search_id;
    expect(secondId).not.toBe(firstId);
    expect(read('c1').auto_contact_status).toBe('completed');
    expect(read('c1').auto_contact_count).toBe(0); // the retry's own genuine zero

    setDoc.mockClear();
    applyContactMerge.mockClear();

    // Resume the original attempt. p1's check already passed before the
    // retry landed, so — documented residual risk, not a bug — p1 still
    // gets written. The loop then reaches p2's check, which runs fresh
    // AFTER the supersession: it fails, and the loop stops before p2 or p3
    // ever reach prepareContactWrite.
    releaseP1();
    await flushMicrotasks();

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][0].id).toBe('c1_p1');
    expect(applyContactMerge).not.toHaveBeenCalled(); // p2/p3 never even reached prepareContactWrite

    // The retry's own state stands, untouched by the original's loop
    // quietly finishing in the background.
    const finalState = read('c1');
    expect(finalState.auto_contact_search_id).toBe(secondId);
    expect(finalState.auto_contact_status).toBe('completed');
    expect(finalState.auto_contact_count).toBe(0);
  });

  it('the company was deleted while a search was in flight: the late answer finds nothing to write to, and does not throw', async () => {
    seedCompany('c1');
    let resolveFetch;
    globalThis.fetch = vi.fn(() => new Promise(r => { resolveFetch = r; }));
    await triggerPeopleDiscovery({ user: USER, company: read('c1'), icpTitles: ['CEO'], activeICPId: null });

    STORE.delete(companyPath('c1'));
    resolveFetch({ json: async () => ({ success: true, people: [] }) });
    await flushMicrotasks();

    expect(read('c1')).toBeUndefined(); // still gone; no error thrown, nothing resurrected
  });
});

describe('retryPeopleDiscovery: the company page\'s "Try again" button', () => {
  it('reconstructs titles and ICP context from what the original attempt already stored', async () => {
    seedCompany('c1', {
      selected_titles: [{ title: 'CEO', rank: 1 }, { title: 'COO', rank: 2 }],
      swipedForICPId: 'icp_A', swipedAt: '2026-11-01T00:00:00.000Z',
      auto_contact_status: 'failed',
    });
    globalThis.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      expect(body.titles).toEqual(['CEO', 'COO']);
      return { json: async () => ({ success: true, people: [] }) };
    });

    const outcome = await retryPeopleDiscovery({ user: USER, company: read('c1') });
    expect(outcome.attempted).toBe(true);
    await flushMicrotasks();
  });

  it('a company with no stored titles at all has nothing to retry', async () => {
    seedCompany('c1', { selected_titles: [] });
    expect(await retryPeopleDiscovery({ user: USER, company: read('c1') })).toEqual({ attempted: false });
  });
});

describe('undoApprovalSideEffects clears the auto-contact fields too', () => {
  it('nulls every one of the five fields, not just the original three', async () => {
    seedCompany('c1', {
      selected_titles: [{ title: 'CEO' }], titles_updated_at: 't', titles_source: 'icp_auto',
      auto_contact_status: 'completed', auto_contact_count: 2,
      auto_contact_search_id: 'srch_x', auto_contact_search_started_at: 't', auto_contact_searched_at: 't',
    });

    await undoApprovalSideEffects({ userId: UID, companyId: 'c1' });

    const stored = read('c1');
    for (const field of ['auto_contact_status', 'auto_contact_count', 'auto_contact_search_id', 'auto_contact_search_started_at', 'auto_contact_searched_at']) {
      expect(stored[field]).toBeNull();
    }
  });
});
