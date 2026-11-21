# Contact Hub staging acceptance

## Baseline and integration sequence

The frozen feature branch is `feature/contact-profile-header-h1` at
`83e72e3c`. Its exact parent baseline is
`317d908b` on `feature/contact-hub-workspace`, the head of
[PR #817](https://github.com/Aepwiley13/idynify-scout/pull/817).
The PR is open, unmerged and marked conflicting by GitHub. It contains 30
commits from common ancestor `a530b2a0`, covering the My People workspace,
Sticker Wall navigation and My Card storage, photo, branding and export.
The PR description still labels it a draft, while GitHub metadata reports
that it is no longer in draft status.

| Comparison | Result |
| --- | --- |
| Local `main` at `1c0ef3cc` | Ancestor of the feature branch, 115 commits behind it. |
| Locally cached `origin/main` at `cf17ee6a` | 24 commits unique to that ref and 58 unique to the feature branch. |
| [GitHub main at review time](https://github.com/Aepwiley13/idynify-scout/commit/424fa462b94beb5f1aa5bc6c358ea4ab14f0696a) | `424fa462`. GitHub reports 61 main-only commits and 30 PR-only commits since `a530b2a0`. The local feature branch adds another 28 commits after the PR head. |

The 28 commits above #817, oldest first within each stage:

| Stage | Commits |
| --- | --- |
| Header and sticker groundwork | `b163eb02`, `96ff9a59`, `49646758`, `e77cc25e`, `8afa9d8e`, `96621969`, `d77407d5`, `c7934d11`, `bc22817c`, `26d40eec` |
| Profile editing and sticker integration | `6e0b073a`, `c8b26229`, `e0210d14`, `10b4aa10`, `cd1b7e50`, `f11790a0`, `3a1ed666`, `9c3c6988`, `7a8ba271`, `38664308`, `dbe94bee` |
| Action Center and gated contact photos | `e108be9b`, `48b28e26`, `454c3fb4`, `f8676d79`, `3e91b173` |
| Manual Gmail and acceptance | `674d9a87`, `83e72e3c` |

After integration is authorized:

1. Record the current remote main SHA and #817 head. Start an isolated staging
   integration branch from that main SHA. Integrate and validate #817 first.
   If the PR has already landed by then, verify its equivalent changes are in
   the base and use them once.
2. Apply the ordered range `317d908b..83e72e3c` on top of the validated
   foundation. If #817's head changes, compare the revised foundation with
   `317d908b` before replaying the range. Preserve the accepted local branch
   as the reference for behavior.
3. Review shared files with their owners and run CI, the production build,
   the Firestore emulator suites, and the isolated browser captures before
   handing the candidate to staging QA. Record commit IDs, flags, project,
   and test results for the candidate. The review did not merge or rebase.

Remote-main file overlap below is based on changes since `a530b2a0`.
Overlap identifies review areas. It does not establish which individual
hunks will need manual resolution.

| Shared files | Review responsibility |
| --- | --- |
| `src/App.jsx`, `src/components/layout/MainLayout.jsx`, `src/components/layout/Sidebar.jsx` | Contact Hub and shell owners preserve main's signed-in/Free access and paid Barry gates alongside the PR's Contact Hub route, sidebar and mobile conventions. Verify desktop and mobile navigation with the flag both ways. |
| `src/pages/ContactHub/HubPeople.jsx`, `HubPerson.jsx`, `src/test/contactHubPage.test.jsx` | Contact Hub owner preserves main's Import placement and Scout opportunity behavior alongside the accepted profile, Action Center and scoped updates. Keep assertions for both. |
| `firestore.rules` | Firestore/security owner combines main's restrictions with #817's private My Card rules, existing Stickers guards and the photo-specific owner get, write exclusions and delete guard. Check every overlapping match against the combined rules. |
| `src/constants/contactHub.js`, `ContactHubMain.jsx`, `src/test/contactHubSwitch.test.js` | Contact Hub owner checks the #817-to-profile handoff for route constants, My Card defaults and providers. These are shared across the stack even where main has no file overlap. |

Dependencies already in the stack or main include the shell and verified
Free/Scout entitlement gates, Contact Hub routing and Import, the Stickers
rollout service and rules, My Card photo preparation and crop UI, the
existing notes/timeline/next-step model, and the shared Gmail formatter and
transport. Base QA can proceed with these dependencies once the integration candidate passes. Keep the existing
Scout and shell behavior intact during integration.

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
staging credential setup and a dedicated Google Cloud project and OAuth web client for Contact Hub, separate from Scout’s Google project.
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
| Frontend staging build | `VITE_CONTACT_HUB=on`, `VITE_SHELL_MIGRATION=on` or unset to use the enabled default, and `VITE_FIREBASE_PROJECT_ID=idynify-staging`. Add `VITE_CONTACT_HUB_GMAIL=on` at the connection-only gate. |
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
| Disconnect and revocation | The MVP has no dedicated disconnect action. An approved operator can revoke the dedicated Contact Hub grant through Google and remove the private connection through trusted staging cleanup. Google revocation alone leaves a local connected-looking record until an operation detects the invalid grant. Decide the supported account-level disconnect/revocation workflow before enrollment. Keep it scoped to the dedicated Google Cloud project. |
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

## Firestore, flags and staging order

- Validate the combined rules in the emulator first. Preserve My Card
  `users/{uid}/card/main` owner-only access and revision/field guards,
  Stickers registry and rollout restrictions, the contact timeline, and the
  existing impersonation protections. Use the My Card and Stickers rules
  suites and `scripts/rules-check/contact-photo.mjs` against the candidate.
  Verify direct SDK denials for cross-account access, private photo list/write,
  contact display marker forgery and all three top-level Gmail collections.
- Use the combined `firestore.indexes.json`. The photo branch adds a
  collection-group single-field exemption for `private.jpeg`. Preserve
  existing overrides and indexes. Gmail adds no committed index. Configure
  TTL on `contact_hub_gmail_oauth.expiresAt` before retaining test grants and
  verify the active impersonation query and UID cleanup query in staging.
  Keep send-ledger retention separate from OAuth TTL.
- With approval, apply the reviewed rules/indexes and candidate to
  `idynify-staging` only. Verify matching project IDs on the browser and
  functions and the intended database. Start with photo, Gmail and live sends
  off. Enable `VITE_CONTACT_HUB=on` for the base QA build. Profile, Action
  Center and My Card use this surface gate.
- Set `feature_flags/stickers.mode=beta` and
  `sticker_enrollment/{uid}.stage=beta` for dedicated Free and Scout QA users.
  Keep a non-enrolled user and test an impersonation session. Verify sidebar,
  mobile bar, Sticker Wall and rules agree with the `stickersConfig` answer.
  Use the existing [Stickers staging runbook](STICKERS_STAGING_RUNBOOK.md).
- Verify Gmail connection and status only after creating the isolated OAuth
  project/client and a documented operator cleanup route for test grants.
  Enable the Gmail browser and function gates together. Leave
  `CONTACT_HUB_GMAIL_SEND` off or unset throughout this QA.
- Leave `VITE_CONTACT_HUB_PHOTO_OVERRIDES` and `CONTACT_PHOTO_WRITES` off
  until all photo cleanup paths below pass. After separate approval, enable
  them together in isolated staging and run the physical-device gate.

## Photo deletion rollout gate

Storage is `users/{uid}/contacts/{contactId}/private/photo`. The trusted
writer reads the parent in its transaction and stores the override and
`contact_hub_photo` marker together. Client rules reject parent deletion
when that marker exists. An Admin SDK deletion bypasses the rules and can
leave a child behind. The emulator suite tests a guarded batch, atomic
cleanup and recursive purge, using fixtures rather than a real account
deletion workflow.

The repository review found no general individual, bulk, or account purge
entry point wired for Contact Hub. One concrete parent deletion path is
`undoApprovalSideEffects` in `src/services/companyDecision.js`. It loops
over auto-discovered contacts, after resetting company discovery fields.
Include this path with the company/contact owner before activating photos.
Confirm any off-repository operator or account deletion workflow with its
owner before treating the inventory as complete.

| Path | Smallest safe change and gate |
| --- | --- |
| Individual contact | Reuse the existing delete entry point and authorization once identified. In a trusted transaction, check the actor, account, deletion eligibility and exact contact path, then delete the parent and exact `private/photo` child together. Preserve existing archive and delete semantics and other subcollections. An absent private photo is safe to retry. Test save/delete races and access denial. |
| Bulk and automatic deletion | Reuse the same primitive in bounded, retryable chunks and preserve each caller's scope and failure reporting. For company approval Undo, recheck the contact's company/source and preserve its eligibility criteria. Test mixed contacts, partial failures and retry. Avoid partial success that leaves a private photo without a parent. |
| Account | Wire into the authoritative purge workflow, with writes fenced before cleanup. Use its trusted recursive deletion for the user subtree, or explicitly purge private photos if that workflow enumerates children. Verify actual account deletion, interrupted work, retries and absence of private photo documents. Preserve the established lifecycle for other account data. |

## Gmail disconnect and deletion rollout gate

- **Dedicated connection.** Use a separate Google Cloud project as well as a
  separate OAuth client. Google revocation applies across clients registered
  in the same project. A Contact Hub client in Scout's project would still
  risk revoking Scout access.
  [Google OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
- **Smallest disconnect.** Add one trusted account-scoped action using the
  existing session checks. Fence new sends and stale OAuth completions first.
  Revoke the dedicated refresh token server-side and remove local credentials
  once revocation is confirmed or the grant is already invalid. On transient
  errors, keep the connection unusable and retain credentials only in a
  server-only retryable state. Block reconnect completion until revocation
  settles, because revocation can affect a newly issued token in the same
  project. Check reconnect and disconnect concurrency so delayed work cannot
  remove a newer grant. Test with dedicated staging
  accounts while live sending stays off.
- **Legacy Scout connection.** Contact Hub may borrow the verified legacy
  connection. It must never revoke or delete the Scout integration document.
  A Contact Hub disconnect needs a credential-free account marker that
  suppresses legacy fallback until explicit reconnect. Otherwise deleting a
  dedicated connection could immediately make the account look connected to
  Scout again. Keep that marker in the private Contact Hub connection record.
- **Account deletion.** Fence account access and pending OAuth completion,
  revoke dedicated grants while credentials are still available, delete
  `contact_hub_gmail/{uid}` and the UID's pending OAuth state/completion
  records, then recursively delete `contact_hub_gmail_limits/{uid}` including
  attempts. Include abandoned OAuth completions containing tokens in the
  cleanup contract. Preserve the existing Scout lifecycle and verify retries
  without leaving recoverable credentials exposed or sending new mail.
- **Activity.** Disconnect retains existing sent-email timeline events and
  prior attempt records under the approved replay retention policy. Account
  or contact deletion follows the existing policy for its timeline. Keep
  connection cleanup separate from contact data.

One-time operator cleanup is sufficient for isolated connection-only QA on
disposable accounts. User-facing disconnect, revocation, retention and
authoritative account cleanup are prerequisites for enrolling real users.
Live delivery still requires separate approval and actual staging evidence.

## Unified Contact Hub acceptance and rollback

| Coverage | Acceptance evidence |
| --- | --- |
| Base workspace | Verified Free and Scout accounts, plus an enrolled and non-enrolled account and read-only/impersonation checks. Verify routing, My Card privacy/revision/export, My People add/import/search, Sticker Wall navigation/filter, and flags off. |
| Profile and Action Center | Identity and details edits, stickers add/remove/Undo/pending across navigation, Quick Capture, notes, reminder reschedule/complete/cancel, interaction logging, and shared Recent Activity/Activity. Confirm Free rule-based Barry and existing Scout gating. Reminders are in-app only. |
| Photo after deletion gate | Real persistence, reload, permission failures, hide/restore and provenance, concurrent replace/delete, and physical-device camera capture, return and cancel. Verify marker behavior on My People/cards and check desktop and mobile in light and dark. Lightweight custom thumbnails are future work. |
| Gmail with sending off | Dedicated accounts on the stable HTTPS staging host. Check OAuth consent, same-contact return, cancellation, replay and account switching. Verify disabled-send response and preserve the Scout integration. Use fixtures for send, retries, uncertainty, quota and Activity until live delivery is separately approved. |

Record the prior staging artifact, rules/index revision, OAuth setup and
flag values before any activation. If QA fails, disable the affected server
gate before switching back the client build. For Gmail, keep live sends off,
turn off `CONTACT_HUB_GMAIL` and rebuild without its browser flag if needed.
Use trusted cleanup for test grants and pending records. For photos, disable
new writes with `CONTACT_PHOTO_WRITES`; if the UI is rolled back, keep the
verified private-child rules, marker guard and cleanup in place while any
overrides remain. Reverting those rules or deleting markers first can expose
orphans or reopen direct parent deletion. Restore the previous Stickers
rollout mode or enrollment and use the prior staging artifact if the base
experience regresses. Preserve saved contacts, notes, Activity, original
photo provenance and Scout credentials during rollback.
