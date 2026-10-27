// @vitest-environment node
/**
 * PHASE 0 SPIKE (#734) — evidence for the Lambda-compatibility migration plan.
 * Lives only on the spike branch; not for merge.
 *
 * Each spiked function keeps its Lambda handler unchanged, exports it as
 * `lambdaHandler` (the rest of the suite calls that), and exports
 * `withLambda(handler)` as the default, which Netlify runs on the modern
 * runtime. It must not export anything named `handler`: Netlify's bundler
 * then classifies the file as Lambda-mode. These tests call the default export with
 * a real web `Request`, the way the modern runtime does, and compare the
 * `Response` with what the handler returns directly.
 *
 * Covered: plain JSON (linkedin-disconnect), cookies + redirects
 * (linkedin-oauth-init / -callback), a raw-body signature (stripe-webhook),
 * a binary response (track-open), and the wrapper's Lambda `context`. The
 * last block pins the incompatibilities found in the wrapper itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import Stripe from 'stripe';
import { withLambda } from '@netlify/aws-lambda-compat';

// ─── Minimal Firestore + auth fakes ─────────────────────────────────────────
const store = new Map();
const clone = v => (v === undefined ? undefined : structuredClone(v));
const ref = path => ({ path, async set(d) { store.set(path, clone(d)); }, async get() { return snap(path); }, async delete() { store.delete(path); } });
const snap = path => ({ exists: store.has(path), data: () => clone(store.get(path)), ref: ref(path) });
const fakeDb = {
  doc: ref,
  async runTransaction(fn) {
    const writes = [];
    const out = await fn({ get: async r => snap(r.path), set: (r, d) => writes.push(() => store.set(r.path, clone(d))), delete: r => writes.push(() => store.delete(r.path)) });
    writes.forEach(w => w());
    return out;
  },
};
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken: async t => { if (t !== 'tok-A') throw new Error('bad'); return { uid: 'A' }; } }) },
  db: fakeDb,
}));
vi.mock('firebase-admin', () => ({ default: { apps: [{}], initializeApp: vi.fn(), credential: { cert: vi.fn() }, firestore: () => ({}) } }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}), FieldValue: {}, Timestamp: {} }));

const disconnect = await import('../../netlify/functions/linkedin-disconnect.js');
const init = await import('../../netlify/functions/linkedin-oauth-init.js');
const callback = await import('../../netlify/functions/linkedin-oauth-callback.js');
const stripeWebhook = await import('../../netlify/functions/stripe-webhook.js');
const trackOpen = await import('../../netlify/functions/track-open.js');

const NETLIFY_CONTEXT = { requestId: 'req-123' };
const call = (mod, request) => mod.default(request, NETLIFY_CONTEXT);

beforeEach(() => {
  store.clear();
  process.env.LINKEDIN_CLIENT_ID = 'cid';
  process.env.LINKEDIN_CLIENT_SECRET = 'secret';
  process.env.LINKEDIN_REDIRECT_URI = 'https://idynify.com/.netlify/functions/linkedin-oauth-callback';
  process.env.STRIPE_SECRET_KEY = 'sk_test_phase0';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phase0';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Q1: wrapped, with the Lambda handler still exported for tests', () => {
  // Not under the name `handler`: an export with that name makes Netlify's
  // bundler classify the file as Lambda-mode (runtimeAPIVersion 1) even with
  // the default export present.
  it('every spiked module exports the Lambda handler as lambdaHandler, a modern default, and no `handler`', () => {
    for (const mod of [disconnect, init, callback, stripeWebhook, trackOpen]) {
      expect(mod).not.toHaveProperty('handler');
      expect(typeof mod.lambdaHandler).toBe('function');
      expect(typeof mod.default).toBe('function');
      expect(mod.default.length).toBe(2);                 // (request, context): the modern signature
    }
  });
});

describe('Q3: what survives the wrapper', () => {
  it('plain JSON: status, content type and body match the direct handler', async () => {
    const direct = await disconnect.lambdaHandler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-A' }, body: '{}' });
    const res = await call(disconnect, new Request('https://idynify.com/.netlify/functions/linkedin-disconnect', {
      method: 'POST', headers: { authorization: 'Bearer tok-A', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(res.status).toBe(direct.statusCode);
    expect(res.headers.get('content-type')).toBe(direct.headers['Content-Type']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(direct.body);
    const unauth = await call(disconnect, new Request('https://idynify.com/f', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
    expect(unauth.status).toBe(401);
  });

  it('cookies: init\'s HttpOnly __Host- binding cookie arrives byte-for-byte', async () => {
    const res = await call(init, new Request('https://idynify.com/.netlify/functions/linkedin-oauth-init', {
      method: 'POST', headers: { authorization: 'Bearer tok-A', 'content-type': 'application/json', host: 'idynify.com' }, body: '{}',
    }));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Host-idy_linkedin_oauth=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    expect(JSON.parse(await res.text()).authUrl).toMatch(/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?/);
  });

  it('redirects: the callback\'s 302, Location and cookie-clearing header match the direct handler', async () => {
    const query = 'error=user_cancelled_authorize&state=s1';
    const direct = await callback.lambdaHandler({ httpMethod: 'GET', queryStringParameters: { error: 'user_cancelled_authorize', state: 's1' }, headers: {} });
    const res = await call(callback, new Request(`https://idynify.com/.netlify/functions/linkedin-oauth-callback?${query}`, { redirect: 'manual' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(direct.headers.Location);
    expect(res.headers.get('location')).toBe('/settings?tab=integrations&linkedin=denied');
    expect(res.headers.getSetCookie()).toEqual([direct.headers['Set-Cookie']]);
    expect(await res.text()).toBe('');
  });

  it('a cookie sent by the browser reaches the handler (the callback\'s browser binding)', async () => {
    const seen = [];
    const probe = withLambda(async event => { seen.push(event.headers.cookie); return { statusCode: 200, body: '' }; });
    await probe(new Request('https://idynify.com/f', { headers: { cookie: 'a=1; __Host-idy_linkedin_oauth=abc' } }), NETLIFY_CONTEXT);
    expect(seen).toEqual(['a=1; __Host-idy_linkedin_oauth=abc']);
  });

  it('raw body: a Stripe signature over a non-ASCII payload verifies through the wrapper; a tampered one is refused', async () => {
    const payload = JSON.stringify({ id: 'evt_phase0', object: 'event', type: 'customer.created', data: { object: { id: 'cus_1', name: 'Zoë — café 名前' } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const post = body => call(stripeWebhook, new Request('https://idynify.com/.netlify/functions/stripe-webhook', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': signature }, body,
    }));
    const ok = await post(payload);
    expect(ok.status).toBe(200);
    const tampered = await post(payload.replace('café', 'cafe'));
    expect(tampered.status).toBe(400);
    expect(await tampered.text()).toMatch(/Webhook Error/);
  });

  it('binary: the tracking pixel comes back as the exact GIF bytes', async () => {
    const direct = await trackOpen.lambdaHandler({ httpMethod: 'GET', queryStringParameters: null, headers: {} });
    const res = await call(trackOpen, new Request('https://idynify.com/.netlify/functions/track-open'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(direct.body, 'base64'));
    expect(Buffer.from(direct.body, 'base64').subarray(0, 6).toString()).toBe('GIF89a');
  });

  it('Lambda context: requestId maps to awsRequestId; time remaining reads 0; done/fail/succeed throw', async () => {
    let ctx;
    await withLambda(async (_e, c) => { ctx = c; return { statusCode: 200, body: '' }; })(new Request('https://idynify.com/f'), NETLIFY_CONTEXT);
    expect(ctx.awsRequestId).toBe('req-123');
    expect(ctx.getRemainingTimeInMillis()).toBe(0);
    expect(() => ctx.done()).toThrow(/not supported/);
  });
});

describe('Wrapper incompatibilities found in Phase 0', () => {
  it('a 204 (or 304) with body "" crashes the wrapper — four functions return that from OPTIONS', async () => {
    const wrapped = withLambda(async () => ({ statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
    await expect(wrapped(new Request('https://idynify.com/f', { method: 'OPTIONS' }), NETLIFY_CONTEXT)).rejects.toThrow(/Invalid response status code 204/);
    const fine = withLambda(async () => ({ statusCode: 204, headers: {} }));
    expect((await fine(new Request('https://idynify.com/f', { method: 'OPTIONS' }), NETLIFY_CONTEXT)).status).toBe(204);
  });

  it('a request body with no content type arrives base64-encoded; JSON and text bodies arrive as text', async () => {
    const seen = [];
    const probe = withLambda(async e => { seen.push([e.isBase64Encoded, e.body]); return { statusCode: 200, body: '' }; });
    await probe(new Request('https://idynify.com/f', { method: 'POST', body: new Blob(['{"a":1}']) }), NETLIFY_CONTEXT);
    await probe(new Request('https://idynify.com/f', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }), NETLIFY_CONTEXT);
    await probe(new Request('https://idynify.com/f', { method: 'POST', body: '{"a":1}' }), NETLIFY_CONTEXT);   // text/plain;charset=UTF-8
    expect(seen).toEqual([[true, 'eyJhIjoxfQ=='], [false, '{"a":1}'], [false, '{"a":1}']]);
  });

  it('no query string gives queryStringParameters null (every current read is guarded)', async () => {
    let qs;
    await withLambda(async e => { qs = e.queryStringParameters; return { statusCode: 200, body: '' }; })(new Request('https://idynify.com/f'), NETLIFY_CONTEXT);
    expect(qs).toBeNull();
  });
});
