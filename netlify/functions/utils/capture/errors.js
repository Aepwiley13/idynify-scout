/**
 * The extraction endpoint's error vocabulary (architecture sections 10 and 23).
 *
 * An extractor's own errors are mapped to these codes inside its adapter, so
 * the endpoint and the app never see a vendor's error shape. Retryable errors
 * leave the operation's state unchanged: the client retries with the same
 * operationId and the same prepared image. Terminal ones end the operation;
 * a retake is a new operation.
 */

/** Errors an extractor may raise. */
export const EXTRACTOR_ERRORS = Object.freeze({
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable',
  INVALID_OUTPUT: 'invalid_output',
  NETWORK: 'network',
  CONFIG_ERROR: 'config_error',
  IMAGE_REJECTED: 'image_rejected',
});

const KNOWN = new Set(Object.values(EXTRACTOR_ERRORS));

const RETRYABLE = Object.freeze(new Set([
  EXTRACTOR_ERRORS.TIMEOUT, EXTRACTOR_ERRORS.RATE_LIMITED, EXTRACTOR_ERRORS.UNAVAILABLE,
  EXTRACTOR_ERRORS.INVALID_OUTPUT, EXTRACTOR_ERRORS.NETWORK,
]));

/** Every code the endpoint can answer with, and its HTTP status. */
export const RESPONSE_STATUS = Object.freeze({
  method_not_allowed: 405,
  invalid_request: 400,
  image_rejected: 400,
  unauthorized: 401,
  forbidden: 403,
  capture_disabled: 404,
  operation_conflict: 409,
  no_text: 422,
  rate_limited: 429,
  internal_error: 500,
  invalid_output: 502,
  network: 502,
  unavailable: 503,
  config_error: 503,
  timeout: 504,
});

const tokenCount = v => (Number.isInteger(v) && v >= 0 ? v : null);

/** A diagnostic code such as http_529, refusal or max_tokens: lower-case, no spaces, short. */
const DETAIL = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;

/**
 * An extractor failure. `code` is one of EXTRACTOR_ERRORS (anything else
 * becomes unavailable). Besides the code it carries only token counts, for a
 * call that was billed before it failed, and an optional diagnostic `detail`
 * code for logs (anything that is not code-shaped is dropped): never a
 * vendor's message or response body, so neither can reach a log or a response.
 */
export class CaptureExtractorError extends Error {
  constructor(code, { usage, detail } = {}) {
    const known = KNOWN.has(code) ? code : EXTRACTOR_ERRORS.UNAVAILABLE;
    super(known);
    this.name = 'CaptureExtractorError';
    this.code = known;
    this.usage = { inputTokens: tokenCount(usage?.inputTokens), outputTokens: tokenCount(usage?.outputTokens) };
    this.detail = typeof detail === 'string' && DETAIL.test(detail) ? detail : null;
  }

  get retryable() {
    return RETRYABLE.has(this.code);
  }
}

export function isRetryable(code) {
  return RETRYABLE.has(code);
}
