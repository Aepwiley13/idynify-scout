/* global process */
/**
 * anthropicKeyCheck reports whether the deploy's Anthropic key works and which
 * Barry Sonnet models it reaches — and never returns the key (#699).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkKey, handler } from '../../netlify/functions/anthropicKeyCheck.js';

const KEY = 'sk-ant-api03-TEST-not-a-real-key-ZZZZ';

/** fetch stub: answers by path; records what was asked. */
function stubFetch(byPath) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/v1', '');
    calls.push({ path, method: init.method ?? 'GET', apiKey: init.headers?.['x-api-key'], body: init.body });
    const status = typeof byPath === 'function' ? byPath(path) : (byPath[path] ?? 200);
    return new Response('{"detail":"upstream body that must not be echoed"}', { status });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('checkKey', () => {
  it('reports a missing key without calling the API', async () => {
    const calls = stubFetch({});
    expect(await checkKey({})).toMatchObject({ key: 'missing', models: {} });
    expect(await checkKey({ ANTHROPIC_API_KEY: '  ' })).toMatchObject({ key: 'missing' });
    expect(calls).toHaveLength(0);
  });

  it('reports a rejected key (the 401 invalid x-api-key case) and stops there', async () => {
    const calls = stubFetch(() => 401);
    expect(await checkKey({ ANTHROPIC_API_KEY: KEY })).toMatchObject({ key: 'rejected', models: {}, configuredModelAcceptsMessages: null });
    expect(calls).toHaveLength(1);
  });

  it('with a valid key, reports each Sonnet model and a free count_tokens on the configured one', async () => {
    const calls = stubFetch((path) => (path === '/models/claude-sonnet-4-6' ? 404 : 200));
    const result = await checkKey({ ANTHROPIC_API_KEY: KEY });
    expect(result.key).toBe('ok');
    expect(result.models).toEqual({
      'claude-sonnet-4-5-20250929': 'ok',
      'claude-sonnet-5-5': 'ok',
      'claude-sonnet-4-6': 'not_found',
    });
    expect(result.configuredModel).toBe('claude-sonnet-4-5-20250929');
    expect(result.configuredModelAcceptsMessages).toBe('ok');
    // Only free endpoints: Models API reads and count_tokens. Never messages.create.
    expect(calls.map((c) => `${c.method} ${c.path}`)).not.toContain('POST /messages');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/messages/count_tokens' });
    expect(JSON.parse(calls.at(-1).body).model).toBe('claude-sonnet-4-5-20250929');
    expect(calls.every((c) => c.apiKey === KEY)).toBe(true);
  });

  it('reports a network failure as a code, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await checkKey({ ANTHROPIC_API_KEY: KEY })).toMatchObject({ key: 'network_error' });
  });
});

describe('handler', () => {
  it('returns the result as JSON, GET only, and never any part of the key or the upstream body', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    stubFetch({});
    try {
      expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(405);
      const res = await handler({ httpMethod: 'GET' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['Cache-Control']).toBe('no-store');
      const body = JSON.parse(res.body);
      expect(body.key).toBe('ok');
      expect(typeof body.checkedAt).toBe('string');
      expect(res.body).not.toMatch(/sk-ant|ZZZZ|TEST-not|upstream body/);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
