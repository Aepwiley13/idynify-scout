# CH-GMAIL-001 — Secure & stabilize the Gmail connection

Scope: the shared Gmail connection (`gmail-oauth-init`, `gmail-oauth-callback`,
`gmail-disconnect`, `users/{uid}/integrations/gmail`) that Scout, Hunter, bulk
send, cadences and Barry's reply card all send through. Contact Hub's own
send-only connection (`contact-hub-gmail*`, `contact_hub_gmail/{uid}`) already
used single-use, browser-bound state with PKCE and is unchanged.

No OAuth scopes changed. No feature flags changed. Inbox ingestion stays off.

## What was wrong

| # | Issue | Severity |
|---|---|---|
| 1 | `state` was the user's uid and the callback trusted it (`state = "<uid>\|<returnTo>"`). Anyone could finish Google's consent with their own mailbox and `state=<victim uid>`, attaching that mailbox to the victim's account. The victim's Idynify email would then go out from, and be readable in, the attacker's Gmail. No expiry, no single use, no browser binding. | Critical |
| 2 | `users/{uid}/integrations/gmail` (tokens, connection state) was owner-**writable** in `firestore.rules`. A client could forge `status`, `email` or tokens. | High |
| 3 | The callback rendered an HTML error page that reflected `error.message` and an unescaped `returnTo`. | Medium |
| 4 | A revoked or expired Google grant was never recorded. Every send failed with "reconnect", but the connection still read **Connected** everywhere, and the sync workers kept retrying it. | Medium (status accuracy) |
| 5 | Every connection returned to `/hunter`, a paid page. A Free (Contact Hub) user connecting from Settings landed on the upgrade wall. | Medium (Free access) |
| 6 | A grant without `gmail.send` (the user unticked it on Google's screen) was saved as connected. | Low |
| 7 | init and disconnect verified the ID token through the Identity Toolkit REST API, which needs `FIREBASE_API_KEY` at function runtime, unlike the Admin SDK path the LinkedIn flow uses. | Low |

## What changed

* **`netlify/functions/utils/gmailOAuth.js`** (new), modelled on `linkedinOAuth.js`:
  * 32-byte random `state`, stored only as `oauth_states/{sha256(state)}` with
    `provider: 'gmail'`, the uid, a 10-minute expiry, the PKCE verifier and
    the sanitized `returnTo`.
  * A `__Host-idy_gmail_oauth` HttpOnly, Secure, SameSite=Lax cookie binds the
    attempt to the browser that started it.
  * The callback consumes the state in one transaction (read + delete). It is
    refused when missing, forged, reused, expired, issued to another provider,
    or presented without the matching cookie.
  * PKCE (S256) on the authorization request and token exchange.
  * A grant without `gmail.send`, a refresh token or a verified email is refused.
  * `authenticateOwner`: the uid comes from a verified ID token only. A body
    `userId` must match it (no admin pass-through), and custom-token
    (impersonation) sessions are refused.
  * `recordGmailRefreshFailure`: on `invalid_grant` only, sets
    `status: 'needs_reconnect'`, `syncStatus: 'needs_reconnect'`,
    `authError: 'revoked'`. Network errors and 5xx change nothing.
* **init / callback / disconnect** rewritten on that module and the Admin SDK.
  The callback always redirects to the sanitized same-site `returnTo` with
  `gmail=<outcome>` (and `connected=true` on success). It never renders a page.
* **Every token-refresh site** (gmail-send, -send-quick, -send-wave, -get-thread,
  -poll-replies, check-replies, barry-approve-send, process-scheduled-engagements
  ×2, gmailMessageService.getOAuthClient) calls `recordGmailRefreshFailure`
  in its existing catch. No other line of those files changed.
* **`firestore.rules`**: `integrations/gmail` is server-write-only, like
  `integrations/linkedin`. The owner can still read it for status. No client
  code wrote it.
* **Client**: `src/utils/gmailConnect.js` is the one caller of
  `gmail-oauth-init`. Settings, Hunter, the cadence page and
  `GmailConnectButton` use it and come back to where they started. Settings
  shows **Reconnect needed** for a revoked grant and a message for each
  failed outcome. `deriveSyncHealth` reports `needs_reconnect` for it.

## Existing connections

Untouched. Tokens stay where they are, with the same fields, and nothing is
migrated. The only thing that breaks is an OAuth attempt that is in flight
when this deploys (its state is the old uid-style value): the user sees
"not valid for this browser" and clicks Connect again.

## Deploy notes

1. **Host match.** The binding cookie is `__Host-`, so `GOOGLE_REDIRECT_URI`
   must be on the same host the user starts from. init logs a warning when the
   two differ. The same constraint already applies to Connect LinkedIn. Deploy
   previews whose `GOOGLE_REDIRECT_URI` points at production can't complete a
   connection (they couldn't before either, because they landed on production).
2. **TTL.** Abandoned attempts stay in `oauth_states` until a Firestore TTL
   policy on `oauth_states.expiresAt` removes them (shared with LinkedIn). An
   expired state is refused regardless.
3. Deploy `firestore.rules` with the functions.

## Not done here (follow-ups)

* **Tokens are still in a client-readable document.** The owner's browser can
  read `accessToken`/`refreshToken` (no other user can), so an XSS in the app
  could exfiltrate them. Moving them to a server-only document touches every
  sender plus a migration. Recommended next.
* **Disconnect does not revoke the grant at Google.** A Google grant is per
  (Google account, OAuth client), so two Idynify accounts on one mailbox share
  it, and revoking from one would disconnect the other. Decide whether one
  mailbox may belong to only one Idynify account (as LinkedIn enforces). Then
  revoking on disconnect becomes safe.
* **Barry chat's Gmail and Calendar actions never work** (pre-existing):
  `barryActions.getOAuthClient` reads `access_token`/`refresh_token`, but both
  integration docs store `accessToken`/`refreshToken`, so it always throws
  `*_not_connected`. Not fixed here, because fixing it would switch on a send
  path that bypasses thread tracking and `email_logs`.
* A Gmail API 401 after revocation, before the access token's own expiry, is
  reported as a send failure but does not flip the status until the next refresh.
* Google Cloud OAuth verification status for the restricted `gmail.readonly`
  scope is unconfirmed: a launch dependency.
