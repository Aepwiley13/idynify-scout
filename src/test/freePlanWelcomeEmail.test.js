/**
 * Abuse and regression tests for the public welcome-email handler.
 * All Firebase/Resend effects are faked; no network or production secrets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  claims: new Map(),
  account: { email: 'registered@example.test' },
  authEmail: 'registered@example.test',
  offline: false,
  providerOk: true,
  sends: [],
}));

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: {
    auth: () => ({
      verifyIdToken: async (token) => {
        if (token !== 'good-token') throw new Error('bad token');
        return { uid: 'u1' };
      },
      getUser: async () => {
        if (state.offline) throw new Error('offline');
        return { email: state.authEmail };
      },
    }),
  },
  db: {
    collection: (name) => ({
      doc: (uid) => ({
        uid,
        get: async () => {
          if (state.offline) throw new Error('offline');
          return name === 'users'
            ? { exists: !!state.account, data: () => state.account }
            : { exists: state.claims.has(uid), data: () => state.claims.get(uid) };
        },
        set: async (data) => state.claims.set(uid, { ...state.claims.get(uid), ...data }),
      }),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => ({ exists: state.claims.has(ref.uid) }),
      create: (ref, data) => {
        if (state.claims.has(ref.uid)) throw new Error('duplicate welcome email claim');
        state.claims.set(ref.uid, data);
      },
    }),
  },
}));

const { handler, freeWelcomeEmail } = await import('../../netlify/functions/send-welcome-email.js');
const post = (body = {}, token = 'good-token') => ({
  httpMethod: 'POST',
  headers: token ? { authorization: 'Bearer ' + token } : {},
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.claims.clear();
  state.account = { email: 'registered@example.test' };
  state.authEmail = 'registered@example.test';
  state.offline = false;
  state.providerOk = true;
  state.sends.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('URL', 'https://idynify.test');
  vi.stubGlobal('fetch', vi.fn(async (_, options) => {
    state.sends.push(JSON.parse(options.body));
    return { ok: state.providerOk, json: async () => ({ id: 'em_1' }), text: async () => 'rejected' };
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('welcome-email security', () => {
  it('rejects anonymous requests without sending', async () => {
    expect((await handler(post({}, null))).statusCode).toBe(401);
    expect(state.sends).toHaveLength(0);
  });
  it('rejects invalid tokens without sending', async () => {
    expect((await handler(post({}, 'invalid'))).statusCode).toBe(401);
    expect(state.sends).toHaveLength(0);
  });
  it('rejects email mismatches without sending', async () => {
    state.account = { email: 'someone-else@example.test' };
    expect((await handler(post())).statusCode).toBe(403);
    expect(state.sends).toHaveLength(0);
  });
  it('fails closed on a Firebase read failure', async () => {
    state.offline = true;
    expect((await handler(post())).statusCode).toBe(503);
    expect(state.sends).toHaveLength(0);
  });
  it('ignores forged recipient, uid and tier; free email links only to Contact Hub', async () => {
    const r = await handler(post({ email: 'victim@example.test', userId: 'other-user', plan: 'pro' }));
    expect(r.statusCode).toBe(200);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].to).toBe('registered@example.test');
    expect(state.sends[0].subject).toBe('Welcome to Idynify — your Contact Hub is ready');
    expect([...state.sends[0].html.matchAll(/href="([^"]+)"/g)].map(m => m[1]))
      .toEqual(['https://idynify.test/contact-hub']);
  });
  it('derives paid email from the account, ignoring a forged Free claim', async () => {
    state.account.selectedTier = 'pro';
    expect((await handler(post({ plan: 'free' }))).statusCode).toBe(200);
    expect(state.sends[0].subject).toBe("Hi — I'm Aaron, the founder of Idynify 👋");
    expect(state.sends[0].html).toContain('/getting-started');
  });
  it('a repeated request is a no-op, not a duplicate email', async () => {
    expect((await handler(post())).statusCode).toBe(200);
    const next = await handler(post());
    expect(next.statusCode).toBe(200);
    expect(JSON.parse(next.body).alreadyRequested).toBe(true);
    expect(state.sends).toHaveLength(1);
    expect(state.claims.get('u1').status).toBe('sent');
  });
  it('does not retry a failed provider send without owner reconciliation', async () => {
    state.providerOk = false;
    expect((await handler(post())).statusCode).toBe(500);
    state.providerOk = true;
    expect((await handler(post())).statusCode).toBe(200);
    expect(state.sends).toHaveLength(1);
    expect(state.claims.get('u1').status).toBe('failed');
  });
  it('the Free copy never links to paid routes', () => {
    expect(freeWelcomeEmail('https://idynify.test').html)
      .not.toMatch(/getting-started|\/scout|\/checkout|\/barry/);
  });
});
