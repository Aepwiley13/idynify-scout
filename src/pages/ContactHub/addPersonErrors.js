/**
 * What to tell someone when Add Person fails in Contact Hub.
 *
 * Pure: an error in, one sentence out. The full error is still written to the
 * developer console by the form; nothing here logs, and no message repeats
 * anything from the error itself (which can carry document paths or the
 * details that were typed).
 *
 * "Reload the page" is advice for exactly one situation: the browser's
 * database client has stopped working. Once that happens every later request
 * in the tab fails the same way, and only a reload gives the page a new
 * client. Telling someone to reload for a permission problem, a lost
 * connection or an ambiguous match would send them round in a circle.
 */

export const ADD_PERSON_ERROR = Object.freeze({
  CLIENT_UNHEALTHY: 'client_unhealthy',
  OFFLINE: 'offline',
  SIGNED_OUT: 'signed_out',
  NOT_ALLOWED: 'not_allowed',
  AMBIGUOUS_MATCH: 'ambiguous_match',
  UNKNOWN: 'unknown',
});

const MESSAGES = Object.freeze({
  [ADD_PERSON_ERROR.CLIENT_UNHEALTHY]:
    "This page lost its connection to your data, so this person wasn't added. Reload the page and try again.",
  [ADD_PERSON_ERROR.OFFLINE]:
    "Couldn't reach your data, so this person wasn't added. Check your internet connection and try again.",
  [ADD_PERSON_ERROR.SIGNED_OUT]:
    "You've been signed out, so this person wasn't added. Sign in again and try again.",
  [ADD_PERSON_ERROR.NOT_ALLOWED]:
    "This account isn't allowed to add people right now, so this person wasn't added.",
  [ADD_PERSON_ERROR.AMBIGUOUS_MATCH]:
    "More than one person in My People already has these details, so this person wasn't added. Search for them instead.",
  [ADD_PERSON_ERROR.UNKNOWN]:
    "Couldn't add this person. Please try again.",
});

/** Firestore error codes arrive as `unavailable` or `firestore/unavailable`. */
function codeOf(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
}

// The SDK's own wording for a client that can no longer be used: its internal
// queue failed ("INTERNAL ASSERTION FAILED", every later call), it was shut
// down, or its browser storage was taken away from it.
const UNHEALTHY = /INTERNAL ASSERTION FAILED|INTERNAL UNHANDLED ERROR|client has already been terminated|IndexedDB transaction|IndexedDbTransactionError|persistence lease/i;

export function classifyAddPersonError(error, { online = true } = {}) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = codeOf(error);

  if (error?.name === 'IdentityConflictError') return ADD_PERSON_ERROR.AMBIGUOUS_MATCH;
  if (UNHEALTHY.test(message)) return ADD_PERSON_ERROR.CLIENT_UNHEALTHY;
  if (code === 'unauthenticated') return ADD_PERSON_ERROR.SIGNED_OUT;
  if (code === 'permission-denied') return ADD_PERSON_ERROR.NOT_ALLOWED;
  if (code === 'unavailable' || code === 'deadline-exceeded' || online === false) return ADD_PERSON_ERROR.OFFLINE;
  return ADD_PERSON_ERROR.UNKNOWN;
}

export function addPersonErrorMessage(kind) {
  return MESSAGES[kind] ?? MESSAGES[ADD_PERSON_ERROR.UNKNOWN];
}

/** The form's `copy.describeError`. */
export function describeAddPersonError(error) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return addPersonErrorMessage(classifyAddPersonError(error, { online }));
}
