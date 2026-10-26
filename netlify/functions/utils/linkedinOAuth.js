/**
 * Connect LinkedIn — shared logic for linkedin-oauth-init, -callback and
 * linkedin-disconnect.
 *
 * Sign In with LinkedIn using OpenID Connect, scopes `openid profile email`
 * only. This links a user's OWN LinkedIn identity to their Idynify account.
 * It is not a login method and imports nothing from their network.
 *
 * STATE. Unlike gmail-oauth-init, `state` is NOT the user's uid. It is 32
 * random bytes, single-use, valid for STATE_TTL_MS:
 *
 *   init      oauth_states/{sha256(state)} ← { uid, nonce, bindingHash, expiresAt }
 *             plus an HttpOnly cookie holding a second random value (the
 *             "binding"), so the state only works in the browser that asked
 *             for it — a link with a valid state sent to someone else fails.
 *   callback  one transaction reads the doc and deletes it, then checks
 *             expiry and the cookie. Missing, reused, expired or mismatched
 *             all fail, and the state can never be tried twice.
 *
 * Only the hash of the state is stored, so a read of oauth_states does not
 * yield a usable value. Set a Firestore TTL policy on oauth_states.expiresAt
 * so abandoned attempts are cleaned up.
 *
 * TOKENS ARE NOT STORED. The access token is used once, server-side, to read
 * the member's identity, and discarded. Nothing in this milestone calls
 * LinkedIn again; when something does, it should add token storage then.
 *
 * ONE LINKEDIN ACCOUNT, ONE IDYNIFY USER. linkedin_member_claims/{sha256(sub)}
 * records which user holds each LinkedIn member id. A second user connecting
 * the same LinkedIn account is refused while the first still has it.
 *
 * oauth_states, linkedin_member_claims and users/{uid}/integrations/linkedin
 * are written only here, through the Admin SDK (see firestore.rules).
 *
 * Never log the code, state, binding, nonce, tokens or client secret.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
export const LINKEDIN_ISSUER = 'https://www.linkedin.com/oauth';
export const LINKEDIN_SCOPES = ['openid', 'profile', 'email'];

export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATES_COLLECTION = 'oauth_states';
export const CLAIMS_COLLECTION = 'linkedin_member_claims';
export const BINDING_COOKIE = '__Host-idy_linkedin_oauth';

/** Where the callback sends the user, with `linkedin=<outcome>` appended. */
export const RETURN_PATH = '/settings?tab=integrations';

/**
 * Outcomes the callback reports back to the app. The Settings page maps each
 * to a message (src/components/settings/linkedinOutcomeMessages.js).
 */
export const OUTCOMES = Object.freeze({
  CONNECTED: 'connected',
  DENIED: 'denied',
  MISSING_CODE: 'missing_code',
  INVALID_STATE: 'invalid_state',
  EXPIRED_STATE: 'expired_state',
  TOKEN_FAILED: 'token_failed',
  IDENTITY_FAILED: 'identity_failed',
  ALREADY_CONNECTED: 'already_connected',
  NOT_CONFIGURED: 'not_configured',
  ERROR: 'error',
});

/** An expected failure, carrying the outcome the user is shown. */
export class LinkedInOAuthError extends Error {
  constructor(outcome, message) {
    super(message || outcome);
    this.name = 'LinkedInOAuthError';
    this.outcome = outcome;
  }
}

export function getLinkedInConfig(env = process.env) {
  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = env.LINKEDIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new LinkedInOAuthError(OUTCOMES.NOT_CONFIGURED, 'LinkedIn OAuth is not configured');
  }
  return { clientId, clientSecret, redirectUri };
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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

export function buildAuthorizationUrl({ clientId, redirectUri, state, nonce }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(' '),
    nonce,
  });
  return `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}`;
}

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * Creates a single-use state for `uid`. Returns the raw state (sent to
 * LinkedIn), the nonce (sent to LinkedIn, echoed in the ID token) and the
 * binding (set as a cookie). Only hashes of state and binding are stored.
 */
export async function createOAuthState(db, { uid, now = Date.now() }) {
  if (!uid) throw new Error('createOAuthState requires a uid');
  const state = randomToken();
  const nonce = randomToken();
  const binding = randomToken();
  await db.doc(`${STATES_COLLECTION}/${hashToken(state)}`).set({
    provider: 'linkedin',
    uid,
    nonce,
    bindingHash: hashToken(binding),
    createdAt: new Date(now),
    expiresAt: new Date(now + STATE_TTL_MS),
  });
  return { state, nonce, binding };
}

/**
 * Validates and consumes a state in one transaction. The document is deleted
 * whatever the result, so a state is never accepted twice. Returns
 * { uid, nonce } or throws LinkedInOAuthError (INVALID_STATE / EXPIRED_STATE).
 */
export async function consumeOAuthState(db, { state, binding, now = Date.now() }) {
  if (!state || typeof state !== 'string') {
    throw new LinkedInOAuthError(OUTCOMES.INVALID_STATE, 'Missing state');
  }
  const ref = db.doc(`${STATES_COLLECTION}/${hashToken(state)}`);
  const record = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    return snap.data();
  });

  if (!record || record.provider !== 'linkedin' || !record.uid) {
    throw new LinkedInOAuthError(OUTCOMES.INVALID_STATE, 'Unknown or already-used state');
  }
  if (!(toMillis(record.expiresAt) > now)) {
    throw new LinkedInOAuthError(OUTCOMES.EXPIRED_STATE, 'State expired');
  }
  if (!binding || !sameHash(hashToken(binding), record.bindingHash)) {
    throw new LinkedInOAuthError(OUTCOMES.INVALID_STATE, 'State not issued to this browser');
  }
  return { uid: record.uid, nonce: record.nonce };
}

// ─── Cookie ──────────────────────────────────────────────────────────────────

// __Host- requires Secure, Path=/ and no Domain: the cookie cannot be set or
// read by any other host. Lax still sends it on the top-level GET redirect
// back from linkedin.com.
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

// ─── LinkedIn calls ──────────────────────────────────────────────────────────

export async function exchangeCodeForTokens({ code, config, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });
  } catch {
    throw new LinkedInOAuthError(OUTCOMES.TOKEN_FAILED, 'Token request failed');
  }
  if (!res.ok) {
    throw new LinkedInOAuthError(OUTCOMES.TOKEN_FAILED, `Token endpoint returned ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!body.access_token || !body.id_token) {
    throw new LinkedInOAuthError(OUTCOMES.TOKEN_FAILED, 'Token response missing access_token or id_token');
  }
  return body;
}

export function decodeIdTokenClaims(idToken) {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, 'Malformed ID token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, 'Unreadable ID token');
  }
}

/**
 * Checks the ID token's claims. Its signature is not verified: it came
 * straight from LinkedIn's token endpoint over TLS, authenticated by our
 * client secret, which OpenID Connect Core §3.1.3.7 accepts in place of a
 * signature check.
 *
 * The nonce is checked when LinkedIn echoes it; LinkedIn's documentation does
 * not promise that it does, and the single-use, browser-bound state already
 * ties the code to this attempt. A nonce that is present and different fails.
 */
export function validateIdTokenClaims(claims, { clientId, nonce, now = Date.now() }) {
  const fail = (why) => { throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, why); };
  if (claims.iss !== LINKEDIN_ISSUER) fail('Unexpected issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) fail('ID token not issued to this app');
  if (!(typeof claims.exp === 'number' && claims.exp * 1000 > now)) fail('ID token expired');
  if (claims.nonce !== undefined && claims.nonce !== nonce) fail('Nonce mismatch');
  if (!claims.sub) fail('ID token has no subject');
  return claims;
}

export async function fetchUserInfo({ accessToken, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(LINKEDIN_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, 'Userinfo request failed');
  }
  if (!res.ok) throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, `Userinfo returned ${res.status}`);
  const info = await res.json().catch(() => null);
  if (!info?.sub) throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, 'Userinfo has no subject');
  return info;
}

// LinkedIn sends email_verified as a boolean in userinfo and as a string in
// the ID token; accept either.
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** Token exchange → ID token checks → userinfo, which must name the same member. */
export async function resolveLinkedInIdentity({ code, nonce, config, fetchImpl = fetch, now = Date.now() }) {
  const tokens = await exchangeCodeForTokens({ code, config, fetchImpl });
  const claims = validateIdTokenClaims(decodeIdTokenClaims(tokens.id_token), { clientId: config.clientId, nonce, now });
  const info = await fetchUserInfo({ accessToken: tokens.access_token, fetchImpl });
  if (info.sub !== claims.sub) {
    throw new LinkedInOAuthError(OUTCOMES.IDENTITY_FAILED, 'Userinfo subject does not match ID token');
  }
  return {
    sub: claims.sub,
    name: info.name || [info.given_name, info.family_name].filter(Boolean).join(' ') || null,
    givenName: info.given_name || null,
    familyName: info.family_name || null,
    email: info.email || null,
    emailVerified: parseBoolean(info.email_verified),
    pictureUrl: info.picture || null,
    locale: info.locale || null,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function integrationPath(uid) {
  return `users/${uid}/integrations/linkedin`;
}

function claimPath(sub) {
  return `${CLAIMS_COLLECTION}/${hashToken(sub)}`;
}

/**
 * Saves the connection for `uid`. Refuses (ALREADY_CONNECTED) when another
 * user holds this LinkedIn account; a claim whose holder has since
 * disconnected is stale and is taken over. Reconnecting with a different
 * LinkedIn account releases the old one. Writes nothing to the user's
 * Idynify profile.
 */
export async function saveLinkedInIntegration(db, { uid, identity, now = Date.now() }) {
  const at = new Date(now).toISOString();
  const integrationRef = db.doc(integrationPath(uid));
  const claimRef = db.doc(claimPath(identity.sub));

  await db.runTransaction(async (tx) => {
    // Admin SDK transactions: every read before any write.
    const [claimSnap, currentSnap] = await Promise.all([tx.get(claimRef), tx.get(integrationRef)]);
    const claim = claimSnap.exists ? claimSnap.data() : null;
    const current = currentSnap.exists ? currentSnap.data() : null;

    let holderSnap = null;
    if (claim?.uid && claim.uid !== uid) holderSnap = await tx.get(db.doc(integrationPath(claim.uid)));
    let previousClaimSnap = null;
    const previousSub = current?.status === 'connected' ? current.linkedinMemberId : null;
    if (previousSub && previousSub !== identity.sub) previousClaimSnap = await tx.get(db.doc(claimPath(previousSub)));

    if (holderSnap?.exists) {
      const holder = holderSnap.data();
      if (holder.status === 'connected' && holder.linkedinMemberId === identity.sub) {
        throw new LinkedInOAuthError(OUTCOMES.ALREADY_CONNECTED, 'LinkedIn account is connected to another user');
      }
    }

    if (previousClaimSnap?.exists && previousClaimSnap.data().uid === uid) tx.delete(previousClaimSnap.ref);
    tx.set(claimRef, { uid, provider: 'linkedin', claimedAt: at });
    tx.set(integrationRef, {
      provider: 'linkedin',
      status: 'connected',
      linkedinMemberId: identity.sub,
      name: identity.name,
      givenName: identity.givenName,
      familyName: identity.familyName,
      email: identity.email,
      emailVerified: identity.emailVerified,
      pictureUrl: identity.pictureUrl,
      locale: identity.locale,
      scopes: [...LINKEDIN_SCOPES],
      connectedAt: at,
      lastSyncedAt: at,
      updatedAt: at,
    });
  });
}

/** Removes the connection and releases the LinkedIn account's claim. */
export async function disconnectLinkedIn(db, { uid }) {
  const integrationRef = db.doc(integrationPath(uid));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(integrationRef);
    if (!snap.exists) return;
    const sub = snap.data().linkedinMemberId;
    const claimSnap = sub ? await tx.get(db.doc(claimPath(sub))) : null;
    if (claimSnap?.exists && claimSnap.data().uid === uid) tx.delete(claimSnap.ref);
    tx.delete(integrationRef);
  });
}
