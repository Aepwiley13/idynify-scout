# STEP 3: Credit System - Testing Checklist ✅

## Overview
This document provides a comprehensive testing checklist for the credit-based pricing system implemented in Module 15.

---

## 🧪 Pre-Deployment Testing

### 1. CreditBalance Component Tests

- [ ] **Display Test**: Component renders correctly with different props
  - [ ] Small size variant displays properly
  - [ ] Medium size variant displays properly
  - [ ] Large size variant displays properly
  - [ ] Show details toggle works correctly

- [ ] **Credit Calculation Test**:
  - [ ] Displays correct credit balance
  - [ ] Shows correct monthly allotment (400 for Starter, 1250 for Pro)
  - [ ] Calculates correct reset date (first day of next month)
  - [ ] Shows correct remaining enrichments (credits / 10)

- [ ] **Visual States Test**:
  - [ ] Normal state (credits > 10% of allotment) - cyan color
  - [ ] Low state (credits < 10% of allotment) - yellow color
  - [ ] Out state (credits < 10) - red color

- [ ] **Upgrade Prompt Test**:
  - [ ] Low credit warning appears when credits < 10% of allotment
  - [ ] Out of credits warning appears when credits < 10
  - [ ] Upgrade button redirects to /checkout

---

### 2. UpgradeModal Component Tests

- [ ] **Display Test**:
  - [ ] Modal opens when triggered
  - [ ] Modal closes when clicking X button
  - [ ] Modal closes when clicking "Not now" button
  - [ ] Current credits display correctly

- [ ] **Pricing Display Test**:
  - [ ] Starter plan shows $20/mo with 400 credits
  - [ ] Pro plan shows $50/mo with 1,250 credits
  - [ ] Pro plan shows "RECOMMENDED" badge
  - [ ] Cost breakdown shows correctly for both plans

- [ ] **Interaction Test**:
  - [ ] "Upgrade to Starter" button redirects to /checkout?tier=starter
  - [ ] "Upgrade to Pro" button redirects to /checkout?tier=pro
  - [ ] Processing state shows when upgrading

---

### 3. Enrich-Company Function Tests

- [ ] **Credit Check Test**:
  - [ ] Function returns 402 error when credits < 10
  - [ ] Error message includes current credits and required credits
  - [ ] Function proceeds when credits >= 10

- [ ] **Enrichment Test**:
  - [ ] Company data is enriched correctly
  - [ ] 3 contacts are returned with full data (name, email, phone, LinkedIn)
  - [ ] All enriched data is saved to Firestore

- [ ] **Credit Deduction Test**:
  - [ ] Exactly 10 credits are deducted per enrichment
  - [ ] Credits are deducted atomically (no race conditions)
  - [ ] New balance is returned in response

- [ ] **Event Logging Test**:
  - [ ] Enrichment event is logged to users/{userId}/events
  - [ ] Event includes all required fields:
    - type: 'company_enrichment'
    - companyId, companyName
    - creditsDeducted: 10
    - costBreakdown: {companyData: 1, contactNames: 3, emails: 3, phones: 3}
    - creditsRemaining
    - timestamp
    - contactsEnriched: 3

- [ ] **Error Handling Test**:
  - [ ] Returns 404 when user not found
  - [ ] Returns 400 when missing userId or companyId
  - [ ] Returns 500 with error message on enrichment failure

---

### 4. Mission Control Dashboard Integration Tests

- [ ] **Credit Display Test**:
  - [ ] CreditBalance component appears in Mission Control
  - [ ] Component updates in real-time when credits change
  - [ ] Shows correct details (allotment, reset date, remaining enrichments)

- [ ] **Layout Test**:
  - [ ] Credit Balance section displays properly
  - [ ] Section has purple border (border-purple-500/30)
  - [ ] Large size variant is used

---

### 5. ContactSuggestions Integration Tests

- [ ] **Credit Loading Test**:
  - [ ] User credits load on component initialization
  - [ ] Credits display in CreditBalance component

- [ ] **Credit Check Test**:
  - [ ] Accept button checks credits before enrichment
  - [ ] UpgradeModal appears when credits < 10
  - [ ] Enrichment proceeds when credits >= 10

- [ ] **Credit Update Test**:
  - [ ] Credits update after successful enrichment
  - [ ] CreditBalance component reflects new balance
  - [ ] User can see updated credit count immediately

- [ ] **Modal Integration Test**:
  - [ ] UpgradeModal shows current credits
  - [ ] Modal can be closed
  - [ ] User can continue browsing after closing modal

---

### 6. Admin Analytics Tests

- [ ] **Data Aggregation Test**:
  - [ ] Total credits used calculated correctly
  - [ ] Total enrichments counted correctly
  - [ ] Active users counted correctly
  - [ ] Starter vs Pro users counted correctly
  - [ ] Average credits per user calculated correctly

- [ ] **Top Users Test**:
  - [ ] Top 10 users sorted by credits used
  - [ ] User email, tier, credits used, enrichments, and remaining credits display

- [ ] **Revenue Estimation Test**:
  - [ ] Starter MRR = starterUsers * $20
  - [ ] Pro MRR = proUsers * $50
  - [ ] Total MRR calculated correctly

---

### 7. Firebase Schema Tests

- [ ] **User Document Test**:
  - [ ] credits field exists and is number type
  - [ ] monthlyCredits field exists and is number type
  - [ ] lastCreditReset field exists and is Timestamp type
  - [ ] lastCreditUpdate field exists and is Timestamp type

- [ ] **Events Subcollection Test**:
  - [ ] credit_usage events are created correctly
  - [ ] All required fields are present
  - [ ] Timestamps are accurate

---

## 🚀 Deployment Testing

### 1. Netlify Function Deployment

- [ ] **Build Test**:
  - [ ] enrich-company function builds successfully
  - [ ] Function is accessible at /.netlify/functions/enrich-company
  - [ ] Function timeout set to 900 seconds

- [ ] **Environment Variables Test**:
  - [ ] FIREBASE_PROJECT_ID is set
  - [ ] FIREBASE_CLIENT_EMAIL is set
  - [ ] FIREBASE_PRIVATE_KEY is set (with \\n replaced)

---

### 2. End-to-End User Flow Tests

#### Flow 1: New User Sign Up
- [ ] User signs up
- [ ] User gets monthly credit allotment based on tier
- [ ] Credits field is initialized in Firestore
- [ ] CreditBalance displays correct amount

#### Flow 2: Enriching a Company (Happy Path)
- [ ] User has >= 10 credits
- [ ] User clicks "Accept" on contact suggestion
- [ ] Credit check passes
- [ ] Enrichment function is called
- [ ] 10 credits are deducted
- [ ] Company and contact data saved to Firestore
- [ ] Event logged
- [ ] CreditBalance updates to show new balance
- [ ] User can continue enriching if credits remain

#### Flow 3: Out of Credits (Upgrade Path)
- [ ] User has < 10 credits
- [ ] User clicks "Accept" on contact suggestion
- [ ] UpgradeModal appears
- [ ] Modal shows current credits
- [ ] User clicks "Upgrade to Pro"
- [ ] Redirects to /checkout?tier=pro
- [ ] (Stripe integration handles upgrade)
- [ ] After upgrade, credits are replenished
- [ ] User can now enrich companies

#### Flow 4: Low Credits Warning
- [ ] User has between 10-40 credits (for Starter) or 10-125 (for Pro)
- [ ] Low credit warning appears in CreditBalance
- [ ] Warning includes upgrade button
- [ ] User can click upgrade or continue using

---

## 📊 Analytics & Monitoring

- [ ] **Credit Usage Tracking**:
  - [ ] Admin can view total credits used
  - [ ] Admin can see top credit users
  - [ ] Admin can track enrichments per user
  - [ ] Revenue estimates are accurate

---

## 🔧 Edge Cases

- [ ] **Race Condition Test**:
  - [ ] Two simultaneous enrichments don't cause double-deduction
  - [ ] Credit balance is always accurate

- [ ] **Negative Credits Test**:
  - [ ] Users cannot go into negative credits
  - [ ] Enrichment is blocked if credits would go negative

- [ ] **Monthly Reset Test**:
  - [ ] Credits reset on first day of month (manual testing or cron job)
  - [ ] Users get full monthly allotment

---

## ✅ Final Verification

- [ ] All components render without errors
- [ ] No console errors in browser
- [ ] Mobile responsive design works
- [ ] Credit flow works end-to-end
- [ ] Firebase security rules allow credit operations
- [ ] Netlify function logs show successful enrichments

---

## 🎯 Success Criteria

**This implementation is ready for production when:**

1. ✅ CreditBalance component displays correctly in all states
2. ✅ UpgradeModal triggers when credits are insufficient
3. ✅ Enrich-company function deducts credits correctly
4. ✅ All credit data is saved to Firestore
5. ✅ Admin analytics show accurate credit usage
6. ✅ User can upgrade when out of credits
7. ✅ No critical bugs in credit flow

---

## 📝 Known Limitations

1. **Stripe Integration**: Currently placeholder - needs real Stripe checkout
2. **Mock Enrichment Data**: enrich-company function uses mock data - replace with real API
3. **Monthly Reset**: No automated cron job for monthly credit reset yet

---

## 🔗 Related Files

**Components:**
- `/src/components/CreditBalance.jsx`
- `/src/components/UpgradeModal.jsx`
- `/src/components/AdminCreditAnalytics.jsx`
- `/src/components/ContactSuggestions.jsx` (updated)

**Pages:**
- `/src/pages/MissionControlDashboard.jsx` (updated)

**Functions:**
- `/netlify/functions/enrich-company.js`

**Schema:**
- `/src/firebase/schema.js` (updated with credit fields)

**Config:**
- `/netlify.toml` (updated with enrich-company timeout)

---

**Last Updated:** $(date)
**Module:** 15 - Credit System
**Status:** Ready for Testing
