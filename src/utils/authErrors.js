/**
 * Turn a Firebase Auth failure into something a person and an operator can
 * both act on.
 *
 * Login.jsx used to collapse every non-MFA exception into one sentence:
 *
 *     setError('Invalid credentials. Please try again.');
 *
 * `auth/invalid-api-key`, `auth/user-not-found`, `auth/user-disabled`, a
 * password-policy rejection, a dead network and an actually wrong password all
 * rendered identically. The screen could not distinguish a fault the user can
 * fix from one only an operator can, and during the 2026-09-22 lockout it did
 * not: sign-in was routed to the wrong Firebase project for hours while the
 * only evidence anyone had was that sentence.
 *
 * Two outputs, because they serve different readers:
 *
 *   message    what went wrong, in words, for whoever is signing in.
 *   technical  code · projectId · key fingerprint, for whoever is debugging.
 *
 * ON THE FINGERPRINT — this is the part that matters, and it is not obvious.
 * Firebase Auth does not route by projectId. It routes by API KEY:
 *
 *     POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=…
 *
 * projectId steers Firestore and Storage; authDomain steers OAuth redirects.
 * Neither one steers sign-in. So a config holding project A's id and project
 * B's API key checks credentials against B's user database while displaying
 * A's name everywhere — which is exactly what happened, and why printing the
 * projectId alone was not enough to find it. The last five characters of the
 * key are enough to compare against the Firebase console at a glance, and a
 * Firebase web API key is public by construction (vite.config.js: "None of
 * these is secret"), so nothing is disclosed by showing them.
 */

/**
 * Codes that mean the person signing in can fix this themselves.
 *
 * `auth/invalid-credential` is the unified code modern SDKs return when email
 * enumeration protection is on: it deliberately merges "no such user" and
 * "wrong password" so the form cannot be used to discover which addresses have
 * accounts. We must not un-merge it in the copy.
 */
const USER_FIXABLE = new Map([
  ['auth/invalid-credential', 'That email and password don’t match an account.'],
  ['auth/invalid-login-credentials', 'That email and password don’t match an account.'],
  ['auth/wrong-password', 'That email and password don’t match an account.'],
  ['auth/user-not-found', 'That email and password don’t match an account.'],
  ['auth/invalid-email', 'That doesn’t look like a valid email address.'],
  ['auth/missing-password', 'Enter your password.'],
  ['auth/too-many-requests', 'Too many attempts. Wait a few minutes and try again.'],
  ['auth/network-request-failed', 'Connection problem — check your network and try again.'],
  ['auth/user-disabled', 'This account has been disabled. Contact support.'],
  ['auth/password-does-not-meet-requirements', 'Your password must be reset before you can sign in.'],
]);

/**
 * Codes that mean the deployment is wrong and no password will work.
 *
 * These are the ones worth naming as such on screen. Telling someone their
 * credentials are invalid when the build cannot reach its auth backend sends
 * them to reset a password that was never the problem.
 */
const OPERATOR_FIXABLE = new Set([
  'auth/invalid-api-key',
  'auth/api-key-not-valid',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
  'auth/configuration-not-found',
  'auth/project-not-found',
  'auth/operation-not-allowed',
  'auth/unauthorized-domain',
  'auth/invalid-app-id',
  'auth/app-not-authorized',
]);

const CONFIG_FAULT_MESSAGE =
  'Sign-in is misconfigured for this site — this is not your password. ' +
  'Please report the code below.';

/**
 * A short, comparable fingerprint of the API key actually in use.
 *
 * @param {string|undefined} apiKey
 * @returns {string}
 */
function fingerprint(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length < 5) return 'key ?';
  return `key …${apiKey.slice(-5)}`;
}

/**
 * @param {{code?: string}|null|undefined} error   the caught Firebase error
 * @param {{app?: {options?: object}}|null} authInstance  the Auth instance
 * @returns {{message: string, technical: string, isConfigFault: boolean}}
 */
export function describeAuthError(error, authInstance) {
  const code = typeof error?.code === 'string' ? error.code : 'unknown-error';
  const options = authInstance?.app?.options ?? {};
  const isConfigFault = OPERATOR_FIXABLE.has(code);

  const message =
    (isConfigFault ? CONFIG_FAULT_MESSAGE : USER_FIXABLE.get(code)) ??
    'Something went wrong signing you in. Please try again.';

  const technical = [
    code,
    options.projectId || 'no-project-id',
    fingerprint(options.apiKey),
  ].join(' · ');

  return { message, technical, isConfigFault };
}
