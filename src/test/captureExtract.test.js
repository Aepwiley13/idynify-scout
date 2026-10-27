// @vitest-environment node
/**
 * captureExtract end to end, through the real orchestrator, assembler,
 * operation store logic and fake extractor.
 *
 * Mocked: firebase-admin (token check and an in-memory Firestore with
 * transactions), the existing admin checks, and logApiUsage. The fake
 * extractor is wrapped only to record what it was given.
 *
 * Pins: who may call, CAPTURE_MODE, that the server re-checks the prepared
 * image itself (PR 6 does not trust PR 5), the operation state machine and
 * its conflicts, that a retry of the same scan never transitions twice, and
 * that no card value or image byte reaches a log, a usage row or the
 * operation record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { format } from 'node:util';
import {
  PREPARED_IMAGE_VERSION, MAX_BYTES, encodeBase64, decodeBase64, readJpegHeader, hasJpegMetadata,
} from '../capture/preparedImage.js';
import { validateCardExtraction } from '../capture/contract.js';

const verifyIdToken = vi.hoisted(() => vi.fn());
const checkAdminAccess = vi.hoisted(() => vi.fn());
const checkSuperAdminAccess = vi.hoisted(() => vi.fn());
const logApiUsage = vi.hoisted(() => vi.fn());
const extractCalls = vi.hoisted(() => []);
const store = vi.hoisted(() => ({ docs: new Map(), writes: [], failTransactions: null }));

vi.mock('../../netlify/functions/firebase-admin.js', () => {
  const ref = path => ({
    path,
    collection: name => coll(`${path}/${name}`),
    get: async () => ({ exists: store.docs.has(path), data: () => structuredClone(store.docs.get(path)) }),
  });
  const coll = path => ({ doc: id => ref(`${path}/${id}`) });
  return {
    admin: { auth: () => ({ verifyIdToken }) },
    db: {
      collection: name => coll(name),
      // Firestore's shape: writes are staged and applied when the callback returns.
      async runTransaction(fn) {
        if (store.failTransactions) throw store.failTransactions;
        const staged = [];
        const tx = {
          get: async r => ({ exists: store.docs.has(r.path), data: () => structuredClone(store.docs.get(r.path)) }),
          create: (r, data) => staged.push(() => {
            if (store.docs.has(r.path)) throw new Error('ALREADY_EXISTS');
            store.docs.set(r.path, structuredClone(data));
            store.writes.push({ path: r.path, kind: 'create', data: structuredClone(data) });
          }),
          update: (r, data) => staged.push(() => {
            store.docs.set(r.path, { ...store.docs.get(r.path), ...structuredClone(data) });
            store.writes.push({ path: r.path, kind: 'update', data: structuredClone(data) });
          }),
        };
        const result = await fn(tx);
        for (const write of staged) write();
        return result;
      },
    },
  };
});
vi.mock('../../netlify/functions/utils/adminAuth.js', () => ({ checkAdminAccess }));
vi.mock('../../netlify/functions/utils/superAdminAuth.js', () => ({ checkSuperAdminAccess }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));
vi.mock('../../netlify/functions/utils/capture/fakeExtractor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createFakeExtractor: (env) => {
      const extractor = actual.createFakeExtractor(env);
      return { ...extractor, extract: (args) => { extractCalls.push(args); return extractor.extract(args); } };
    },
  };
});

import { handler } from '../../netlify/functions/captureExtract.js';
import { OPERATIONS_COLLECTION, OPEN_TTL_MS } from '../../netlify/functions/utils/captureOperations.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ADMIN = 'uid_admin_7g5g';
const SUPER = 'uid_super_9z';
const MEMBER = 'uid_member_q9w8';
const ENROLLED = 'uid_beta_k2';
const TOKENS = { tok_SECRET_admin: ADMIN, tok_SECRET_super: SUPER, tok_SECRET_member: MEMBER, tok_SECRET_beta: ENROLLED };
const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const OP2 = 'cap_7b1d0e44-2c9a-4f3e-8d10-5a6b7c8d9e0f';
const opPath = (uid = ADMIN, op = OP) => `users/${uid}/${OPERATIONS_COLLECTION}/${op}`;

/**
 * Everything on the fake card, and other things that must never be logged.
 * Phone numbers are probed by forms that cannot occur in a timestamp or a
 * duration (a bare "555" can: …T00:41:27.555Z).
 */
const CARD_VALUES = [
  'Avery', 'Quinn', 'avery.quinn', 'example.com', '555-01', '(415)', '4155550', 'Director', 'Partnerships', 'Robotics',
  'Example Way', 'Springfield', 'linkedin', 'GPS', 'shot on my phone', 'tok_SECRET',
];

// Synthetic JPEGs: a real header layout (the server parses it), tiny scan data.
const seg = (marker, payload) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const ascii = text => [...text].map(c => c.charCodeAt(0) & 0xFF);
const APP0 = seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXIF = seg(0xE1, ascii('Exif\0\0GPS 37.7749N 122.4194W'));
const COMMENT = seg(0xFE, ascii('shot on my phone'));
const DQT = seg(0xDB, [0, ...new Array(64).fill(1)]);
const sof = (w, h) => seg(0xC0, [8, h >> 8, h & 0xFF, w >> 8, w & 0xFF, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
const DHT = seg(0xC4, [0, ...new Array(16).fill(0)]);
const SOS = seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);

function jpeg({ width = 2000, height = 1143, metadata = [], scanBytes = 64 } = {}) {
  return new Uint8Array([
    0xFF, 0xD8, ...APP0, ...metadata, ...DQT, ...sof(width, height), ...DHT, ...SOS,
    ...new Array(scanBytes).fill(0x5A), 0xFF, 0xD9,
  ]);
}

const PREFLIGHT = { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false };

function imageOf(bytes, over = {}) {
  const header = readJpegHeader(bytes);
  return {
    version: PREPARED_IMAGE_VERSION, mimeType: 'image/jpeg', data: encodeBase64(bytes), bytes: bytes.length,
    widthPx: header?.width ?? 2000, heightPx: header?.height ?? 1143, preflight: { ...PREFLIGHT }, ...over,
  };
}

/** A request; a field passed as undefined is left out of the body. */
function request({ token = 'tok_SECRET_admin', method = 'POST', body, ...fields } = {}) {
  const payload = { userId: ADMIN, operationId: OP, image: imageOf(jpeg()), ...fields };
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body !== undefined ? body : JSON.stringify(payload),
  };
}

async function call(options) {
  const response = await handler(request(options));
  return { status: response.statusCode, headers: response.headers, body: response.body ? JSON.parse(response.body) : null };
}

function expectNoValues(text) {
  for (const value of CARD_VALUES) expect(text, `"${value}" leaked`).not.toContain(value);
}

const ENV_KEYS = [
  'CAPTURE_MODE', 'CAPTURE_EXTRACTOR', 'CAPTURE_FAKE_SCENARIO', 'CAPTURE_FAKE_DELAY_MS', 'CAPTURE_WITNESS', 'CAPTURE_REPORTS',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_LOG', 'CAPTURE_EXTRACT_MODEL', 'CAPTURE_EXTRACT_EFFORT',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setEnv(env) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
}

let logs;
beforeEach(() => {
  vi.clearAllMocks();
  store.docs.clear();
  store.writes.length = 0;
  store.failTransactions = null;
  extractCalls.length = 0;
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    vi.spyOn(console, level).mockImplementation((...args) => logs.push(format(...args)));
  }
  verifyIdToken.mockImplementation(async (token) => {
    if (!TOKENS[token]) throw new Error(`bad token ${token}`);
    return { uid: TOKENS[token] };
  });
  checkAdminAccess.mockImplementation(async uid => uid === ADMIN);
  checkSuperAdminAccess.mockImplementation(async uid => uid === SUPER);
  store.docs.set(`capture_enrollment/${ENROLLED}`, { stage: 'beta' });
  setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setEnv(Object.fromEntries(Object.entries(savedEnv).filter(([, v]) => v !== undefined)));
});

const opWrites = (path = opPath()) => store.writes.filter(w => w.path === path);
const nothingStarted = () => {
  expect(store.writes).toEqual([]);
  expect(extractCalls).toEqual([]);
  expect(logApiUsage).not.toHaveBeenCalled();
};

// ─── Request and auth ───────────────────────────────────────────────────────

describe('captureExtract: request and auth', () => {
  it('answers a CORS preflight and refuses other methods', async () => {
    expect((await handler(request({ method: 'OPTIONS' }))).statusCode).toBe(204);
    expect(await call({ method: 'GET' })).toMatchObject({ status: 405, body: { error: 'method_not_allowed' } });
    nothingStarted();
  });

  it.each([
    ['not JSON', { body: '{"userId":' }],
    ['no userId', { userId: undefined }],
    ['a malformed userId', { userId: 'a/b' }],
    ['no operationId', { operationId: undefined }],
    ['an operationId that is not cap_<uuid v4>', { operationId: 'cap_123' }],
  ])('refuses %s as invalid_request', async (_, options) => {
    expect(await call(options)).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    nothingStarted();
  });

  it.each([
    ['no token', { token: null }, 401, 'unauthorized'],
    ['a bad token', { token: 'tok_forged' }, 401, 'unauthorized'],
    ['another user\'s token', { token: 'tok_SECRET_member' }, 403, 'forbidden'],
    ['an admin acting for another user', { token: 'tok_SECRET_admin', userId: MEMBER }, 403, 'forbidden'],
  ])('refuses %s', async (_, options, status, error) => {
    expect(await call(options)).toMatchObject({ status, body: { error, operationId: OP } });
    nothingStarted();
  });

  it('sends no-store and CORS headers', async () => {
    const { headers } = await call();
    expect(headers).toMatchObject({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
  });
});

// ─── CAPTURE_MODE and the extractor setting ─────────────────────────────────

describe('captureExtract: who capture is on for', () => {
  it.each([
    ['off', { CAPTURE_MODE: 'off' }, 'tok_SECRET_admin', ADMIN],
    ['unset', { CAPTURE_MODE: undefined }, 'tok_SECRET_admin', ADMIN],
    ['internal, not an admin', {}, 'tok_SECRET_member', MEMBER],
    ['beta, not enrolled', { CAPTURE_MODE: 'beta' }, 'tok_SECRET_member', MEMBER],
  ])('%s → 404 capture_disabled, nothing created or called', async (_, env, token, userId) => {
    setEnv({ CAPTURE_EXTRACTOR: 'fake', ...env });
    if (env.CAPTURE_MODE === undefined) delete process.env.CAPTURE_MODE;
    expect(await call({ token, userId })).toMatchObject({ status: 404, body: { error: 'capture_disabled' } });
    nothingStarted();
  });

  it.each([['an admin', 'tok_SECRET_admin', ADMIN], ['a super admin', 'tok_SECRET_super', SUPER]])('internal: %s extracts', async (_, token, userId) => {
    expect(await call({ token, userId })).toMatchObject({ status: 200 });
  });

  it.each([
    ['beta', { CAPTURE_MODE: 'beta' }, 'tok_SECRET_beta', ENROLLED],
    ['on', { CAPTURE_MODE: 'on' }, 'tok_SECRET_member', MEMBER],
  ])('%s: the fake extractor is refused (config_error), before any operation', async (_, env, token, userId) => {
    setEnv({ CAPTURE_EXTRACTOR: 'fake', ...env });
    expect(await call({ token, userId })).toMatchObject({ status: 503, body: { error: 'config_error' } });
    nothingStarted();
  });

  it.each([undefined, 'other-extractor', 'FAKE'])('CAPTURE_EXTRACTOR=%s is a config_error, before any operation', async (id) => {
    setEnv({ CAPTURE_MODE: 'internal', ...(id ? { CAPTURE_EXTRACTOR: id } : {}) });
    expect(await call()).toMatchObject({ status: 503, body: { error: 'config_error' } });
    nothingStarted();
  });
});

// ─── The server checks the image itself ─────────────────────────────────────

describe('captureExtract: the prepared image is checked again on the server', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(120).fill(7)]);
  const truncated = jpeg().subarray(0, 40);
  const padded = jpeg({ scanBytes: MAX_BYTES + 10 });

  it.each([
    ['a wrong MIME type', () => imageOf(jpeg(), { mimeType: 'image/png' }), 'not_jpeg'],
    ['HEIC', () => imageOf(jpeg(), { mimeType: 'image/heic' }), 'not_jpeg'],
    ['PNG bytes labelled JPEG', () => imageOf(PNG, { widthPx: 2000, heightPx: 1143 }), 'not_jpeg'],
    ['a malformed JPEG (truncated header)', () => imageOf(truncated, { widthPx: 2000, heightPx: 1143 }), 'not_jpeg'],
    ['oversized dimensions', () => imageOf(jpeg({ width: 4032, height: 3024 })), 'too_large'],
    ['dimensions that are not the JPEG\'s', () => imageOf(jpeg({ width: 2000, height: 1143 }), { widthPx: 1900 }), 'dimensions_mismatch'],
    ['too small to read', () => imageOf(jpeg({ width: 800, height: 500 })), 'too_small'],
    ['oversized bytes', () => imageOf(padded), 'too_large'],
    ['a byte count that does not match the data', () => ({ ...imageOf(jpeg()), bytes: jpeg().length + 3 }), 'invalid_encoding'],
    ['a data: URL', () => ({ ...imageOf(jpeg()), data: `data:image/jpeg;base64,${encodeBase64(jpeg())}` }), 'invalid_encoding'],
    ['an extra key', () => ({ ...imageOf(jpeg()), fileName: 'avery-quinn-card.jpg' }), 'invalid_encoding'],
    ['no image', () => undefined, 'invalid_encoding'],
    ['another contract version', () => imageOf(jpeg(), { version: 'card-image/v2' }), 'unsupported_version'],
    ['"Use anyway" with no warning', () => imageOf(jpeg(), { preflight: { ...PREFLIGHT, userOverrode: true } }), 'invalid_preflight'],
  ])('refuses %s → 400 image_rejected, before any operation or extractor call', async (_, image, reason) => {
    const response = await call({ image: image() });
    expect(response).toEqual({ status: 400, headers: expect.any(Object), body: { error: 'image_rejected', operationId: OP, reason } });
    nothingStarted();
    expectNoValues(JSON.stringify(response.body));
  });

  it('accepts a valid prepared JPEG', async () => {
    const image = imageOf(jpeg());
    const { status, body } = await call({ image });
    expect(status).toBe(200);
    expect(extractCalls[0].image).toEqual({ mimeType: 'image/jpeg', data: image.data, widthPx: 2000, heightPx: 1143 });
    expect(body.extraction.capture.image).toEqual({ sides: 1, widthPx: 2000, heightPx: 1143, bytes: image.bytes, mimeType: 'image/jpeg', preflight: PREFLIGHT });
  });

  it('strips EXIF and comments before the extractor sees the image', async () => {
    const withMetadata = jpeg({ metadata: [...EXIF, ...COMMENT] });
    expect(hasJpegMetadata(withMetadata)).toBe(true);
    const { status, body } = await call({ image: imageOf(withMetadata) });
    expect(status).toBe(200);

    const seen = decodeBase64(extractCalls[0].image.data);
    expect(hasJpegMetadata(seen)).toBe(false);
    expect(seen).toEqual(jpeg());
    expect(Buffer.from(seen).toString('latin1')).not.toMatch(/GPS|shot on my phone/);
    expect(body.extraction.capture.image.bytes).toBe(jpeg().length);
    expect(logs.some(line => line.includes('"metadataRemoved":2'))).toBe(true);
    expectNoValues(logs.join('\n'));
  });

  it('a photo kept through "Use anyway" is extracted with nothing above likely', async () => {
    const image = imageOf(jpeg(), { preflight: { ...PREFLIGHT, warnings: ['blurry', 'dark'], userOverrode: true } });
    const { status, body } = await call({ image });
    expect(status).toBe(200);
    expect(body.extraction.capture.counts.confirmed).toBe(0);
    expect(body.extraction.capture.image.preflight).toEqual(image.preflight);
  });
});

// ─── Success and the operation record ──────────────────────────────────────

describe('captureExtract: success', () => {
  it('returns a valid CardExtraction and moves the scan created → extracted', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['extraction', 'operationId']);
    expect(body.operationId).toBe(OP);
    expect(validateCardExtraction(body.extraction)).toEqual({ ok: true, errors: [] });
    expect(body.extraction.capture).toMatchObject({
      operationId: OP, status: 'ok', provider: { id: 'fake', adapterVersion: '1', modelId: 'fake-v1', promptVersion: 'fake-v1' },
    });
    expect(body.extraction.person.fullName.value).toBe('Avery Quinn');
    expect(opWrites().map(w => w.kind)).toEqual(['create', 'update']);
    expect(store.docs.get(opPath()).state).toBe('extracted');
  });

  it('the operation record holds no card value: only state, versions, timings and counts', async () => {
    await call();
    const record = store.docs.get(opPath());
    expect(Object.keys(record).sort()).toEqual([
      'createdAt', 'expiresAt', 'extraction', 'lastActivityAt', 'operationId', 'previewVersion', 'state', 'updatedAt',
    ]);
    expect(record.extraction).toEqual({ status: 'ok', provider: 'fake', model: 'fake-v1', promptVersion: 'fake-v1', ms: expect.any(Number), fieldCount: 12 });
    const everything = JSON.stringify(store.writes);
    expectNoValues(everything);
    expect(everything).not.toContain(imageOf(jpeg()).data.slice(0, 24));
  });

  it('records usage once, by code: provider, model, tokens, timing, never values', async () => {
    await call();
    expect(logApiUsage).toHaveBeenCalledTimes(1);
    const [uid, operation, outcome, options] = logApiUsage.mock.calls[0];
    expect([uid, operation, outcome]).toEqual([ADMIN, 'captureExtract', 'success']);
    expect(options).toMatchObject({
      provider: 'fake', model: 'fake-v1', inputTokens: null, outputTokens: null, responseTime: expect.any(Number),
      metadata: { operationId: OP, attempts: 1, extractor: 'fake', promptVersion: 'fake-v1' },
    });
    expect(options.errorCode).toBeUndefined();
    expectNoValues(JSON.stringify(logApiUsage.mock.calls));
  });

  it('a partial read is stored as partial', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'partial' });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.extraction.capture.status).toBe('partial');
    expect(store.docs.get(opPath()).extraction.status).toBe('partial');
  });

  it('an unreadable card is returned for manual entry, and stored as partial', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'unreadable' });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.extraction.capture.status).toBe('unreadable');
    expect(store.docs.get(opPath()).extraction).toMatchObject({ status: 'partial', fieldCount: 1 });
  });
});

// ─── Retries and conflicts ──────────────────────────────────────────────────

describe('captureExtract: retries of the same scan', () => {
  it('a repeat of an extracted scan reads again but never transitions again', async () => {
    expect((await call()).status).toBe(200);
    const before = structuredClone(store.docs.get(opPath()));
    const second = await call();
    expect(second.status).toBe(200);
    expect(second.body.extraction.person.fullName.value).toBe('Avery Quinn');
    expect(extractCalls).toHaveLength(2);
    expect(opWrites().map(w => w.kind)).toEqual(['create', 'update']);
    expect(store.docs.get(opPath())).toEqual(before);
  });

  it('a retryable failure leaves the scan open; the retry with the same operationId transitions once', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'rate_limited' });
    expect(await call()).toMatchObject({ status: 429, body: { error: 'rate_limited', operationId: OP, retryable: true } });
    expect(extractCalls).toHaveLength(2);                      // the orchestrator's own retry
    expect(store.docs.get(opPath()).state).toBe('created');

    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake' });
    expect((await call()).status).toBe(200);
    expect(opWrites().map(w => w.kind)).toEqual(['create', 'update']);
    expect(opWrites()[1].data).toMatchObject({ state: 'extracted' });
  });

  it.each([
    ['unavailable', 503],
    ['network', 502],
    ['invalid_output', 502],
  ])('%s → %i, retryable, scan left open', async (scenario, status) => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: scenario });
    expect(await call()).toMatchObject({ status, body: { error: scenario, retryable: true } });
    expect(opWrites().map(w => w.kind)).toEqual(['create']);
    expect(logApiUsage.mock.calls[0][2]).toBe('error');
    expect(logApiUsage.mock.calls[0][3].errorCode).toBe(scenario);
  });

  it('rate-limited once, then read, inside one request', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'rate_limited_once' });
    expect((await call()).status).toBe(200);
    expect(extractCalls).toHaveLength(2);
    expect(logApiUsage.mock.calls[0][3].metadata.attempts).toBe(2);
  });

  it('timed out once (12 s), then read, inside one request', async () => {
    vi.useFakeTimers();
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'timeout_once' });
    const pending = call();
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(extractCalls).toHaveLength(2);
    expect(extractCalls[0].signal.aborted).toBe(true);
    expect(store.docs.get(opPath()).state).toBe('extracted');
  });

  it('timed out twice → 504 within the 22 s deadline; the scan stays open', async () => {
    vi.useFakeTimers();
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'timeout' });
    const pending = call();
    await vi.advanceTimersByTimeAsync(22_000);
    expect(await pending).toMatchObject({ status: 504, body: { error: 'timeout', retryable: true } });
    expect(extractCalls).toHaveLength(2);
    expect(store.docs.get(opPath()).state).toBe('created');
  });

  it('two requests racing on one scan both answer, and it transitions once', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_DELAY_MS: '40' });
    const first = call();
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = call();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(opWrites().map(w => w.kind)).toEqual(['create', 'update']);
  });

  it('different scans are different operations', async () => {
    await call();
    await call({ operationId: OP2 });
    expect(store.docs.get(opPath(ADMIN, OP2)).state).toBe('extracted');
    expect(store.docs.get(opPath()).state).toBe('extracted');
  });
});

describe('captureExtract: terminal outcomes and conflicts', () => {
  it('no_text → 422, the scan fails, and a retry of it is a conflict', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'no_text' });
    expect(await call()).toMatchObject({ status: 422, body: { error: 'no_text', operationId: OP } });
    expect(store.docs.get(opPath())).toMatchObject({ state: 'failed', errorCode: 'no_text' });

    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake' });
    expect(await call()).toMatchObject({ status: 409, body: { error: 'operation_conflict', reason: 'failed' } });
    expect(extractCalls).toHaveLength(1);
  });

  it.each([
    ['image_rejected', 400, 'rejected_by_extractor'],
    ['config_error', 503, undefined],
  ])('the extractor reports %s → %i, not retried, the scan fails', async (scenario, status, reason) => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: scenario });
    const response = await call();
    expect(response).toMatchObject({ status, body: { error: scenario } });
    expect(response.body.reason).toBe(reason);
    expect(response.body.retryable).toBeUndefined();
    expect(extractCalls).toHaveLength(1);
    expect(store.docs.get(opPath())).toMatchObject({ state: 'failed', errorCode: scenario });
  });

  const seed = (state, extra = {}) => {
    const now = new Date();
    store.docs.set(opPath(), {
      operationId: OP, state, previewVersion: state === 'previewed' ? 1 : 0,
      createdAt: now, updatedAt: now, lastActivityAt: now, expiresAt: new Date(now.getTime() + OPEN_TTL_MS), ...extra,
    });
  };

  it.each(['failed', 'expired', 'previewed', 'committed'])('a scan already %s → 409 operation_conflict; nothing read or written', async (state) => {
    seed(state);
    expect(await call()).toMatchObject({ status: 409, body: { error: 'operation_conflict', operationId: OP, reason: state } });
    expect(extractCalls).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(logApiUsage).not.toHaveBeenCalled();
  });

  it('an open scan untouched for 24 h expires on this touch → 409', async () => {
    seed('created', { lastActivityAt: new Date(Date.now() - OPEN_TTL_MS - 1000) });
    expect(await call()).toMatchObject({ status: 409, body: { error: 'operation_conflict', reason: 'expired' } });
    expect(store.docs.get(opPath()).state).toBe('expired');
    expect(extractCalls).toEqual([]);
  });

  it('a database failure is a 500 with nothing from the error in the response or logs', async () => {
    store.failTransactions = new Error('Firestore unavailable: Avery Quinn avery.quinn@example.com');
    const response = await call();
    expect(response).toMatchObject({ status: 500, body: { error: 'internal_error', operationId: OP } });
    expectNoValues(JSON.stringify(response.body));
    expectNoValues(logs.join('\n'));
    expect(logs.join('\n')).not.toContain('Firestore unavailable');
  });
});

// ─── Logs ───────────────────────────────────────────────────────────────────

describe('captureExtract: logs are value-free', () => {
  it('no card value, image byte, token or user ID reaches a log on any path', async () => {
    const image = imageOf(jpeg({ metadata: [...EXIF, ...COMMENT] }));
    const scenarios = ['card', 'partial', 'low_confidence', 'no_text', 'unreadable', 'invalid_output', 'rate_limited_once', 'rate_limited', 'image_rejected', 'config_error'];
    for (const [i, scenario] of scenarios.entries()) {
      setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: scenario });
      const operationId = `cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b${String(i).padStart(2, '0')}`;
      const response = await call({ image, operationId });
      if (response.status !== 200) expectNoValues(JSON.stringify(response.body));
    }
    await call({ image: { ...image, fileName: 'avery-quinn.jpg' } });
    await call({ token: 'tok_SECRET_member', userId: ADMIN });

    expect(logs.length).toBeGreaterThan(10);
    const text = logs.join('\n');
    expectNoValues(text);
    expect(text).not.toContain(image.data.slice(0, 24));
    expect(text).not.toContain(ADMIN);
    // Every line is one structured capture event.
    for (const line of logs) expect(JSON.parse(line).evt).toBe('capture');
    expectNoValues(JSON.stringify(logApiUsage.mock.calls));
    expectNoValues(JSON.stringify(store.writes));
  });

  it('a failure line carries the extractor\'s diagnostic code', async () => {
    setEnv({ CAPTURE_MODE: 'internal', CAPTURE_EXTRACTOR: 'fake', CAPTURE_FAKE_SCENARIO: 'invalid_output' });
    await call();
    const line = JSON.parse(logs.find(l => l.includes('"stage":"extract"')));
    expect(line).toMatchObject({ outcome: 'invalid_output', detail: 'reading:company', reason: 'reading:company', attempts: 2 });
  });

  it('a success line carries codes, counts, sizes and timings', async () => {
    await call();
    const line = JSON.parse(logs.find(l => l.includes('"outcome":"ok"')));
    expect(Object.keys(line).sort()).toEqual([
      'adapterVersion', 'attempts', 'bytes', 'confirmed', 'evt', 'fields', 'heightPx', 'httpStatus', 'likely', 'metadataRemoved',
      'modelId', 'operationId', 'outcome', 'possible', 'previousState', 'promptVersion', 'providerId', 'providerMs', 'stage',
      'state', 'status', 'totalMs', 'userOverrode', 'validateMs', 'warnings', 'widthPx',
    ]);
    expect(line).toMatchObject({ stage: 'extract', status: 'ok', fields: 12, providerId: 'fake', modelId: 'fake-v1', attempts: 1, warnings: [] });
  });
});

// ─── The claude-vision extractor, end to end (recorded response, no network) ─

describe('captureExtract with claude-vision', () => {
  const t = (text, confidence = 0.97) => ({ text, confidence });
  const blank = { text: '', confidence: 0 };
  const ANSWER = {
    textFound: true,
    person: {
      fullName: t('Avery Quinn', 0.98), givenName: t('Avery'), middleName: blank, familyName: t('Quinn'), suffix: blank,
      title: t('Director of Partnerships', 0.93), emails: [t('avery.quinn@example.com')],
      phones: [{ ...t('+1 (415) 555-0142', 0.95), label: 'mobile' }], linkedinUrl: blank, socials: [],
    },
    company: { name: { ...t('Example Robotics', 0.96), onlyInLogo: false }, website: t('www.example.com', 0.96), address: blank, linkedinUrl: blank },
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const answered = (over = {}) => reply(200, {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(ANSWER) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 3912, output_tokens: 744 }, ...over,
  });

  /** Stub the network: every request is recorded and answered in turn. */
  function anthropic(...replies) {
    const requests = [];
    vi.stubGlobal('fetch', async (url, init) => {
      requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
      return replies[Math.min(requests.length - 1, replies.length - 1)]();
    });
    return requests;
  }

  const enrolled = () => setEnv({ CAPTURE_MODE: 'beta', CAPTURE_EXTRACTOR: 'claude-vision', ANTHROPIC_API_KEY: 'sk-test-not-a-key' });

  it('without an API key it is a config_error, before any operation', async () => {
    setEnv({ CAPTURE_MODE: 'beta', CAPTURE_EXTRACTOR: 'claude-vision' });
    const requests = anthropic(() => answered());
    expect(await call({ token: 'tok_SECRET_beta', userId: ENROLLED })).toMatchObject({ status: 503, body: { error: 'config_error' } });
    expect(requests).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it('an enrolled user gets a CardExtraction read by Claude; nothing personal is logged or stored', async () => {
    enrolled();
    const requests = anthropic(() => answered());
    const image = imageOf(jpeg({ metadata: [...EXIF] }));
    const { status, body } = await call({ token: 'tok_SECRET_beta', userId: ENROLLED, image });
    expect(status).toBe(200);
    expect(validateCardExtraction(body.extraction)).toEqual({ ok: true, errors: [] });
    expect(body.extraction.capture.provider).toEqual({ id: 'claude-vision', adapterVersion: '1', modelId: 'claude-opus-5-5', promptVersion: 'card-claude/v2' });
    expect(body.extraction.capture.usage).toEqual({ inputTokens: 3912, outputTokens: 744 });
    expect(body.extraction.person.fullName).toMatchObject({ value: 'Avery Quinn', extraction: { level: 'confirmed' } });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(requests[0].headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const sent = decodeBase64(requests[0].body.messages[0].content[0].source.data);
    expect(hasJpegMetadata(sent)).toBe(false);

    expect(store.docs.get(opPath(ENROLLED)).extraction).toEqual({
      status: 'ok', provider: 'claude-vision', model: 'claude-opus-5-5', promptVersion: 'card-claude/v2', ms: expect.any(Number), fieldCount: 9,
    });
    const [, operation, outcome, options] = logApiUsage.mock.calls[0];
    expect([operation, outcome]).toEqual(['captureExtract', 'success']);
    expect(options).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 3912, outputTokens: 744 });

    expectNoValues(logs.join('\n'));
    expectNoValues(JSON.stringify(store.writes));
    expectNoValues(JSON.stringify(logApiUsage.mock.calls));
    expect(logs.join('\n')).not.toContain('sk-test-not-a-key');
  });

  it('overloaded twice → 503, retryable, the scan left open, the status code in the log', async () => {
    enrolled();
    const requests = anthropic(() => reply(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
    expect(await call({ token: 'tok_SECRET_beta', userId: ENROLLED })).toMatchObject({ status: 503, body: { error: 'unavailable', retryable: true } });
    expect(requests).toHaveLength(2);
    expect(store.docs.get(opPath(ENROLLED)).state).toBe('created');
    expect(logs.some(line => line.includes('"detail":"http_529"'))).toBe(true);
  });

  it('a refusal → 400 image_rejected, not retried, and the scan fails', async () => {
    enrolled();
    const requests = anthropic(() => answered({ stop_reason: 'refusal', content: [] }));
    expect(await call({ token: 'tok_SECRET_beta', userId: ENROLLED })).toMatchObject({ status: 400, body: { error: 'image_rejected', reason: 'rejected_by_extractor' } });
    expect(requests).toHaveLength(1);
    expect(store.docs.get(opPath(ENROLLED))).toMatchObject({ state: 'failed', errorCode: 'image_rejected' });
    expect(logs.some(line => line.includes('"detail":"refusal"'))).toBe(true);
  });
});
