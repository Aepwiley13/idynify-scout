# 🚀 Deployment Guide - Idynify Scout

This guide covers deploying the Idynify Scout platform to Netlify with all services configured.

---

## 📋 Prerequisites

Before deploying, ensure you have:

1. ✅ **Netlify Account** - [Sign up here](https://netlify.com)
2. ✅ **Firebase Project** - [Create project](https://console.firebase.google.com)
3. ✅ **Anthropic API Key** - [Get key](https://console.anthropic.com)
4. ✅ **Stripe Account** (for production) - [Sign up](https://stripe.com)

---

## 🔧 Step 1: Firebase Setup

### 1.1 Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Name it (e.g., "idynify-scout-prod")
4. Disable Google Analytics (optional)

### 1.2 Enable Firebase Authentication
1. In Firebase Console → Authentication → Get started
2. Enable "Email/Password" provider
3. Save

### 1.3 Create Firestore Database
1. In Firebase Console → Firestore Database → Create database
2. Start in **production mode**
3. Choose your region
4. Click "Enable"

### 1.4 Set Firestore Security Rules
Go to Firestore → Rules and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own user document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Users can read/write their own dashboard
    match /dashboards/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 1.4b Deploy Firestore Indexes

`firestore.indexes.json` is the source of truth for composite indexes. **Nothing
deploys it on merge** — Netlify builds the frontend only, and CI runs tests
only. Indexes reach Firebase when someone deploys them.

```bash
cd functions
npm run deploy:indexes     # indexes alone
npm run deploy             # functions + indexes together
```

Indexes take a few minutes to build. Queries against a missing index fail with
`FirebaseError: The query requires an index` and the message carries a console
link that creates it.

**Create indexes through this file, not the console link.** An index created by
clicking the link exists in that one project and nowhere else — the file stays
unaware of it, and a fresh environment deployed from this repo comes up without
it. That is exactly how the `contacts (is_archived, name)` index went missing:
it existed in production from earlier manual work, was absent from the repo, and
the failure only surfaced when a new query needed it.

To check what a project actually has, against what the repo declares:

```bash
firebase firestore:indexes            # what is deployed
cat ../firestore.indexes.json         # what the repo declares
```

### 1.5 Get Firebase Config (Client-Side)
1. Go to Project Settings → General → Your apps
2. Click "Web app" (</> icon)
3. Register app (name: "Idynify Scout Web")
4. Copy the config object - you'll need these values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

### 1.6 Generate Service Account Key (Server-Side)
1. Go to Project Settings → Service accounts
2. Click "Generate new private key"
3. Download the JSON file
4. You'll need:
   - `project_id`
   - `client_email`
   - `private_key`

---

## 🔐 Step 2: Anthropic API Setup

1. Go to [Anthropic Console](https://console.anthropic.com)
2. Navigate to API Keys
3. Create a new key
4. Copy the key (starts with `sk-ant-api03-`)

---

## 💳 Step 3: Stripe Setup (Production Only)

### 3.1 Create Stripe Account
1. Sign up at [Stripe.com](https://stripe.com)
2. Activate your account

### 3.2 Get API Keys
1. Go to Developers → API Keys
2. Copy:
   - **Secret key** (starts with `sk_test_` or `sk_live_`)

### 3.3 Set Up Webhook
1. Go to Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://your-site.netlify.app/.netlify/functions/stripe-webhook`
3. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Add endpoint
5. Copy the **Signing secret** (starts with `whsec_`)

---

## 🌐 Step 4: Deploy to Netlify

### 4.1 Connect Repository
1. Log in to Netlify
2. Click "Add new site" → "Import an existing project"
3. Choose your Git provider (GitHub)
4. Select the `idynify-scout` repository
5. Configure build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
6. Click "Deploy site"

### 4.2 Configure Environment Variables
Go to Site settings → Environment variables → Add variables:

**Client-Side Variables (Vite):**
```bash
VITE_FIREBASE_API_KEY=<from Firebase step 1.5>
VITE_FIREBASE_AUTH_DOMAIN=<from Firebase step 1.5>
VITE_FIREBASE_PROJECT_ID=<from Firebase step 1.5>
VITE_FIREBASE_STORAGE_BUCKET=<from Firebase step 1.5>
VITE_FIREBASE_MESSAGING_SENDER_ID=<from Firebase step 1.5>
VITE_FIREBASE_APP_ID=<from Firebase step 1.5>
VITE_STRIPE_ENABLED=false  # Set to 'true' when ready for production
```

**Server-Side Variables (Netlify Functions):**
```bash
FIREBASE_PROJECT_ID=<from step 1.6>
FIREBASE_CLIENT_EMAIL=<from step 1.6>
FIREBASE_PRIVATE_KEY=<from step 1.6 - include newlines as \n>
ANTHROPIC_API_KEY=<from step 2>
STRIPE_SECRET_KEY=<from step 3.2>
STRIPE_WEBHOOK_SECRET=<from step 3.3>
```

**⚠️ Important:** For `FIREBASE_PRIVATE_KEY`, paste the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`, with `\n` for newlines.

### 4.3 Trigger Redeploy
1. After adding all environment variables
2. Go to Deploys → Trigger deploy → Deploy site
3. Wait for build to complete (~2-3 minutes)

---

## ✅ Step 5: Verify Deployment

### 5.1 Test Authentication
1. Visit your Netlify URL
2. Click "Sign Up"
3. Create a test account
4. Verify you're redirected to checkout

### 5.2 Test Payment Flow

**Development Mode (VITE_STRIPE_ENABLED=false):**
1. Click "Complete Purchase"
2. Should simulate payment and redirect to success page

**Production Mode (VITE_STRIPE_ENABLED=true):**
1. Click "Complete Purchase"
2. Should redirect to Stripe Checkout
3. Use test card: `4242 4242 4242 4242`
4. Any future expiry date
5. Any CVC
6. Complete payment
7. Verify redirect back to success page

### 5.3 Test RECON Module
1. After payment, should redirect to Mission Control
2. Click "START MODULE" on RECON
3. Verify Section 1 loads
4. Fill in a few fields
5. Wait 30 seconds - verify auto-save console log
6. Refresh page - verify data persists
7. Complete Section 1
8. Verify Section 2 unlocks
9. Complete Section 2
10. Verify Section 3 unlocks (confirms all sections wired up)

---

## 🐛 Troubleshooting

### Build Fails
- Check build logs in Netlify
- Verify all dependencies in `package.json`
- Ensure Node version is compatible (check `package.json` engines field)

### Authentication Doesn't Work
- Verify Firebase config is correct
- Check Firestore security rules
- Ensure Firebase Auth is enabled

### Payment Fails
- **Dev mode:** Check console for errors
- **Prod mode:**
  - Verify Stripe keys are correct
  - Check webhook is configured
  - View Stripe Dashboard → Logs for errors

### Sections Don't Load
- Check browser console for import errors
- Verify all section components exist in `/src/components/recon/`
- Check Netlify function logs for API errors

### AI Generation Fails
- Verify Anthropic API key is valid
- Check Netlify function logs
- Ensure you have API credits

---

## 📊 Monitoring

### Netlify Analytics
- Go to Site → Analytics
- Monitor traffic, performance, errors

### Stripe Dashboard
- Monitor payments
- View subscription status
- Check failed payments

### Firebase Console
- Monitor Firestore usage
- Check authentication logs
- Review security rules

---

## 🔄 Updates & Maintenance

### Deploy New Changes
1. Push to your Git repository
2. Netlify auto-deploys from main branch
3. Or manually trigger deploy in Netlify dashboard

### Update Environment Variables
1. Netlify → Site settings → Environment variables
2. Edit variable
3. Trigger redeploy for changes to take effect

### Rotate API Keys
1. Generate new key in respective service
2. Update in Netlify environment variables
3. Redeploy site
4. Revoke old key

---

## 🚨 Production Checklist

Before going live:

- [ ] Firebase security rules are set
- [ ] Stripe webhook is configured
- [ ] All environment variables are production values
- [ ] `VITE_STRIPE_ENABLED=true`
- [ ] Tested full user flow end-to-end
- [ ] Backup strategy for Firestore data
- [ ] Error monitoring configured (Sentry, LogRocket, etc.)
- [ ] Analytics configured (Google Analytics, Mixpanel, etc.)
- [ ] Custom domain configured in Netlify
- [ ] SSL certificate active

---

## 📞 Support

For issues:
1. Check Netlify function logs
2. Check browser console
3. Review Firebase logs
4. Check Stripe dashboard

---

**Deployment complete!** 🎉

Your Idynify Scout platform should now be fully operational with:
- ✅ User authentication
- ✅ Payment processing (Stripe or simulation)
- ✅ All 9 RECON sections
- ✅ Auto-save functionality
- ✅ AI-powered section generation
- ✅ Unified state management
