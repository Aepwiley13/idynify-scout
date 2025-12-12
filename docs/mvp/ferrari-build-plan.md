# 🏎️ FERRARI BUILD PLAN
## Idynify Scout MVP - Complete Module Sequence

---

# 📊 BUILD OVERVIEW

**Total Modules**: 15
**Estimated Time**: 6-12 hours
**Build Order**: Sequential (each module depends on previous)
**Testing**: Manual after each module

---

# MODULE SEQUENCE

## 🔧 MODULE 1: FOUNDATION SETUP
**Dependencies**: None
**Time**: 30 minutes

### What to Build:
1. **Project Structure**
   - Confirm existing React app structure
   - Verify Netlify deployment config
   - Verify Firebase project connection

2. **Routing Setup**
   - Install/verify React Router
   - Create route structure:
     - `/dashboard`
     - `/icp`
     - `/companies`
     - `/scout`
     - `/add-company`
     - `/lead-review`

3. **Firebase Auth Integration**
   - Verify Firebase Auth is configured
   - Create protected route wrapper
   - Add auth state listener

### Required Assets:
- Firebase project credentials
- Netlify account access

### Success Criteria:
- [ ] All routes accessible
- [ ] Auth redirects work (unauthenticated → login)
- [ ] User can sign up and log in

---

## 🗄️ MODULE 2: DATABASE SCHEMA
**Dependencies**: Module 1
**Time**: 30 minutes

### What to Build:
1. **Firestore Collections Structure**
   ```
   users/{userId}/
     ├── profile
     ├── subscription
     ├── icp
     ├── icpBrief
     ├── weights/
     │   ├── current
     │   └── history/{versionId}
     ├── companies/{companyId}
     ├── leads/{leadId}
     ├── events/{eventId}
     └── quotas/
         ├── daily_enrichments
         └── weekly_enrichments
   ```

2. **Firestore Security Rules**
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

3. **Initial Weight Defaults** (code constant)
   ```javascript
   const DEFAULT_WEIGHTS = {
     title_match_weight: 30,
     industry_match_weight: 20,
     company_size_weight: 10
   };
   ```

### Required Assets:
- Firestore access

### Success Criteria:
- [ ] Security rules deployed
- [ ] Test document created in Firestore
- [ ] Default weights constant defined

---

## 🔑 MODULE 3: ENVIRONMENT & API SETUP
**Dependencies**: Module 1
**Time**: 20 minutes

### What to Build:
1. **Environment Variables** (Netlify)
   ```
   APOLLO_API_KEY=your_apollo_key
   ANTHROPIC_API_KEY=your_anthropic_key
   STRIPE_SECRET_KEY=your_stripe_key
   FIREBASE_CONFIG=your_firebase_config
   ```

2. **Netlify Functions Folder Structure**
   ```
   netlify/functions/
     ├── apolloCompanyLookup.js
     ├── apolloContactSuggest.js
     ├── apolloContactEnrich.js
     ├── learningEngine.js
     └── generateICPBrief.js
   ```

3. **API Client Helpers** (frontend)
   ```javascript
   // src/utils/apiClient.js
   - callNetlifyFunction()
   - handleAPIError()
   ```

### Required Assets:
- Apollo API key
- Anthropic API key
- Stripe API key

### Success Criteria:
- [ ] Environment variables set in Netlify
- [ ] Function folder created
- [ ] API client helper created

---

## 📝 MODULE 4: ICP BUILDER (RECON Phase Start)
**Dependencies**: Modules 1, 2, 3
**Time**: 45 minutes

### What to Build:
1. **Components**
   - `ICPBuilder.jsx` - Multi-step form
   - `ICPStep1.jsx` - Industries (multi-select)
   - `ICPStep2.jsx` - Company sizes (multi-select)
   - `ICPStep3.jsx` - Target titles (multi-select)
   - `ICPStep4.jsx` - Geographic territories (multi-select)

2. **Form State Management**
   - Use React state or form library
   - Validate all fields before submit
   - Save to Firestore: `users/{userId}/icp`

3. **Route**: `/icp`

### Required Assets:
- Predefined options for:
  - Industries (array of 20+ options)
  - Company sizes (array: 1-10, 11-50, 51-200, 201-1000, 1000+)
  - Common titles (array: CEO, VP Sales, Director, etc.)
  - Territories (array: US, Canada, UK, EU, etc.)

### Success Criteria:
- [ ] User can complete all 4 steps
- [ ] Data saves to Firestore `users/{userId}/icp`
- [ ] Form validation works
- [ ] User redirected after submit

---

## 🤖 MODULE 5: ICP BRIEF GENERATION
**Dependencies**: Module 4
**Time**: 40 minutes

### What to Build:
1. **Netlify Function**: `generateICPBrief.js`
   - Input: `{ userId, icpData }`
   - Call Anthropic API with Claude Sonnet 4
   - Prompt: "Generate a 1-page ICP Brief based on: [icpData]"
   - Save to Firestore: `users/{userId}/icpBrief`
   - Return: `{ text, generatedAt }`

2. **Component**: `ICPBriefView.jsx`
   - Display generated brief
   - Download as PDF button (use jsPDF or similar)
   - CTA: "Match Companies to Your ICP"

3. **Route**: `/icp-brief` or modal on `/icp`

### Required Assets:
- Anthropic API key (from Module 3)
- jsPDF library or PDF generation tool

### Success Criteria:
- [ ] Brief generates from ICP data
- [ ] Brief displays on screen
- [ ] Download PDF works
- [ ] Brief saves to Firestore

---

## 🏢 MODULE 6: COMPANY MATCHING
**Dependencies**: Module 5
**Time**: 60 minutes

### What to Build:
1. **Netlify Function**: `apolloCompanyLookup.js`
   - Input: `{ industries, sizes, keywords }`
   - Call Apollo: `GET /companies?query`
   - Parse response, extract `apollo_company_id`
   - Return: `[{ name, industry, size, website, apollo_company_id }]`

2. **Component**: `CompanyCard.jsx`
   - Display: name, industry, size, website
   - Checkbox to select company
   - Visual design (space theme)

3. **Component**: `CompanyList.jsx`
   - Fetch matched companies on mount
   - Display up to 20 companies
   - Track selected companies (state)
   - Button: "Add Manual Company"
   - Button: "Upgrade to Scout"

4. **Route**: `/companies`

### Required Assets:
- Apollo API key (from Module 3)
- Apollo API documentation

### Success Criteria:
- [ ] Companies fetch from Apollo
- [ ] User can select companies
- [ ] Selected companies save to Firestore `users/{userId}/companies`
- [ ] UI shows 20 companies max

---

## ➕ MODULE 7: MANUAL COMPANY ADD
**Dependencies**: Module 6
**Time**: 30 minutes

### What to Build:
1. **Component**: `AddCompanyForm.jsx`
   - Input: domain OR company name
   - Submit → call `apolloCompanyLookup` with domain/name
   - Display results (if found)
   - Add to selected companies

2. **Route**: `/add-company`

3. **Update `apolloCompanyLookup` Function**:
   - Accept `{ domain }` OR `{ companyName }` as input
   - Call Apollo: `GET /companies?domain=` or `?name=`

### Required Assets:
- None (uses existing Apollo function)

### Success Criteria:
- [ ] User can input domain or name
- [ ] Apollo lookup returns company
- [ ] Company added to Firestore `users/{userId}/companies`
- [ ] User redirected back to `/companies`

---

## 💳 MODULE 8: STRIPE UPGRADE
**Dependencies**: Module 6
**Time**: 40 minutes

### What to Build:
1. **Stripe Checkout Integration**
   - Button on `/companies`: "Upgrade to Scout"
   - Create Stripe checkout session ($10-49.99/month)
   - Redirect to Stripe hosted checkout
   - Success redirect: `/scout`
   - Cancel redirect: `/companies`

2. **Netlify Function**: `createStripeCheckout.js`
   - Input: `{ userId, priceId }`
   - Create Stripe session
   - Return: `{ sessionUrl }`

3. **Stripe Webhook Handler**: `stripeWebhook.js`
   - Listen for: `checkout.session.completed`
   - Update Firestore: `users/{userId}/subscription`
     - `{ tier: 'scout', status: 'active', startDate }`

### Required Assets:
- Stripe account
- Stripe price ID for Scout tier
- Stripe webhook secret

### Success Criteria:
- [ ] Checkout button works
- [ ] User redirected to Stripe
- [ ] Upon payment, subscription saved to Firestore
- [ ] User can access `/scout` route

---

## 🎯 MODULE 9: CONTACT SUGGESTIONS (SCOUT Phase Start)
**Dependencies**: Modules 6, 8
**Time**: 60 minutes

### What to Build:
1. **Netlify Function**: `apolloContactSuggest.js`
   - Input: `{ apollo_company_id, user_weights }`
   - Call Apollo: `GET /contacts?company_id={id}`
   - Apply simple scoring using user weights
   - Sort by score (desc)
   - Return top 10: `[{ name, title, apollo_person_id, score }]`

2. **Component**: `ContactCard.jsx`
   - Display: name, title, company
   - Button: "Accept Contact" (green)
   - Button: "Reject Contact" (red)
   - Link: "Request Alternates"

3. **Component**: `ContactSuggestions.jsx`
   - Fetch contacts for selected company
   - Display 10 ContactCards
   - Show quota: "X/5 contacts enriched today for [Company]"
   - Handle Accept/Reject actions

4. **Route**: `/scout`

### Required Assets:
- Apollo API (contacts endpoint)
- Current user weights from Firestore

### Success Criteria:
- [ ] Contacts fetch from Apollo for company
- [ ] 10 contacts display
- [ ] Accept/Reject buttons render
- [ ] Quota displays correctly

---

## 🧠 MODULE 10: LEARNING ENGINE - CORE LOGIC
**Dependencies**: Module 2
**Time**: 45 minutes

### What to Build:
1. **Netlify Function**: `learningEngine.js`
   - Input: `{ user_id, action_type, lead_data }`
   - Fetch current weights: `users/{userId}/weights/current`
   - Apply adjustment rules:
     - `accept_contact`: `+2` to all weights
     - `reject_contact`: `-1` to all weights
     - `lead_accuracy_accurate`: `+1` to all weights
     - `lead_accuracy_inaccurate`: `-3` to all weights
   - Clamp weights: min=0, max=50
   - Update `users/{userId}/weights/current`
   - Create version: `users/{userId}/weights/history/{versionId}`
   - Return: `{ new_weights, version_number }`

2. **Version Document Structure**:
   ```javascript
   {
     version_number: 1,
     timestamp: "2025-12-11T10:30:00Z",
     weights: { title: 32, industry: 22, company_size: 12 },
     action_source: "accept_contact",
     lead_id: "lead_abc123"
   }
   ```

### Required Assets:
- None (pure logic function)

### Success Criteria:
- [ ] Function accepts action_type
- [ ] Weights adjust correctly per rules
- [ ] Weights clamped to 0-50
- [ ] Version created in Firestore
- [ ] Current weights updated

---

## ✅ MODULE 11: ACCEPT CONTACT → ENRICH → LEARN
**Dependencies**: Modules 9, 10
**Time**: 60 minutes

### What to Build:
1. **Netlify Function**: `apolloContactEnrich.js`
   - Input: `{ apollo_person_id, user_id, company_id }`
   - **Check Quotas**:
     - Daily: `quotas/daily_enrichments/{companyId}` < 5 for today
     - Weekly: `quotas/weekly_enrichments/count` < 50 for this week
   - If under quota:
     - Call Apollo: `GET /contacts/{id}` (full enrichment)
     - Create Lead in Firestore: `users/{userId}/leads/{leadId}`
     - Log event: `users/{userId}/events/{eventId}`
     - Call `learningEngine` with `action_type: 'accept_contact'`
     - Update quotas
     - Return: `{ success: true, lead_id, new_weights }`
   - If over quota:
     - Return: `{ success: false, error: 'quota_exceeded' }`

2. **Update `ContactCard.jsx`**:
   - "Accept Contact" onClick:
     - Call `apolloContactEnrich`
     - Show loading state
     - On success:
       - Remove ContactCard from view
       - Show toast: "✅ Barry updated your targeting preferences"
       - Display next contact
     - On quota_exceeded:
       - Show upgrade modal

3. **Component**: `LearningToast.jsx`
   - Toast notification component
   - Message: "Barry updated your targeting preferences based on your action"
   - Auto-dismiss after 3 seconds
   - Green checkmark icon

### Required Assets:
- Apollo API (contact enrichment endpoint)

### Success Criteria:
- [ ] Accept button triggers enrichment
- [ ] Lead created in Firestore
- [ ] Event logged in Firestore
- [ ] Weights updated via learningEngine
- [ ] Quota incremented
- [ ] Toast displays
- [ ] Next contact shown

---

## ❌ MODULE 12: REJECT CONTACT → LEARN
**Dependencies**: Modules 9, 10
**Time**: 30 minutes

### What to Build:
1. **Update `ContactCard.jsx`**:
   - "Reject Contact" onClick:
     - Log event: `users/{userId}/events/{eventId}`
       ```javascript
       {
         action_type: "reject_contact",
         apollo_person_id: "p_abc456",
         title: "Marketing Manager",
         industry: "SaaS",
         company_size: "50-200",
         timestamp: now
       }
       ```
     - Call `learningEngine` with `action_type: 'reject_contact'`
     - Remove ContactCard from view
     - Show toast: "✅ Barry updated your targeting preferences"
     - Display next contact

2. **No Enrichment** (reject doesn't create lead)

### Required Assets:
- None (uses existing learningEngine)

### Success Criteria:
- [ ] Reject button triggers event log
- [ ] Weights updated via learningEngine
- [ ] Contact removed from view
- [ ] Toast displays
- [ ] Next contact shown

---

## 🔄 MODULE 13: REQUEST ALTERNATES (No Learning)
**Dependencies**: Module 9
**Time**: 20 minutes

### What to Build:
1. **Update `ContactSuggestions.jsx`**:
   - "Request Alternates" onClick:
     - Track previously shown `apollo_person_id`s
     - Call `apolloContactSuggest` with exclusion list
     - Replace current contacts with new suggestions
     - NO weight adjustment
     - NO event logging

2. **Update `apolloContactSuggest` Function**:
   - Accept `{ excludeIds: [] }` parameter
   - Filter out excluded IDs from results

### Required Assets:
- None (uses existing function)

### Success Criteria:
- [ ] Request Alternates shows new contacts
- [ ] Previously shown contacts excluded
- [ ] No learning occurs
- [ ] No toast displayed

---

## 📋 MODULE 14: LEAD REVIEW & ACCURACY VALIDATION
**Dependencies**: Module 11
**Time**: 60 minutes

### What to Build:
1. **Component**: `LeadList.jsx`
   - Fetch all leads: `users/{userId}/leads`
   - Display table/cards with:
     - Name, Title, Company, Enrichment Date, Status
   - Filters: All | Pending Review | Validated
   - Click lead → show LeadDetail

2. **Component**: `LeadDetail.jsx`
   - Display full lead info:
     - Name, Title, Email, Phone, LinkedIn
     - Company, Industry, Size
     - Enrichment Date
     - Current Status
   - Buttons:
     - "Lead Info Accurate" (green)
     - "Lead Info Incorrect" (red)
     - "Still Working / No Result" (gray)
     - "Export to CSV"
     - "Call Now" (opens phone dialer)
     - "Save for Later"

3. **Accuracy Validation Logic**:
   - "Lead Info Accurate" onClick:
     - Update lead: `status: "accurate", validated_at: now`
     - Log event: `action_type: "lead_accuracy", validation: "accurate"`
     - Call `learningEngine` with adjustment: `+1` to all weights
     - Show toast: "✅ Barry updated your targeting preferences"
   
   - "Lead Info Incorrect" onClick:
     - Update lead: `status: "inaccurate", validated_at: now`
     - Log event: `action_type: "lead_accuracy", validation: "inaccurate"`
     - Call `learningEngine` with adjustment: `-3` to all weights
     - Show toast: "✅ Barry updated your targeting preferences"
   
   - "Still Working / No Result" onClick:
     - Update lead: `status: "in_progress"` or `"no_result"`
     - NO weight adjustment
     - NO event logging
     - Show neutral feedback

4. **Route**: `/lead-review`

### Required Assets:
- CSV export library (e.g., papaparse)

### Success Criteria:
- [ ] Leads display in list
- [ ] User can click lead to see details
- [ ] Accuracy buttons trigger learning
- [ ] Weights updated correctly (+1 or -3)
- [ ] Toast displays
- [ ] Export CSV works
- [ ] Call Now opens dialer

---

## 🎨 MODULE 15: QUOTA DISPLAY & DASHBOARD
**Dependencies**: All previous modules
**Time**: 45 minutes

### What to Build:
1. **Component**: `QuotaDisplay.jsx`
   - Fetch quotas from Firestore:
     - `daily_enrichments/{companyId}` for current company
     - `weekly_enrichments/count`
   - Display:
     - "X/5 contacts enriched today for [Company]"
     - "X/50 leads enriched this week"
   - Visual progress bars
   - If quota exceeded: show upgrade CTA

2. **Update Dashboard** (`/dashboard`):
   - Show current phase status:
     - ✅ RECON complete
     - ✅ Subscribed to Scout
     - 🔄 SCOUT in progress
   - Quick stats:
     - Total leads enriched
     - Companies matched
     - Current weights (optional debug view)
   - CTAs:
     - "View My Leads"
     - "Find More Contacts"

3. **Navigation Bar**:
   - Links to: Dashboard, Companies, Scout, Lead Review
   - User menu (logout)
   - Barry bear icon/animation

### Required Assets:
- Space-themed UI assets (starfield background, Barry bear icon)

### Success Criteria:
- [ ] Quotas display correctly
- [ ] Dashboard shows phase status
- [ ] Navigation works between all routes
- [ ] UI matches space theme

---

# 📦 REQUIRED EXTERNAL ASSETS CHECKLIST

## APIs & Keys
- [ ] Apollo API key
- [ ] Anthropic API key (Claude)
- [ ] Stripe API key
- [ ] Stripe webhook secret
- [ ] Firebase project credentials

## UI Assets
- [ ] Barry bear mascot images (accept, reject, learning states)
- [ ] Space-themed background images/patterns
- [ ] Icon set (checkmarks, X's, stars, etc.)

## Data Assets
- [ ] Industries list (array of 20+ options)
- [ ] Company sizes list (5 tiers)
- [ ] Common job titles list (20+ titles)
- [ ] Geographic territories list (10+ regions)

## Libraries/Dependencies
- [ ] React Router
- [ ] Firebase SDK
- [ ] Stripe.js
- [ ] jsPDF (for ICP Brief download)
- [ ] papaparse (for CSV export)
- [ ] Toast notification library (or custom)

---

# 🔄 MODULE DEPENDENCY CHART

```
MODULE 1 (Foundation)
   ├─> MODULE 2 (Database)
   ├─> MODULE 3 (Environment)
   └─> MODULE 4 (ICP Builder)
          └─> MODULE 5 (ICP Brief)
                 └─> MODULE 6 (Company Matching)
                        ├─> MODULE 7 (Manual Add)
                        └─> MODULE 8 (Stripe Upgrade)
                               └─> MODULE 9 (Contact Suggestions)
                                      ├─> MODULE 10 (Learning Engine)
                                      ├─> MODULE 11 (Accept → Enrich → Learn)
                                      ├─> MODULE 12 (Reject → Learn)
                                      └─> MODULE 13 (Request Alternates)
                                             └─> MODULE 14 (Lead Review)
                                                    └─> MODULE 15 (Quotas & Dashboard)
```

---

# ✅ BUILD EXECUTION CHECKLIST

## Pre-Build
- [ ] All 4 frozen documents reviewed
- [ ] Apollo API access confirmed
- [ ] Anthropic API access confirmed
- [ ] Stripe account setup
- [ ] Firebase project ready
- [ ] All external assets gathered

## Build Sequence (Follow Module Order 1-15)
- [ ] Module 1: Foundation Setup
- [ ] Module 2: Database Schema
- [ ] Module 3: Environment & API Setup
- [ ] Module 4: ICP Builder
- [ ] Module 5: ICP Brief Generation
- [ ] Module 6: Company Matching
- [ ] Module 7: Manual Company Add
- [ ] Module 8: Stripe Upgrade
- [ ] Module 9: Contact Suggestions
- [ ] Module 10: Learning Engine - Core Logic
- [ ] Module 11: Accept Contact → Enrich → Learn
- [ ] Module 12: Reject Contact → Learn
- [ ] Module 13: Request Alternates
- [ ] Module 14: Lead Review & Accuracy Validation
- [ ] Module 15: Quota Display & Dashboard

## Post-Build Testing
- [ ] Complete user flow test (signup → lead enrichment)
- [ ] Learning engine test (verify weights change)
- [ ] Quota enforcement test (hit limits)
- [ ] Payment flow test (Stripe checkout)
- [ ] Export test (CSV download)

---

# 🚀 READY TO BUILD

This Ferrari Build Plan contains **15 sequential modules** that build the complete MVP exactly as specified in the frozen documents.

**No features added. No scope expanded. No logic changed.**
