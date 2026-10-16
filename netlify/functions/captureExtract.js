/**
 * captureExtract — read one prepared card photo into a CardExtraction.
 *
 *   POST { userId, operationId, image }   Authorization: Bearer <Firebase ID token>
 *   200  { operationId, extraction }          a CardExtraction v1
 *   4xx/5xx { error, operationId?, reason?, retryable? }
 *
 * `image` is exactly a card-image/v1 (src/capture/preparedImage.js), checked
 * again here: shape, limits, real JPEG, dimensions, and any metadata stripped
 * before an extractor sees it. The extractor is whichever one this deploy
 * configures (utils/capture/extractors.js); this endpoint does not know or
 * care which.
 *
 * Read-only for the user's data: the only write is the values-free operation
 * record. Nothing is matched or saved. The image and the extraction are never
 * stored or logged; logs carry codes, counts, sizes and timings only.
 *
 * Order, so nothing is spent before it is allowed:
 *   1. method, body shape, operationId format
 *   2. the user themselves (an admin acting as another user is not honoured)
 *   3. the capture mode (captureFlags.js) for this user: anyone it does not
 *      cover gets 404
 *   4. the image, before an operation is created
 *   5. the extractor configuration
 *   6. the operation: created runs; extracted runs again without a
 *      transition (the response was lost and the extraction is not stored);
 *      any other state is a conflict
 *   7. the extraction, then created → extracted, or created → failed for a
 *      terminal error. Retryable errors leave the state unchanged.
 */
import process from 'node:process';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { checkSuperAdminAccess } from './utils/superAdminAuth.js';
import { resolveCaptureConfig, isEnrolled, captureMode } from './utils/captureFlags.js';
import {
  createOperation, transitionOperation, CaptureOperationError, OPERATION_ID_PATTERN, STATES, ERRORS as OPERATION_ERRORS,
} from './utils/captureOperations.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { checkPreparedImage, encodeBase64 } from '../../src/capture/preparedImage.js';
import { resolveExtractor } from './utils/capture/extractors.js';
import { runExtraction } from './utils/capture/orchestrator.js';
import { CaptureExtractorError, EXTRACTOR_ERRORS, RESPONSE_STATUS, isRetryable } from './utils/capture/errors.js';
import { captureLog } from './utils/capture/captureLog.js';

export const OPERATION = 'captureExtract';

const HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
});

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function respond(statusCode, payload) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(payload) };
}

/** An error response and its one log line. */
function failure(code, { operationId, reason, stage = 'request', log = {} } = {}) {
  const retryable = isRetryable(code);
  const status = RESPONSE_STATUS[code] ?? 500;
  captureLog(stage, { outcome: code, httpStatus: status, operationId, reason, retryable, ...log }, { level: status >= 500 ? 'error' : 'warn' });
  return respond(status, {
    error: code,
    ...(operationId ? { operationId } : {}),
    ...(reason ? { reason } : {}),
    ...(retryable ? { retryable: true } : {}),
  });
}

/** Admins and super admins, through the existing checks. */
async function isCaptureAdmin(uid) {
  return (await checkAdminAccess(uid)) || (await checkSuperAdminAccess(uid));
}

/** Move the operation on, tolerating a concurrent request that already did. */
async function transition(uid, operationId, to, patch) {
  try {
    await transitionOperation(db, { uid, operationId, to, patch });
    return null;
  } catch (error) {
    if (error instanceof CaptureOperationError) return error.code;
    throw error;
  }
}

export const handler = async (event) => {
  const startedAt = Date.now();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...HEADERS }, body: '' };
  if (event.httpMethod !== 'POST') return failure('method_not_allowed');

  let body;
  try {
    body = JSON.parse(event.body || '');
  } catch {
    return failure('invalid_request');
  }
  const { userId, operationId, image } = body ?? {};
  if (typeof userId !== 'string' || !USER_ID.test(userId)) return failure('invalid_request');
  if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) return failure('invalid_request');

  const authToken = extractAuthToken(event);
  if (!authToken) return failure('unauthorized', { operationId });
  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return failure('unauthorized', { operationId });
  }
  if (uid !== userId) return failure('forbidden', { operationId });

  let extractor;
  let operation;
  try {
    const config = await resolveCaptureConfig(uid, {
      env: process.env,
      isAdmin: isCaptureAdmin,
      enrolled: id => isEnrolled(db, id),
    });
    if (!config.enabled) return failure('capture_disabled', { operationId });

    const checked = checkPreparedImage(image);
    if (!checked.ok) return failure('image_rejected', { operationId, reason: checked.reason });
    // The extractor sees the stripped bytes, never metadata the client sent.
    const prepared = checked.metadataRemoved
      ? { ...image, data: encodeBase64(checked.bytes), bytes: checked.bytes.length }
      : image;
    const imageLog = {
      bytes: prepared.bytes, widthPx: image.widthPx, heightPx: image.heightPx, metadataRemoved: checked.metadataRemoved,
      warnings: image.preflight.warnings, userOverrode: image.preflight.userOverrode,
    };

    try {
      extractor = resolveExtractor(process.env);
    } catch (error) {
      const code = error instanceof CaptureExtractorError ? error.code : EXTRACTOR_ERRORS.CONFIG_ERROR;
      return failure(code, { operationId, stage: 'config', log: { captureMode: captureMode(process.env) } });
    }

    ({ operation } = await createOperation(db, { uid, operationId }));
    if (operation.state !== STATES.CREATED && operation.state !== STATES.EXTRACTED) {
      return failure('operation_conflict', { operationId, reason: operation.state, log: { state: operation.state } });
    }

    const result = await runExtraction({ extractor, image: prepared, operationId, startedAt });
    const provider = { providerId: extractor.id, adapterVersion: extractor.adapterVersion, modelId: result.modelId, promptVersion: extractor.promptVersion };
    const usageLog = { attempts: result.attempts, providerMs: result.providerMs, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
    const errorCode = result.ok ? (result.extraction.capture.status === 'no_text' ? 'no_text' : null) : result.code;

    await logApiUsage(uid, OPERATION, errorCode ? 'error' : 'success', {
      provider: extractor.billingProvider,
      model: result.modelId ?? undefined,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      responseTime: Date.now() - startedAt,
      errorCode: errorCode ?? undefined,
      metadata: { operationId, attempts: result.attempts, extractor: extractor.id, promptVersion: extractor.promptVersion },
    });

    const log = { ...provider, ...usageLog, ...imageLog, state: operation.state, detail: result.ok ? undefined : result.reason };
    if (errorCode) {
      if (isRetryable(errorCode)) {
        // The state is left as it is: the client retries with the same operationId.
        return failure(errorCode, { operationId, reason: result.reason, stage: 'extract', log });
      }
      // no_text, config_error and image_rejected end the operation; a retake
      // is a new one. A re-run of an extracted scan keeps its first result.
      if (operation.state === STATES.CREATED) {
        await transition(uid, operationId, STATES.FAILED, { errorCode });
      }
      const reason = errorCode === EXTRACTOR_ERRORS.IMAGE_REJECTED ? 'rejected_by_extractor' : undefined;
      return failure(errorCode, { operationId, reason, stage: 'extract', log });
    }

    const { extraction } = result;
    const { status, counts } = extraction.capture;
    if (operation.state === STATES.CREATED) {
      const conflict = await transition(uid, operationId, STATES.EXTRACTED, {
        extraction: {
          // The operation records only ok or partial; unreadable is a partial read.
          status: status === 'ok' ? 'ok' : 'partial',
          provider: extractor.id,
          model: result.modelId ?? 'none',
          promptVersion: extractor.promptVersion,
          ms: Math.min(result.providerMs, 600000),
          fieldCount: counts.fields,
        },
      });
      // A concurrent request for the same scan already moved it on: its answer and this one are the same scan.
      if (conflict && conflict !== OPERATION_ERRORS.INVALID_TRANSITION) {
        return failure('operation_conflict', { operationId, reason: conflict, stage: 'extract', log });
      }
    }

    captureLog('extract', {
      outcome: 'ok', httpStatus: 200, operationId, status, ...counts, validateMs: result.validateMs,
      totalMs: extraction.capture.timing.totalMs, ...log, previousState: operation.state,
    });
    return respond(200, { operationId, extraction });
  } catch (error) {
    captureLog('extract', { outcome: 'internal_error', httpStatus: 500, operationId, reason: error?.name ?? 'Error' }, { level: 'error' });
    return respond(500, { error: 'internal_error', operationId });
  }
};
