// @vitest-environment node
/**
 * The claude-vision extractor, against recorded responses: no network.
 *
 * The SDK client gets an injected fetch, so these tests see the exact request
 * that would go on the wire and feed back recorded Messages API responses.
 * They pin: the request shape (structured outputs, effort, server-side
 * fallback, no SDK retries), that the schema stays inside the documented
 * structured-outputs limits, that a prompt change cannot ship without a new
 * prompt version, the mapping to card-reading/v2, the error mapping, and the
 * whole path through the orchestrator to a CardExtraction. Every card is
 * fictional.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createClaudeVisionExtractor, buildRequest, readResponse, toReading, mapError, usageOf, usesServerFallback,
  SYSTEM_PROMPT, USER_TEXT, RESPONSE_SCHEMA, MAX_TOKENS, FALLBACK_BETA, EFFORTS,
  CLAUDE_VISION_ID, CLAUDE_VISION_ADAPTER_VERSION, CLAUDE_VISION_PROMPT_VERSION,
} from '../../netlify/functions/utils/capture/claudeVisionExtractor.js';
import { resolveExtractor, isExtractor } from '../../netlify/functions/utils/capture/extractors.js';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { validateCardReading } from '../../netlify/functions/utils/capture/cardReading.js';
import { CaptureExtractorError } from '../../netlify/functions/utils/capture/errors.js';
import { MODEL_CAPTURE_DEFAULT } from '../../netlify/functions/utils/models.js';
import { validateCardExtraction } from '../capture/contract.js';

const BASE = 'https://api.anthropic.test';
const ENV = { ANTHROPIC_API_KEY: 'sk-test-not-a-key' };
const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const IMAGE = {
  version: 'card-image/v1', mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==', bytes: 13, widthPx: 2000, heightPx: 1143,
  preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false },
};
const t = (text, confidence = 0.97) => ({ text, confidence });
const blank = () => t('', 0);

/** A recorded structured-output answer for a fictional card. */
function cardOutput() {
  return {
    textFound: true,
    person: {
      fullName: t('Avery Quinn', 0.98), givenName: t('Avery'), middleName: blank(), familyName: t('Quinn'), suffix: blank(),
      title: t('Director of Partnerships', 0.93),
      emails: [t('avery.quinn@example.com')],
      phones: [{ ...t('+1 (415) 555-0142', 0.95), label: 'mobile' }, { ...t('+1 (415) 555-0100 x12', 0.9), label: 'office' }],
      linkedinUrl: blank(),
      socials: [],
    },
    company: {
      name: { ...t('Example Robotics', 0.96), onlyInLogo: false },
      website: t('www.example.com', 0.96), address: t('100 Example Way, Springfield', 0.85), linkedinUrl: blank(),
    },
  };
}

/** A Messages API response carrying `output` as its text. */
function message(output, over = {}) {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3912, output_tokens: 744 }, ...over,
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
const apiError = status => json(status, { type: 'error', error: { type: 'api_error', message: 'upstream said Avery Quinn avery.quinn@example.com' } });

/** A fetch that plays `steps` in order and records every request. */
function recorder(steps) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body), signal: init.signal });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === 'function' ? step(init) : step;
  };
  return { fetch, calls };
}

const extractor = (steps, env = {}) => {
  const rec = recorder(steps);
  return { ...rec, extractor: createClaudeVisionExtractor({ ...ENV, ...env }, { fetch: rec.fetch, baseURL: BASE }) };
};

const extractFrom = (ex, signal = new AbortController().signal) => ex.extract({ image: { mimeType: IMAGE.mimeType, data: IMAGE.data, widthPx: 2000, heightPx: 1143 }, signal });

async function rejection(promise) {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(CaptureExtractorError);
  return error;
}

afterEach(() => vi.restoreAllMocks());

// ─── The request ────────────────────────────────────────────────────────────

describe('claude-vision: the request on the wire', () => {
  it('is one POST to the Messages API with structured outputs, low effort and the server-side fallback', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput()))]);
    await extractFrom(ex);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${BASE}/v1/messages?beta=true`);
    expect(call.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(call.headers['x-api-key']).toBe(ENV.ANTHROPIC_API_KEY);
    expect(call.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE.data } },
          { type: 'text', text: 'Read this business card.' },
        ],
      }],
    });
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends nothing Opus 5.5 rejects: no thinking setting, no forced tool_choice, no sampling, no prefill, no betas in the body', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput()))]);
    await extractFrom(ex);
    for (const key of ['thinking', 'tool_choice', 'tools', 'temperature', 'top_p', 'top_k', 'betas', 'output_format', 'stream']) {
      expect(calls[0].body, key).not.toHaveProperty(key);
    }
    expect(calls[0].body.messages.map(m => m.role)).toEqual(['user']);
  });

  it('a Haiku model gets no fallback parameter and no beta header (it has no server-side fallback)', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput()))], { CAPTURE_EXTRACT_MODEL: 'claude-haiku-5-5' });
    await extractFrom(ex);
    expect(calls[0].body.model).toBe('claude-haiku-5-5');
    expect(calls[0].body).not.toHaveProperty('fallbacks');
    expect(calls[0].headers['anthropic-beta']).toBeUndefined();
    expect(usesServerFallback('claude-sonnet-5-5')).toBe(true);
  });

  it('takes the model and effort from its environment', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput()))], { CAPTURE_EXTRACT_MODEL: 'claude-sonnet-5-5', CAPTURE_EXTRACT_EFFORT: 'medium' });
    await extractFrom(ex);
    expect(calls[0].body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } });
    expect(ex).toMatchObject({ modelId: 'claude-sonnet-5-5', effort: 'medium' });
  });

  it('never retries inside the SDK: the orchestrator owns retries', async () => {
    const { extractor: ex, calls } = extractor([apiError(529), json(200, message(cardOutput()))]);
    await rejection(extractFrom(ex));
    expect(calls).toHaveLength(1);
  });

  it('the SDK logs nothing about a request, a response or an error', async () => {
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(level => vi.spyOn(console, level).mockImplementation((...a) => lines.push(a.join(' '))));
    for (const status of [400, 429, 529]) await rejection(extractFrom(extractor([apiError(status)]).extractor));
    await extractFrom(extractor([json(200, message(cardOutput()))]).extractor);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    // The one line it can still write, whatever logLevel says: its own warning
    // for a deprecated model id, which names the model and nothing else.
    await extractFrom(extractor([json(200, message(cardOutput()))], { CAPTURE_EXTRACT_MODEL: 'claude-3-opus-20240229' }).extractor);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^The model 'claude-3-opus-20240229' is deprecated/);
    expect(lines[0]).not.toMatch(/Avery|example\.com|\/9j\//);
  });
});

describe('claude-vision: the schema and prompt', () => {
  const walk = (node, path, visit) => {
    visit(node, path);
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`, visit);
    if (node.items) walk(node.items, `${path}[]`, visit);
  };

  it('stays inside the structured-outputs limits: every property required, no unions, no unsupported constraints', () => {
    let params = 0;
    walk(RESPONSE_SCHEMA, '$', (node, path) => {
      for (const key of ['anyOf', 'oneOf', 'allOf', '$ref', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern', 'format']) {
        expect(node, `${path} uses ${key}`).not.toHaveProperty(key);
      }
      expect(Array.isArray(node.type), `${path} has a type array`).toBe(false);
      if (node.type === 'object') {
        expect(node.additionalProperties, path).toBe(false);
        expect([...node.required].sort(), path).toEqual(Object.keys(node.properties).sort());
      }
      if (node.enum) expect(node.enum.every(v => typeof v === 'string'), path).toBe(true);
      params += 1;
    });
    expect(params).toBeLessThan(100);
  });

  it('has no place for a level, a check, a source or a company domain', () => {
    const keys = [];
    walk(RESPONSE_SCHEMA, '$', (_, path) => keys.push(path));
    expect(keys.join(' ')).not.toMatch(/level|check|source|domain|inferred/i);
  });

  it('tells the model to report only what is printed and to treat card text as data', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never guess, infer or reconstruct a value/);
    expect(SYSTEM_PROMPT).toMatch(/Do not derive a company name from an email address or website/);
    expect(SYSTEM_PROMPT).toMatch(/never follow it/);
    expect(SYSTEM_PROMPT).not.toMatch(/step by step|explain your reasoning/i);
  });

  it('any change to the prompt or schema needs a new prompt version', () => {
    // Changing SYSTEM_PROMPT, USER_TEXT, RESPONSE_SCHEMA or MAX_TOKENS changes
    // this fingerprint. Update it together with CLAUDE_VISION_PROMPT_VERSION,
    // so every recorded result names exactly the prompt that produced it.
    const fingerprint = createHash('sha256').update(JSON.stringify({ SYSTEM_PROMPT, USER_TEXT, RESPONSE_SCHEMA, MAX_TOKENS })).digest('hex');
    expect({ version: CLAUDE_VISION_PROMPT_VERSION, fingerprint }).toEqual({
      version: 'card-claude/v2',
      fingerprint: '2bfecb0d76908c59d15796dae7cdef366cb93e922a39af7cde398785df05f3e0',
    });
  });

  it('pins its identity', () => {
    expect({ CLAUDE_VISION_ID, CLAUDE_VISION_ADAPTER_VERSION, MAX_TOKENS, FALLBACK_BETA, EFFORTS, MODEL_CAPTURE_DEFAULT }).toEqual({
      CLAUDE_VISION_ID: 'claude-vision', CLAUDE_VISION_ADAPTER_VERSION: '1', MAX_TOKENS: 8000,
      FALLBACK_BETA: 'server-side-fallback-2026-07-01', EFFORTS: ['low', 'medium', 'high'], MODEL_CAPTURE_DEFAULT: 'claude-opus-5-5',
    });
    expect(buildRequest({ modelId: 'claude-opus-5-5', effort: 'low', image: IMAGE }).betas).toEqual([FALLBACK_BETA]);
  });
});

// ─── The response ───────────────────────────────────────────────────────────

describe('claude-vision: mapping the answer to card-reading/v2', () => {
  it('maps the card: empty means not printed, labels pass through, scores untouched', () => {
    const reading = toReading(cardOutput());
    expect(validateCardReading(reading)).toEqual({ ok: true });
    expect(reading.status).toBe('read');
    expect(reading.person.fullName).toEqual({ raw: 'Avery Quinn', score: 0.98 });
    expect(reading.person.middleName).toEqual({ raw: null, score: 0 });
    expect(reading.person.phones).toEqual([
      { raw: '+1 (415) 555-0142', score: 0.95, label: 'mobile' },
      { raw: '+1 (415) 555-0100 x12', score: 0.9, label: 'office' },
    ]);
    expect(reading.company.name).toEqual({ raw: 'Example Robotics', score: 0.96, fromLogo: false });
  });

  it('maps printed socials: platform none and unknown are null, LinkedIn and other pass through', () => {
    const out = cardOutput();
    out.person.socials = [
      { ...t('@KRISTINSOKOL', 0.9), platform: 'none' },
      { ...t('instagram.com/kristinsokol'), platform: 'Instagram' },
      { ...t('@kristin'), platform: 'tiktok' },
      { ...t(''), platform: 'facebook' },
      { ...t('x.com/ks'), platform: 'other' },
    ];
    const reading = toReading(out);
    expect(validateCardReading(reading)).toEqual({ ok: true });
    expect(reading.person.socials).toEqual([
      { raw: '@KRISTINSOKOL', score: 0.9, platform: null },
      { raw: 'instagram.com/kristinsokol', score: 0.97, platform: 'instagram' },
      { raw: '@kristin', score: 0.97, platform: null },
      { raw: 'x.com/ks', score: 0.97, platform: 'other' },
    ]);
  });

  it('a card with only a social handle is a read, not no_text', () => {
    const out = cardOutput();
    for (const k of ['fullName', 'givenName', 'familyName', 'title']) out.person[k] = blank();
    out.person.emails = [];
    out.person.phones = [];
    out.person.socials = [{ ...t('@kristinsokol'), platform: 'none' }];
    out.company = { name: { ...blank(), onlyInLogo: false }, website: blank(), address: blank(), linkedinUrl: blank() };
    expect(toReading({ ...out, textFound: false }).status).toBe('read');
  });

  it('none and unknown labels are null; label case is ignored', () => {
    const out = cardOutput();
    out.person.phones = [{ ...t('+1 415 555 0142'), label: 'none' }, { ...t('+1 415 555 0100'), label: 'Mobile' }, { ...t('+1 415 555 0199'), label: 'pager' }];
    expect(toReading(out).person.phones.map(p => p.label)).toEqual([null, 'mobile', null]);
  });

  it('a name only in a logo is marked so; an empty name never is', () => {
    const out = cardOutput();
    out.company.name.onlyInLogo = true;
    expect(toReading(out).company.name.fromLogo).toBe(true);
    out.company.name = { ...blank(), onlyInLogo: true };
    expect(toReading(out).company.name).toEqual({ raw: null, score: 0, fromLogo: false });
  });

  it('drops empty list entries, keeps at most five, and collapses whitespace', () => {
    const out = cardOutput();
    out.person.emails = [blank(), ...Array.from({ length: 7 }, (_, i) => t(`a${i}@example.com`))];
    out.person.title = t('  Director\n of   Partnerships ');
    const reading = toReading(out);
    expect(reading.person.emails.map(e => e.raw)).toEqual(['a0@example.com', 'a1@example.com', 'a2@example.com', 'a3@example.com', 'a4@example.com']);
    expect(reading.person.title.raw).toBe('Director of Partnerships');
  });

  it('no text at all is no_text; text found but nothing assignable is a read with nothing in it', () => {
    const empty = cardOutput();
    for (const k of ['fullName', 'givenName', 'familyName', 'title']) empty.person[k] = blank();
    empty.person.emails = [];
    empty.person.phones = [];
    empty.company = { name: { ...blank(), onlyInLogo: false }, website: blank(), address: blank(), linkedinUrl: blank() };
    expect(toReading({ ...empty, textFound: false }).status).toBe('no_text');
    expect(validateCardReading(toReading({ ...empty, textFound: false }))).toEqual({ ok: true });
    expect(toReading({ ...empty, textFound: true }).status).toBe('read');
    expect(toReading({ ...cardOutput(), textFound: false }).status).toBe('read');
  });

  it('an out-of-range score is passed on, and the reading check refuses it', () => {
    const out = cardOutput();
    out.person.fullName = t('Avery Quinn', 98);
    expect(validateCardReading(toReading(out))).toEqual({ ok: false, path: 'person.fullName' });
  });

  it('records the model that answered and the tokens of every attempt, after a fallback', () => {
    const fellBack = message(cardOutput(), {
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: '{"textFound": tru' },
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
        { type: 'text', text: JSON.stringify(cardOutput()) },
      ],
      usage: {
        input_tokens: 3900, output_tokens: 700,
        iterations: [{ type: 'message', input_tokens: 3912, output_tokens: 12 }, { type: 'fallback_message', input_tokens: 3900, output_tokens: 700 }],
      },
    });
    const { reading, usage, modelId } = readResponse(fellBack);
    expect(modelId).toBe('claude-opus-5');
    expect(usage).toEqual({ inputTokens: 7812, outputTokens: 712 });
    expect(reading.person.fullName.raw).toBe('Avery Quinn');
    expect(usageOf({ usage: { input_tokens: 10, output_tokens: 2 } })).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(usageOf({})).toEqual({ inputTokens: null, outputTokens: null });
  });

  it.each([
    ['a refusal (the whole fallback chain declined)', { stop_reason: 'refusal', content: [] }, 'image_rejected', 'refusal'],
    ['a truncated answer', { stop_reason: 'max_tokens' }, 'invalid_output', 'max_tokens'],
    ['an unexpected stop', { stop_reason: 'pause_turn' }, 'invalid_output', 'stop_reason'],
    ['no text block', { content: [{ type: 'thinking', thinking: '' }] }, 'invalid_output', 'no_text_block'],
    ['text that is not JSON', { content: [{ type: 'text', text: 'Avery Quinn, Director' }] }, 'invalid_output', 'json'],
    ['JSON that is not the schema', { content: [{ type: 'text', text: '{"name":"Avery Quinn"}' }] }, 'invalid_output', 'schema_mismatch'],
  ])('%s → %s (%s), with the tokens it cost and no text from it', (_, over, code, detail) => {
    let error;
    try { readResponse(message(cardOutput(), over)); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(CaptureExtractorError);
    expect(error).toMatchObject({ code, detail, usage: { inputTokens: 3912, outputTokens: 744 } });
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(/Avery|Director/);
  });
});

// ─── Errors ─────────────────────────────────────────────────────────────────

describe('claude-vision: errors map by status and class, never by message', () => {
  it.each([
    [400, 'config_error'], [401, 'config_error'], [403, 'config_error'], [404, 'config_error'], [408, 'timeout'],
    [413, 'image_rejected'], [422, 'config_error'], [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [529, 'unavailable'],
  ])('HTTP %i → %s', async (status, code) => {
    const error = await rejection(extractFrom(extractor([apiError(status)]).extractor));
    expect(error).toMatchObject({ code, detail: `http_${status}` });
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(/Avery|upstream/);
  });

  it('a connection failure → network', async () => {
    const error = await rejection(extractFrom(extractor([() => { throw new TypeError('fetch failed'); }]).extractor));
    expect(error).toMatchObject({ code: 'network', detail: 'connection' });
  });

  it('the orchestrator\'s abort → timeout', async () => {
    const hang = init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const controller = new AbortController();
    const pending = extractFrom(extractor([hang]).extractor, controller.signal);
    setTimeout(() => controller.abort(), 10);
    expect(await rejection(pending)).toMatchObject({ code: 'timeout', detail: 'aborted' });
  });

  it('anything else → unavailable', () => {
    expect(mapError(new Error('Avery Quinn'))).toMatchObject({ code: 'unavailable', detail: 'unmapped_error' });
  });
});

// ─── Building it ────────────────────────────────────────────────────────────

describe('claude-vision: configuration', () => {
  const configError = expect.objectContaining({ code: 'config_error' });

  it('is registered, and serves internal, beta and on', () => {
    for (const mode of ['internal', 'beta', 'on']) {
      const ex = resolveExtractor({ ...ENV, CAPTURE_MODE: mode, CAPTURE_EXTRACTOR: 'claude-vision' });
      expect(isExtractor(ex)).toBe(true);
      expect(ex).toMatchObject({ id: 'claude-vision', adapterVersion: '1', modelId: 'claude-opus-5-5', promptVersion: 'card-claude/v2', billingProvider: 'anthropic' });
    }
  });

  it.each([
    ['no API key', { ANTHROPIC_API_KEY: undefined }],
    ['an empty API key', { ANTHROPIC_API_KEY: '' }],
    ['an unknown effort', { CAPTURE_EXTRACT_EFFORT: 'turbo' }],
    ['a model id that is not a token', { CAPTURE_EXTRACT_MODEL: 'Claude Opus' }],
  ])('%s is a config_error', (_, env) => {
    expect(() => resolveExtractor({ ...ENV, CAPTURE_MODE: 'on', CAPTURE_EXTRACTOR: 'claude-vision', ...env })).toThrow(configError);
  });
});

// ─── Through the orchestrator ───────────────────────────────────────────────

describe('claude-vision through the orchestrator', () => {
  const run = (ex, limits) => runExtraction({ extractor: ex, image: IMAGE, operationId: OP, startedAt: Date.now(), limits });

  it('a recorded card becomes a valid CardExtraction naming the extractor, model and prompt', async () => {
    const { extractor: ex } = extractor([json(200, message(cardOutput()))]);
    const result = await run(ex);
    expect(result).toMatchObject({ ok: true, attempts: 1, usage: { inputTokens: 3912, outputTokens: 744 }, modelId: 'claude-opus-5-5' });
    expect(validateCardExtraction(result.extraction)).toEqual({ ok: true, errors: [] });
    expect(result.extraction.capture.provider).toEqual({ id: 'claude-vision', adapterVersion: '1', modelId: 'claude-opus-5-5', promptVersion: 'card-claude/v2' });
    expect(result.extraction.person.emails[0]).toMatchObject({ value: 'avery.quinn@example.com', extraction: { level: 'likely' } });
    expect(result.extraction.company.domain).toMatchObject({ value: 'example.com', inferredFrom: 'website' });
  });

  it('overloaded, then answered: two attempts, both requests identical', async () => {
    const { extractor: ex, calls } = extractor([apiError(529), json(200, message(cardOutput()))]);
    expect(await run(ex)).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[1].body).toEqual(calls[0].body);
  });

  it('rate-limited, then answered', async () => {
    const { extractor: ex } = extractor([apiError(429), json(200, message(cardOutput()))]);
    expect(await run(ex)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('a refusal is not retried', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput(), { stop_reason: 'refusal', content: [] }))]);
    expect(await run(ex)).toMatchObject({ ok: false, code: 'image_rejected', reason: 'refusal', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('a bad key is not retried', async () => {
    const { extractor: ex, calls } = extractor([apiError(401)]);
    expect(await run(ex)).toMatchObject({ ok: false, code: 'config_error', reason: 'http_401', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('a malformed answer is retried once', async () => {
    const { extractor: ex, calls } = extractor([json(200, message(cardOutput(), { content: [{ type: 'text', text: 'nope' }] })), json(200, message(cardOutput()))]);
    expect(await run(ex)).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('a slow answer is cut off at the attempt budget and the request aborted', async () => {
    const hang = init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const { extractor: ex, calls } = extractor([hang, json(200, message(cardOutput()))]);
    const result = await run(ex, { deadlineMs: 1000, attemptMs: 50, minRetryMs: 20 });
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[0].signal.aborted).toBe(true);
  });
});
