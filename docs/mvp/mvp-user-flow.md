# MVP USER FLOW
## Idynify Scout MVP - Step-by-Step User Journey with Learning Engine

---

# 🚀 Phase 1: RECON (No Learning)

## **Step 1.1: Signup**
1. User visits landing page
2. Clicks "Get Started"
3. Creates account (email/password)
4. Redirected to `/dashboard`

---

## **Step 1.2: Complete ICP**
1. Dashboard shows: "Build Your ICP to Get Started"
2. User clicks "Build ICP" → `/icp`
3. Fills multi-step form:
   - Industries (multi-select)
   - Company sizes (multi-select)
   - Target titles (multi-select)
   - Geographic territories (multi-select)
4. Submits form
5. Barry generates ICP Brief (Claude API)
6. Success: "ICP Brief Ready!"

---

## **Step 1.3: View/Download ICP Brief**
1. User views brief on-screen
2. Option to download PDF
3. CTA: "Match Companies to Your ICP"

---

## **Step 1.4: Company Matching**
1. Barry calls Apollo API with ICP criteria
2. Displays 20 matched companies
3. User can:
   - Select companies (checkboxes)
   - Add manual company (`/add-company`)
4. CTA: "Upgrade to Scout" (Stripe checkout)

---

## **Step 1.5: Upgrade to Scout**
1. User clicks "Upgrade to Scout"
2. Stripe checkout ($10-49.99/month)
3. Upon success: `subscriptionTier: 'scout'` saved
4. Redirected to `/scout`

---

# 🔍 Phase 2: SCOUT (Learning Begins)

## **Step 2.1: View Contact Suggestions**
1. User lands on `/scout`
2. Sees first selected company: "Acme Corp"
3. Barry fetches top 10 contacts from Apollo
4. Displays ContactCard for each:
   - Name, Title, Company
   - "Accept Contact" button (green)
   - "Reject Contact" button (red)
   - "Request Alternates" link
5. Quota displayed: "2/5 contacts enriched today for Acme Corp"

---

## **Step 2.2a: ACCEPT CONTACT** ⚡ **Learning Event**

### **User Action**: 
Clicks "Accept Contact" on "John Doe - VP Sales"

### **System Flow**:

**1. Enrichment**:
- Call Apollo `GET /contacts/{apollo_person_id}`
- Fetch full data: email, phone, LinkedIn, etc.
- Check quota: Is user under 5/company/day and 50/week?
- If yes: proceed, else block with upgrade message

**2. Create Lead**:
```javascript
leads/{leadId}: {
  name: "John Doe",
  title: "VP Sales",
  email: "john@acme.com",
  phone: "+1-555-0100",
  company: "Acme Corp",
  industry: "SaaS",
  company_size: "50-200",
  enrichment_date: "2025-12-11T10:30:00Z",
  status: "pending_review",
  score_at_enrichment: 85,
  weights_at_enrichment: { title: 30, industry: 20, company_size: 10 }
}
```

**3. Log Event**:
```javascript
events/{eventId}: {
  timestamp: "2025-12-11T10:30:00Z",
  action_type: "accept_contact",
  lead_id: "lead_abc123",
  apollo_person_id: "p_xyz789",
  title: "VP Sales",
  industry: "SaaS",
  company_size: "50-200",
  prior_weights: { title: 30, industry: 20, company_size: 10 },
  new_weights: { title: 32, industry: 22, company_size: 12 }
}
```

**4. Adjust Weights** (Learning Engine):
- Current: `title: 30, industry: 20, company_size: 10`
- Adjustment: `+2` to all
- New: `title: 32, industry: 22, company_size: 12`
- Clamp to 0-50 bounds
- Save to `weights/current`

**5. Create Version**:
```javascript
weights/history/{versionId}: {
  version_number: 1,
  timestamp: "2025-12-11T10:30:00Z",
  weights: { title: 32, industry: 22, company_size: 12 },
  action_source: "accept_contact",
  lead_id: "lead_abc123"
}
```

**6. Update Quota**:
- `daily_enrichments/acme_corp: { count: 3, date: "2025-12-11" }`
- `weekly_enrichments: { count: 26 }`

**7. Show Feedback**:
- Toast notification: "✅ Barry updated your targeting preferences based on your action"
- ContactCard animates out
- Next contact appears

### **Result**: 
Lead created, weights increased, user sees next contact

---

## **Step 2.2b: REJECT CONTACT** ⚡ **Learning Event**

### **User Action**: 
Clicks "Reject Contact" on "Jane Smith - Marketing Manager"

### **System Flow**:

**1. Log Event**:
```javascript
events/{eventId}: {
  timestamp: "2025-12-11T10:32:00Z",
  action_type: "reject_contact",
  apollo_person_id: "p_abc456",
  title: "Marketing Manager",
  industry: "SaaS",
  company_size: "50-200",
  prior_weights: { title: 32, industry: 22, company_size: 12 },
  new_weights: { title: 31, industry: 21, company_size: 11 }
}
```

**2. Adjust Weights**:
- Current: `title: 32, industry: 22, company_size: 12`
- Adjustment: `-1` to all
- New: `title: 31, industry: 21, company_size: 11`

**3. Create Version**:
```javascript
weights/history/{versionId}: {
  version_number: 2,
  timestamp: "2025-12-11T10:32:00Z",
  weights: { title: 31, industry: 21, company_size: 11 },
  action_source: "reject_contact",
  lead_id: null
}
```

**4. Show Feedback**:
- Toast: "✅ Barry updated your targeting preferences based on your action"
- ContactCard removed from view
- Next contact appears

### **Result**: 
No lead created, weights decreased, contact removed

---

## **Step 2.2c: REQUEST ALTERNATES** (No Learning)

### **User Action**: 
Clicks "Request Alternates"

### **System Flow**:
1. Fetch new Apollo contacts (exclude previously shown IDs)
2. Apply current weights to score new contacts
3. Display top 10 new suggestions
4. NO weight adjustment
5. NO event logged

### **Result**: 
User sees different contacts, no learning occurs

---

## **Step 2.3: Move to Next Company**
1. After reviewing all contacts for Acme Corp
2. System automatically shows next selected company
3. Repeat Step 2.1-2.2 for each company

---

# ✅ Phase 3: LEAD REVIEW (Learning Continues)

## **Step 3.1: Navigate to Lead List**
1. User clicks "My Leads" in nav
2. Redirected to `/lead-review`
3. Sees list of all enriched leads:
   - Filter: All | Pending Review | Validated
   - Columns: Name, Title, Company, Enrichment Date, Status

---

## **Step 3.2: View Lead Details**
1. User clicks on "John Doe - VP Sales"
2. Modal or expanded view shows:
   - Full contact info (email, phone, LinkedIn)
   - Company details
   - Enrichment date
   - Current status

---

## **Step 3.3a: MARK ACCURATE** ⚡ **Learning Event**

### **User Action**: 
Clicks "Lead Info Accurate"

### **System Flow**:

**1. Update Lead**:
```javascript
leads/lead_abc123: {
  status: "accurate",
  validated_at: "2025-12-11T11:00:00Z"
}
```

**2. Log Event**:
```javascript
events/{eventId}: {
  timestamp: "2025-12-11T11:00:00Z",
  action_type: "lead_accuracy",
  validation: "accurate",
  lead_id: "lead_abc123",
  title: "VP Sales",
  industry: "SaaS",
  company_size: "50-200",
  prior_weights: { title: 31, industry: 21, company_size: 11 },
  new_weights: { title: 32, industry: 22, company_size: 12 }
}
```

**3. Adjust Weights**:
- Current: `title: 31, industry: 21, company_size: 11`
- Adjustment: `+1` to all
- New: `title: 32, industry: 22, company_size: 12`

**4. Create Version**:
```javascript
weights/history/{versionId}: {
  version_number: 3,
  timestamp: "2025-12-11T11:00:00Z",
  weights: { title: 32, industry: 22, company_size: 12 },
  action_source: "lead_accuracy_accurate",
  lead_id: "lead_abc123"
}
```

**5. Show Feedback**:
- Toast: "✅ Barry updated your targeting preferences based on your validation"
- Lead card shows green checkmark
- Status changes to "Validated"

### **Result**: 
Weights reinforced, lead marked accurate

---

## **Step 3.3b: MARK INACCURATE** ⚡ **Learning Event**

### **User Action**: 
Clicks "Lead Info Incorrect"

### **System Flow**:

**1. Update Lead**: 
`status: "inaccurate"`

**2. Log Event**: 
`action_type: "lead_accuracy", validation: "inaccurate"`

**3. Adjust Weights**:
- Current: `title: 32, industry: 22, company_size: 12`
- Adjustment: `-3` to all
- New: `title: 29, industry: 19, company_size: 9`

**4. Create Version**: 
(version 4 with new weights)

**5. Show Feedback**:
- Toast: "✅ Barry updated your targeting preferences to avoid similar leads"
- Lead card shows red X
- Status changes to "Needs Review"

### **Result**: 
Weights penalized, lead flagged for review

---

## **Step 3.3c: STILL WORKING / NO RESULT** (No Learning)

### **User Action**: 
Clicks "Still Working" or "No Result"

### **System Flow**:
1. Update lead status to "in_progress" or "no_result"
2. NO weight adjustment
3. NO event logged
4. Show neutral feedback

### **Result**: 
Status updated, no learning occurs

---

## **Step 3.4: Export & Call Actions**
1. User clicks "Export to CSV" → downloads all validated leads
2. User clicks "Call Now" → opens phone dialer with lead's number
3. User clicks "Save for Later" → flags lead for follow-up

---

# ♻️ Learning Loop Visualization

```
User Journey                Learning Engine
─────────────────          ─────────────────
                                    
[Accept Contact] ────────> Log Event
      │                    Adjust Weights (+2)
      │                    Create Version
      │                    Show "Barry Learned"
      ▼
[Lead Created]
      │
      ▼
[Validate Accurate] ─────> Log Event
      │                    Adjust Weights (+1)
      │                    Create Version
      │                    Show "Barry Learned"
      ▼
[Next Lead Enrichment] ──> Uses NEW Weights
                           (title: 33, industry: 23, ...)
```

---

# 🔢 Learning Engine State Progression Example

| Event | Action | Title Weight | Industry Weight | Company Size Weight | Version |
|-------|--------|--------------|-----------------|---------------------|---------|
| Start | - | 30 | 20 | 10 | 0 |
| 1 | Accept Contact | 32 (+2) | 22 (+2) | 12 (+2) | 1 |
| 2 | Reject Contact | 31 (-1) | 21 (-1) | 11 (-1) | 2 |
| 3 | Lead Accurate | 32 (+1) | 22 (+1) | 12 (+1) | 3 |
| 4 | Accept Contact | 34 (+2) | 24 (+2) | 14 (+2) | 4 |
| 5 | Lead Inaccurate | 31 (-3) | 21 (-3) | 11 (-3) | 5 |

---

# 🎯 Success Path Summary

## **Ideal MVP User Journey**:
1. Signup → Complete ICP → View Brief → Match Companies (RECON complete)
2. Upgrade to Scout → Accept first contact → Lead enriched ✅ **SUCCESS METRIC HIT**
3. Validate lead accuracy → Barry learns and improves
4. Export leads → Use in sales process
5. Return next day → Repeat with better targeting

## **Learning Engine Outcomes**:
- After 10 Accept actions: Weights increased by +20 across all criteria
- After 5 Reject actions: Weights decreased by -5 across all criteria
- After 3 Accurate validations: Weights reinforced by +3
- After 1 Inaccurate validation: Weights penalized by -3
- **Net Result**: Barry increasingly suggests contacts matching user's preferences

---

# 📊 User Feedback Points

The user receives feedback ("Barry learned from your action") at these exact moments:

✅ **Shows Toast**:
- After Accept Contact
- After Reject Contact
- After marking Lead Info Accurate
- After marking Lead Info Incorrect

❌ **Does NOT Show Toast**:
- After Request Alternates
- After marking Still Working / No Result
- During any other navigation or action

---

# 🚫 No Learning Occurs When:
- User requests alternates
- User marks lead "Still Working" or "No Result"
- User navigates between pages
- User views ICP or companies
- User exports data
- User calls a contact

---

# ✅ Complete User Flow Checklist

- [ ] User signs up successfully
- [ ] User completes ICP Builder (all 4 steps)
- [ ] ICP Brief generates and displays
- [ ] Companies match and display (up to 20)
- [ ] User can add manual company
- [ ] User upgrades to Scout via Stripe
- [ ] Contact suggestions appear (10 per company)
- [ ] Accept Contact enriches lead and triggers learning (+2)
- [ ] Reject Contact triggers learning (-1)
- [ ] Request Alternates shows new contacts (no learning)
- [ ] Lead list displays all enriched leads
- [ ] Lead accuracy "Accurate" triggers learning (+1)
- [ ] Lead accuracy "Incorrect" triggers learning (-3)
- [ ] "Still Working" updates status (no learning)
- [ ] Export CSV works
- [ ] Call Now opens dialer
- [ ] Quotas enforce limits (5/company/day, 50/week)
- [ ] Toast appears after learning events only
