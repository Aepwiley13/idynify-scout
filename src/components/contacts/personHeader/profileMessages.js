/**
 * profileMessages — the words for the redesigned profile's editing: why a name was refused, why a save failed, why a
 * photo link was not accepted. The controllers (the hooks) say WHY in codes; PersonHeader draws whatever text it is
 * handed; this is where code becomes text, so the wording is in one place. Pure. Codes only, never contact data.
 */
const FIELD = Object.freeze({ name: 'name', title: 'title', organization: 'organization' });

const UNAVAILABLE = new Set(['unavailable', 'deadline-exceeded', 'network-request-failed', 'resource-exhausted']);
const NOT_ALLOWED = new Set(['permission-denied', 'unauthenticated']);
const NOT_NOW = new Set(['account_changed', 'read_only', 'no_user', 'invalid_write']);

function failure(code, what) {
  if (NOT_ALLOWED.has(code)) return "You don't have permission to change this contact.";
  if (UNAVAILABLE.has(code)) return `Couldn't save ${what}. Check your connection and try again.`;
  if (NOT_NOW.has(code)) return "Editing isn't available right now.";
  return `Couldn't save ${what}. Try again.`;
}

/** Why the open editor's text was refused (the identity hook's `problem.reason`). */
export function identityProblemMessage(problem) {
  if (problem?.reason === 'blank_name') return "Name can't be empty.";
  return 'Check this and try again.';
}

/** Why a save of name, title or organization failed (the identity hook's `error`). */
export function identityFailureMessage(error) {
  return failure(error?.code, `the ${FIELD[error?.field] ?? 'change'}`).replace('the the', 'the');
}

/** Why a photo link was not accepted (the photo hook's refused `reason`). */
export function photoRefusalMessage(reason) {
  switch (reason) {
    case 'blank': return 'Paste a link to a photo.';
    case 'not_https': return 'Use a link that starts with https://';
    case 'not_a_photo': return "That link doesn't look like a photo of a person.";
    case 'busy': return 'Still saving the last change. One moment.';
    case 'account_changed': case 'read_only': case 'no_user': return "Editing isn't available right now.";
    default: return "That photo can't be used.";
  }
}

/** Why saving a photo failed (the photo hook's `error`). */
export function photoFailureMessage(error) {
  return failure(error?.code, 'the photo');
}
