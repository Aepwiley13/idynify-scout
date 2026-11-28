/**
 * Connect Gmail — shared logic for gmail-oauth-init, gmail-oauth-callback and
 * gmail-disconnect (CH-GMAIL-001).
 *
 * Modelled on linkedinOAuth.js, which already does this for LinkedIn. The
 * Gmail flow used to send the caller's uid as the OAuth `state` and trust it
 * in the callback, so anyone who completed Google's consent screen with their
 * own mailbox and `state=<victim uid>` could attach that mailbox to someone
 * else's Idynify account, after which every email the victim sent from
 * Idynify went out through, and was readable in, the attacker's Gmail.
 *
 * STATE. `state` is 32 random bytes, single-use, valid for STATE_TTL_MS:
 *
 *   init      oauth_states/{sha256(state)} ← { provider:'gmail', uid,
 *             bindingHash, codeVerifier, returnTo, expiresAt }
 *             plus an HttpOnly __Host- cookie holding a second random value
 *             (the "binding"), so the state only works in the browser that
 *             asked for it.
 *   callback  one transaction reads the document and deletes it, then checks
 *             provider, expiry and the cookie. Missing, forged, reused,
 *             expired, other-provider and cross-browser states all fail, and
 *             a state can never be tried twice.
 *
 * The uid is read from the verified Firebase ID token at init, never from the
 * request body, and the callback takes it only from the stored state. Only the
 * hash of the state is stored. oauth_states is server-only in firestore.rules;
 * set a Firestore TTL policy on oauth_states.expiresAt to clean up abandoned
 * attempts (it is shared with Connect LinkedIn).
 *
 * PKCE. The authorization request carries an S256 code challenge and the
 * token exchange the matching verifier, so an intercepted code is useless
 * without the server-held verifier. This changes no scopes.
 *
 * SCOPES are unchanged (GMAIL_SCOPES). A user may untick permissions on
 * Google's consent screen; a grant without gmail.send is refused, because
 * every Gmail feature in Idynify needs it. A grant without gmail.readonly is
 * accepted: sending works, and reply sync already reports needs_reconnect.
 *
 * TOKENS stay server-side: they are written only through the Admin SDK and are
 * never returned in a response. integrations/gmail is now server-write-only in
 * firestore.rules (it was owner-writable). It is still owner-READABLE, because
 * eight client screens read its status fields; moving the tokens out of a
 * client-readable document is a follow-up, see docs/gmail/CH-GMAIL-001.md.
 *
 * Never log the code, state, binding, verifier, tokens or client secret.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
/** The scopes Idynify has always requested. Changing them needs approval. */
export const GMAIL_SCOPES = Object.freeze([GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, USERINFO_EMAIL_SCOPE]);

export const PROVIDER = 'gmail';
export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATES_COLLECTION = 'oauth_states';
export const BINDING_COOKIE = '__Host-idy_gmail_oauth';

/** Where the user lands when the connection was started without a returnTo. */
export const DEFAULT_RETURN_PATH = '/settings?tab=integrations';

/** Values of the `gmail=` query parameter the callback appends on return. */
export const OUTCOMES = Object.freeze({
  CONNECTED: 'connected',
  DENIED: 'denied',
  MISSING_CODE: 'missing_code',
  INVALID_STATE: 'invalid_state',
  EXPIRED_STATE: 'expired_state',
  TOKEN_FAILED: 'token_failed',
  MISSING_PERMISSION: 'missing_permission',
  IDENTITY_FAILED: 'identity_failed',
  NOT_CONFIGURED: 'not_configured',
  ERROR: 'error',
});

/** An expected failure, carrying the outcome the user is shown. */
export class GmailOAuthError extends Error {
  constructor(outcome, message) {
    super(message || outcome);
    this.name = 'GmailOAuthError';
    this.outcome = outcome;
  }
}

export function getGmailOAuthConfig(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GmailOAuthError(OUTCOMES.NOT_CONFIGURED, 'Google OAuth is not configured');
  }
  return { clientId, clientSecret, redirectUri };
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function codeChallengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function toMillis(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

// ─── Return path ─────────────────────────────────────────────────────────────

const PLACEHOLDER_ORIGIN = 'https://return.invalid';

/**
 * A same-site path to return to after Google, or DEFAULT_RETURN_PATH. Only a
 * relative path that stays on our own origin is kept: no scheme, no host, no
 * protocol-relative `//`, no backslash tricks, no control characters.
 */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return DEFAULT_RETURN_PATH;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return DEFAULT_RETURN_PATH;
  let url;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_RETURN_PATH;
  // Drop any outcome left over from a previous attempt.
  url.searchParams.delete('gmail');
  url.searchParams.delete('connected');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** returnTo with `gmail=<outcome>` (and `connected=true` on success) appended. */
export function returnLocation(returnTo, outcome) {
  const url = new URL(safeReturnPath(returnTo), PLACEHOLDER_ORIGIN);
  url.searchParams.set('gmail', outcome);
  if (outcome === OUTCOMES.CONNECTED) url.searchParams.set('connected', 'true');
  return `${url.pathname}${url.search}${url.hash}`;
}

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * Creates a single-use state for `uid`. Returns the raw state (sent to
 * Google), the binding (set as a cookie) and the PKCE code challenge. Only
 * hashes of state and binding are stored; the verifier never leaves the server.
 */
export async function createGmailOAuthState(db, { uid, returnTo, now = Date.now() }) {
  if (!uid) throw new Error('createGmailOAuthState requires a uid');
  const state = randomToken();
  const binding = randomToken();
  const codeVerifier = randomToken();
  await db.doc(`${STATES_COLLECTION}/${hashToken(state)}`).set({
    provider: PROVIDER,
    uid,
    bindingHash: hashToken(binding),
    codeVerifier,
    returnTo: safeReturnPath(returnTo),
    createdAt: new Date(now),
    expiresAt: new Date(now + STATE_TTL_MS),
  });
  return { state, binding, codeChallenge: codeChallengeFor(codeVerifier) };
}

/**
 * Validates and consumes a state in one transaction. The document is deleted
 * whatever the result, so a state is never accepted twice. Returns
 * { uid, codeVerifier, returnTo } or throws GmailOAuthError. A failure that
 * happens after the state was found still carries `returnTo`, so the user goes
 * back where they started.
 */
export async function consumeGmailOAuthState(db, { state, binding, now = Date.now() }) {
  if (!state || typeof state !== 'string' || state.length > 256) {
    throw new GmailOAuthError(OUTCOMES.INVALID_STATE, 'Missing state');
  }
  const ref = db.doc(`${STATES_COLLECTION}/${hashToken(state)}`);
  const record = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    return snap.data();
  });

  if (!record || record.provider !== PROVIDER || !record.uid || !record.codeVerifier) {
    throw new GmailOAuthError(OUTCOMES.INVALID_STATE, 'Unknown or already-used state');
  }
  const fail = (outcome, message) => Object.assign(new GmailOAuthError(outcome, message), { returnTo: record.returnTo });
  if (!(toMillis(record.expiresAt) > now)) throw fail(OUTCOMES.EXPIRED_STATE, 'State expired');
  if (!binding || !sameHash(hashToken(binding), record.bindingHash)) {
    throw fail(OUTCOMES.INVALID_STATE, 'State not issued to this browser');
  }
  return { uid: record.uid, codeVerifier: record.codeVerifier, returnTo: safeReturnPath(record.returnTo) };
}

// ─── Cookie ──────────────────────────────────────────────────────────────────

// __Host- requires Secure, Path=/ and no Domain. Lax still sends it on the
// top-level GET redirect back from accounts.google.com.
export function bindingCookie(binding) {
  return `${BINDING_COOKIE}=${binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}`;
}

export function clearBindingCookie() {
  return `${BINDING_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readBindingCookie(headers = {}) {
  const raw = headers.cookie || headers.Cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === BINDING_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

// ─── Caller identity ─────────────────────────────────────────────────────────

/**
 * The uid of the person making this request, from a verified Firebase ID
 * token. A body `userId`, when sent (older clients send it), must name the
 * same person: unlike verifyAuthToken.js there is NO admin pass-through here,
 * because connecting a mailbox to someone else's account is exactly the
 * attack this guards against. Custom-token sessions (impersonation) are
 * refused for the same reason. Returns { uid } or { status, error }.
 */
export async function authenticateOwner({ verifyIdToken, authToken, bodyUserId }) {
  if (!authToken) return { status: 401, error: 'Sign in to manage Gmail' };
  let decoded;
  try {
    decoded = await verifyIdToken(authToken);
  } catch {
    return { status: 401, error: 'Invalid authentication token' };
  }
  if (!decoded?.uid) return { status: 401, error: 'Invalid authentication token' };
  if (decoded.firebase?.sign_in_provider === 'custom') {
    return { status: 403, error: 'Gmail can only be managed by the account owner' };
  }
  if (bodyUserId !== undefined && bodyUserId !== null && bodyUserId !== decoded.uid) {
    return { status: 403, error: 'Unauthorized' };
  }
  return { uid: decoded.uid };
}

// ─── Grant checks ────────────────────────────────────────────────────────────

/** The scopes Google actually granted, as an array. */
export function grantedScopes(tokens) {
  return typeof tokens?.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [];
}

/**
 * Throws unless the token response is usable: an access token, a refresh
 * token, and gmail.send among the granted scopes. When Google omits `scope`
 * (it documents always returning it) the grant cannot be checked and is
 * refused rather than assumed.
 */
export function assertUsableGrant(tokens) {
  if (!tokens?.access_token) throw new GmailOAuthError(OUTCOMES.TOKEN_FAILED, 'No access token');
  if (!tokens.refresh_token) throw new GmailOAuthError(OUTCOMES.TOKEN_FAILED, 'No refresh token');
  if (!grantedScopes(tokens).includes(GMAIL_SEND_SCOPE)) {
    throw new GmailOAuthError(OUTCOMES.MISSING_PERMISSION, 'gmail.send was not granted');
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function integrationPath(uid) {
  return `users/${uid}/integrations/gmail`;
}

/**
 * The integration document for a fresh connection. Same fields the callback
 * has always written, so every sender and worker reads it unchanged. A full
 * set() (not merge) on purpose: a reconnect may be a different mailbox, and
 * the old mailbox's sync cursor and error state must not carry over.
 */
export function connectionDocument({ tokens, email, now = Date.now() }) {
  const at = new Date(now).toISOString();
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date || (now + 3600000),
    email,
    connectedAt: at,
    status: 'connected',
    scopes: grantedScopes(tokens),
    updatedAt: at,
  };
}

// ─── Refresh failures ────────────────────────────────────────────────────────

/**
 * True when Google says the grant itself is gone: revoked by the user,
 * expired (7-day limit for apps in Testing), or the password changed. A
 * network error or a 5xx is NOT this, and must not disconnect anyone.
 */
export function isRevokedGrant(err) {
  const data = err?.response?.data;
  const code = typeof data === 'object' ? data?.error : null;
  if (code === 'invalid_grant' || code === 'unauthorized_client') return true;
  return /invalid_grant/i.test(String(err?.message || ''));
}

/**
 * Call from a token-refresh catch block. When the grant is revoked, mark the
 * connection so every screen stops saying "Connected" and every worker stops
 * picking the account up. Transient failures change nothing. Never throws.
 */
export async function recordGmailRefreshFailure(gmailRef, err, now = Date.now()) {
  if (!gmailRef || !isRevokedGrant(err)) return false;
  try {
    const at = new Date(now).toISOString();
    await gmailRef.update({
      status: 'needs_reconnect',
      syncStatus: 'needs_reconnect',
      authError: 'revoked',
      authErrorAt: at,
      updatedAt: at,
    });
    return true;
  } catch (writeErr) {
    console.warn('[gmailOAuth] could not record revoked Gmail grant:', writeErr?.message);
    return false;
  }
}
