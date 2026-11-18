/* global process, Buffer */
/**
 * Billing Phase 1d: a Free (or lapsed, or unverifiable) account cannot make Idynify pay for Claude.
 *
 * Every Claude-powered function is called DIRECTLY with its real exported handler, the way anyone
 * with a valid sign-in could call it. The Anthropic SDK and the network are fakes that record
 * every request, so "no Claude call" is observed, not assumed. Accounts come from a fake
 * Firestore holding what the server holds; nothing the request body says about payment counts.
 *
 * The coverage test finds every function that can reach Claude (directly or through the modules
 * it imports) from the source, so a new one that is not guarded fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const { state } = vi.hoisted(() => ({
  state: { docs: new Map(), failUserReads: false, claude: [] },
}));

function makeFakeDb() {
  let auto = 0;
  const snap = (path) => {
    const data = state.docs.get(path);
    return { exists: data !== undefined, id: path.split('/').at(-1), data: () => data, get: (f) => data?.[f], ref: docRef(path) };
  };
  function docRef(path) {
    return {
      path,
      id: path.split('/').at(-1),
      async get() {
        if (state.failUserReads && /^users\/[^/]+$/.test(path)) throw new Error('firestore unavailable');
        return snap(path);
      },
      async set(data, opts) { state.docs.set(path, opts?.merge ? { ...(state.docs.get(path) ?? {}), ...data } : { ...data }); },
      async update(data) { state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data }); },
      async delete() { state.docs.delete(path); },
      collection: (name) => coll(`${path}/${name}`),
    };
  }
  function coll(path) {
    const depth = path.split('/').length + 1;
    const q = {
      where: () => q, orderBy: () => q, limit: () => q, select: () => q, startAfter: () => q, offset: () => q,
      async get() {
        const docs = [...state.docs.keys()].filter((p) => p.startsWith(`${path}/`) && p.split('/').length === depth).map(snap);
        return { empty: docs.length === 0, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
      },
      doc: (id) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      async add(data) { const ref = docRef(`${path}/auto${++auto}`); await ref.set(data); return ref; },
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    };
    return q;
  }
  return {
    collection: coll,
    doc: (path) => docRef(path),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete() }); },
    batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: makeFakeDb(),
  admin: {
    auth: () => ({
      verifyIdToken: async (token) => {
        if (!String(token).startsWith('tok:')) throw new Error('bad token');
        return { uid: String(token).slice(4) };
      },
    }),
  },
}));

// Functions that set up the Admin SDK themselves get the same fake Firestore.
vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}], cert: () => ({}), applicationDefault: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => makeFakeDb(),
  FieldValue: { serverTimestamp: () => 'ts', increment: (n) => n, arrayUnion: (...a) => a, arrayRemove: (...a) => a, delete: () => null },
  Timestamp: { now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }), fromDate: (d) => d, fromMillis: (m) => m },
}));

// Every way into Claude: the SDK (create and stream) is recorded; so is any direct fetch.
vi.mock('@anthropic-ai/sdk', () => {
  const reply = { id: 'msg_test', content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  class Anthropic {
    constructor() {
      this.messages = {
        create: async (request) => { state.claude.push(request?.model ?? 'sdk'); return reply; },
        stream: (request) => { state.claude.push(request?.model ?? 'sdk-stream'); return { finalMessage: async () => reply, on() { return this; } }; },
      };
    }
  }
  return { default: Anthropic, Anthropic };
});

function fakeFetch(url, init = {}) {
  const u = String(url);
  const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes('api.anthropic.com')) {
    state.claude.push('fetch');
    return json({ content: [{ type: 'text', text: '{}' }], usage: {} });
  }
  if (u.includes('accounts:lookup')) {
    const { idToken } = JSON.parse(init.body || '{}');
    if (!String(idToken).startsWith('tok:')) return json({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
    return json({ users: [{ localId: String(idToken).slice(4) }] });
  }
  return json({});
}

const ENV = {
  ANTHROPIC_API_KEY: 'anthropic-test-key', FIREBASE_API_KEY: 'web-key', FIREBASE_PROJECT_ID: 'demo-paid-ai',
  URL: 'https://idynify.test', CAPTURE_MODE: 'on', ADMIN_USER_IDS: 'u_env_admin', SUPER_ADMIN_USER_IDS: '',
};

beforeEach(() => {
  state.docs = new Map();
  state.failUserReads = false;
  state.claude = [];
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FREE = 'u_free';
const LAPSED = 'u_lapsed';
const PAID = 'u_paid';
const ROLE_ADMIN = 'u_role_admin';
const ENV_ADMIN = 'u_env_admin';
const NO_ACCOUNT = 'u_nobody';

function seedAccounts() {
  state.docs.set(`users/${FREE}`, { email: 'free@example.test', createdAt: 1 });
  state.docs.set(`users/${LAPSED}`, { email: 'lapsed@example.test', hasCompletedPayment: false, subscriptionStatus: 'canceled', subscriptionTier: 'starter' });
  state.docs.set(`users/${PAID}`, { email: 'paid@example.test', hasCompletedPayment: true, subscriptionStatus: 'active', subscriptionTier: 'pro' });
  state.docs.set(`users/${ROLE_ADMIN}`, { email: 'admin@example.test', role: 'admin' });
  state.docs.set(`users/${ENV_ADMIN}`, { email: 'ops@example.test' });
}

// ── Which functions can reach Claude: found from the source, never listed by hand ─────────────

const ROOT = process.cwd();
const FUNCTIONS = resolve(ROOT, 'netlify/functions');
const REACHES_CLAUDE = /@anthropic-ai\/sdk|api\.anthropic\.com|ANTHROPIC_API_KEY/;
const LOCAL_IMPORT = /(?:from\s+|import\s*\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function localImports(file) {
  const out = [];
  for (const m of readFileSync(file, 'utf8').matchAll(LOCAL_IMPORT)) {
    const target = resolve(dirname(file), m[1]);
    for (const candidate of [target, `${target}.js`, `${target}.mjs`]) {
      if (existsSync(candidate) && candidate.endsWith('js')) { out.push(candidate); break; }
    }
  }
  return out;
}

function reachesClaude(file) {
  const seen = new Set();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    // The guard's own module names the provider nowhere, and its imports are not Claude.
    if (f.endsWith('/utils/paidAiAccess.js')) continue;
    if (REACHES_CLAUDE.test(readFileSync(f, 'utf8'))) return true;
    stack.push(...localImports(f));
  }
  return false;
}

/** Functions that reach Claude without the wrapper, and why that is safe. Nothing else may. */
const EXEMPT = {
  'anthropicKeyCheck.js': 'calls only the free Models API and messages/count_tokens, cached per instance (#699)',
  'process-barry-inbox-queue.js': 'scheduled worker with no caller identity; filters each owner through ownerAiAccess',
};

const functionFiles = readdirSync(FUNCTIONS).filter((f) => f.endsWith('.js'));
const claudeFunctions = functionFiles.filter((f) => reachesClaude(resolve(FUNCTIONS, f))).sort();
const guarded = claudeFunctions.filter((f) => !EXEMPT[f]);
const source = (f) => readFileSync(resolve(FUNCTIONS, f), 'utf8');
const isCommonJs = (f) => /^exports\.handler = /m.test(source(f));
const callable = guarded.filter((f) => !isCommonJs(f)).map((f) => f.slice(0, -3));

describe('coverage: every function that can reach Claude is guarded', () => {
  it('finds the Claude-powered functions (sanity: the scan works)', () => {
    expect(claudeFunctions.length).toBeGreaterThanOrEqual(40);
    for (const f of ['barryMissionChat.js', 'barryOrientationBrief.js', 'barryActions.js', 'captureExtract.js', 'generate-section-1.js', 'process-barry-inbox-queue.js']) {
      expect(claudeFunctions, f).toContain(f);
    }
    // A function that never reaches Claude is not swept in.
    expect(claudeFunctions).not.toContain('enrichContact.js');
    expect(claudeFunctions).not.toContain('stripe-webhook.js');
  });

  it('each one exports its handler through withPaidAiAccess, named after the file', () => {
    for (const f of guarded) {
      const src = source(f);
      const feature = f.slice(0, -3);
      const exportsGuarded = new RegExp(`^(export const handler|exports\\.handler) = withPaidAiAccess\\(unguardedHandler, \\{ feature: '${feature}' \\}\\);$`, 'm');
      expect(src, f).toMatch(exportsGuarded);
      // No second, unguarded way to export a handler.
      const handlerExports = src.match(/^(export const handler\b|export async function handler\b|export function handler\b|exports\.handler\b|export \{[^}]*\bhandler\b)/gm) ?? [];
      expect(handlerExports, f).toHaveLength(1);
      expect(src, f).not.toMatch(/export default/);
    }
  });

  it('the exemptions are exactly the two reviewed ones', () => {
    expect(claudeFunctions.filter((f) => EXEMPT[f])).toEqual(Object.keys(EXEMPT).sort());
    expect(source('anthropicKeyCheck.js')).not.toMatch(/\/messages['"`]\s*,|\/messages`/);
    expect(source('anthropicKeyCheck.js')).toMatch(/\/messages\/count_tokens/);
  });
});

// ── Direct calls to every real handler ──────────────────────────────────────────────────────────

const event = ({ token, userId, body = {}, method = 'POST', header = false }) => ({
  httpMethod: method,
  headers: header && token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify({ ...(userId ? { userId } : {}), ...(token && !header ? { authToken: token, idToken: token } : {}), ...body }),
});

const parsed = (res) => { try { return JSON.parse(res?.body ?? 'null'); } catch { return null; } };
const refusedByGuard = (res, feature) => parsed(res)?.feature === feature && [401, 402, 503].includes(res.statusCode);

async function handlerOf(name) {
  const mod = await import(`../../netlify/functions/${name}.js`);
  return mod.handler;
}

describe.each(callable)('%s called directly', (name) => {
  beforeEach(seedAccounts);

  const refuses = async (ev, status, error) => {
    const handler = await handlerOf(name);
    const res = await handler(ev);
    expect(res.statusCode).toBe(status);
    expect(parsed(res)).toMatchObject({ success: false, error, feature: name });
    expect(state.claude).toEqual([]);
  };

  it('a Free account: 402, and Claude is never called', () => refuses(event({ token: `tok:${FREE}`, userId: FREE }), 402, 'paid_plan_required'));
  it('a Free account sending the token in the Authorization header: 402', () => refuses(event({ token: `tok:${FREE}`, userId: FREE, header: true }), 402, 'paid_plan_required'));
  it('a lapsed customer: 402', () => refuses(event({ token: `tok:${LAPSED}`, userId: LAPSED }), 402, 'paid_plan_required'));
  it('a signed-in user with no account document: 402', () => refuses(event({ token: `tok:${NO_ACCOUNT}`, userId: NO_ACCOUNT }), 402, 'paid_plan_required'));
  it('a Free account claiming payment in the request: still 402', () => refuses(
    event({ token: `tok:${FREE}`, userId: FREE, body: { hasCompletedPayment: true, subscriptionTier: 'pro', role: 'admin', isAdmin: true } }), 402, 'paid_plan_required'));
  it("a Free account naming a paid account's id: still 402 (the token holder is checked)", () => refuses(event({ token: `tok:${FREE}`, userId: PAID }), 402, 'paid_plan_required'));
  it("a Free token beside a paid account's token: 402 (every token must pass)", () => refuses(
    { httpMethod: 'POST', headers: { authorization: `Bearer tok:${PAID}` }, body: JSON.stringify({ userId: FREE, authToken: `tok:${FREE}` }) }, 402, 'paid_plan_required'));
  it('the account cannot be read: 503, nothing assumed', () => {
    state.failUserReads = true;
    return refuses(event({ token: `tok:${PAID}`, userId: PAID }), 503, 'entitlement_unavailable');
  });
  it('no token: 401', () => refuses(event({ userId: PAID }), 401, 'unauthorized'));
  it('a token that does not verify: 401', () => refuses(event({ token: 'forged', userId: PAID }), 401, 'unauthorized'));

  const passes = async (ev) => {
    const handler = await handlerOf(name);
    const res = await handler(ev);
    expect(refusedByGuard(res, name), JSON.stringify(parsed(res))).toBe(false);
  };

  it('a paid account reaches the function', () => passes(event({ token: `tok:${PAID}`, userId: PAID })));
  it('an admin by role reaches the function', () => passes(event({ token: `tok:${ROLE_ADMIN}`, userId: ROLE_ADMIN })));
  it("an admin from the server's list reaches the function", () => passes(event({ token: `tok:${ENV_ADMIN}`, userId: ENV_ADMIN })));
  it('an admin acting for a Free user (impersonation) reaches the function', () => passes(event({ token: `tok:${ROLE_ADMIN}`, userId: FREE })));
  it('CORS preflight goes straight to the function', () => passes({ httpMethod: 'OPTIONS', headers: {}, body: '' }));
});

// ── The wrapper and the decision on their own ───────────────────────────────────────────────────

describe('requestTokens', () => {
  it('reads the Authorization header and the body fields these functions use, once each', async () => {
    const { requestTokens } = await import('../../netlify/functions/utils/paidAiAccess.js');
    expect(requestTokens({ headers: { Authorization: 'Bearer a' }, body: JSON.stringify({ authToken: 'b', idToken: 'a' }) })).toEqual(['a', 'b']);
    expect(requestTokens({ headers: {}, body: Buffer.from(JSON.stringify({ idToken: 'c' })).toString('base64'), isBase64Encoded: true })).toEqual(['c']);
    expect(requestTokens({ headers: { authorization: 'Bearer ' }, body: 'not json' })).toEqual([]);
    expect(requestTokens({ headers: {}, body: JSON.stringify({ authToken: 42, token: 'ignored' }) })).toEqual([]);
    expect(requestTokens({})).toEqual([]);
  });
});

describe('withPaidAiAccess', () => {
  it('runs the handler only when the check allows it', async () => {
    const { withPaidAiAccess } = await import('../../netlify/functions/utils/paidAiAccess.js');
    const inner = vi.fn(async () => ({ statusCode: 200, body: '{}' }));
    const allow = withPaidAiAccess(inner, { feature: 'x', check: async () => ({ allowed: true, basis: 'paid' }) });
    const deny = withPaidAiAccess(inner, { feature: 'x', check: async () => ({ allowed: false, statusCode: 402, error: 'paid_plan_required' }) });
    const broken = withPaidAiAccess(inner, { feature: 'x', check: async () => { throw new Error('boom'); } });
    expect((await deny({ httpMethod: 'POST' })).statusCode).toBe(402);
    expect((await broken({ httpMethod: 'POST' })).statusCode).toBe(503);
    expect(inner).not.toHaveBeenCalled();
    expect((await allow({ httpMethod: 'POST' })).statusCode).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('a refusal carries no account data', async () => {
    const { withPaidAiAccess } = await import('../../netlify/functions/utils/paidAiAccess.js');
    const res = await withPaidAiAccess(async () => ({}), { feature: 'barryMissionChat', check: async () => ({ allowed: false, statusCode: 402, error: 'paid_plan_required', uid: 'secret' }) })({ httpMethod: 'POST' });
    expect(Object.keys(parsed(res)).sort()).toEqual(['error', 'feature', 'message', 'success']);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('refuses to wrap without a handler or a feature name', async () => {
    const { withPaidAiAccess } = await import('../../netlify/functions/utils/paidAiAccess.js');
    expect(() => withPaidAiAccess(null, { feature: 'x' })).toThrow(TypeError);
    expect(() => withPaidAiAccess(async () => ({}), {})).toThrow(TypeError);
  });

  it('uses the same refusal codes as the Apollo guard (Phase 1c)', async () => {
    const { PAID_AI_DENIAL } = await import('../../netlify/functions/utils/paidAiAccess.js');
    const { PAID_API_DENIAL } = await import('../../netlify/functions/utils/paidApiAccess.js');
    expect(PAID_AI_DENIAL.NOT_PAID).toBe(PAID_API_DENIAL.NOT_PAID);
    expect(PAID_AI_DENIAL.UNVERIFIED).toBe(PAID_API_DENIAL.UNVERIFIED);
  });
});

// ── The scheduled inbox worker ──────────────────────────────────────────────────────────────────

describe('process-barry-inbox-queue: Barry analyses mail only for paid owners', () => {
  beforeEach(seedAccounts);

  it('ownerAiAccess: paid and admins yes, Free and missing no, unreadable unverified; read once per owner', async () => {
    const { ownerAiAccess } = await import('../../netlify/functions/process-barry-inbox-queue.js');
    const cache = new Map();
    expect(await ownerAiAccess(cache, PAID)).toBe('paid');
    expect(await ownerAiAccess(cache, ROLE_ADMIN)).toBe('paid');
    expect(await ownerAiAccess(cache, FREE)).toBe('not_paid');
    expect(await ownerAiAccess(cache, LAPSED)).toBe('not_paid');
    expect(await ownerAiAccess(cache, undefined)).toBe('not_paid');
    state.docs.delete(`users/${PAID}`);
    expect(await ownerAiAccess(cache, PAID)).toBe('paid');
    state.failUserReads = true;
    expect(await ownerAiAccess(new Map(), PAID)).toBe('unverified');
  });

  it('a run sends only the paid owner\'s message to Claude; the Free one is set aside, the unreadable one waits', async () => {
    const { processInboxQueue } = await import('../../netlify/functions/process-barry-inbox-queue.js');
    const queue = (id, owner) => {
      state.docs.set(`barry_processing_queue/${id}`, { status: 'pending', sprintVersion: 'sprint2', messageRecordId: `m_${id}`, contactId: `c_${id}`, idynifyUserId: owner });
      state.docs.set(`communication_records/m_${id}`, { idynifyUserId: owner, contactId: `c_${id}`, direction: 'inbound', subject: 'Re: hello', bodyText: 'Thanks, can we talk Tuesday?' });
      state.docs.set(`users/${owner}/contacts/c_${id}`, { name: 'Pat Example', firstName: 'Pat' });
    };
    queue('free', FREE);
    const first = parsed(await processInboxQueue({}));
    expect(first.results.entries.find((e) => e.messageRecordId === 'm_free')).toMatchObject({ status: 'skipped', reason: 'paid_plan_required' });
    expect(state.docs.get('barry_processing_queue/free').status).toBe('skipped_not_paid');
    expect(state.claude).toEqual([]);

    // The same run shape with a paid owner does reach Claude, so the test can see a call.
    queue('paid', PAID);
    const body = parsed(await processInboxQueue({}));
    expect(body.results.entries.find((e) => e.messageRecordId === 'm_paid').reason).toBeUndefined();
    expect(state.claude.length).toBeGreaterThan(0);

    state.claude = [];
    queue('later', FREE);
    state.failUserReads = true;
    const second = parsed(await processInboxQueue({}));
    expect(second.results.entries.find((e) => e.messageRecordId === 'm_later')).toMatchObject({ status: 'skipped', reason: 'entitlement_unavailable' });
    expect(state.docs.get('barry_processing_queue/later').status).toBe('pending');
    expect(state.claude).toEqual([]);
  });
});
