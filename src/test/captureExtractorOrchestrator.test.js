/**
 * The extraction plumbing between the endpoint and an extractor: the registry,
 * the orchestrator's deadline and retry rules, the error vocabulary, the fake
 * extractor's scenarios, and the one logger capture uses.
 *
 * Extractors here are stubs or the fake: no network. Timings are shrunk with
 * the orchestrator's `limits` so the timeout paths run in milliseconds.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runExtraction, DEADLINE_MS, ATTEMPT_MS, MIN_RETRY_MS, MAX_ATTEMPTS } from '../../netlify/functions/utils/capture/orchestrator.js';
import { resolveExtractor, isExtractor, EXTRACTOR_IDS } from '../../netlify/functions/utils/capture/extractors.js';
import {
  CaptureExtractorError, EXTRACTOR_ERRORS, RESPONSE_STATUS, isRetryable,
} from '../../netlify/functions/utils/capture/errors.js';
import {
  createFakeExtractor, fakeCardReading, FAKE_SCENARIOS, MAX_FAKE_DELAY_MS,
} from '../../netlify/functions/utils/capture/fakeExtractor.js';
import { captureLog, captureLogFields } from '../../netlify/functions/utils/capture/captureLog.js';
import { validateCardExtraction } from '../capture/contract.js';

const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const IMAGE = {
  version: 'card-image/v1', mimeType: 'image/jpeg', data: 'AAAA', bytes: 3, widthPx: 2000, heightPx: 1143,
  preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false },
};
/** Fast limits: 60 ms per attempt, a retry needs 50 ms left, 1 s in all. */
const FAST = { deadlineMs: 1000, attemptMs: 60, minRetryMs: 50 };

// ─── Stub extractors ────────────────────────────────────────────────────────

const succeed = (usage = { inputTokens: 1200, outputTokens: 300 }, extra = {}) => () => ({ reading: fakeCardReading(), usage, ...extra });
const raise = (code, usage) => () => { throw new CaptureExtractorError(code, { usage }); };
const hang = () => () => new Promise(() => {});            // ignores its signal entirely
const returns = reading => () => ({ reading, usage: { inputTokens: 10, outputTokens: 5 } });

/** An extractor that plays `steps` in order, one per attempt, recording each call. */
function scripted(steps, over = {}) {
  const calls = [];
  const extractor = {
    id: 'stub', adapterVersion: '1', modelId: 'stub-model', promptVersion: 'stub-v1', billingProvider: 'stub',
    async extract(args) {
      calls.push(args);
      return steps[calls.length - 1](args);
    },
    ...over,
  };
  return { extractor, calls };
}

const run = (extractor, limits = FAST) => runExtraction({ extractor, image: IMAGE, operationId: OP, startedAt: Date.now(), limits });

// ─── Retry table ────────────────────────────────────────────────────────────

describe('runExtraction: the retry table', () => {
  it('pins the production limits', () => {
    expect({ DEADLINE_MS, ATTEMPT_MS, MIN_RETRY_MS, MAX_ATTEMPTS }).toEqual({ DEADLINE_MS: 22000, ATTEMPT_MS: 12000, MIN_RETRY_MS: 5000, MAX_ATTEMPTS: 2 });
  });

  it('first call succeeds: one attempt', async () => {
    const { extractor, calls } = scripted([succeed()]);
    const result = await run(extractor);
    expect(result).toMatchObject({ ok: true, attempts: 1, usage: { inputTokens: 1200, outputTokens: 300 }, modelId: 'stub-model' });
    expect(calls).toHaveLength(1);
    expect(validateCardExtraction(result.extraction).ok).toBe(true);
  });

  it('first call times out, second succeeds: the first call is aborted', async () => {
    const { extractor, calls } = scripted([hang(), succeed()]);
    const result = await run(extractor);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
  });

  it('first call is rate-limited, second succeeds', async () => {
    const { extractor, calls } = scripted([raise('rate_limited'), succeed()]);
    expect(await run(extractor)).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['timeout', [hang(), hang()]],
    ['rate_limited', [raise('rate_limited'), raise('rate_limited')]],
    ['unavailable', [raise('unavailable'), raise('unavailable')]],
    ['network', [raise('network'), raise('network')]],
    ['unavailable', [raise('timeout'), raise('unavailable')]],
  ])('both attempts fail → %s, and there is never a third', async (code, steps) => {
    const { extractor, calls } = scripted([...steps, succeed()]);
    const result = await run(extractor);
    expect(result).toMatchObject({ ok: false, code, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it.each(['config_error', 'image_rejected'])('%s is not retried', async (code) => {
    const { extractor, calls } = scripted([raise(code), succeed()]);
    expect(await run(extractor)).toMatchObject({ ok: false, code, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('no retry when less than MIN_RETRY_MS is left', async () => {
    const { extractor, calls } = scripted([hang(), succeed()]);
    const result = await run(extractor, { deadlineMs: 80, attemptMs: 60, minRetryMs: 50 });
    expect(result).toMatchObject({ ok: false, code: 'timeout', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('an attempt never outlives the deadline', async () => {
    const { extractor } = scripted([hang(), hang()]);
    const started = Date.now();
    await run(extractor, { deadlineMs: 120, attemptMs: 1000, minRetryMs: 50 });
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe('runExtraction: the reading is checked, not trusted', () => {
  it('a malformed reading is invalid_output, named by path, and retried once', async () => {
    const bad = { ...fakeCardReading(), company: { ...fakeCardReading().company, domain: { raw: 'example.com', score: 1 } } };
    const { extractor, calls } = scripted([returns(bad), returns(bad), succeed()]);
    const result = await run(extractor);
    expect(result).toMatchObject({ ok: false, code: 'invalid_output', reason: 'reading:company', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('a malformed reading then a good one succeeds', async () => {
    const { extractor } = scripted([returns({ status: 'read' }), succeed()]);
    expect(await run(extractor)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('an extractor cannot set levels, checks or a source: those keys make the reading invalid', async () => {
    const reading = fakeCardReading();
    reading.person.title = { raw: 'Director of Partnerships', score: 0.2, level: 'confirmed' };
    const { extractor } = scripted([returns(reading), returns(reading)]);
    expect(await run(extractor)).toMatchObject({ ok: false, code: 'invalid_output', reason: 'reading:person.title' });
  });

  it('an assembly that would break the contract is invalid_output and not retried', async () => {
    const { extractor, calls } = scripted([succeed(), succeed()], { adapterVersion: 1 });
    expect(await run(extractor)).toMatchObject({ ok: false, code: 'invalid_output', reason: 'capture.provider.adapterVersion:bad_type', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('an unmapped exception is unavailable, and its message goes nowhere', async () => {
    const { extractor } = scripted([
      () => { throw new Error('upstream said: Avery Quinn avery.quinn@example.com'); },
      () => { throw new TypeError('Avery Quinn'); },
    ]);
    const result = await run(extractor);
    expect(result).toMatchObject({ ok: false, code: 'unavailable', attempts: 2 });
    expect(JSON.stringify(result)).not.toMatch(/Avery|example\.com|upstream/);
  });
});

describe('runExtraction: what it records', () => {
  it('the extractor sees only the image bytes and its size, and a signal', async () => {
    const { extractor, calls } = scripted([succeed()]);
    await run(extractor);
    expect(Object.keys(calls[0]).sort()).toEqual(['image', 'signal']);
    expect(calls[0].image).toEqual({ mimeType: 'image/jpeg', data: 'AAAA', widthPx: 2000, heightPx: 1143 });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('token usage adds up across attempts, including a failed attempt that was billed', async () => {
    const { extractor } = scripted([raise('invalid_output', { inputTokens: 900, outputTokens: 40 }), succeed()]);
    expect((await run(extractor)).usage).toEqual({ inputTokens: 2100, outputTokens: 340 });
  });

  it('usage stays null when no attempt reported any', async () => {
    const { extractor } = scripted([succeed({ inputTokens: null, outputTokens: null })]);
    const result = await run(extractor);
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
    expect(result.extraction.capture.usage).toEqual({ inputTokens: null, outputTokens: null });
  });

  it('records the model that actually served the call, if it is a well-formed id', async () => {
    const served = scripted([succeed(undefined, { modelId: 'fallback-model-2' })]);
    const result = await run(served.extractor);
    expect(result.modelId).toBe('fallback-model-2');
    expect(result.extraction.capture.provider).toEqual({ id: 'stub', adapterVersion: '1', modelId: 'fallback-model-2', promptVersion: 'stub-v1' });

    const garbage = scripted([succeed(undefined, { modelId: 'Not A Model Id!' })]);
    expect((await run(garbage.extractor)).modelId).toBe('stub-model');
  });

  it('fills in timings', async () => {
    const { extractor } = scripted([succeed()]);
    const { extraction, providerMs, validateMs } = await run(extractor);
    const { timing } = extraction.capture;
    expect(timing.providerMs).toBe(providerMs);
    expect(timing.validateMs).toBe(validateMs);
    expect(timing.totalMs).toBeGreaterThanOrEqual(timing.providerMs);
    expect(timing.witnessMs).toBeNull();
  });
});

// ─── The fake extractor ─────────────────────────────────────────────────────

describe('the fake extractor', () => {
  const fake = env => createFakeExtractor({ CAPTURE_MODE: 'internal', ...env });
  const scenario = name => run(fake({ CAPTURE_FAKE_SCENARIO: name }));

  it('has the extractor interface', () => {
    expect(isExtractor(fake())).toBe(true);
    expect(fake()).toMatchObject({ id: 'fake', adapterVersion: '1', modelId: 'fake-v1', promptVersion: 'fake-v1', billingProvider: 'fake' });
  });

  it('is deterministic: two runs give the same extraction', async () => {
    const strip = ({ extraction }) => ({ ...extraction, capture: { ...extraction.capture, extractedAt: null, timing: null } });
    expect(strip(await scenario('card'))).toEqual(strip(await scenario('card')));
    expect(strip(await run(fake()))).toEqual(strip(await scenario('card')));
  });

  it('lists its scenarios', () => {
    expect([...FAKE_SCENARIOS].sort()).toEqual([
      'card', 'config_error', 'image_rejected', 'invalid_output', 'low_confidence', 'network', 'no_text', 'partial',
      'rate_limited', 'rate_limited_once', 'timeout', 'timeout_once', 'unavailable', 'unreadable',
    ]);
  });

  it.each([
    ['card', { ok: true, attempts: 1 }, 'ok'],
    ['partial', { ok: true, attempts: 1 }, 'partial'],
    ['low_confidence', { ok: true, attempts: 1 }, 'ok'],
    ['no_text', { ok: true, attempts: 1 }, 'no_text'],
    ['unreadable', { ok: true, attempts: 1 }, 'unreadable'],
    ['timeout_once', { ok: true, attempts: 2 }, 'ok'],
    ['rate_limited_once', { ok: true, attempts: 2 }, 'ok'],
    ['invalid_output', { ok: false, code: 'invalid_output', reason: 'reading:company', attempts: 2 }, null],
    ['timeout', { ok: false, code: 'timeout', attempts: 2 }, null],
    ['rate_limited', { ok: false, code: 'rate_limited', attempts: 2 }, null],
    ['unavailable', { ok: false, code: 'unavailable', attempts: 2 }, null],
    ['network', { ok: false, code: 'network', attempts: 2 }, null],
    ['config_error', { ok: false, code: 'config_error', attempts: 1 }, null],
    ['image_rejected', { ok: false, code: 'image_rejected', attempts: 1 }, null],
  ])('scenario %s', async (name, expected, status) => {
    const result = await scenario(name);
    expect(result).toMatchObject(expected);
    if (status) expect(result.extraction.capture.status).toBe(status);
  });

  it('low_confidence leaves fields to review and confirms nothing', async () => {
    const { extraction } = await scenario('low_confidence');
    expect(extraction.capture.counts.confirmed).toBe(0);
    expect(extraction.capture.counts.possible).toBeGreaterThan(0);
  });

  it('a delay is honoured, and one longer than the attempt times out', async () => {
    const slow = await run(fake({ CAPTURE_FAKE_DELAY_MS: '30' }));
    expect(slow).toMatchObject({ ok: true, attempts: 1 });
    expect(slow.providerMs).toBeGreaterThanOrEqual(25);
    expect(await run(fake({ CAPTURE_FAKE_DELAY_MS: '100' }))).toMatchObject({ ok: false, code: 'timeout', attempts: 2 });
  });

  it.each([
    [{ CAPTURE_FAKE_SCENARIO: 'explode' }],
    [{ CAPTURE_FAKE_SCENARIO: '' }],
    [{ CAPTURE_FAKE_DELAY_MS: '-1' }],
    [{ CAPTURE_FAKE_DELAY_MS: 'soon' }],
    [{ CAPTURE_FAKE_DELAY_MS: String(MAX_FAKE_DELAY_MS + 1) }],
  ])('refuses a bad setting %o', (env) => {
    expect(() => fake(env)).toThrow();
    expect(() => resolveExtractor({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', ...env })).toThrow(expect.objectContaining({ code: 'config_error' }));
  });
});

// ─── Registry ───────────────────────────────────────────────────────────────

describe('resolveExtractor', () => {
  const configError = expect.objectContaining({ name: 'CaptureExtractorError', code: 'config_error' });

  it('registers only the fake so far', () => {
    expect(EXTRACTOR_IDS).toEqual(['fake']);
  });

  it('builds the fake in internal mode', () => {
    expect(resolveExtractor({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake' }).id).toBe('fake');
  });

  it.each(['off', 'beta', 'on', undefined, 'INTERNAL'])('refuses the fake when CAPTURE_MODE is %s', (mode) => {
    expect(() => resolveExtractor({ CAPTURE_MODE: mode, CAPTURE_EXTRACTOR: 'fake' })).toThrow(configError);
  });

  it.each([undefined, '', 'claude-vision', 'Fake', '__proto__', 'toString', 'constructor'])('has no default and no unknown extractor (%s)', (id) => {
    expect(() => resolveExtractor({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: id })).toThrow(configError);
  });

  const good = env => ({
    id: 'next', adapterVersion: '1', modelId: env.NEXT_MODEL ?? 'next-model', promptVersion: 'next-v1', billingProvider: 'anthropic', extract: async () => ({}),
  });

  it('adding an extractor is one registry line: it then serves beta and on', () => {
    for (const mode of ['internal', 'beta', 'on']) {
      expect(resolveExtractor({ CAPTURE_MODE: mode, CAPTURE_EXTRACTOR: 'next', NEXT_MODEL: 'm-2' }, { next: good }).modelId).toBe('m-2');
    }
  });

  it.each([
    ['a factory that throws (a missing key)', () => { throw new Error('NEXT_API_KEY missing'); }],
    ['no extract()', env => { const { extract: _extract, ...rest } = good(env); return rest; }],
    ['an id that does not match its registry key', env => ({ ...good(env), id: 'other' })],
    ['a model id that is not a token', env => ({ ...good(env), modelId: 'Big Model' })],
    ['a missing prompt version', env => ({ ...good(env), promptVersion: undefined })],
  ])('refuses %s', (_, factory) => {
    expect(() => resolveExtractor({ CAPTURE_MODE: 'on', CAPTURE_EXTRACTOR: 'next' }, { next: factory })).toThrow(configError);
  });
});

// ─── Errors ─────────────────────────────────────────────────────────────────

describe('the error vocabulary', () => {
  it('pins the extractor codes and which are retryable', () => {
    expect(Object.values(EXTRACTOR_ERRORS).sort()).toEqual([
      'config_error', 'image_rejected', 'invalid_output', 'network', 'rate_limited', 'timeout', 'unavailable',
    ]);
    expect(Object.values(EXTRACTOR_ERRORS).filter(isRetryable).sort()).toEqual(['invalid_output', 'network', 'rate_limited', 'timeout', 'unavailable']);
  });

  it('every code has an HTTP status', () => {
    expect(RESPONSE_STATUS).toEqual({
      method_not_allowed: 405, invalid_request: 400, image_rejected: 400, unauthorized: 401, forbidden: 403,
      capture_disabled: 404, operation_conflict: 409, no_text: 422, rate_limited: 429, internal_error: 500,
      invalid_output: 502, network: 502, unavailable: 503, config_error: 503, timeout: 504,
    });
    for (const code of Object.values(EXTRACTOR_ERRORS)) expect(RESPONSE_STATUS[code], code).toBeDefined();
  });

  it('carries a code and token counts, nothing else', () => {
    const error = new CaptureExtractorError('rate_limited', { usage: { inputTokens: 12, outputTokens: 'Avery' }, body: 'Avery Quinn' });
    expect(error).toMatchObject({ code: 'rate_limited', message: 'rate_limited', retryable: true, usage: { inputTokens: 12, outputTokens: null } });
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'usage']);
    expect(new CaptureExtractorError('Avery Quinn said no')).toMatchObject({ code: 'unavailable', message: 'unavailable' });
  });
});

// ─── captureLog ─────────────────────────────────────────────────────────────

describe('captureLog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops every key that is not on the allowlist', () => {
    const fields = captureLogFields({
      operationId: OP, outcome: 'ok', providerMs: 2810, inputTokens: 1840, modelId: 'fake-v1', fields: 12, confirmed: 4,
      fullName: 'Avery Quinn', email: 'avery.quinn@example.com', phone: '+1 415 555 0142', title: 'Director', company: 'Example Robotics',
      text: 'AVERY QUINN Director', image: { data: 'AAAA' }, data: '/9j/4AAQ', userId: 'uid_1', uid: 'uid_1', extraction: { person: {} }, value: 'x',
    });
    expect(fields).toEqual({ operationId: OP, outcome: 'ok', providerMs: 2810, inputTokens: 1840, modelId: 'fake-v1', fields: 12, confirmed: 4 });
  });

  it('keeps only short code strings in arrays and truncates strings', () => {
    expect(captureLogFields({ warnings: ['blurry', 'Avery Quinn', 'avery@example.com', 'glare', { a: 1 }] }).warnings).toEqual(['blurry', 'glare']);
    expect(captureLogFields({ reason: 'x'.repeat(100) }).reason).toHaveLength(64);
    expect(captureLogFields({ status: { nested: 'Avery' }, totalMs: NaN, attempts: Infinity })).toEqual({});
  });

  it('writes one JSON line at the right level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    captureLog('extract', { outcome: 'ok', fullName: 'Avery Quinn' });
    captureLog('request', { outcome: 'forbidden' }, { level: 'warn' });
    captureLog('extract', { outcome: 'internal_error' }, { level: 'error' });
    expect(log.mock.calls).toEqual([['{"evt":"capture","stage":"extract","outcome":"ok"}']]);
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({ evt: 'capture', stage: 'request', outcome: 'forbidden' });
    expect(JSON.parse(error.mock.calls[0][0]).outcome).toBe('internal_error');
  });
});
