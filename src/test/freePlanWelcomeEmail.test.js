/**
 * A Free signup's welcome email points to their Contact Hub, never to a paid page. The paid
 * signup's email is unchanged. `plan` only chooses the copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const NOW = Date.now();
const auth = vi.hoisted(() => ({ users: {}, tokens: {} }));
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({
    verifyIdToken: async (t) => { if (!auth.tokens[t]) throw new Error('bad'); return auth.tokens[t]; },
    getUser: async (uid) => auth.users[uid],
  }) },
  db: {},
}));
import { handler, freeWelcomeEmail, WELCOME_WINDOW_MS } from '../../netlify/functions/send-welcome-email.js';

let sent;
beforeEach(() => {
  sent = [];
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('URL', 'https://idynify.test');
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'em_1' }) }; }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  auth.tokens = { tok_u1: { uid: 'u1', email: 'A@example.test' }, tok_u2: { uid: 'u2', email: 'b@example.test' } };
  auth.users = { u1: { metadata: { creationTime: new Date(NOW - 60_000).toUTCString() } },
                 u2: { metadata: { creationTime: new Date(NOW - WELCOME_WINDOW_MS - 120_000).toUTCString() } } };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = (body, token = 'tok_u1') => ({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

describe('send-welcome-email', () => {
  it('a Free signup gets the Contact Hub welcome, whose only link is the Contact Hub', async () => {
    const res = await handler(post({ email: 'a@example.test', userId: 'u1', plan: 'free' }));
    expect(res.statusCode).toBe(200);
    expect(sent[0].subject).toBe('Welcome to Idynify — your Contact Hub is ready');
    const links = [...sent[0].html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['https://idynify.test/contact-hub']);
  });

  it.each([['starter'], ['pro'], [undefined]])('a %s signup gets the existing email, unchanged', async (plan) => {
    await handler(post({ email: 'a@example.test', userId: 'u1', plan }));
    expect(sent[0].subject).toBe('Hi — I\'m Aaron, the founder of Idynify 👋');
    expect(sent[0].html).toContain('https://idynify.test/getting-started');
  });

  it('the Free copy mentions no paid page', () => {
    const { html } = freeWelcomeEmail('https://idynify.test');
    expect(html).not.toMatch(/getting-started|\/scout|\/checkout|\/barry/);
  });

  describe('only the account just created, for its own address', () => {
    it('sends to the signed-in account\'s own address', async () => {
      const res = await handler(post({ email: 'a@example.test', userId: 'u1', plan: 'free' }));
      expect(res.statusCode).toBe(200);
      expect(sent[0].to).toBe('A@example.test');
    });
    it.each([
      ['no token', { email: 'a@example.test', userId: 'u1' }, null, 401],
      ['an invalid token', { email: 'a@example.test', userId: 'u1' }, 'forged', 401],
      ['another account\'s userId', { email: 'a@example.test', userId: 'u2' }, 'tok_u1', 403],
      ['an address that is not the account\'s', { email: 'victim@example.test', userId: 'u1' }, 'tok_u1', 403],
      ['an account older than the window', { email: 'b@example.test', userId: 'u2' }, 'tok_u2', 403],
    ])('refuses %s, and sends nothing', async (_, body, token, status) => {
      const res = await handler(post(body, token));
      expect(res.statusCode).toBe(status);
      expect(sent).toEqual([]);
    });
  });
});
