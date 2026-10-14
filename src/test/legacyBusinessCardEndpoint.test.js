/**
 * The legacy business-card endpoint, locked down and deprecated.
 *
 * Nothing in the app calls /.netlify/functions/extractBusinessCard any more,
 * so every request it receives is from a caller we have not found yet. These
 * tests hold the four promises that let it stay deployed while we look:
 *
 *   - it keeps working for that caller: same success body, same parser
 *   - it no longer leaks: no card content, token, key or upstream body in a
 *     log, an error response, a usage row or an alert
 *   - it is strict: the token's user must be the requested user, admins included
 *   - it is loud: every request writes one telemetry line, raises a throttled
 *     ops alert, and is answered with a Deprecation header
 *
 * firebase-admin and logApiUsage are mocked; alertOps is the real module, with
 * an in-memory ops_alerts cooldown, so the throttle under test is the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { format } from 'node:util';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';

const verifyIdToken = vi.hoisted(() => vi.fn());
const logApiUsage = vi.hoisted(() => vi.fn(async () => {}));
const store = vi.hoisted(() => new Map());

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
        set: async (data) => { store.set(`${name}/${id}`, { ...(store.get(`${name}/${id}`) || {}), ...data }); },
      }),
    }),
  },
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));

import {
  handler, CODES, SUCCESS, LOG_EVENT, KILL_SWITCH_ENV, DEPRECATION_HEADER, ALERT_JOBS, ALERT_BUDGET_MS,
} from '../../netlify/functions/extractBusinessCard.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const UID = 'uid_u7f3k2';
const OTHER_UID = 'uid_q9w8e7';
const ADMIN_UID = 'uid_admin_5x';
const TOKEN = 'tok_SECRET_user_token';
const OTHER_TOKEN = 'tok_SECRET_other_token';
const ADMIN_TOKEN = 'tok_SECRET_admin_token';
const VISION_KEY = 'vision_SECRET_key_value';
const IMAGE_PAYLOAD = Buffer.from('IMAGE_BYTES_SECRET_CONTENT').toString('base64');
const IMAGE = `data:image/jpeg;base64,${IMAGE_PAYLOAD}`;

const CARD_TEXT = [
  'JANE SMITH',
  'VP of Sales',
  'ACME ROCKETS INC',
  'jane.smith@acmerockets.com',
  '(415) 555-0142',
  'www.acmerockets.com',
  '123 Market Street',
  'San Francisco, CA 94105',
].join('\n');

/** Anything that would identify the card, the person, or a credential. */
const SECRETS = [
  'jane', 'smith', 'acme', 'rockets', '555-0142', 'market street', 'vp of sales', '94105',
  TOKEN, OTHER_TOKEN, ADMIN_TOKEN, VISION_KEY, IMAGE_PAYLOAD,
];

function expectNoSecrets(text, where) {
  const haystack = String(text).toLowerCase();
  for (const secret of SECRETS) {
    expect(haystack, `${where} contains "${secret}"`).not.toContain(secret.toLowerCase());
  }
}

const vision = {
  ok: (text = CARD_TEXT) => ({
    ok: true, status: 200,
    json: async () => ({ responses: [{ textAnnotations: [{ description: text }] }] }),
  }),
  noText: () => ({ ok: true, status: 200, json: async () => ({ responses: [{}] }) }),
  // Upstream bodies can echo the request, the key included. None of it may surface.
  httpError: () => ({
    ok: false, status: 403,
    text: async () => `{"error":{"message":"API key ${VISION_KEY} rejected for JANE SMITH"}}`,
    json: async () => ({ error: { message: `API key ${VISION_KEY} rejected for JANE SMITH` } }),
  }),
  imageError: () => ({
    ok: true, status: 200,
    json: async () => ({ responses: [{ error: { code: 3, message: 'Bad image data: JANE SMITH' } }] }),
  }),
  networkError: () => {
    throw new TypeError(`fetch failed: https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`);
  },
};

let visionReply;
let resendReply;
let emails;
let visionRequests;
let calls;

function event({ method = 'POST', body, headers = {} } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-nf-request-id': 'req-123', origin: 'https://app.idynify.com', ...headers },
    body: body === undefined
      ? JSON.stringify({ userId: UID, authToken: TOKEN, imageBase64: IMAGE })
      : body,
  };
}

const parse = (res) => JSON.parse(res.body);
const telemetryLines = () => calls.filter(c => c.args[0] === LOG_EVENT);
const lastTelemetry = () => telemetryLines().at(-1).args[1];
const allLogText = () => calls.map(c => c.text).join('\n');

beforeEach(() => {
  store.clear();
  emails = [];
  visionRequests = [];
  calls = [];
  visionReply = vision.ok;
  resendReply = async () => ({ ok: true, status: 200 });

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    vi.spyOn(console, level).mockImplementation((...args) => {
      calls.push({ level, args, text: format(...args) });
    });
  }

  verifyIdToken.mockReset().mockImplementation(async (token) => {
    if (token === TOKEN) return { uid: UID };
    if (token === OTHER_TOKEN) return { uid: OTHER_UID };
    if (token === ADMIN_TOKEN) return { uid: ADMIN_UID };
    throw new Error(`Decoding Firebase ID token failed: ${token}`);
  });
  logApiUsage.mockClear();

  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://vision.googleapis.com/')) {
      visionRequests.push({ url: href, body: JSON.parse(init.body) });
      return visionReply();
    }
    if (href.startsWith('https://api.resend.com/')) {
      emails.push(JSON.parse(init.body));
      return resendReply();
    }
    throw new Error(`unexpected fetch: ${href}`);
  }));

  process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  delete process.env[KILL_SWITCH_ENV];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GOOGLE_VISION_API_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.OPS_ALERT_EMAIL;
  delete process.env[KILL_SWITCH_ENV];
});

// ─── 1. Compatibility: an unknown caller keeps working ──────────────────────

describe('the success contract is unchanged', () => {
  it('returns success, extractedData and rawText — and nothing else', async () => {
    const res = await handler(event());

    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(Object.keys(body)).toEqual(['success', 'extractedData', 'rawText']);
    expect(body.success).toBe(true);
    expect(body.rawText).toBe(CARD_TEXT);
  });

  // Characterisation of parseBusinessCardText, whose source this change does
  // not touch. If these values move, the parser changed.
  //
  // `website: 'jane.smith'` is the legacy parser's existing behaviour, not a
  // typo: its website pattern matches the local part of the email first. It
  // is recorded, not fixed — this is a deprecation change, not an accuracy one,
  // and the endpoint is being retired rather than repaired.
  it('extracts exactly what the legacy parser always extracted', async () => {
    const { extractedData } = parse(await handler(event()));

    expect(extractedData).toEqual({
      name: 'JANE SMITH',
      email: 'jane.smith@acmerockets.com',
      phone: '(415) 555-0142',
      company: 'ACME ROCKETS INC',
      title: 'VP of Sales',
      website: 'jane.smith',
      address: '123 Market Street, San Francisco, CA 94105',
    });
  });

  it('sends Vision the same request it always sent', async () => {
    await handler(event());

    expect(visionRequests).toHaveLength(1);
    expect(visionRequests[0].url).toBe(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`);
    expect(visionRequests[0].body).toEqual({
      requests: [{ image: { content: IMAGE_PAYLOAD }, features: [{ type: 'TEXT_DETECTION', maxResults: 1 }] }],
    });
  });

  it('accepts the token from the Authorization header as well as the body', async () => {
    const res = await handler(event({
      body: JSON.stringify({ userId: UID, imageBase64: IMAGE }),
      headers: { authorization: `Bearer ${TOKEN}` },
    }));
    expect(res.statusCode).toBe(200);
  });
});

// ─── 2. Strict authentication ───────────────────────────────────────────────

describe('the token must belong to the requested user', () => {
  it('401 UNAUTHORIZED with no token, before any Vision call', async () => {
    const res = await handler(event({ body: JSON.stringify({ userId: UID, imageBase64: IMAGE }) }));

    expect(res.statusCode).toBe(401);
    expect(parse(res).code).toBe(CODES.UNAUTHORIZED);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(visionRequests).toHaveLength(0);
  });

  it('401 UNAUTHORIZED for a token that does not verify, with no usage row', async () => {
    const res = await handler(event({ body: JSON.stringify({ userId: UID, authToken: 'forged', imageBase64: IMAGE }) }));

    expect(res.statusCode).toBe(401);
    expect(parse(res).code).toBe(CODES.UNAUTHORIZED);
    expect(visionRequests).toHaveLength(0);
    // An unverified userId is a claim. It is never charged with a usage row.
    expect(logApiUsage).not.toHaveBeenCalled();
  });

  it('403 USER_MISMATCH when the token is another user’s', async () => {
    const res = await handler(event({ body: JSON.stringify({ userId: UID, authToken: OTHER_TOKEN, imageBase64: IMAGE }) }));

    expect(res.statusCode).toBe(403);
    expect(parse(res).code).toBe(CODES.USER_MISMATCH);
    expect(visionRequests).toHaveLength(0);
  });

  // Was a 500 by accident: the client sends the impersonated user's id with
  // the admin's token. It stays refused, now on purpose.
  it('403 USER_MISMATCH for admin impersonation too', async () => {
    const res = await handler(event({ body: JSON.stringify({ userId: UID, authToken: ADMIN_TOKEN, imageBase64: IMAGE }) }));

    expect(res.statusCode).toBe(403);
    expect(parse(res).code).toBe(CODES.USER_MISMATCH);
    expect(visionRequests).toHaveLength(0);
  });

  it('records a mismatch against the verified token holder, never the claimed user', async () => {
    await handler(event({ body: JSON.stringify({ userId: UID, authToken: OTHER_TOKEN, imageBase64: IMAGE }) }));

    expect(logApiUsage).toHaveBeenCalledTimes(1);
    expect(logApiUsage.mock.calls[0][0]).toBe(OTHER_UID);
    expect(lastTelemetry()).toMatchObject({ authenticated: true, userMismatch: true, uid: OTHER_UID });
  });

  it('does not use the impersonation-permitting helpers', () => {
    const src = readFileSync('netlify/functions/extractBusinessCard.js', 'utf8');
    expect(src).not.toMatch(/import[^;]*verifyAuthToken/);
    expect(src).not.toMatch(/import[^;]*checkAdminAccess/);
    expect(src).not.toContain('identitytoolkit.googleapis.com');
  });
});

// ─── 3. Explicit status codes ───────────────────────────────────────────────

describe('every failure has its own status and stable code', () => {
  it.each([
    ['GET', () => event({ method: 'GET' }), 405, CODES.METHOD_NOT_ALLOWED],
    ['malformed JSON', () => event({ body: '{not json' }), 400, CODES.INVALID_REQUEST],
    ['empty body', () => event({ body: '' }), 400, CODES.INVALID_REQUEST],
    ['missing userId', () => event({ body: JSON.stringify({ authToken: TOKEN, imageBase64: IMAGE }) }), 400, CODES.INVALID_REQUEST],
    ['missing image', () => event({ body: JSON.stringify({ userId: UID, authToken: TOKEN }) }), 400, CODES.INVALID_REQUEST],
    ['non-string userId', () => event({ body: JSON.stringify({ userId: { $gt: '' }, authToken: TOKEN, imageBase64: IMAGE }) }), 400, CODES.INVALID_REQUEST],
  ])('%s → %i %s, with no token check and no Vision call', async (_label, make, status, code) => {
    const res = await handler(make());

    expect(res.statusCode).toBe(status);
    expect(parse(res)).toMatchObject({ success: false, code });
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(visionRequests).toHaveLength(0);
  });

  it.each([
    ['Vision answers non-2xx', vision.httpError, 502, CODES.UPSTREAM_OCR_FAILURE],
    ['Vision is unreachable', vision.networkError, 502, CODES.UPSTREAM_OCR_FAILURE],
    ['Vision rejects the image inside a 200', vision.imageError, 502, CODES.UPSTREAM_OCR_FAILURE],
    ['Vision finds no text', vision.noText, 422, CODES.NO_TEXT_FOUND],
  ])('%s → %i %s, recorded as a Google usage error', async (_label, reply, status, code) => {
    visionReply = reply;
    const res = await handler(event());

    expect(res.statusCode).toBe(status);
    expect(parse(res)).toMatchObject({ success: false, code });
    expect(logApiUsage).toHaveBeenCalledWith(UID, 'extractBusinessCard', 'error',
      expect.objectContaining({ provider: 'google', errorCode: code }));
  });

  it('500 INTERNAL_ERROR when the Vision key is not configured, without calling Vision', async () => {
    delete process.env.GOOGLE_VISION_API_KEY;
    const res = await handler(event());

    expect(res.statusCode).toBe(500);
    expect(parse(res)).toMatchObject({ success: false, code: CODES.INTERNAL_ERROR });
    expect(visionRequests).toHaveLength(0);
  });

  it('keeps every message generic: no provider, variable or step named', async () => {
    const messages = [];
    for (const reply of [vision.httpError, vision.networkError, vision.imageError, vision.noText]) {
      visionReply = reply;
      messages.push(parse(await handler(event())).error);
    }
    delete process.env.GOOGLE_VISION_API_KEY;
    messages.push(parse(await handler(event())).error);
    process.env[KILL_SWITCH_ENV] = 'off';
    messages.push(parse(await handler(event())).error);

    for (const message of messages) {
      expect(message).not.toMatch(/vision|google|api key|GOOGLE_|LEGACY_|firebase|token|env/i);
    }
  });
});

// ─── 4. Usage is booked as what it is ───────────────────────────────────────

describe('usage classification', () => {
  it('books a scan as a Google call, not an Apollo credit', async () => {
    await handler(event());

    expect(logApiUsage).toHaveBeenCalledTimes(1);
    const [uid, operation, status, options] = logApiUsage.mock.calls[0];
    expect(uid).toBe(UID);
    expect(operation).toBe('extractBusinessCard');
    expect(status).toBe('success');
    // provider 'google' → endpoint GOOGLE_EXTRACTBUSINESSCARD, creditsUsed 0.
    // Omitted, logApiUsage defaults to apollo and charges one credit.
    expect(options.provider).toBe('google');
    expect(options.metadata).toEqual({ textLength: CARD_TEXT.length, fieldsExtracted: 7, legacy: true });
  });
});

// ─── 5. No PII anywhere it should not be ────────────────────────────────────

describe('nothing from the card, the token or the key is logged', () => {
  it('a successful scan logs no card content — while still returning it to the caller', async () => {
    const res = await handler(event());

    // Not vacuous: the response really does carry the card.
    expect(res.body).toContain('jane.smith@acmerockets.com');

    expectNoSecrets(allLogText(), 'logs');
    expectNoSecrets(JSON.stringify(logApiUsage.mock.calls), 'apiLogs row');
  });

  it.each([
    ['an upstream error body', vision.httpError],
    ['a network error carrying the request URL', vision.networkError],
    ['a per-image error message', vision.imageError],
  ])('%s reaches neither the logs nor the response', async (_label, reply) => {
    visionReply = reply;
    const res = await handler(event());

    expectNoSecrets(allLogText(), 'logs');
    expectNoSecrets(res.body, 'response');
    expectNoSecrets(JSON.stringify(logApiUsage.mock.calls), 'apiLogs row');
  });

  it('a rejected token is not logged', async () => {
    await handler(event({ body: JSON.stringify({ userId: UID, authToken: 'tok_SECRET_forged', imageBase64: IMAGE }) }));
    expect(allLogText()).not.toContain('tok_SECRET_forged');
  });

  it('logs the calling host only — never userinfo, path or query', async () => {
    await handler(event({ headers: { origin: 'https://user:hunter2@caller.example.com:8443/p/uid_9?token=abc' } }));

    expect(lastTelemetry().originHost).toBe('caller.example.com:8443');
    const text = allLogText();
    for (const fragment of ['hunter2', 'user:', '/p/uid_9', 'token=abc']) {
      expect(text).not.toContain(fragment);
    }
  });

  it('falls back to the Referer host, still without its path or query', async () => {
    await handler(event({ headers: { origin: undefined, referer: 'https://app.idynify.com/scout?tab=scout-plus&email=a@b.co' } }));

    expect(lastTelemetry().originHost).toBe('app.idynify.com');
    expect(allLogText()).not.toContain('a@b.co');
  });
});

// ─── 6. One telemetry line per request ──────────────────────────────────────

describe('telemetry', () => {
  it.each([
    ['success', () => event(), SUCCESS, 200, true],
    ['bad token', () => event({ body: JSON.stringify({ userId: UID, authToken: 'x', imageBase64: IMAGE }) }), CODES.UNAUTHORIZED, 401, false],
    ['wrong method', () => event({ method: 'GET' }), CODES.METHOD_NOT_ALLOWED, 405, false],
  ])('%s writes exactly one structured line', async (_label, make, outcome, status, authenticated) => {
    await handler(make());

    expect(telemetryLines()).toHaveLength(1);
    expect(telemetryLines()[0].level).toBe('warn');
    const line = lastTelemetry();
    expect(line).toMatchObject({ requestId: 'req-123', originHost: 'app.idynify.com', outcome, status, authenticated });
    expect(typeof line.ms).toBe('number');
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
    expect(line.uid).toBe(authenticated ? UID : null);
  });

  it('records sizes and counts for a scan, never values', async () => {
    await handler(event());
    const line = lastTelemetry();

    expect(line.imageChars).toBe(IMAGE_PAYLOAD.length);
    expect(line.textChars).toBe(CARD_TEXT.length);
    expect(line.fieldsExtracted).toBe(7);
    for (const key of ['extractedData', 'rawText', 'text', 'userId', 'authToken', 'imageBase64']) {
      expect(line).not.toHaveProperty(key);
    }
  });
});

// ─── 7. The Deprecation header, on every response ───────────────────────────

describe('every response carries the Deprecation header', () => {
  const cases = [
    ['200 success', () => {}, () => event()],
    ['400 invalid request', () => {}, () => event({ body: '{' })],
    ['401 unauthorized', () => {}, () => event({ body: JSON.stringify({ userId: UID, authToken: 'x', imageBase64: IMAGE }) })],
    ['403 user mismatch', () => {}, () => event({ body: JSON.stringify({ userId: UID, authToken: ADMIN_TOKEN, imageBase64: IMAGE }) })],
    ['405 method not allowed', () => {}, () => event({ method: 'GET' })],
    ['410 kill switch', () => { process.env[KILL_SWITCH_ENV] = 'off'; }, () => event()],
    ['422 no text', () => { visionReply = vision.noText; }, () => event()],
    ['500 internal error', () => { delete process.env.GOOGLE_VISION_API_KEY; }, () => event()],
    ['502 upstream failure', () => { visionReply = vision.httpError; }, () => event()],
  ];

  it.each(cases)('%s', async (_label, arrange, make) => {
    arrange();
    const res = await handler(make());

    expect(res.headers.Deprecation).toBe(DEPRECATION_HEADER);
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('is an RFC 9745 date: "@" + Unix seconds for 2026-10-14', () => {
    expect(DEPRECATION_HEADER).toMatch(/^@\d+$/);
    expect(new Date(Number(DEPRECATION_HEADER.slice(1)) * 1000).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

// ─── 8. Kill switch ─────────────────────────────────────────────────────────

describe(`kill switch (${KILL_SWITCH_ENV})`, () => {
  it('"off" answers 410 LEGACY_ENDPOINT_DISABLED with no auth work, no Vision call and no card processing', async () => {
    process.env[KILL_SWITCH_ENV] = 'off';
    const res = await handler(event());

    expect(res.statusCode).toBe(410);
    expect(parse(res)).toEqual({ success: false, error: 'This endpoint is no longer available.', code: CODES.LEGACY_ENDPOINT_DISABLED });
    expect(res.headers.Deprecation).toBe(DEPRECATION_HEADER);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(visionRequests).toHaveLength(0);
    expect(logApiUsage).not.toHaveBeenCalled();
    expect(lastTelemetry()).toMatchObject({ outcome: CODES.LEGACY_ENDPOINT_DISABLED, status: 410, authenticated: false });
  });

  it('applies before the method check', async () => {
    process.env[KILL_SWITCH_ENV] = 'off';
    expect((await handler(event({ method: 'GET' }))).statusCode).toBe(410);
  });

  it.each([' OFF ', 'Off'])('%j also disables it', async (value) => {
    process.env[KILL_SWITCH_ENV] = value;
    expect((await handler(event())).statusCode).toBe(410);
  });

  // Fail toward the status quo: a typo must not break a caller we have not found.
  it.each([undefined, '', 'on', 'of', 'false', 'disabled'])('%j leaves it on', async (value) => {
    if (value === undefined) delete process.env[KILL_SWITCH_ENV];
    else process.env[KILL_SWITCH_ENV] = value;
    expect((await handler(event())).statusCode).toBe(200);
  });
});

// ─── 9. Throttled ops alert ─────────────────────────────────────────────────

describe('unexpected use raises a throttled ops alert without PII', () => {
  it('an authenticated successful call sends one alert, carrying only the request envelope', async () => {
    await handler(event());

    expect(emails).toHaveLength(1);
    const { subject, html } = emails[0];
    expect(subject).toBe(`[UNEXPECTED] ${ALERT_JOBS.AUTHENTICATED}`);
    for (const expected of ['/.netlify/functions/extractBusinessCard', 'req-123', SUCCESS, 'app.idynify.com']) {
      expect(html).toContain(expected);
    }
    expect(html).toMatch(/authenticated<\/td><td[^>]*>true/);
    expect(html).toMatch(/userMismatch<\/td><td[^>]*>false/);

    expectNoSecrets(subject + html, 'alert');
    // No user identifier in the email. The apiLogs row at the same timestamp has it.
    expect(html).not.toContain(UID);
  });

  it('an authenticated failed call alerts with its outcome and nothing from upstream', async () => {
    visionReply = vision.httpError;
    await handler(event());

    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain(CODES.UPSTREAM_OCR_FAILURE);
    expectNoSecrets(emails[0].subject + emails[0].html, 'alert');
  });

  it('a user mismatch alerts on the authenticated key and says so', async () => {
    await handler(event({ body: JSON.stringify({ userId: UID, authToken: ADMIN_TOKEN, imageBase64: IMAGE }) }));

    expect(emails[0].subject).toBe(`[UNEXPECTED] ${ALERT_JOBS.AUTHENTICATED}`);
    expect(emails[0].html).toMatch(/userMismatch<\/td><td[^>]*>true/);
    expect(emails[0].html).not.toContain(ADMIN_UID);
  });

  it('repeat calls inside the hour send no second alert, but are still logged and still booked', async () => {
    await handler(event());
    await handler(event());
    await handler(event());

    expect(emails).toHaveLength(1);
    expect(telemetryLines()).toHaveLength(3);
    expect(logApiUsage).toHaveBeenCalledTimes(3);
    expect(telemetryLines().map(l => l.args[1].alert)).toEqual(['sent', 'cooldown', 'cooldown']);
    expect(store.get(`ops_alerts/${ALERT_JOBS.AUTHENTICATED}`)).toMatchObject({ job: ALERT_JOBS.AUTHENTICATED });
  });

  it('keeps a separate cooldown for unauthenticated calls, so probes cannot hide a real caller', async () => {
    await handler(event({ method: 'GET' }));
    await handler(event({ method: 'GET' }));
    await handler(event());

    expect(emails.map(e => e.subject)).toEqual([
      `[UNEXPECTED] ${ALERT_JOBS.UNAUTHENTICATED}`,
      `[UNEXPECTED] ${ALERT_JOBS.AUTHENTICATED}`,
    ]);
  });

  it('alerts again once the hour has passed', async () => {
    await handler(event());
    store.set(`ops_alerts/${ALERT_JOBS.AUTHENTICATED}`, { lastAlertAtMs: Date.now() - 61 * 60 * 1000 });
    await handler(event());

    expect(emails).toHaveLength(2);
  });

  it('a 410 from the kill switch still alerts — something is still calling', async () => {
    process.env[KILL_SWITCH_ENV] = 'off';
    await handler(event());

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(`[UNEXPECTED] ${ALERT_JOBS.UNAUTHENTICATED}`);
    expect(emails[0].html).toContain(CODES.LEGACY_ENDPOINT_DISABLED);
  });

  it('a failed alert never changes the response', async () => {
    resendReply = async () => ({ ok: false, status: 500 });
    const res = await handler(event());

    expect(res.statusCode).toBe(200);
    expect(lastTelemetry().alert).toBe('resend_500');
  });

  it('a hung alert is abandoned after the budget and the caller still gets its answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resendReply = () => new Promise(() => {});

    const pending = handler(event());
    for (let i = 0; i < 50 && emails.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(emails).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(ALERT_BUDGET_MS);
    const res = await pending;

    expect(res.statusCode).toBe(200);
    expect(lastTelemetry().alert).toBe('alert_budget_exceeded');
  });

  it('with alerting unconfigured, the request is unaffected and the line says why', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await handler(event());

    expect(res.statusCode).toBe(200);
    expect(emails).toHaveLength(0);
    expect(lastTelemetry().alert).toBe('no_resend_key');
  });
});
