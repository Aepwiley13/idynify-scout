/**
 * A Free signup's welcome email points to their Contact Hub, never to a paid page. The paid
 * signup's email is unchanged. `plan` only chooses the copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handler, freeWelcomeEmail } from '../../netlify/functions/send-welcome-email.js';

let sent;
beforeEach(() => {
  sent = [];
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('URL', 'https://idynify.test');
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'em_1' }) }; }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });

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
});
