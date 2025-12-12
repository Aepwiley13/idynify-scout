# MVP FEATURE SPECIFICATION
## Idynify Scout MVP - Detailed Feature Requirements

---

# Phase 1: RECON (ICP Phase)

## **F1.1: User Signup & Dashboard**
- User creates account via Firebase Auth
- Dashboard shows current phase status
- CTA: "Complete Your ICP" button

---

## **F1.2: ICP Builder**
- Multi-step form capturing:
  - Target industries
  - Company sizes
  - Key job titles
  - Geographic territories
  - Pain points/use cases
- Saves to Firestore: `users/{userId}/icp`

---

## **F1.3: ICP Brief Generation**
- Claude API generates 1-page ICP Brief
- User can view (on-screen) and download (PDF)
- Stored in Firestore: `users/{userId}/icpBrief`

---

## **F1.4: Company Matching**
- Barry generates matched companies via Apollo API
- Display up to 20 companies with: name, industry, size, website
- User can select companies for Scout phase
- Stored: `users/{userId}/companies`

---

## **F1.5: Upgrade to Scout**
- Stripe checkout flow ($10-49.99/month)
- Upon success: `subscriptionTier: 'scout'` in Firestore
- Unlocks SCOUT phase

---

# Phase 2: SCOUT (Contact Discovery)

## **F2.1: Company Selection**
- User views matched companies
- Actions: Select company, Add manual company
- Manual add: Input domain/name → Apollo lookup → store `apollo_company_id`

---

## **F2.2: Contact Suggestions**
- For each selected company: Apollo `GET /contacts?query`
- Display up to 10 suggested contacts with: name, title, company
- Show quota: "X/5 contacts enriched today for this company"

---

## **F2.3: Accept Contact → Enrich → Lead**

### **User Action**: "Accept Contact" button

### **System Behavior**:
1. Call Apollo `GET /contacts/{id}` (full enrichment)
2. Create Lead in `users/{userId}/leads`
3. Log event: `action_type: 'accept_contact'`
4. Adjust weights: `title_match_weight += 2`
5. Update version: `users/{userId}/weights/history`
6. Show toast: "Barry updated your targeting preferences"
7. Check quotas: 5/company/day, 50/user/week

### **Data Stored**:
```
lead_id, apollo_person_id, name, title, email, phone, 
company, industry, company_size, enrichment_date, 
status: 'pending_review'
```

---

## **F2.4: Reject Contact**

### **User Action**: "Reject Contact" button

### **System Behavior**:
1. Log event: `action_type: 'reject_contact'`
2. Adjust weights: `title_match_weight -= 1`
3. Update version
4. Show toast: "Barry updated your targeting preferences"
5. Remove contact from view

---

## **F2.5: Request Alternates**

### **User Action**: "Show More Contacts" button

### **System Behavior**:
1. Fetch new Apollo contacts (exclude previously shown)
2. No weight adjustment
3. No learning event logged

---

## **F2.6: Learning Engine - Weight Adjustments**

### **Initial Weights**:
- `title_match_weight`: 30
- `industry_match_weight`: 20
- `company_size_weight`: 10

### **Adjustment Rules**:
| Action | title | industry | company_size |
|--------|-------|----------|--------------|
| Accept Contact | +2 | +2 | +2 |
| Reject Contact | -1 | -1 | -1 |

### **Bounds**: Min = 0, Max = 50

### **Version Storage**:
```
users/{userId}/weights/history/{versionId}:
{
  version_number: 1,
  timestamp: "2025-12-11T10:30:00Z",
  weights: { title: 32, industry: 22, company_size: 12 },
  action_source: "accept_contact",
  lead_id: "lead_xyz"
}
```

---

# Phase 3: LEAD REVIEW (Post-Enrichment)

## **F3.1: Lead List View**
- Display all enriched leads
- Filters: All, Pending Review, Validated
- Show: name, title, company, enrichment_date, status

---

## **F3.2: Lead Accuracy Validation**

### **User Actions**:
1. "Lead Info Accurate" → `+1` to all weights
2. "Lead Info Incorrect" → `-3` to all weights
3. "Still Working / No Result" → No adjustment

### **System Behavior**:
- Log event with `action_type: 'lead_accuracy'`
- Adjust weights per table above
- Update version
- Show toast: "Barry updated your targeting preferences"
- Update lead status

---

## **F3.3: Export & Call Actions**
- Export to CSV (lead data)
- "Call Now" button (opens phone dialer with number)
- "Save for Later" (flag lead)

---

## **F3.4: Quota Management**
- Display current usage:
  - "X/5 contacts enriched today for Company ABC"
  - "X/50 leads enriched this week"
- Block enrichment if quota exceeded
- Show upgrade CTA when caps hit

---

# Learning Engine Summary

## **Events Tracked**:
- Accept Contact
- Reject Contact
- Lead Accuracy (Accurate/Inaccurate/No Result)

## **Weight Adjustment Logic**:
| Event | Adjustment |
|-------|------------|
| Accept Contact | +2 to all weights |
| Reject Contact | -1 to all weights |
| Lead Accurate | +1 to all weights |
| Lead Inaccurate | -3 to all weights |
| Request Alternates | No adjustment |
| Still Working/No Result | No adjustment |

## **Data Logged**:
- user_id
- lead_id
- company_id
- apollo_company_id
- apollo_person_id
- action_type
- timestamp
- title
- industry
- company_size
- prior_weights
- new_weights
- lead_score_at_action

## **User Feedback**:
- Toast message: "Barry updated your targeting preferences based on your action"
- Appears after: Accept, Reject, Lead Accuracy rating
- Does NOT appear after: Request Alternates, Still Working/No Result
