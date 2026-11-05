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
5. **Service account key.** Project settings → Service accounts → Generate new private key.
   - Save the JSON file **outside any repository**, for example in `~/idynify-staging/`.
   - Never commit it, email it, or paste it into chat.
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
   - from the JSON key in A5: `FIREBASE_CLIENT_EMAIL` = `client_email`, and `FIREBASE_PRIVATE_KEY` = `private_key`, in quotes, keeping the `\n`s
3. Leave every other variable out.
4. Check it:
   ```bash
   PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.staging
   ```
   It must end with **Preflight passed.**

## D. Rules on staging (with your approval for this staging deploy)
```bash
export GOOGLE_APPLICATION_CREDENTIALS=$HOME/idynify-staging/<key file>.json
```
```bash
export STICKERS_STAGING_PROJECTS=<staging-id>
```
```bash
export PRODUCTION_FIREBASE_PROJECT_ID=idynify-scout-dev
```
```bash
node scripts/staging/stagingRulesDeploy.mjs --env=$HOME/idynify-staging/.env.staging --project=<staging-id>
```
Check the printed target, and that the rules are `main` at a commit with no local changes. Then run the same command with `--apply`.

## E. Start the app on staging
```bash
set -a; . $HOME/idynify-staging/.env.staging; set +a
```
```bash
npx netlify dev --offline
```
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
