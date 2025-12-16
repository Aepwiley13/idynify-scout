# MVP Feature Specification — Idynify Scout
**Version:** 1.0
**Status:** Baseline
**Last Updated:** December 15, 2025

---

## Document Purpose

This specification defines **every feature, screen, and interaction** for the Idynify Scout MVP (RECON + SCOUT).

**Scope:** Tier 1 (RECON) + Tier 2 (SCOUT) only
**Out of Scope:** Tier 3 (HUNTER) — design only, not implemented

---

## Feature Overview

| Tier | Feature Set | Components | Status |
|------|-------------|------------|--------|
| **Platform** | Payment, Auth, Entitlements | 4 screens | ✅ Build |
| **RECON** | Market Intelligence | 3 screens, 4 outputs | ✅ Build |
| **SCOUT** | Company Selection | 4 screens, 3 missions | ✅ Build |
| **HUNTER** | Contact Outreach | Design only | 🚫 Not MVP |

---

## PLATFORM FEATURES

### Feature 1: Homepage & Pricing

**Purpose:** Communicate value and drive conversions

#### Homepage (Public)

**URL:** `/` or `/home`

**Elements:**
- Hero section:
  - Headline: "Stop Guessing Who to Target"
  - Subheadline: "Your AI GTM strategist delivers a prioritized company list in under an hour—for $9.99"
  - CTA button: "Get Started — $9.99"
- Value proposition:
  - "4 Strategic Outputs" (RECON)
  - "Scored Company List" (SCOUT)
  - "1 Hour, Not 10 Hours/Week"
- Social proof (post-launch):
  - User testimonials
  - "100+ GTM teams use Idynify Scout"
- Tier comparison:
  - RECON ($9.99)
  - SCOUT ($9.99, included)
  - HUNTER ($49/month, coming soon)
- FAQ section
- Footer (privacy, terms, support)

**Actions:**
- Click "Get Started" → Redirect to Stripe checkout
- If already logged in → Redirect to `/mission-control`

**Acceptance Criteria:**
- [ ] Page loads in <2 seconds
- [ ] Mobile responsive (375px+)
- [ ] CTA button prominent above fold
- [ ] Tier comparison clear (RECON + SCOUT = $9.99)

---

### Feature 2: Stripe Payment Integration

**Purpose:** Monetize before granting access

#### Checkout Flow

**Trigger:** User clicks "Get Started — $9.99"

**Process:**
1. User redirected to Stripe Checkout (hosted)
2. Stripe collects:
   - Email
   - Payment method (card)
   - Billing address
3. User completes payment
4. Stripe webhook fires `checkout.session.completed`
5. Backend updates Firebase:
   ```javascript
   users/{userId}/subscription: {
     status: "active",
     tier: "recon_scout",
     amount: 999, // cents
     paidAt: timestamp,
     stripeCustomerId: "cus_xxx",
     stripeSubscriptionId: "sub_xxx" // if recurring
   }
   ```
6. Stripe redirects to `/payment-success`

**Netlify Functions:**
- `create-checkout-session.js` (creates Stripe session)
- `stripe-webhook.js` (handles webhook events)

**Acceptance Criteria:**
- [ ] User cannot access RECON without paying
- [ ] Payment status persists across sessions
- [ ] Webhook updates Firebase within 5 seconds
- [ ] Error handling for failed payments (retry, support link)

---

#### Payment Success Screen

**URL:** `/payment-success`

**Elements:**
- Success message: "Welcome to Idynify Scout!"
- Next steps:
  - "Step 1: Complete RECON (15 minutes)"
  - "Step 2: Run SCOUT missions (30 minutes)"
- CTA button: "Start RECON Now"
- Receipt (Stripe generates, link in email)

**Actions:**
- Click "Start RECON Now" → Redirect to `/recon-questionnaire`

**Acceptance Criteria:**
- [ ] Only accessible after successful payment
- [ ] Redirects to RECON if already completed
- [ ] Email receipt sent by Stripe

---

### Feature 3: User Authentication

**Purpose:** Secure access and data isolation

#### Signup

**URL:** `/signup` (fallback, not primary flow)

**Elements:**
- Email input
- Password input (min 6 characters)
- "Sign Up" button
- "Already have an account? Log in" link

**Process:**
1. User submits email + password
2. Firebase Auth creates account
3. Firestore creates user document:
   ```javascript
   users/{userId}: {
     email: string,
     createdAt: timestamp,
     subscription: null, // not paid yet
     reconCompleted: false,
     scoutCompleted: false
   }
   ```
4. Redirect to homepage (to complete payment)

**Acceptance Criteria:**
- [ ] Email format validated
- [ ] Password strength enforced (min 6 chars)
- [ ] Error messages clear ("Email already in use")
- [ ] User document created successfully

---

#### Login

**URL:** `/login`

**Elements:**
- Email input
- Password input
- "Log In" button
- "Don't have an account? Sign up" link
- "Forgot password?" link

**Process:**
1. User submits credentials
2. Firebase Auth validates
3. Redirect based on status:
   - Not paid → `/home` (prompt payment)
   - Paid, not completed RECON → `/recon-questionnaire`
   - Completed RECON, not SCOUT → `/scout-dashboard`
   - Completed both → `/mission-control`

**Acceptance Criteria:**
- [ ] Correct credentials grant access
- [ ] Incorrect credentials show error
- [ ] Session persists on browser refresh
- [ ] Redirects to appropriate screen based on progress

---

#### Protected Routes

**Logic:**
- All routes except `/`, `/login`, `/signup`, `/payment-success` require authentication
- RECON/SCOUT routes require `subscription.status === "active"`
- If not authenticated → Redirect to `/login`
- If not paid → Redirect to `/home` (payment prompt)

**Acceptance Criteria:**
- [ ] Unauthenticated users cannot access protected routes
- [ ] Unpaid users cannot access RECON/SCOUT
- [ ] Firebase security rules prevent unauthorized data access

---

### Feature 4: Mission Control Dashboard

**Purpose:** Central hub for navigation and progress tracking

**URL:** `/mission-control`

**Elements:**

**Header:**
- App logo (Idynify Scout 🐻)
- User email display
- Logout button

**Progress Overview:**
- RECON status:
  - ✅ Completed (show outputs, regenerate option)
  - 🔄 In Progress (resume button)
  - ⚪ Not Started (start button)
- SCOUT status:
  - ✅ Completed (view results, export)
  - 🔄 In Progress (resume mission)
  - ⚪ Not Started (start button, requires RECON)

**Quick Actions:**
- "View RECON Outputs" (if completed)
- "Resume SCOUT Mission X" (if in progress)
- "Download Target List" (if SCOUT completed)

**HUNTER Teaser:**
- "Ready to book meetings?"
- "HUNTER (Tier 3) — Coming Soon"
- "Join Waitlist" button

**Acceptance Criteria:**
- [ ] Displays accurate progress for RECON and SCOUT
- [ ] Quick actions functional
- [ ] HUNTER teaser visible but not clickable (waitlist only)
- [ ] Real-time updates via Firebase listener

---

## RECON FEATURES (Tier 1)

### Feature 5: Enhanced RECON Questionnaire

**Purpose:** Gather comprehensive inputs for strategic analysis

**URL:** `/recon-questionnaire`

**Flow:** Multi-section form with auto-save and validation

---

#### Section 1: Business Context

**Fields:**
1. **Your primary business goal** (text area)
   - Placeholder: "Example: Generate 20 qualified leads per month for our $50K consulting packages"
   - Required: Yes
   - Validation: Min 20 characters

2. **Company website** (URL input)
   - Required: Yes
   - Validation: Valid URL format

3. **LinkedIn company page** (URL input)
   - Required: No
   - Validation: Valid URL format

**Actions:**
- "Next" button (saves to Firebase, advances to Section 2)
- "Save & Exit" button (saves progress, returns to Mission Control)

---

#### Section 2: Target Industries

**Instructions:** "Select all industries where your ideal customers operate"

**Fields:**
1. **Predefined industries** (checkbox grid)
   - Technology
   - Healthcare
   - Financial Services
   - Manufacturing
   - Professional Services
   - E-commerce
   - Education
   - Real Estate
   - Marketing & Advertising
   - Logistics & Supply Chain
   - Energy & Utilities

2. **Other industries** (text input)
   - Placeholder: "Separate with commas"

**Validation:**
- At least 1 industry selected

**Actions:**
- "Next" → Section 3
- "Back" → Section 1

---

#### Section 3: Decision-Maker Titles

**Instructions:** "Who are the decision-makers you sell to?"

**Fields:**
1. **Executive**
   - CEO, Founder, President, Managing Partner

2. **Sales**
   - VP Sales, Sales Director, Head of Revenue

3. **Marketing**
   - CMO, VP Marketing, Head of Growth

4. **Operations**
   - COO, VP Operations, General Manager

5. **Technical**
   - CTO, VP Engineering, Head of Product

6. **Finance**
   - CFO, Controller, Finance Director

7. **HR**
   - CHRO, VP People, Head of Talent

8. **Other** (text input)

**Validation:**
- At least 1 title selected

**Actions:**
- "Next" → Section 4
- "Back" → Section 2

---

#### Section 4: Company Characteristics

**Fields:**
1. **Company size** (checkboxes)
   - 1-10 employees
   - 11-50 employees
   - 51-200 employees
   - 201-500 employees
   - 501-1000 employees
   - 1000+ employees

2. **Company stage** (checkboxes)
   - Pre-seed / Bootstrapped
   - Seed
   - Series A
   - Series B+
   - Profitable / Mature

3. **Annual revenue range** (checkboxes, optional)
   - <$1M
   - $1M-$10M
   - $10M-$50M
   - $50M+

**Validation:**
- At least 1 company size selected

**Actions:**
- "Next" → Section 5
- "Back" → Section 3

---

#### Section 5: Geographic Targeting

**Instructions:** "Where are your ideal customers located?"

**Fields:**
1. **Targeting scope** (radio buttons)
   - Specific US states
   - Specific metro areas
   - Remote companies (location-agnostic)
   - National (all US)
   - International (specify countries)

2. **US states** (multi-select dropdown, conditional)
   - Shows if "Specific US states" selected
   - All 50 states available

3. **Metro areas** (multi-select dropdown, conditional)
   - Shows if "Specific metro areas" selected
   - Top 30 metros (SF, NYC, Austin, etc.)

4. **Countries** (multi-select dropdown, conditional)
   - Shows if "International" selected

**Validation:**
- Scope selection required
- If specific states/metros/countries, at least 1 selected

**Actions:**
- "Next" → Section 6
- "Back" → Section 4

---

#### Section 6: Strategic Context

**Fields:**
1. **Known competitors** (text area)
   - Placeholder: "Who else solves this problem? (comma-separated)"
   - Required: No

2. **Perfect-fit companies** (text area)
   - Placeholder: "Name 2-3 companies that are your ideal customers"
   - Required: Yes (min 2 companies)

3. **Companies to avoid** (text area)
   - Placeholder: "Any industries, company types, or specific companies you don't want to target?"
   - Required: No

4. **Customer pain points** (text area)
   - Placeholder: "What problems do your customers have that you solve?"
   - Required: Yes (min 50 characters)

5. **Your value proposition** (text area)
   - Placeholder: "How do you solve those problems? What makes you different?"
   - Required: Yes (min 50 characters)

**Validation:**
- At least 2 perfect-fit companies
- Pain points min 50 characters
- Value proposition min 50 characters

**Actions:**
- "Submit to Barry" → Trigger Barry's analysis
- "Back" → Section 5

---

#### Auto-Save Behavior

**Logic:**
- Save to Firebase after each section completion
- Save on "Next", "Back", or "Save & Exit"
- Local state preserved if user navigates away
- Resume from last completed section on return

**Firebase Path:**
```javascript
users/{userId}/recon/questionnaire: {
  section1: { goal, website, linkedin },
  section2: { industries, otherIndustries },
  section3: { jobTitles, otherTitles },
  section4: { companySizes, stages, revenue },
  section5: { scope, states, metros, countries },
  section6: { competitors, perfectFit, avoid, painPoints, valueProposition },
  lastUpdated: timestamp
}
```

**Acceptance Criteria:**
- [ ] All 6 sections save correctly to Firebase
- [ ] Validation blocks progression if required fields empty
- [ ] User can return and edit previous sections
- [ ] Data persists on browser refresh
- [ ] Submit triggers Barry's analysis (loading state shown)

---

### Feature 6: Barry's Assumption Challenge

**Purpose:** Validate user's inputs with realistic questions

**URL:** `/recon-validation` (auto-navigates after submit)

**Flow:**
1. Barry analyzes questionnaire inputs
2. Generates 2-4 critical questions
3. User answers questions
4. Barry refines analysis
5. User approves or iterates

---

#### Barry's Analysis Screen

**Elements:**

**Loading State:**
- "Barry is analyzing your inputs..."
- Animated spinner
- Progress indicator (30-90 seconds typical)

**Analysis Display:**
- "Barry has some questions about your inputs"
- List of 2-4 questions with context:

**Example Questions:**
1. **Goal Feasibility:**
   - "You want 20 leads/month at $50K deal size. Based on your target market (50-200 employee SaaS companies), this implies you need to close 1-2 deals/month. Is your sales cycle <30 days, or do you have a pipeline already?"
   - Answer: Text area (required)

2. **Market Size:**
   - "You selected 'Financial Services' but also 'Companies to avoid: Banks.' This significantly reduces your TAM. Are you targeting only FinTech startups, or broader financial services?"
   - Answer: Radio buttons + text area

3. **ICP Consistency:**
   - "Your perfect-fit companies (Stripe, Plaid) are Series B+ with 500+ employees, but you selected 11-50 employees as your target size. Which is correct?"
   - Answer: Radio buttons (adjust size OR adjust examples)

4. **Geographic Realism:**
   - "You selected 'Remote companies' but also 'San Francisco metro only.' These conflict. Should I prioritize location or remote status?"
   - Answer: Radio buttons

**Actions:**
- "Submit Answers to Barry" → Barry refines analysis
- "Go Back and Edit Questionnaire" → Return to Section 6

**Acceptance Criteria:**
- [ ] Barry asks 2-4 relevant, critical questions
- [ ] Questions are specific to user's inputs (not generic)
- [ ] User must answer all questions before proceeding
- [ ] Tone is professional, helpful, not condescending

---

#### Refined Analysis Display

**After user answers:**

**Elements:**
- "Thanks for clarifying. Here's what I learned:"
- Summary of refinements:
  - "Updated TAM estimate: 1,200 companies (down from 5,000)"
  - "Revised ICP: Series A FinTech, 50-200 employees, SF/NYC"
  - "Goal feasibility: Achievable with 15-20 outbound touches/week"

**Actions:**
- "Approve & Generate Outputs" → Trigger 4 RECON outputs
- "Refine Further" → Return to questionnaire

**Acceptance Criteria:**
- [ ] Refinements are clear and actionable
- [ ] User can approve or iterate
- [ ] Approval triggers output generation (loading state)

---

### Feature 7: Four RECON Outputs

**Purpose:** Deliver strategic, downloadable artifacts

**URL:** `/recon-outputs`

---

#### Output Generation

**Trigger:** User approves Barry's refined analysis

**Process:**
1. Netlify function `barry-recon-outputs.js` called
2. Claude API generates all 4 outputs in parallel
3. Outputs saved to Firebase
4. User redirected to `/recon-outputs`

**Loading State:**
- "Barry is creating your strategic outputs..."
- Estimated time: 2-3 minutes
- Progress bar (0% → 25% → 50% → 75% → 100%)

**Firebase Path:**
```javascript
users/{userId}/recon/outputs: {
  icpBrief: { /* structured content */ },
  goalStrategy: { /* structured content */ },
  companyScorecard: { /* structured content */ },
  tamReport: { /* structured content */ },
  generatedAt: timestamp
}
```

---

#### Output 1: Enhanced ICP Brief

**Structure:**

**Section 1: At a Glance**
- 2-3 sentence summary of ideal customer
- Example: "Your ideal customer is a Series A FinTech company with 50-200 employees in SF or NYC, led by a technical CEO, solving compliance or infrastructure problems for financial institutions."

**Section 2: Perfect Fit Indicators**
- Bulleted list (5-7 items)
- Example:
  - ✅ Series A funding ($5M-$15M raised)
  - ✅ 50-200 employees (scaling phase)
  - ✅ CEO or CTO has technical background
  - ✅ Selling to banks or financial institutions
  - ✅ Based in SF or NYC

**Section 3: Anti-Profile (Red Flags)**
- Bulleted list (3-5 items)
- Example:
  - ❌ Pre-seed or bootstrapped (budget constraints)
  - ❌ Consumer FinTech (wrong buyer)
  - ❌ >500 employees (bureaucratic, long sales cycles)
  - ❌ Outside SF/NYC (logistics challenges)

**Section 4: Firmographics**
- Company size: 50-200 employees
- Stage: Series A
- Budget: $50K-$100K annually
- Decision speed: 30-60 days
- Industries: FinTech, RegTech, Infrastructure
- Decision-makers: CEO, CTO, VP Engineering

**Section 5: Psychographics**
- **Pain Points:**
  1. Compliance is manual and error-prone (risk: fines, reputational damage)
  2. Legacy infrastructure slows product development (impact: lost market share)
  3. Scaling requires hiring expensive compliance specialists (cost: $200K/hire)
- **Values:** Speed, reliability, compliance-first
- **Goals:** Scale to 500+ employees, raise Series B, achieve SOC 2

**Display:**
- Collapsible sections
- Professional formatting
- Download buttons: PDF, Markdown

**Acceptance Criteria:**
- [ ] ICP is specific and actionable
- [ ] At least 5 perfect fit indicators
- [ ] At least 3 red flags
- [ ] Firmographics and psychographics detailed
- [ ] Downloadable in PDF and Markdown

---

#### Output 2: Goal-Validated Strategy

**Structure:**

**Your Goal:**
- Restated goal from questionnaire
- Example: "Generate 20 qualified leads per month for $50K consulting packages"

**Barry's Assessment:**
- Feasibility: ✅ Achievable / ⚠️ Challenging / ❌ Unrealistic
- Reasoning: (2-3 sentences)
- Example: "Based on your TAM (1,200 companies) and typical 2% response rate, you'll need to contact 80-100 companies/month to generate 20 qualified leads. This is achievable with 15-20 outbound touches per week."

**Constraints to Consider:**
- Bulleted list (3-5 items)
- Example:
  - Your TAM is 1,200 companies (not infinite)
  - FinTech buyers have 30-60 day decision cycles (patience required)
  - Budget season is Q4 (timing matters)

**Recommended Path:**
- Step 1: Target Series A companies first (higher urgency)
- Step 2: Focus on SF/NYC (proximity advantage)
- Step 3: Lead with compliance pain point (highest urgency)
- Step 4: Plan for 60-day sales cycles (pipeline needed)

**Alternative Paths (If Applicable):**
- If goal is unrealistic, Barry suggests alternatives:
  - "Consider targeting 10 leads/month at $100K deal size (same revenue, fewer deals)"
  - "Expand TAM to include Series B companies (adds 800 prospects)"

**Success Metrics:**
- 20 leads/month
- 2 deals closed/month (10% close rate)
- $100K MRR by Month 6

**Display:**
- Visual indicators (✅ ⚠️ ❌)
- Actionable steps
- Download buttons: PDF, Markdown

**Acceptance Criteria:**
- [ ] Goal feasibility clearly stated
- [ ] Constraints are realistic and specific
- [ ] Recommended path is actionable (3-5 steps)
- [ ] Success metrics defined

---

#### Output 3: Company Scorecard

**Purpose:** Criteria for scoring companies in SCOUT

**Structure:**

**Scoring Attributes (Weighted):**

| Attribute | Weight | Scoring Logic |
|-----------|--------|---------------|
| **Industry Match** | 25% | FinTech (25), RegTech (20), Other (0) |
| **Company Size** | 20% | 50-200 (20), 11-50 (15), 201-500 (10), Other (0) |
| **Funding Stage** | 20% | Series A (20), Seed (15), Series B (10), Other (0) |
| **Location** | 15% | SF/NYC (15), Other major metros (10), Remote (5) |
| **Decision-Maker** | 10% | CEO/CTO (10), VP Eng (8), Director (5), Other (0) |
| **Avoid List** | 10% | Not on avoid list (10), On avoid list (-50) |

**Tier Definitions:**
- **A-Tier (85-100):** Perfect fit, prioritize immediately
- **B-Tier (70-84):** Good fit, target after A-tier
- **C-Tier (60-69):** Marginal fit, low priority
- **D-Tier (<60):** Poor fit, skip

**Example Scoring:**
- Company: Stripe
- Industry: FinTech (25)
- Size: 500+ (0)
- Stage: Series C+ (0)
- Location: SF (15)
- Decision-Maker: CTO (10)
- Avoid: No (10)
- **Total: 60/100 (C-Tier)** — "Marginal fit due to size (too large)"

**Display:**
- Table format
- Visual tier indicators (🟢 🟡 ⚪ 🔴)
- Download buttons: PDF, CSV

**Acceptance Criteria:**
- [ ] At least 5 scoring attributes
- [ ] Weights sum to 100%
- [ ] Tier definitions clear (A/B/C/D)
- [ ] Example scoring provided

---

#### Output 4: TAM Report

**Structure:**

**Total Addressable Market:**
- Estimated company count: 1,200 companies
- Methodology: "Apollo API search using your ICP criteria"

**Market Segmentation:**

| Segment | Count | % of TAM | Priority |
|---------|-------|----------|----------|
| Series A FinTech, SF/NYC | 150 | 12.5% | High |
| Series A FinTech, Other US | 300 | 25% | Medium |
| Seed FinTech, SF/NYC | 200 | 16.7% | Medium |
| Series A RegTech, SF/NYC | 100 | 8.3% | High |
| Other | 450 | 37.5% | Low |

**Strategic Recommendations:**
1. **Start with:** Series A FinTech in SF/NYC (150 companies, highest fit)
2. **Then target:** Series A RegTech in SF/NYC (100 companies, adjacent market)
3. **Expand to:** Series A FinTech nationally (300 companies, scale phase)
4. **Consider:** Seed FinTech in SF/NYC if you need volume (200 companies)

**TAM Growth Potential:**
- If you expand to Series B: +800 companies
- If you add Boston/Austin: +400 companies
- If you include infrastructure startups: +600 companies

**Risks:**
- 1,200 companies is a finite market
- You'll exhaust top segments in 6-12 months
- Plan for TAM expansion or product evolution

**Display:**
- Visual chart (pie or bar)
- Segment table
- Recommendations numbered
- Download buttons: PDF, CSV

**Acceptance Criteria:**
- [ ] TAM estimate is realistic (based on Apollo data)
- [ ] Segmentation is actionable (3-5 segments)
- [ ] Recommendations prioritized (High/Medium/Low)
- [ ] Growth potential and risks outlined

---

#### Output Download Functionality

**Formats:**
- **PDF:** Formatted, professional, shareable
- **Markdown:** Plain text, copyable, editable

**Download Options:**
- Individual outputs (4 separate downloads)
- Combined package (all 4 in one ZIP)

**Netlify Function:**
- `generate-pdf.js` (converts Markdown to PDF using Puppeteer or similar)

**Acceptance Criteria:**
- [ ] All 4 outputs downloadable as PDF and Markdown
- [ ] Combined ZIP download works
- [ ] PDFs are professionally formatted
- [ ] File names are clear (e.g., `Idynify-Scout-ICP-Brief-2025-12-15.pdf`)

---

### Feature 8: RECON Completion & Handoff to SCOUT

**URL:** `/recon-complete`

**Elements:**
- "RECON Complete!" message
- Summary:
  - ✅ 4 strategic outputs generated
  - ✅ ICP validated by Barry
  - ✅ Ready for SCOUT (company discovery)
- Download links (4 outputs)
- CTA: "Start SCOUT — Discover Your Target Companies"

**Actions:**
- Click "Start SCOUT" → Redirect to `/scout-dashboard`
- "Download All Outputs" → ZIP download
- "Return to Mission Control" → `/mission-control`

**Firebase Update:**
```javascript
users/{userId}: {
  reconCompleted: true,
  reconCompletedAt: timestamp
}
```

**Acceptance Criteria:**
- [ ] RECON completion flag set
- [ ] User redirected to SCOUT dashboard
- [ ] Outputs accessible from Mission Control

---

## SCOUT FEATURES (Tier 2)

### Feature 9: SCOUT Dashboard

**Purpose:** Mission control for company discovery and selection

**URL:** `/scout-dashboard`

**Access:** Requires `reconCompleted: true`

---

#### Dashboard Layout

**Header:**
- "SCOUT — Company Selection Missions"
- Progress indicator: "Mission X of 3"
- Points earned: "🏆 120 points"

**Mission Cards:**

**Mission 1: Review Top 20 Companies**
- Status: 🔄 In Progress / ✅ Complete / ⚪ Not Started
- Description: "Barry found 50 companies. Let's review the top 20 together."
- Reward: "50 points"
- CTA: "Start Mission 1" / "Resume" / "Review Results"

**Mission 2: Deep Dive on Selected Companies**
- Status: 🔒 Locked (requires Mission 1) / 🔄 In Progress / ✅ Complete
- Description: "Deep dive into the companies you accepted. Rank them by priority."
- Reward: "30 points"
- CTA: "Start Mission 2" / "Resume" / "Review Results"

**Mission 3: Finalize Your Target List**
- Status: 🔒 Locked / 🔄 In Progress / ✅ Complete
- Description: "Create your final target list and export it."
- Reward: "20 points"
- CTA: "Start Mission 3" / "Resume" / "Download List"

**Discovery Status:**
- "Barry discovered: 50 companies"
- "AI scored: 50 companies"
- "Top 20 ready for review"

**Quick Stats:**
- Companies accepted: 12
- Companies rejected: 8
- Average score: 78/100

**Acceptance Criteria:**
- [ ] Missions unlock sequentially (1 → 2 → 3)
- [ ] Progress and points update in real-time
- [ ] Stats reflect current state
- [ ] CTA buttons functional

---

### Feature 10: Company Discovery & Scoring

**Purpose:** Barry discovers and scores companies using RECON outputs

**Trigger:** User completes RECON (automatic, background process)

---

#### Discovery Process

**Netlify Function:** `barry-scout-discover.js`

**Process:**
1. Read RECON outputs (ICP, scorecard, TAM)
2. Generate Apollo search query:
   - Industries: FinTech, RegTech
   - Company size: 50-200 employees
   - Location: SF, NYC
   - Funding stage: Series A
3. Call Apollo API:
   - `/v1/mixed_companies/search`
   - Retrieve up to 100 companies
4. AI scores each company using Company Scorecard:
   - Claude API: "Score this company against the scorecard"
   - Returns: Score (0-100), reasoning
5. Save to Firebase:
   ```javascript
   users/{userId}/scout/companies: [
     {
       id, name, domain, industry, employees, location, stage,
       score, reasoning, tier, apolloId
     }
   ]
   ```
6. Update Firebase:
   ```javascript
   users/{userId}/scout: {
     discoveryCompletedAt: timestamp,
     totalCompanies: 50,
     topCompanies: [ /* top 20 by score */ ]
   }
   ```

**Loading State (User-Visible):**
- "Barry is discovering companies..."
- Progress: "Searching Apollo... (10 companies found)"
- Progress: "AI scoring companies... (25/50 complete)"
- Estimated time: 3-5 minutes

**Acceptance Criteria:**
- [ ] Discovery completes within 5 minutes
- [ ] At least 30 companies discovered (target 50)
- [ ] All companies scored (0-100)
- [ ] Top 20 identified (score ≥70)
- [ ] Real-time progress updates via Firebase

---

### Feature 11: Mission 1 — Review Top 20 Companies

**Purpose:** User validates/rejects Barry's top picks

**URL:** `/scout-mission-1`

---

#### Swipe Interface

**Layout:**
- Card deck (Tinder-style)
- Current card: Company details
- Swipe left (reject) or right (accept)
- Undo button (last action)

**Company Card:**

**Front:**
- Company name (heading)
- Industry
- Employee count
- Location
- Funding stage
- Barry's score: 🟢 85/100
- Barry's take: "Perfect fit — Series A FinTech in SF, 120 employees, CEO has technical background"

**Back (flip card):**
- Full description
- Website link
- LinkedIn link
- Why Barry scored it this way (reasoning)
- Score breakdown (attributes)

**Actions:**
- Swipe right / Click "Accept" → Add to accepted list
- Swipe left / Click "Reject" → Add to rejected list
- Undo → Reverse last action
- Flip card → Show back details
- Skip → Move to next (doesn't count as accept/reject)

**Progress:**
- "Card 5 of 20"
- Progress bar: 25% complete

**Firebase Save (Incremental):**
```javascript
users/{userId}/scout/mission1: {
  accepted: [ /* Company IDs */ ],
  rejected: [ /* Company IDs */ ],
  currentCard: 5,
  completedAt: timestamp (when all 20 reviewed)
}
```

**Completion:**
- After reviewing all 20:
  - "Mission 1 Complete! 🎉"
  - "You accepted 12 companies, rejected 8"
  - "Earned 50 points"
  - CTA: "Continue to Mission 2"

**Acceptance Criteria:**
- [ ] All 20 companies swipeable
- [ ] Accept/reject saves to Firebase
- [ ] Undo works for last action
- [ ] Progress visible (X of 20)
- [ ] Completion triggers Mission 2 unlock

---

### Feature 12: Mission 2 — Deep Dive on Selected Companies

**Purpose:** User ranks accepted companies by priority

**URL:** `/scout-mission-2`

---

#### Deep Dive Interface

**Layout:**
- List view of accepted companies (from Mission 1)
- Each row expandable for details
- Drag-to-reorder (manual ranking)

**Company Row:**
- Rank: #1, #2, #3 (user-editable)
- Company name
- Score: 85/100
- Industry, size, location
- "View Details" (expands row)

**Expanded Details:**
- Company description
- Barry's reasoning
- Score breakdown
- Website, LinkedIn links
- "Add Note" (user can write context)

**Actions:**
- Drag company row up/down → Reorder
- Click rank number → Manual input (e.g., change #5 to #1)
- Add note → Save custom context
- "Remove from List" → Move back to rejected

**Save:**
- Auto-save on reorder
- Manual save button ("Save Rankings")

**Completion:**
- "Mission 2 Complete!"
- "You ranked 12 companies"
- "Earned 30 points"
- CTA: "Continue to Mission 3"

**Firebase Save:**
```javascript
users/{userId}/scout/mission2: {
  rankedCompanies: [
    { id, rank, userNote }
  ],
  completedAt: timestamp
}
```

**Acceptance Criteria:**
- [ ] All accepted companies listed
- [ ] Drag-to-reorder functional
- [ ] Manual rank input works
- [ ] User notes save correctly
- [ ] Completion unlocks Mission 3

---

### Feature 13: Mission 3 — Finalize & Export Target List

**Purpose:** User creates final target list and exports

**URL:** `/scout-mission-3`

---

#### Finalization Interface

**Layout:**
- Summary of ranked companies
- Filter options (top 5, top 10, all)
- Export format selection
- Preview before export

**Summary:**
- "Your Target List: 12 companies"
- "Top 5 (A-Tier): 5 companies (avg score: 88)"
- "Next 5 (B-Tier): 5 companies (avg score: 76)"
- "Remaining: 2 companies (avg score: 72)"

**Filter Options:**
- Radio buttons:
  - Export top 5 only
  - Export top 10 only
  - Export all 12

**Export Formats:**
- CSV (for CRM import)
- PDF (for printing/sharing)
- Markdown (for copying)

**CSV Columns:**
- Rank, Company Name, Domain, Industry, Employees, Location, Stage, Score, Barry's Reasoning, Website, LinkedIn

**Preview:**
- Table view of selected companies
- Shows exactly what will be exported

**Actions:**
- "Export CSV" → Download
- "Export PDF" → Download
- "Export Markdown" → Download
- "Start Over" → Return to Mission 1 (warning: will reset progress)

**Completion:**
- "Mission 3 Complete! 🎉"
- "SCOUT Complete!"
- "Earned 20 points"
- "Total points: 100"
- CTA: "Return to Mission Control"

**Firebase Save:**
```javascript
users/{userId}/scout: {
  mission3: {
    finalList: [ /* ranked company IDs */ ],
    exportedAt: timestamp
  },
  scoutCompleted: true,
  scoutCompletedAt: timestamp
}
```

**Acceptance Criteria:**
- [ ] Filter options work (top 5/10/all)
- [ ] CSV export includes all required columns
- [ ] PDF export is formatted professionally
- [ ] Markdown export is copyable
- [ ] Completion sets `scoutCompleted: true`

---

### Feature 14: SCOUT Completion & HUNTER Teaser

**URL:** `/scout-complete`

**Elements:**
- "SCOUT Complete!" message
- Summary:
  - ✅ 50 companies discovered
  - ✅ 12 companies selected
  - ✅ Target list exported
  - 🏆 100 points earned
- Download links (CSV, PDF, Markdown)
- **HUNTER Teaser:**
  - "Ready to book meetings with these companies?"
  - "HUNTER (Tier 3) is coming soon!"
  - Features:
    - 🔍 Find decision-maker contacts
    - ✉️ Generate personalized email campaigns
    - 📅 Automate meeting booking
  - Pricing: "$49/month or $99 one-time"
  - CTA: "Join HUNTER Waitlist"

**Waitlist Form:**
- Email (pre-filled)
- "What would make HUNTER a must-have for you?" (text area)
- "Join Waitlist" button

**Actions:**
- "Download Target List" → CSV/PDF/Markdown
- "Join HUNTER Waitlist" → Save to Firebase, show confirmation
- "Return to Mission Control" → `/mission-control`

**Firebase Save:**
```javascript
users/{userId}/hunter: {
  waitlist: true,
  waitlistJoinedAt: timestamp,
  feedback: string
}
```

**Acceptance Criteria:**
- [ ] HUNTER teaser prominent
- [ ] Waitlist form functional
- [ ] Email saved to Firebase
- [ ] User cannot access HUNTER features (teaser only)

---

## HUNTER FEATURES (Tier 3 — Design Only)

### Feature 15: HUNTER Feature Specification (Not Implemented)

**Purpose:** Document future roadmap, do NOT build

---

#### Planned Features (Spec Only)

**1. Contact Discovery**
- Find decision-makers at target companies
- Use Apollo API `/v1/mixed_people/search`
- Filter by job titles from RECON
- Return 2-3 contacts per company

**2. Email Campaign Generation**
- Barry writes personalized emails
- Multi-touch sequence (3-5 emails)
- Uses company context + ICP
- A/B test subject lines

**3. LinkedIn Campaign Generation**
- Barry writes LinkedIn messages
- Connection request + follow-up sequence
- Personalized based on profile

**4. Meeting Booking Automation**
- Calendly integration
- Auto-suggest meeting times
- Follow-up if no response

**5. CRM Integration**
- Export to Salesforce, HubSpot, Pipedrive
- Sync contact data
- Track outreach status

---

#### HUNTER Pricing (Spec)

**Option A:** $49/month (recurring)
**Option B:** $99 one-time (lifetime access)

**Includes:**
- Contact discovery (unlimited)
- Email + LinkedIn campaigns (unlimited)
- Meeting booking (100 meetings/month)
- CRM integration (1 connection)

---

#### HUNTER UI Mockups (Spec)

**Not built, but designed:**
- Contact discovery screen (similar to Scout Mission 1)
- Campaign builder screen (input → Barry generates → preview → send)
- Meeting booking dashboard (upcoming meetings, analytics)

---

**Acceptance Criteria:**
- [ ] Spec document exists (this section)
- [ ] No HUNTER code written
- [ ] Teaser UI in SCOUT completion screen
- [ ] Waitlist functional

---

## Non-Functional Requirements

### Performance
- [ ] Page load <2 seconds
- [ ] RECON outputs generate <3 minutes
- [ ] SCOUT discovery completes <5 minutes
- [ ] Real-time Firebase updates <1 second latency

### Security
- [ ] API keys not exposed client-side
- [ ] Stripe webhooks verified (signature check)
- [ ] Firebase security rules: user can only access own data
- [ ] Protected routes enforce authentication + payment

### UX
- [ ] Loading states for all async operations
- [ ] Error messages user-friendly (no technical jargon)
- [ ] Progress bars visible (RECON, SCOUT)
- [ ] Mobile responsive (375px+ screens)

### Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader compatible (ARIA labels)
- [ ] Color contrast meets WCAG AA

### Browser Compatibility
- [ ] Chrome 90+
- [ ] Safari 14+
- [ ] Firefox 88+
- [ ] Edge 90+

---

## Acceptance Criteria Summary

### Platform
- [ ] Payment required before RECON access
- [ ] Stripe webhook updates Firebase
- [ ] Protected routes work correctly
- [ ] Mission Control displays accurate progress

### RECON
- [ ] Questionnaire saves all 6 sections
- [ ] Barry asks 2-4 critical questions
- [ ] All 4 outputs generate successfully
- [ ] Outputs downloadable (PDF, Markdown)

### SCOUT
- [ ] Discovery finds 30+ companies
- [ ] All companies scored (0-100)
- [ ] Mission 1: 20 companies swipeable
- [ ] Mission 2: Ranking works
- [ ] Mission 3: Export functional (CSV, PDF)

### HUNTER
- [ ] Teaser visible in SCOUT completion
- [ ] Waitlist form functional
- [ ] NO HUNTER features implemented

---

*Version 1.0 — Baseline*
*This document defines all MVP features in detail.*
