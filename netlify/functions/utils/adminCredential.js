/**
 * The Admin SDK app options for the Netlify functions.
 *
 * Default (production and every deployed context, unchanged): the service
 * account in FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.
 *
 * FIREBASE_ADMIN_CREDENTIALS=application-default: Application Default
 * Credentials instead, for local staging QA with short-lived credentials,
 * such as gcloud impersonating a staging service account
 * (docs/contact-hub/STICKERS_STAGING_SETUP.md). No private key exists in
 * that mode.
 *
 * Nothing deployed sets this variable. Setting it together with a private
 * key, or to any other value, throws at cold start, so the two modes can
 * never be mixed by accident.
 */
export const ADC_MODE = 'application-default';

/**
 * @param {object} env                       process.env
 * @param {object} sdk
 * @param {Function} sdk.cert                firebase-admin/app cert
 * @param {Function} sdk.applicationDefault  firebase-admin/app applicationDefault
 * @param {string} sdk.projectId             requireProjectId()
 */
export function adminAppOptions(env, { cert, applicationDefault, projectId }) {
  const mode = env.FIREBASE_ADMIN_CREDENTIALS;
  if (mode === undefined || mode === '') {
    const privateKey = env.FIREBASE_PRIVATE_KEY
      ? env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;
    return {
      credential: cert({
        projectId,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    };
  }
  if (mode !== ADC_MODE) {
    throw new Error(`FIREBASE_ADMIN_CREDENTIALS must be "${ADC_MODE}" or unset.`);
  }
  if (env.FIREBASE_PRIVATE_KEY) {
    throw new Error(`Set FIREBASE_ADMIN_CREDENTIALS=${ADC_MODE} or FIREBASE_PRIVATE_KEY, not both.`);
  }
  return { credential: applicationDefault(), projectId };
}
