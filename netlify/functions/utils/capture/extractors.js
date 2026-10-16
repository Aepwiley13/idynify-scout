/**
 * The extractor registry. The endpoint runs "an extractor"; which one is a
 * server setting, never the client's choice.
 *
 *   CAPTURE_EXTRACTOR   the id of a registered extractor
 *                         claude-vision   Claude, vision + structured outputs
 *                                         (claudeVisionExtractor.js)
 *                         fake            the deterministic fake
 *                                         (fakeExtractor.js); internal mode
 *                                         only, never beta or on
 *                       Unset or unknown is a config_error: there is no
 *                       default extractor.
 *
 * THE EXTRACTOR INTERFACE
 * ──────────────────────
 * An extractor is a plain object:
 *
 *   {
 *     id:              'fake'      lower-case token, recorded on the operation
 *     adapterVersion:  '1'         bumped when the adapter's mapping changes
 *     modelId:         'fake-v1'   the configured model, or null
 *     promptVersion:   'fake-v1'   bumped when the prompt or schema changes
 *     billingProvider: 'fake'      the apiLogs provider (anthropic, google, …)
 *     extract({ image, signal }) → Promise<{ reading, usage, modelId? }>
 *   }
 *
 * extract() receives the prepared image as { mimeType, data (base64), widthPx,
 * heightPx } and an AbortSignal to pass to its network call. It resolves to a
 * card-reading/v1 (cardReading.js), token usage { inputTokens, outputTokens }
 * (nulls when it has none) and, when a different model served the call than
 * the one configured, that model's id. It throws only CaptureExtractorError
 * (errors.js): a code, never a message, response body or card text.
 *
 * Everything else — checking the reading, deciding confidence, deriving the
 * domain, building the CardExtraction — is shared and happens outside the
 * extractor, so adding one is only an adapter and a line in REGISTRY.
 */
import process from 'node:process';
import { CAPTURE_MODES, captureMode } from '../captureFlags.js';
import { CaptureExtractorError, EXTRACTOR_ERRORS } from './errors.js';
import { createFakeExtractor } from './fakeExtractor.js';
import { createClaudeVisionExtractor } from './claudeVisionExtractor.js';

/** The same token format the operation record accepts. */
export const EXTRACTOR_TOKEN = /^[a-z0-9][a-z0-9._:/-]{0,63}$/;

/** id → factory(env). */
const REGISTRY = Object.freeze({
  'claude-vision': createClaudeVisionExtractor,
  fake: createFakeExtractor,
});

/** Extractors that never serve real users, and the modes they may run in. */
const TEST_ONLY = new Set(['fake']);
const TEST_MODES = new Set([CAPTURE_MODES.INTERNAL]);

export const EXTRACTOR_IDS = Object.freeze(Object.keys(REGISTRY));

const isToken = v => typeof v === 'string' && EXTRACTOR_TOKEN.test(v);

/** Does `extractor` have the interface the endpoint relies on? */
export function isExtractor(extractor) {
  return extractor !== null && typeof extractor === 'object'
    && ['id', 'adapterVersion', 'promptVersion', 'billingProvider'].every(k => isToken(extractor[k]))
    && (extractor.modelId === null || isToken(extractor.modelId))
    && typeof extractor.extract === 'function';
}

/**
 * The extractor this deploy is configured to use. Throws
 * CaptureExtractorError('config_error') when none is configured, the id is
 * unknown, a test extractor is selected outside internal mode, or the adapter
 * cannot be built (a missing key, say).
 */
export function resolveExtractor(env = process.env, registry = REGISTRY) {
  const id = env.CAPTURE_EXTRACTOR;
  const configError = () => new CaptureExtractorError(EXTRACTOR_ERRORS.CONFIG_ERROR);
  if (typeof id !== 'string' || !Object.hasOwn(registry, id)) throw configError();
  if (TEST_ONLY.has(id) && !TEST_MODES.has(captureMode(env))) throw configError();
  let extractor;
  try {
    extractor = registry[id](env);
  } catch {
    throw configError();
  }
  if (!isExtractor(extractor) || extractor.id !== id) throw configError();
  return extractor;
}
