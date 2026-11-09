# Stickers staging QA: Mac setup (keyless)

**For:** the owner, on a trusted Mac, once. About 30 minutes.
**Result:**
- staging QA runs from your Mac against `idynify-staging`, with **short-lived credentials and no key file anywhere**
- production, your usual gcloud setup and the original Contact Hub are untouched

Every step says what you should see. **Nothing here prints a token or a secret.** If a check doesn't match, stop and say which step.

You need:
- your designated Google identity, the account that administers `idynify-staging`
- Terminal (Applications → Utilities → Terminal)

Paste one command at a time.

---

## 1. Install the tools (skip any you already have)
1. **Homebrew.** Check:
   ```bash
   brew --version
   ```
   If that says "command not found", install it (from brew.sh) and follow the lines it prints at the end:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. **Node.js and git:**
   ```bash
   brew install node git
   ```
   ```bash
   node --version
   ```
   ✅ `v22` or higher.
3. **Google Cloud CLI (gcloud):**
   ```bash
   brew install --cask gcloud-cli
   ```
   If Homebrew says that name is unknown, use `google-cloud-sdk` instead. Then **open a new Terminal window** and check:
   ```bash
   gcloud --version
   ```
   ✅ It starts with `Google Cloud SDK`.

## 2. A private workspace, separate from your usual gcloud
1. Create the folder, readable only by you:
   ```bash
   mkdir -p ~/idynify-staging && chmod 700 ~/idynify-staging
   ```
2. Create a settings file. It holds no secrets: only where things live and which projects are allowed.
   ```bash
   cat > ~/idynify-staging/session.sh <<'EOF'
   export CLOUDSDK_CONFIG="$HOME/idynify-staging/gcloud"
   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/idynify-staging/gcloud/application_default_credentials.json"
   export STICKERS_STAGING_PROJECTS="idynify-staging"
   export PRODUCTION_FIREBASE_PROJECT_ID="idynify-scout-dev"
   EOF
   ```
3. **In every new Terminal window used for this work, run this first.** It points gcloud at the private folder, so your usual gcloud login is never used or changed:
   ```bash
   source ~/idynify-staging/session.sh
   ```

## 3. Sign the private workspace in as you (the source identity)
1. Sign in. A browser opens; choose your designated Google identity:
   ```bash
   gcloud auth login
   ```
2. Set the staging project:
   ```bash
   gcloud config set project idynify-staging
   ```
3. Check who and where, without showing tokens:
   ```bash
   gcloud auth list
   ```
   ✅ Your designated identity, marked active (`*`).
   ```bash
   gcloud config list
   ```
   ✅ `account = <your identity>` and `project = idynify-staging`.

## 4. Check the staging service account (read-only)
It already exists with its four roles. **Don't create it again or add roles.**
1. The account exists and is enabled:
   ```bash
   gcloud iam service-accounts describe stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --format="value(email,disabled)"
   ```
   ✅ The email, then `False` (not disabled).
2. Exactly its four roles:
   ```bash
   gcloud projects get-iam-policy idynify-staging --flatten="bindings[].members" --filter="bindings.members:serviceAccount:stickers-staging-qa@idynify-staging.iam.gserviceaccount.com" --format="value(bindings.role)"
   ```
   ✅ These four lines (any order) and nothing else:
   - `roles/datastore.user`
   - `roles/firebaseauth.viewer`
   - `roles/firebaserules.admin`
   - `roles/serviceusage.serviceUsageConsumer`
3. **No key exists**, once you've revoked the old JSON key (console: the account → Keys → delete):
   ```bash
   gcloud iam service-accounts keys list --iam-account=stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --managed-by=user
   ```
   ✅ `Listed 0 items.`

## 5. Let only you impersonate it, on the account itself
1. See whether it's already granted:
   ```bash
   gcloud iam service-accounts get-iam-policy stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --format="table(bindings.role,bindings.members)"
   ```
   If `roles/iam.serviceAccountTokenCreator` already lists `user:<your identity>`, skip to 5.3.
2. Grant it. Replace the placeholder with your designated identity's email. This binding is on the service account, not the project:
   ```bash
   gcloud iam service-accounts add-iam-policy-binding stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --member="user:<your-google-email>" --role="roles/iam.serviceAccountTokenCreator"
   ```
3. Confirm **nobody** holds that role at the project level:
   ```bash
   gcloud projects get-iam-policy idynify-staging --flatten="bindings[].members" --filter="bindings.role:roles/iam.serviceAccountTokenCreator" --format="value(bindings.members)"
   ```
   ✅ No output.

## 6. Turn on the API impersonation uses (once)
```bash
gcloud services enable iamcredentials.googleapis.com
```
✅ It finishes without an error. If it was already on, it just returns.

## 7. Verify impersonation, before anything else touches staging
```bash
gcloud firestore databases describe --database="(default)" --impersonate-service-account=stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --format="value(name)"
```
✅ A warning that impersonation is in use, then `projects/idynify-staging/databases/(default)`.

If you see `PERMISSION_DENIED` right after step 5, wait two minutes and retry: IAM changes take a moment.

## 8. Create the short-lived credentials (no key)
1. A browser opens again; choose the same identity:
   ```bash
   gcloud auth application-default login --impersonate-service-account=stickers-staging-qa@idynify-staging.iam.gserviceaccount.com
   ```
2. Check what was written, without showing anything secret:
   ```bash
   node -e 'const d=require(process.env.GOOGLE_APPLICATION_CREDENTIALS); console.log(d.type); console.log(d.service_account_impersonation_url.split("/").pop().split(":")[0]); console.log(d.quota_project_id || "(no quota project)")'
   ```
   ✅ Three lines:
   - `impersonated_service_account`
   - `stickers-staging-qa@idynify-staging.iam.gserviceaccount.com`
   - `idynify-staging` or `(no quota project)`

## 9. The app, in a clean folder
1. Clone and install:
   ```bash
   cd ~/idynify-staging && git clone https://github.com/Aepwiley13/idynify-scout.git && cd idynify-scout && npm install
   ```
   Don't run `netlify link`, and don't create a `.env` file in this folder.
2. The staging web config. It's public by design (every browser receives it), and it sits outside the repository:
   ```bash
   cat > ~/idynify-staging/.env.staging <<'EOF'
   VITE_FIREBASE_API_KEY=AIzaSyDpyy0K0Yfx7VSP7QwgsvNLsAD3Myxtaig
   VITE_FIREBASE_AUTH_DOMAIN=idynify-staging.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=idynify-staging
   VITE_FIREBASE_STORAGE_BUCKET=idynify-staging.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=237845560993
   VITE_FIREBASE_APP_ID=1:237845560993:web:0f528bf159005ae9c1fae0
   FIREBASE_PROJECT_ID=idynify-staging
   EOF
   ```
3. The preflight. It contacts nothing and writes nothing:
   ```bash
   node scripts/staging/stagingPreflight.mjs --env=$HOME/idynify-staging/.env.staging
   ```
   ✅ Ends with `Preflight passed.` and includes `✓ private-key  Short-lived credentials: no private key is used.`

## 10. The four QA accounts (Firebase console, by hand)
The service account cannot create users.
1. Go to Firebase console → `idynify-staging` → Authentication → Users → **Add user**, four times:
   - `qa-admin@example.test`
   - `qa-beta@example.test`
   - `qa-user@example.test`
   - `qa-other@example.test`

   Give each a strong password.
2. Keep the passwords in one local file, readable only by you. Never put them in chat, email or the repository. Create it:
   ```bash
   printf 'QA_ADMIN_EMAIL=qa-admin@example.test\nQA_ADMIN_PASSWORD=\nQA_BETA_EMAIL=qa-beta@example.test\nQA_BETA_PASSWORD=\nQA_USER_EMAIL=qa-user@example.test\nQA_USER_PASSWORD=\nQA_OTHER_EMAIL=qa-other@example.test\nQA_OTHER_PASSWORD=\n' > ~/idynify-staging/qa-accounts.env && chmod 600 ~/idynify-staging/qa-accounts.env
   ```
   Open it and fill in the four passwords:
   ```bash
   open -e ~/idynify-staging/qa-accounts.env
   ```

## 11. Hand over to Claude
- **Preferred:** in the Claude desktop app, go to Settings → Claude Code → Remote Control and add the folder `~/idynify-staging/idynify-scout`. Then tell Claude. It asks to connect, and you approve on your Mac.
- **If that option isn't there:** open Terminal and run:
  ```bash
  cd ~/idynify-staging/idynify-scout && source ../session.sh && claude
  ```
  Then paste the hand-off prompt Claude gives you.

Claude then runs, in order:
1. the preflight, then starts the app with `node scripts/staging/stagingDev.mjs --env=$HOME/idynify-staging/.env.staging --only-sticker-functions`
2. the rules deploy dry run
3. `--validate`: firebase-tools against staging, deploying nothing
4. the staging-only rules deploy
5. the QA setup (QA-Admin's role and stickers on for QA-Beta only)
6. `STICKERS_QA_PLAN.md`

Claude installs its test browser in a separate folder, `~/idynify-staging/qa-tools`, not in the repository.

## 12. After QA: revoke
1. Revoke the short-lived credentials:
   ```bash
   source ~/idynify-staging/session.sh && gcloud auth application-default revoke
   ```
2. Sign the private workspace out:
   ```bash
   gcloud auth revoke --all
   ```
3. Remove your impersonation grant:
   ```bash
   gcloud iam service-accounts remove-iam-policy-binding stickers-staging-qa@idynify-staging.iam.gserviceaccount.com --member="user:<your-google-email>" --role="roles/iam.serviceAccountTokenCreator"
   ```
4. Delete `~/idynify-staging/gcloud` and `~/idynify-staging/qa-accounts.env`.

Nothing in staging depends on these credentials. The rules, the synthetic data and the test accounts stay.
