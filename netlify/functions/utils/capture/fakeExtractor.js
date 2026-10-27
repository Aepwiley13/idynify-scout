/**
 * The fake extractor: deterministic, offline and free. A permanent part of
 * capture, not scaffolding: CI, local runs, Capture Lab UI work, and every
 * retry and error state are exercised through it, the same way a real
 * extractor is, through the same orchestrator and assembler.
 *
 *   CAPTURE_FAKE_SCENARIO   what every extract() call does (default: card)
 *     card             the fictional card below
 *     partial          company details only (status partial)
 *     low_confidence   the card, read with low scores (fields to review)
 *     no_text          nothing readable (422, operation failed)
 *     unreadable       text read, nothing usable
 *     invalid_output   a malformed reading (it carries a domain, which no
 *                      extractor may supply): rejected by the trust boundary
 *     timeout          never answers; the orchestrator's deadline ends it
 *     timeout_once     times out on the first attempt, then reads the card
 *     rate_limited_once  rate-limited on the first attempt, then reads the card
 *     rate_limited | unavailable | network | config_error | image_rejected
 *                      fails with that code on every attempt
 *   CAPTURE_FAKE_DELAY_MS   0–15000, added before each answer (default 0)
 *
 * The scenario is a server setting, never the request's: like the extractor
 * itself, the client cannot choose it. An unknown scenario or delay is a
 * config_error. "_once" counts attempts per extractor, and the endpoint
 * builds one extractor per request, so it means "fail the first attempt of
 * every request".
 *
 * Every value is fictional: example.com is reserved for documentation
 * (RFC 2606) and 555-01xx numbers are reserved for fiction. extractors.js
 * refuses this extractor outside internal mode, so a real user never sees it.
 */
import { CaptureExtractorError, EXTRACTOR_ERRORS } from './errors.js';
import { emptyReading, notPrinted } from './cardReading.js';

export const FAKE_EXTRACTOR_ID = 'fake';
export const MAX_FAKE_DELAY_MS = 15_000;

/** The card the fake extractor reads. */
export function fakeCardReading() {
  return {
    status: 'read',
    person: {
      fullName: { raw: 'Avery Quinn', score: 0.98 },
      givenName: { raw: 'Avery', score: 0.97 },
      middleName: notPrinted(),
      familyName: { raw: 'Quinn', score: 0.97 },
      suffix: notPrinted(),
      title: { raw: 'Director of Partnerships', score: 0.93 },
      emails: [{ raw: 'avery.quinn@example.com', score: 0.97 }],
      phones: [
        { raw: '+1 (415) 555-0142', score: 0.95, label: 'mobile' },
        { raw: 'T: +1 (415) 555-0100 x12', score: 0.9, label: null },
      ],
      linkedinUrl: { raw: 'linkedin.com/in/avery-quinn-example', score: 0.9 },
      socials: [],
    },
    company: {
      name: { raw: 'Example Robotics', score: 0.96, fromLogo: false },
      website: { raw: 'www.example.com', score: 0.96 },
      address: { raw: '100 Example Way, Springfield', score: 0.85 },
      linkedinUrl: notPrinted(),
    },
  };
}

/** The same card, read with scores that leave most fields to review. */
function lowConfidenceReading() {
  const reading = fakeCardReading();
  const scores = [0.62, 0.55, 0.4, 0.58, 0.7, 0.45];
  let i = 0;
  const lower = text => ({ ...text, score: text.raw === null ? 0 : scores[i++ % scores.length] });
  for (const key of ['fullName', 'givenName', 'familyName', 'title', 'linkedinUrl']) reading.person[key] = lower(reading.person[key]);
  reading.person.emails = reading.person.emails.map(lower);
  reading.person.phones = reading.person.phones.map(lower);
  for (const key of ['name', 'website', 'address']) reading.company[key] = lower(reading.company[key]);
  return reading;
}

function partialReading() {
  const { company } = fakeCardReading();
  return { ...emptyReading('read'), company: { ...company, address: notPrinted() } };
}

function unreadableReading() {
  const reading = emptyReading('read');
  reading.person.emails = [{ raw: 'avery@@example', score: 0.4 }];
  return reading;
}

function invalidReading() {
  const reading = fakeCardReading();
  reading.company = { ...reading.company, domain: { raw: 'example.com', score: 1 } };
  return reading;
}

const READINGS = {
  card: fakeCardReading,
  partial: partialReading,
  low_confidence: lowConfidenceReading,
  no_text: () => emptyReading('no_text'),
  unreadable: unreadableReading,
  invalid_output: invalidReading,
};

const ALWAYS_FAILS = new Set([
  EXTRACTOR_ERRORS.RATE_LIMITED, EXTRACTOR_ERRORS.UNAVAILABLE, EXTRACTOR_ERRORS.NETWORK,
  EXTRACTOR_ERRORS.CONFIG_ERROR, EXTRACTOR_ERRORS.IMAGE_REJECTED,
]);

const FAILS_ONCE = { timeout_once: EXTRACTOR_ERRORS.TIMEOUT, rate_limited_once: EXTRACTOR_ERRORS.RATE_LIMITED };

export const FAKE_SCENARIOS = Object.freeze([
  ...Object.keys(READINGS), 'timeout', ...Object.keys(FAILS_ONCE), ...ALWAYS_FAILS,
]);

/** Resolves after `ms`, or rejects with timeout as soon as `signal` aborts. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(new CaptureExtractorError(EXTRACTOR_ERRORS.TIMEOUT));
    };
    const timer = ms === Infinity ? null : setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** Throws (and the registry reports config_error) for an unknown scenario or delay. */
export function createFakeExtractor(env = {}) {
  const scenario = env.CAPTURE_FAKE_SCENARIO ?? 'card';
  if (!FAKE_SCENARIOS.includes(scenario)) throw new Error('unknown fake scenario');
  const delayMs = env.CAPTURE_FAKE_DELAY_MS === undefined ? 0 : Number(env.CAPTURE_FAKE_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_FAKE_DELAY_MS) throw new Error('bad fake delay');

  let attempts = 0;
  return {
    id: FAKE_EXTRACTOR_ID,
    adapterVersion: '1',
    modelId: 'fake-v1',
    promptVersion: 'fake-v1',
    billingProvider: 'fake',
    async extract({ signal } = {}) {
      attempts += 1;
      if (scenario === 'timeout' || (FAILS_ONCE[scenario] === EXTRACTOR_ERRORS.TIMEOUT && attempts === 1)) {
        await wait(Infinity, signal);
      }
      if (delayMs > 0) await wait(delayMs, signal);
      if (signal?.aborted) throw new CaptureExtractorError(EXTRACTOR_ERRORS.TIMEOUT);
      if (ALWAYS_FAILS.has(scenario)) throw new CaptureExtractorError(scenario);
      if (FAILS_ONCE[scenario] && attempts === 1) throw new CaptureExtractorError(FAILS_ONCE[scenario]);
      const read = READINGS[scenario] ?? fakeCardReading;
      return { reading: read(), usage: { inputTokens: null, outputTokens: null } };
    },
  };
}
