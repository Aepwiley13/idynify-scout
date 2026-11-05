/**
 * stickersConfig, from the browser (ADR-007).
 *
 * Always as the signed-in user themselves (auth.currentUser). The answer only
 * decides what the app shows; firestore.rules decide every sticker write.
 */
import { auth } from '../../firebase/config';

/** { status, body: { enabled, mode, readOnly } | { error } } */
export async function fetchStickersConfig() {
  const user = auth.currentUser;
  if (!user) return { status: 401, body: { error: 'unauthorized' } };
  const token = await user.getIdToken();
  const response = await fetch('/.netlify/functions/stickersConfig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: user.uid }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
