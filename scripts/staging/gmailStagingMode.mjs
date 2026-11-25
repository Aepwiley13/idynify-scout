/**
 * STAGING ONLY: the rules for letting Gmail OAuth into a staging run (CH-GMAIL-001.2).
 *
 * Staging normally holds no Google OAuth key at all (stagingPreflight.mjs, I5). Gmail runtime QA
 * (connect, send, disconnect, reconnect) needs a real Google OAuth client. A Gmail run (--gmail)
 * allows exactly that, the same way --billing allows Stripe test mode:
 *
 *   - only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI. Every other
 *     integration stays empty, including Calendar and the separate Contact Hub Gmail client;
 *   - the Firebase project is exactly idynify-staging;
 *   - the client is a DEDICATED staging client. A Google client id begins with the number of the
 *     Google Cloud project that owns it, and a Firebase project's messagingSenderId is that same
 *     project number. So the client must be owned by the staging Firebase project's own Cloud
 *     project (its number must equal VITE_FIREBASE_MESSAGING_SENDER_ID);
 *   - the production client is ruled out explicitly as well. PRODUCTION_GOOGLE_CLIENT_ID (a
 *     public value, visible in any production consent URL) must be given in the shell, and the
 *     staging client must differ from it in both id and project. Missing or malformed, the run
 *     is refused: fail closed when the two cannot be told apart;
 *   - the callback is exactly STAGING_GMAIL_REDIRECT_URI, so Google returns to this launcher;
 *   - inbox ingestion and scheduled reply sync stay off.
 *
 * Pure: no network, no file access, never a value in a message.
 */

export const STAGING_GMAIL_PROJECT = 'idynify-staging';
export const STAGING_GMAIL_REDIRECT_URI = 'http://localhost:8888/.netlify/functions/gmail-oauth-callback';

/** The only variables a Gmail run adds to what staging allows. */
export const GMAIL_STAGING_KEYS = Object.freeze(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);

/** The shell variable naming production's OAuth client, so it can be ruled out. */
export const PRODUCTION_CLIENT_VARIABLE = 'PRODUCTION_GOOGLE_CLIENT_ID';

/**
 * Gmail-related variables a Gmail run must NOT carry, beyond the integration keys every staging
 * run already refuses: Contact Hub's separate Gmail client and the ingestion and reply-sync
 * switches. (GOOGLE_CALENDAR_REDIRECT_URI is already in INTEGRATION_KEYS.)
 */
export const GMAIL_RUN_FORBIDDEN = Object.freeze([
  'CONTACT_HUB_GMAIL', 'CONTACT_HUB_GMAIL_SEND', 'CONTACT_HUB_GMAIL_CLIENT_ID',
  'CONTACT_HUB_GMAIL_CLIENT_SECRET', 'CONTACT_HUB_GMAIL_REDIRECT_URI',
  'GMAIL_REPLY_SYNC_ENABLED', 'GMAIL_REPLY_SYNC_USER_ALLOWLIST',
]);

/** Shell variables a Gmail run's app never inherits (stagingDev.mjs). */
export const dropFromShellForGmail = (name) => GMAIL_RUN_FORBIDDEN.includes(name)
  || name === 'GMAIL_IDENTITY_MODE' || name === PRODUCTION_CLIENT_VARIABLE;

const CLIENT_ID = /^(\d{6,})-[a-z0-9]{8,}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^GOCSPX-[A-Za-z0-9_-]{20,}$/;

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/** The Google Cloud project number that owns a client id, or null when it is not one. */
export function clientProjectNumber(clientId) {
  const m = typeof clientId === 'string' ? CLIENT_ID.exec(clientId.trim()) : null;
  return m ? m[1] : null;
}

/** [{ id, ok, message }] for a Gmail run. Pure. */
export function checkGmailStagingMode(env, { productionClientId = null } = {}) {
  const results = [];
  const add = (id, ok, message) => results.push({ id, ok, message });

  const project = env.VITE_FIREBASE_PROJECT_ID ?? '';
  add('gmail-project', project === STAGING_GMAIL_PROJECT,
    project === STAGING_GMAIL_PROJECT ? `The project is ${STAGING_GMAIL_PROJECT}.`
      : `A Gmail run must use the ${STAGING_GMAIL_PROJECT} Firebase project.`);

  const missing = GMAIL_STAGING_KEYS.filter((k) => !filled(env[k]));
  add('gmail-config', missing.length === 0,
    missing.length ? `Missing for a Gmail run: ${missing.join(', ')}.` : 'The staging Google OAuth client is set.');

  const redirectOk = env.GOOGLE_REDIRECT_URI === STAGING_GMAIL_REDIRECT_URI;
  add('gmail-redirect-uri', redirectOk,
    redirectOk ? 'GOOGLE_REDIRECT_URI is the staging callback.'
      : `GOOGLE_REDIRECT_URI must be exactly ${STAGING_GMAIL_REDIRECT_URI}.`);

  const stagingNumber = clientProjectNumber(env.GOOGLE_CLIENT_ID);
  add('gmail-client-id', stagingNumber !== null,
    stagingNumber !== null ? 'GOOGLE_CLIENT_ID is a Google OAuth client id.'
      : 'GOOGLE_CLIENT_ID must be a Google OAuth web client id (<project number>-<id>.apps.googleusercontent.com).');

  const senderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '';
  const dedicated = stagingNumber !== null && /^\d+$/.test(senderId) && stagingNumber === senderId;
  add('gmail-dedicated-client', dedicated,
    dedicated ? `The OAuth client belongs to the ${project || 'staging'} Google Cloud project.`
      : 'GOOGLE_CLIENT_ID must be a client created in the staging project\'s own Google Cloud project '
        + '(its number must equal VITE_FIREBASE_MESSAGING_SENDER_ID). Create one: docs/gmail/STAGING_GMAIL_OAUTH_CLIENT.md.');

  const productionNumber = clientProjectNumber(productionClientId);
  let distinct;
  let message;
  if (!filled(productionClientId)) {
    distinct = false;
    message = `Set ${PRODUCTION_CLIENT_VARIABLE} in the shell so the production client can be ruled out.`;
  } else if (productionNumber === null) {
    distinct = false;
    message = `${PRODUCTION_CLIENT_VARIABLE} is not a Google OAuth client id, so the production client cannot be ruled out.`;
  } else if (filled(env.GOOGLE_CLIENT_ID) && env.GOOGLE_CLIENT_ID.trim() === productionClientId.trim()) {
    distinct = false;
    message = 'GOOGLE_CLIENT_ID is the PRODUCTION OAuth client. Use the dedicated staging client.';
  } else if (stagingNumber !== null && stagingNumber === productionNumber) {
    distinct = false;
    message = 'GOOGLE_CLIENT_ID belongs to the production Google Cloud project. Use a client created in the staging project.';
  } else if (stagingNumber === null) {
    distinct = false;
    message = 'GOOGLE_CLIENT_ID cannot be compared with the production client.';
  } else {
    distinct = true;
    message = 'Not the production OAuth client, and not from the production Google Cloud project.';
  }
  add('gmail-not-production-client', distinct, message);

  const secret = env.GOOGLE_CLIENT_SECRET ?? '';
  const secretOk = CLIENT_SECRET.test(secret) && secret !== env.GOOGLE_CLIENT_ID;
  add('gmail-client-secret', secretOk,
    secretOk ? 'GOOGLE_CLIENT_SECRET looks like a Google client secret.'
      : 'GOOGLE_CLIENT_SECRET must be the staging client\'s secret (GOCSPX-…).');

  const forbidden = GMAIL_RUN_FORBIDDEN.filter((k) => filled(env[k]));
  const mode = env.GMAIL_IDENTITY_MODE;
  if (filled(mode) && mode !== 'dry_run') forbidden.push('GMAIL_IDENTITY_MODE (only dry_run or unset)');
  add('gmail-ingestion-off', forbidden.length === 0,
    forbidden.length ? `Leave these unset for a Gmail run: ${forbidden.join(', ')}.`
      : 'Inbox ingestion, reply sync and the Contact Hub Gmail client are off.');

  return results;
}
