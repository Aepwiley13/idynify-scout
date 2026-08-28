/**
 * resolveWho.js — the WHO half of the Barry First Experience.
 *
 * WHO is the lightest possible baseline: who is Barry talking to. It is not a
 * profile, and it is never a gate. A user who never gives a name reaches every
 * First Value branch exactly as one who does.
 *
 * Resolution order, in priority:
 *   1. Authenticated display identity — `auth.currentUser.displayName`.
 *      Today this is effectively never populated: signup is email/password
 *      only, nothing calls `updateProfile`, and there is no social sign-in
 *      anywhere in the app. It is first in the order because it becomes real
 *      the moment social sign-in lands, and nothing downstream should have to
 *      change then. It must not be relied on now.
 *   2. A name already stored on the user document — including one Barry
 *      acquired conversationally in an earlier session.
 *   3. Nothing. `null` is a valid, permanent answer.
 *
 * There is deliberately no signup field, no WHO screen, and no completion
 * state. Barry asks once, in conversation, and continues either way.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const WHO_FROM_AUTH = 'auth-display-name';
export const WHO_FROM_STORED = 'stored';
export const WHO_UNKNOWN = 'unknown';

/** Trim, and treat a whitespace-only or non-string value as absent. */
function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const NAME_INTROS = [
  /^i'm\s+/i,
  /^im\s+/i,
  /^i am\s+/i,
  /^my name is\s+/i,
  /^my name's\s+/i,
  /^the name is\s+/i,
  /^the name's\s+/i,
  /^call me\s+/i,
  /^you can call me\s+/i,
  /^just call me\s+/i,
  /^they call me\s+/i,
  /^people call me\s+/i,
  /^i go by\s+/i,
  /^it's\s+/i,
  /^its\s+/i,
];

export function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  let name = raw.trim();
  name = name.replace(/^(?:hi|hey|hello|yo)[,.\s]+/i, '');
  for (const pattern of NAME_INTROS) {
    const stripped = name.replace(pattern, '');
    if (stripped !== name) {
      name = stripped;
      break;
    }
  }
  name = name.replace(/[.!,]+$/, '').trim();
  return name || null;
}

/**
 * A display name is only useful if it reads like a name. An email address in
 * the displayName slot ("dana@example.com") would have Barry greet someone by
 * their inbox, which is worse than not greeting them at all.
 */
function looksLikeAName(value) {
  if (!value) return false;
  if (value.includes('@')) return false;
  return true;
}

/**
 * Resolve who Barry is talking to.
 *
 * @param {Object|null} authUser - Firebase auth user (or the impersonated one)
 * @param {Object|null} userData - the users/{uid} document
 * @returns {{ name: string|null, source: string, shouldAsk: boolean }}
 *   `shouldAsk` is true only when no name is known. It is a cue for one
 *   conversational turn — never a blocker, and never a reason to withhold
 *   First Value.
 */
export function resolveWho(authUser, userData) {
  const fromAuth = clean(authUser?.displayName);
  if (looksLikeAName(fromAuth)) {
    return { name: fromAuth, source: WHO_FROM_AUTH, shouldAsk: false };
  }

  const fromStored =
    clean(userData?.firstName) ||
    clean(userData?.displayName) ||
    clean(userData?.name);
  if (looksLikeAName(fromStored)) {
    return { name: fromStored, source: WHO_FROM_STORED, shouldAsk: false };
  }

  return { name: null, source: WHO_UNKNOWN, shouldAsk: true };
}

/** The one question Barry asks, at most once, in conversation. */
export const WHO_PROMPT = 'What should I call you?';

/**
 * Persist a conversationally acquired name.
 *
 * User-scoped intelligence on the user document — not RECON, not an ICP. A
 * failed write must never interrupt the conversation, so this resolves either
 * way and reports what happened.
 *
 * @returns {Promise<boolean>} true when the name was stored
 */
export async function rememberName(userId, rawName) {
  const name = clean(rawName);
  if (!userId || !looksLikeAName(name)) return false;

  try {
    await setDoc(doc(db, 'users', userId), { firstName: name }, { merge: true });
    return true;
  } catch (err) {
    console.warn('[resolveWho] could not store the name (continuing):', err.message);
    return false;
  }
}
