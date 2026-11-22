# Contact Hub staging acceptance

## Local integration candidate

Use `integration/contact-hub-unified-qa` in
`/tmp/idynify-contact-hub-integration`. The development branch is preserved
at documentation commit `af3c2522`, and `recovery/contact-hub-83e72e3c`
pins the accepted implementation.

| Checkpoint | Commit |
| --- | --- |
| GitHub main reverified for integration | `424fa462b94beb5f1aa5bc6c358ea4ab14f0696a` |
| PR #817 head reverified | `317d908b9f1118209624be36d5ff0c89710a41cf` |
| Foundation merge | `a747cf7ed9dd07e2f8d43a2368a6c22eb4d6be44` |
| Completed feature stack merge | `1b39eb46938a7158aa2e588f56ea828c49a7a8d4` |

The foundation resolution retained the current main credit-write guards,
added My Card's private rules, kept Import on My People, and combined shell
entity navigation with the existing Scout opportunity panel. The stack
resolution kept main's authoritative Free-plan route gate, combined the
paid Barry shell check with Contact Hub's route/account check, kept the
Scout opportunity below the new header, and preserved both the main and
photo guards in overlapping Firestore grants. The local test adjustments
verify the current profile and combined rules. Sticker-tab state uses
a membership-only patch from the existing sticker service boundary.

For the candidate, set `VITE_FREE_PLAN=existing` to admit verified existing
Free accounts without opening new signups. The existing `on` mode also
allows new Free signup and needs its own authorization. Keep the shell
migration enabled. For rollback, retain the approved Free mode and a build
that provides the Free Contact Hub route so existing Free users can still
reach their contacts.

### Browser review of the merged routes

From the candidate worktree:

```sh
node node_modules/vite/bin/vite.js --config scripts/visual/contact-profile/vite.config.mjs --configLoader runner --port 5313
CONTACT_HUB_FIXTURE_PORT=5313 node scripts/visual/contact-profile/capture.mjs /tmp/idynify-hub-integrated-browser --workspace
```

Start at
`http://127.0.0.1:5313/scripts/visual/contact-profile/profile.html?workspace=1`.
Append `&scout=1` or `&readonly=1` to switch the synthetic session.
This mode renders the candidate's My People, Sticker Wall, My Card and
person routes with local memory fixtures. The navigation strip belongs
to the fixture. Shell route access is covered independently by regression
tests. For the simulated Gmail composer, open the same page with
`?action=1&gmail_demo=1`. Using `--action` or `--gmail` with
`CONTACT_HUB_FIXTURE_PORT=5313` runs the component browser regressions on
this worktree. The workspace smoke makes no requests to remote APIs.

Local QA covers the merged workspace in Free, Scout and read-only modes,
the focused regression suite, and a test-mode build using synthetic Firebase
configuration. The emulator uses loopback and demo project IDs. It covers
general rules, sticker rules and service behavior, flag parity, write
semantics, My Card, private photo invariants, and client denials for all
Contact Hub Gmail collections. Targeted lint introduced no new findings.
The inherited lint findings are 43 in `src/App.jsx` and four in
`src/components/contacts/IdentityCard.jsx`.

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
| Frontend staging build | `VITE_CONTACT_HUB=on`, `VITE_FREE_PLAN=existing` for already provisioned Free accounts, `VITE_SHELL_MIGRATION=on` or unset to use the enabled default, and `VITE_FIREBASE_PROJECT_ID=idynify-staging`. Add `VITE_CONTACT_HUB_GMAIL=on` at the connection-only gate. |
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
| Tokens | New tokens are in server-only `contact_hub_gmail/{uid}`, with a short-lived copy in `contact_hub_gmail_oauth` until the one-time finish is consumed. The current rules have no client allow for either collection or the send ledger. Configure Firestore TTL on `contact_hub_gmail_oauth.expiresAt` for abandoned states and completions. Application expiry checks apply independently of TTL. Treat refresh tokens as secrets. Contact Hub only reads its dedicated grant. Verify that a Scout-only grant reports disconnected in Contact Hub and that disconnect preserves Scout access. |
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
  suites, `scripts/rules-check/contact-photo.mjs`, and
  `scripts/rules-check/contact-hub-gmail.mjs` against the candidate.
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

The follow-on checkpoint adds gated individual and selected-bulk deletion.
An authoritative account purge remains open. Another parent deletion path is
`undoApprovalSideEffects` in `src/services/companyDecision.js`. It loops
over auto-discovered contacts, after resetting company discovery fields.
The trusted Undo action now rechecks the company state and contact source,
then removes a marked contact and its private photo in one transaction.
Verify it against an approved staging fixture before activating photos.
Confirm any off-repository operator or account deletion workflow with its
owner before treating the inventory as complete.

| Path | Smallest safe change and gate |
| --- | --- |
| Individual contact | The trusted endpoint verifies the owner and deletes the contact, photo, and enumerated children in one transaction. The local emulator covers a concurrent photo save and rejects post-delete client timeline writes. Confirm real staging persistence and permissions after approval. |
| Bulk and automatic deletion | Selected deletion uses one transaction per explicit ID with individual outcomes. Company approval Undo uses its own company/source eligibility checks. Verify real staging partial outcomes and retries. |
| Account | Wire into the authoritative purge workflow, with writes fenced before cleanup. Use its trusted recursive deletion for the user subtree, or explicitly purge private photos if that workflow enumerates children. Verify actual account deletion, interrupted work, retries and absence of private photo documents. Preserve the established lifecycle for other account data. |

## Gmail disconnect and deletion rollout gate

- **Dedicated connection.** Use a separate Google Cloud project as well as a
  separate OAuth client. Google revocation applies across clients registered
  in the same project. A Contact Hub client in Scout's project would still
  risk revoking Scout access.
  [Google OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
- **Disconnect.** The owner-authenticated action blocks new sends and stale
  OAuth completions before attempting revocation. A transient failure leaves
  the dedicated grant unusable and retryable. Success leaves a credential-free
  generation marker. Verify a timed-out revocation, retry, reconnect, and
  existing Sent and Activity history using dedicated staging accounts.
- **Scout isolation.** Contact Hub requires its own grant and has no fallback
  to the Scout integration. A Scout inbox remains connected when Contact Hub
  disconnects. The runtime rejects reuse of the configured Scout client ID.
  Independently verify that both OAuth clients belong to different projects.
- **Retention.** Newly stored credentials contain the refresh token and verified
  sender email. Failed disconnect retains the refresh token for revocation.
  Require an operator cleanup policy for abandoned or expired OAuth completions
  and any provider grant issued around a concurrent cancellation. Verify that
  TTL and cleanup are configured before enrolling real users. TTL alone removes
  a Firestore record without revoking its Google grant.
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

## CH-002 admin read-only viewing

The acceptance session confirmed that Firestore denied cross-account reads and
writes during View as. The standard Contact Hub view currently fails to load
in that session. A trusted read-only projection must verify a current admin
role, the exact active impersonation session and target, and record an audit
event before releasing data. Scope the API to Contact Hub records needed for
support and deny access to private photo payloads and OAuth credentials.
Verify expiration, session teardown, cross-target denial, and that every
mutation remains inaccessible. Keep direct Firestore ownership rules intact.

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

## Contact deletion follow-on checkpoint

After approval, test with `VITE_CONTACT_HUB_DELETE=on` and
`CONTACT_HUB_DELETE=on` in the isolated staging environment only. Both gates
default to off. Approve the local rules diff before any rules deployment.
Verify an ordinary contact and a mixed bulk selection in My People, plus
delete from a person profile. Test cancellation, stale sessions, lost
responses and partial outcomes. Retry returns an outcome for each selected ID.

- Delete the contact, its embedded notes and sticker assignments, its exact
  private photo, its known Activity/Scout child records (timeline, stage
  history, outcome log, attributions, drafts), and its `nbs_queue` rows in
  one transaction per contact. The request accepts up to 20 explicit IDs.
  More than 400 related rows for one contact requires operator assistance.
- Keep shared company and sticker definitions, unrelated contacts, existing
  Gmail mailbox messages, the account rate-limit and deduplication ledger,
  and shared Scout automation/reporting records. Scheduled outreach already
  suppresses subsequent sends when the referenced contact is missing.
  A provider call already in progress can finish.
- Client child writes require the contact parent to exist after the operation.
  Photo, manual reminder, and Contact Hub Gmail finalization read the parent
  transactionally. The final deletion-safety checkpoint covers the known
  legacy Admin SDK writers that bypass client rules. Verify those worker
  paths during staging and confirm any separately deployed writer or
  historical contact subcollection with its owner.

### Account deletion architecture for approval

Use a trusted operator-controlled job on the existing account identity,
with recent owner verification and audit. Before the first irreversible
write, record a durable job and verify which systems own the account's data.
Place a deletion fence that all participating writers honor, revoke Firebase
sessions, and verify that other authenticated access is blocked before cleanup.
Client rules and Admin writers require explicit fence coverage.

Revoke the dedicated Contact Hub Gmail grant while the refresh token is
available. Stop new Contact Hub OAuth exchanges and drain any in progress.
Enumerate and clear that UID's OAuth state/completion records and Gmail
credential record, then recursively purge its rate-limit and intent subtree.
Revoke abandoned dedicated grants before removing their last credential.
Retries retain unresolved credentials privately and record only status in
audit output. Recursively purge the user's approved Contact Hub contact
subtree, including photos and orphaned children, plus owner-only Contact Hub
settings and sticker data. Verify absence before the job completes.

Keep this as a Contact Hub data phase until the account owner approves the
wider lifecycle. Confirm disposition of Scout data in the shared contacts
collection before purging a Scout account. Gate deletion of the Firebase Auth identity and any shared
user root on an approved dependency check. Scout grants and regulated or
financial records require their existing owners' procedures and retention
approval. Record completion or a retryable failure per phase. Test with a
disposable account and audit failures without storing token or contact data.

### Dedicated Gmail setup and connection-only verification

1. In Google Cloud Console, create a dedicated project for Contact Hub QA,
   outside the Scout OAuth project, and enable Gmail API.
2. In Google Auth Platform, set Branding with the QA app name, owner support
   email and developer contact. In Audience choose External Testing and add only
   the dedicated Google QA mailboxes. In Data Access request only
   `https://www.googleapis.com/auth/gmail.send` and
   `https://www.googleapis.com/auth/userinfo.email`. External Testing refresh
   tokens that include Gmail access generally expire in seven days.
3. In Clients create an OAuth client of type Web application. Add this
   authorized redirect URI after the stable staging host is confirmed:
   `https://<approved-staging-host>/.netlify/functions/contact-hub-gmail-callback`.
   Copy the exact URL to `CONTACT_HUB_GMAIL_REDIRECT_URI`. Keep the client
   ID and secret in the staging function environment as
   `CONTACT_HUB_GMAIL_CLIENT_ID` and `CONTACT_HUB_GMAIL_CLIENT_SECRET`.
4. After separate approval, use the exact same HTTPS origin for the Connect
   action and callback. Enable `VITE_CONTACT_HUB_GMAIL` and
   `CONTACT_HUB_GMAIL` only there. Keep `CONTACT_HUB_GMAIL_SEND=off`.
   Test consent, same-contact return, cancel, expired/replayed state,
   cross-account denial, disconnect, revocation, retry and reconnect.
   Where a test login also has Scout connected, verify the Scout grant survives.
5. Before broader enrollment, approve a cleanup policy for abandoned OAuth
   completions that revokes grants before credential removal. Serialize
   cleanup against new connections for the same Google grant, since revocation
   can invalidate a newer grant in the same project. Deleting expired records
   with TTL does not revoke consent. Account deletion cleanup remains part of
   the architecture review above.

Google references. [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [token expiration](https://developers.google.com/identity/protocols/oauth2).

## Final deletion safety and duplicate review

- [x] Fence known legacy contact child writes in a transaction with the
  parent read. Pending inbox jobs skip missing contacts. Tracking and follow-up
  activity cannot add new dependent records after the contact is gone.
- [x] Keep a server-only, ID-only deletion marker for trusted deterministic
  create paths. Include `contact_hub_deleted/{uid}/contacts` in an approved
  account purge. New, explicit re-additions use a fresh contact ID.
- [ ] Keep deletion gated until the worker checkpoint and local rules are
  integrated together and exercised with staged Free and Scout fixtures.
  Confirm no other service can recreate a previously deleted deterministic ID.
  Retain existing provider-send and audit history under its own policy. A
  provider operation already accepted or in progress cannot be canceled by
  database deletion.
- [ ] Review the [duplicate audit and transfer plan](DUPLICATE_MANAGEMENT_AUDIT.md).
  Approve read-only candidate review first. Approve merge writes separately.
- [ ] Treat Contact Hub data removal as a scoped purge that can keep the
  IDYNIFY login and services intact. Full account deletion additionally
  requires authentication, Scout, subscription and financial retention
  owners, and each external integration owner. Implement neither phase
  before the purge contract, fences and ownership decisions are approved.
- [ ] Photo persistence and physical-device camera checks remain gated.
- [ ] Gmail dedicated OAuth, abandoned-grant cleanup and connection-only
  verification remain gated. Live sending stays off.
- [ ] CH-002 remains an independent audited Admin read-only task.

### Duplicate management Phase 1

My People uses the loaded account snapshot to show a count of reviewable
pairs. The comparison and combined preview use deterministic match evidence.
The count reflects the review queue, with anchored comparisons for large
shared-signal groups to avoid quadratic expansion. Dismissed pairs can be
restored while My People is mounted. Account or permission changes reset
the local review state. Read-only users can compare available contacts.
The review performs no additional Firestore or paid-provider calls.
[Trusted merge execution proposal](TRUSTED_CONTACT_MERGE_PROPOSAL.md)
requires separate approval.

### Trusted merge local checkpoint

Keep `VITE_CONTACT_HUB_MERGE`, `CONTACT_HUB_MERGE`, and
`CONTACT_HUB_MERGE_EXECUTION` unset or off on the accepted staging candidate.
The trusted Web function requires a server-only `CONTACT_HUB_MERGE_SECRET`
of at least 32 characters when its review gate is enabled. Never use the
fixture signing key outside its test process. Contact deletion, photo
persistence and Gmail sending remain independently disabled.

The gated atomic path handles bounded pairs with supported contact facts
and timeline records. It refuses unsupported photo or reminder variants,
unsupported worker records, unresolved Gmail attempts, and opt-outs that
cannot be transferred under a verified downstream policy. New Contact
Hub Gmail reservations store the contact ID from the authoritative document
reference. Legacy ledger rows remain as written. Supported historical profile
links use an owner-only resolution of the frozen retired record.

Before any execution activation, verify adoption of the lifecycle fence by
all remaining Admin writers, including Scout scheduling/provider claims, and
complete unresolved reference/consent inventories. Approve cleanup and
retention for recovery snapshots, retirement markers, and dismissals,
including account removal. The UI reports blockers and automatically
refuses rollback after intervening changes. Verify against production-like
Firestore limits and QA account fixtures before approval.

### Relationship merge verification checkpoint

The trusted plan now includes private photo and Contact Hub manual reminder
versions. Choose the display photo independently of the original imported
source. Keep private override before-images in server-only merge provenance.
Keep one active reminder, transfer its queue row, and preserve the other as
dismissed with an explicit merge disposition. Unsupported Barry/legacy
reminder states, malformed photo overrides, unknown subcollections, and
unresolved provider operations still block execution.

The emulator scenario in `scripts/rules-check/contact-photo.mjs` seeds a
synthetic pair with three distinct email addresses, two phones, notes,
colliding Activity IDs, stickers and provenance, two private overrides,
two active manual reminders, and an authoritative suppressed address. The
test checks merged documents and rollback, including the private photo and
both queue rows. It never calls Gmail or an external provider.

Merge consults the existing server-only `emailSuppressionList` by normalized
address and carries restrictions forward. Contact Hub Gmail checks the
authoritative list during new send reservation while preserving prior send
receipts and recorded contact IDs. Consent and provider-specific restrictions
whose meaning or enforcement cannot be verified remain blockers. Scout
scheduled sends reject retired contacts and merged contacts with stored
suppression. The independently owned Scout quick send, waves, cadence,
follow-up and Barry provider reservations still require end-to-end lifecycle
and suppression verification before merge activation. Keep all gates closed
until that work, staging rules/rollout approval, and private recovery retention
and account cleanup are complete.

The [outbound safety matrix](OUTBOUND_MERGE_SAFETY_MATRIX.md) records
verified protections and release blockers per send path. Duplicate dispatch
was reproduced locally against mock providers for both quick send and
overlapping scheduled workers. Keep all activation gates closed.
