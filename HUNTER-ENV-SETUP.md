# Hunter Module - Environment Variables Setup

## Required Environment Variables for Hunter MVP

Hunter requires Google OAuth credentials to send emails via Gmail API. Follow these steps to set up the required environment variables.

---

## 📋 Required Environment Variables

Add these to your Netlify environment variables:

```bash
# Google OAuth (NEW - Required for Hunter)
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://your-site.netlify.app/.netlify/functions/gmail-oauth-callback

# Firebase Admin SDK (Should already exist)
FIREBASE_PRIVATE_KEY=your_private_key_here
FIREBASE_CLIENT_EMAIL=your_client_email_here
FIREBASE_PROJECT_ID=idynify-scout-dev

# Anthropic API (Should already exist)
ANTHROPIC_API_KEY=your_anthropic_key_here

# Firebase API Key (Should already exist)
FIREBASE_API_KEY=your_firebase_api_key_here
```

---

## 🔧 Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Name it something like "Idynify Hunter"

---

## 🔧 Step 2: Enable Gmail API

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Gmail API"
3. Click **Enable**

---

## 🔧 Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (or Internal if you have Google Workspace)
3. Fill in required fields:
   - **App name**: Idynify Hunter
   - **User support email**: your email
   - **Developer contact**: your email
4. **Scopes**: Add the following scope:
   ```
   https://www.googleapis.com/auth/gmail.send
   ```
5. **Test users** (for development): Add your Gmail address
6. Click **Save and Continue**

---

## 🔧 Step 4: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: "Idynify Hunter Web Client"
5. **Authorized JavaScript origins**:
   ```
   https://your-site.netlify.app
   http://localhost:5173  (for local development)
   ```
6. **Authorized redirect URIs**:
   ```
   https://your-site.netlify.app/.netlify/functions/gmail-oauth-callback
   http://localhost:8888/.netlify/functions/gmail-oauth-callback  (for local development)
   ```
7. Click **Create**
8. **Copy the Client ID and Client Secret** (you'll need these next)

---

## 🔧 Step 5: Add Environment Variables to Netlify

1. Go to [Netlify Dashboard](https://app.netlify.com/)
2. Select your site
3. Go to **Site configuration** → **Environment variables**
4. Click **Add a variable** and add each of the following:

### GOOGLE_CLIENT_ID
- **Key**: `GOOGLE_CLIENT_ID`
- **Value**: Your Client ID from Step 4 (looks like `123456789-abc...xyz.apps.googleusercontent.com`)
- **Scopes**: All scopes

### GOOGLE_CLIENT_SECRET
- **Key**: `GOOGLE_CLIENT_SECRET`
- **Value**: Your Client Secret from Step 4 (looks like `GOCSPX-abc...xyz`)
- **Scopes**: All scopes
- **⚠️ IMPORTANT**: Keep this secret! Never commit it to git.

### GOOGLE_REDIRECT_URI
- **Key**: `GOOGLE_REDIRECT_URI`
- **Value**: `https://your-site.netlify.app/.netlify/functions/gmail-oauth-callback`
- **Scopes**: All scopes
- **Replace `your-site.netlify.app` with your actual Netlify domain**

---

## 🔧 Step 6: Verify Existing Environment Variables

Make sure these are already set in Netlify (required for other functions):

### FIREBASE_PRIVATE_KEY
- Should contain your Firebase service account private key
- Format: `"-----BEGIN PRIVATE KEY-----\n..."`
- **If missing**: Get from Firebase Console → Project Settings → Service Accounts → Generate new private key

### FIREBASE_CLIENT_EMAIL
- Should contain your Firebase service account email
- Format: `firebase-adminsdk-xxxxx@idynify-scout-dev.iam.gserviceaccount.com`

### FIREBASE_PROJECT_ID
- Should be: `idynify-scout-dev`

### ANTHROPIC_API_KEY
- Your Claude API key for AI message generation
- Format: `sk-ant-api03-...`

### FIREBASE_API_KEY
- Your Firebase Web API key
- Format: `AIzaSy...`

---

## 🔧 Step 7: Redeploy Your Site

After adding environment variables:

1. In Netlify, go to **Deploys**
2. Click **Trigger deploy** → **Deploy site**
3. Wait for the build to complete

**Environment variables are only available after redeployment!**

---

## 🧪 Testing the Setup

### Test 1: Gmail OAuth Connection

1. Go to `/hunter` in your app
2. Click **Connect Gmail**
3. You should be redirected to Google's consent screen
4. Grant permission to send emails
5. You should be redirected back to `/hunter?connected=true`
6. You should see your Gmail email displayed with a green checkmark

### Test 2: Create Campaign

1. Click **Create Campaign**
2. Enter campaign name and select a contact
3. Click **Generate Messages**
4. AI should generate a personalized email
5. Edit the message if needed
6. Click **Save Campaign**
7. You should be redirected to the campaign detail page

### Test 3: Send Email

1. In the campaign detail page, click **Send Email**
2. Confirm in the modal
3. Email should be sent via Gmail
4. Status should update to "sent" with timestamp
5. Check the recipient's Gmail inbox to verify

---

## 🔒 Security Best Practices

### ✅ DO

- Store OAuth credentials as environment variables (NEVER in code)
- Use HTTPS redirect URIs in production
- Limit OAuth scopes to only `gmail.send`
- Rotate Client Secrets periodically
- Monitor OAuth consent screen for suspicious activity

### ❌ DON'T

- Commit `GOOGLE_CLIENT_SECRET` to version control
- Share OAuth credentials publicly
- Grant more scopes than necessary
- Use HTTP redirect URIs in production
- Store tokens in localStorage (we use Firestore)

---

## 🐛 Troubleshooting

### Error: "redirect_uri_mismatch"

**Cause**: Redirect URI in code doesn't match Google Cloud Console

**Solution**:
1. Check `GOOGLE_REDIRECT_URI` in Netlify
2. Verify it matches exactly in Google Cloud Console → Credentials
3. Make sure it includes `https://` and the exact domain
4. No trailing slash!

### Error: "invalid_client"

**Cause**: Client ID or Secret is incorrect

**Solution**:
1. Verify `GOOGLE_CLIENT_ID` in Netlify matches Google Cloud Console
2. Verify `GOOGLE_CLIENT_SECRET` is correct
3. Check for extra spaces or quotes
4. Regenerate credentials if needed

### Error: "access_denied"

**Cause**: User denied permission or app is not verified

**Solution**:
1. Grant permission when prompted
2. Add your Gmail to "Test users" in OAuth consent screen
3. If app needs verification for production, submit to Google

### Error: "Scope not found: gmail.send"

**Cause**: Gmail API not enabled or scope not configured

**Solution**:
1. Enable Gmail API in Google Cloud Console
2. Add `https://www.googleapis.com/auth/gmail.send` scope in OAuth consent screen

### Netlify Function Timeout

**Cause**: Gmail API is slow or OAuth process taking too long

**Solution**:
1. Check function logs in Netlify
2. Increase function timeout if needed (max 26s on free plan)
3. Verify network connectivity

---

## 📊 Environment Variables Checklist

Use this checklist to verify all variables are set:

- [ ] `GOOGLE_CLIENT_ID` - Added to Netlify
- [ ] `GOOGLE_CLIENT_SECRET` - Added to Netlify (keep secret!)
- [ ] `GOOGLE_REDIRECT_URI` - Added to Netlify (correct domain!)
- [ ] `FIREBASE_PRIVATE_KEY` - Already exists
- [ ] `FIREBASE_CLIENT_EMAIL` - Already exists
- [ ] `FIREBASE_PROJECT_ID` - Already exists
- [ ] `ANTHROPIC_API_KEY` - Already exists
- [ ] `FIREBASE_API_KEY` - Already exists
- [ ] Gmail API - Enabled in Google Cloud
- [ ] OAuth Consent Screen - Configured
- [ ] Redirect URIs - Authorized in Google Cloud
- [ ] Site - Redeployed after adding variables

---

## 🎉 Ready to Test!

Once all variables are set and the site is redeployed:

1. Visit `/hunter`
2. Connect Gmail
3. Create a campaign
4. Send your first email!

---

**Last Updated**: 2026-01-15
**Hunter MVP Version**: 1.0
**Required Netlify Functions**: gmail-oauth-init, gmail-oauth-callback, gmail-send, generate-campaign-messages
