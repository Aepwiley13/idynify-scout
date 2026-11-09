# Stickers staging: owner setup (one time, about 45 minutes)

**For:** the project owner, who creates the isolated Firebase project.
**Goal:** a separate, non-production Firebase project, with the browser, the server functions, sign-in and the Firestore rules all on it. Then QA can run `STICKERS_QA_PLAN.md`.
**Never:** copy production data or Contact Hub data into it, reuse a production key, or point any step at `idynify-scout-dev` (production).

The detailed operator steps are in `STICKERS_STAGING_RUNBOOK.md`. This page is the short path.

---

## A. Create the project (Firebase console)
1. **Add project.** Give it an id containing `staging`, for example `idynify-stickers-staging`. Google Analytics is not needed. The free Spark plan is enough.
2. **Firestore.** Build → Firestore Database → Create database.
   - Choose **production mode**: everything stays locked until our rules are deployed in step D.
   - Pick a location. Don't import anything.
3. **Sign-in.** Build → Authentication → Get started.
   - Enable **Email/Password**.
   - Under Settings → Authorized domains, keep `localhost`.
4. **Web app.** Project settings → General → Your apps → Add app → Web. Copy the six config values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
5. **Service account (least privilege, staging only).** Don't use the default `firebase-adminsdk` account, whose access is much broader. In the Google Cloud console, with **the staging project selected**:
   1. IAM & Admin → Service accounts → Create: `stickers-staging-qa`.
   2. Grant it these roles **on the staging project only**, and nothing on any other project:

      | Role | Why |
      |---|---|
      | Cloud Datastore User (`roles/datastore.user`) | `stickersConfig` reads the flag, the user and the enrollment; "view as" records its session; the setup tools write the rollout documents and QA-Admin's role; firebase-tools reads the database's metadata before a rules deploy |
      | Firebase Rules Admin (`roles/firebaserules.admin`) | compile, create and release `firestore.rules` |
      | Firebase Authentication Viewer (`roles/firebaseauth.viewer`) | "view as" (`adminStartImpersonation`) looks the target user up |
      | Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`) | firebase-tools checks the Firestore API is enabled |

      Nothing else:
      - **Not** Owner, Editor, Firebase Admin, Firebase Viewer, any token-creator role, or anything on another project.
      - **QA accounts need no Auth admin role.** They are created like any sign-up, with the web API key.
      - **Index permissions:** firebase-tools pre-checks index-admin permissions for any Firestore deploy, but that check is advisory (it only logs at debug level), and `--only firestore:rules` never touches indexes.
      - **No database creation:** this account cannot create a database, which firebase-tools would otherwise try if the database were missing.
      - If `--validate` in step D reports a missing permission, add that one only.
   3. Keys → Add key → Create new key → JSON. Keep the file **outside any repository**. Never commit it, email it, or paste it into chat.
   4. **Delete the key when QA is finished** (Keys → delete).

   **Where the key goes:**
   - *Your own machine:* `export GOOGLE_APPLICATION_CREDENTIALS=<path to the key file>`.
   - *A Claude Code cloud session:* its only in-process secret store is an environment variable. In the session's environment settings, add `STAGING_SERVICE_ACCOUNT_KEY` set to the key file's contents as base64, which fits on one line:
     - macOS: `base64 -i key.json | pbcopy`
     - Linux: `base64 -w0 key.json`
     - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")) | Set-Clipboard`

     It loads when the session next starts. Remove the variable when QA is finished.

   **What protects the key in each place:**
   - *Laptop:* the file's permissions (`chmod 600`), outside any repository.
   - *Cloud session:* the environment is personal, so only your own sessions on it receive the variable. It is **not** a secret manager. The value is stored in the environment's settings like any other variable, and every process in every session that uses that environment can read it.
     - So use a **separate personal environment** just for staging QA, with only this variable. Your everyday sessions and any scheduled routines on other environments never receive it.
     - Network secrets (the proxy-injected kind) cannot hold a signing key, and would put a service-account token on the browser's Firestore requests, bypassing the rules under test.
   - *What a leak could reach:* the staging project only, with synthetic data.

   **Revoking after QA, without touching anything else in staging:**
   1. Delete the key: Service accounts → `stickers-staging-qa` → Keys → delete. It stops working at once.
   2. Delete the variable (or the whole QA environment).
   3. Optionally delete the service account.

   Nothing in the staging project depends on it: no deployed functions or hosting use it. The deployed rules, the data and the test accounts stay, and the default `firebase-adminsdk` account is untouched.

   Set one or the other, never both: the tools refuse both. They check the key belongs to the staging project, never print it, and never write it into the env file. The rules deploy hands it to firebase-tools as a private temporary file, deleted as soon as firebase-tools exits (`scripts/staging/stagingCredentials.mjs`).
6. **Access.** Only you and the QA tester need access. Don't add production collaborators.

## B. A clean checkout
1. Clone the repository fresh into its own folder, for example `~/idynify-staging/idynify-scout`. Run `npm install`.
2. In that clone:
   - **don't** run `netlify link`
   - **don't** create a `.env` file

   The preflight refuses a linked clone, because `netlify dev` would inject the production site's variables. It also refuses a root `.env`.

## C. The staging env file
1. Copy `docs/staging/stickers-staging.env.example` to `~/idynify-staging/.env.staging`, outside the clone.
2. Fill in:
   - the six `VITE_FIREBASE_*` values from A4
   - `FIREBASE_PROJECT_ID`: the same project id
   - **no key:** the functions' account comes from the A5 credential. (Putting `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in the file still works if no A5 credential is set, but keeps a key in a file.)
3. Leave every other variable out.
4. Check it, with the A5 credential set:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.staging
   ```
   It must end with **Preflight passed.**

## D. Rules on staging (with your approval for this staging deploy)
With the A5 credential set (`GOOGLE_APPLICATION_CREDENTIALS` or `STAGING_SERVICE_ACCOUNT_KEY`):
```bash
export STICKERS_STAGING_PROJECTS=<staging-id>
```
```bash
export PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev
```
```bash
node scripts/staging/stagingRulesDeploy.mjs --env=$HOME/idynify-staging/.env.staging --project=<staging-id>
```
Check the printed target, the credential line, and that the rules are `main` at a commit with no local changes. Then run the same command:
1. with `--validate`: firebase-tools checks the credential, its permissions and the rules against the staging project, and deploys nothing;
2. then with `--apply`.

## E. Start the app on staging
```bash
PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.staging
```
It re-runs the preflight, refuses on any failure, and starts `netlify dev --offline`. The app gets only the env file, the staging account (in memory), and from your shell nothing that is Firebase, a credential or an integration.

In a cloud session, behind an HTTPS proxy:
- add `--rest`, because the proxy does not carry gRPC;
- add `--no-edge-functions`, because the CLI downloads an edge runtime on the first request even though this project has no edge functions. The launcher refuses that flag if the project ever declares one.
- Open http://localhost:8888.
- In DevTools → Network, every `firestore.googleapis.com` request must name `projects/<staging-id>`. If anything names `idynify-scout-dev`, stop.

## F. Test accounts and synthetic contacts
1. Create four accounts in the staging console (Authentication → Users → Add user): QA-Admin, QA-Beta, QA-User, QA-Other.
   - Use addresses you control, for example with plus-addressing.
   - Sign in once as each. If the app asks for onboarding, take the free option; no billing is connected on staging.
2. In the staging Firestore console, open `users/<QA-Admin uid>` and add `role: "admin"`. This is staging only.
3. As QA-Beta, import `docs/staging/synthetic-contacts.csv` (30 fictional people, `example.test` addresses).
   - Archive one contact and tag a few.
   - Add two or three contacts by hand for QA-Other.
4. Turn stickers on for staging (the rollout tool refuses production):
   ```bash
   node scripts/staging/stickersStaging.mjs --project=<staging-id> --mode=beta --enroll=<QA-Beta uid>
   ```
   Check the plan it prints, then add `--apply`.

## G. Hand-off
Send the QA tester:
- the staging id
- the four test logins
- the clone path

They run `STICKERS_QA_PLAN.md` from entry check E1, and attach the evidence to the release record.
