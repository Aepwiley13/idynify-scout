# 📋 Idynify Scout - Spec Requirements Document

## 1. Data Model

### 1.1 Firebase Firestore Collections

#### **Collection: `users/{userId}`**

```javascript
{
  // Authentication
  email: string,                    // User's email address
  createdAt: timestamp,              // Account creation date

  // Onboarding Status Flags
  scoutCompleted: boolean,           // Has finished Scout Questionnaire
  icpApproved: boolean,              // Has approved ICP brief

  // Scout Questionnaire Data
  scoutData: {
    goal: string,                    // Primary business goal
    companyWebsite: string,          // User's company website
    linkedinCompanyPage: string,     // User's company LinkedIn

    // Targeting Criteria
    industries: string[],            // Selected target industries
    jobTitles: string[],             // Selected target job titles
    otherJobTitles: string,          // Custom job titles
    companySizes: string[],          // Company size ranges (e.g., "11-50")

    // Geographic Targeting
    targetStates: string[],          // US states (e.g., ["CA", "NY"])
    targetCities: string[],          // Metro areas (e.g., ["San Francisco"])
    locationScope: string[],         // "remote", "specific-states", etc.

    // Qualitative Inputs
    competitors: string,             // Known competitors
    perfectFitCompanies: string,     // Example ideal customers
    avoidList: string,               // Companies to exclude
    painPoints: string,              // Customer pain points
    valueProposition: string         // How user solves those pains
  },

  // AI-Generated ICP Brief
  icpBrief: {
    companyName: string,             // User's company name
    idealCustomerGlance: string,     // 2-3 sentence summary
    perfectFitIndicators: string[],  // What makes a great customer
    antiProfile: string[],           // Red flags to avoid
    keyInsight: string,              // Strategic positioning insight

    firmographics: {
      companySize: string,           // Ideal employee count
      stage: string,                 // Growth stage (Startup, Growth, etc.)
      budget: string,                // Typical budget range
      decisionSpeed: string,         // How fast they buy
      industries: [
        {
          name: string,
          fit: string                // Why this industry is a good fit
        }
      ],
      decisionMakers: [
        {
          title: string,
          role: string,
          level: string              // C-Suite, VP, Director, etc.
        }
      ]
    },

    psychographics: {
      painPoints: [
        {
          pain: string,
          description: string,
          impact: string             // Business impact of this pain
        }
      ],
      values: string[],              // What these customers care about
      goals: string[]                // What they're trying to achieve
    }
  },

  // Generated Leads (Automated Flow)
  leads: [
    {
      id: string,                    // Unique lead identifier

      // Contact Information
      name: string,                  // Full name
      title: string,                 // Job title
      email: string,                 // Email address
      linkedin: string,              // LinkedIn profile URL
      phone: string,                 // Phone number (if available)

      // Company Information
      company: string,               // Company name
      domain: string,                // Company domain
      industry: string,              // Primary industry
      employees: number,             // Employee count

      // Scoring
      score: number,                 // Overall match score (0-100)
      matchDetails: string[],        // Why this is a good match
      scoreBreakdown: {
        title: number,               // Job title match (0-30)
        industry: number,            // Industry match (0-25)
        size: number,                // Company size match (0-20)
        location: number,            // Geographic match (0-15)
        notAvoid: number,            // Not on avoid list (0-5)
        dataQuality: number          // Data completeness (0-5)
      }
    }
  ],

  // Lead Generation Metadata
  leadsGeneratedAt: timestamp,       // When leads were last generated
  barryGeneratingLeads: boolean,     // Is Barry currently working?
  leadGenerationError: string        // Error message if generation failed
}
```

#### **Collection: `missions/{userId}/current/{phaseId}`**
*(Optional advanced workflow - not MVP critical)*

```javascript
// phase1 - TAM Discovery
{
  allCompanies: Company[],           // All discovered companies
  validationSample: Company[],       // 10 companies for user validation
  validationResults: {
    accepted: Company[],
    rejected: Company[],
    acceptReasons: { [companyId]: string },
    rejectReasons: { [companyId]: string }
  },
  progress: {
    currentCard: number,
    totalCards: number,
    percentComplete: number
  },
  lastUpdated: timestamp
}

// phase2 - AI Scoring
{
  scoredCompanies: [
    {
      ...Company,
      aiScore: number,               // AI-generated score (0-100)
      reasoning: string              // Why this score was given
    }
  ],
  selectionResults: {
    accepted: Company[],
    rejected: Company[]
  },
  completedAt: timestamp
}

// phase3 - Contact Discovery
{
  allSelections: {
    [companyId]: {
      accepted: Contact[],
      rejected: Contact[]
    }
  },
  completedAt: timestamp
}

// phase4 - Ranking
{
  rankedContacts: [
    {
      ...Contact,
      barryRank: number,             // AI-generated rank (1-N)
      rankingReasoning: string       // Why this rank
    }
  ],
  totalContacts: number,
  completedAt: timestamp
}

// phase5 - Campaign Builder
{
  campaigns: {
    [contactId]: {
      subject: string,               // Email subject or LinkedIn opener
      messages: string[],            // Multi-touch sequence
      rationale: string              // Why this approach
    }
  },
  campaignType: "email" | "linkedin",
  selectedContactIds: string[],
  completedAt: timestamp
}
```

### 1.2 Data Entities

#### **Company Object**
```javascript
{
  id: string,
  name: string,
  domain: string,
  industry: string,
  employees: number,
  description: string,
  location: string,
  aiScore?: number,                  // Only in Phase 2+
  reasoning?: string                 // Only in Phase 2+
}
```

#### **Contact/Lead Object**
```javascript
{
  id: string,
  name: string,
  title: string,
  email: string,
  linkedin: string,
  phone: string,
  company: string,
  companyDomain: string,
  industry: string,
  employees: number,
  score: number,
  matchDetails: string[],
  scoreBreakdown: {
    title: number,
    industry: number,
    size: number,
    location: number,
    notAvoid: number,
    dataQuality: number
  }
}
```

---

## 2. Core Features

### 2.1 Authentication System
**Purpose:** Secure user access and data isolation

**Functionality:**
- Email/password signup with Firebase Auth
- Login with email/password
- Protected routes (redirect to login if not authenticated)
- Automatic session management
- Logout functionality

**Technical Implementation:**
- `firebase/auth` library
- `onAuthStateChanged` listener in App.jsx
- Route protection wrapper component

---

### 2.2 Scout Questionnaire (Onboarding)
**Purpose:** Capture comprehensive ICP inputs from user

**Functionality:**
- Multi-section form with auto-save
- Section 1: Business Overview (goal, website, LinkedIn)
- Section 2: Industry Selection (11 predefined + custom)
  - Technology, Healthcare, Financial Services, Manufacturing, etc.
- Section 3: Job Title Selection (categorized by department)
  - Executive, Sales, Marketing, Operations, Technical, Finance, HR, Other
- Section 4: Company Size (6 tiers: 1-10, 11-50, 51-200, 201-500, 501-1000, 1000+)
- Section 5: Geographic Targeting
  - US states (multi-select)
  - Metro areas (multi-select)
  - Remote companies option
- Section 6: Qualitative Inputs
  - Known competitors
  - Perfect-fit example companies
  - Companies to avoid
  - Customer pain points
  - Value proposition

**Technical Implementation:**
- Component: `ImprovedScoutQuestionnaire.jsx`
- Firebase save on each section completion
- Validation before allowing section progression
- Local state with Firebase sync

---

### 2.3 ICP Brief Generation
**Purpose:** AI synthesizes questionnaire into actionable ICP document

**Functionality:**
- Auto-generates when user reaches ICP Validation page
- Uses Anthropic Claude API with structured output
- Creates comprehensive ICP brief with:
  - Ideal customer summary
  - Perfect fit indicators
  - Anti-profile (red flags)
  - Firmographics (size, stage, budget, decision speed, industries, decision-makers)
  - Psychographics (pain points with impact, values, goals)
- User review and approval workflow
- Option to regenerate if not satisfied

**Technical Implementation:**
- Netlify Function: `generate-icp-brief.js`
- Input: `scoutData` object
- AI Model: Claude 3.5 Sonnet
- Timeout: 15 minutes (900s)
- Saves to Firebase: `users/{userId}.icpBrief`
- Sets flag: `icpApproved: true` on approval

---

### 2.4 Automated Lead Generation
**Purpose:** Barry discovers and scores qualified leads automatically

**Functionality:**
- Triggers automatically after ICP approval
- **Step 1:** Barry analyzes ICP and creates search strategy
- **Step 2:** Discovers top 20 companies from Apollo API
- **Step 3:** AI scores each company (0-100 scale, 60+ threshold)
- **Step 4:** Finds decision-makers in top 10 companies (parallel)
- **Step 5:** Scores and ranks contacts
- **Step 6:** Saves 15-20 best leads to Firebase
- Real-time updates via Firebase listener (user sees progress)
- Provides analytics summary

**Technical Implementation:**
- Netlify Function: `generate-leads-v2.js`
- Inputs: `userId`, `scoutData`, `icpBrief`
- External APIs:
  - Apollo.io API (company & contact search)
  - Anthropic Claude API (scoring & strategy)
- Timeout: 15 minutes (900s)
- Parallel processing for contact discovery (10 companies simultaneously)
- Firebase real-time updates: `barryGeneratingLeads`, `leads`, `leadsGeneratedAt`

---

### 2.5 Mission Control Dashboard
**Purpose:** Central hub to view ICP and browse generated leads

**Functionality:**
- **Tab 1: Your ICP**
  - Display full ICP brief
  - Sections: Overview, Perfect Fit, Anti-Profile, Firmographics, Psychographics
  - Collapsible detail sections
  - Edit ICP button (returns to Scout Questionnaire)

- **Tab 2: Your Companies**
  - Display all generated leads
  - Filter by match score: All / 70+ / 85+
  - Sort by: Score (high-low), Size (large-small), Alphabetical
  - Lead cards showing:
    - Contact name, title, company
    - Match score with color coding (🟢 85+, 🟡 70-84, ⚪ <70)
    - Email, LinkedIn, phone
    - Company industry and size
    - Match reasoning
    - Score breakdown (expandable)
  - Empty state if no leads generated yet
  - Loading state while Barry generates leads

**Technical Implementation:**
- Component: `MissionControlDashboard.jsx`
- Firebase real-time listener: `onSnapshot(doc(db, 'users', userId))`
- Client-side filtering and sorting
- Responsive grid layout (Tailwind CSS)

---

### 2.6 Mission-Based Workflow (Post-MVP)
**Purpose:** Advanced guided workflow for power users

**Features:**
- Phase 1: TAM Discovery (swipe to validate companies)
- Phase 2: AI Scoring (review AI-scored companies)
- Phase 3: Contact Discovery (find decision-makers)
- Phase 4: Ranking (AI prioritization)
- Phase 5: Campaign Builder (generate outreach)

**Status:** Built but not critical for MVP launch

---

## 3. Screens & Buttons

### 3.1 Login Screen (`/login`)

**Elements:**
- Email input field
- Password input field
- "Log In" button
- "Don't have an account? Sign up" link

**Actions:**
- Submit: Authenticate with Firebase Auth
- Success: Redirect to `/scout-questionnaire` (if not completed) or `/mission-control`
- Error: Display error message

---

### 3.2 Signup Screen (`/signup`)

**Elements:**
- Email input field
- Password input field
- Confirm password field
- "Sign Up" button
- "Already have an account? Log in" link

**Actions:**
- Submit: Create Firebase Auth account + Firestore user document
- Success: Redirect to `/scout-questionnaire`
- Error: Display error message (email in use, weak password, etc.)

---

### 3.3 Scout Questionnaire Screen (`/scout-questionnaire`)

**Elements:**
- Progress indicator (Section X of 6)
- Section-specific input fields
- "Next" button (advances section)
- "Back" button (returns to previous section)
- "Save & Exit" button (saves progress, returns to dashboard)

**Section 1: Business Overview**
- Text input: "What is your primary business goal?"
- URL input: "Company website"
- URL input: "LinkedIn company page"

**Section 2: Industries**
- Checkbox grid: 11 industries
- Text input: "Other industries"
- Multi-select (can choose multiple)

**Section 3: Job Titles**
- Categorized checkboxes (Executive, Sales, Marketing, etc.)
- Text input: "Other job titles"
- Multi-select

**Section 4: Company Size**
- Checkbox list: 6 size ranges
- Multi-select

**Section 5: Geographic Targeting**
- Radio buttons: "Specific states", "Specific metros", "Remote", "National"
- Multi-select dropdowns for states/metros (conditional on radio selection)

**Section 6: Qualitative**
- Text area: "Known competitors"
- Text area: "Perfect-fit companies"
- Text area: "Companies to avoid"
- Text area: "Customer pain points"
- Text area: "Your value proposition"

**Actions:**
- Next: Validate current section, save to Firebase, advance
- Back: Return to previous section (no validation)
- Save & Exit: Save current state to Firebase, redirect to dashboard
- Final Submit: Mark `scoutCompleted: true`, redirect to `/icp-validation`

---

### 3.4 ICP Validation Screen (`/icp-validation`)

**Elements:**
- Loading spinner (while generating ICP)
- ICP Brief display (structured sections):
  - Header: Company name + ideal customer summary
  - Perfect Fit Indicators (bullet list)
  - Anti-Profile (bullet list)
  - Key Insight (callout box)
  - Firmographics (table/cards)
  - Psychographics (expandable sections)
- "Approve ICP & Generate Leads" button (primary CTA)
- "Regenerate ICP" button (secondary)
- "Edit Questionnaire" button (tertiary)

**Actions:**
- Auto-generate: On page load, if `icpBrief` doesn't exist, call `generate-icp-brief` function
- Approve: Set `icpApproved: true`, trigger lead generation, redirect to `/mission-control`
- Regenerate: Call `generate-icp-brief` again, replace existing ICP
- Edit: Return to `/scout-questionnaire` with pre-filled data

---

### 3.5 Mission Control Dashboard (`/mission-control`)

**Elements:**

**Header:**
- App logo and name
- User email display
- Logout button

**Tab Navigation:**
- "Your ICP" tab
- "Your Companies" tab

**Tab 1: Your ICP**
- ICP Brief display (same structure as validation page)
- "Edit ICP" button
- "Regenerate Leads" button (if leads exist)

**Tab 2: Your Companies**

*Filter Controls:*
- Score filter buttons: "All" / "70+" / "85+"
- Sort dropdown: "Score" / "Size" / "A-Z"

*Lead Cards Grid:*
Each card shows:
- Contact name (heading)
- Job title
- Company name
- Industry
- Employee count
- Match score badge (with color)
- Email (mailto link)
- LinkedIn (external link)
- Phone number
- "Why This Match" section (expandable)
- Score breakdown (expandable table)

*Empty State:*
- "Barry is discovering your perfect leads..."
- Loading animation
- Progress message

**Actions:**
- Filter: Re-render cards based on score threshold
- Sort: Re-order cards based on criteria
- Expand details: Toggle match reasoning and score breakdown
- Email link: Open default email client
- LinkedIn link: Open LinkedIn profile in new tab
- Edit ICP: Return to Scout Questionnaire
- Regenerate: Clear existing leads, re-run lead generation
- Logout: Sign out of Firebase Auth, redirect to `/login`

---

### 3.6 Mission Phase Screens (Post-MVP)

**Phase 1: `/mission-phase1`**
- Swipe cards for company validation
- "Accept" / "Reject" buttons
- Reason input for each decision
- Progress bar
- Undo last action button

**Phase 2: `/mission-phase2`**
- Scored companies list
- Select companies to advance
- AI score display with reasoning
- "Continue with Selected" button

**Phase 3: `/mission-phase3`**
- Company-by-company contact review
- Swipe interface for each contact
- "Next Company" button
- Progress indicator

**Phase 4: `/mission-phase4`**
- Ranked contacts list
- Drag-to-reorder functionality
- "Confirm Rankings" button
- Manual rank override inputs

**Phase 5: `/mission-phase5`**
- Campaign type selector (Email/LinkedIn)
- Contact selection (top 10 auto-selected)
- Generated campaign preview
- "Export to CSV" button
- "Generate New Campaign" button

---

## 4. Screen Responsibilities

### 4.1 Login Screen
**Must Do:**
- Validate email format
- Validate password not empty
- Handle Firebase Auth errors gracefully
- Redirect authenticated users to appropriate screen based on onboarding status

---

### 4.2 Signup Screen
**Must Do:**
- Validate email format
- Validate password strength (min 6 characters)
- Validate password confirmation match
- Create Firebase Auth account
- Create Firestore user document with initial fields
- Handle errors (email already in use, network errors)

---

### 4.3 Scout Questionnaire Screen
**Must Do:**
- Save data to Firebase after each section completion
- Validate required fields before allowing progression
- Preserve data if user navigates away and returns
- Show clear progress indication
- Prevent submission if incomplete
- Mark `scoutCompleted: true` on final submission

**Must NOT Do:**
- Block user from saving partial progress
- Lose data on browser refresh
- Allow submission with empty required fields

---

### 4.4 ICP Validation Screen
**Must Do:**
- Auto-generate ICP on page load if not exists
- Show loading state during generation (typically 30-60 seconds)
- Display comprehensive ICP brief in readable format
- Allow approval with single click
- Trigger automated lead generation on approval
- Handle generation errors gracefully with retry option

**Must NOT Do:**
- Block user from editing questionnaire if ICP is wrong
- Allow proceeding without approval
- Generate duplicate ICPs if one exists

---

### 4.5 Mission Control Dashboard
**Must Do:**
- Display real-time lead updates as Barry generates them
- Show loading state while leads are being generated
- Filter and sort leads based on user selection
- Display all lead data clearly (contact info, scores, reasoning)
- Provide actionable links (email, LinkedIn)
- Show empty state if no leads exist
- Handle Firebase connection errors

**Must NOT Do:**
- Show stale data (must use real-time listeners)
- Hide lead generation errors from user
- Block user from accessing ICP while leads generate

---

### 4.6 Mission Phase Screens
**Must Do:**
- Save user selections/decisions to Firebase incrementally
- Show clear progress indicators
- Allow undo of recent actions
- Handle long AI processing times (show loading states)
- Preserve state if user navigates away

**Must NOT Do:**
- Lose user decisions if they close browser
- Proceed to next phase with incomplete data
- Generate duplicate results

---

## 5. APIs & External Tools

### 5.1 Apollo.io API
**Purpose:** Company and contact data provider

**Endpoints Used:**
- `/v1/mixed_companies/search` - Search for companies matching criteria
- `/v1/mixed_people/search` - Search for contacts at specific companies

**Authentication:** API Key (header: `x-api-key`)

**Key Parameters:**
- `organization_num_employees_ranges` - Company size filters
- `q_organization_keyword_tags` - Industry keywords
- `person_titles` - Job title filters
- `per_page` - Results per request (max 100)
- `page` - Pagination

**Rate Limits:**
- Free tier: 50 requests/month
- Paid tier: Varies by plan

**Data Returned:**
- Company: name, domain, industry, employees, description, location
- Contact: name, title, email, LinkedIn URL, phone

**Error Handling:**
- 429 (Rate Limit): Pause and retry with exponential backoff
- 404 (No Results): Log and continue with empty results
- 500 (Server Error): Retry up to 3 times

---

### 5.2 Anthropic Claude API
**Purpose:** AI-powered ICP generation, company scoring, contact ranking

**Model Used:** Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`)

**Authentication:** API Key (header: `x-api-key`)

**Key Functions:**

**ICP Brief Generation:**
- Input: `scoutData` object as context
- Prompt: Structured instructions to generate ICP brief
- Output: JSON with firmographics and psychographics

**Company Scoring:**
- Input: ICP brief + company data
- Prompt: Score company fit (0-100) with reasoning
- Output: Score + explanation

**Contact Ranking:**
- Input: ICP brief + contact list
- Prompt: Rank contacts by likelihood to convert
- Output: Ranked list with rationale

**Campaign Generation:**
- Input: ICP brief + contact data + campaign type
- Prompt: Create personalized outreach sequence
- Output: Subject + 3-touch message sequence

**Rate Limits:**
- Tier 1: 50 requests/minute, 5,000/day
- Automatic retry with exponential backoff

**Error Handling:**
- 429 (Rate Limit): Wait and retry
- 529 (Overloaded): Retry up to 3 times
- 400 (Invalid Request): Log error and alert user

---

### 5.3 Firebase Services

**Firebase Authentication:**
- Email/password authentication
- Session management
- User state listener

**Firebase Firestore:**
- NoSQL database for user data, ICPs, leads
- Real-time listeners for live updates
- Security rules: User can only access their own data

**Firebase Configuration:**
- Project: `idynify-scout-dev`
- API Key: `AIzaSyCMJSaHTeNbNpAZO4Ap54QF93k-0UB-KAo`
- Auth Domain: `idynify-scout-dev.firebaseapp.com`
- Database URL: `https://idynify-scout-dev.firebaseio.com`

---

### 5.4 Netlify Functions (Serverless Backend)

**Why Netlify Functions:**
- Hide API keys from client
- Long-running AI processes (up to 15 minutes)
- Server-side data processing
- Rate limit management

**Key Functions:**

**`generate-icp-brief.js`**
- Method: POST
- Input: `{ scoutData }`
- Returns: `{ icpBrief }`
- Timeout: 900s (15 min)

**`generate-leads-v2.js`**
- Method: POST
- Input: `{ userId, scoutData, icpBrief }`
- Returns: `{ leads, analytics }`
- Timeout: 900s (15 min)
- Side Effect: Writes directly to Firestore

**Error Responses:**
- 500: Internal server error (log details)
- 503: External API unavailable (Apollo/Anthropic down)
- 408: Timeout (function exceeded 15 minutes)

---

## 6. Acceptance Criteria

### 6.1 User Authentication

✅ **Signup:**
- User can create account with valid email and password
- Firebase user document created with correct structure
- User redirected to `/scout-questionnaire` after signup
- Error messages shown for invalid inputs

✅ **Login:**
- User can log in with correct credentials
- Redirected to appropriate screen based on onboarding status:
  - Not completed Scout → `/scout-questionnaire`
  - Not approved ICP → `/icp-validation`
  - Completed onboarding → `/mission-control`
- Error messages shown for incorrect credentials

✅ **Session Management:**
- User stays logged in on browser refresh
- User can log out successfully
- Protected routes redirect to login if not authenticated

---

### 6.2 Scout Questionnaire

✅ **Data Collection:**
- All 6 sections accept user input
- Industry and job title selections save correctly
- Geographic targeting saves all selected states/metros
- Qualitative text fields accept long-form input (500+ characters)

✅ **Validation:**
- Cannot proceed to next section with missing required fields
- Error messages shown for invalid inputs (malformed URLs, etc.)
- Final submission blocked if any section incomplete

✅ **Persistence:**
- Data saved to Firebase after each section
- Data persists on browser refresh
- User can return and edit previously saved data

✅ **Completion:**
- Final submission sets `scoutCompleted: true`
- User redirected to `/icp-validation`

---

### 6.3 ICP Brief Generation

✅ **Auto-Generation:**
- ICP generates automatically on page load (if not exists)
- Loading state shown during generation (30-90 seconds typical)
- Generation completes successfully with valid `icpBrief` object

✅ **ICP Content Quality:**
- Ideal customer summary is 2-3 sentences
- At least 3 perfect fit indicators
- At least 3 anti-profile items
- Firmographics includes all specified fields
- Psychographics includes at least 3 pain points

✅ **User Actions:**
- User can approve ICP (triggers lead generation)
- User can regenerate ICP (overwrites existing)
- User can edit questionnaire (returns with data preserved)

✅ **Error Handling:**
- Error message shown if generation fails
- Retry button appears on failure
- User not blocked from editing questionnaire if generation fails

---

### 6.4 Automated Lead Generation

✅ **Trigger:**
- Lead generation starts automatically after ICP approval
- `barryGeneratingLeads` flag set to `true` during processing
- User can see "Barry is working..." message

✅ **Data Quality:**
- At least 10 leads generated (target 15-20)
- Each lead has valid contact information (name, title, company)
- At least 60% of leads have email addresses
- Each lead has match score between 0-100
- Each lead has at least 2 match details

✅ **Performance:**
- Lead generation completes within 10 minutes
- Real-time updates to Firebase during processing
- User sees leads appear as they're generated

✅ **Error Handling:**
- If Apollo returns no companies: Error message with suggestion to broaden ICP
- If AI scoring fails: Retry automatically up to 3 times
- If complete failure: Set `leadGenerationError` with clear message

---

### 6.5 Mission Control Dashboard

✅ **ICP Tab:**
- Full ICP brief displayed with all sections
- Sections are collapsible/expandable
- Edit button returns to Scout Questionnaire
- Formatting is readable and professional

✅ **Companies Tab - Data Display:**
- All generated leads displayed in grid
- Each lead card shows all required information
- Scores displayed with color coding (85+ green, 70-84 yellow, <70 white)
- Contact links (email, LinkedIn) are functional
- Phone numbers formatted correctly

✅ **Companies Tab - Filtering:**
- "All" filter shows all leads
- "70+" filter shows only leads with score ≥70
- "85+" filter shows only leads with score ≥85
- Filter changes apply immediately

✅ **Companies Tab - Sorting:**
- "Score" sort orders by match score (high to low)
- "Size" sort orders by employee count (large to small)
- "A-Z" sort orders alphabetically by company name
- Sort changes apply immediately

✅ **Real-Time Updates:**
- Dashboard listens for Firebase changes
- New leads appear automatically as generated
- `barryGeneratingLeads` flag updates loading state
- No manual refresh needed

✅ **Empty States:**
- If no leads generated yet: Show loading message
- If lead generation failed: Show error message with retry option

---

### 6.6 Mission-Based Workflow (Post-MVP)

✅ **Phase 1 - TAM Discovery:**
- User can swipe through 10 company cards
- Accept/reject actions save to Firebase
- Undo button works for last action
- Barry discovers companies successfully from Apollo

✅ **Phase 2 - AI Scoring:**
- Barry scores all companies from Phase 1
- Scores are between 0-100 with reasoning
- User can select companies to advance
- Selected companies saved to Phase 3

✅ **Phase 3 - Contact Discovery:**
- Barry finds contacts at each selected company
- User can accept/reject contacts per company
- Progress shown (Company X of Y)
- Accepted contacts saved to Phase 4

✅ **Phase 4 - Ranking:**
- Barry ranks all accepted contacts
- User can manually adjust rankings
- Rankings saved to Phase 5
- Top 10 auto-selected for campaigns

✅ **Phase 5 - Campaign Builder:**
- User selects campaign type (email/LinkedIn)
- Barry generates personalized campaigns for selected contacts
- Campaigns are unique per contact (not templated)
- User can export to CSV

---

### 6.7 System-Wide

✅ **Performance:**
- Page load times < 2 seconds (excluding AI processing)
- No browser console errors
- Mobile responsive (works on 375px+ screens)
- Real-time listeners don't cause memory leaks

✅ **Security:**
- API keys not exposed in client-side code
- Firestore security rules prevent unauthorized access
- User can only access their own data
- Firebase Auth tokens expire appropriately

✅ **Error Handling:**
- All external API failures handled gracefully
- User-friendly error messages (no technical jargon)
- Network failures show retry options
- Firebase connection issues detected and reported

✅ **Data Integrity:**
- No data loss on browser refresh
- Firebase writes are atomic (no partial saves)
- Real-time listeners sync correctly
- Duplicate lead generation prevented

---

## 7. Technical Constraints

### 7.1 API Rate Limits
- **Apollo:** 50 requests/month (free tier) → Plan for efficient batching
- **Anthropic:** 50 requests/minute → Implement exponential backoff
- **Firebase:** 50K reads/day (free tier) → Optimize queries

### 7.2 Function Timeouts
- **Netlify Functions:** 15-minute max → Lead generation must complete within this
- **Client HTTP Timeout:** 2 minutes default → Use Firebase listeners, not long-polling

### 7.3 Data Limits
- **Firestore Document:** 1MB max → Store large datasets across multiple documents
- **Firebase Storage:** 5GB free → Not used in MVP

### 7.4 Browser Compatibility
- **Target:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Mobile:** iOS Safari 14+, Chrome Android 90+

---

## 8. Success Metrics

### 8.1 Onboarding Completion Rate
- **Target:** 70% of signups complete Scout Questionnaire
- **Measure:** `scoutCompleted` flag vs. total signups

### 8.2 Lead Generation Success Rate
- **Target:** 90% of approved ICPs generate at least 10 leads
- **Measure:** Users with `leads.length >= 10` vs. `icpApproved: true`

### 8.3 Time to First Value
- **Target:** <15 minutes from signup to viewing leads
- **Measure:** `leadsGeneratedAt` - `createdAt`

### 8.4 Lead Quality (User Perception)
- **Target:** Users reach out to 5+ leads in first week
- **Measure:** User surveys + analytics (future feature)

### 8.5 System Reliability
- **Target:** <5% function failure rate
- **Measure:** Netlify function error logs

---

*Last Updated: December 2025*
*Version: 1.0 MVP*
