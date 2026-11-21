# Contact Hub staging acceptance

The approved Contact Profile and Action Center checkpoint is `454c3fb4`, `f8676d79`, and `3e91b173`. The manual Gmail MVP starts at `674d9a87`. The isolated browser review uses synthetic contacts and a simulated Gmail connection, delivery, and Firestore subscription. Live Gmail sending stays disabled.

## Isolated Gmail browser review

Start the existing profile fixture on the dedicated review port, then open
`http://127.0.0.1:5312/scripts/visual/contact-profile/profile.html?action=1&gmail_demo=1&theme=light`.
Use `theme=dark` for dark mode. The fixture starts disconnected in a fresh
browser session. Choose Email on Jordan, then Connect Gmail. The fixture
returns to Jordan with the composer open. The Google screen, provider
response, and persistence are simulated entirely locally.

```sh
node node_modules/vite/bin/vite.js --config scripts/visual/contact-profile/vite.config.mjs --configLoader runner --port 5312
node scripts/visual/contact-profile/capture.mjs /tmp/idynify-gmail-acceptance --gmail
```

Use **Next simulated send** before opening the composer to select a
recoverable rejection, uncertain delivery, or either quota response. The
selection is consumed by one simulated send. A recoverable rejection and both
quota responses preserve subject and body in the open composer. The user can
retry after a definite failure. The uncertain state disables sending, including
on reopening in the same tab, until the user checks Gmail Sent and acknowledges
the result. Acknowledgment clears the draft. Drafts live in memory and are
cleared on contact navigation, composer dismissal, reload, and a full OAuth
round trip.

Jordan's fixture has two saved addresses and a legacy address. The composer
displays and uses the first usable address in `emails[]` order, then falls
back to `email`, then `work_email`. Later addresses are visible through
Details as before. Manual sending in this MVP has one read-only recipient
and no address picker. The server requires a single supported ASCII mailbox
and verifies the displayed sender and recipient against the current records
at reservation. A changed address or connection requires reopening the
composer and reviewing the displayed address again.

## Exact staging configuration

Use the isolated Firebase project `idynify-staging`, a dedicated HTTPS
Netlify staging origin, synthetic saved contacts, two dedicated Gmail test
accounts, and dedicated IDYNIFY Free and Scout accounts. Use the existing
staging credential setup and a distinct OAuth web client for Contact Hub.
The actual staging hostname must come from the assigned Netlify site. Register
this exact URI after substituting that host, with no trailing slash:

```text
https://<assigned-staging-host>/.netlify/functions/contact-hub-gmail-callback
```

Use the same origin for initiating the connection and receiving the callback.
Use a stable host for consent testing so the registered callback and Secure
browser cookie stay aligned. A successful return goes to
`/contact-hub/person/{contactId}?compose=email&gmail_connection={oneTimeCode}`.
Cancellation after verified state returns to that contact with
`?compose=email&gmail=failed`. State or cookie mismatch returns to
`/contact-hub?gmail=failed`.

| Context | Settings |
| --- | --- |
| Frontend staging build | `VITE_CONTACT_HUB=on`, `VITE_CONTACT_HUB_GMAIL=on`, `VITE_FIREBASE_PROJECT_ID=idynify-staging` |
| Frontend Firebase configuration | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` from the staging web app |
| Staging Functions | `FIREBASE_PROJECT_ID=idynify-staging`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from the approved staging identity. For local staging QA only, ADC can use `FIREBASE_ADMIN_CREDENTIALS=application-default` without a private key |
| Gmail connection and status | `CONTACT_HUB_GMAIL=on` and `CONTACT_HUB_GMAIL_CLIENT_ID`, `CONTACT_HUB_GMAIL_CLIENT_SECRET`, `CONTACT_HUB_GMAIL_REDIRECT_URI` for the dedicated client |
| Live Gmail sending | Leave `CONTACT_HUB_GMAIL_SEND` unset or `off`. `on` is required in addition to the function gate and requires separate authorization |
| Existing Scout Gmail compatibility | In the isolated staging context, seed an existing integration through the approved Scout setup. Its original staging client uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Preserve existing Scout configuration |
| Photo | Leave `VITE_CONTACT_HUB_PHOTO_OVERRIDES` and `CONTACT_PHOTO_WRITES` off until trusted deletion cleanup is ready |

Enable Gmail API for the dedicated Google project. Configure Google OAuth
consent for dedicated test users with `https://www.googleapis.com/auth/gmail.send`
and `https://www.googleapis.com/auth/userinfo.email`. Confirm consent
publishing requirements and token lifetime for the chosen rollout audience.
Store OAuth secrets in function-scoped environment settings. Keep credentials,
tokens, OAuth callback queries and request bodies out of screenshots and logs.

## Security and lifecycle review

| Area | Verified behavior and rollout requirement |
| --- | --- |
| OAuth | Random state, a ten-minute expiry, PKCE, and a Secure HttpOnly SameSite=Lax cookie bind the initial callback. State is consumed in a transaction before code exchange. A separate one-time completion requires a fresh Firebase token for the original IDYNIFY account and contact. Verify expired state, cancellation, missing/mismatched cookie, replay, and account switch on actual HTTPS staging. |
| Tokens | New tokens are in server-only `contact_hub_gmail/{uid}`, with a short-lived copy in `contact_hub_gmail_oauth` until the one-time finish is consumed. The current rules have no client allow for either collection or the send ledger. Configure Firestore TTL on `contact_hub_gmail_oauth.expiresAt` for abandoned states and completions. Application expiry checks apply independently of TTL. Treat refresh tokens as secrets. Legacy Scout integration records are owner-writable, so the Contact Hub send path checks the token's actual verified Google identity before sending with a legacy connection. Verify that check with a dedicated staging legacy connection before using it. |
| Disconnect and revocation | The MVP has no dedicated disconnect action. An approved operator can revoke the dedicated Contact Hub grant through Google and remove the private connection through trusted staging cleanup. Google revocation alone leaves a local connected-looking record until an operation detects the invalid grant. Decide the supported account-level disconnect/revocation workflow before enrollment. Keep it scoped to the dedicated OAuth client. |
| Account deletion | Integrate trusted cleanup of the private connection, pending OAuth records owned by the UID, and recursive deletion of `contact_hub_gmail_limits/{uid}` including `attempts`. Revoke the dedicated OAuth grant while the token is still available. Test interrupted or retried cleanup and keep the existing Scout deletion lifecycle separate. |
| Authorization | The API checks a revocation-aware Firebase ID token, the caller's owner document, a saved contact in that user's data, and the absence of an active impersonation session. It rejects custom-token sessions. The client also checks the effective account and unmounts the draft on scope change. Verify real Free, Scout, read-only and impersonated sessions, including an attempted request sent directly to the function. |
| Duplicate sends | Reserving an ID and quota in a Firestore transaction prevents the same request ID from invoking the transport twice. The reservation binds contact, addresses and contents through a fingerprint. An interrupted or unknown attempt remains reserved, and the provider call disables automatic retry. This protects a request ID across retries. Separately initiated sends with fresh IDs are separate attempts. Keep attempt records for an approved replay protection window before considering TTL. |
| Activity | A confirmed Gmail response produces a deterministic timeline document and marks the attempt sent in one Firestore transaction. Recent Activity and Activity use the same entry. If the contact disappears or the timeline write fails after Google accepts the message, the UI can report sent with Activity unavailable. Gmail and Firestore cannot participate in one transaction. Verify one activity entry on success, no false entry on rejection, and unchanged Scout contact state. |
| Uncertain delivery | Gmail Sent is the manual reconciliation source. The send-only connection cannot reconcile the mailbox automatically. No automatic resend or Activity backfill occurs. If Gmail confirmed a send but the response was lost, a user may still see the uncertain warning. |
| Quotas | The server enforces five attempts per UTC minute and 30 per UTC day per IDYNIFY UID in the reservation transaction. Retries of the same reservation do not increment quotas. Fixed windows reset at UTC boundaries. Google may independently reject requests for provider quotas. Keep current defaults. Future configuration can use function-only environment variables, parsed at startup as strict positive integers with reviewed bounds and cross-validation, shared by every function instance. Start by allowing lower values only. Avoid client-controlled limits and changes in the middle of a verification window. No quota configuration change is needed for this checkpoint. |

### Staging gates

1. With live sending off, verify dedicated OAuth consent, return to the same
   contact, status, cancel, expiry, account switch, denied sessions, and the
   server-side disabled-send response. Use only synthetic contacts. Confirm both
   frontend and function projects resolve to `idynify-staging`.
2. Use the isolated fixture and automated service tests for send UX, retry,
   uncertainty, double submission, quota handling, and Activity. Check both
   sides of the quota window with fake time rather than sending test bursts.
3. After separate authorization only, use an isolated environment and
   dedicated sender and recipient inboxes to verify actual delivery, revoked or
   expired grants, and Activity consistency. Return the send switch to off.
   Never use customer addresses. Real delivery is pending.
4. Review the Gmail deletion, revocation and retention requirements before
   enrollment. Confirm no changes to Scout integration data or outreach state.

## Unified Contact Hub acceptance

- Inventory trusted individual, bulk, and account deletion paths and verify
  they remove `users/{uid}/contacts/{contactId}/private/photo`. Keep both photo
  flags off until all three paths are covered. Review concurrent replace/delete
  and retries, then verify no private photo documents remain after deletion.
- Following that gate, verify photo upload, crop, replace, hide and restore,
  original provenance, permissions and persistence across reload in real
  staging. Use a physical phone to test taking, returning from, and cancelling
  the camera. Current list surfaces use display markers and initials for
  custom or hidden photos. Future lightweight custom thumbnails belong in a
  separate pass.
- Exercise Contact Profile identity, details, stickers (including Undo and
  pending state), capture, notes, reminders, Activity and switching contacts
  under Free, Scout and read-only sessions. Use desktop and physical mobile
  in both themes. Reminders are in-app only.
