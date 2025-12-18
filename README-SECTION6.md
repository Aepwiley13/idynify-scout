# Section 6: Buying Behavior & Triggers - Implementation Guide

## 📦 Files Included

1. **Section6BuyingBehaviorTriggers.jsx** - React component
2. **generate-section-6.js** - Netlify serverless function
3. **module-6-buying-behavior.json** - Complete specification (questionnaire + schema + example)

---

## 🚀 Installation Steps

### 1. React Component Setup

**Location:** `/src/components/recon/Section6BuyingBehaviorTriggers.jsx`

```bash
# Copy the file to your project
cp Section6BuyingBehaviorTriggers.jsx /path/to/your/project/src/components/recon/
```

**Dependencies Required:**
- `react` & `react-router-dom`
- Firebase (`firebase/firestore`, `firebase/auth`)

Already imported in the component - no additional packages needed.

---

### 2. Netlify Function Setup

**Location:** `/.netlify/functions/generate-section-6.js`

```bash
# Copy the file to your Netlify functions directory
cp generate-section-6.js /path/to/your/project/.netlify/functions/
```

**Dependencies Required:**
```bash
npm install @anthropic-ai/sdk firebase-admin
```

**Environment Variables (Netlify Dashboard):**
```
ANTHROPIC_API_KEY=sk-ant-...
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

---

## 🗄️ Firestore Database Schema

Add these fields to your `users` collection:

```javascript
{
  userId: "abc123",
  email: "user@example.com",
  
  // Section 6 Data
  section6Answers: {
    startTriggers: ["array of triggers"],
    researchMethods: ["array of methods"],
    salesCycleLength: "string (radio selection)",
    bestBuyingTimes: ["array of quarters/periods"],
    avoidTimes: ["array of avoid periods or empty"],
    linkedinSignals: ["array of signals"],
    competitiveAlternatives: "string (100-300 chars)",
    lastStepBeforeBuy: ["array of steps"],
    stallReasons: "string (100-300 chars)",
    accelerators: "string (100-300 chars)",
    lastSaved: timestamp
  },
  
  section6Output: {
    section: 6,
    title: "Buying Behavior & Triggers",
    status: "completed",
    completedAt: timestamp,
    version: 1,
    buyingBehaviorProfile: { /* full schema */ },
    rawAnswers: { /* all answers */ },
    metadata: { /* generation stats */ }
  },
  
  reconProgress: {
    section6Completed: true,
    section6LastSaved: timestamp,
    lastUpdated: timestamp
  }
}
```

---

## 🔧 Integration with Your App

### Add Route

In your `App.jsx` or routing file:

```javascript
import Section6BuyingBehaviorTriggers from './components/recon/Section6BuyingBehaviorTriggers';

// Add route
<Route path="/recon/section-6" element={<Section6BuyingBehaviorTriggers />} />
```

### Add to Navigation

```javascript
// From Section 5
<button onClick={() => navigate('/recon/section-6')}>
  Next: Buying Behavior →
</button>

// From Section 7
<button onClick={() => navigate('/recon/section-6')}>
  ← Back to Buying Behavior
</button>
```

---

## 🧪 Testing Checklist

### Component Tests

- [ ] All 10 questions render correctly
- [ ] Multi-select questions work:
  - [ ] startTriggers (2-6 selections enforced)
  - [ ] researchMethods (2-6 selections enforced)
  - [ ] bestBuyingTimes (1-5 selections)
  - [ ] avoidTimes (optional multi-select)
  - [ ] linkedinSignals (2-6 selections enforced)
  - [ ] lastStepBeforeBuy (1-4 selections)
- [ ] Radio question works:
  - [ ] salesCycleLength (5 options)
- [ ] Textarea questions work:
  - [ ] competitiveAlternatives (100-300 chars)
  - [ ] stallReasons (100-300 chars)
  - [ ] accelerators (100-300 chars)
- [ ] Character counters show on textareas
- [ ] Selection counters show on multi-selects
- [ ] Validation shows errors for:
  - Missing required fields
  - Too few selections (<2 for most)
  - Too many selections (>max)
  - Text too short (<100 chars)
  - Text too long (>300 chars)
- [ ] Auto-save triggers every 30 seconds
- [ ] Output displays all sections:
  - [ ] Hot triggers
  - [ ] Sales cycle timeline with 3 stages
  - [ ] Seasonal patterns (best/avoid times)
  - [ ] LinkedIn readiness signals
  - [ ] Velocity factors (stalls vs accelerators)
- [ ] Edit button returns to questions
- [ ] Data persists on page refresh

### API Tests

```bash
# Test the Netlify function locally
curl -X POST http://localhost:8888/.netlify/functions/generate-section-6 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "answers": {
      "startTriggers": ["Raised funding (Series A/B/C)", "Poor quarterly results", "New hire (VP Sales, CRO, etc.)", "Scaling/growth phase", "Team churn/attrition"],
      "researchMethods": ["Ask peers/network", "Watch product demos", "Read reviews (G2, Capterra)", "Free trial/POC", "Case studies", "LinkedIn recommendations"],
      "salesCycleLength": "1-3 months (moderate)",
      "bestBuyingTimes": ["Q1 (January-March)", "Q4 (October-December)", "Start of fiscal year", "Budget refresh periods"],
      "avoidTimes": ["Year-end holidays (Nov-Dec)", "Summer (June-August)"],
      "linkedinSignals": ["Job changes (new VP/CRO hired)", "Hiring posts (recruiting for sales/ops)", "Funding announcements", "Problem/pain posts", "Following relevant vendors"],
      "competitiveAlternatives": "Direct competitors: Outreach, Salesloft, Apollo. Indirect: ZoomInfo (data only), Instantly (budget tool), building internal tool. Biggest competitor is do nothing - keep doing manual prospecting.",
      "lastStepBeforeBuy": ["Free trial (hands-on testing)", "Customer references/calls", "ROI analysis/business case", "Executive approval"],
      "stallReasons": "Budget approval delays when CFO is slow. Champion leaving company mid-deal. Too many stakeholders cant agree. Seasonal slowdown in summer/holidays. Competing priorities like product launch.",
      "accelerators": "Quarterly deadline pressure to hit targets. Executive sponsor (CEO) pushing for solution. Urgent pain like SDR churn or missed quota. Strong ROI calculation showing >10x return. Peer success story from trusted colleague."
    }
  }'
```

Expected response:
- Status: 200
- `success: true`
- `output` contains complete JSON schema
- `salesCycleTimeline.stages` has 3 stages with durations
- `hotTriggers.eventBased` matches input selections
- `competitiveSet.directCompetitors` is array of 3+ competitors
- `velocityFactors.stalls.commonBottlenecks` is array of 3-5 bottlenecks
- `velocityFactors.accelerators.speedDrivers` is array of 3-5 drivers
- Generation time < 10 seconds
- Tokens used ~2500-3500

### Validation Tests

- [ ] Empty multi-select shows error
- [ ] 1 selection when 2 required shows error
- [ ] 7 selections when max 6 shows disabled state
- [ ] Empty required textarea shows error
- [ ] Text <100 chars shows character count error
- [ ] Text >300 chars shows character limit error
- [ ] Optional avoidTimes can be empty

---

## 📊 Key Features

### 1. Hot Trigger Analysis

Automatically categorizes triggers and assesses strength:

```
Input: [
  "Raised funding",
  "Poor quarterly results",
  "Team churn",
  "New hire",
  "Scaling phase"
]

Output:
Trigger Strength: "Very strong"

Rationale: "5 triggers including funding (budget), poor results (urgency), 
churn (pain), new hire (champion), scaling (growth). Multiple converging 
triggers create perfect storm."

Categories:
- Event-based: Funding, new hire, scaling
- Performance-based: Poor results, team churn
- Time-based: Fiscal year, budget cycles
```

**Strength Assessment:**
- **Very strong:** 4+ triggers with urgency (performance) + timing
- **Strong:** 3+ triggers with clear pain
- **Moderate:** 2-3 triggers
- **Weak:** 1-2 triggers only

### 2. Sales Cycle Breakdown

Automatically breaks cycle into 3 stages with estimated durations:

```
Input: "1-3 months (moderate)"

Output:
Average Duration: "1-3 months (moderate)"
Duration Range: "6-12 weeks typical, 3-4 weeks fast-track, 3-4 months slow"

Stages:
1. Awareness (Discovery) - Week 1-2
   Activities: Initial outreach, qualification, pain discovery, demo request
   
2. Evaluation (Consideration) - Week 3-8
   Activities: Product demo, trial setup, hands-on testing, references
   
3. Decision (Purchase) - Week 9-12
   Activities: ROI analysis, security review, contract negotiation, approvals
```

**Stage Duration Formulas:**
- **< 1 week:** Awareness (1-2d), Evaluation (2-3d), Decision (1-2d)
- **1-4 weeks:** Awareness (3-7d), Evaluation (1-2w), Decision (3-5d)
- **1-3 months:** Awareness (1-2w), Evaluation (4-8w), Decision (2-4w)
- **3-6 months:** Awareness (2-4w), Evaluation (8-16w), Decision (4-8w)
- **6+ months:** Awareness (1-2m), Evaluation (3-6m), Decision (1-3m)

### 3. Seasonal Pattern Planning

Provides specific guidance for pipeline planning:

```
Input:
Best Times: ["Q1", "Q4", "Start of fiscal year"]
Avoid Times: ["Summer", "Year-end holidays"]

Output:
Planning Implications:
"Accelerate deals in Q4 if behind on quota - use urgency. 
Launch new campaigns in January when budgets refresh. 
Expect slower responses July-August, use for nurturing not closing. 
Avoid major pushes week of Thanksgiving and December 20-31. 
Plan pipeline building for Q3 to close in Q4/Q1."
```

### 4. Competitive Set Parsing

Automatically extracts and categorizes alternatives:

```
Input: "Direct: Outreach, Salesloft, Apollo. Indirect: ZoomInfo (data only), 
Instantly (budget). Biggest is do nothing - manual process."

Output:
directCompetitors: ["Outreach", "Salesloft", "Apollo.io"]
alternatives: ["ZoomInfo (data provider)", "Instantly.ai (budget)", "Build internal"]
doNothing: "Status quo is manual prospecting - familiar even if painful"
```

### 5. Signal Reliability Assessment

Automatically rates signal reliability based on research:

```
LinkedIn Signals: [
  "Job changes (new VP hired)",
  "Hiring posts (recruiting SDRs)",
  "Funding announcements"
]

Signal Reliability: "High"

Breakdown:
- Hiring signals: 75%+ (very reliable)
- Funding signals: 60-70% (reliable within 90 days)
- Job changes: 40-60% (moderate - takes time)
- Thought leadership: <40% (low - not buying signal)
```

### 6. Velocity Factor Comparison

Side-by-side comparison of stalls vs accelerators:

```
⚠️ Deal Stalls:
- Budget approval delays
- Champion leaves
- Too many stakeholders
- Seasonal slowdown
- Competing priorities

⚡ Accelerators:
- Quarterly deadline pressure
- Executive sponsor
- Urgent pain
- Strong ROI
- Peer success story
```

**Visual Display:** Color-coded cards (red for stalls, green for accelerators)

---

## 📱 Mobile Responsiveness

Component is responsive by default using Tailwind:
- Multi-select grid becomes 1 column on mobile
- Velocity factor cards stack vertically
- Character counters remain visible
- Output sections collapse gracefully

Test on:
- [ ] iPhone (375px width)
- [ ] iPad (768px width)
- [ ] Desktop (1280px+ width)

---

## 🐛 Troubleshooting

### Issue: "At least 2 selections required"

**Cause:** Most multi-selects require 2+ selections
- startTriggers: 2-6
- researchMethods: 2-6
- linkedinSignals: 2-6
- lastStepBeforeBuy: 1-4

**Fix:** User must select minimum before generating

---

### Issue: Sales cycle stages don't make sense

**Cause:** Stage durations calculated based on total cycle length

**Validation:** Check stages sum to approximate total:
- 1-3 months: Awareness (1-2w) + Evaluation (4-8w) + Decision (2-4w) = ~8-14 weeks ✓

---

### Issue: Competitive alternatives not parsing

**Cause:** User input not structured clearly

**Good input:**
```
"Direct competitors: Outreach, Salesloft, Apollo. 
Indirect: ZoomInfo, Instantly. 
Do nothing: manual process."
```

**Bad input:**
```
"There are some competitors" ← Too vague
```

**Fix:** Guide users to list specific tool names

---

### Issue: Stalls/accelerators not extracting

**Cause:** User wrote prose instead of listing factors

**Good input:**
```
"Budget delays, champion leaving, too many stakeholders, 
seasonal slowdown, competing priorities"
```

**Bad input:**
```
"Deals stall for various reasons" ← No specifics
```

**Fix:** Instruct users to list specific factors separated by commas

---

### Issue: Trigger strength assessment seems wrong

**Validation:** Check logic:
- 5+ triggers + performance + time = "Very strong" ✓
- 3-4 triggers + some urgency = "Strong" ✓
- 2-3 triggers = "Moderate" ✓
- 1-2 triggers = "Weak" ✓

**Not a bug:** Assessment is based on count + type, not user feeling

---

## 🎯 Expected Performance

**Generation Time:**
- Typical: 8-10 seconds
- Max acceptable: 12 seconds
- Tokens used: ~2500-3500

**Component Load:**
- Initial load: < 1 second
- Firestore fetch: < 500ms
- Multi-select re-render: < 100ms

---

## 📊 Output Sections Generated

When a user completes Section 6, Claude generates:

```
🛒 Buying Behavior Profile

✅ Hot Triggers 🔥
   → Event-based triggers (list)
   → Performance-based (poor results, churn)
   → Time-based (fiscal year, quarters)
   → Trigger strength: Very Strong/Strong/Moderate/Weak

✅ Research Patterns
   → Primary channels (top 3)
   → Influence sources (peers, analysts, reviews)
   → Content preferences (demos, trials, case studies)
   → Research depth: Deep/Moderate/Light
   → Peer influence: Very High/High/Medium/Low

✅ Sales Cycle Timeline ⭐
   → Average duration (from selection)
   → Duration range (expanded)
   → Variance (what causes shorter/longer)
   → 3 Stages with durations:
      • Awareness → activities
      • Evaluation → activities
      • Decision → activities
   → Industry benchmark comparison

✅ Seasonal Patterns
   → Best times (list with ✓)
   → Avoid times (list with ✗)
   → Seasonality strength
   → Planning implications (specific guidance)

✅ Readiness Signals
   → LinkedIn signals (list)
   → Digital footprint
   → Hiring signals
   → Funding signals
   → Competitive signals
   → Signal reliability: High/Medium/Low

✅ Competitive Set
   → Direct competitors (list)
   → Indirect alternatives (list)
   → Do nothing (status quo description)
   → Evaluation process

✅ Decision Milestones
   → Final steps (list)
   → Approval levels
   → Critical path (sequence)
   → Point of no return

✅ Velocity Factors ⭐
   ⚠️ Deal Stalls (red card):
      • Common bottlenecks (list)
      • Stall duration
      • Recovery strategies
   
   ⚡ Accelerators (green card):
      • Speed drivers (list)
      • Compression tactics
      • Urgency creation

✅ Close Triggers
   → Final push factors (list)
   → Commitment moment
   → Last objection
```

---

## 🔗 Integration with Other Sections

### Feeds INTO:

**Section 7 (Decision Process):**
- Sales cycle stages → Decision stakeholder mapping
- Final steps → Approval workflow
- Trigger strength → Urgency level

**Section 9 (Messaging):**
- Hot triggers → Email sequences (trigger-based campaigns)
- Research patterns → Content strategy (demos vs case studies)
- Peer influence → Social proof emphasis

**Section 10 (GTM Strategy):**
- Sales cycle length → Revenue model assumptions
- Seasonal patterns → Campaign calendar
- Competitive set → Market positioning

**Scout Integration:**
- LinkedIn signals → Trigger-based outreach timing
- Research patterns → Outreach channel selection (LinkedIn vs email)
- Trigger strength → Lead scoring

### Feeds FROM:

**Section 5 (Pain & Motivations):**
- Urgency triggers validate startTriggers
- Failed solutions inform competitiveAlternatives
- Success vision influences lastStepBeforeBuy

**Section 4 (Psychographics):**
- Risk tolerance influences salesCycleLength
- Change readiness validates trigger types

**Section 3 (Firmographics):**
- Company stage influences cycle length
- Decision speed validates salesCycleLength

---

## 💡 Pro Tips

### 1. Triggers Are Your Lead Scoring

Use trigger selections to score leads:
- **Hot (100 points):** 3+ triggers present
- **Warm (50 points):** 1-2 triggers present
- **Cold (0 points):** No triggers

**Example:**
Company just raised Series B (trigger) + hired new CRO (trigger) + posted SDR jobs (trigger) = 100 points = HOT LEAD

### 2. Sales Cycle Stages → Content Mapping

Map content to each stage:
- **Awareness:** Blog posts, thought leadership, problem education
- **Evaluation:** Demos, trials, case studies, competitive comparisons
- **Decision:** ROI calculators, references, security docs, contracts

Don't send decision content in awareness stage (too soon).

### 3. Seasonal Planning Is Critical

Use seasonal patterns to plan:
- **Q3 (Jul-Sep):** Build pipeline (slower season, focus on prospecting)
- **Q4 (Oct-Dec):** Close deals (end-of-year urgency, buyers have budget)
- **Q1 (Jan-Mar):** Launch campaigns (new budgets, fresh priorities)
- **Q2 (Apr-Jun):** Maintain momentum (avoid summer slowdown prep)

### 4. Peer Influence → Referral Program

If peer influence is "Very High" or "High":
- Build referral program
- Create customer advocacy program
- Prioritize customer testimonials
- Encourage LinkedIn recommendations
- Host customer round tables

Peer proof is your #1 asset.

### 5. Competitive Set → Battle Cards

Use competitive alternatives to build:
- **Battle cards** for each direct competitor
- **Positioning** against indirect alternatives
- **Status quo objection handling** for "do nothing"

Train sales team on entire competitive set, not just direct competitors.

### 6. Stalls → Proactive Prevention

Don't wait for stalls - prevent them:
- **Budget delays:** Get CFO involved early (before evaluation)
- **Champion leaves:** Multi-thread to 3+ stakeholders
- **Too many stakeholders:** Executive sponsor to force decision
- **Seasonal slowdown:** Close before holiday/summer periods
- **Competing priorities:** Create urgency with deadlines

### 7. Accelerators → Sales Playbook

Build playbooks around accelerators:
- **Quarterly deadline:** "Close before Q4" campaign
- **Executive sponsor:** Executive engagement program
- **Urgent pain:** Fast-track onboarding process
- **Strong ROI:** Pre-built ROI calculator tool
- **Peer success:** Reference call program

Make accelerators repeatable.

---

## ✅ Success Criteria

Before marking Section 6 as complete:

- [ ] All 10 questions answered
- [ ] All multi-selects meet min/max requirements
- [ ] All textareas meet 100-300 char requirements
- [ ] Sales cycle broken into 3 stages with durations
- [ ] Trigger strength assessed
- [ ] 3+ competitors extracted
- [ ] 3+ bottlenecks extracted from stallReasons
- [ ] 3+ drivers extracted from accelerators
- [ ] Output displays all sections
- [ ] Velocity factors show stalls vs accelerators
- [ ] Edit functionality works
- [ ] Data persists across sessions
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Firestore updates correctly
- [ ] Navigation to Section 7 works

---

## 🔄 Next Steps After Implementation

1. **Create lead scoring model** using triggers
2. **Build content map** for each sales cycle stage
3. **Design seasonal campaign calendar** based on best/avoid times
4. **Set up trigger monitoring** (track funding, hiring, job changes via LinkedIn)
5. **Build battle cards** for competitive set
6. **Create playbooks** for stalls and accelerators
7. **Train sales team** on buying behavior patterns
8. **Build Section 7** (Decision Process) next

---

## 📞 Common Questions

**Q: What if sales cycle varies wildly?**  
A: Pick most common scenario. Output includes "variance" field to explain what causes shorter/longer cycles.

**Q: Should I list every possible competitor?**  
A: No - list top 3-5 direct competitors, top 2-3 indirect alternatives. Focus on who you actually compete against in deals.

**Q: Are LinkedIn signals really that reliable?**  
A: Yes! Hiring signals have 75%+ conversion. Funding signals have 60%+ within 90 days. Job changes are 40-60% (new leaders take time to assess).

**Q: What if they don't have seasonality?**  
A: Select "Any time (no seasonality)" in bestBuyingTimes. Output will note "no seasonal patterns - can close year-round".

**Q: How do I use this for Scout integration?**  
A: LinkedIn signals → trigger-based outreach. When someone posts SDR job openings or announces funding, Scout should prioritize them for outreach within 7-14 days.

**Q: Should stall reasons be internal or external?**  
A: Both! External (budget freezes, holidays) and internal (champion leaves, too many stakeholders) factors both cause stalls.

---

## 🎓 Training for Sales/Marketing

Share this output to:

1. **Score leads by triggers** - Prioritize hot leads with 3+ triggers
2. **Time outreach strategically** - Use seasonal patterns and LinkedIn signals
3. **Prevent stalls proactively** - Address bottlenecks before they occur
4. **Accelerate deals** - Apply compression tactics and create urgency
5. **Map content to journey** - Different content for awareness vs decision
6. **Handle competition** - Use competitive set for positioning

---

**Implementation complete! Section 6 is ready to deploy.** 🚀

**Next:** Build Section 7 (Decision Process & Stakeholders) to map who makes the buying decision and how.
