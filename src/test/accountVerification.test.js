/**
 * "Could not check the account" must never be read as "has not paid".
 *
 * A failed account read used to leave no account data, and every gate sent
 * "no data" to /checkout: a paying customer whose read failed was shown the
 * purchase page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ACCOUNT, DECISION, UNVERIFIED_REASON, ACCOUNT_READ_TIMEOUT_MS, LOADING_ACCOUNT,
  classifySnapshot, readAccount, accessDecision, shouldApplyRefresh,
} from '../utils/accountVerification';

const snapshot = (data, { fromCache = false } = {}) => ({
  exists: () => data !== null,
  data: () => data,
  metadata: { fromCache },
});
const PAID = { hasCompletedPayment: true, credits: 400 };
const UNPAID = { hasCompletedPayment: false };
const user = { id: 'u1' };

describe('classifying one read', () => {
  it('server, paid: verified', () => {
    expect(classifySnapshot(snapshot(PAID))).toEqual({ status: ACCOUNT.VERIFIED, data: PAID });
  });

  it('server, unpaid: verified (the checkout redirect stays correct)', () => {
    expect(classifySnapshot(snapshot(UNPAID))).toEqual({ status: ACCOUNT.VERIFIED, data: UNPAID });
  });

  it('server, no document: verified with no data (a brand-new signup)', () => {
    expect(classifySnapshot(snapshot(null))).toEqual({ status: ACCOUNT.VERIFIED, data: null });
  });

  it('saved copy only, paid: cached, not verified', () => {
    expect(classifySnapshot(snapshot(PAID, { fromCache: true }))).toEqual({ status: ACCOUNT.CACHED, data: PAID });
  });

  it.each([
    ['unpaid', UNPAID],
    ['missing', null],
    ['with no paid flag', { email: 'a@example.test' }],
  ])('saved copy only, %s: unverified, with no data kept', (_label, data) => {
    expect(classifySnapshot(snapshot(data, { fromCache: true }))).toEqual({
      status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.CACHE_ONLY,
    });
  });

  it('a snapshot that cannot say where it came from is not treated as the server', () => {
    const noMetadata = { exists: () => true, data: () => UNPAID };
    expect(classifySnapshot(noMetadata).status).toBe(ACCOUNT.UNVERIFIED);
    expect(classifySnapshot({ exists: () => true, data: () => PAID }).status).toBe(ACCOUNT.CACHED);
  });
});

describe('reading the account', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a read that rejects is unverified, and does not throw', async () => {
    const error = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    await expect(readAccount(() => Promise.reject(error))).resolves.toEqual({
      status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.READ_FAILED, error,
    });
  });

  it('a read that throws at once (a failed Firestore client) is unverified', async () => {
    const result = await readAccount(() => { throw new Error('INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)'); });
    expect(result.status).toBe(ACCOUNT.UNVERIFIED);
    expect(result.reason).toBe(UNVERIFIED_REASON.READ_FAILED);
  });

  it('the cap is 15 seconds', () => {
    expect(ACCOUNT_READ_TIMEOUT_MS).toBe(15000);
  });

  it('a read that never answers becomes unverified at the cap, not before', async () => {
    const settled = vi.fn();
    readAccount(() => new Promise(() => {})).then(settled);
    await vi.advanceTimersByTimeAsync(ACCOUNT_READ_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith({ status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.TIMED_OUT });
  });

  it('an answer that arrives after the cap does not change the result', async () => {
    let answer;
    const pending = readAccount(() => new Promise((resolve) => { answer = resolve; }));
    await vi.advanceTimersByTimeAsync(ACCOUNT_READ_TIMEOUT_MS);
    answer(snapshot(PAID));
    expect((await pending).status).toBe(ACCOUNT.UNVERIFIED);
  });

  it('a slow read that answers inside the cap is used', async () => {
    const pending = readAccount(() => new Promise((resolve) => setTimeout(() => resolve(snapshot(PAID)), 9000)));
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toEqual({ status: ACCOUNT.VERIFIED, data: PAID });
  });

  it('leaves no timer running after it settles', async () => {
    await readAccount(() => Promise.resolve(snapshot(PAID)));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the decision every gate uses', () => {
  const verified = (data) => ({ status: ACCOUNT.VERIFIED, data });
  const cached = { status: ACCOUNT.CACHED, data: PAID };
  const unverified = { status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.READ_FAILED };

  it('waits while sign-in and the first account read are in progress', () => {
    expect(accessDecision({ loading: true, user: null, account: LOADING_ACCOUNT })).toBe(DECISION.LOADING);
  });

  it('a signed-in user with no account result yet is not let through', () => {
    expect(accessDecision({ loading: false, user, account: LOADING_ACCOUNT })).toBe(DECISION.UNVERIFIED);
  });

  it('signed out (including an expired session) goes to login, whatever the account said last', () => {
    for (const account of [LOADING_ACCOUNT, verified(PAID), cached, unverified]) {
      expect(accessDecision({ loading: false, user: null, account })).toBe(DECISION.LOGIN);
    }
  });

  it('verified paid: allowed', () => {
    expect(accessDecision({ loading: false, user, account: verified(PAID) })).toBe(DECISION.ALLOW);
  });

  it('verified unpaid, and a verified missing document: checkout, as before', () => {
    expect(accessDecision({ loading: false, user, account: verified(UNPAID) })).toBe(DECISION.CHECKOUT);
    expect(accessDecision({ loading: false, user, account: verified(null) })).toBe(DECISION.CHECKOUT);
  });

  it('verified unpaid may still open the checkout routes', () => {
    expect(accessDecision({ loading: false, user, account: verified(UNPAID), requirePayment: false, purchase: true })).toBe(DECISION.ALLOW);
  });

  it('verified paid may still open checkout (upgrades are unchanged)', () => {
    expect(accessDecision({ loading: false, user, account: verified(PAID), requirePayment: false, purchase: true })).toBe(DECISION.ALLOW);
  });

  it('unverified: never checkout and never allowed, on any kind of route', () => {
    for (const requirePayment of [true, false]) {
      for (const purchase of [true, false]) {
        expect(accessDecision({ loading: false, user, account: unverified, requirePayment, purchase })).toBe(DECISION.UNVERIFIED);
      }
    }
  });

  it('saved copy marked paid: the app opens, but a purchase route does not', () => {
    expect(accessDecision({ loading: false, user, account: cached })).toBe(DECISION.ALLOW);
    expect(accessDecision({ loading: false, user, account: cached, requirePayment: false })).toBe(DECISION.ALLOW);
    expect(accessDecision({ loading: false, user, account: cached, requirePayment: false, purchase: true })).toBe(DECISION.UNVERIFIED);
  });

  it('a state it does not recognise assumes nothing', () => {
    expect(accessDecision({ loading: false, user, account: { status: 'something-new', data: PAID } })).toBe(DECISION.UNVERIFIED);
    expect(accessDecision({ loading: false, user, account: undefined })).toBe(DECISION.UNVERIFIED);
  });
});

describe('a quiet re-check when the connection returns', () => {
  const failed = { status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.READ_FAILED };

  it('a failed re-check does not take away access a saved copy or the server already gave', () => {
    expect(shouldApplyRefresh({ status: ACCOUNT.CACHED, data: PAID }, failed)).toBe(false);
    expect(shouldApplyRefresh({ status: ACCOUNT.VERIFIED, data: PAID }, failed)).toBe(false);
  });

  it('the server\'s answer always replaces a saved copy, including "unpaid"', () => {
    expect(shouldApplyRefresh({ status: ACCOUNT.CACHED, data: PAID }, { status: ACCOUNT.VERIFIED, data: UNPAID })).toBe(true);
    expect(shouldApplyRefresh(failed, { status: ACCOUNT.VERIFIED, data: PAID })).toBe(true);
  });
});
