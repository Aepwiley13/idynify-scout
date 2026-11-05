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
      | Cloud Datastore User (`roles/datastore.user`) | `stickersConfig` reads the flag, the user and the enrollment; the setup tools write the rollout documents and QA-Admin's role |
      | Firebase Rules Admin (`roles/firebaserules.admin`) | deploy `firestore.rules` |
      | Firebase Authentication Viewer (`roles/firebaseauth.viewer`) | "view as" (`adminStartImpersonation`) looks the user up |
      | Firebase Viewer (`roles/firebase.viewer`) | firebase-tools reads the project before a deploy |
      | Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`) | firebase-tools checks the rules API is enabled |

      Not Owner, Editor, Firebase Admin or any token-creator role. If `--validate` in step D reports a missing permission, add that one only.
   3. Keys → Add key → Create new key → JSON. Keep the file **outside any repository**. Never commit it, email it, or paste it into chat.
   4. **Delete the key when QA is finished** (Keys → delete).

   **Where the key goes:**
   - *Your own machine:* `export GOOGLE_APPLICATION_CREDENTIALS=<path to the key file>`.
   - *A Claude Code cloud session:* its only in-process secret store is an environment variable. In the session's environment settings, add `STAGING_SERVICE_ACCOUNT_KEY` set to the key file's contents as base64, which fits on one line:
     - macOS: `base64 -i key.json | pbcopy`
     - Linux: `base64 -w0 key.json`
     - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")) | Set-Clipboard`

     It loads when the session next starts. Remove the variable when QA is finished.

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
It re-runs the preflight, refuses on any failure, and starts `netlify dev --offline`. The app gets only the env file, the staging account (in memory), and from your shell nothing that is Firebase, a credential or an integration. Behind an HTTPS proxy that does not carry gRPC (a cloud session), add `--rest`.
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
