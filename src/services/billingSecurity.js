import { getToken } from 'firebase/app-check';
import { appCheck, auth } from '../firebase/config';

/** Firebase Auth identifies the account; optional App Check attests the first-party web app. */
export async function billingRequestHeaders(user = auth.currentUser) {
  if (!user?.getIdToken) throw new Error('sign_in_required');
  const headers = { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' };
  if (appCheck) {
    const attestation = await getToken(appCheck, false);
    if (!attestation?.token) throw new Error('app_check_unavailable');
    headers['X-Firebase-AppCheck'] = attestation.token;
  }
  return headers;
}
