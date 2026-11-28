# Staging Gmail OAuth client and the `--gmail` staging run (CH-GMAIL-001.2)

This guide is for Gmail runtime QA on staging, the QA that closes CH-GMAIL-001 (PR #856). It covers:

1. creating the dedicated staging Google OAuth client;
2. filling in the staging env file;
3. running the preflight and the launcher with `--gmail`.

It changes nothing in production, enables no ingestion, and touches neither Gmail integration's code.

> **Secrets.** The client secret goes in the staging env file only. That file lives outside the repository (the preflight refuses a file git would commit). Never paste the secret into chat, a PR, a ticket or a screenshot. The tools print variable names, never values.

---

## 1. Create the staging OAuth client (one time; Aaron or whoever administers `idynify-staging`)

The client must be created **in the `idynify-staging` Google Cloud project**, the Cloud project behind the staging Firebase project. The preflight checks this. A Google client ID begins with its Cloud project's **number**, and that number must equal the staging Firebase config's `messagingSenderId` (`VITE_FIREBASE_MESSAGING_SENDER_ID`). A client created anywhere else is refused, production's included.

1. Open <https://console.cloud.google.com/> signed in as the `idynify-staging` administrator. In the project picker, choose **idynify-staging**.
   - Confirm the project **number** on the Dashboard ("Project info") matches `VITE_FIREBASE_MESSAGING_SENDER_ID` in the staging Firebase web config. If it doesn't, you are in the wrong project.
2. **APIs & Services → Library →** search **Gmail API → Enable**.
3. **Google Auth Platform** (the left menu; older consoles call it "OAuth consent screen"). If asked, **Get started** and register the app:
   - **App name:** `IDYNIFY Staging`. Use a name that can't be mistaken for production on the consent screen.
   - **User support email** and **Developer contact:** the administrator's address.
   - **Audience:** **External**, publishing status **Testing**. Do **not** publish it.
4. **Google Auth Platform → Audience → Test users → Add users:** add each test mailbox (M1, M2 in the QA checklist). Only these accounts can complete consent.
   - Testing-mode grants expire after 7 days. This is expected, and it exercises the "Reconnect needed" path.
5. **Google Auth Platform → Data Access → Add or remove scopes:** add exactly these three. They are the scopes production already requests, so nothing new is introduced:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
6. **Google Auth Platform → Clients → Create client:**
   - **Application type:** **Web application**
   - **Name:** `IDYNIFY staging Gmail (localhost)`
   - **Authorized JavaScript origins:** leave empty. The flow is server-side.
   - **Authorized redirect URIs:** add exactly
     `http://localhost:8888/.netlify/functions/gmail-oauth-callback`
     It must be `http`, `localhost` (not `127.0.0.1`), port `8888`, with no trailing slash. Google allows plain `http` only for localhost.
   - Click **Create**.
7. **Copy the client ID and the client secret now.** Google shows the secret only once, at creation, and it is not visible again. Put both straight into the staging env file (section 2), or into the team password manager or Secret Manager. If the secret is lost, add a new secret to the same client and delete the old one.
8. Redirect URI changes can take from 5 minutes to a few hours to take effect. If the first attempt shows `redirect_uri_mismatch`, wait and retry before changing anything.

**Production's client ID** is needed for the preflight to rule it out. It isn't a secret: it appears in every production Google consent URL. Read it from Netlify (Production context, `GOOGLE_CLIENT_ID`), or from the `client_id=` parameter of a production "Connect Gmail" consent page. Never copy production's **secret** anywhere.

---

## 2. The staging env file

Start from the env file used for the other staging runs, which already passes the default preflight. Add only:

```dotenv
GOOGLE_CLIENT_ID=<staging client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<staging client secret, GOCSPX-…>
GOOGLE_REDIRECT_URI=http://localhost:8888/.netlify/functions/gmail-oauth-callback
```

For a Free Contact Hub user to be tested (QA step 1), the browser build also needs the free routes on. These are build flags, not integrations:

```dotenv
VITE_CONTACT_HUB=on
VITE_FREE_PLAN=on
# VITE_SHELL_MIGRATION: leave unset (on by default). Do not set it to off, false or 0.
```

`VITE_FREE_PLAN=on` lets a signup without a tier create a Free account; `existing` keeps Free routes for existing Free accounts only. Free routes need Contact Hub and the shell both on (`src/constants/freePlan.js`).

Leave **everything else unset**. A `--gmail` run refuses each of these:

| Refused in a Gmail run | Why |
|---|---|
| Stripe, Apollo, Anthropic, Resend, LinkedIn, Twilio, search, Places, Vision keys, `ADMIN_USER_IDS`, `SUPER_ADMIN_USER_IDS`, `VITE_STRIPE_ENABLED=true` | Unrelated integrations stay off (the standard check I5). |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Calendar is not under test. |
| `CONTACT_HUB_GMAIL`, `CONTACT_HUB_GMAIL_SEND`, `CONTACT_HUB_GMAIL_CLIENT_ID`, `CONTACT_HUB_GMAIL_CLIENT_SECRET`, `CONTACT_HUB_GMAIL_REDIRECT_URI` | The separate Contact Hub Gmail integration (section 5) is not under test. |
| `GMAIL_IDENTITY_MODE` other than `dry_run`, `GMAIL_REPLY_SYNC_ENABLED`, `GMAIL_REPLY_SYNC_USER_ALLOWLIST` | Inbox ingestion and scheduled reply sync stay off. |

---

## 3. Running it

In the shell, give the two production identifiers the tools use to rule production out. Neither is a secret:

```bash
export PRODUCTION_FIREBASE_PROJECT_ID=<production Firebase project id>
export PRODUCTION_GOOGLE_CLIENT_ID=<production OAuth client id>
# plus the staging service-account credential, as in the other runbooks:
#   STAGING_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS (short-lived)
```

Then, from an **unlinked** checkout of the branch under test (PR #856 for CH-GMAIL-001), with no root `.env` files:

```bash
node scripts/staging/stagingPreflight.mjs --env=/path/outside/repo/.env.staging --gmail
node scripts/staging/stagingDev.mjs     --env=/path/outside/repo/.env.staging --gmail
```

What a Gmail run checks, on top of every standard staging check:

| Check | Passes when |
|---|---|
| `gmail-project` | `VITE_FIREBASE_PROJECT_ID` is exactly `idynify-staging` |
| `gmail-config` | all three `GOOGLE_*` values are set |
| `gmail-redirect-uri` | `GOOGLE_REDIRECT_URI` is exactly the staging callback |
| `gmail-client-id` | `GOOGLE_CLIENT_ID` is a Google web client ID |
| `gmail-dedicated-client` | the client's project number equals `VITE_FIREBASE_MESSAGING_SENDER_ID`, i.e. it was created in `idynify-staging` |
| `gmail-not-production-client` | `PRODUCTION_GOOGLE_CLIENT_ID` is given and well formed, and the staging client differs from it in **both** ID and project. Missing, malformed or matching all refuse: fail closed |
| `gmail-client-secret` | `GOOGLE_CLIENT_SECRET` looks like a Google client secret (`GOCSPX-…`) |
| `gmail-ingestion-off` | nothing in the "refused" table above is set |

The launcher also:
- re-runs every check;
- refuses `--gmail` together with `--billing`, `--only-billing-functions` or `--only-sticker-functions`;
- drops any Google, Contact Hub Gmail or ingestion variable from your shell, so the only Google client the app sees is the checked one in the env file;
- claims port **8888** before starting (refusing if something else holds it), because Google returns the callback there.

Then open **`http://localhost:8888`** in **Chrome**. Not the Vite port and not `127.0.0.1`: the connection's security cookie is bound to the exact host. Chrome accepts `Secure` cookies on `localhost`; Safari may not.

Startup serves every function, which can take a few minutes on first bundle. Then follow the QA checklist in the CH-GMAIL-001 handoff.

---

## 4. Clean-up after QA

- Remove the test mailboxes' access at <https://myaccount.google.com/permissions> ("IDYNIFY Staging").
- Leave the client in place for future staging QA. If it is no longer wanted, delete it under **Google Auth Platform → Clients**.
- Never move the staging client into production, and never publish its consent screen.

---

## 5. The two Gmail integrations (for orientation; neither is changed here)

IDYNIFY has **two independent Gmail connections**. Connecting one does not connect the other.

| | **Primary Gmail integration** | **Contact Hub Gmail (`CONTACT_HUB_GMAIL`)** |
|---|---|---|
| Purpose | The shared mail account for Scout, Hunter, cadences, bulk and wave sends, scheduled engagements, Barry's reply card, reply detection and the (off) inbox sync | Manual, one-at-a-time email to a person from their **Contact Hub** page (`/contact-hub/person/:id?compose=email`) |
| Functions | `gmail-oauth-init`, `gmail-oauth-callback`, `gmail-disconnect`, and every `gmail-send*` / reply function | `contact-hub-gmail` (connect, status, send, disconnect), `contact-hub-gmail-callback` |
| OAuth client | `GOOGLE_CLIENT_ID` / `_SECRET` / `GOOGLE_REDIRECT_URI` | Its own client: `CONTACT_HUB_GMAIL_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`. The runtime refuses to start if it is the same client ID as `GOOGLE_CLIENT_ID` |
| Scopes | `gmail.send`, `gmail.readonly`, `userinfo.email` | `gmail.send`, `userinfo.email` only (it cannot read mail) |
| Stored at | `users/{uid}/integrations/gmail`: owner-readable for status (server-write-only after PR #856) | `contact_hub_gmail/{uid}`: server-only; clients cannot read it |
| Switches | always available once configured | `CONTACT_HUB_GMAIL=on` enables it; `CONTACT_HUB_GMAIL_SEND=on` allows sending |
| Safeguards | single-use, browser-bound state and PKCE (after PR #856) | single-use, browser-bound state and PKCE from the start; per-user limits (5 a minute, 30 a day); suppression and opt-out checks; idempotent send intents; a `message_sent` timeline entry |

The `--gmail` staging run configures and tests the **primary** integration only, and refuses every `CONTACT_HUB_GMAIL*` variable. Testing Contact Hub Gmail on staging would need its own client and its own approved staging mode.
