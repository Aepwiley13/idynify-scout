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
5. **Credentials: short-lived, on a trusted local machine. No key.** QA runs from your own machine. A Claude Code cloud environment is **not** used for credentials: anyone using the environment can see its variables, and it has no workload identity for Google to trust.

   In the Google Cloud console, with **the staging project selected**:
   1. IAM & Admin → Service accounts → Create: `stickers-staging-qa`. Don't use the default `firebase-adminsdk` account, whose access is much broader.
   2. Grant it these roles **on the staging project only**, and nothing on any other project:

      | Role | Why |
      |---|---|
      | Cloud Datastore User (`roles/datastore.user`) | `stickersConfig` reads the flag, the user and the enrollment; "view as" records its session; the setup tools write the rollout documents and QA-Admin's role; firebase-tools reads the database's metadata before a rules deploy |
      | Firebase Rules Admin (`roles/firebaserules.admin`) | compile, create and release `firestore.rules` |
      | Firebase Authentication Viewer (`roles/firebaseauth.viewer`) | "view as" (`adminStartImpersonation`) looks the target user up |
      | Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`) | firebase-tools checks the Firestore API is enabled |

      Nothing else:
      - **Not** Owner, Editor, Firebase Admin, Firebase Viewer, or anything on another project.
      - **QA accounts need no Auth admin role.** They are created like any sign-up, with the web API key.
      - **Index permissions:** firebase-tools pre-checks index-admin permissions for any Firestore deploy, but that check is advisory (it only logs at debug level), and `--only firestore:rules` never touches indexes.
      - **No database creation:** this account cannot create a database, which firebase-tools would otherwise try if the database were missing.
      - If `--validate` in step D reports a missing permission, add that one only.
   3. **Let only yourself impersonate it.** Open the account → Permissions → Grant access: your own Google account, role **Service Account Token Creator**, on this service account only (not on the project).
   4. **Enable the IAM Service Account Credentials API** on the staging project (APIs & Services → Library). Impersonation goes through it.
   5. **Create short-lived credentials** on your machine, in a gcloud folder of their own so your usual gcloud setup is untouched:
      ```bash
      export CLOUDSDK_CONFIG=$HOME/idynify-staging/gcloud
      ```
      ```bash
      gcloud auth application-default login --impersonate-service-account=stickers-staging-qa@<staging-id>.iam.gserviceaccount.com
      ```
      ```bash
      export GOOGLE_APPLICATION_CREDENTIALS=$HOME/idynify-staging/gcloud/application_default_credentials.json
      ```
      - **No key is created.** Every tool, and the functions under `netlify dev`, act as the staging account with tokens that expire within an hour and refresh automatically.
      - The file holds your own sign-in, used only to mint those tokens. gcloud writes it readable by you alone. Treat it like any gcloud login on your machine.
      - The tools accept only a file that impersonates a service account of the staging project. They refuse your plain login (`authorized_user`), which reaches production too, and they never print the file's contents.
      - Workload identity configurations (`external_account` with service-account impersonation) are accepted on the same terms, for example from CI.

   **Keeping production out of reach:**
   - The account has roles on the staging project only.
   - Every tool refuses any project but the one the credential, the env file and `STICKERS_STAGING_PROJECTS` all name, and refuses `PRODUCTION_FIREBASE_PROJECT_ID`.
   - The rules deploy runs firebase-tools with an empty config folder. Otherwise an account you signed in with `firebase login` (or `FIREBASE_TOKEN`) would take priority over these credentials, so the deploy would run as you rather than as the staging account.
   - The functions use these credentials only because the launcher sets `FIREBASE_ADMIN_CREDENTIALS=application-default` (`netlify/functions/utils/adminCredential.js`). Nothing deployed sets it.

   **Revoking after QA, without touching anything else in staging:**
   ```bash
   CLOUDSDK_CONFIG=$HOME/idynify-staging/gcloud gcloud auth application-default revoke
   ```
   Then:
   1. Delete `$HOME/idynify-staging/gcloud`.
   2. Remove your Token Creator grant on the account.
   3. Optionally delete the account.

   Nothing in the staging project depends on the account: no deployed functions or hosting use it. The deployed rules, the data and the test accounts stay, and the default `firebase-adminsdk` account is untouched.

   **If impersonation is not possible:** a key file for the same account still works on your machine. Download it (Keys → JSON), `chmod 600` it outside any repository, point `GOOGLE_APPLICATION_CREDENTIALS` at it, and delete the key when QA is finished. Never put it in a cloud environment variable, chat or email.
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
   - **no key or account:** the functions' credentials come from A5.
3. Leave every other variable out.
4. Check it, with the A5 credential set:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.staging
   ```
   It must end with **Preflight passed.**

## D. Rules on staging (with your approval for this staging deploy)
With the A5 credentials set (`GOOGLE_APPLICATION_CREDENTIALS`):
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

With short-lived credentials (A5), the launcher runs the functions on them, with no key. Behind an HTTPS proxy:
- add `--rest` if the proxy does not carry gRPC;
- add `--no-edge-functions` if it blocks the edge runtime the CLI downloads on the first request. This project has no edge functions, and the launcher refuses that flag if the project ever declares one.
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
