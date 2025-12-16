# MVP Technical Architecture — Idynify Scout
**Version:** 1.0
**Status:** Baseline
**Last Updated:** December 15, 2025

---

## Architecture Overview

### System Design Philosophy

**Serverless-First:** Minimize infrastructure management, maximize scalability
**Firebase-Powered:** Real-time data sync, built-in authentication
**AI-Native:** Claude API as core intelligence layer
**Lean Stack:** Proven technologies, minimal dependencies

---

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (React SPA)                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  RECON   │  │  SCOUT   │  │ Payment  │  │  Auth    │      │
│  │   UI     │  │   UI     │  │   Wall   │  │  Login   │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                 │
│                    Firebase SDK + Stripe.js                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      FIREBASE (Google Cloud)                    │
│                                                                 │
│  ┌──────────────┐          ┌──────────────────────┐           │
│  │   Auth       │          │   Firestore          │           │
│  │              │          │   (NoSQL Database)   │           │
│  │ - Email/Pass │          │   - User data        │           │
│  │ - Sessions   │          │   - RECON outputs    │           │
│  └──────────────┘          │   - SCOUT companies  │           │
│                            │   - Subscriptions    │           │
│                            └──────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   NETLIFY FUNCTIONS (Serverless)                │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐ │
│  │ create-        │  │ barry-recon-   │  │ barry-scout-    │ │
│  │ checkout-      │  │ outputs.js     │  │ discover.js     │ │
│  │ session.js     │  │                │  │                 │ │
│  │                │  │ (AI outputs)   │  │ (Apollo + AI)   │ │
│  └────────────────┘  └────────────────┘  └─────────────────┘ │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐ │
│  │ stripe-        │  │ barry-recon-   │  │ barry-scout-    │ │
│  │ webhook.js     │  │ challenge.js   │  │ score.js        │ │
│  │                │  │                │  │                 │ │
│  │ (payment)      │  │ (validation)   │  │ (AI scoring)    │ │
│  └────────────────┘  └────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ↓                    ↓                    ↓
    ┌───────────┐        ┌──────────────┐    ┌──────────────┐
    │  Stripe   │        │  Anthropic   │    │  Apollo.io   │
    │    API    │        │  Claude API  │    │     API      │
    │           │        │              │    │              │
    │ (Payment) │        │  (AI Agent)  │    │  (Company    │
    │           │        │              │    │    Data)     │
    └───────────┘        └──────────────┘    └──────────────┘
```

---

## Technology Stack

### Frontend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Framework** | React | 18.3.1 | UI library |
| **Build Tool** | Vite | 7.2.4 | Fast builds, HMR |
| **Routing** | React Router | 6.26.2 | Client-side routing |
| **Styling** | Tailwind CSS | 3.x | Utility-first CSS |
| **Icons** | Lucide React | Latest | Icon library |
| **State** | React Hooks | Built-in | Local state management |
| **Forms** | Native + Validation | - | Form handling |
| **Date Handling** | date-fns | Latest | Date formatting |

**Why React + Vite:**
- Fast development (HMR)
- Modern tooling
- Large ecosystem
- Easy deployment to Netlify

**Why Tailwind:**
- Rapid prototyping
- Consistent design system
- Small bundle size (purged unused styles)

---

### Backend (Serverless)

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Serverless Platform** | Netlify Functions | Node.js functions |
| **Runtime** | Node.js | 18.x |
| **Bundler** | esbuild | Fast function bundling |
| **Max Timeout** | 15 minutes | Long AI operations |

**Why Netlify Functions:**
- Integrated with frontend deployment
- Auto-scaling
- No server management
- 125K free function hours/month

---

### Database & Auth

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Authentication** | Firebase Auth | User management |
| **Database** | Firebase Firestore | NoSQL data storage |
| **Real-time Sync** | Firestore Listeners | Live data updates |
| **Security** | Firestore Rules | Data access control |

**Why Firebase:**
- Real-time listeners (no polling)
- Built-in authentication
- Generous free tier (50K reads/day)
- Auto-scaling
- Google Cloud infrastructure

---

### External APIs

| API | Purpose | Tier | Cost |
|-----|---------|------|------|
| **Stripe** | Payment processing | Production | 2.9% + 30¢ per transaction |
| **Anthropic Claude** | AI agent (Barry) | Tier 1 | $3/$15 per 1M tokens (input/output) |
| **Apollo.io** | Company data | Paid ($99/month) | 50 requests/month (free), unlimited (paid) |

---

### Deployment & Hosting

| Component | Platform | Purpose |
|-----------|----------|---------|
| **Frontend Hosting** | Netlify | Static site hosting, CDN |
| **Functions Hosting** | Netlify | Serverless function execution |
| **Domain** | Netlify DNS | Custom domain management |
| **SSL** | Let's Encrypt (via Netlify) | HTTPS |
| **CI/CD** | Netlify (auto-deploy) | Git-based deployment |

---

## Data Architecture

### Firebase Firestore Schema

#### Collection: `users/{userId}`

```javascript
{
  // Authentication & Identity
  email: string,
  createdAt: timestamp,
  lastLoginAt: timestamp,

  // Subscription & Entitlements
  subscription: {
    status: "active" | "expired" | "canceled",
    tier: "recon_scout", // or "recon_scout_hunter" (future)
    amount: 999, // cents
    currency: "usd",
    paidAt: timestamp,
    expiresAt: timestamp | null, // if monthly subscription
    stripeCustomerId: string,
    stripeSubscriptionId: string | null,
    stripePaymentIntentId: string
  },

  // RECON Data
  recon: {
    // Questionnaire Inputs
    questionnaire: {
      section1: {
        goal: string,
        website: string,
        linkedin: string
      },
      section2: {
        industries: string[], // ["Technology", "Healthcare"]
        otherIndustries: string
      },
      section3: {
        jobTitles: string[], // ["CEO", "CTO"]
        otherTitles: string
      },
      section4: {
        companySizes: string[], // ["11-50", "51-200"]
        stages: string[], // ["Series A", "Series B"]
        revenue: string[] // ["$1M-$10M"]
      },
      section5: {
        scope: string, // "specific-states" | "metros" | "remote" | "national"
        states: string[], // ["CA", "NY"]
        metros: string[], // ["San Francisco", "New York"]
        countries: string[]
      },
      section6: {
        competitors: string,
        perfectFitCompanies: string,
        avoidList: string,
        painPoints: string,
        valueProposition: string
      },
      lastUpdated: timestamp
    },

    // Barry's Challenge & Validation
    challenge: {
      questions: [
        {
          question: string,
          context: string,
          userAnswer: string
        }
      ],
      refinedAnalysis: {
        summary: string,
        changes: string[]
      },
      approvedAt: timestamp
    },

    // Four Outputs
    outputs: {
      icpBrief: {
        atAGlance: string,
        perfectFitIndicators: string[],
        antiProfile: string[],
        firmographics: {
          companySize: string,
          stage: string,
          budget: string,
          decisionSpeed: string,
          industries: string[],
          decisionMakers: string[]
        },
        psychographics: {
          painPoints: [{ pain, description, impact }],
          values: string[],
          goals: string[]
        }
      },
      goalStrategy: {
        goal: string,
        feasibility: "achievable" | "challenging" | "unrealistic",
        reasoning: string,
        constraints: string[],
        recommendedPath: string[],
        alternativePaths: string[],
        successMetrics: string[]
      },
      companyScorecard: {
        attributes: [
          {
            name: string,
            weight: number, // percentage
            scoringLogic: object
          }
        ],
        tierDefinitions: {
          ATier: { min: 85, max: 100, label: "Perfect fit" },
          BTier: { min: 70, max: 84, label: "Good fit" },
          CTier: { min: 60, max: 69, label: "Marginal fit" },
          DTier: { min: 0, max: 59, label: "Poor fit" }
        }
      },
      tamReport: {
        totalCompanies: number,
        segments: [
          {
            name: string,
            count: number,
            percentage: number,
            priority: "high" | "medium" | "low"
          }
        ],
        recommendations: string[],
        growthPotential: string[],
        risks: string[]
      },
      generatedAt: timestamp
    },

    // Status Flags
    questionnaireCompleted: boolean,
    challengeCompleted: boolean,
    outputsGenerated: boolean,
    reconApproved: boolean,
    reconCompletedAt: timestamp
  },

  // SCOUT Data
  scout: {
    // Discovery
    discoveryStartedAt: timestamp,
    discoveryCompletedAt: timestamp,
    companies: [
      {
        id: string, // unique ID
        apolloId: string, // Apollo organization ID
        name: string,
        domain: string,
        description: string,
        industry: string,
        employees: number,
        location: string,
        stage: string, // "Series A", "Seed", etc.

        // Scoring
        score: number, // 0-100
        tier: "A" | "B" | "C" | "D",
        reasoning: string, // Barry's explanation
        scoreBreakdown: {
          industryMatch: number,
          sizeMatch: number,
          stageMatch: number,
          locationMatch: number,
          decisionMakerMatch: number,
          avoidListCheck: number
        },

        // Apollo Data
        website: string,
        linkedinUrl: string,
        foundedYear: number,
        revenue: string
      }
    ],
    totalCompanies: number,
    topCompanies: string[], // IDs of top 20

    // Mission 1: Review Top 20
    mission1: {
      accepted: string[], // company IDs
      rejected: string[], // company IDs
      currentCard: number,
      completedAt: timestamp
    },

    // Mission 2: Deep Dive & Rank
    mission2: {
      rankedCompanies: [
        {
          id: string,
          rank: number,
          userNote: string
        }
      ],
      completedAt: timestamp
    },

    // Mission 3: Finalize & Export
    mission3: {
      finalList: string[], // company IDs in final order
      exportFormat: "csv" | "pdf" | "markdown",
      exportedAt: timestamp
    },

    // Gamification
    points: number,
    missionsCompleted: number,

    // Status Flags
    scoutStarted: boolean,
    scoutCompleted: boolean,
    scoutCompletedAt: timestamp
  },

  // HUNTER (Future)
  hunter: {
    waitlist: boolean,
    waitlistJoinedAt: timestamp,
    feedback: string,

    // Future fields (not implemented):
    // contacts: [],
    // campaigns: [],
    // meetings: []
  }
}
```

---

### Data Access Patterns

#### Reads (Client-Side)

**Real-time Listeners:**
```javascript
// Mission Control: Listen for RECON/SCOUT status
onSnapshot(doc(db, 'users', userId), (snapshot) => {
  const data = snapshot.data()
  // Update UI with recon/scout status
})

// SCOUT Mission 1: Listen for discovery progress
onSnapshot(doc(db, 'users', userId), (snapshot) => {
  const { scout } = snapshot.data()
  // Update progress bar, company count
})
```

**One-time Reads:**
```javascript
// RECON Outputs: Load once on page load
const userDoc = await getDoc(doc(db, 'users', userId))
const { recon } = userDoc.data()
const outputs = recon.outputs
```

#### Writes (Server-Side via Functions)

**Incremental Writes (Large Data):**
```javascript
// SCOUT Discovery: Write companies in batches
for (const batch of companyBatches) {
  await updateDoc(doc(db, 'users', userId), {
    'scout.companies': arrayUnion(...batch)
  })
}
```

**Transactional Writes (Payment):**
```javascript
// Stripe Webhook: Update subscription atomically
await runTransaction(db, async (transaction) => {
  const userRef = doc(db, 'users', userId)
  transaction.update(userRef, {
    'subscription.status': 'active',
    'subscription.paidAt': serverTimestamp()
  })
})
```

---

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User documents: Only owner can read/write
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Rules Explained:**
- Users can only access their own data (`userId` must match `auth.uid`)
- No public reads (prevents data leaks)
- All writes must be authenticated

---

## API Integration Architecture

### 1. Stripe API (Payment)

**Flow:**

```
Client                  Netlify Function           Stripe API
  │                           │                         │
  │ 1. "Get Started" click    │                         │
  │──────────────────────────>│                         │
  │                           │ 2. Create checkout      │
  │                           │─────────────────────────>│
  │                           │                         │
  │                           │ 3. Return session URL   │
  │                           │<─────────────────────────│
  │ 4. Redirect to Stripe     │                         │
  │<──────────────────────────│                         │
  │                           │                         │
  │ 5. Complete payment       │                         │
  │─────────────────────────────────────────────────────>│
  │                           │                         │
  │                           │ 6. Webhook event        │
  │                           │<─────────────────────────│
  │                           │                         │
  │                           │ 7. Update Firebase      │
  │                           │ (subscription.status)   │
  │                           │                         │
  │ 8. Redirect to success    │                         │
  │<──────────────────────────────────────────────────────│
```

**Netlify Functions:**

**`create-checkout-session.js`**
```javascript
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export async function handler(event, context) {
  const { userId, email } = JSON.parse(event.body)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment', // or 'subscription'
    line_items: [{
      price: 'price_xxx', // $9.99 price ID
      quantity: 1
    }],
    customer_email: email,
    metadata: { userId },
    success_url: 'https://idynify-scout.com/payment-success',
    cancel_url: 'https://idynify-scout.com/'
  })

  return {
    statusCode: 200,
    body: JSON.stringify({ url: session.url })
  }
}
```

**`stripe-webhook.js`**
```javascript
import Stripe from 'stripe'
import { db } from './firebase-admin.js'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function handler(event, context) {
  const sig = event.headers['stripe-signature']
  let stripeEvent

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret)
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` }
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object
    const userId = session.metadata.userId

    await updateDoc(doc(db, 'users', userId), {
      'subscription.status': 'active',
      'subscription.amount': session.amount_total,
      'subscription.paidAt': serverTimestamp(),
      'subscription.stripeCustomerId': session.customer,
      'subscription.stripePaymentIntentId': session.payment_intent
    })
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) }
}
```

**Error Handling:**
- Failed payment → Stripe shows error, user can retry
- Webhook failure → Retry logic (Stripe retries up to 3 days)
- Network timeout → User can refresh, check subscription status

---

### 2. Anthropic Claude API (AI Agent)

**Flow:**

```
Netlify Function              Anthropic API
      │                            │
      │ 1. Send prompt + context   │
      │───────────────────────────>│
      │                            │
      │ 2. Stream response         │
      │<───────────────────────────│
      │                            │
      │ 3. Parse structured output │
      │                            │
      │ 4. Save to Firebase        │
```

**Functions Using Claude:**

**`barry-recon-challenge.js`**
```javascript
import Anthropic from '@anthropic-ai/sdk'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function handler(event, context) {
  const { questionnaire } = JSON.parse(event.body)

  const prompt = `You are Barry, a senior GTM strategist. Review this questionnaire and ask 2-4 critical questions to validate assumptions.

Questionnaire:
${JSON.stringify(questionnaire, null, 2)}

Generate questions in JSON format:
{
  "questions": [
    {
      "question": "...",
      "context": "...",
      "answerType": "text" | "radio" | "checkbox"
    }
  ]
}`

  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: prompt
    }]
  })

  const response = JSON.parse(message.content[0].text)

  return {
    statusCode: 200,
    body: JSON.stringify(response)
  }
}
```

**`barry-recon-outputs.js`**
```javascript
// Similar structure, generates all 4 outputs
// Uses parallel promises for speed:
const [icpBrief, goalStrategy, scorecard, tamReport] = await Promise.all([
  generateICPBrief(questionnaire),
  generateGoalStrategy(questionnaire),
  generateScorecard(questionnaire),
  generateTAMReport(questionnaire)
])

// Each function calls Claude with specific prompt
```

**`barry-scout-score.js`**
```javascript
// Scores companies using RECON scorecard
const prompt = `Score this company against the scorecard:

Company: ${company.name}
Industry: ${company.industry}
Size: ${company.employees}
Location: ${company.location}

Scorecard: ${JSON.stringify(scorecard)}

Return JSON:
{
  "score": 85,
  "tier": "A",
  "reasoning": "...",
  "scoreBreakdown": { ... }
}`
```

**Rate Limiting:**
- Tier 1: 50 requests/minute
- Exponential backoff if 429 error
- Batch processing for large datasets (e.g., scoring 50 companies)

**Cost Optimization:**
- Use streaming for faster perceived performance
- Cache prompt templates
- Limit max_tokens to reduce output costs
- Monitor usage via Anthropic dashboard

---

### 3. Apollo.io API (Company Data)

**Flow:**

```
Netlify Function              Apollo API
      │                            │
      │ 1. Search companies        │
      │   (industry, size, stage)  │
      │───────────────────────────>│
      │                            │
      │ 2. Return company list     │
      │<───────────────────────────│
      │                            │
      │ 3. Transform data          │
      │ 4. Save to Firebase        │
```

**Function: `barry-scout-discover.js`**

```javascript
import axios from 'axios'

export async function handler(event, context) {
  const { userId, scorecard, tamReport } = JSON.parse(event.body)

  // Build search query from RECON outputs
  const searchQuery = {
    page: 1,
    per_page: 100,
    organization_num_employees_ranges: ["51-200", "201-500"],
    q_organization_keyword_tags: ["FinTech", "RegTech"],
    organization_locations: ["San Francisco", "New York"],
    // ... more filters
  }

  const response = await axios.post(
    'https://api.apollo.io/v1/mixed_companies/search',
    searchQuery,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY
      }
    }
  )

  const companies = response.data.organizations.map(org => ({
    id: generateUniqueId(),
    apolloId: org.id,
    name: org.name,
    domain: org.primary_domain,
    description: org.short_description,
    industry: org.industry,
    employees: org.estimated_num_employees,
    location: org.city + ', ' + org.state,
    stage: org.funding_stage,
    website: org.website_url,
    linkedinUrl: org.linkedin_url,
    foundedYear: org.founded_year,
    revenue: org.estimated_annual_revenue
  }))

  // Save to Firebase (incremental)
  await saveCompaniesToFirebase(userId, companies)

  // Trigger AI scoring (separate function)
  await triggerScoring(userId, companies)

  return {
    statusCode: 200,
    body: JSON.stringify({ count: companies.length })
  }
}
```

**Error Handling:**
- 429 (Rate Limit): Wait and retry with exponential backoff
- 404 (No Results): Return empty array, show user message
- 500 (Server Error): Retry up to 3 times, then fail gracefully

**Rate Limiting:**
- Free tier: 50 requests/month
- Paid tier: Unlimited (recommended for production)
- Cache results to avoid redundant calls

---

## System Workflows

### Workflow 1: User Signup & Payment

```
1. User lands on homepage
2. Clicks "Get Started — $9.99"
3. Client calls `create-checkout-session` function
4. Function creates Stripe session, returns URL
5. Client redirects to Stripe Checkout
6. User completes payment
7. Stripe fires `checkout.session.completed` webhook
8. Netlify function `stripe-webhook` receives event
9. Function updates Firebase: subscription.status = "active"
10. Stripe redirects user to `/payment-success`
11. User clicks "Start RECON Now"
12. Client redirects to `/recon-questionnaire`
```

**Error Paths:**
- Payment fails → Stripe shows error, user can retry
- Webhook fails → Stripe retries, eventually succeeds
- User closes browser → Can resume from login (subscription persists)

---

### Workflow 2: RECON Completion

```
1. User completes 6-section questionnaire
2. Client saves each section to Firebase (auto-save)
3. User clicks "Submit to Barry"
4. Client calls `barry-recon-challenge` function
5. Function generates 2-4 questions using Claude
6. User answers questions
7. Client calls `barry-recon-challenge` again (refinement)
8. User approves refined analysis
9. Client calls `barry-recon-outputs` function
10. Function generates all 4 outputs in parallel (Claude API)
11. Function saves outputs to Firebase
12. Client listens for Firebase update
13. Client displays outputs on `/recon-outputs`
14. User downloads outputs (PDF, Markdown)
15. User clicks "Start SCOUT"
16. Client redirects to `/scout-dashboard`
```

**Timing:**
- Questionnaire: 15-25 minutes (user input)
- Barry's challenge: 30-60 seconds (AI generation)
- User answers: 5-10 minutes
- Output generation: 2-3 minutes (AI generation)
- **Total: ~25-40 minutes**

---

### Workflow 3: SCOUT Discovery & Missions

```
1. User clicks "Start SCOUT" (from RECON completion)
2. Client calls `barry-scout-discover` function (background)
3. Function:
   a. Reads RECON scorecard
   b. Builds Apollo search query
   c. Calls Apollo API (retrieve 50-100 companies)
   d. Saves companies to Firebase (incremental)
4. Client calls `barry-scout-score` function (background)
5. Function:
   a. Reads companies from Firebase
   b. Scores each company using Claude (batch processing)
   c. Saves scores to Firebase (incremental)
6. Client listens for Firebase updates (real-time)
7. Client displays progress: "50 companies discovered, 25 scored"
8. When scoring complete:
   a. Client redirects to `/scout-mission-1`
   b. Shows top 20 companies (swipe interface)
9. User completes Mission 1 (accept/reject)
10. Client saves results to Firebase
11. Client redirects to `/scout-mission-2`
12. User completes Mission 2 (ranking)
13. Client redirects to `/scout-mission-3`
14. User exports final list (CSV, PDF)
15. Client calls `generate-pdf` function (if PDF selected)
16. Function generates PDF, returns download URL
17. User downloads file
18. Client redirects to `/scout-complete`
```

**Timing:**
- Discovery: 1-2 minutes (Apollo API)
- Scoring: 3-5 minutes (Claude API, 50 companies)
- Mission 1: 10 minutes (user swipes)
- Mission 2: 5 minutes (user ranks)
- Mission 3: 2 minutes (export)
- **Total: ~20-25 minutes**

---

## Performance Optimization

### Frontend

**Code Splitting:**
- Lazy load routes: `const ScoutDashboard = lazy(() => import('./ScoutDashboard'))`
- Split vendor bundles: Vite auto-splits large dependencies

**Asset Optimization:**
- Image compression (if using images)
- SVG icons (Lucide React)
- Font subsetting (load only used characters)

**Caching:**
- Service worker (future enhancement)
- Browser cache for static assets (via Netlify headers)

---

### Backend (Netlify Functions)

**Cold Start Mitigation:**
- Keep functions warm (future: scheduled ping)
- Minimize dependencies (use esbuild for tree-shaking)
- Use Node 18 (faster startup)

**Concurrency:**
- Parallel processing (Promise.all for AI scoring)
- Batch Firestore writes (reduce round trips)

**Timeout Management:**
- Set function timeout to 900s (15 minutes)
- Show progress to user (don't wait for completion)
- Use Firebase listeners (user sees updates in real-time)

---

### Database (Firebase)

**Query Optimization:**
- Use real-time listeners (no polling)
- Limit reads (don't fetch all companies, fetch top 20 only)
- Index fields (Firestore auto-indexes, but verify)

**Write Optimization:**
- Batch writes (updateDoc with multiple fields)
- Incremental saves (don't overwrite entire document)

---

## Security Architecture

### Authentication & Authorization

**Firebase Auth:**
- Email/password only (no social login in MVP)
- Password strength: Min 6 characters (Firebase default)
- Session management: Firebase handles token refresh

**Protected Routes:**
```javascript
// React Router wrapper
function ProtectedRoute({ children }) {
  const { user, subscription } = useAuth()

  if (!user) return <Navigate to="/login" />
  if (!subscription || subscription.status !== 'active') {
    return <Navigate to="/home" /> // Payment wall
  }

  return children
}
```

---

### API Security

**Stripe:**
- Webhook signature verification (prevent spoofing)
- Secret keys server-side only (never in client)
- Use Stripe Elements for PCI compliance (no raw card data)

**Anthropic:**
- API key server-side only
- Rate limiting (built-in by Anthropic)
- Input validation (sanitize user inputs before sending to AI)

**Apollo:**
- API key server-side only
- Rate limiting (respect 50 requests/month on free tier)

---

### Data Security

**Firestore Rules:**
- User can only access own data (userId match)
- No public reads/writes
- Validate schema (future enhancement)

**Sensitive Data:**
- No PII stored (except email)
- No credit card data (Stripe handles)
- API keys in environment variables (Netlify secrets)

---

### HTTPS & Networking

**SSL:**
- Enforced by Netlify (auto-provisioned Let's Encrypt)
- Redirect HTTP → HTTPS

**CORS:**
- Netlify functions auto-configure CORS
- Stripe, Apollo, Anthropic APIs allow cross-origin

---

## Deployment Architecture

### CI/CD Pipeline

```
Developer                Git (GitHub)           Netlify
    │                         │                    │
    │ 1. git push main        │                    │
    │────────────────────────>│                    │
    │                         │ 2. Webhook         │
    │                         │───────────────────>│
    │                         │                    │
    │                         │ 3. Build (Vite)    │
    │                         │    - npm install   │
    │                         │    - npm run build │
    │                         │                    │
    │                         │ 4. Deploy          │
    │                         │    - Upload dist/  │
    │                         │    - Deploy funcs  │
    │                         │                    │
    │ 5. Deploy complete      │                    │
    │<──────────────────────────────────────────────│
    │                         │                    │
    │ Live at idynify-scout.com                    │
```

**Build Command:** `npm run build`
**Publish Directory:** `dist`
**Functions Directory:** `netlify/functions`

---

### Environment Variables

**Netlify Secrets (Production):**
```bash
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
APOLLO_API_KEY=xxx
FIREBASE_API_KEY=xxx
FIREBASE_AUTH_DOMAIN=xxx
FIREBASE_PROJECT_ID=xxx
```

**Development (.env.local):**
```bash
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
APOLLO_API_KEY=xxx
# ... Firebase test config
```

---

### Monitoring & Logging

**Netlify:**
- Function logs (view in Netlify dashboard)
- Build logs (CI/CD status)
- Analytics (page views, function invocations)

**Firebase:**
- Firestore usage (reads, writes, deletes)
- Authentication (signups, logins)

**Stripe:**
- Payment logs (successful, failed)
- Webhook events (delivered, retried, failed)

**Future Enhancements:**
- Sentry (error tracking)
- LogRocket (session replay)
- PostHog (product analytics)

---

## Scalability Considerations

### Current Limits (MVP)

| Resource | Limit | Impact |
|----------|-------|--------|
| Netlify Functions | 125K hours/month (free) | ~500 users/month |
| Firebase Firestore | 50K reads/day (free) | ~1,600 users/month |
| Anthropic API | $1,000/month budget | ~300 RECON outputs |
| Apollo API | 50 requests/month (free) | 50 SCOUT discoveries |

### Scale-Up Path

**At 100 Users:**
- Upgrade Apollo to paid ($99/month)
- Monitor Anthropic costs (optimize prompts)
- Stay on Firebase/Netlify free tiers

**At 500 Users:**
- Upgrade Firebase to Blaze (pay-as-you-go)
- Upgrade Netlify to Pro ($19/month)
- Increase Anthropic budget to $5,000/month

**At 1,000+ Users:**
- Consider dedicated backend (Node.js on AWS/GCP)
- Cache Apollo results (reduce API calls)
- Optimize Claude prompts (reduce token usage)
- Add Redis for session management

---

## Backup & Disaster Recovery

### Data Backup

**Firestore:**
- Automated backups (Firebase built-in, daily)
- Export to Google Cloud Storage (manual, weekly)

**Stripe:**
- Payment history (retained by Stripe)
- Export transactions (manual, monthly)

**Code:**
- Git repository (GitHub)
- Netlify deployment history (rollback available)

### Disaster Recovery

**Scenario 1: Netlify Outage**
- Deploy to Vercel (similar platform)
- Update DNS (15-minute downtime)

**Scenario 2: Firebase Outage**
- Rare (Google Cloud SLA: 99.95%)
- Show maintenance page
- No data loss (Firebase handles replication)

**Scenario 3: Data Corruption**
- Restore from Firestore backup (up to 24 hours old)
- Replay Stripe webhooks (Stripe retains events for 30 days)

---

## Testing Strategy

### Unit Tests
- React components (Vitest + React Testing Library)
- Netlify functions (Jest)
- Utility functions (pure logic)

### Integration Tests
- Stripe webhook flow (test mode)
- Apollo API responses (mock data)
- Firebase writes (emulator)

### End-to-End Tests
- Playwright (future enhancement)
- Test critical paths:
  1. Signup → Payment → RECON
  2. RECON → SCOUT → Export

### Manual Testing Checklist
- [ ] Payment flow (Stripe test mode)
- [ ] RECON questionnaire (all 6 sections)
- [ ] Barry's challenge (questions appear)
- [ ] Four outputs (all downloadable)
- [ ] SCOUT discovery (50 companies)
- [ ] Mission 1-3 (swipe, rank, export)
- [ ] Mobile responsive (iPhone, Android)
- [ ] Cross-browser (Chrome, Safari, Firefox)

---

## Conclusion

This architecture is designed for:
- ✅ **Speed:** Serverless, no infrastructure management
- ✅ **Scalability:** Auto-scaling Firebase + Netlify
- ✅ **Cost-efficiency:** Generous free tiers, pay-as-you-grow
- ✅ **Developer experience:** Modern stack, fast builds, easy deployments
- ✅ **Security:** Firebase rules, API key management, HTTPS
- ✅ **Real-time UX:** Firebase listeners, no polling

**Tech Debt to Address Later:**
- Add comprehensive error tracking (Sentry)
- Implement caching layer (Redis)
- Optimize AI costs (prompt engineering, caching)
- Add team collaboration features (requires multi-user schema)

---

*Version 1.0 — Baseline*
*This document defines the technical implementation for the MVP.*
