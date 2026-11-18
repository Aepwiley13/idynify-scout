/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * W4: credit metering's transactions (utils/creditMetering.js) against a real Firestore:
 * reserve, settle and refund; replay of a retried request; concurrent duplicates; a reservation
 * left by a crash; and who is not charged. The function being metered is a stand-in whose
 * answers each test chooses; the real functions' responses are covered by
 * creditMeteringResponses.test.js.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)('credit metering against Firestore (run via: npm run test:billing-emulator)', () => {
  let db, wipeBillingCollections, metering;
  const UID = 'uid_meter';
  const ENV = { CREDIT_METERING: 'on', ADMIN_USER_IDS: 'uid_env_admin', SUPER_ADMIN_USER_IDS: '' };
  const verify = async (token) => {
    if (!String(token).startsWith('tok:')) throw new Error('bad token');
    return { uid: String(token).slice(4) };
  };
  let clock;
  const now = () => clock;

  beforeAll(async () => {
    ({ db, wipeBillingCollections } = await import('./helpers/billingTestUtils.js'));
    metering = await import('../../netlify/functions/utils/creditMetering.js');
  });

  const userRef = (uid = UID) => db.collection('users').doc(uid);
  const account = async (uid = UID) => (await userRef(uid).get()).data();
  const charges = async (uid = UID) => (await userRef(uid).collection('creditCharges').get()).docs.map((d) => d.data());
  const ledger = async (uid = UID) => (await userRef(uid).collection('creditTransactions').get()).docs.map((d) => d.data());

  const MATCH = { statusCode: 200, headers: {}, body: JSON.stringify({ success: true, enrichedData: { email: 'ada@acme.test' } }) };
  const NO_MATCH = { statusCode: 404, headers: {}, body: JSON.stringify({ success: false, error: 'not_found' }) };
  const request = (uid = UID, extra = {}) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: uid, authToken: `tok:${uid}`, contactId: 'c1', ...extra }) });
  const metered = (inner, env = ENV) => metering.withCreditMetering(inner, { action: 'enrichContact', env, verify, now });

  beforeEach(async () => {
    await wipeBillingCollections();
    for (const coll of ['creditCharges', 'creditTransactions', 'creditUsage']) {
      for (const uid of [UID, 'uid_env_admin', 'uid_free']) {
        const snap = await userRef(uid).collection(coll).get();
        await Promise.all(snap.docs.map((d) => d.ref.delete()));
      }
    }
    clock = Date.parse('2033-01-10T12:00:00Z');
    await userRef().set({ hasCompletedPayment: true, subscriptionTier: 'starter', credits: { total: 10, used: 0, remaining: 10, resetDate: null } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a match: reserved, then charged exactly what was returned, with one ledger entry', async () => {
    const res = await metered(async () => MATCH)(request());
    expect(res).toBe(MATCH);
    expect((await account()).credits).toMatchObject({ used: 1, remaining: 9 });
    expect(await charges()).toEqual([expect.objectContaining({ status: 'settled', charged: 1, reserved: 1 })]);
    expect(await ledger()).toEqual([expect.objectContaining({ action: 'enrichContact', cost: 1, remainingAfter: 9 })]);
  });

  it('no match, or the function fails: everything is given back', async () => {
    await metered(async () => NO_MATCH)(request());
    expect((await account()).credits).toMatchObject({ used: 0, remaining: 10 });
    expect(await charges()).toEqual([expect.objectContaining({ status: 'refunded', charged: 0 })]);

    await expect(metered(async () => { throw new Error('apollo down'); })(request(UID, { contactId: 'c2' }))).rejects.toThrow('apollo down');
    expect((await account()).credits.remaining).toBe(10);
  });

  it('not enough credits: refused before the function runs', async () => {
    await userRef().update({ credits: { total: 10, used: 10, remaining: 0, resetDate: null } });
    const inner = vi.fn(async () => MATCH);
    const res = await metered(inner)(request());
    expect(res.statusCode).toBe(402);
    expect(inner).not.toHaveBeenCalled();
  });

  it('a retry within the window replays the answer: one Apollo call, one charge', async () => {
    const inner = vi.fn(async () => MATCH);
    const first = await metered(inner)(request());
    clock += 60_000;
    const second = await metered(inner)(request());
    expect(inner).toHaveBeenCalledTimes(1);
    expect(second.body).toBe(first.body);
    expect((await account()).credits.remaining).toBe(9);
  });

  it('after the window, the same lookup is a new, billable lookup', async () => {
    const inner = vi.fn(async () => MATCH);
    await metered(inner)(request());
    clock += metering.RETRY_WINDOW_MS + 1;
    await metered(inner)(request());
    expect(inner).toHaveBeenCalledTimes(2);
    expect((await account()).credits.remaining).toBe(8);
  });

  it('two identical requests at once: one runs, the other is told it is in progress, one charge', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const inner = vi.fn(async () => { await gate; return MATCH; });
    const handler = metered(inner);
    const first = handler(request());
    await new Promise((r) => setTimeout(r, 200));
    const second = await handler(request());
    release();
    await first;
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error).toBe('lookup_in_progress');
    expect(inner).toHaveBeenCalledTimes(1);
    expect((await account()).credits.remaining).toBe(9);
  });

  it('a reservation left by a crash is given back in full, then the lookup is reserved again', async () => {
    const key = metering.chargeKey(UID, 'enrichContact', JSON.parse(request().body));
    await userRef().update({ credits: { total: 10, used: 1, remaining: 9, resetDate: null } });
    await userRef().collection('creditCharges').doc(key).set({
      status: 'reserved', chargeId: 'crashed', action: 'enrichContact', reserved: 1,
      reservedAt: new Date(clock - metering.STALE_RESERVATION_MS - 1).toISOString(), response: null,
    });
    await metered(async () => NO_MATCH)(request());
    expect((await account()).credits).toMatchObject({ used: 0, remaining: 10 });
    expect(await ledger()).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'stale_reservation', refunded: 1 })]));
  });

  it('a settle that finds its reservation already handled changes nothing', async () => {
    const key = 'k_handled';
    await userRef().collection('creditCharges').doc(key).set({ status: 'refunded', chargeId: 'x', reserved: 1 });
    const result = await metering.settleCharge({ uid: UID, action: 'enrichContact', key, chargeId: 'x', used: 1, now: clock });
    expect(result.kind).toBe('already_handled');
    expect((await account()).credits.remaining).toBe(10);
  });

  it('a legacy numeric balance stays numeric', async () => {
    await userRef().update({ credits: 5 });
    await metered(async () => MATCH)(request());
    expect((await account()).credits).toBe(4);
  });

  it('not charged: an admin, an admin acting for someone, and an account without paid access (its guard refuses)', async () => {
    await userRef('uid_env_admin').set({ email: 'ops@example.test' });
    await userRef('uid_free').set({ email: 'free@example.test' });
    const inner = vi.fn(async () => MATCH);
    await metered(inner)(request('uid_env_admin'));
    await metered(inner)({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: UID, authToken: 'tok:uid_env_admin', contactId: 'c1' }) });
    await metered(inner)(request('uid_free'));
    expect(inner).toHaveBeenCalledTimes(3);
    expect((await account()).credits.remaining).toBe(10);
    expect(await charges('uid_env_admin')).toEqual([]);
    expect(await charges('uid_free')).toEqual([]);
  });

  it('tokens that do not all verify to one account are refused before anything runs', async () => {
    const inner = vi.fn(async () => MATCH);
    const res = await metered(inner)({ httpMethod: 'POST', headers: { authorization: 'Bearer tok:uid_env_admin' }, body: JSON.stringify({ userId: UID, authToken: `tok:${UID}` }) });
    expect(res.statusCode).toBe(401);
    expect(inner).not.toHaveBeenCalled();
    const forged = await metered(inner)({ httpMethod: 'POST', headers: { authorization: 'Bearer forged' }, body: JSON.stringify({ userId: UID, authToken: `tok:${UID}` }) });
    expect(forged.statusCode).toBe(401);
  });

  it('metering off: the function runs and nothing is written', async () => {
    const inner = vi.fn(async () => MATCH);
    await metered(inner, { ...ENV, CREDIT_METERING: '' })(request());
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await charges()).toEqual([]);
    expect((await account()).credits.remaining).toBe(10);
  });

  it('the daily search count stops at its limit and resets the next day', async () => {
    const search = metering.withCreditMetering(async () => ({ statusCode: 200, body: '{}' }), {
      action: 'findContact', env: { ...ENV, CREDIT_DAILY_SEARCH_LIMIT: '2' }, verify, now,
    });
    expect((await search(request(UID, { q: 1 }))).statusCode).toBe(200);
    expect((await search(request(UID, { q: 2 }))).statusCode).toBe(200);
    expect((await search(request(UID, { q: 3 }))).statusCode).toBe(429);
    clock += 24 * 60 * 60 * 1000;
    expect((await search(request(UID, { q: 4 }))).statusCode).toBe(200);
    expect((await account()).credits.remaining).toBe(10);
  });
});
