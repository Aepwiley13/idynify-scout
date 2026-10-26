/**
 * The capture calls. The Capture Lab makes only the first two; Scan Business
 * Card in Scout+ makes all three:
 *   captureConfig     is capture on for me
 *   captureExtract    read this prepared photo
 *   captureLinkedIn   likely LinkedIn profiles for a person just saved
 * All three are read-only: none of them saves, matches or changes a contact,
 * company or relationship.
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

/**
 * Likely LinkedIn profiles for a person: { status, body: { candidates } |
 * { error, reason? } }. `person` is { name, company, title, domain, email,
 * location }, from the saved contact.
 */
export async function findLinkedInProfiles(person) {
  try {
    return await post('captureLinkedIn', { person });
  } catch {
    return { status: 0, body: { error: 'network' } };
  }
}
