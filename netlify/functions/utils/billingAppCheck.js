import process from 'node:process';
import { getAppCheck } from 'firebase-admin/app-check';

const APP_CHECK_HEADER = 'x-firebase-appcheck';

/** Optional during rollout; enforcement is enabled only with BILLING_APPCHECK_REQUIRED=on. */
export async function verifyBillingAppCheck(event, {
  required = process.env.BILLING_APPCHECK_REQUIRED === 'on',
  verifyToken = (token) => getAppCheck().verifyToken(token),
} = {}) {
  if (!required) return true;
  const headers = event.headers ?? {};
  const token = Object.entries(headers).find(([name]) => name.toLowerCase() === APP_CHECK_HEADER)?.[1];
  if (typeof token !== 'string' || !token) return false;
  try {
    await verifyToken(token);
    return true;
  } catch {
    return false;
  }
}
