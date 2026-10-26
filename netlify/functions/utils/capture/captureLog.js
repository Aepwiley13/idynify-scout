/**
 * The one way capture code logs (architecture section 19).
 *
 * Every capture module logs through captureLog, and a test fails the build if
 * one calls console directly. Keys not on the allowlist are dropped, strings
 * are truncated to 64 characters, and only codes, counts, durations, sizes
 * and versions survive: never an image, base64, name, email, phone, title,
 * company, address, OCR text or extracted value. The user ID is not logged
 * either: the operationId and the apiLogs row link a line to its user.
 */

const ALLOWED = Object.freeze(new Set([
  'operationId', 'outcome', 'stage', 'httpStatus', 'errorCode', 'reason', 'detail', 'retryable', 'state', 'previousState',
  'providerId', 'adapterVersion', 'modelId', 'promptVersion', 'attempts',
  'providerMs', 'validateMs', 'totalMs', 'prepMs',
  'inputTokens', 'outputTokens',
  'bytes', 'widthPx', 'heightPx', 'metadataRemoved', 'warnings', 'userOverrode',
  'status', 'fields', 'confirmed', 'likely', 'possible',
  'captureMode',
  'candidates', 'sources',
]));

const MAX_STRING = 64;
const CODE = /^[a-z0-9][a-z0-9_.:/-]*$/i;

function clean(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  // Arrays only of short code strings (preflight warning codes).
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && CODE.test(v)).slice(0, 10).map(v => v.slice(0, MAX_STRING));
  return undefined;
}

/** The fields that would be logged, after the allowlist. Exported for tests. */
export function captureLogFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    const cleaned = clean(value);
    if (cleaned !== undefined && cleaned !== null) out[key] = cleaned;
  }
  return out;
}

/** One structured JSON line per stage. */
export function captureLog(stage, fields = {}, { level = 'info' } = {}) {
  const line = JSON.stringify({ evt: 'capture', stage: String(stage).slice(0, MAX_STRING), ...captureLogFields(fields) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}
