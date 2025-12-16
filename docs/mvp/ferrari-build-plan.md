# Ferrari Build Plan — Idynify Scout MVP
**Version:** 1.0
**Status:** Baseline
**Last Updated:** December 15, 2025

---

## Philosophy: Speed + Quality

This is a **Ferrari build**: fast, focused, and engineered for performance.

**Core Principles:**
- Build only what creates value
- Ship working software, not perfect software
- Validate with real users, not assumptions
- No gold-plating, no scope creep
- Iteration over perfection

---

## MVP Scope Definition

### What We're Building

**Idynify Scout MVP = RECON (Tier 1) + SCOUT (Tier 2)**

| Tier | Name | Purpose | Deliverables |
|------|------|---------|--------------|
| **Tier 1** | **RECON** | Market intelligence & observation | 4 downloadable outputs |
| **Tier 2** | **SCOUT** | Company scoring & lead preparation | Scored companies, missions, momentum |
| **Tier 3** | **HUNTER** | Engagement & meeting booking | *Future — design only, not built* |

### Pricing Model

- **$9.99** unlocks RECON + SCOUT (one-time or monthly)
- **Stripe payment** occurs BEFORE product access
- HUNTER = future paid upgrade (upsell opportunity)

### AI Agent: Barry

Barry is a **realistic advisor**, not a yes-man:
- Challenges unrealistic goals
- Explains constraints
- Recommends alternative paths
- Acts as senior GTM strategist

---

## Build Phases

### Phase 1: Foundation (Week 1)
**Goal:** Secure, authenticated platform with Stripe payment gate

**Deliverables:**
- ✅ User authentication (Firebase Auth - already exists)
- ✅ Stripe integration (payment required before access)
- ✅ User entitlements system (track who paid, when)
- ✅ Protected routes (RECON/SCOUT only accessible after payment)

**Technical Work:**
- Netlify function: `create-checkout-session.js`
- Netlify function: `stripe-webhook.js` (handle successful payments)
- Firebase schema: Add `subscription` object to users
- React: Payment wall component
- React: Success redirect after payment

**Success Criteria:**
- User cannot access RECON without paying $9.99
- Payment status persists across sessions
- Stripe webhooks update Firebase correctly

---

### Phase 2: RECON (Tier 1) — Intelligence Layer (Week 2-3)
**Goal:** Transform user inputs into 4 concrete, downloadable strategic outputs

#### RECON Flow

```
User Input (Enhanced Scout Questionnaire)
    ↓
Barry Analyzes & Challenges Assumptions
    ↓
User Refines & Validates
    ↓
Four Downloadable Outputs Generated
```

#### Four RECON Outputs (Mandatory)

**Output 1: Enhanced ICP Brief**
- Who your ideal customer is (firmographics + psychographics)
- Perfect fit indicators
- Anti-profile (red flags)
- Decision-maker personas

**Output 2: Goal-Validated Strategy**
- User's stated goal
- Barry's reality check (feasibility, constraints, risks)
- Recommended alternative paths (if needed)
- Success metrics

**Output 3: Company Scorecard**
- Criteria for scoring companies (feeds into Scout)
- Weighted attributes (industry, size, stage, etc.)
- Threshold definitions (A/B/C tier companies)

**Output 4: TAM Report**
- Total addressable market (company-level, no contacts)
- Market segmentation
- Estimated company count by segment
- Strategic targeting recommendations

#### Technical Implementation

**New Components:**
- `ReconQuestionnaire.jsx` (enhanced Scout with validation prompts)
- `ReconValidation.jsx` (Barry challenges assumptions)
- `ReconOutputs.jsx` (display + download all 4 outputs)

**New Netlify Functions:**
- `barry-recon-analyze.js` (generate all 4 outputs using Claude)
- `barry-recon-challenge.js` (validate user's goal/assumptions)

**Data Model (Firebase):**
```javascript
users/{userId}/recon: {
  questionnaire: { /* enhanced inputs */ },
  barryAnalysis: { /* challenges, recommendations */ },
  outputs: {
    icpBrief: { /* enhanced ICP */ },
    goalStrategy: { /* validated strategy */ },
    companyScorecard: { /* scoring criteria */ },
    tamReport: { /* market analysis */ }
  },
  completedAt: timestamp,
  reconApproved: boolean
}
```

**Success Criteria:**
- All 4 outputs are generated within 3 minutes
- Outputs are downloadable as PDF or Markdown
- Barry provides at least 2 critical questions per questionnaire
- User can iterate on inputs and regenerate

---

### Phase 3: SCOUT (Tier 2) — Company Selection Layer (Week 3-4)
**Goal:** Use RECON outputs to score companies and create momentum via missions

#### SCOUT Flow

```
RECON Outputs (Company Scorecard)
    ↓
Barry Discovers Companies (Apollo API)
    ↓
AI Scores Companies (0-100 using scorecard)
    ↓
Missions: User validates/selects companies
    ↓
Points, Progress, Momentum
```

#### Scout Features

**Discovery:**
- Barry uses Company Scorecard to search Apollo
- Returns 50-100 companies (not 15-20)
- Pre-scored by AI using RECON criteria

**Missions:**
- Mission 1: Review Top 20 Companies (swipe to accept/reject)
- Mission 2: Deep Dive on 10 Selected Companies
- Mission 3: Finalize Target List (rank priority)

**Gamification:**
- Points for completing missions
- Progress bars (visual momentum)
- Barry feedback ("Great choice!" or "Here's why I'm concerned...")

**Deliverables:**
- Scored company list (exportable CSV)
- Target list (user's final selections)
- Analytics (score distribution, acceptance rate)

#### Technical Implementation

**New Components:**
- `ScoutDashboard.jsx` (mission control for Scout)
- `ScoutMission1.jsx` (swipe interface for top 20)
- `ScoutMission2.jsx` (deep dive company cards)
- `ScoutMission3.jsx` (ranking interface)

**New Netlify Functions:**
- `barry-scout-discover.js` (Apollo search using scorecard)
- `barry-scout-score.js` (AI scoring of companies)

**Data Model (Firebase):**
```javascript
users/{userId}/scout: {
  discoveredCompanies: Company[], // 50-100 companies
  missions: {
    mission1: { completed: boolean, accepted: Company[], rejected: Company[] },
    mission2: { completed: boolean, deepDiveCompanies: Company[] },
    mission3: { completed: boolean, rankedList: Company[] }
  },
  analytics: { /* score distribution, progress */ },
  completedAt: timestamp
}
```

**Success Criteria:**
- Scout activates immediately after RECON approval
- User can complete all 3 missions in 15-20 minutes
- Points/progress are visible and motivating
- Final target list is exportable

---

### Phase 4: HUNTER (Tier 3) — Design Only (Week 5)
**Goal:** Spec and position future upgrade, DO NOT implement

**Deliverables:**
- Hunter feature specification (design doc)
- Hunter pricing strategy ($49/month or $99 one-time)
- Hunter positioning ("Upgrade to book meetings automatically")
- Hunter placeholder UI (teaser in Scout completion screen)

**What NOT to Build:**
- No contact discovery
- No email/LinkedIn campaigns
- No meeting booking automation
- No integrations (Calendly, Apollo contacts, etc.)

**Success Criteria:**
- Hunter appears in roadmap and pricing page
- Users can see "Coming Soon" teaser
- Spec is detailed enough to build in 2 weeks when approved

---

## Build Order (Critical Path)

### Week 1: Payment Gate
1. Stripe checkout integration
2. Webhook handling
3. Entitlements system
4. Payment wall UI

### Week 2: RECON Foundation
1. Enhanced questionnaire UI
2. Barry analysis engine (Netlify function)
3. Four outputs generation
4. Download functionality

### Week 3: RECON Validation + SCOUT Start
1. Barry challenge/refinement flow
2. RECON approval gate
3. Scout discovery (Apollo integration)
4. AI scoring engine

### Week 4: SCOUT Missions
1. Mission 1: Top 20 swipe interface
2. Mission 2: Deep dive cards
3. Mission 3: Ranking UI
4. Export functionality

### Week 5: Polish + HUNTER Design
1. RECON/SCOUT UI polish
2. Analytics dashboard
3. Hunter spec document
4. Hunter teaser UI

---

## What We're NOT Building (Scope Boundaries)

### Explicitly Out of Scope:
- ❌ Contact discovery (HUNTER feature)
- ❌ Email campaigns (HUNTER feature)
- ❌ LinkedIn automation (HUNTER feature)
- ❌ Meeting booking (HUNTER feature)
- ❌ CRM integrations (future)
- ❌ Team collaboration (future)
- ❌ Advanced analytics (future)
- ❌ White-labeling (future)

### Why:
- These are HUNTER features (Tier 3, not MVP)
- MVP = RECON + SCOUT only
- Validate value before expanding scope

---

## Tech Stack (Locked)

**Frontend:**
- React 18 + Vite
- Tailwind CSS
- React Router v6
- Lucide icons

**Backend:**
- Netlify Functions (serverless)
- Firebase Auth
- Firebase Firestore
- Stripe API

**AI:**
- Anthropic Claude 3.5 Sonnet

**Data:**
- Apollo.io API (companies only, no contacts)

**Deployment:**
- Netlify (auto-deploy from main branch)

---

## Quality Gates

Before shipping each phase, verify:

### Functionality
- ✅ All features work as specified
- ✅ No console errors
- ✅ Firebase writes succeed
- ✅ External APIs (Stripe, Apollo, Anthropic) handled gracefully

### Performance
- ✅ Page load < 2 seconds
- ✅ RECON outputs generate in < 3 minutes
- ✅ SCOUT discovery completes in < 5 minutes
- ✅ Real-time Firebase listeners don't leak memory

### UX
- ✅ Loading states for all async operations
- ✅ Error messages are user-friendly
- ✅ Progress is visible (bars, percentages)
- ✅ Barry's tone is professional, realistic, helpful

### Security
- ✅ API keys not exposed client-side
- ✅ Stripe webhooks verified
- ✅ Firebase security rules prevent unauthorized access
- ✅ User can only access their own data

---

## Success Metrics (Post-Launch)

### Acquisition
- **Target:** 100 paid users in first 30 days
- **Measure:** Stripe successful payments

### Activation
- **Target:** 80% of paid users complete RECON
- **Measure:** `reconApproved: true` in Firebase

### Retention
- **Target:** 60% of RECON completers finish SCOUT Mission 1
- **Measure:** `scout.missions.mission1.completed: true`

### Revenue
- **Target:** $1,000 MRR (100 users × $9.99)
- **Measure:** Stripe dashboard

### Satisfaction
- **Target:** Users export company lists within 48 hours
- **Measure:** Analytics event: `export_company_list`

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Apollo API rate limits | High | Batch requests, cache results, upgrade to paid tier |
| Anthropic API costs | Medium | Optimize prompts, use streaming, set monthly budget cap |
| Stripe integration bugs | High | Test thoroughly, use Stripe test mode, monitor webhooks |
| Barry challenges frustrate users | Medium | Allow skip option, tone testing, user feedback loop |
| Users don't see value in RECON | High | Make outputs visually impressive, add PDF export, social proof |

---

## Launch Checklist

Before announcing to first users:

- [ ] Stripe production mode enabled
- [ ] Firebase security rules deployed
- [ ] Netlify functions timeout increased to 15 minutes
- [ ] Apollo API paid tier activated (if needed)
- [ ] Anthropic API budget alert configured
- [ ] Error tracking enabled (Sentry or similar)
- [ ] Analytics events firing correctly
- [ ] RECON generates all 4 outputs
- [ ] SCOUT completes all 3 missions
- [ ] Export functionality works
- [ ] Mobile responsive (375px+)
- [ ] Cross-browser tested (Chrome, Safari, Firefox)
- [ ] Privacy policy + Terms of Service live
- [ ] Support email configured

---

## Post-Launch Iteration Plan

### Week 6-8: Feedback & Polish
- Collect user feedback (surveys, interviews)
- Fix critical bugs
- Improve Barry's tone/messaging
- Optimize API costs

### Week 9-12: Analytics & Optimization
- Analyze drop-off points
- A/B test RECON questionnaire
- Improve SCOUT mission UX
- Reduce time-to-value

### Week 13+: HUNTER Build Decision
- Review metrics (activation, retention, revenue)
- Decide: Build HUNTER or pivot?
- If yes: Allocate 2 weeks for Tier 3 build

---

## Team Roles (If Applicable)

**Solo Founder:**
- You do everything 😅
- Prioritize ruthlessly
- Use AI (Claude, ChatGPT) for copywriting, debugging
- Outsource design if needed (Fiverr, Upwork)

**Small Team (2-3 people):**
- **Engineer:** Netlify functions, Firebase, integrations
- **Designer/Frontend:** React components, UX flow, Tailwind
- **Product/GTM:** Positioning, messaging, launch strategy

**Key Principle:** One person owns each phase end-to-end to avoid handoff delays.

---

## Conclusion

This is a **Ferrari build** because:
- ✅ Clear scope (RECON + SCOUT only)
- ✅ Focused deliverables (4 outputs, 3 missions)
- ✅ Realistic timeline (5 weeks)
- ✅ No feature creep (HUNTER explicitly out of scope)
- ✅ Quality gates at each phase
- ✅ Measurable success criteria

**Ship fast. Validate hard. Iterate relentlessly.**

---

*Version 1.0 — Baseline*
*This document is the source of truth for MVP scope and execution.*
