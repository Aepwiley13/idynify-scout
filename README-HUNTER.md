# 🎯 Hunter MVP - Quick Start Guide

## What is Hunter?

Hunter is Idynify's **outreach execution module** that allows users to:
- Create personalized email campaigns
- Send emails from their Gmail account
- Use RECON intelligence for better messaging
- Launch campaigns directly from Scout leads

---

## 📦 What Was Built

✅ **3 New Pages**:
- Hunter Dashboard (`/hunter`)
- Create Campaign (`/hunter/campaign/new`)
- Campaign Detail (`/hunter/campaign/:id`)

✅ **4 Netlify Functions**:
- Gmail OAuth initialization
- Gmail OAuth callback
- AI message generation (with RECON)
- Gmail email sending

✅ **Scout Integration**:
- "Start Campaign" button in Contact Detail modal
- Bulk select + "Start Campaign" in All Leads

✅ **Mission Control**:
- Hunter card unlocked and active

---

## 🚀 Deployment Steps

### 1. Set Up Google OAuth (Required!)

Follow the detailed guide: **`HUNTER-ENV-SETUP.md`**

Quick summary:
1. Create Google Cloud project
2. Enable Gmail API
3. Configure OAuth consent screen
4. Create OAuth 2.0 credentials
5. Add 3 environment variables to Netlify:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`

### 2. Update Firestore Rules (Required!)

Follow the guide: **`HUNTER-FIRESTORE-RULES.md`**

Add these 2 rules to Firebase Console:
```javascript
// Campaigns
match /users/{userId}/campaigns/{campaignId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}

// Gmail Integration
match /users/{userId}/integrations/gmail {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

### 3. Deploy to Netlify

```bash
# Commit changes
git add .
git commit -m "Add Hunter MVP - outreach execution module"
git push origin claude/hunter-mvp-JQl0C

# Netlify will auto-deploy
# After deploy completes, go to Netlify and add environment variables
# Then redeploy to apply the variables
```

### 4. Test End-to-End

1. Go to `/hunter`
2. Click "Connect Gmail"
3. Approve permissions
4. Create a campaign
5. Send a test email to yourself

---

## 📚 Documentation Files

- **`HUNTER-BUILD-COMPLETE.md`** - Complete build summary (features, files, testing)
- **`HUNTER-ENV-SETUP.md`** - Google OAuth & environment variables setup
- **`HUNTER-FIRESTORE-RULES.md`** - Firestore security rules
- **`README-HUNTER.md`** - This file (quick start)

---

## 🎯 User Flow

### Flow 1: Scout → Hunter (Single Contact)
1. User in Scout "All Leads"
2. Click contact → Contact Detail modal
3. Click "Start Campaign" button
4. → Redirects to Hunter with contact pre-selected
5. Generate AI email → Edit → Send

### Flow 2: Scout → Hunter (Bulk)
1. User in Scout "All Leads"
2. Select multiple contacts (checkboxes)
3. Click "Start Campaign (X)" button
4. → Redirects to Hunter with contacts pre-selected
5. Generate AI emails → Edit → Send one-by-one

### Flow 3: Hunter Native
1. User navigates to `/hunter` from Mission Control
2. Click "Create Campaign"
3. Select contacts manually
4. Generate AI emails → Edit → Send

---

## 🔐 Security Features

- ✅ OAuth tokens stored securely in Firestore
- ✅ Minimal Gmail scope (`gmail.send` only)
- ✅ All emails require user review & approval
- ✅ No automation without explicit user action
- ✅ Firestore rules prevent cross-user access

---

## ✨ Key Features

- **AI-Powered**: Claude generates personalized emails
- **RECON Integration**: Uses pain points & messaging preferences
- **User Control**: Edit every email before sending
- **One-by-One**: Send emails manually (no automation)
- **Status Tracking**: See which emails have been sent
- **Scout Integration**: Launch campaigns from leads

---

## 🧪 Testing Checklist

Before launching to users:

- [ ] Connect Gmail successfully
- [ ] Create campaign from Hunter (native)
- [ ] Create campaign from Scout (single contact)
- [ ] Create campaign from Scout (bulk)
- [ ] Generate messages (verify RECON usage if applicable)
- [ ] Edit message subject & body
- [ ] Send email to yourself
- [ ] Verify email arrives in Gmail inbox
- [ ] Check campaign status updates to "sent"
- [ ] Verify sent timestamp is correct

---

## 🐛 Troubleshooting

### "redirect_uri_mismatch"
- Check `GOOGLE_REDIRECT_URI` matches Google Cloud Console exactly
- Must include `https://` and your Netlify domain
- No trailing slash

### "Invalid authentication token"
- User not logged in
- Token expired
- Verify Firebase auth is working

### "Gmail not connected"
- Complete OAuth flow first
- Check Firestore for `users/{uid}/integrations/gmail`
- Verify status is "connected"

### Emails not sending
- Check Gmail quota (500/day)
- Verify access token hasn't expired
- Check Netlify function logs

---

## 📊 What's NOT in MVP

By design, Hunter v1.0 does NOT include:

- ❌ Email sequences (coming in v1.2)
- ❌ Reply tracking (coming in v1.3)
- ❌ Open tracking (coming in v1.3)
- ❌ Scheduled sending (coming in v2.0)
- ❌ Draft saving (coming in v1.1)
- ❌ Campaign templates (coming in v1.1)

**Why?** MVP focuses on core value: user-controlled, personalized outreach.

---

## 🎉 Success Criteria

Hunter MVP is successful when a user can:

1. Connect Gmail in <30 seconds
2. Create their first campaign in <3 minutes
3. Send their first email in <5 minutes total
4. See the email in the recipient's inbox
5. Feel confident the message is personalized and relevant

---

## 📞 Need Help?

1. **Read the docs**:
   - `HUNTER-BUILD-COMPLETE.md` - Full details
   - `HUNTER-ENV-SETUP.md` - OAuth setup
   - `HUNTER-FIRESTORE-RULES.md` - Security rules

2. **Check logs**:
   - Netlify function logs
   - Browser console
   - Firebase Firestore console

3. **Common issues**:
   - OAuth redirect mismatch
   - Environment variables not set
   - Firestore rules not published
   - Gmail quota exceeded

---

## 🚀 You're Ready!

**Status**: ✅ BUILD COMPLETE

**Next Steps**:
1. Set up Google OAuth
2. Update Firestore rules
3. Deploy & test
4. Launch to users!

---

**Built**: 2026-01-15
**Version**: 1.0.0 (MVP)
**Breaking Changes**: None
**New Dependencies**: googleapis

**Happy Hunting! 🎯**
