/**
 * One extraction: the configured extractor under a deadline, at most one
 * retry, then the shared checks and the CardExtraction.
 *
 *   - The whole run must finish inside DEADLINE_MS of the request starting
 *     (the function's own limit is 26 s; the rest is for Firestore and the
 *     response). Each attempt gets at most ATTEMPT_MS and is aborted when it
 *     runs out, whether or not the extractor honours the signal.
 *   - A retryable failure (timeout, rate limit, outage, network, or a reading
 *     that is not a well-formed card-reading/v1) is tried once more, only if
 *     at least MIN_RETRY_MS remain. config_error and image_rejected are never
 *     retried.
 *   - The reading is checked here, not trusted from the extractor, then
 *     assembled into a CardExtraction that must pass validateCardExtraction.
 *
 * Returns { ok: true, extraction, … } or { ok: false, code, reason, … }; never
 * throws for an extractor failure. `reason` is a path or a code, never a value.
 */
import { CaptureExtractorError, EXTRACTOR_ERRORS, isRetryable } from './errors.js';
import { validateCardReading } from './cardReading.js';
import { assembleExtraction } from './assembleExtraction.js';
import { EXTRACTOR_TOKEN } from './extractors.js';

export const DEADLINE_MS = 22_000;
export const ATTEMPT_MS = 12_000;
export const MIN_RETRY_MS = 5_000;
export const MAX_ATTEMPTS = 2;

/** One extract() call, rejected with timeout after `ms` and its signal aborted. */
async function attempt(extractor, input, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CaptureExtractorError(EXTRACTOR_ERRORS.TIMEOUT));
    }, ms);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => extractor.extract({ image: input, signal: controller.signal })),
      timeout,
    ]);
    return { ok: true, result };
  } catch (error) {
    // Anything that is not a mapped extractor error is an outage, by code only.
    if (error instanceof CaptureExtractorError) return { ok: false, code: error.code, usage: error.usage };
    return { ok: false, code: EXTRACTOR_ERRORS.UNAVAILABLE, usage: null };
  } finally {
    clearTimeout(timer);
  }
}

function addUsage(total, usage) {
  for (const key of ['inputTokens', 'outputTokens']) {
    const value = usage?.[key];
    if (Number.isInteger(value) && value >= 0) total[key] = (total[key] ?? 0) + value;
  }
}

/**
 * @param {object} args
 * @param {object} args.extractor   from resolveExtractor
 * @param {object} args.image       a checked card-image/v1
 * @param {string} args.operationId
 * @param {number} args.startedAt   when the request started (clock ms)
 * @param {() => number} [args.clock]
 * @param {object} [args.limits]    { deadlineMs, attemptMs, minRetryMs } for tests
 */
export async function runExtraction({ extractor, image, operationId, startedAt, clock = Date.now, limits = {} }) {
  const { deadlineMs = DEADLINE_MS, attemptMs = ATTEMPT_MS, minRetryMs = MIN_RETRY_MS } = limits;
  const deadline = startedAt + deadlineMs;
  const input = { mimeType: image.mimeType, data: image.data, widthPx: image.widthPx, heightPx: image.heightPx };
  const usage = { inputTokens: null, outputTokens: null };
  let attempts = 0;
  let providerMs = 0;
  let modelId = extractor.modelId;
  let reading = null;

  while (reading === null) {
    const budget = Math.min(attemptMs, deadline - clock());
    let code;
    let reason = null;
    if (budget <= 0) {
      code = EXTRACTOR_ERRORS.TIMEOUT;
    } else {
      attempts += 1;
      const t0 = clock();
      const outcome = await attempt(extractor, input, budget);
      providerMs += clock() - t0;
      if (outcome.ok) {
        addUsage(usage, outcome.result?.usage);
        const check = validateCardReading(outcome.result?.reading);
        if (check.ok) {
          reading = outcome.result.reading;
          if (EXTRACTOR_TOKEN.test(outcome.result.modelId ?? '')) modelId = outcome.result.modelId;
          break;
        }
        code = EXTRACTOR_ERRORS.INVALID_OUTPUT;
        reason = `reading:${check.path}`;
      } else {
        addUsage(usage, outcome.usage);
        code = outcome.code;
      }
    }
    const canRetry = isRetryable(code) && attempts > 0 && attempts < MAX_ATTEMPTS && deadline - clock() >= minRetryMs;
    if (!canRetry) return { ok: false, code, reason, attempts, providerMs, usage, modelId };
  }

  const v0 = clock();
  const assembled = assembleExtraction(reading, {
    operationId,
    extractedAt: new Date(clock()).toISOString(),
    image,
    provider: { id: extractor.id, adapterVersion: extractor.adapterVersion, modelId, promptVersion: extractor.promptVersion },
    timing: { providerMs },
    usage,
  });
  const validateMs = clock() - v0;
  if (!assembled.ok) {
    return { ok: false, code: EXTRACTOR_ERRORS.INVALID_OUTPUT, reason: assembled.errors[0], attempts, providerMs, usage, modelId };
  }
  const { extraction } = assembled;
  extraction.capture.timing.validateMs = validateMs;
  extraction.capture.timing.totalMs = clock() - startedAt;
  return { ok: true, extraction, attempts, providerMs, validateMs, usage, modelId };
}
