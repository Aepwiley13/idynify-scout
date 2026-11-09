/**
 * Should the functions use Application Default Credentials instead of the
 * service-account key?
 *
 * Only for local staging QA with short-lived credentials, such as gcloud
 * impersonating a staging service account (docs/contact-hub/STICKERS_STAGING_SETUP.md):
 * FIREBASE_ADMIN_CREDENTIALS=application-default. Unset (every deployed
 * context), firebase-admin.js runs its original key-based initialization,
 * unchanged.
 *
 * Set together with a private key, or to any other value, it throws at cold
 * start, so the two modes can never be mixed by accident.
 */
export const ADC_MODE = 'application-default';

export function wantsApplicationDefaultCredentials(env) {
  const mode = env.FIREBASE_ADMIN_CREDENTIALS;
  if (mode === undefined || mode === '') return false;
  if (mode !== ADC_MODE) {
    throw new Error(`FIREBASE_ADMIN_CREDENTIALS must be "${ADC_MODE}" or unset.`);
  }
  if (env.FIREBASE_PRIVATE_KEY) {
    throw new Error(`Set FIREBASE_ADMIN_CREDENTIALS=${ADC_MODE} or FIREBASE_PRIVATE_KEY, not both.`);
  }
  return true;
}
