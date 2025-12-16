# MVP User Flow — Idynify Scout
**Version:** 1.0
**Status:** Baseline
**Last Updated:** December 15, 2025

---

## Document Purpose

This document maps the **complete user journey** through Idynify Scout MVP, from first landing to SCOUT completion.

**Scope:**
- Primary happy path (no errors)
- Alternative paths (iteration, edge cases)
- Time estimates for each phase
- User emotions and key decision points

---

## User Journey Overview

```
Landing → Payment → RECON → SCOUT → Completion → HUNTER Teaser
  2min      2min     25min    30min      2min         1min

Total Time: ~1 hour from discovery to target list
```

---

## Phase 1: Discovery & Conversion (5 minutes)

### Step 1.1: Landing Page

**URL:** `/` or `/home`

**User Arrives From:**
- Product Hunt
- LinkedIn post
- Google search ("AI GTM strategist")
- Referral link

**User Sees:**
- **Hero:** "Stop Guessing Who to Target"
- **Subheadline:** "Your AI GTM strategist delivers a prioritized company list in under an hour—for $9.99"
- **CTA:** Large button "Get Started — $9.99"
- **Social Proof:** "100+ GTM teams trust Idynify Scout" (post-launch)
- **Value Props:**
  - ✅ 4 Strategic Outputs (RECON)
  - ✅ Scored Company List (SCOUT)
  - ✅ 1 Hour, Not 10 Hours/Week
- **Tier Comparison:**
  - RECON: Market intelligence ($9.99)
  - SCOUT: Company selection ($9.99, included)
  - HUNTER: Meeting booking ($49/month, coming soon)

**User Thinks:**
- "This sounds too good to be true, but $9.99 is low risk"
- "I'm spending 10 hours/week on this, worth a try"
- "What are these 4 outputs?"

**User Actions:**
- Scrolls to read more
- Checks tier comparison
- Reads FAQ (optional)
- Clicks "Get Started — $9.99"

**Time:** 2-3 minutes

---

### Step 1.2: Stripe Checkout

**Trigger:** User clicks "Get Started — $9.99"

**User Experience:**
1. Client calls Netlify function `create-checkout-session`
2. Redirects to Stripe Checkout (hosted page)
3. User sees:
   - Idynify Scout logo
   - Line item: "RECON + SCOUT Access — $9.99"
   - Email input
   - Card details input
   - "Pay $9.99" button

**User Thinks:**
- "Stripe is secure, I trust this"
- "Only $9.99, low commitment"

**User Actions:**
- Enters email
- Enters card details
- Clicks "Pay $9.99"
- Waits for confirmation (2-5 seconds)

**Success:**
- Stripe shows "Payment successful"
- Redirects to `/payment-success`

**Error Paths:**
- Card declined → Stripe shows error, user can retry
- User abandons → Can return later (link in email)

**Time:** 1-2 minutes

---

### Step 1.3: Payment Success Screen

**URL:** `/payment-success`

**User Sees:**
- ✅ "Welcome to Idynify Scout!"
- "You're all set. Here's what happens next:"
  - **Step 1:** Complete RECON (15 minutes) → Get 4 strategic outputs
  - **Step 2:** Run SCOUT missions (30 minutes) → Get your target list
- CTA: "Start RECON Now"
- "Receipt sent to your email" (Stripe)

**User Thinks:**
- "Okay, I'm in. Let's see what this Barry can do."
- "15 minutes for RECON? That's fast."

**User Actions:**
- Clicks "Start RECON Now"
- Redirects to `/recon-questionnaire`

**Time:** 30 seconds

---

## Phase 2: RECON — Market Intelligence (25-40 minutes)

### Step 2.1: RECON Questionnaire (15-25 minutes)

**URL:** `/recon-questionnaire`

**User Sees:**
- Header: "RECON — Tell Barry About Your Business"
- Progress: "Section 1 of 6"
- Auto-save indicator: "Saved 2 seconds ago"
- Buttons: "Next" | "Save & Exit"

**Section 1: Business Context**

**User Inputs:**
- Primary business goal (text area)
  - Example: "Generate 20 qualified leads/month for $50K consulting packages"
- Company website
- LinkedIn company page

**User Thinks:**
- "This is straightforward, I know my goal"
- "Auto-save is nice, I can leave and come back"

**User Actions:**
- Types goal (2 minutes)
- Enters URLs (30 seconds)
- Clicks "Next"

**Time:** 2-3 minutes

---

**Section 2: Target Industries**

**User Sees:**
- Checkbox grid (11 predefined industries)
- Text input for "Other industries"

**User Actions:**
- Selects 2-3 industries (e.g., Technology, Healthcare)
- Clicks "Next"

**Time:** 1-2 minutes

---

**Section 3: Decision-Maker Titles**

**User Sees:**
- Categorized checkboxes (Executive, Sales, Marketing, etc.)
- Text input for "Other titles"

**User Actions:**
- Selects 3-5 titles (e.g., CEO, CTO, VP Engineering)
- Clicks "Next"

**Time:** 2-3 minutes

---

**Section 4: Company Characteristics**

**User Sees:**
- Company size (checkboxes)
- Company stage (checkboxes)
- Revenue range (optional)

**User Actions:**
- Selects 2-3 size ranges (e.g., 50-200, 201-500)
- Selects 1-2 stages (e.g., Series A, Series B)
- Clicks "Next"

**Time:** 1-2 minutes

---

**Section 5: Geographic Targeting**

**User Sees:**
- Scope radio buttons (Specific states, metros, remote, national)
- Conditional dropdowns (states/metros)

**User Actions:**
- Selects "Specific metros"
- Selects "San Francisco, New York"
- Clicks "Next"

**Time:** 1-2 minutes

---

**Section 6: Strategic Context**

**User Sees:**
- Text areas:
  - Known competitors
  - Perfect-fit companies (required, min 2)
  - Companies to avoid
  - Customer pain points (required)
  - Your value proposition (required)

**User Actions:**
- Fills out all fields (5-10 minutes)
- Clicks "Submit to Barry"

**User Thinks:**
- "This is making me think deeply about my ICP"
- "I'm not sure about some of these answers, hope Barry helps"

**Time:** 5-10 minutes

---

**Total Questionnaire Time:** 15-25 minutes

**Emotions:**
- Start: Curious, slightly skeptical
- Middle: Engaged, thoughtful
- End: Hopeful, invested

---

### Step 2.2: Barry's Assumption Challenge (5-10 minutes)

**URL:** `/recon-validation`

**Trigger:** User clicks "Submit to Barry"

**User Sees:**
1. **Loading State:**
   - "Barry is analyzing your inputs..."
   - Animated spinner
   - Progress: "30 seconds remaining"

2. **Barry's Questions:**
   - "Barry has some questions about your inputs"
   - 2-4 critical questions with context

**Example Question 1:**
- **Question:** "You want 20 leads/month at $50K deal size. Based on your target market (50-200 employee SaaS companies), this implies you need to close 1-2 deals/month. Is your sales cycle <30 days, or do you have a pipeline already?"
- **Input:** Text area
- **User Answer:** "Our sales cycle is 60-90 days, but we have 10 warm leads already."

**Example Question 2:**
- **Question:** "Your perfect-fit companies (Stripe, Plaid) are Series B+ with 500+ employees, but you selected 50-200 employees as your target size. Which is correct?"
- **Input:** Radio buttons
  - Adjust size to 500+ employees
  - Adjust examples to smaller companies
  - My target is flexible (include both)
- **User Answer:** Selects "Adjust size to 500+ employees"

**User Thinks:**
- "Wow, Barry actually caught that inconsistency"
- "This is making me refine my thinking"
- "I trust Barry more now"

**User Actions:**
- Answers all questions (3-5 minutes)
- Clicks "Submit Answers to Barry"

**Time:** 5-10 minutes

---

### Step 2.3: Refined Analysis (2 minutes)

**User Sees:**
- "Thanks for clarifying. Here's what I learned:"
- Summary:
  - "Updated TAM estimate: 1,200 companies (down from 5,000)"
  - "Revised ICP: Series A+ FinTech, 500+ employees, SF/NYC"
  - "Goal feasibility: Achievable with 15-20 outbound touches/week"

**User Thinks:**
- "Barry just saved me from targeting the wrong companies"
- "This feels personalized, not generic"

**User Actions:**
- Reviews summary
- Clicks "Approve & Generate Outputs"

**Time:** 1-2 minutes

---

### Step 2.4: Four RECON Outputs (Generated in 2-3 minutes)

**User Sees:**
1. **Loading State:**
   - "Barry is creating your strategic outputs..."
   - Progress bar: 0% → 25% → 50% → 75% → 100%
   - "Generating ICP Brief... Done ✅"
   - "Generating Goal Strategy... Done ✅"
   - "Generating Company Scorecard... Done ✅"
   - "Generating TAM Report... Done ✅"

2. **Outputs Screen (`/recon-outputs`):**
   - Header: "Your RECON Outputs Are Ready!"
   - 4 tabs (or collapsible sections):
     1. Enhanced ICP Brief
     2. Goal-Validated Strategy
     3. Company Scorecard
     4. TAM Report
   - Download buttons: PDF | Markdown | Download All (ZIP)

**User Actions:**
- Clicks through each tab (5 minutes)
- Reads outputs
- Downloads PDF (optional)
- Clicks "Start SCOUT"

**User Thinks:**
- "This is incredibly detailed"
- "I can share this with my team"
- "Worth way more than $9.99"

**Emotions:**
- Impressed, validated, confident

**Time:** 5-10 minutes (reading + downloading)

---

### Step 2.5: RECON Completion

**URL:** `/recon-complete`

**User Sees:**
- "RECON Complete! 🎉"
- Summary:
  - ✅ 4 strategic outputs generated
  - ✅ ICP validated by Barry
  - ✅ Ready for SCOUT (company discovery)
- Download links (4 outputs)
- CTA: "Start SCOUT — Discover Your Target Companies"

**User Actions:**
- Downloads outputs (optional)
- Clicks "Start SCOUT"
- Redirects to `/scout-dashboard`

**Time:** 1 minute

---

**Total RECON Time:** 25-40 minutes

**Key Outcome:**
- User has 4 downloadable strategic documents
- User feels confident about their ICP
- User is excited to see what companies Barry finds

---

## Phase 3: SCOUT — Company Selection (30-40 minutes)

### Step 3.1: SCOUT Dashboard

**URL:** `/scout-dashboard`

**User Sees:**
- Header: "SCOUT — Company Selection Missions"
- **Discovery Status (Background Process):**
  - "Barry is discovering companies..."
  - Progress: "25 companies found, 12 scored"
  - Real-time updates via Firebase listener
- **Mission Cards:**
  - Mission 1: Review Top 20 Companies (🔒 Locked until discovery complete)
  - Mission 2: Deep Dive on Selected Companies (🔒 Locked)
  - Mission 3: Finalize Your Target List (🔒 Locked)

**User Thinks:**
- "Barry's already working in the background"
- "I can see progress, this is cool"

**User Actions:**
- Waits for discovery to complete (3-5 minutes)
- Watches real-time updates

**When Discovery Complete:**
- "Discovery Complete! Barry found 50 companies and scored them all."
- Mission 1 unlocks: "Start Mission 1"

**Time:** 3-5 minutes (waiting for Barry)

---

### Step 3.2: Mission 1 — Review Top 20 Companies (10-15 minutes)

**URL:** `/scout-mission-1`

**User Sees:**
- Swipe interface (Tinder-style)
- **Company Card (Front):**
  - Company name: "Stripe"
  - Industry: FinTech
  - Employees: 8,000
  - Location: San Francisco
  - Stage: Series H
  - Barry's score: 🟡 72/100
  - Barry's take: "Marginal fit — Great industry and location, but company size is too large (8,000 employees vs. your target of 50-500). May have bureaucratic sales cycles."
- **Flip Card (Back):**
  - Full description
  - Website, LinkedIn links
  - Score breakdown (attributes)
- **Actions:**
  - Swipe left / Click "Reject"
  - Swipe right / Click "Accept"
  - Flip card (more details)
  - Undo (last action)
- **Progress:** "Card 1 of 20" | Progress bar: 5%

**User Actions:**
1. Reviews first card (Stripe)
2. Thinks: "Barry's right, too big"
3. Swipes left (Reject)
4. Next card appears (Company #2)
5. Reviews: "Perfect fit — Series A FinTech, 150 employees, SF"
6. Swipes right (Accept)
7. Repeats for all 20 cards

**User Thinks:**
- "Barry's scores are spot-on"
- "This is way faster than manual research"
- "I'm learning what good-fit companies look like"

**Completion:**
- After reviewing all 20:
  - "Mission 1 Complete! 🎉"
  - "You accepted 12 companies, rejected 8"
  - "Earned 50 points 🏆"
  - CTA: "Continue to Mission 2"

**Time:** 10-15 minutes

**Emotions:**
- Engaged (gamified UX)
- Confident (Barry's reasoning validates decisions)
- Momentum (visible progress)

---

### Step 3.3: Mission 2 — Deep Dive & Rank (10-15 minutes)

**URL:** `/scout-mission-2`

**User Sees:**
- List of 12 accepted companies (from Mission 1)
- **Company Row:**
  - Rank: #1 (drag handle)
  - Company name
  - Score: 88/100
  - Industry, size, location
  - "View Details" (expands row)
- **Expanded Details:**
  - Full description
  - Barry's reasoning
  - Score breakdown
  - Website, LinkedIn links
  - "Add Note" (text area for custom context)

**User Actions:**
1. Reviews list (initially sorted by Barry's score)
2. Thinks: "I know Company A's CEO, should be #1"
3. Drags Company A from #5 to #1
4. Adds note: "CEO is former colleague, warm intro possible"
5. Reviews remaining companies
6. Clicks "Save Rankings"

**Completion:**
- "Mission 2 Complete!"
- "You ranked 12 companies"
- "Earned 30 points 🏆"
- CTA: "Continue to Mission 3"

**Time:** 5-10 minutes

**Emotions:**
- Control (user can override Barry's rankings)
- Context (adding notes personalizes the list)
- Readiness (final target list taking shape)

---

### Step 3.4: Mission 3 — Finalize & Export (5-10 minutes)

**URL:** `/scout-mission-3`

**User Sees:**
- **Summary:**
  - "Your Target List: 12 companies"
  - "Top 5 (A-Tier): 5 companies (avg score: 92)"
  - "Next 5 (B-Tier): 5 companies (avg score: 78)"
  - "Remaining: 2 companies (avg score: 71)"
- **Filter Options:**
  - Radio buttons:
    - Export top 5 only
    - Export top 10 only
    - Export all 12
- **Export Formats:**
  - CSV (for CRM import)
  - PDF (for printing/sharing)
  - Markdown (for copying)
- **Preview:**
  - Table view of companies to be exported

**User Actions:**
1. Selects "Export all 12"
2. Clicks "Export CSV"
3. Downloads file: `Idynify-Scout-Target-List-2025-12-15.csv`
4. Optionally exports PDF for team sharing
5. Clicks "Complete Mission"

**CSV Columns:**
- Rank, Company Name, Domain, Industry, Employees, Location, Stage, Score, Barry's Reasoning, User Notes, Website, LinkedIn

**Completion:**
- "Mission 3 Complete! 🎉"
- "SCOUT Complete!"
- "Earned 20 points 🏆"
- "Total points: 100"
- Redirects to `/scout-complete`

**Time:** 2-5 minutes

**Emotions:**
- Accomplishment (completed all missions)
- Utility (tangible output: CSV file)
- Readiness (can start outreach immediately)

---

**Total SCOUT Time:** 30-40 minutes

**Key Outcome:**
- User has prioritized target list (12 companies)
- User knows why each company is a good fit
- User has actionable data (CSV for CRM)

---

## Phase 4: Completion & HUNTER Teaser (2-3 minutes)

### Step 4.1: SCOUT Completion Screen

**URL:** `/scout-complete`

**User Sees:**
- "SCOUT Complete! 🎉"
- Summary:
  - ✅ 50 companies discovered
  - ✅ 12 companies selected
  - ✅ Target list exported
  - 🏆 100 points earned
- Download links (CSV, PDF, Markdown)

**HUNTER Teaser (Prominent):**
- Header: "Ready to Book Meetings with These Companies?"
- Subheader: "HUNTER (Tier 3) is coming soon!"
- **Features:**
  - 🔍 Find decision-maker contacts (names, emails, LinkedIn)
  - ✉️ Generate personalized email campaigns (AI-written, multi-touch)
  - 📅 Automate meeting booking (Calendly integration)
- **Pricing:** "$49/month or $99 one-time"
- **CTA:** "Join HUNTER Waitlist"

**Waitlist Form:**
- Email (pre-filled)
- "What would make HUNTER a must-have for you?" (text area)
- "Join Waitlist" button

**User Thinks:**
- "I have companies, now I need contacts"
- "$49/month is reasonable if it books meetings"
- "I'll join the waitlist"

**User Actions:**
- Reads HUNTER features
- Clicks "Join HUNTER Waitlist"
- Types feedback: "Auto-generated personalized emails would save me hours"
- Clicks "Join Waitlist"
- Confirmation: "Thanks! We'll notify you when HUNTER launches."

**Time:** 2-3 minutes

---

### Step 4.2: Mission Control (Return to Dashboard)

**URL:** `/mission-control`

**User Sees:**
- **RECON Status:**
  - ✅ Completed (timestamp)
  - Button: "View Outputs"
  - Button: "Regenerate RECON" (if they want to refine)
- **SCOUT Status:**
  - ✅ Completed (timestamp)
  - Button: "Download Target List"
  - Button: "Run SCOUT Again" (discover new companies)
- **HUNTER Status:**
  - 🔒 Coming Soon
  - "You're on the waitlist!"
- **Quick Actions:**
  - Download all RECON outputs
  - Download SCOUT target list
  - View analytics (companies discovered, missions completed, points earned)

**User Actions:**
- Downloads files for offline use
- Shares outputs with team
- Logs out or closes browser

**Time:** 1-2 minutes

---

## Total User Journey Time

| Phase | Time | Cumulative |
|-------|------|------------|
| Discovery & Conversion | 5 min | 5 min |
| RECON Questionnaire | 15-25 min | 20-30 min |
| Barry's Challenge | 5-10 min | 25-40 min |
| RECON Outputs | 5-10 min | 30-50 min |
| SCOUT Discovery (waiting) | 3-5 min | 33-55 min |
| Mission 1: Review | 10-15 min | 43-70 min |
| Mission 2: Rank | 5-10 min | 48-80 min |
| Mission 3: Export | 2-5 min | 50-85 min |
| HUNTER Teaser | 2-3 min | 52-88 min |

**Average Total Time:** ~60-70 minutes

---

## Alternative User Paths

### Path 1: User Abandons During Questionnaire

**Scenario:** User completes Section 3, then closes browser.

**Behavior:**
- Data auto-saved to Firebase
- User returns later (days/weeks)
- Logs in
- Redirected to `/recon-questionnaire` (Section 4, where they left off)
- Completes remaining sections

**UX Consideration:**
- Show progress: "Welcome back! You're 50% through RECON."

---

### Path 2: User Rejects Barry's Challenge

**Scenario:** User disagrees with Barry's questions, wants to skip.

**Behavior:**
- "I'm confident in my inputs, skip to outputs"
- Barry generates outputs without refinement
- Outputs may be less accurate
- User can regenerate later

**UX Consideration:**
- Show warning: "Skipping Barry's validation may reduce output accuracy."

---

### Path 3: User Wants to Refine RECON After SCOUT

**Scenario:** User completes SCOUT, realizes ICP is wrong.

**Behavior:**
- Mission Control → "Regenerate RECON"
- Returns to questionnaire (pre-filled with previous answers)
- Edits inputs (e.g., changes target size from 50-200 to 500+)
- Resubmits to Barry
- Gets new outputs
- Can run SCOUT again with new scorecard

**UX Consideration:**
- Warn: "Regenerating RECON will replace your current outputs. Download them first."

---

### Path 4: User Completes SCOUT, Wants More Companies

**Scenario:** User finished SCOUT with 12 companies, wants 30 more.

**Behavior:**
- Mission Control → "Run SCOUT Again"
- Barry discovers next 50 companies (different batch)
- User completes missions again
- Exports combined list (old + new)

**UX Consideration:**
- Allow merging lists (don't overwrite previous selections)

---

## User Emotions Throughout Journey

```
Discovery:       Curious, skeptical
Payment:         Committed, hopeful
Questionnaire:   Engaged, thoughtful
Barry Challenge: Impressed, validated
RECON Outputs:   Confident, excited
SCOUT Discovery: Anticipation, impatient (waiting)
Mission 1:       Focused, momentum
Mission 2:       Control, personalization
Mission 3:       Accomplishment, readiness
HUNTER Teaser:   Interested, eager
```

**Emotional Arc:**
- Start: Skeptical, low commitment
- Middle: Engaged, trusting Barry
- End: Confident, ready to act, wanting more (HUNTER)

---

## Key Decision Points

### Decision 1: Should I Pay $9.99?
- **When:** Landing page
- **Factors:** Value prop clarity, trust (Stripe), low price
- **Outcome:** 30-50% conversion (industry avg for $10 products)

### Decision 2: Do I Trust Barry's Analysis?
- **When:** After Barry's challenge questions
- **Factors:** Quality of questions, relevance, tone
- **Outcome:** 80-90% approve and proceed

### Decision 3: Are These the Right Companies?
- **When:** Mission 1 (reviewing top 20)
- **Factors:** Barry's reasoning, score accuracy, familiarity with companies
- **Outcome:** 60-80% acceptance rate (8-16 companies accepted)

### Decision 4: Should I Join HUNTER Waitlist?
- **When:** SCOUT completion
- **Factors:** Satisfaction with RECON/SCOUT, need for contacts, price
- **Outcome:** 40-60% join waitlist

---

## Success Metrics (User-Level)

### Activation (First Value)
- **Metric:** User completes RECON and views outputs
- **Target:** 80% of paid users
- **Time to Value:** 30-40 minutes

### Engagement
- **Metric:** User completes SCOUT Mission 1
- **Target:** 70% of RECON completers
- **Time:** 10-15 minutes

### Retention
- **Metric:** User exports target list (Mission 3)
- **Target:** 60% of Mission 1 completers
- **Time:** Additional 15-20 minutes

### Advocacy
- **Metric:** User joins HUNTER waitlist or refers a friend
- **Target:** 50% of SCOUT completers
- **Time:** 2-3 minutes post-completion

---

## Drop-Off Analysis (Expected)

### Drop-Off Point 1: Payment (50% drop)
- Reason: Price sensitivity, skepticism, timing
- Mitigation: Social proof, testimonials, money-back guarantee (future)

### Drop-Off Point 2: RECON Questionnaire (20% drop)
- Reason: Too long, unclear value, distraction
- Mitigation: Progress indicators, auto-save, estimated time remaining

### Drop-Off Point 3: SCOUT Mission 1 (10% drop)
- Reason: Fatigue, satisfied with RECON outputs only, time constraints
- Mitigation: Gamification (points), shorter missions, clear value ("Get your target list")

### Drop-Off Point 4: Mission 2-3 (5% drop)
- Reason: Low commitment at this stage, most users complete
- Mitigation: Visible progress, export CTA prominent

---

## User Personas & Journey Variations

### Persona 1: Rushed Founder (30 minutes)
- Skips Barry's challenge (confident in inputs)
- Swipes through Mission 1 quickly (5 minutes)
- Accepts Barry's rankings in Mission 2 (no reordering)
- Exports CSV immediately
- Total time: 30 minutes

### Persona 2: Methodical Sales Leader (90 minutes)
- Carefully answers Barry's questions
- Reads all outputs thoroughly
- Flips every card in Mission 1 (20 minutes)
- Adds detailed notes in Mission 2
- Exports PDF to share with team
- Total time: 90 minutes

### Persona 3: Solo Consultant (45 minutes)
- Completes questionnaire thoughtfully (25 minutes)
- Downloads RECON outputs for client proposal
- Completes SCOUT quickly (need top 5 companies only)
- Exports top 5 as PDF
- Total time: 45 minutes

---

## Mobile vs. Desktop Experience

### Desktop (Recommended)
- Full keyboard input (faster for questionnaire)
- Larger screen (easier to read outputs)
- CSV downloads open in Excel/Google Sheets
- **Time:** 60-70 minutes

### Mobile (Supported)
- Touch-friendly swipe interface (Mission 1)
- Smaller screen (more scrolling)
- Downloads save to phone (less convenient)
- **Time:** 70-80 minutes (slightly slower due to input)

**Recommendation:** Desktop for RECON, mobile acceptable for SCOUT.

---

## Accessibility Considerations

### Visual Impairments
- Screen reader support (ARIA labels)
- High contrast mode (future enhancement)
- Keyboard navigation (all actions accessible without mouse)

### Cognitive Load
- One question at a time (questionnaire sections)
- Clear progress indicators
- Auto-save (reduce anxiety about losing work)
- Undo buttons (reduce fear of mistakes)

### Time Constraints
- Save & Exit at any point
- Resume where you left off
- No session timeouts (user owns the pace)

---

## Conclusion

The Idynify Scout user journey is designed for:
- ✅ **Speed:** 60-70 minutes from landing to target list
- ✅ **Clarity:** Each step has clear value and next action
- ✅ **Trust:** Barry validates and challenges (not a yes-man)
- ✅ **Momentum:** Gamification, progress bars, points
- ✅ **Utility:** Downloadable outputs (PDF, CSV, Markdown)
- ✅ **Upsell:** Natural progression to HUNTER (waitlist)

**User leaves with:**
1. Enhanced ICP Brief (strategic clarity)
2. Goal-Validated Strategy (realistic plan)
3. Company Scorecard (scoring framework)
4. TAM Report (market understanding)
5. Target Company List (12 prioritized companies)
6. Confidence to start outreach

**Next Step:**
- User begins outreach (outside of Idynify Scout)
- Or joins HUNTER waitlist (for automated contact discovery and campaigns)

---

*Version 1.0 — Baseline*
*This document maps the complete user journey for the MVP.*
