# MVP TECHNICAL ARCHITECTURE SPEC
## Idynify Scout MVP - System Design and Data Flow

---

# System Architecture

## **Frontend** (React)

### **Pages/Routes**:
- `/dashboard` - Landing page with phase status
- `/icp` - ICP Builder form
- `/companies` - Company matching & selection
- `/scout` - Contact suggestions & acceptance
- `/add-company` - Manual company entry
- `/lead-review` - Lead list & accuracy validation

### **Key Components**:
- `ICPBuilder.jsx` - Multi-step form
- `CompanyCard.jsx` - Company display with select/add actions
- `ContactSuggestions.jsx` - Apollo contacts with Accept/Reject buttons
- `LeadCard.jsx` - Lead display with accuracy validation
- `LearningToast.jsx` - "Barry learned" feedback message
- `QuotaDisplay.jsx` - Usage meters

---

# Backend (Firebase Functions / Netlify Functions)

## **Function 1: `apolloCompanyLookup`**
- **Trigger**: HTTPS POST from `/companies` or `/add-company`
- **Input**: `{ query: { industry, size, keywords } }` OR `{ domain: "example.com" }`
- **Process**: 
  1. Call Apollo `GET /companies?query`
  2. Parse response, extract `apollo_company_id`
  3. Return companies array
- **Output**: `[{ name, industry, size, website, apollo_company_id }]`

---

## **Function 2: `apolloContactSuggest`**
- **Trigger**: HTTPS POST from `/scout`
- **Input**: `{ apollo_company_id, user_weights: { title, industry, company_size } }`
- **Process**:
  1. Call Apollo `GET /contacts?company_id={id}&titles=[...]`
  2. Apply simple scoring using user weights
  3. Sort by score (desc)
  4. Return top 10
- **Output**: `[{ name, title, apollo_person_id, score }]`

---

## **Function 3: `apolloContactEnrich`**
- **Trigger**: HTTPS POST from Accept Contact button
- **Input**: `{ apollo_person_id, user_id }`
- **Process**:
  1. Check quotas (5/company/day, 50/user/week)
  2. If under quota: Call Apollo `GET /contacts/{id}`
  3. Create Lead in Firestore
  4. Log enrichment event
  5. Trigger learning engine
- **Output**: `{ lead_id, enriched_data, new_weights }`

---

## **Function 4: `learningEngine`**
- **Trigger**: Called internally by `apolloContactEnrich` and lead validation
- **Input**: `{ user_id, action_type, lead_data }`
- **Process**:
  1. Fetch current weights from `users/{userId}/weights`
  2. Apply adjustment rules:
     - Accept: `+2` to all
     - Reject: `-1` to all
     - Accurate: `+1` to all
     - Incorrect: `-3` to all
  3. Clamp weights (0-50)
  4. Create version entry
  5. Update `users/{userId}/weights/current`
- **Output**: `{ new_weights, version_number }`

---

# Database Schema (Firestore)

```
users/
  {userId}/
    profile: { email, name, createdAt }
    subscription: { tier: 'scout', status: 'active' }
    icp: { industries[], sizes[], titles[], territories[] }
    icpBrief: { text, generatedAt, downloadUrl }
    
    weights/
      current: { title: 30, industry: 20, company_size: 10, updatedAt }
      history/
        {versionId}: { 
          version_number: 1,
          timestamp,
          weights: {},
          action_source,
          lead_id
        }
    
    companies/
      {companyId}: { 
        name, industry, size, website, 
        apollo_company_id, selectedAt 
      }
    
    leads/
      {leadId}: {
        apollo_person_id,
        name, title, email, phone,
        company, industry, company_size,
        enrichment_date,
        status: 'pending_review' | 'accurate' | 'inaccurate',
        score_at_enrichment,
        weights_at_enrichment
      }
    
    events/
      {eventId}: {
        timestamp,
        action_type: 'accept_contact' | 'reject_contact' | 'lead_accuracy',
        lead_id,
        company_id,
        apollo_company_id,
        apollo_person_id,
        title, industry, company_size,
        prior_weights,
        new_weights,
        lead_score_at_action
      }
    
    quotas/
      daily_enrichments: { 
        [companyId]: { count: 3, date: "2025-12-11" }
      }
      weekly_enrichments: {
        count: 25,
        week_start: "2025-12-09"
      }
```

---

# External APIs

## **Apollo API**
- **Base URL**: `https://api.apollo.io/v1`
- **Authentication**: API Key in request header
- **Endpoints**:
  - `GET /companies?query` - Company search
  - `GET /companies/{id}` - Company details
  - `GET /contacts?company_id={id}` - Contact suggestions
  - `GET /contacts/{id}` - Full contact enrichment
- **Rate Limits**: 100 requests/hour per key

---

## **Claude API (Anthropic)**
- **Purpose**: ICP Brief generation only
- **Model**: `claude-sonnet-4-20250514`
- **Endpoint**: `/v1/messages`

---

## **Stripe API**
- **Purpose**: Scout subscription checkout
- **Webhook**: Handle `checkout.session.completed`

---

# Security & Environment

## **API Keys**: Store in Netlify environment variables
- `APOLLO_API_KEY`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`

## **Authentication**: 
- Firebase Auth (email/password)

## **Authorization**: 
- Firestore Security Rules (user can only access own data)

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

---

# Deployment

- **Frontend**: Netlify (auto-deploy from GitHub)
- **Functions**: Netlify Serverless Functions
- **Database**: Firebase Firestore
- **Hosting**: Custom domain via Netlify DNS

---

# Data Flow Diagrams

## **Accept Contact Flow**:
```
User clicks "Accept Contact"
  ↓
Frontend calls apolloContactEnrich
  ↓
Check quotas (5/day per company, 50/week per user)
  ↓
Apollo GET /contacts/{id} (full enrichment)
  ↓
Create Lead in Firestore
  ↓
Log event (action_type: 'accept_contact')
  ↓
Call learningEngine (+2 to all weights)
  ↓
Update weights/current
  ↓
Create weights/history version
  ↓
Update quotas
  ↓
Return { lead_id, new_weights }
  ↓
Frontend shows toast + removes contact + displays next
```

---

## **Reject Contact Flow**:
```
User clicks "Reject Contact"
  ↓
Frontend logs event (action_type: 'reject_contact')
  ↓
Call learningEngine (-1 to all weights)
  ↓
Update weights/current
  ↓
Create weights/history version
  ↓
Return { new_weights }
  ↓
Frontend shows toast + removes contact + displays next
```

---

## **Lead Accuracy Flow**:
```
User clicks "Lead Info Accurate"
  ↓
Update lead status: 'accurate'
  ↓
Log event (action_type: 'lead_accuracy', validation: 'accurate')
  ↓
Call learningEngine (+1 to all weights)
  ↓
Update weights/current
  ↓
Create weights/history version
  ↓
Return { new_weights }
  ↓
Frontend shows toast + updates lead display
```

---

# Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React, React Router, Tailwind CSS |
| Backend | Netlify Serverless Functions |
| Database | Firebase Firestore |
| Authentication | Firebase Auth |
| Payments | Stripe |
| APIs | Apollo.io, Anthropic Claude |
| Hosting | Netlify |
| Version Control | GitHub |

---

# Environment Variables Required

```
# Apollo
APOLLO_API_KEY=your_apollo_key

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret

# Firebase
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
FIREBASE_PROJECT_ID=your_firebase_project_id
```
