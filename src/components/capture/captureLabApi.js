/**
 * The Capture Lab's only two calls: is capture on for me (captureConfig), and
 * read this prepared photo (captureExtract). Both are read-only: nothing is
 * matched or saved, and neither touches contacts, companies or relationships.
 *
 * Always as the signed-in user themselves (auth.currentUser), never an
 * impersonated user: captureExtract accepts only the token's own user.
 */
import { auth } from '../../firebase/config';

const FUNCTIONS = '/.netlify/functions';

/** cap_ + a lower-case UUID v4, one per photo (architecture section 12). */
export function newOperationId() {
  return `cap_${crypto.randomUUID()}`;
}

async function post(name, body) {
  const user = auth.currentUser;
  if (!user) return { status: 401, body: { error: 'unauthorized' } };
  const token = await user.getIdToken();
  const response = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: user.uid, ...body }),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, body: payload };
}

/** { status, body: { enabled, stage, … } } */
export function fetchCaptureConfig() {
  return post('captureConfig', {});
}

/** { status, body: { operationId, extraction } | { error, reason?, retryable? }, ms } — ms is the whole round trip. */
export async function extractCard({ operationId, image }) {
  const startedAt = performance.now();
  try {
    const result = await post('captureExtract', { operationId, image });
    return { ...result, ms: Math.round(performance.now() - startedAt) };
  } catch {
    return { status: 0, body: { error: 'network', retryable: true }, ms: Math.round(performance.now() - startedAt) };
  }
}
